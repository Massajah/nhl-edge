const path = require('path')
const { pathToFileURL } = require('url')
const PowerRating = require('../models/PowerRating')
const {
  DEFAULT_HOME_ADJUSTMENT,
  HOME_ADJUSTMENT_LIMITS,
  getRatingHomeAdjustment,
} = require('./homeAdvantageService')

const NUMERIC_FIELDS = [
  'baseRating',
  'homeAdjustment',
  'manualAdjustment',
  'lastRatingChange',
]
const IMMUTABLE_FIELDS = ['teamId', 'teamName', 'abbreviation']
const DEFAULT_BASE_RATING = 50
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

const getRatingsForUser = async (userId) =>
  PowerRating.find({ userId }).sort({ teamName: 1 })

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

const initializeDefaultPowerRatings = async (userId) => {
  const seedTeams = await getSeedTeams()
  const operations = seedTeams.map((team) => ({
    updateOne: {
      filter: {
        teamId: team.teamId,
        userId,
      },
      update: {
        $setOnInsert: {
          abbreviation: team.abbreviation,
          baseRating: DEFAULT_BASE_RATING,
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
    const result = await PowerRating.bulkWrite(operations, { ordered: false })

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

const getPowerRatings = async (userId) => {
  await initializeDefaultPowerRatings(userId)

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

const seedPowerRatings = async (userId) => {
  const result = await initializeDefaultPowerRatings(userId)
  const ratings = await getRatingsForUser(userId)

  return {
    insertedCount: result.insertedCount,
    skippedCount: result.totalTeams - result.insertedCount,
    totalTeams: result.totalTeams,
    ratings: ratings.map(serializeRating),
  }
}

module.exports = {
  DEFAULT_BASE_RATING,
  DEFAULT_HOME_ADJUSTMENT,
  PowerRatingsError,
  getPowerRatings,
  getSeedTeams,
  initializeDefaultPowerRatings,
  seedPowerRatings,
  updatePowerRating,
}
