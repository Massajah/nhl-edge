const mongoose = require('mongoose')
const Injury = require('../models/Injury')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
} = require('../config/baseModel')
const { getRatingEngineSettings } = require('./ratingEngineSettingsService')
const {
  getKnownTeamById,
  getKnownTeams,
  normalizeTeamIdentifier,
} = require('./teamCatalogService')

const INJURY_STATUSES = Injury.INJURY_STATUSES
const DURATION_TYPES = Injury.DURATION_TYPES
const PLAYER_POSITIONS = Injury.PLAYER_POSITIONS
const CREATE_FIELDS = [
  'teamId',
  'teamName',
  'teamAbbreviation',
  'playerName',
  'providerPlayerId',
  'position',
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
  'providerPlayerId',
  'position',
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

const POSITION_ALIASES = Object.freeze({
  C: 'C',
  CENTER: 'C',
  CENTRE: 'C',
  D: 'D',
  DEFENSE: 'D',
  DEFENSEMAN: 'D',
  DEFENCEMAN: 'D',
  G: 'G',
  GK: 'G',
  GOALIE: 'G',
  GOALTENDER: 'G',
  L: 'LW',
  LEFT: 'LW',
  LW: 'LW',
  'LEFT WING': 'LW',
  R: 'RW',
  RIGHT: 'RW',
  RW: 'RW',
  'RIGHT WING': 'RW',
})

const normalizePlayerPosition = (position) => {
  const normalizedPosition = toText(position).toUpperCase()

  if (!normalizedPosition) {
    return ''
  }

  const canonicalPosition = POSITION_ALIASES[normalizedPosition]

  if (!canonicalPosition || !PLAYER_POSITIONS.includes(canonicalPosition)) {
    throw new InjuriesError('position must be one of: C, LW, RW, D, G.', 400, {
      field: 'position',
    })
  }

  return canonicalPosition
}

const normalizeProviderPlayerId = (providerPlayerId) => {
  if (
    providerPlayerId === undefined ||
    providerPlayerId === null ||
    providerPlayerId === ''
  ) {
    return null
  }

  const normalizedId = Number(providerPlayerId)

  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new InjuriesError('providerPlayerId must be a positive integer.', 400, {
      field: 'providerPlayerId',
    })
  }

  return normalizedId
}

const normalizeStoredPlayerPosition = (position) => {
  try {
    return normalizePlayerPosition(position)
  } catch {
    return ''
  }
}

const isGoalieRecord = (injury = {}) =>
  normalizeStoredPlayerPosition(injury.position) === 'G' ||
  injury.isGoalie === true

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

const normalizeImpact = (
  impact = 0,
  maximumPlayerInjuryPenalty =
    DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.maximumPlayerInjuryPenalty,
  options = {},
) => {
  const normalizedImpact = toNumber(impact, 'impact')

  if (normalizedImpact > 0) {
    throw new InjuriesError('impact cannot be positive.', 400, {
      field: 'impact',
    })
  }

  if (
    Number.isFinite(Number(options.existingImpact)) &&
    normalizedImpact === Number(options.existingImpact)
  ) {
    return normalizedImpact
  }

  if (normalizedImpact < maximumPlayerInjuryPenalty) {
    throw new InjuriesError(
      `impact cannot be below the configured Maximum Player Injury Penalty of ${maximumPlayerInjuryPenalty.toFixed(2)}.`,
      400,
      {
        field: 'impact',
        maximumPlayerInjuryPenalty,
      },
    )
  }

  if (!Number.isInteger(normalizedImpact * 2)) {
    throw new InjuriesError('impact must use 0.50-point increments.', 400, {
      field: 'impact',
    })
  }

  return normalizedImpact
}

const normalizeCreatePayload = async (payload = {}, options = {}) => {
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

  const position = normalizePlayerPosition(payload.position)
  const requestedGoalieFlag = toBoolean(
    payload.isGoalie,
    'isGoalie',
    false,
  )
  const isGoalie = position === 'G' || requestedGoalieFlag

  return {
    teamId: team.teamId,
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    playerName,
    providerPlayerId: normalizeProviderPlayerId(payload.providerPlayerId),
    position,
    status: normalizeStatus(payload.status ?? 'out'),
    injuryType: toText(payload.injuryType),
    impact: isGoalie
      ? 0
      : normalizeImpact(
          payload.impact ?? 0,
          options.maximumPlayerInjuryPenalty,
        ),
    durationType: normalizeDurationType(payload.durationType ?? 'unknown'),
    expectedReturn: toText(payload.expectedReturn),
    notes: toText(payload.notes),
    active: toBoolean(payload.active, 'active', true),
    isGoalie,
  }
}

const normalizeUpdatePayload = (payload = {}, options = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new InjuriesError('Request body must be an object.', 400)
  }

  const fields = Object.keys(payload)

  if (fields.length === 0) {
    throw new InjuriesError('At least one injury field is required.', 400)
  }

  assertSupportedFields(payload, UPDATE_FIELDS)

  const updates = fields.reduce((normalizedUpdates, field) => {
    if (field === 'playerName') {
      const playerName = toText(payload.playerName)

      if (!playerName) {
        throw new InjuriesError('playerName is required.', 400, {
          field: 'playerName',
        })
      }

      normalizedUpdates.playerName = playerName
      return normalizedUpdates
    }

    if (field === 'providerPlayerId') {
      normalizedUpdates.providerPlayerId = normalizeProviderPlayerId(
        payload.providerPlayerId,
      )
      return normalizedUpdates
    }

    if (field === 'position') {
      normalizedUpdates.position = normalizePlayerPosition(payload.position)
      return normalizedUpdates
    }

    if (field === 'status') {
      normalizedUpdates.status = normalizeStatus(payload.status)
      return normalizedUpdates
    }

    if (field === 'durationType') {
      normalizedUpdates.durationType = normalizeDurationType(payload.durationType)
      return normalizedUpdates
    }

    if (field === 'impact') {
      return normalizedUpdates
    }

    if (field === 'active' || field === 'isGoalie') {
      if (typeof payload[field] !== 'boolean') {
        throw new InjuriesError(`${field} must be true or false.`, 400, {
          field,
        })
      }

      normalizedUpdates[field] = payload[field]
      return normalizedUpdates
    }

    normalizedUpdates[field] = toText(payload[field])
    return normalizedUpdates
  }, {})

  const existingInjury = options.existingInjury ?? {}
  const position = Object.hasOwn(updates, 'position')
    ? updates.position
    : normalizeStoredPlayerPosition(existingInjury.position)
  const legacyGoalieFlag = Object.hasOwn(updates, 'isGoalie')
    ? updates.isGoalie
    : existingInjury.isGoalie === true
  const isGoalie = position === 'G' || (!position && legacyGoalieFlag)

  updates.isGoalie = isGoalie

  if (isGoalie) {
    updates.impact = 0
  } else if (Object.hasOwn(payload, 'impact')) {
    updates.impact = normalizeImpact(
      payload.impact,
      options.maximumPlayerInjuryPenalty,
      { existingImpact: existingInjury.impact },
    )
  }

  return updates
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

const getInjuryModel = (options = {}) => options.injuryModel ?? Injury

const resolveMaximumPlayerInjuryPenalty = async (userId, options = {}) => {
  if (Number.isFinite(Number(options.maximumPlayerInjuryPenalty))) {
    return Number(options.maximumPlayerInjuryPenalty)
  }

  const settingsProvider = options.settingsProvider ?? getRatingEngineSettings
  const { settings } = await settingsProvider(userId, {
    settingsModel: options.ratingEngineSettingsModel,
  })

  return settings.maximumPlayerInjuryPenalty
}

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildActiveDuplicateQuery = ({
  excludeId,
  playerName,
  providerPlayerId,
  teamId,
  userId,
}) => {
  const query = {
    active: true,
    status: { $ne: 'healthy' },
    teamId,
    userId,
  }

  if (excludeId) {
    query._id = { $ne: excludeId }
  }

  if (providerPlayerId) {
    query.providerPlayerId = providerPlayerId
  } else {
    query.$and = [
      {
        $or: [
          { providerPlayerId: null },
          { providerPlayerId: { $exists: false } },
        ],
      },
      {
        playerName: {
          $regex: `^${escapeRegularExpression(playerName)}$`,
          $options: 'i',
        },
      },
    ]
  }

  return query
}

const assertNoActiveDuplicate = async (
  injuryModel,
  injury,
  { excludeId, userId } = {},
) => {
  if (!injury.active || injury.status === 'healthy') {
    return
  }

  const duplicate = await injuryModel.findOne(
    buildActiveDuplicateQuery({
      excludeId,
      playerName: injury.playerName,
      providerPlayerId: injury.providerPlayerId,
      teamId: injury.teamId,
      userId,
    }),
  )

  if (duplicate) {
    throw new InjuriesError(
      'An active injury record already exists for this player and team. Edit the existing record instead.',
      409,
      {
        existingInjuryId: duplicate.id ?? duplicate._id?.toString(),
        field: 'playerName',
      },
    )
  }
}

const getInjuries = async (userId, options = {}) => {
  const injuries = await getInjuryModel(options).find({ userId }).sort({
    active: -1,
    teamName: 1,
    playerName: 1,
  })

  return injuries.map(serializeInjury)
}

const getTeamInjuries = async (userId, teamId, options = {}) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  if (!normalizedTeamId) {
    throw new InjuriesError('teamId is required.', 400)
  }

  const injuries = await getInjuryModel(options).find({
    teamId: normalizedTeamId,
    userId,
  }).sort({
    active: -1,
    playerName: 1,
  })

  return injuries.map(serializeInjury)
}

const createInjury = async (userId, payload, options = {}) => {
  const injuryModel = getInjuryModel(options)
  const maximumPlayerInjuryPenalty = Object.hasOwn(payload, 'impact')
    ? await resolveMaximumPlayerInjuryPenalty(userId, options)
    : DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.maximumPlayerInjuryPenalty
  const normalizedPayload = await normalizeCreatePayload(payload, {
    maximumPlayerInjuryPenalty,
  })

  await assertNoActiveDuplicate(injuryModel, normalizedPayload, { userId })

  const injury = new injuryModel({
    ...normalizedPayload,
    userId,
  })

  await injury.save()

  return serializeInjury(injury)
}

const updateInjury = async (userId, id, payload, options = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  const injuryModel = getInjuryModel(options)
  const injury = await injuryModel.findOne({
    _id: id,
    userId,
  })

  if (!injury) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  const maximumPlayerInjuryPenalty = Object.hasOwn(payload, 'impact')
    ? await resolveMaximumPlayerInjuryPenalty(userId, options)
    : DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.maximumPlayerInjuryPenalty
  const updates = normalizeUpdatePayload(payload, {
    existingInjury: injury,
    maximumPlayerInjuryPenalty,
  })
  const nextInjury = {
    ...serializeInjury(injury),
    ...updates,
  }

  await assertNoActiveDuplicate(injuryModel, nextInjury, {
    excludeId: injury._id,
    userId,
  })

  Object.assign(injury, updates)
  await injury.save()

  return serializeInjury(injury)
}

const deleteInjury = async (userId, id, options = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  const deletedInjury = await getInjuryModel(options).findOneAndDelete({
    _id: id,
    userId,
  })

  if (!deletedInjury) {
    throw new InjuriesError('Injury was not found.', 404)
  }

  return serializeInjury(deletedInjury)
}

const buildTeamHistoryDeleteQuery = (userId, teamId) => ({
  userId,
  teamId,
  $or: [
    { active: { $ne: true } },
    { status: 'healthy' },
  ],
})

const clearTeamInjuryHistory = async (userId, teamId, options = {}) => {
  const team = await getKnownTeamById(teamId)

  if (!team) {
    throw new InjuriesError('teamId must match a known NHL team.', 400, {
      field: 'teamId',
    })
  }

  const result = await getInjuryModel(options).deleteMany(
    buildTeamHistoryDeleteQuery(userId, team.teamId),
  )

  return {
    deletedCount: Number(result?.deletedCount) || 0,
    teamId: team.teamId,
  }
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
        activeSkaterInjuries: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$isGoalie', true] },
                  { $eq: ['$position', 'G'] },
                ],
              },
              0,
              1,
            ],
          },
        },
        goalieInjuries: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$isGoalie', true] },
                  { $eq: ['$position', 'G'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalImpact: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$isGoalie', true] },
                  { $ne: ['$position', 'G'] },
                  { $lt: ['$impact', 0] },
                ],
              },
              '$impact',
              0,
            ],
          },
        },
        injuries: {
          $push: {
            id: '$_id',
            impact: '$impact',
            isGoalie: '$isGoalie',
            playerName: '$playerName',
            position: '$position',
            providerPlayerId: '$providerPlayerId',
          },
        },
      },
    },
  ]

const serializeSummaryInjury = (injury = {}) => {
  const position = normalizeStoredPlayerPosition(injury.position)
  const isGoalie = isGoalieRecord({ ...injury, position })

  return {
    id: injury.id?.toString?.() ?? '',
    impact: isGoalie ? 0 : Number(injury.impact) || 0,
    isGoalie,
    playerName: toText(injury.playerName, 'Unknown player'),
    position,
    providerPlayerId: normalizeProviderPlayerId(injury.providerPlayerId),
  }
}

const getTeamInjurySummary = async (userId, options = {}) => {
  const teams = await getKnownTeams()
  const summaryRows = await getInjuryModel(options).aggregate(
    buildTeamInjurySummaryPipeline(userId),
  )
  const summaryByTeamId = new Map(
    summaryRows.map((row) => [
      row._id,
      {
        activeInjuries: row.activeInjuries,
        activeSkaterInjuries: row.activeSkaterInjuries,
        goalieInjuries: row.goalieInjuries,
        injuries: (row.injuries ?? []).map(serializeSummaryInjury),
        totalImpact: row.totalImpact,
      },
    ]),
  )

  return teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    activeInjuries: summaryByTeamId.get(team.teamId)?.activeInjuries ?? 0,
    activeSkaterInjuries:
      summaryByTeamId.get(team.teamId)?.activeSkaterInjuries ?? 0,
    goalieInjuries: summaryByTeamId.get(team.teamId)?.goalieInjuries ?? 0,
    injuries: summaryByTeamId.get(team.teamId)?.injuries ?? [],
    totalImpact: summaryByTeamId.get(team.teamId)?.totalImpact ?? 0,
  }))
}

module.exports = {
  InjuriesError,
  buildActiveDuplicateQuery,
  buildTeamHistoryDeleteQuery,
  buildTeamInjurySummaryPipeline,
  clearTeamInjuryHistory,
  createInjury,
  deleteInjury,
  getInjuries,
  getTeamInjuries,
  getTeamInjurySummary,
  normalizeCreatePayload,
  normalizeImpact,
  normalizePlayerPosition,
  normalizeUpdatePayload,
  resolveMaximumPlayerInjuryPenalty,
  serializeSummaryInjury,
  updateInjury,
}
