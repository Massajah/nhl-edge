const nhlApiService = require('./nhlApiService')
const { getKnownTeamById } = require('./teamCatalogService')
const {
  ADJUSTMENT_MAX,
  ADJUSTMENT_MIN,
  GoalieAdjustmentsError,
  getGoalieAdjustmentForPlayer,
  normalizeAdjustment,
  normalizeNhlPlayerId,
} = require('./goalieAdjustmentsService')

const SELECTION_TYPES = ['custom', 'provider_goalie', 'unknown']
const LEGACY_SELECTION_TYPE = 'team_goalie'
const CONFIRMATION_STATUSES = [
  'confirmed',
  'expected',
  'selected',
  'unknown',
]
const SELECTION_FIELDS = [
  'confirmationStatus',
  'customNote',
  'displayName',
  'effectiveAdjustment',
  'goalieName',
  'manualAdjustment',
  'nhlPlayerId',
  'overrideEnabled',
  'selectionType',
  'source',
  'teamDefaultAdjustment',
  'teamGoalieId',
  'teamId',
]

const toText = (value) =>
  typeof value === 'string' ? value.trim() : ''

const createUnknownGoalieSelection = (teamId = '') => ({
  confirmationStatus: 'unknown',
  customNote: '',
  displayName: '',
  effectiveAdjustment: 0,
  manualAdjustment: null,
  nhlPlayerId: null,
  overrideEnabled: false,
  selectionType: 'unknown',
  source: 'unknown',
  teamDefaultAdjustment: null,
  teamGoalieId: null,
  teamId: toText(teamId).toUpperCase(),
})

const assertPlainSelection = (selection, side) => {
  if (!selection || Array.isArray(selection) || typeof selection !== 'object') {
    throw new GoalieAdjustmentsError(
      `${side} goalie selection must be an object.`,
      400,
      { field: side },
    )
  }

  const unsupportedFields = Object.keys(selection).filter(
    (field) => !SELECTION_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new GoalieAdjustmentsError(
      `${side} goalie selection contains unsupported fields.`,
      400,
      { field: side, unsupportedFields },
    )
  }
}

const normalizeSelectionStatus = (value, selectionType) => {
  if (selectionType === 'unknown') {
    return 'unknown'
  }

  const status = toText(value) || 'selected'

  if (!CONFIRMATION_STATUSES.includes(status)) {
    throw new GoalieAdjustmentsError(
      `confirmationStatus must be one of: ${CONFIRMATION_STATUSES.join(', ')}.`,
      400,
      { field: 'confirmationStatus' },
    )
  }

  return status
}

const normalizeDisplayName = (value) => {
  const displayName = toText(value)

  if (displayName.length > 120) {
    throw new GoalieAdjustmentsError(
      'displayName cannot exceed 120 characters.',
      400,
      { field: 'displayName' },
    )
  }

  return displayName
}

const normalizeCustomNote = (value) => {
  const note = toText(value)

  if (note.length > 300) {
    throw new GoalieAdjustmentsError(
      'customNote cannot exceed 300 characters.',
      400,
      { field: 'customNote' },
    )
  }

  return note
}

const normalizeTeamId = async (value, expectedTeamId = '') => {
  const requestedTeamId = toText(value)
  const expected = toText(expectedTeamId)
  const team = await getKnownTeamById(requestedTeamId || expected)

  if (!team) {
    throw new GoalieAdjustmentsError(
      'teamId must match a known NHL team.',
      400,
      { field: 'teamId' },
    )
  }

  if (expected) {
    const expectedTeam = await getKnownTeamById(expected)

    if (!expectedTeam || expectedTeam.teamId !== team.teamId) {
      throw new GoalieAdjustmentsError(
        'Goalie selection teamId does not match the game team.',
        400,
        { field: 'teamId' },
      )
    }
  }

  return team
}

const getAdjustmentOptions = (options = {}) => ({
  goalieAdjustmentModel: options.goalieAdjustmentModel,
  legacyTeamGoaliesModel: options.legacyTeamGoaliesModel,
})

const normalizeGameGoalieSelection = async (
  userId,
  selection,
  {
    existingSelection = null,
    expectedTeamId = '',
    getRosterForTeam = nhlApiService.getRosterForTeam,
    goalieAdjustmentModel,
    legacyTeamGoaliesModel,
    side = 'team',
  } = {},
) => {
  assertPlainSelection(selection, side)
  const requestedType = toText(selection.selectionType) || 'unknown'
  const selectionType =
    requestedType === LEGACY_SELECTION_TYPE && selection.nhlPlayerId
      ? 'provider_goalie'
      : requestedType === LEGACY_SELECTION_TYPE
        ? 'custom'
        : requestedType

  if (!SELECTION_TYPES.includes(selectionType)) {
    throw new GoalieAdjustmentsError(
      `selectionType must be one of: ${SELECTION_TYPES.join(', ')}.`,
      400,
      { field: `${side}.selectionType` },
    )
  }

  const team = await normalizeTeamId(selection.teamId, expectedTeamId)

  if (selectionType === 'unknown') {
    return createUnknownGoalieSelection(team.teamId)
  }

  const confirmationStatus = normalizeSelectionStatus(
    selection.confirmationStatus,
    selectionType,
  )

  if (selectionType === 'custom') {
    const manualAdjustment = normalizeAdjustment(
      selection.manualAdjustment,
      'manualAdjustment',
    )
    const displayName = normalizeDisplayName(
      selection.displayName ?? selection.goalieName,
    )

    return {
      confirmationStatus,
      customNote: normalizeCustomNote(selection.customNote),
      displayName,
      effectiveAdjustment: manualAdjustment,
      manualAdjustment,
      nhlPlayerId: null,
      overrideEnabled: true,
      selectionType,
      source: 'custom',
      teamDefaultAdjustment: null,
      teamGoalieId: null,
      teamId: team.teamId,
    }
  }

  const playerId = normalizeNhlPlayerId(selection.nhlPlayerId)
  const roster = await getRosterForTeam(team.teamAbbreviation)
  const providerGoalie = (roster?.goalies ?? []).find(
    (goalie) => Number(goalie.id ?? goalie.playerId) === playerId,
  )
  const savedSelection = normalizePersistedGoalieSelection(
    existingSelection,
    team.teamId,
  )
  const canUseSavedProviderSnapshot =
    !providerGoalie &&
    savedSelection.selectionType === 'provider_goalie' &&
    savedSelection.nhlPlayerId === playerId

  if (!providerGoalie && !canUseSavedProviderSnapshot) {
    throw new GoalieAdjustmentsError(
      'Provider goalie was not found on that team.',
      404,
      { field: `${side}.nhlPlayerId` },
    )
  }

  const adjustmentResult = providerGoalie
    ? await getGoalieAdjustmentForPlayer(
        userId,
        team.teamId,
        playerId,
        {
          goalieAdjustmentModel,
          legacyTeamGoaliesModel,
        },
      )
    : null
  const teamDefaultAdjustment = providerGoalie
    ? adjustmentResult.adjustment?.ratingAdjustment ?? 0
    : savedSelection.teamDefaultAdjustment ?? 0
  const overrideEnabled = selection.overrideEnabled === true
  const manualAdjustment = overrideEnabled
    ? normalizeAdjustment(selection.manualAdjustment, 'manualAdjustment')
    : null
  const displayName = providerGoalie
    ? normalizeDisplayName(providerGoalie.fullName ?? providerGoalie.playerName)
    : savedSelection.displayName

  return {
    confirmationStatus,
    customNote: '',
    displayName,
    effectiveAdjustment: overrideEnabled
      ? manualAdjustment
      : teamDefaultAdjustment,
    manualAdjustment,
    nhlPlayerId: playerId,
    overrideEnabled,
    selectionType: 'provider_goalie',
    source: 'provider_goalie',
    teamDefaultAdjustment,
    teamGoalieId: null,
    teamId: team.teamId,
  }
}

const normalizePersistedGoalieSelection = (selection, teamId = '') => {
  if (!selection || typeof selection !== 'object') {
    return createUnknownGoalieSelection(teamId)
  }

  const rawSelectionType = toText(selection.selectionType)
  const rawPlayerId = Number(selection.nhlPlayerId)
  const hasProviderIdentity =
    Number.isSafeInteger(rawPlayerId) && rawPlayerId > 0
  let selectionType = SELECTION_TYPES.includes(rawSelectionType)
    ? rawSelectionType
    : 'unknown'

  if (rawSelectionType === LEGACY_SELECTION_TYPE) {
    selectionType = hasProviderIdentity ? 'provider_goalie' : 'custom'
  }

  if (selectionType === 'provider_goalie' && !hasProviderIdentity) {
    selectionType = 'custom'
  }

  if (selectionType === 'unknown') {
    return createUnknownGoalieSelection(toText(selection.teamId) || teamId)
  }

  const normalizePersistedAdjustment = (value, fallback = null) => {
    if (value === null || value === '' || value === undefined) {
      return fallback
    }

    const adjustment = Number(value)

    if (!Number.isFinite(adjustment)) {
      return fallback
    }

    return Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, adjustment))
  }
  const overrideEnabled =
    selectionType === 'custom' || Boolean(selection.overrideEnabled)
  const selectedAdjustment = overrideEnabled
    ? selection.manualAdjustment ?? selection.effectiveAdjustment
    : selection.teamDefaultAdjustment ?? selection.effectiveAdjustment
  const effectiveAdjustment = normalizePersistedAdjustment(
    selection.effectiveAdjustment,
    normalizePersistedAdjustment(selectedAdjustment, 0),
  )
  const displayName = toText(
    selection.displayName ?? selection.goalieName,
  ).slice(0, 120)

  return {
    confirmationStatus: CONFIRMATION_STATUSES.includes(
      selection.confirmationStatus,
    )
      ? selection.confirmationStatus
      : 'selected',
    customNote:
      selectionType === 'custom'
        ? toText(selection.customNote).slice(0, 300)
        : '',
    displayName,
    effectiveAdjustment,
    manualAdjustment: overrideEnabled
      ? normalizePersistedAdjustment(
          selection.manualAdjustment,
          effectiveAdjustment,
        )
      : null,
    nhlPlayerId:
      selectionType === 'provider_goalie' ? rawPlayerId : null,
    overrideEnabled,
    selectionType,
    source: selectionType,
    teamDefaultAdjustment:
      selectionType === 'provider_goalie'
        ? normalizePersistedAdjustment(
            selection.teamDefaultAdjustment,
            effectiveAdjustment,
          )
        : null,
    teamGoalieId: null,
    teamId: (toText(selection.teamId) || toText(teamId)).toUpperCase(),
  }
}

module.exports = {
  CONFIRMATION_STATUSES,
  SELECTION_TYPES,
  createUnknownGoalieSelection,
  normalizeGameGoalieSelection,
  normalizePersistedGoalieSelection,
}
