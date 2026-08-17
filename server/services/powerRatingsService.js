const path = require('path')
const { pathToFileURL } = require('url')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const {
  DEFAULT_HOME_ADJUSTMENT,
  HOME_ADJUSTMENT_LIMITS,
  getRatingHomeAdjustment,
} = require('./homeAdvantageService')
const {
  getStartingRatingScale,
  updateStartingRatingScale,
  validateStartingRatingAssignment,
} = require('./startingRatingScaleService')

const NUMERIC_FIELDS = [
  'baseRating',
  'homeAdjustment',
  'manualAdjustment',
  'lastRatingChange',
]
const IMMUTABLE_FIELDS = ['teamId', 'teamName', 'abbreviation']
const DEFAULT_BASE_RATING = BASE_MODEL_V1.startingRatings.center
const FIELD_STORAGE_MAP = Object.freeze({
  homeAdjustment: 'homeAdvantage',
})
const NUMERIC_FIELD_LIMITS = Object.freeze({
  homeAdjustment: HOME_ADJUSTMENT_LIMITS,
})

let seedTeamsPromise = null

class PowerRatingsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'PowerRatingsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const serializeRating = (rating) => {
  const plainRating =
    typeof rating.toJSON === 'function'
      ? rating.toJSON()
      : {
          ...rating,
          id: rating._id?.toString(),
        }

  plainRating.homeAdjustment = getRatingHomeAdjustment(plainRating)

  delete plainRating._id
  delete plainRating.__v
  delete plainRating.homeAdvantage

  return plainRating
}

const getPowerRatingModel = (options = {}) =>
  options.powerRatingModel ?? PowerRating

const getRatingsForUser = async (userId, options = {}) => {
  const query = getPowerRatingModel(options)
    .find({ userId })
    .sort({ teamName: 1 })

  return options.session && typeof query.session === 'function'
    ? query.session(options.session)
    : query
}

const findDuplicates = (values) => {
  const seenValues = new Set()
  const duplicateValues = new Set()

  values.forEach((value) => {
    if (seenValues.has(value)) {
      duplicateValues.add(value)
      return
    }

    seenValues.add(value)
  })

  return [...duplicateValues]
}

const getSeedTeams = async () => {
  if (!seedTeamsPromise) {
    const teamsPath = path.resolve(__dirname, '../../client/src/data/teams.js')
    const teamsUrl = pathToFileURL(teamsPath).href

    seedTeamsPromise = import(teamsUrl).then(({ NHL_TEAMS }) => {
      if (!Array.isArray(NHL_TEAMS) || NHL_TEAMS.length === 0) {
        throw new PowerRatingsError(
          'Unable to load NHL team seed data.',
          500,
        )
      }

      const teams = NHL_TEAMS.map((team) => ({
        teamId: normalizeIdentifier(team.id),
        teamName: team.name,
        abbreviation: normalizeIdentifier(team.abbreviation),
      }))

      const duplicateTeamIds = findDuplicates(teams.map((team) => team.teamId))
      const duplicateAbbreviations = findDuplicates(
        teams.map((team) => team.abbreviation),
      )

      if (duplicateTeamIds.length > 0 || duplicateAbbreviations.length > 0) {
        throw new PowerRatingsError(
          'Power rating seed data contains duplicate team identifiers.',
          500,
          {
            duplicateTeamIds,
            duplicateAbbreviations,
          },
        )
      }

      return teams
    })
  }

  return seedTeamsPromise
}

const createDuplicateError = (error) => {
  if (error?.code !== 11000) {
    return null
  }

  const duplicateField = Object.keys(error.keyPattern ?? error.keyValue ?? {})[0]
  const duplicateValue = error.keyValue?.[duplicateField]
  const fieldLabel = duplicateField || 'identifier'
  const valueLabel = duplicateValue ? ` "${duplicateValue}"` : ''

  return new PowerRatingsError(
    `A power rating with ${fieldLabel}${valueLabel} already exists.`,
    400,
  )
}

const validateUpdatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new PowerRatingsError('Request body must be an object.', 400)
  }

  const payloadFields = Object.keys(payload)
  const immutableFields = payloadFields.filter((field) =>
    IMMUTABLE_FIELDS.includes(field),
  )

  if (immutableFields.length > 0) {
    throw new PowerRatingsError(
      'teamId, teamName and abbreviation cannot be changed through this endpoint.',
      400,
      { immutableFields },
    )
  }

  const unsupportedFields = payloadFields.filter(
    (field) => !NUMERIC_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new PowerRatingsError(
      'Request body contains unsupported power rating fields.',
      400,
      { unsupportedFields },
    )
  }

  if (payloadFields.length === 0) {
    throw new PowerRatingsError(
      'At least one power rating value is required.',
      400,
    )
  }

  return payloadFields.reduce((updates, field) => {
    const value = Number(payload[field])
    const limits = NUMERIC_FIELD_LIMITS[field]

    if (!Number.isFinite(value)) {
      throw new PowerRatingsError(
        `${field} must be a finite number.`,
        400,
        { field },
      )
    }

    if (limits && (value < limits.min || value > limits.max)) {
      throw new PowerRatingsError(
        `${field} must be between ${limits.min} and ${limits.max}.`,
        400,
        { field, limits },
      )
    }

    updates[FIELD_STORAGE_MAP[field] ?? field] = value
    return updates
  }, {})
}

const resolveStartingRatingScale = async (userId, options = {}) => {
  if (options.startingRatingScale) {
    return options.startingRatingScale
  }

  const result = await (
    options.getStartingRatingScale ?? getStartingRatingScale
  )(userId)

  return result.scale
}

const initializeDefaultPowerRatings = async (userId, options = {}) => {
  const powerRatingModel = getPowerRatingModel(options)
  const seedTeams = await getSeedTeams()
  const startingRatingScale = await resolveStartingRatingScale(userId, options)
  const operations = seedTeams.map((team) => ({
    updateOne: {
      filter: {
        teamId: team.teamId,
        userId,
      },
      update: {
        $setOnInsert: {
          abbreviation: team.abbreviation,
          baseRating: startingRatingScale.center,
          homeAdvantage: DEFAULT_HOME_ADJUSTMENT,
          lastRatingChange: 0,
          manualAdjustment: 0,
          teamId: team.teamId,
          teamName: team.teamName,
          userId,
        },
      },
      upsert: true,
    },
  }))

  try {
    const result = await powerRatingModel.bulkWrite(operations, {
      ordered: false,
      ...(options.session ? { session: options.session } : {}),
    })

    return {
      insertedCount: result.upsertedCount ?? 0,
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
      totalTeams: seedTeams.length,
    }
  } catch (error) {
    const duplicateError = createDuplicateError(error)

    if (duplicateError) {
      throw duplicateError
    }

    throw error
  }
}

const getPowerRatings = async (userId, options = {}) => {
  await initializeDefaultPowerRatings(userId, options)

  const ratings = await getRatingsForUser(userId)

  return ratings.map(serializeRating)
}

const updatePowerRating = async (userId, teamId, payload) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  if (!normalizedTeamId) {
    throw new PowerRatingsError('teamId is required.', 400)
  }

  const updates = validateUpdatePayload(payload)
  const rating = await PowerRating.findOne({
    teamId: normalizedTeamId,
    userId,
  })

  if (!rating) {
    throw new PowerRatingsError(
      `Power rating for ${normalizedTeamId} was not found.`,
      404,
    )
  }

  if (
    Object.hasOwn(updates, 'baseRating') &&
    !Object.hasOwn(updates, 'lastRatingChange')
  ) {
    updates.lastRatingChange = updates.baseRating - rating.baseRating
  }

  Object.assign(rating, updates)

  try {
    await rating.save()
  } catch (error) {
    const duplicateError = createDuplicateError(error)

    if (duplicateError) {
      throw duplicateError
    }

    throw error
  }

  return serializeRating(rating)
}

const updateStartingPowerRating = async (
  userId,
  teamId,
  payload,
  options = {},
) => {
  if (
    payload &&
    !Array.isArray(payload) &&
    typeof payload === 'object' &&
    Object.hasOwn(payload, 'baseRating')
  ) {
    const startingRatingScale = await resolveStartingRatingScale(userId, options)

    validateStartingRatingAssignment(payload.baseRating, startingRatingScale)
  }

  return updatePowerRating(userId, teamId, payload)
}

const getStartingRatingScaleLifecycle = async (userId, options = {}) => {
  const processedRatingGameModel =
    options.processedRatingGameModel ?? ProcessedRatingGame
  const seasonMetadataProvider =
    options.seasonMetadataProvider ??
    (() =>
      require('./nhlSeasonService').getAvailablePowerRatingHistorySeasons())
  const seasonMetadata = await seasonMetadataProvider()
  const currentSeason = seasonMetadata?.seasons?.find(
    (season) =>
      season.id === seasonMetadata.currentSeasonId || season.isCurrent,
  )

  if (!currentSeason?.startDate || !currentSeason?.endDate) {
    return {
      locked: false,
      seasonId: seasonMetadata?.currentSeasonId ?? null,
      status: 'preseason',
    }
  }

  const processedGame = await processedRatingGameModel
    .findOne({
      gameDate: {
        $gte: new Date(`${currentSeason.startDate}T00:00:00.000Z`),
        $lte: new Date(`${currentSeason.endDate}T23:59:59.999Z`),
      },
      userId,
    })
    .select('_id')
    .lean()
  const locked = Boolean(processedGame)

  return {
    locked,
    seasonId: currentSeason.id,
    status: locked ? 'locked' : 'preseason',
  }
}

const getStartingRatingScaleConfiguration = async (userId, options = {}) => {
  const [scaleResult, lifecycle] = await Promise.all([
    getStartingRatingScale(userId, options),
    getStartingRatingScaleLifecycle(userId, options),
  ])

  return {
    ...scaleResult,
    ...lifecycle,
  }
}

const updateStartingRatingScaleConfiguration = async (
  userId,
  payload,
  options = {},
) => {
  const lifecycle = await getStartingRatingScaleLifecycle(userId, options)

  if (lifecycle.locked) {
    throw new PowerRatingsError(
      'Starting scale cannot be changed after live rating updates begin.',
      409,
      { seasonId: lifecycle.seasonId },
    )
  }

  const result = await updateStartingRatingScale(userId, payload, options)

  return {
    ...result,
    ...lifecycle,
  }
}

const seedPowerRatings = async (userId, options = {}) => {
  const startingRatingScale = await resolveStartingRatingScale(userId, options)
  const result = await initializeDefaultPowerRatings(userId, {
    ...options,
    startingRatingScale,
  })
  const ratings = await getRatingsForUser(userId, options)

  return {
    insertedCount: result.insertedCount,
    skippedCount: result.totalTeams - result.insertedCount,
    startingRatingScale,
    totalTeams: result.totalTeams,
    ratings: ratings.map(serializeRating),
  }
}

const resetPowerRatings = async (userId, options = {}) => {
  const powerRatingModel = getPowerRatingModel(options)
  const seedTeams = await getSeedTeams()
  const startingRatingScale = await resolveStartingRatingScale(userId, options)
  const operations = seedTeams.map((team) => ({
    updateOne: {
      filter: {
        teamId: team.teamId,
        userId,
      },
      update: {
        $set: {
          abbreviation: team.abbreviation,
          baseRating: startingRatingScale.center,
          homeAdvantage: DEFAULT_HOME_ADJUSTMENT,
          lastRatingChange: 0,
          manualAdjustment: 0,
          teamId: team.teamId,
          teamName: team.teamName,
          userId,
        },
      },
      upsert: true,
    },
  }))

  await powerRatingModel.bulkWrite(operations, {
    ordered: false,
    ...(options.session ? { session: options.session } : {}),
  })

  const ratings = await getRatingsForUser(userId, options)

  return {
    ratings: ratings.map(serializeRating),
    startingRatingScale,
    totalTeams: seedTeams.length,
  }
}

module.exports = {
  DEFAULT_BASE_RATING,
  DEFAULT_HOME_ADJUSTMENT,
  PowerRatingsError,
  getPowerRatings,
  getSeedTeams,
  getStartingRatingScaleConfiguration,
  getStartingRatingScaleLifecycle,
  initializeDefaultPowerRatings,
  resetPowerRatings,
  seedPowerRatings,
  updateStartingRatingScaleConfiguration,
  updateStartingPowerRating,
  updatePowerRating,
}
