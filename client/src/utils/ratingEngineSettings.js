import {
  BASE_MODEL_V1,
  DEFAULT_MAXIMUM_GOALIE_PENALTY,
  DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY,
  MAXIMUM_GOALIE_PENALTY_LIMITS,
  MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS,
  PRODUCTION_PROBABILITY_SCALE_LIMITS,
} from '../config/baseModel.js'
import {
  DEFAULT_SPECIAL_TEAMS_SETTINGS,
  SPECIAL_TEAMS_ADJUSTMENT_LIMITS,
  SPECIAL_TEAMS_MODES,
  SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS,
  normalizeSpecialTeamsAdjustment,
  normalizeSpecialTeamsMode,
} from './specialTeamsMatchups.js'

export const DEFAULT_RATING_ENGINE_SETTINGS = Object.freeze({
  kFactor: BASE_MODEL_V1.kFactor,
  homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
  maximumGoaliePenalty: DEFAULT_MAXIMUM_GOALIE_PENALTY,
  maximumPlayerInjuryPenalty: DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY,
  probabilityScale: BASE_MODEL_V1.probabilityScale,
  regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
  overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
  shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  ...DEFAULT_SPECIAL_TEAMS_SETTINGS,
})

export const SPECIAL_TEAMS_MODE_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Off', value: SPECIAL_TEAMS_MODES.OFF }),
  Object.freeze({
    label: 'Alert only',
    value: SPECIAL_TEAMS_MODES.ALERT_ONLY,
  }),
  Object.freeze({
    label: 'Automatic adjustment',
    value: SPECIAL_TEAMS_MODES.AUTOMATIC,
  }),
])

export const SPECIAL_TEAMS_ADJUSTMENT_OPTIONS = Object.freeze([
  0.25,
  0.5,
  0.75,
  1,
])

export const RATING_ENGINE_SETTING_FIELDS = Object.freeze([
  {
    key: 'kFactor',
    label: 'K Factor',
    max: 10,
    min: 0,
    minExclusive: true,
    step: 'any',
  },
  {
    key: 'homeAdvantage',
    label: 'Base Home Advantage',
    max: 15,
    min: 0,
    step: 'any',
  },
  {
    key: 'maximumGoaliePenalty',
    label: 'Maximum Goalie Penalty',
    max: MAXIMUM_GOALIE_PENALTY_LIMITS.max,
    min: MAXIMUM_GOALIE_PENALTY_LIMITS.min,
    step: 'any',
  },
  {
    key: 'maximumPlayerInjuryPenalty',
    label: 'Maximum Player Injury Penalty',
    max: MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS.max,
    min: MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS.min,
    halfPoint: true,
    step: MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS.step,
  },
  {
    key: 'probabilityScale',
    label: 'Probability Scale',
    max: PRODUCTION_PROBABILITY_SCALE_LIMITS.max,
    min: PRODUCTION_PROBABILITY_SCALE_LIMITS.min,
    step: 'any',
  },
  {
    key: 'regulationMultiplier',
    label: 'Regulation Multiplier',
    max: 2,
    min: 0,
    step: 'any',
  },
  {
    key: 'overtimeMultiplier',
    label: 'Overtime Multiplier',
    max: 2,
    min: 0,
    step: 'any',
  },
  {
    key: 'shootoutMultiplier',
    label: 'Shootout Multiplier',
    max: 2,
    min: 0,
    step: 'any',
  },
])

export const RATING_ENGINE_PARAMETER_KEYS = Object.freeze([
  'kFactor',
  'probabilityScale',
  'regulationMultiplier',
  'overtimeMultiplier',
  'shootoutMultiplier',
])

export const createRatingEngineSettingsDraft = (
  settings = DEFAULT_RATING_ENGINE_SETTINGS,
) => {
  const draft = RATING_ENGINE_SETTING_FIELDS.reduce((nextDraft, field) => {
    const sourceValue =
      settings[field.key] ?? DEFAULT_RATING_ENGINE_SETTINGS[field.key]
    const value = Number(sourceValue)

    nextDraft[field.key] =
      field.key === 'probabilityScale'
        ? String(sourceValue)
        : Number.isFinite(value)
          ? value.toFixed(2)
          : ''

    return nextDraft
  }, {})

  draft.specialTeamsMode = normalizeSpecialTeamsMode(
    settings.specialTeamsMode,
    settings.specialTeamsAlertsEnabled,
  )
  draft.specialTeamsAlertsEnabled =
    draft.specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  draft.specialTeamsAdjustment = String(
    normalizeSpecialTeamsAdjustment(settings.specialTeamsAdjustment),
  )
  draft.specialTeamsRankThreshold = String(
    settings.specialTeamsRankThreshold ??
      DEFAULT_RATING_ENGINE_SETTINGS.specialTeamsRankThreshold,
  )

  return draft
}

export const normalizeRatingEngineSettings = (
  settings = DEFAULT_RATING_ENGINE_SETTINGS,
) => {
  const normalizedSettings = RATING_ENGINE_SETTING_FIELDS.reduce(
    (nextSettings, field) => {
      const sourceValue = settings[field.key]
      const value = Number(
        typeof sourceValue === 'string'
          ? sourceValue.trim().replace(',', '.')
          : sourceValue,
      )

      nextSettings[field.key] = Number.isFinite(value)
        ? value
        : DEFAULT_RATING_ENGINE_SETTINGS[field.key]

      return nextSettings
    },
    {},
  )
  const threshold = Number(settings.specialTeamsRankThreshold)

  normalizedSettings.specialTeamsMode = normalizeSpecialTeamsMode(
    settings.specialTeamsMode,
    settings.specialTeamsAlertsEnabled,
  )
  normalizedSettings.specialTeamsAlertsEnabled =
    normalizedSettings.specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  normalizedSettings.specialTeamsAdjustment =
    normalizeSpecialTeamsAdjustment(settings.specialTeamsAdjustment)
  normalizedSettings.specialTeamsRankThreshold =
    Number.isInteger(threshold) &&
    threshold >= SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.min &&
    threshold <= SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.max
      ? threshold
      : DEFAULT_RATING_ENGINE_SETTINGS.specialTeamsRankThreshold

  return normalizedSettings
}

export const parseRatingEngineSettingsDraft = (draft = {}) => {
  const fieldErrors = {}
  const settings = {}

  RATING_ENGINE_SETTING_FIELDS.forEach((field) => {
    const rawValue = draft[field.key]
    const value = Number(
      typeof rawValue === 'string' ? rawValue.trim().replace(',', '.') : rawValue,
    )

    if (rawValue === null || String(rawValue ?? '').trim() === '') {
      fieldErrors[field.key] = `${field.label} is required.`
      return
    }

    if (!Number.isFinite(value)) {
      fieldErrors[field.key] = `${field.label} must be a number.`
      return
    }

    if (field.minExclusive && value <= field.min) {
      fieldErrors[field.key] =
        `${field.label} must be greater than ${field.min}.`
      return
    }

    if (value < field.min || value > field.max) {
      fieldErrors[field.key] =
        `${field.label} must be between ${field.min} and ${field.max}.`
      return
    }

    if (field.halfPoint && !Number.isInteger(value * 2)) {
      fieldErrors[field.key] = `${field.label} must use 0.50-point increments.`
      return
    }

    settings[field.key] = value
  })

  const specialTeamsMode = String(draft.specialTeamsMode ?? '').trim()

  if (!Object.values(SPECIAL_TEAMS_MODES).includes(specialTeamsMode)) {
    fieldErrors.specialTeamsMode = 'Select a Special Teams Matchup mode.'
  } else {
    settings.specialTeamsMode = specialTeamsMode
    settings.specialTeamsAlertsEnabled =
      specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  }

  const specialTeamsAdjustmentRaw = draft.specialTeamsAdjustment
  const specialTeamsAdjustment = Number(specialTeamsAdjustmentRaw)

  if (
    specialTeamsAdjustmentRaw === null ||
    String(specialTeamsAdjustmentRaw ?? '').trim() === ''
  ) {
    fieldErrors.specialTeamsAdjustment =
      'Special Teams Adjustment is required.'
  } else if (
    !Number.isFinite(specialTeamsAdjustment) ||
    specialTeamsAdjustment < SPECIAL_TEAMS_ADJUSTMENT_LIMITS.min ||
    specialTeamsAdjustment > SPECIAL_TEAMS_ADJUSTMENT_LIMITS.max ||
    !Number.isInteger(
      specialTeamsAdjustment / SPECIAL_TEAMS_ADJUSTMENT_LIMITS.step,
    )
  ) {
    fieldErrors.specialTeamsAdjustment =
      'Special Teams Adjustment must be 0.25, 0.50, 0.75, or 1.00.'
  } else {
    settings.specialTeamsAdjustment = specialTeamsAdjustment
  }

  const thresholdRawValue = draft.specialTeamsRankThreshold
  const threshold = Number(thresholdRawValue)

  if (
    thresholdRawValue === null ||
    String(thresholdRawValue ?? '').trim() === ''
  ) {
    fieldErrors.specialTeamsRankThreshold = 'Top / Bottom N is required.'
  } else if (!Number.isInteger(threshold)) {
    fieldErrors.specialTeamsRankThreshold = 'Top / Bottom N must be an integer.'
  } else if (
    threshold < SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.min ||
    threshold > SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.max
  ) {
    fieldErrors.specialTeamsRankThreshold =
      `Top / Bottom N must be between ${SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.min} and ${SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS.max}.`
  } else {
    settings.specialTeamsRankThreshold = threshold
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    settings,
  }
}

export const getRatingEngineDirtyOwnership = (
  draft,
  savedSettings = DEFAULT_RATING_ENGINE_SETTINGS,
) => {
  const parsed = parseRatingEngineSettingsDraft(draft)
  const normalizedSaved = normalizeRatingEngineSettings(savedSettings)

  return {
    modelAdjustments: Boolean(
      parsed.fieldErrors.homeAdvantage ||
        parsed.fieldErrors.maximumGoaliePenalty ||
        parsed.fieldErrors.maximumPlayerInjuryPenalty ||
        parsed.fieldErrors.specialTeamsAdjustment ||
        parsed.fieldErrors.specialTeamsMode ||
        parsed.fieldErrors.specialTeamsRankThreshold ||
        parsed.settings.homeAdvantage !== normalizedSaved.homeAdvantage ||
        parsed.settings.maximumGoaliePenalty !==
          normalizedSaved.maximumGoaliePenalty ||
        parsed.settings.maximumPlayerInjuryPenalty !==
          normalizedSaved.maximumPlayerInjuryPenalty ||
        parsed.settings.specialTeamsAdjustment !==
          normalizedSaved.specialTeamsAdjustment ||
        parsed.settings.specialTeamsMode !==
          normalizedSaved.specialTeamsMode ||
        parsed.settings.specialTeamsRankThreshold !==
          normalizedSaved.specialTeamsRankThreshold,
    ),
    ratingEngine: RATING_ENGINE_PARAMETER_KEYS.some(
      (field) =>
        parsed.fieldErrors[field] ||
        parsed.settings[field] !== normalizedSaved[field],
    ),
  }
}
