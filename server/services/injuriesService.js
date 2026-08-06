const mongoose = require('mongoose')
const Injury = require('../models/Injury')
const {
  getKnownTeamById,
  getKnownTeams,
  normalizeTeamIdentifier,
} = require('./teamCatalogService')

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
  'isGoalie',
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
  'isGoalie',
]

class InjuriesError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'InjuriesError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const normalizeIdentifier = normalizeTeamIdentifier

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

const toBoolean = (value, field, fallback) => {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw new InjuriesError(`${field} must be true or false.`, 400, { field })
  }

  return value
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

  const team = await getKnownTeamById(payload.teamId)

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
    active: toBoolean(payload.active, 'active', true),
    isGoalie: toBoolean(payload.isGoalie, 'isGoalie', false),
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

    if (field === 'active' || field === 'isGoalie') {
      if (typeof payload[field] !== 'boolean') {
        throw new InjuriesError(`${field} must be true or false.`, 400, {
          field,
        })
      }

      updates[field] = payload[field]
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

const buildTeamInjurySummaryPipeline = (userId) => [
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
        goalieInjuries: {
          $sum: { $cond: [{ $eq: ['$isGoalie', true] }, 1, 0] },
        },
        totalImpact: {
          $sum: {
            $cond: [{ $eq: ['$isGoalie', true] }, 0, '$impact'],
          },
        },
      },
    },
  ]

const getTeamInjurySummary = async (userId) => {
  const teams = await getKnownTeams()
  const summaryRows = await Injury.aggregate(
    buildTeamInjurySummaryPipeline(userId),
  )
  const summaryByTeamId = new Map(
    summaryRows.map((row) => [
      row._id,
      {
        activeInjuries: row.activeInjuries,
        goalieInjuries: row.goalieInjuries,
        totalImpact: row.totalImpact,
      },
    ]),
  )

  return teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    activeInjuries: summaryByTeamId.get(team.teamId)?.activeInjuries ?? 0,
    goalieInjuries: summaryByTeamId.get(team.teamId)?.goalieInjuries ?? 0,
    totalImpact: summaryByTeamId.get(team.teamId)?.totalImpact ?? 0,
  }))
}

module.exports = {
  InjuriesError,
  buildTeamInjurySummaryPipeline,
  createInjury,
  deleteInjury,
  getInjuries,
  getTeamInjuries,
  getTeamInjurySummary,
  normalizeCreatePayload,
  normalizeUpdatePayload,
  updateInjury,
}
