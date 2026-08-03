const toNumber = (value, fallback = 0) => {
  if (value === null || value === '' || value === undefined) {
    return fallback
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const toNullableNumber = (value) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const toText = (value, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeTeam = (team = {}) => ({
  abbreviation: toText(team.abbreviation, ''),
  name: toText(team.name, toText(team.abbreviation, 'Team')),
  teamId: toText(team.teamId, toText(team.abbreviation, '')),
})

const REST_FATIGUE_CONDITION_LABELS = Object.freeze({
  '3_games_in_4_days': '3 Games in 4 Days',
  '4_games_in_6_days': '4 Games in 6 Days',
  backToBack: 'Back-to-Back',
  backToBackAway: 'Back-to-Back',
  backToBackHome: 'Back-to-Back',
  backToBackTravel: 'Back-to-Back + Travel',
  back_to_back: 'Back-to-Back',
  back_to_back_away: 'Back-to-Back',
  back_to_back_home: 'Back-to-Back',
  back_to_back_travel: 'Back-to-Back + Travel',
  fourInSix: '4 Games in 6 Days',
  four_in_six: '4 Games in 6 Days',
  heavyFatigue: 'Heavy Fatigue',
  heavy_fatigue: 'Heavy Fatigue',
  heavySchedule: 'Heavy Fatigue',
  heavy_schedule: 'Heavy Fatigue',
  normal: 'Normal',
  threeInFour: '3 Games in 4 Days',
  three_in_four: '3 Games in 4 Days',
  wellRested: 'Well Rested',
  well_rested: 'Well Rested',
})
const QUICK_REMATCH_CONDITIONS = new Set(['quickRematch', 'quick_rematch'])
const REMOVED_APPLIED_REST_CONDITIONS = new Set([
  '4_games_in_6_days',
  'fourInSix',
  'four_in_six',
  'heavyFatigue',
  'heavySchedule',
  'heavy_fatigue',
  'heavy_schedule',
  'normal',
])

const normalizeRestFatigueCondition = (condition) => {
  const normalizedCondition = toText(condition, 'normal')

  if (['backToBackAway', 'backToBackHome'].includes(normalizedCondition)) {
    return 'back_to_back'
  }

  if (['backToBackTravel', 'back_to_back_travel'].includes(normalizedCondition)) {
    return 'back_to_back_travel'
  }

  if (['backToBack', 'back_to_back'].includes(normalizedCondition)) {
    return 'back_to_back'
  }

  if (['threeInFour', 'three_in_four'].includes(normalizedCondition)) {
    return '3_games_in_4_days'
  }

  if (['wellRested', 'well_rested'].includes(normalizedCondition)) {
    return 'well_rested'
  }

  if (['fourInSix', 'four_in_six'].includes(normalizedCondition)) {
    return '4_games_in_6_days'
  }

  return normalizedCondition
}

const normalizeAdjustmentCategory = (item) => {
  const category = toText(item.category, '')
  const condition = toText(item.condition, '')

  if (category === 'quickRematch' || QUICK_REMATCH_CONDITIONS.has(condition)) {
    return 'quickRematch'
  }

  return 'restFatigue'
}

const shouldKeepAdjustmentBreakdownItem = (item) =>
  item.category !== 'restFatigue' ||
  !REMOVED_APPLIED_REST_CONDITIONS.has(item.condition)

const sumAdjustmentBreakdown = (adjustmentBreakdown, category) =>
  Number(
    adjustmentBreakdown
      .filter((item) => item.category === category)
      .reduce((total, item) => total + item.adjustment, 0)
      .toFixed(2),
  )

const hasNonZeroAdjustment = (value) => Math.abs(toNumber(value)) >= 0.005

const humanizeCondition = (condition) =>
  toText(condition, 'normal')
    .replace(/^(\d+)_games_in_(\d+)_days$/, '$1 Games in $2 Days')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const formatRestFatigueConditionLabel = (condition) => {
  const normalizedCondition = normalizeRestFatigueCondition(condition)

  return (
    REST_FATIGUE_CONDITION_LABELS[normalizedCondition] ??
    humanizeCondition(normalizedCondition)
  )
}

export const DEFAULT_TEAM_GAME_CONTEXT = Object.freeze({
  adjustmentBreakdown: [],
  automaticQuickRematchAdjustment: 0,
  automaticRestFatigueAdjustment: 0,
  conditions: [],
  dataStatus: 'unavailable',
  effectiveQuickRematchAdjustment: 0,
  effectiveRestFatigueAdjustment: 0,
  gamesInFourDays: 0,
  gamesInSixDays: 0,
  backToBack: false,
  currentHomeTeamId: null,
  currentTeamSide: null,
  currentVenueCity: null,
  hasMeaningfulTravel: false,
  isBackToBack: false,
  manualQuickRematchAdjustment: 0,
  manualRestFatigueAdjustment: 0,
  previousHomeTeamId: null,
  previousTeamSide: null,
  previousVenueCity: null,
  quickRematch: {
    eligible: false,
    hoursSincePreviousMeeting: null,
    previousGameDate: null,
    previousGameId: '',
    previousLoserAbbreviation: '',
    previousOpponentAbbreviation: '',
    previousOpponentName: '',
    previousWinnerAbbreviation: '',
    reason: '',
  },
  quickRematchOverrideEnabled: false,
  reasons: [],
  restDays: null,
  restFatigueCondition: 'normal',
  restFatigueOverrideEnabled: false,
  sameAwayHomeTeam: null,
  team: {
    abbreviation: '',
    name: 'Team',
    teamId: '',
  },
  totalGameContextAdjustment: 0,
  travelBetweenGames: null,
  travelClassificationSource: '',
})

export const normalizeTeamGameContext = (context = {}, fallbackTeam = {}) => {
  const normalizedContext = isPlainObject(context) ? context : {}
  const adjustmentBreakdown = Array.isArray(
    normalizedContext.adjustmentBreakdown,
  )
    ? normalizedContext.adjustmentBreakdown
        .filter((item) => isPlainObject(item))
        .map((item) => ({
          adjustment: toNumber(item.adjustment),
          category: normalizeAdjustmentCategory(item),
          condition:
            normalizeAdjustmentCategory(item) === 'quickRematch'
              ? 'quick_rematch'
              : normalizeRestFatigueCondition(item.condition),
        }))
        .filter(shouldKeepAdjustmentBreakdownItem)
        .filter((item) => item.condition)
    : []
  const automaticRestFatigueAdjustment = toNumber(
    sumAdjustmentBreakdown(adjustmentBreakdown, 'restFatigue'),
  )
  const automaticQuickRematchAdjustment = toNumber(
    sumAdjustmentBreakdown(adjustmentBreakdown, 'quickRematch'),
  )
  const manualRestFatigueAdjustment = toNumber(
    normalizedContext.manualRestFatigueAdjustment,
  )
  const manualQuickRematchAdjustment = toNumber(
    normalizedContext.manualQuickRematchAdjustment,
  )
  const restFatigueOverrideEnabled = Boolean(
    normalizedContext.restFatigueOverrideEnabled,
  )
  const quickRematchOverrideEnabled = Boolean(
    normalizedContext.quickRematchOverrideEnabled,
  )
  const effectiveRestFatigueAdjustment = restFatigueOverrideEnabled
    ? manualRestFatigueAdjustment
    : automaticRestFatigueAdjustment
  const effectiveQuickRematchAdjustment = quickRematchOverrideEnabled
    ? manualQuickRematchAdjustment
    : automaticQuickRematchAdjustment
  const quickRematch = isPlainObject(normalizedContext.quickRematch)
    ? normalizedContext.quickRematch
    : {}
  const normalizedRestFatigueCondition = normalizeRestFatigueCondition(
    normalizedContext.restFatigueCondition,
  )

  return {
    adjustmentBreakdown,
    automaticQuickRematchAdjustment,
    automaticRestFatigueAdjustment,
    conditions: Array.isArray(normalizedContext.conditions)
      ? normalizedContext.conditions
          .map(normalizeRestFatigueCondition)
          .filter(Boolean)
      : [],
    dataStatus: toText(normalizedContext.dataStatus, 'unavailable'),
    effectiveQuickRematchAdjustment,
    effectiveRestFatigueAdjustment,
    gamesInFourDays: toNumber(normalizedContext.gamesInFourDays),
    gamesInSixDays: toNumber(normalizedContext.gamesInSixDays),
    backToBack: Boolean(
      normalizedContext.backToBack ?? normalizedContext.isBackToBack,
    ),
    currentHomeTeamId: toText(normalizedContext.currentHomeTeamId, '') || null,
    currentTeamSide: toText(normalizedContext.currentTeamSide, '') || null,
    currentVenueCity: normalizedContext.currentVenueCity ?? null,
    hasMeaningfulTravel: Boolean(normalizedContext.hasMeaningfulTravel),
    isBackToBack: Boolean(normalizedContext.isBackToBack),
    manualQuickRematchAdjustment,
    manualRestFatigueAdjustment,
    previousHomeTeamId:
      toText(normalizedContext.previousHomeTeamId, '') || null,
    previousTeamSide: toText(normalizedContext.previousTeamSide, '') || null,
    previousVenueCity: normalizedContext.previousVenueCity ?? null,
    quickRematch: {
      eligible: Boolean(quickRematch.eligible),
      hoursSincePreviousMeeting: toNullableNumber(
        quickRematch.hoursSincePreviousMeeting,
      ),
      previousGameDate: quickRematch.previousGameDate ?? null,
      previousGameId: toText(quickRematch.previousGameId, ''),
      previousLoserAbbreviation: toText(
        quickRematch.previousLoserAbbreviation,
        '',
      ),
      previousOpponentAbbreviation: toText(
        quickRematch.previousOpponentAbbreviation,
        '',
      ),
      previousOpponentName: toText(quickRematch.previousOpponentName, ''),
      previousWinnerAbbreviation: toText(
        quickRematch.previousWinnerAbbreviation,
        '',
      ),
      reason: toText(quickRematch.reason, ''),
    },
    quickRematchOverrideEnabled,
    reasons: Array.isArray(normalizedContext.reasons)
      ? normalizedContext.reasons.filter(Boolean)
      : [],
    restDays: toNullableNumber(normalizedContext.restDays),
    restFatigueCondition: normalizedRestFatigueCondition,
    restFatigueOverrideEnabled,
    sameAwayHomeTeam:
      typeof normalizedContext.sameAwayHomeTeam === 'boolean'
        ? normalizedContext.sameAwayHomeTeam
        : null,
    team: normalizeTeam(normalizedContext.team ?? fallbackTeam),
    totalGameContextAdjustment: toNumber(
      effectiveRestFatigueAdjustment + effectiveQuickRematchAdjustment,
    ),
    travelBetweenGames:
      typeof normalizedContext.travelBetweenGames === 'boolean'
        ? normalizedContext.travelBetweenGames
        : null,
    travelClassificationSource: toText(
      normalizedContext.travelClassificationSource,
      '',
    ),
  }
}

export const normalizeGameContext = (context = null) => {
  if (!isPlainObject(context)) {
    return null
  }

  return {
    awayContext: normalizeTeamGameContext(
      context.awayContext,
      context.awayTeam,
    ),
    awayTeam: normalizeTeam(context.awayTeam),
    gameId: toText(context.gameId, ''),
    gameState: toText(context.gameState, ''),
    homeContext: normalizeTeamGameContext(
      context.homeContext,
      context.homeTeam,
    ),
    homeTeam: normalizeTeam(context.homeTeam),
    lastCalculatedAt: context.lastCalculatedAt ?? null,
    scheduledStart: context.scheduledStart ?? null,
    sourceVersion: toText(context.sourceVersion, ''),
    status: toText(context.status, ''),
  }
}

export const getGameContextForSide = (gameContext, side) => {
  const normalizedContext = normalizeGameContext(gameContext)

  if (!normalizedContext) {
    return {
      ...DEFAULT_TEAM_GAME_CONTEXT,
      team: {
        ...DEFAULT_TEAM_GAME_CONTEXT.team,
      },
    }
  }

  return side === 'away'
    ? normalizedContext.awayContext
    : normalizedContext.homeContext
}

export const getTeamGameContextAdjustmentPreview = (
  context,
  draft = {},
) => {
  const normalizedContext = normalizeTeamGameContext(context)
  const restFatigueOverrideEnabled = Boolean(
    draft.restFatigueOverrideEnabled ??
      normalizedContext.restFatigueOverrideEnabled,
  )
  const quickRematchOverrideEnabled = Boolean(
    draft.quickRematchOverrideEnabled ??
      normalizedContext.quickRematchOverrideEnabled,
  )
  const manualRestFatigueAdjustment = toNumber(
    draft.manualRestFatigueAdjustment,
    normalizedContext.manualRestFatigueAdjustment,
  )
  const manualQuickRematchAdjustment = toNumber(
    draft.manualQuickRematchAdjustment,
    normalizedContext.manualQuickRematchAdjustment,
  )
  const effectiveRestFatigueAdjustment = restFatigueOverrideEnabled
    ? manualRestFatigueAdjustment
    : normalizedContext.automaticRestFatigueAdjustment
  const effectiveQuickRematchAdjustment = quickRematchOverrideEnabled
    ? manualQuickRematchAdjustment
    : normalizedContext.automaticQuickRematchAdjustment

  return {
    automaticQuickRematchAdjustment:
      normalizedContext.automaticQuickRematchAdjustment,
    automaticRestFatigueAdjustment:
      normalizedContext.automaticRestFatigueAdjustment,
    effectiveQuickRematchAdjustment,
    effectiveRestFatigueAdjustment,
    manualQuickRematchAdjustment,
    manualRestFatigueAdjustment,
    quickRematchOverrideEnabled,
    restFatigueOverrideEnabled,
    totalGameContextAdjustment: Number(
      (
        effectiveRestFatigueAdjustment + effectiveQuickRematchAdjustment
      ).toFixed(2),
    ),
  }
}

export const getTeamGameContextPresentation = (context, draft = {}) => {
  const normalizedContext = normalizeTeamGameContext(context)
  const preview = getTeamGameContextAdjustmentPreview(
    normalizedContext,
    draft,
  )
  const automaticRestAdjustments = normalizedContext.adjustmentBreakdown.filter(
    (item) =>
      item.category === 'restFatigue' &&
      hasNonZeroAdjustment(item.adjustment),
  )
  const automaticQuickRematchAdjustments =
    normalizedContext.adjustmentBreakdown.filter(
      (item) =>
        item.category === 'quickRematch' &&
        hasNonZeroAdjustment(item.adjustment),
    )
  const detectedConditions = [
    ...(normalizedContext.conditions.length > 0
      ? normalizedContext.conditions
      : [normalizedContext.restFatigueCondition]),
  ]
    .filter((condition) => condition && condition !== 'normal')
    .filter((condition, index, conditions) => conditions.indexOf(condition) === index)
  const detectedFacts = detectedConditions.map((condition) => {
    const isInformational = condition === '4_games_in_6_days'
    const isDisabledWellRested =
      condition === 'well_rested' && automaticRestAdjustments.length === 0

    return {
      condition,
      key: condition,
      label: formatRestFatigueConditionLabel(condition),
      note: isInformational
        ? 'informational'
        : isDisabledWellRested
          ? 'adjustment disabled'
          : '',
    }
  })

  if (normalizedContext.quickRematch.eligible) {
    detectedFacts.push({
      condition: 'quick_rematch',
      key: 'quick_rematch',
      label: 'Quick Rematch eligible',
      note:
        automaticQuickRematchAdjustments.length === 0 &&
        !preview.quickRematchOverrideEnabled
          ? 'adjustment disabled'
          : '',
    })
  }

  const appliedAdjustments = []

  if (preview.restFatigueOverrideEnabled) {
    appliedAdjustments.push({
      adjustment: preview.effectiveRestFatigueAdjustment,
      category: 'restFatigueOverride',
      condition: 'manual_rest_fatigue_override',
      key: 'manual_rest_fatigue_override',
      label: 'Manual Rest/Fatigue override',
    })
  } else {
    automaticRestAdjustments.forEach((item) => {
      appliedAdjustments.push({
        ...item,
        key: `rest-${item.condition}`,
        label: formatRestFatigueConditionLabel(item.condition),
      })
    })
  }

  if (preview.quickRematchOverrideEnabled) {
    appliedAdjustments.push({
      adjustment: preview.effectiveQuickRematchAdjustment,
      category: 'quickRematchOverride',
      condition: 'manual_quick_rematch_override',
      key: 'manual_quick_rematch_override',
      label: 'Manual Quick Rematch override',
    })
  } else {
    automaticQuickRematchAdjustments.forEach((item) => {
      appliedAdjustments.push({
        ...item,
        key: 'quick-rematch',
        label: 'Quick Rematch',
      })
    })
  }

  return {
    appliedAdjustments,
    detectedFacts,
    hasActiveOverride:
      preview.restFatigueOverrideEnabled ||
      preview.quickRematchOverrideEnabled,
    preview,
  }
}

const COMPACT_REST_FATIGUE_LABELS = Object.freeze({
  '3_games_in_4_days': '3-in-4',
  back_to_back: 'B2B',
  back_to_back_travel: 'B2B + Travel',
  well_rested: 'Well Rested',
})

export const getCompactGameContextAdjustmentLabel = (context) => {
  const presentation = getTeamGameContextPresentation(context)
  const restAdjustment = presentation.appliedAdjustments.find((item) =>
    ['restFatigue', 'restFatigueOverride'].includes(item.category),
  )
  const quickRematchAdjustment = presentation.appliedAdjustments.find((item) =>
    ['quickRematch', 'quickRematchOverride'].includes(item.category),
  )
  const labels = []

  if (restAdjustment) {
    labels.push(
      restAdjustment.category === 'restFatigueOverride'
        ? 'Manual Rest'
        : COMPACT_REST_FATIGUE_LABELS[restAdjustment.condition] ??
            restAdjustment.label,
    )
  }

  if (quickRematchAdjustment) {
    labels.push(
      quickRematchAdjustment.category === 'quickRematchOverride'
        ? 'Manual Rematch'
        : 'Quick Rematch',
    )
  }

  return labels.join(' + ')
}

export const applyGameContextToInputs = (inputs, gameContext) => {
  if (!gameContext) {
    return inputs
  }

  const awayContext = getGameContextForSide(gameContext, 'away')
  const homeContext = getGameContextForSide(gameContext, 'home')

  return {
    away: {
      ...inputs.away,
      quickRematchAdjustment: awayContext.effectiveQuickRematchAdjustment,
      restFatigue: awayContext.effectiveRestFatigueAdjustment,
    },
    home: {
      ...inputs.home,
      quickRematchAdjustment: homeContext.effectiveQuickRematchAdjustment,
      restFatigue: homeContext.effectiveRestFatigueAdjustment,
    },
  }
}

export const applyGameContextDraftToInputs = (
  inputs,
  gameContext,
  draft = {},
) => {
  if (!gameContext) {
    return inputs
  }

  const awayContext = getGameContextForSide(gameContext, 'away')
  const homeContext = getGameContextForSide(gameContext, 'home')
  const awayPreview = getTeamGameContextAdjustmentPreview(
    awayContext,
    draft.awayContext,
  )
  const homePreview = getTeamGameContextAdjustmentPreview(
    homeContext,
    draft.homeContext,
  )

  return {
    away: {
      ...inputs.away,
      quickRematchAdjustment: awayPreview.effectiveQuickRematchAdjustment,
      restFatigue: awayPreview.effectiveRestFatigueAdjustment,
    },
    home: {
      ...inputs.home,
      quickRematchAdjustment: homePreview.effectiveQuickRematchAdjustment,
      restFatigue: homePreview.effectiveRestFatigueAdjustment,
    },
  }
}

export const createGameContextSnapshot = (gameContext) => {
  const normalizedContext = normalizeGameContext(gameContext)

  if (!normalizedContext) {
    return null
  }

  return JSON.parse(JSON.stringify(normalizedContext))
}

export const formatSignedGameContextAdjustment = (value) => {
  const numberValue = toNumber(value)

  return `${numberValue >= 0 ? '+' : ''}${numberValue.toFixed(2)}`
}

export const hasNonZeroGameContextAdjustment = (context) =>
  hasNonZeroAdjustment(context?.totalGameContextAdjustment)
