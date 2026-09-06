const mongoose = require('mongoose')
const LegacyOwnershipMigration = require('../models/LegacyOwnershipMigration')
const PowerRating = require('../models/PowerRating')
const User = require('../models/User')
const { PRIVATE_DATA_MODELS } = require('./privateDataModels')
const { isValidEmail, normalizeEmail } = require('../utils/email')

const MIGRATION_VERSION = 'legacy-owner-assignment-v1'
const LEGACY_OWNER_FILTER = {
  $or: [{ userId: { $exists: false } }, { userId: null }],
}
const DEFAULT_SAMPLE_LIMIT = 5

class LegacyOwnerMigrationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LegacyOwnerMigrationError'
  }
}

const resolveQuery = async (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const sameId = (left, right) => String(left ?? '') === String(right ?? '')

const resolveIntendedOwner = async ({ email, googleSubject, userModel = User }) => {
  const normalizedEmail = normalizeEmail(email)
  const normalizedGoogleSubject = String(googleSubject ?? '').trim()

  if (!isValidEmail(normalizedEmail) || !normalizedGoogleSubject) {
    throw new LegacyOwnerMigrationError(
      'A valid owner email and Google subject are both required.',
    )
  }

  const [emailUser, googleUser] = await Promise.all([
    resolveQuery(userModel.findOne({ email: normalizedEmail })),
    resolveQuery(userModel.findOne({ googleId: normalizedGoogleSubject })),
  ])

  if (!emailUser || !googleUser || !sameId(emailUser._id, googleUser._id)) {
    throw new LegacyOwnerMigrationError(
      'Owner email and Google subject do not resolve to the same existing User.',
    )
  }

  if (googleUser.status === 'disabled') {
    throw new LegacyOwnerMigrationError('The intended owner User is disabled.')
  }

  return {
    email: normalizedEmail,
    googleSubject: normalizedGoogleSubject,
    user: googleUser,
  }
}

const executeSampleQuery = async (model, sampleLimit) => {
  let query = model.find(LEGACY_OWNER_FILTER)
  if (typeof query.select === 'function') query = query.select({ _id: 1 })
  if (typeof query.limit === 'function') query = query.limit(sampleLimit)
  const rows = await resolveQuery(query)

  return (Array.isArray(rows) ? rows : []).map((row) => String(row._id))
}

const getIndexes = async (model) => {
  if (!model.collection?.indexes) return []

  try {
    return await model.collection.indexes()
  } catch (error) {
    if (['NamespaceNotFound', 26].includes(error?.codeName ?? error?.code)) {
      return []
    }
    throw error
  }
}

const isOwnerlessUniqueIndex = (index) =>
  index?.unique === true &&
  index.name !== '_id_' &&
  !Object.hasOwn(index.key ?? {}, 'userId')

const isKnownLegacyPowerRatingIndex = (index) => {
  const entries = Object.entries(index?.key ?? {})
  return (
    index?.unique === true &&
    entries.length === 1 &&
    ['teamId', 'abbreviation'].includes(entries[0][0]) &&
    entries[0][1] === 1
  )
}

const auditPrivateCollections = async (
  { models = PRIVATE_DATA_MODELS, sampleLimit = DEFAULT_SAMPLE_LIMIT } = {},
) => {
  const collections = []

  for (const model of models) {
    const [count, sampleIds, indexes] = await Promise.all([
      model.countDocuments(LEGACY_OWNER_FILTER),
      executeSampleQuery(model, sampleLimit),
      getIndexes(model),
    ])
    const ownerlessUniqueIndexes = indexes
      .filter(isOwnerlessUniqueIndex)
      .map((index) => ({ key: index.key, name: index.name, unique: true }))

    collections.push({
      collection: model.collection?.collectionName ?? model.modelName,
      count,
      modelName: model.modelName,
      ownerlessUniqueIndexes,
      sampleIds,
    })
  }

  return collections
}

const findKnownLegacyIndexes = (collections) => {
  const powerRatings = collections.find(
    ({ modelName }) => modelName === 'PowerRating',
  )

  return (powerRatings?.ownerlessUniqueIndexes ?? []).filter(
    isKnownLegacyPowerRatingIndex,
  )
}

const dropKnownLegacyIndexes = async (
  indexes,
  { powerRatingModel = PowerRating } = {},
) => {
  const dropped = []

  for (const index of indexes) {
    await powerRatingModel.collection.dropIndex(index.name)
    dropped.push(index.name)
  }

  if (dropped.length > 0 && powerRatingModel.createIndexes) {
    await powerRatingModel.createIndexes()
  }

  return dropped
}

const runLegacyOwnerMigration = async (
  {
    confirm = false,
    email,
    googleSubject,
    version = MIGRATION_VERSION,
  },
  {
    markerModel = LegacyOwnershipMigration,
    models = PRIVATE_DATA_MODELS,
    now = () => new Date(),
    powerRatingModel = PowerRating,
    runTransaction = (work) => mongoose.connection.transaction(work),
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
    userModel = User,
  } = {},
) => {
  const owner = await resolveIntendedOwner({ email, googleSubject, userModel })
  const collections = await auditPrivateCollections({ models, sampleLimit })
  const totalRecords = collections.reduce((sum, item) => sum + item.count, 0)
  const knownLegacyIndexes = findKnownLegacyIndexes(collections)
  const existingMarker = await resolveQuery(markerModel.findOne({ version }))
  const result = {
    collections,
    confirmed: confirm,
    intendedOwner: {
      email: owner.email,
      googleSubject: owner.googleSubject,
      userId: String(owner.user._id),
    },
    knownLegacyIndexes,
    migrationAlreadyRecorded: Boolean(existingMarker),
    totalRecords,
    version,
  }

  if (!confirm) return { ...result, totalChanged: 0 }

  if (existingMarker) {
    if (
      !sameId(existingMarker.ownerUserId, owner.user._id) ||
      existingMarker.ownerEmail !== owner.email ||
      existingMarker.ownerGoogleId !== owner.googleSubject
    ) {
      throw new LegacyOwnerMigrationError(
        'Migration marker belongs to a different intended owner.',
      )
    }

    if (totalRecords > 0) {
      throw new LegacyOwnerMigrationError(
        'Migration marker exists but new unowned records were found; use a new reviewed migration version.',
      )
    }
    return { ...result, totalChanged: 0 }
  }

  const droppedLegacyIndexes = await dropKnownLegacyIndexes(knownLegacyIndexes, {
    powerRatingModel,
  })
  const collectionResults = {}
  let totalChanged = 0

  await runTransaction(async (session) => {
    for (const model of models) {
      const update = await model.updateMany(
        LEGACY_OWNER_FILTER,
        { $set: { userId: owner.user._id } },
        { session },
      )
      const changed = Number(update?.modifiedCount) || 0
      collectionResults[model.modelName] = changed
      totalChanged += changed
    }

    await markerModel.create(
      [
        {
          collectionResults,
          completedAt: now(),
          droppedLegacyIndexes,
          ownerEmail: owner.email,
          ownerGoogleId: owner.googleSubject,
          ownerUserId: owner.user._id,
          totalChanged,
          version,
        },
      ],
      { session },
    )
  })

  return {
    ...result,
    collectionResults,
    droppedLegacyIndexes,
    totalChanged,
  }
}

module.exports = {
  DEFAULT_SAMPLE_LIMIT,
  LEGACY_OWNER_FILTER,
  MIGRATION_VERSION,
  LegacyOwnerMigrationError,
  auditPrivateCollections,
  isKnownLegacyPowerRatingIndex,
  isOwnerlessUniqueIndex,
  resolveIntendedOwner,
  runLegacyOwnerMigration,
}
