export const DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS = Object.freeze({
  backToBackAdjustment: -0.75,
  backToBackEnabled: true,
  backToBackTravelAdjustment: -1.25,
  backToBackTravelEnabled: true,
  quickRematchEnabled: true,
  quickRematchLoserAdjustment: 0.25,
  quickRematchMaximumDays: 5,
  restFatigueEnabled: true,
  threeInFourAdjustment: -0.5,
  threeInFourEnabled: true,
  wellRestedAdjustment: 0.25,
  wellRestedEnabled: false,
})
export const SCHEDULE_ADJUSTMENT_SETTING_KEYS = Object.freeze(
  Object.keys(DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS),
)

const SCHEDULE_ADJUSTMENT_NUMBER_FIELDS = Object.freeze({
  backToBackAdjustment: {
    label: 'Back-to-Back',
    max: 0,
    min: -3,
  },
  backToBackTravelAdjustment: {
    label: 'Back-to-Back + Travel',
    max: 0,
    min: -3,
  },
  quickRematchLoserAdjustment: {
    label: 'Previous Loser Adjustment',
    max: 1,
    min: 0,
  },
  quickRematchMaximumDays: {
    integer: true,
    label: 'Maximum Days',
    max: 14,
    min: 1,
  },
  threeInFourAdjustment: {
    label: '3 Games in 4 Days',
    max: 0,
    min: -3,
  },
  wellRestedAdjustment: {
    label: 'Well Rested',
    max: 1,
    min: 0,
  },
})

const SCHEDULE_ADJUSTMENT_BOOLEAN_FIELDS = Object.freeze([
  'backToBackEnabled',
  'backToBackTravelEnabled',
  'quickRematchEnabled',
  'restFatigueEnabled',
  'threeInFourEnabled',
  'wellRestedEnabled',
])

const withLegacyAliases = (settings) => ({
  ...settings,
  enabled: settings.quickRematchEnabled,
  loserAdjustment: settings.quickRematchLoserAdjustment,
  maxDaysSincePreviousMeeting: settings.quickRematchMaximumDays,
  wellRestedAdjustmentEnabled: settings.wellRestedEnabled,
})

export const DEFAULT_QUICK_REMATCH_SETTINGS = Object.freeze(
  withLegacyAliases(DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS),
)

const toNumber = (value, fallback = 0) => {
  if (value === null || value === '' || value === undefined) {
    return fallback
  }

  const numberValue = Number(
    typeof value === 'string' ? value.trim().replace(',', '.') : value,
  )

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const roundToStep = (value, step = 0.05) =>
  Number((Math.round(value / step) * step).toFixed(2))

const getFirstValue = (settings, fields, fallback) => {
  const field = fields.find(
    (candidateField) =>
      settings[candidateField] !== null &&
      settings[candidateField] !== '' &&
      settings[candidateField] !== undefined,
  )

  return field ? settings[field] : fallback
}

const normalizeBoolean = (settings, fields, fallback) => {
  const value = getFirstValue(settings, fields, fallback)

  return typeof value === 'boolean' ? value : fallback
}

const normalizeNumber = (settings, fields, fallback, min, max) =>
  clamp(roundToStep(toNumber(getFirstValue(settings, fields, fallback))), min, max)

export const normalizeQuickRematchSettings = (settings = {}) => {
  const sourceSettings =
    settings !== null && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {}

  return withLegacyAliases({
    backToBackAdjustment: normalizeNumber(
      sourceSettings,
      [
        'backToBackAdjustment',
        'backToBackHomeAdjustment',
        'backToBackAwayAdjustment',
      ],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackAdjustment,
      -3,
      0,
    ),
    backToBackEnabled: normalizeBoolean(
      sourceSettings,
      ['backToBackEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackEnabled,
    ),
    backToBackTravelAdjustment: normalizeNumber(
      sourceSettings,
      ['backToBackTravelAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackTravelAdjustment,
      -3,
      0,
    ),
    backToBackTravelEnabled: normalizeBoolean(
      sourceSettings,
      ['backToBackTravelEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackTravelEnabled,
    ),
    quickRematchEnabled: normalizeBoolean(
      sourceSettings,
      ['quickRematchEnabled', 'enabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchEnabled,
    ),
    quickRematchLoserAdjustment: normalizeNumber(
      sourceSettings,
      ['quickRematchLoserAdjustment', 'loserAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchLoserAdjustment,
      0,
      1,
    ),
    quickRematchMaximumDays: clamp(
      Math.round(
        toNumber(
          getFirstValue(
            sourceSettings,
            ['quickRematchMaximumDays', 'maxDaysSincePreviousMeeting'],
            DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchMaximumDays,
          ),
        ),
      ),
      1,
      14,
    ),
    restFatigueEnabled: normalizeBoolean(
      sourceSettings,
      ['restFatigueEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.restFatigueEnabled,
    ),
    threeInFourAdjustment: normalizeNumber(
      sourceSettings,
      ['threeInFourAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.threeInFourAdjustment,
      -3,
      0,
    ),
    threeInFourEnabled: normalizeBoolean(
      sourceSettings,
      ['threeInFourEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.threeInFourEnabled,
    ),
    wellRestedAdjustment: normalizeNumber(
      sourceSettings,
      ['wellRestedAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.wellRestedAdjustment,
      0,
      1,
    ),
    wellRestedEnabled: normalizeBoolean(
      sourceSettings,
      ['wellRestedEnabled', 'wellRestedAdjustmentEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.wellRestedEnabled,
    ),
  })
}

export const createQuickRematchSettingsDraft = (settings = {}) => {
  const normalizedSettings = normalizeQuickRematchSettings(settings)

  return {
    backToBackAdjustment: String(normalizedSettings.backToBackAdjustment),
    backToBackEnabled: normalizedSettings.backToBackEnabled,
    backToBackTravelAdjustment: String(
      normalizedSettings.backToBackTravelAdjustment,
    ),
    backToBackTravelEnabled: normalizedSettings.backToBackTravelEnabled,
    enabled: normalizedSettings.quickRematchEnabled,
    loserAdjustment: String(normalizedSettings.quickRematchLoserAdjustment),
    maxDaysSincePreviousMeeting: String(
      normalizedSettings.quickRematchMaximumDays,
    ),
    quickRematchEnabled: normalizedSettings.quickRematchEnabled,
    quickRematchLoserAdjustment: String(
      normalizedSettings.quickRematchLoserAdjustment,
    ),
    quickRematchMaximumDays: String(normalizedSettings.quickRematchMaximumDays),
    restFatigueEnabled: normalizedSettings.restFatigueEnabled,
    threeInFourAdjustment: String(normalizedSettings.threeInFourAdjustment),
    threeInFourEnabled: normalizedSettings.threeInFourEnabled,
    wellRestedAdjustment: String(normalizedSettings.wellRestedAdjustment),
    wellRestedAdjustmentEnabled: normalizedSettings.wellRestedEnabled,
    wellRestedEnabled: normalizedSettings.wellRestedEnabled,
  }
}

const parseDraftNumber = (value) => {
  if (value === null || String(value ?? '').trim() === '') {
    return {
      isEmpty: true,
      value: null,
    }
  }

  const numberValue = Number(
    typeof value === 'string' ? value.trim().replace(',', '.') : value,
  )

  return {
    isEmpty: false,
    value: Number.isFinite(numberValue) ? numberValue : null,
  }
}

const validateDraftNumber = ({ fieldErrors, key, value }) => {
  const definition = SCHEDULE_ADJUSTMENT_NUMBER_FIELDS[key]
  const parsedValue = parseDraftNumber(value)

  if (parsedValue.isEmpty) {
    fieldErrors[key] = `${definition.label} is required.`
    return DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS[key]
  }

  if (parsedValue.value === null) {
    fieldErrors[key] = `${definition.label} must be a finite number.`
    return DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS[key]
  }

  if (definition.integer && !Number.isInteger(parsedValue.value)) {
    fieldErrors[key] =
      `${definition.label} must be an integer from ${definition.min} to ${definition.max}.`
    return DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS[key]
  }

  if (parsedValue.value < definition.min || parsedValue.value > definition.max) {
    fieldErrors[key] =
      `${definition.label} must be between ${definition.min} and ${definition.max}.`
    return DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS[key]
  }

  return definition.integer
    ? parsedValue.value
    : roundToStep(parsedValue.value)
}

export const parseQuickRematchSettingsDraft = (draft = {}) => {
  const fieldErrors = {}
  const parsedSettings = {}

  SCHEDULE_ADJUSTMENT_BOOLEAN_FIELDS.forEach((key) => {
    parsedSettings[key] =
      typeof draft[key] === 'boolean'
        ? draft[key]
        : DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS[key]
  })

  if (
    typeof draft.quickRematchEnabled !== 'boolean' &&
    typeof draft.enabled === 'boolean'
  ) {
    parsedSettings.quickRematchEnabled = draft.enabled
  }

  if (
    typeof draft.wellRestedEnabled !== 'boolean' &&
    typeof draft.wellRestedAdjustmentEnabled === 'boolean'
  ) {
    parsedSettings.wellRestedEnabled = draft.wellRestedAdjustmentEnabled
  }

  Object.keys(SCHEDULE_ADJUSTMENT_NUMBER_FIELDS).forEach((key) => {
    const legacyValue =
      key === 'quickRematchLoserAdjustment'
        ? draft.loserAdjustment
        : key === 'quickRematchMaximumDays'
          ? draft.maxDaysSincePreviousMeeting
          : undefined
    const value = draft[key] ?? legacyValue

    parsedSettings[key] = validateDraftNumber({
      fieldErrors,
      key,
      value,
    })
  })

  const settings = normalizeQuickRematchSettings(parsedSettings)

  return {
    ...withLegacyAliases(settings),
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    settings,
  }
}
