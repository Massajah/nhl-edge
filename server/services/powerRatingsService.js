const path = require('path')
const { pathToFileURL } = require('url')
const PowerRating = require('../models/PowerRating')

const NUMERIC_FIELDS = [
  'baseRating',
  'homeAdvantage',
  'manualAdjustment',
  'lastRatingChange',
]
const IMMUTABLE_FIELDS = ['teamId', 'teamName', 'abbreviation']

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

  delete plainRating._id
  delete plainRating.__v

  return plainRating
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

    if (!Number.isFinite(value)) {
      throw new PowerRatingsError(
        `${field} must be a finite number.`,
        400,
        { field },
      )
    }

    updates[field] = value
    return updates
  }, {})
}

const getPowerRatings = async () => {
  const ratings = await PowerRating.find({}).sort({ teamName: 1 })

  return ratings.map(serializeRating)
}

const updatePowerRating = async (teamId, payload) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  if (!normalizedTeamId) {
    throw new PowerRatingsError('teamId is required.', 400)
  }

  const updates = validateUpdatePayload(payload)
  const rating = await PowerRating.findOne({ teamId: normalizedTeamId })

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

const findSeedConflicts = (existingRatings, seedTeams) => {
  const seedTeamById = new Map(seedTeams.map((team) => [team.teamId, team]))
  const seedTeamByAbbreviation = new Map(
    seedTeams.map((team) => [team.abbreviation, team]),
  )

  return existingRatings.reduce((conflicts, rating) => {
    const teamId = normalizeIdentifier(rating.teamId)
    const abbreviation = normalizeIdentifier(rating.abbreviation)
    const seedTeamForId = seedTeamById.get(teamId)
    const seedTeamForAbbreviation = seedTeamByAbbreviation.get(abbreviation)

    if (seedTeamForId && abbreviation !== seedTeamForId.abbreviation) {
      conflicts.push({
        teamId,
        existingAbbreviation: abbreviation,
        expectedAbbreviation: seedTeamForId.abbreviation,
      })
    }

    if (seedTeamForAbbreviation && teamId !== seedTeamForAbbreviation.teamId) {
      conflicts.push({
        abbreviation,
        existingTeamId: teamId,
        expectedTeamId: seedTeamForAbbreviation.teamId,
      })
    }

    return conflicts
  }, [])
}

const seedPowerRatings = async () => {
  const seedTeams = await getSeedTeams()
  const seedTeamIds = seedTeams.map((team) => team.teamId)
  const seedAbbreviations = seedTeams.map((team) => team.abbreviation)
  const existingRatings = await PowerRating.find({
    $or: [
      { teamId: { $in: seedTeamIds } },
      { abbreviation: { $in: seedAbbreviations } },
    ],
  })

  const conflicts = findSeedConflicts(existingRatings, seedTeams)

  if (conflicts.length > 0) {
    throw new PowerRatingsError(
      'Cannot seed power ratings because existing team identifiers conflict with NHL team data.',
      400,
      { conflicts },
    )
  }

  const existingTeamIds = new Set(
    existingRatings.map((rating) => normalizeIdentifier(rating.teamId)),
  )
  const missingTeams = seedTeams.filter(
    (team) => !existingTeamIds.has(team.teamId),
  )

  if (missingTeams.length > 0) {
    try {
      await PowerRating.insertMany(
        missingTeams.map((team) => ({
          teamId: team.teamId,
          teamName: team.teamName,
          abbreviation: team.abbreviation,
        })),
        { ordered: false },
      )
    } catch (error) {
      const duplicateError = createDuplicateError(error)

      if (duplicateError) {
        throw duplicateError
      }

      throw error
    }
  }

  return {
    insertedCount: missingTeams.length,
    skippedCount: seedTeams.length - missingTeams.length,
    totalTeams: seedTeams.length,
    ratings: await getPowerRatings(),
  }
}

module.exports = {
  PowerRatingsError,
  getPowerRatings,
  seedPowerRatings,
  updatePowerRating,
}
