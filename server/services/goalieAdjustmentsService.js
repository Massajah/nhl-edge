const GoalieAdjustment = require('../models/GoalieAdjustment')
const LegacyTeamGoalies = require('../models/TeamGoalies')
const nhlApiService = require('./nhlApiService')
const { getKnownTeamById } = require('./teamCatalogService')

const ADJUSTMENT_MIN = -5
const ADJUSTMENT_MAX = 5
const ADJUSTMENT_STEP = 0.05
const NOTE_MAX_LENGTH = 300
const UPDATE_FIELDS = ['activeOverride', 'note', 'ratingAdjustment']

class GoalieAdjustmentsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'GoalieAdjustmentsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const assertUserId = (userId) => {
  if (!userId) {
    throw new GoalieAdjustmentsError('Authenticated userId is required.', 401)
  }
}

const toText = (value) =>
  typeof value === 'string' ? value.trim() : ''

const asPlainObject = (value) =>
  typeof value?.toJSON === 'function' ? value.toJSON() : { ...value }

const normalizeNhlPlayerId = (value) => {
  if (value === '' || value === null || value === undefined) {
    throw new GoalieAdjustmentsError('nhlPlayerId is required.', 400, {
      field: 'nhlPlayerId',
    })
  }

  const playerId = Number(value)

  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    throw new GoalieAdjustmentsError(
      'nhlPlayerId must be a positive integer.',
      400,
      { field: 'nhlPlayerId' },
    )
  }

  return playerId
}

const normalizeAdjustment = (value, field = 'ratingAdjustment') => {
  if (value === '' || value === null || value === undefined) {
    throw new GoalieAdjustmentsError(`${field} is required.`, 400, { field })
  }

  const adjustment = Number(value)

  if (!Number.isFinite(adjustment)) {
    throw new GoalieAdjustmentsError(`${field} must be a finite number.`, 400, {
      field,
    })
  }

  if (adjustment < ADJUSTMENT_MIN || adjustment > ADJUSTMENT_MAX) {
    throw new GoalieAdjustmentsError(
      `${field} must be between ${ADJUSTMENT_MIN} and ${ADJUSTMENT_MAX}.`,
      400,
      { field },
    )
  }

  const stepUnits = adjustment / ADJUSTMENT_STEP

  if (Math.abs(stepUnits - Math.round(stepUnits)) > 1e-8) {
    throw new GoalieAdjustmentsError(
      `${field} must use ${ADJUSTMENT_STEP.toFixed(2)} increments.`,
      400,
      { field },
    )
  }

  return Number(adjustment.toFixed(2))
}

const normalizeStoredAdjustment = (value) => {
  const adjustment = Number(value)

  if (!Number.isFinite(adjustment)) {
    return 0
  }

  const clamped = Math.max(
    ADJUSTMENT_MIN,
    Math.min(ADJUSTMENT_MAX, adjustment),
  )

  return Number(
    (Math.round(clamped / ADJUSTMENT_STEP) * ADJUSTMENT_STEP).toFixed(2),
  )
}

const normalizeNote = (value) => {
  const note = toText(value)

  if (note.length > NOTE_MAX_LENGTH) {
    throw new GoalieAdjustmentsError(
      `note cannot exceed ${NOTE_MAX_LENGTH} characters.`,
      400,
      { field: 'note' },
    )
  }

  return note
}

const normalizeActiveOverride = (value) => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'boolean') {
    throw new GoalieAdjustmentsError(
      'activeOverride must be true, false, or null.',
      400,
      { field: 'activeOverride' },
    )
  }

  return value
}

const normalizeUpdatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new GoalieAdjustmentsError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => !UPDATE_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new GoalieAdjustmentsError(
      'Request body contains unsupported goalie adjustment fields.',
      400,
      { unsupportedFields },
    )
  }

  return {
    activeOverride: normalizeActiveOverride(payload.activeOverride),
    note: normalizeNote(payload.note),
    ratingAdjustment: normalizeAdjustment(payload.ratingAdjustment),
  }
}

const requireKnownTeam = async (teamIdentity) => {
  const team = await getKnownTeamById(teamIdentity)

  if (!team) {
    throw new GoalieAdjustmentsError(
      'teamId must match a known NHL team.',
      400,
      { field: 'teamId' },
    )
  }

  return team
}

const getModels = (options = {}) => ({
  adjustmentModel: options.goalieAdjustmentModel ?? GoalieAdjustment,
  legacyModel: options.legacyTeamGoaliesModel ?? LegacyTeamGoalies,
})

const getRosterProvider = (options = {}) =>
  options.getRosterForTeam ?? nhlApiService.getRosterForTeam

const serializeAdjustment = (adjustment, source = 'saved') => {
  if (!adjustment) {
    return null
  }

  const plainAdjustment = asPlainObject(adjustment)

  return {
    activeOverride:
      typeof plainAdjustment.activeOverride === 'boolean'
        ? plainAdjustment.activeOverride
        : null,
    cachedDisplayName: toText(
      plainAdjustment.cachedDisplayName ?? plainAdjustment.name,
    ),
    createdAt: plainAdjustment.createdAt ?? null,
    nhlPlayerId: normalizeNhlPlayerId(plainAdjustment.nhlPlayerId),
    note: normalizeNote(plainAdjustment.note),
    ratingAdjustment: normalizeStoredAdjustment(
      plainAdjustment.ratingAdjustment,
    ),
    source,
    teamId: toText(plainAdjustment.teamId).toUpperCase(),
    updatedAt: plainAdjustment.updatedAt ?? null,
  }
}

const getLegacyAdjustments = (legacyDocument, teamId) =>
  (Array.isArray(legacyDocument?.goalies) ? legacyDocument.goalies : [])
    .filter((goalie) => {
      const playerId = Number(goalie.nhlPlayerId)
      return Number.isSafeInteger(playerId) && playerId > 0
    })
    .map((goalie) =>
      serializeAdjustment(
        {
          activeOverride:
            typeof goalie.active === 'boolean' ? goalie.active : null,
          cachedDisplayName: goalie.name,
          createdAt: goalie.createdAt,
          nhlPlayerId: goalie.nhlPlayerId,
          note: goalie.note,
          ratingAdjustment: goalie.ratingAdjustment,
          teamId,
          updatedAt: goalie.updatedAt,
        },
        'legacy_normalized',
      ),
    )

const loadAdjustmentState = async (userId, team, options = {}) => {
  const { adjustmentModel, legacyModel } = getModels(options)
  const [savedAdjustments, legacyDocument] = await Promise.all([
    adjustmentModel.find({ teamId: team.teamId, userId }),
    legacyModel.findOne({ teamId: team.teamId, userId }),
  ])
  const saved = (Array.isArray(savedAdjustments) ? savedAdjustments : []).map(
    (adjustment) => serializeAdjustment(adjustment),
  )
  const legacy = getLegacyAdjustments(legacyDocument, team.teamId)
  const adjustmentByPlayerId = new Map()

  legacy.forEach((adjustment) => {
    adjustmentByPlayerId.set(adjustment.nhlPlayerId, adjustment)
  })
  saved.forEach((adjustment) => {
    adjustmentByPlayerId.set(adjustment.nhlPlayerId, adjustment)
  })

  return {
    adjustmentByPlayerId,
    adjustments: [...adjustmentByPlayerId.values()],
    legacyDocument,
  }
}

const normalizeProviderGoalie = (goalie, adjustment = null) => {
  const nhlPlayerId = normalizeNhlPlayerId(goalie.id ?? goalie.playerId)
  const displayName = toText(
    goalie.fullName ?? goalie.playerName ?? adjustment?.cachedDisplayName,
  )

  return {
    ...goalie,
    activeOverride: adjustment?.activeOverride ?? null,
    adjustmentSource: adjustment?.source ?? 'implicit_default',
    displayName,
    hasSavedAdjustment: Boolean(adjustment),
    name: displayName,
    nhlPlayerId,
    note: adjustment?.note ?? '',
    ratingAdjustment: adjustment?.ratingAdjustment ?? 0,
  }
}

const getProviderGoalieAdjustments = async (
  userId,
  teamIdentity,
  options = {},
) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const [state, roster] = await Promise.all([
    loadAdjustmentState(userId, team, options),
    getRosterProvider(options)(team.teamAbbreviation),
  ])
  const providerGoalies = (Array.isArray(roster?.goalies) ? roster.goalies : [])
    .filter((goalie) => {
      const playerId = Number(goalie.id ?? goalie.playerId)
      return Number.isSafeInteger(playerId) && playerId > 0
    })
    .map((goalie) =>
      normalizeProviderGoalie(
        goalie,
        state.adjustmentByPlayerId.get(Number(goalie.id ?? goalie.playerId)),
      ),
    )
  const providerPlayerIds = new Set(
    providerGoalies.map((goalie) => goalie.nhlPlayerId),
  )

  return {
    adjustments: state.adjustments.filter((adjustment) =>
      providerPlayerIds.has(adjustment.nhlPlayerId),
    ),
    goalies: providerGoalies,
    teamAbbreviation: team.teamAbbreviation,
    teamId: team.teamId,
    teamName: team.teamName,
  }
}

const getGoalieAdjustmentForPlayer = async (
  userId,
  teamIdentity,
  nhlPlayerId,
  options = {},
) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const playerId = normalizeNhlPlayerId(nhlPlayerId)
  const state = await loadAdjustmentState(userId, team, options)

  return {
    adjustment: state.adjustmentByPlayerId.get(playerId) ?? null,
    playerId,
    team,
  }
}

const saveGoalieAdjustment = async (
  userId,
  teamIdentity,
  nhlPlayerId,
  payload,
  options = {},
) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const playerId = normalizeNhlPlayerId(nhlPlayerId)
  const updates = normalizeUpdatePayload(payload)
  const roster = await getRosterProvider(options)(team.teamAbbreviation)
  const providerGoalie = (roster?.goalies ?? []).find(
    (goalie) => Number(goalie.id ?? goalie.playerId) === playerId,
  )

  if (!providerGoalie) {
    throw new GoalieAdjustmentsError(
      'Provider goalie was not found on that team.',
      404,
      { field: 'nhlPlayerId' },
    )
  }

  if (
    updates.ratingAdjustment === 0 &&
    !updates.note &&
    updates.activeOverride === null
  ) {
    return deleteGoalieAdjustment(
      userId,
      team.teamId,
      playerId,
      options,
    )
  }

  const { adjustmentModel } = getModels(options)
  const cachedDisplayName = toText(
    providerGoalie.fullName ?? providerGoalie.playerName,
  )
  const document = await adjustmentModel.findOneAndUpdate(
    { nhlPlayerId: playerId, teamId: team.teamId, userId },
    {
      $set: {
        ...updates,
        cachedDisplayName,
      },
      $setOnInsert: {
        nhlPlayerId: playerId,
        teamId: team.teamId,
        userId,
      },
    },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )

  return {
    adjustment: serializeAdjustment(document),
    goalie: normalizeProviderGoalie(providerGoalie, serializeAdjustment(document)),
    success: true,
  }
}

const deleteGoalieAdjustment = async (
  userId,
  teamIdentity,
  nhlPlayerId,
  options = {},
) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const playerId = normalizeNhlPlayerId(nhlPlayerId)
  const { adjustmentModel, legacyModel } = getModels(options)
  const [deletedAdjustment, legacyDocument] = await Promise.all([
    adjustmentModel.findOneAndDelete({
      nhlPlayerId: playerId,
      teamId: team.teamId,
      userId,
    }),
    legacyModel.findOne({ teamId: team.teamId, userId }),
  ])
  let removedLegacy = false

  if (legacyDocument?.goalies) {
    const originalLength = legacyDocument.goalies.length

    legacyDocument.goalies = legacyDocument.goalies.filter(
      (goalie) => Number(goalie.nhlPlayerId) !== playerId,
    )
    removedLegacy = legacyDocument.goalies.length !== originalLength

    if (removedLegacy) {
      await legacyDocument.save()
    }
  }

  return {
    adjustment: null,
    deleted: Boolean(deletedAdjustment || removedLegacy),
    goalie: {
      displayName: '',
      hasSavedAdjustment: false,
      nhlPlayerId: playerId,
      note: '',
      ratingAdjustment: 0,
    },
    success: true,
    teamId: team.teamId,
  }
}

module.exports = {
  ADJUSTMENT_MAX,
  ADJUSTMENT_MIN,
  ADJUSTMENT_STEP,
  GoalieAdjustmentsError,
  deleteGoalieAdjustment,
  getGoalieAdjustmentForPlayer,
  getProviderGoalieAdjustments,
  normalizeAdjustment,
  normalizeNhlPlayerId,
  normalizeProviderGoalie,
  normalizeStoredAdjustment,
  normalizeUpdatePayload,
  saveGoalieAdjustment,
  serializeAdjustment,
}
