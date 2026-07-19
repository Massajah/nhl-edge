const path = require('path')
const { pathToFileURL } = require('url')
const mongoose = require('mongoose')
const Injury = require('../models/Injury')

const INJURY_STATUSES = Injury.INJURY_STATUSES
const DURATION_TYPES = Injury.DURATION_TYPES
const CREATE_FIELDS = [
  'teamId',
  'teamName',
  'teamAbbreviation',
  'playerName',
  'status',
  'injuryType',
  'impact',
  'durationType',
  'expectedReturn',
  'notes',
  'active',
]
const UPDATE_FIELDS = [
  'playerName',
  'status',
  'injuryType',
  'impact',
  'durationType',
  'expectedReturn',
  'notes',
  'active',
]

let teamsPromise = null

class InjuriesError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'InjuriesError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const toObjectId = (userId) => new mongoose.Types.ObjectId(userId)

const toText = (value, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const toNumber = (value, field) => {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    throw new InjuriesError(`${field} must be a finite number.`, 400, {
      field,
    })
  }

  return parsedValue
}

const getTeams = async () => {
  if (!teamsPromise) {
    const teamsPath = path.resolve(__dirname, '../../client/src/data/teams.js')
    const teamsUrl = pathToFileURL(teamsPath).href

    teamsPromise = import(teamsUrl).then(({ NHL_TEAMS }) => {
      if (!Array.isArray(NHL_TEAMS) || NHL_TEAMS.length === 0) {
        throw new InjuriesError('Unable to load NHL team data.', 500)
      }

      return NHL_TEAMS.map((team) => ({
        teamId: normalizeIdentifier(team.id),
        teamName: team.name,
        teamAbbreviation: normalizeIdentifier(team.abbreviation),
      }))
    })
  }

  return teamsPromise
}

const getTeamById = async (teamId) => {
  const normalizedTeamId = normalizeIdentifier(teamId)
  const teams = await getTeams()

  return teams.find((team) => team.teamId === normalizedTeamId)
}

const assertSupportedFields = (payload, allowedFields) => {
  const unsupportedFields = Object.keys(payload).filter(
    (field) => !allowedFields.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new InjuriesError('Request body contains unsupported injury fields.', 400, {
      unsupportedFields,
    })
  }
}

const normalizeStatus = (status = 'out') => {
  if (!INJURY_STATUSES.includes(status)) {
    throw new InjuriesError(
      `status must be one of: ${INJURY_STATUSES.join(', ')}.`,
      400,
      { field: 'status' },
    )
  }

  return status
}

const normalizeDurationType = (durationType = 'unknown') => {
  if (!DURATION_TYPES.includes(durationType)) {
    throw new InjuriesError(
      `durationType must be one of: ${DURATION_TYPES.join(', ')}.`,
      400,
      { field: 'durationType' },
    )
  }

  return durationType
}

const normalizeImpact = (impact = 0) => {
  const normalizedImpact = toNumber(impact, 'impact')

  if (normalizedImpact > 0) {
    throw new InjuriesError('impact cannot be positive.', 400, {
      field: 'impact',
    })
  }

  return normalizedImpact
}

const normalizeCreatePayload = async (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new InjuriesError('Request body must be an object.', 400)
  }

  assertSupportedFields(payload, CREATE_FIELDS)

  const team = await getTeamById(payload.teamId)

  if (!team) {
    throw new InjuriesError('teamId must match a known NHL team.', 400, {
      field: 'teamId',
    })
  }

  const playerName = toText(payload.playerName)

  if (!playerName) {
    throw new InjuriesError('playerName is required.', 400, {
      field: 'playerName',
    })
  }

  return {
    teamId: team.teamId,
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    playerName,
    status: normalizeStatus(payload.status ?? 'out'),
    injuryType: toText(payload.injuryType),
    impact: normalizeImpact(payload.impact ?? 0),
    durationType: normalizeDurationType(payload.durationType ?? 'unknown'),
    expectedReturn: toText(payload.expectedReturn),
    notes: toText(payload.notes),
    active: payload.active ?? true,
  }
}

const normalizeUpdatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new InjuriesError('Request body must be an object.', 400)
  }

  const fields = Object.keys(payload)

  if (fields.length === 0) {
    throw new InjuriesError('At least one injury field is required.', 400)
  }

  assertSupportedFields(payload, UPDATE_FIELDS)

  return fields.reduce((updates, field) => {
    if (field === 'playerName') {
      const playerName = toText(payload.playerName)

      if (!playerName) {
        throw new InjuriesError('playerName is required.', 400, {
          field: 'playerName',
        })
      }

      updates.playerName = playerName
      return updates
    }

    if (field === 'status') {
      updates.status = normalizeStatus(payload.status)
      return updates
    }

    if (field === 'durationType') {
      updates.durationType = normalizeDurationType(payload.durationType)
      return updates
    }

    if (field === 'impact') {
      updates.impact = normalizeImpact(payload.impact)
      return updates
    }

    if (field === 'active') {
      updates.active = Boolean(payload.active)
      return updates
    }

    updates[field] = toText(payload[field])
    return updates
  }, {})
}

const serializeInjury = (injury) => {
  const plainInjury =
    typeof injury.toJSON === 'function'
      ? injury.toJSON()
      : {
          ...injury,
          id: injury._id?.toString(),
        }

  delete plainInjury._id
  delete plainInjury.__v

  return plainInjury
}

const getInjuries = async (userId) => {
  const injuries = await Injury.find({ userId }).sort({
    active: -1,
    teamName: 1,
    playerName: 1,
  })

  return injuries.map(serializeInjury)
}

const getTeamInjuries = async (userId, teamId) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  if (!normalizedTeamId) {
    throw new InjuriesError('teamId is required.', 400)
  }

  const injuries = await Injury.find({
    teamId: normalizedTeamId,
    userId,
  }).sort({
    active: -1,
    playerName: 1,
  })

  return injuries.map(serializeInjury)
}

const createInjury = async (userId, payload) => {
  const injury = new Injury({
    ...(await normalizeCreatePayload(payload)),
    userId,
  })

  await injury.save()

  return serializeInjury(injury)
}

const updateInjury = async (userId, id, payload) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  const updates = normalizeUpdatePayload(payload)
  const injury = await Injury.findOne({
    _id: id,
    userId,
  })

  if (!injury) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  Object.assign(injury, updates)
  await injury.save()

  return serializeInjury(injury)
}

const deleteInjury = async (userId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  const deletedInjury = await Injury.findOneAndDelete({
    _id: id,
    userId,
  })

  if (!deletedInjury) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  return serializeInjury(deletedInjury)
}

const getTeamInjurySummary = async (userId) => {
  const teams = await getTeams()
  const summaryRows = await Injury.aggregate([
    {
      $match: {
        active: true,
        status: { $ne: 'healthy' },
        userId: toObjectId(userId),
      },
    },
    {
      $group: {
        _id: '$teamId',
        activeInjuries: { $sum: 1 },
        totalImpact: { $sum: '$impact' },
      },
    },
  ])
  const summaryByTeamId = new Map(
    summaryRows.map((row) => [
      row._id,
      {
        activeInjuries: row.activeInjuries,
        totalImpact: row.totalImpact,
      },
    ]),
  )

  return teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    activeInjuries: summaryByTeamId.get(team.teamId)?.activeInjuries ?? 0,
    totalImpact: summaryByTeamId.get(team.teamId)?.totalImpact ?? 0,
  }))
}

module.exports = {
  InjuriesError,
  createInjury,
  deleteInjury,
  getInjuries,
  getTeamInjuries,
  getTeamInjurySummary,
  updateInjury,
}
