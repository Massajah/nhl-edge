export const GOALIE_SELECTION_TYPES = Object.freeze({
  CUSTOM: 'custom',
  PROVIDER: 'provider_goalie',
  UNKNOWN: 'unknown',
})

export const GOALIE_CONFIRMATION_STATUSES = Object.freeze({
  CONFIRMED: 'confirmed',
  EXPECTED: 'expected',
  SELECTED: 'selected',
  UNKNOWN: 'unknown',
})

const toText = (value, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

const toNullableNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const toPositiveIntegerOrNull = (value) => {
  const numberValue = toNullableNumber(value)

  return Number.isSafeInteger(numberValue) && numberValue > 0
    ? numberValue
    : null
}

const clampAdjustment = (value) => {
  const numberValue = toNullableNumber(value)

  return numberValue === null
    ? null
    : Math.max(-5, Math.min(5, numberValue))
}

export const createUnknownGoalieSelection = (teamId = '') => ({
  confirmationStatus: GOALIE_CONFIRMATION_STATUSES.UNKNOWN,
  customNote: '',
  displayName: '',
  effectiveAdjustment: 0,
  goalieName: '',
  manualAdjustment: null,
  nhlPlayerId: null,
  overrideEnabled: false,
  selectionType: GOALIE_SELECTION_TYPES.UNKNOWN,
  source: 'unknown',
  teamDefaultAdjustment: null,
  teamGoalieId: null,
  teamId: toText(teamId).toUpperCase(),
})

export const normalizeProviderGoalie = (goalie = {}) => {
  const nhlPlayerId = toPositiveIntegerOrNull(
    goalie.nhlPlayerId ?? goalie.playerId ?? goalie.id,
  )
  const displayName = toText(
    goalie.displayName ?? goalie.fullName ?? goalie.playerName ?? goalie.name,
    'Unnamed goalie',
  )

  return {
    ...goalie,
    activeOverride:
      typeof goalie.activeOverride === 'boolean' ? goalie.activeOverride : null,
    adjustmentSource: toText(
      goalie.adjustmentSource,
      goalie.hasSavedAdjustment ? 'saved' : 'implicit_default',
    ),
    displayName,
    hasSavedAdjustment: goalie.hasSavedAdjustment === true,
    name: displayName,
    nhlPlayerId,
    note: toText(goalie.note),
    ratingAdjustment: clampAdjustment(goalie.ratingAdjustment) ?? 0,
  }
}

export const normalizeProviderGoalies = (goalies = []) =>
  (Array.isArray(goalies) ? goalies : [])
    .map(normalizeProviderGoalie)
    .filter((goalie) => goalie.nhlPlayerId !== null)

export const mergeProviderGoaliesWithAdjustments = (
  providerGoalies = [],
  adjustments = [],
) => {
  const adjustmentByPlayerId = new Map(
    (Array.isArray(adjustments) ? adjustments : [])
      .map((adjustment) => [
        toPositiveIntegerOrNull(adjustment.nhlPlayerId),
        adjustment,
      ])
      .filter(([playerId]) => playerId !== null),
  )

  return normalizeProviderGoalies(providerGoalies).map((goalie) => {
    const adjustment = adjustmentByPlayerId.get(goalie.nhlPlayerId)

    return adjustment
      ? normalizeProviderGoalie({
          ...goalie,
          activeOverride: adjustment.activeOverride,
          adjustmentSource: adjustment.source ?? 'saved',
          hasSavedAdjustment: true,
          note: adjustment.note,
          ratingAdjustment: adjustment.ratingAdjustment,
        })
      : goalie
  })
}

export const normalizeGoalieSelection = (selection = {}, teamId = '') => {
  const rawSelectionType = selection?.selectionType
  const nhlPlayerId = toPositiveIntegerOrNull(selection?.nhlPlayerId)
  let selectionType = Object.values(GOALIE_SELECTION_TYPES).includes(
    rawSelectionType,
  )
    ? rawSelectionType
    : GOALIE_SELECTION_TYPES.UNKNOWN

  if (rawSelectionType === 'team_goalie') {
    selectionType = nhlPlayerId
      ? GOALIE_SELECTION_TYPES.PROVIDER
      : GOALIE_SELECTION_TYPES.CUSTOM
  }

  if (
    selectionType === GOALIE_SELECTION_TYPES.PROVIDER &&
    nhlPlayerId === null
  ) {
    selectionType = GOALIE_SELECTION_TYPES.CUSTOM
  }

  const normalizedTeamId = toText(selection?.teamId, teamId).toUpperCase()

  if (selectionType === GOALIE_SELECTION_TYPES.UNKNOWN) {
    return createUnknownGoalieSelection(normalizedTeamId)
  }

  const effectiveAdjustment = clampAdjustment(selection.effectiveAdjustment) ?? 0
  const isCustom = selectionType === GOALIE_SELECTION_TYPES.CUSTOM
  const displayName = toText(selection.displayName ?? selection.goalieName)
  const confirmationStatus = Object.values(
    GOALIE_CONFIRMATION_STATUSES,
  ).includes(selection.confirmationStatus)
    ? selection.confirmationStatus
    : GOALIE_CONFIRMATION_STATUSES.SELECTED

  return {
    confirmationStatus,
    customNote: isCustom ? toText(selection.customNote) : '',
    displayName,
    effectiveAdjustment,
    goalieName: displayName,
    manualAdjustment: isCustom || selection.overrideEnabled
      ? clampAdjustment(selection.manualAdjustment) ?? effectiveAdjustment
      : null,
    nhlPlayerId: isCustom ? null : nhlPlayerId,
    overrideEnabled: isCustom || Boolean(selection.overrideEnabled),
    selectionType,
    source: selectionType,
    teamDefaultAdjustment: isCustom
      ? null
      : clampAdjustment(selection.teamDefaultAdjustment) ?? effectiveAdjustment,
    teamGoalieId: null,
    teamId: normalizedTeamId,
  }
}

export const getGoalieSelectionForSide = (gameContext, side, teamId = '') =>
  normalizeGoalieSelection(gameContext?.goalieSelections?.[side], teamId)

export const createProviderGoalieSelection = (goalie, teamId) => {
  const normalizedGoalie = normalizeProviderGoalie(goalie)

  if (normalizedGoalie.nhlPlayerId === null) {
    return createUnknownGoalieSelection(teamId)
  }

  return normalizeGoalieSelection(
    {
      confirmationStatus: GOALIE_CONFIRMATION_STATUSES.SELECTED,
      displayName: normalizedGoalie.displayName,
      effectiveAdjustment: normalizedGoalie.ratingAdjustment,
      nhlPlayerId: normalizedGoalie.nhlPlayerId,
      overrideEnabled: false,
      selectionType: GOALIE_SELECTION_TYPES.PROVIDER,
      source: 'provider_goalie',
      teamDefaultAdjustment: normalizedGoalie.ratingAdjustment,
      teamId,
    },
    teamId,
  )
}

export const createCustomGoalieSelection = (teamId) => ({
  ...createUnknownGoalieSelection(teamId),
  confirmationStatus: GOALIE_CONFIRMATION_STATUSES.SELECTED,
  effectiveAdjustment: 0,
  manualAdjustment: '',
  overrideEnabled: true,
  selectionType: GOALIE_SELECTION_TYPES.CUSTOM,
  source: 'custom',
})

export const goalieSelectionToInputFields = (selection) => {
  const normalized = normalizeGoalieSelection(selection, selection?.teamId)

  return {
    goalieAdjustment: normalized.effectiveAdjustment,
    goalieConfirmationStatus: normalized.confirmationStatus,
    goalieCustomNote: normalized.customNote,
    goalieManualAdjustment: normalized.manualAdjustment,
    goalieNhlPlayerId: normalized.nhlPlayerId,
    goalieOverrideEnabled: normalized.overrideEnabled,
    goalieSelectionType: normalized.selectionType,
    goalieSource: normalized.source,
    goalieTeamDefaultAdjustment: normalized.teamDefaultAdjustment,
    goalieTeamId: normalized.teamId,
    selectedGoalieId:
      normalized.nhlPlayerId === null ? '' : String(normalized.nhlPlayerId),
    selectedGoalieName: normalized.displayName,
    teamGoalieId: '',
  }
}

export const applyGameGoalieSelectionsToInputs = (
  inputs,
  gameContext,
  teams = {},
) => ({
  ...inputs,
  away: {
    ...inputs.away,
    ...goalieSelectionToInputFields(
      getGoalieSelectionForSide(gameContext, 'away', teams.away),
    ),
  },
  home: {
    ...inputs.home,
    ...goalieSelectionToInputFields(
      getGoalieSelectionForSide(gameContext, 'home', teams.home),
    ),
  },
})

export const getGoalieSelectionFromInputs = (inputs = {}, teamId = '') => {
  const hasNewSelection = Object.values(GOALIE_SELECTION_TYPES).includes(
    inputs.goalieSelectionType,
  )

  if (!hasNewSelection) {
    const legacyAdjustment = clampAdjustment(inputs.goalieAdjustment) ?? 0
    const legacyPlayerId = toPositiveIntegerOrNull(
      inputs.goalieNhlPlayerId ?? inputs.selectedGoalieId,
    )
    const hasLegacyGoalie = Boolean(
      legacyPlayerId ||
        toText(inputs.selectedGoalieName) ||
        Math.abs(legacyAdjustment) >= 0.005,
    )

    if (!hasLegacyGoalie) {
      return createUnknownGoalieSelection(teamId)
    }

    return normalizeGoalieSelection(
      {
        confirmationStatus: GOALIE_CONFIRMATION_STATUSES.UNKNOWN,
        displayName: toText(inputs.selectedGoalieName),
        effectiveAdjustment: legacyAdjustment,
        manualAdjustment: legacyPlayerId ? null : legacyAdjustment,
        nhlPlayerId: legacyPlayerId,
        overrideEnabled: !legacyPlayerId,
        selectionType: legacyPlayerId
          ? GOALIE_SELECTION_TYPES.PROVIDER
          : GOALIE_SELECTION_TYPES.CUSTOM,
        teamDefaultAdjustment: legacyPlayerId ? legacyAdjustment : null,
        teamId,
      },
      teamId,
    )
  }

  return normalizeGoalieSelection(
    {
      confirmationStatus: inputs.goalieConfirmationStatus,
      customNote: inputs.goalieCustomNote,
      displayName: inputs.selectedGoalieName,
      effectiveAdjustment: inputs.goalieAdjustment,
      manualAdjustment: inputs.goalieManualAdjustment,
      nhlPlayerId: inputs.goalieNhlPlayerId,
      overrideEnabled: inputs.goalieOverrideEnabled,
      selectionType: inputs.goalieSelectionType,
      source: inputs.goalieSource,
      teamDefaultAdjustment: inputs.goalieTeamDefaultAdjustment,
      teamId: inputs.goalieTeamId || teamId,
    },
    teamId,
  )
}

export const createGoalieSelectionPayload = (inputs = {}, teamId = '') => {
  const selection = getGoalieSelectionFromInputs(inputs, teamId)

  return {
    confirmationStatus: selection.confirmationStatus,
    customNote: selection.customNote,
    displayName: selection.displayName,
    effectiveAdjustment: selection.effectiveAdjustment,
    manualAdjustment: selection.manualAdjustment,
    nhlPlayerId: selection.nhlPlayerId,
    overrideEnabled: selection.overrideEnabled,
    selectionType: selection.selectionType,
    source: selection.source,
    teamDefaultAdjustment: selection.teamDefaultAdjustment,
    teamGoalieId: null,
    teamId: selection.teamId,
  }
}

export const validateGoalieSelectionInputs = (inputs = {}) => {
  const selectionType = inputs.goalieSelectionType ?? 'unknown'
  const needsManualAdjustment =
    selectionType === GOALIE_SELECTION_TYPES.CUSTOM ||
    (selectionType === GOALIE_SELECTION_TYPES.PROVIDER &&
      inputs.goalieOverrideEnabled)

  if (!needsManualAdjustment) {
    return ''
  }

  const adjustment = toNullableNumber(inputs.goalieManualAdjustment)

  if (adjustment === null) {
    return 'Game-specific goalie adjustment is required.'
  }

  if (adjustment < -5 || adjustment > 5) {
    return 'Goalie adjustment must be between -5.00 and +5.00.'
  }

  const stepUnits = adjustment / 0.05

  if (Math.abs(stepUnits - Math.round(stepUnits)) > 1e-8) {
    return 'Goalie adjustment must use 0.05 increments.'
  }

  return ''
}

export const updateGoalieInputs = (inputs, field, value, goalies = []) => {
  const teamId = inputs.goalieTeamId ?? ''

  if (field === 'selection') {
    if (value === GOALIE_SELECTION_TYPES.UNKNOWN) {
      return {
        ...inputs,
        ...goalieSelectionToInputFields(
          createUnknownGoalieSelection(teamId),
        ),
      }
    }

    if (value === GOALIE_SELECTION_TYPES.CUSTOM) {
      return {
        ...inputs,
        ...goalieSelectionToInputFields(createCustomGoalieSelection(teamId)),
        goalieManualAdjustment: '',
      }
    }

    const playerId = toPositiveIntegerOrNull(
      String(value).replace(/^provider:/, ''),
    )
    const goalie = normalizeProviderGoalies(goalies).find(
      (candidate) => candidate.nhlPlayerId === playerId,
    )

    return goalie
      ? {
          ...inputs,
          ...goalieSelectionToInputFields(
            createProviderGoalieSelection(goalie, teamId),
          ),
        }
      : inputs
  }

  if (field === 'useTeamDefault') {
    const useTeamDefault = Boolean(value)
    const defaultAdjustment = inputs.goalieTeamDefaultAdjustment ?? 0

    return {
      ...inputs,
      goalieAdjustment: useTeamDefault
        ? defaultAdjustment
        : toNullableNumber(inputs.goalieManualAdjustment) ?? defaultAdjustment,
      goalieManualAdjustment: useTeamDefault
        ? null
        : (inputs.goalieManualAdjustment ?? defaultAdjustment),
      goalieOverrideEnabled: !useTeamDefault,
    }
  }

  if (field === 'manualAdjustment') {
    const adjustment = toNullableNumber(value)

    return {
      ...inputs,
      goalieAdjustment: adjustment ?? 0,
      goalieManualAdjustment: value,
      goalieOverrideEnabled: true,
    }
  }

  if (field === 'resetToTeamDefault') {
    return {
      ...inputs,
      goalieAdjustment: inputs.goalieTeamDefaultAdjustment ?? 0,
      goalieManualAdjustment: null,
      goalieOverrideEnabled: false,
    }
  }

  const inputFieldBySelectionField = {
    customNote: 'goalieCustomNote',
    goalieName: 'selectedGoalieName',
  }
  const inputField = inputFieldBySelectionField[field]

  return inputField ? { ...inputs, [inputField]: value } : inputs
}

export const getGoalieSelectionSourceLabel = (inputs = {}) => {
  if (inputs.goalieSelectionType === GOALIE_SELECTION_TYPES.PROVIDER) {
    return inputs.goalieOverrideEnabled
      ? 'Provider goalie · Game-specific override'
      : 'Provider goalie'
  }

  return inputs.goalieSelectionType === GOALIE_SELECTION_TYPES.CUSTOM
    ? 'Custom goalie · This game only'
    : 'Unknown starter'
}

export const formatGoalieSelectionSnapshot = (
  selection = null,
  fallbackName = '',
) => {
  if (!selection?.selectionType) {
    return toText(fallbackName)
  }

  const normalized = normalizeGoalieSelection(selection)
  const goalieName =
    normalized.selectionType === GOALIE_SELECTION_TYPES.UNKNOWN
      ? 'Unknown starter'
      : normalized.displayName ||
        toText(fallbackName, 'Other / Unlisted goalie')
  const sourceLabel =
    normalized.selectionType === GOALIE_SELECTION_TYPES.PROVIDER
      ? 'Provider goalie'
      : normalized.selectionType === GOALIE_SELECTION_TYPES.CUSTOM
        ? 'Custom goalie'
        : 'No goalie selected'
  const statusLabel =
    normalized.confirmationStatus === GOALIE_CONFIRMATION_STATUSES.CONFIRMED
      ? 'Confirmed'
      : normalized.confirmationStatus === GOALIE_CONFIRMATION_STATUSES.EXPECTED
        ? 'Expected'
        : normalized.confirmationStatus ===
            GOALIE_CONFIRMATION_STATUSES.SELECTED
          ? 'Selected'
          : 'Unconfirmed'

  return `${goalieName} · ${sourceLabel} · ${statusLabel}`
}
