const QuickRematchSettings = require('../models/QuickRematchSettings')

const SCHEDULE_ADJUSTMENT_SETTING_FIELDS = Object.freeze([
  'restFatigueEnabled',
  'wellRestedEnabled',
  'wellRestedAdjustment',
  'threeInFourEnabled',
  'threeInFourAdjustment',
  'backToBackEnabled',
  'backToBackAdjustment',
  'backToBackTravelEnabled',
  'backToBackTravelAdjustment',
  'quickRematchEnabled',
  'quickRematchMaximumDays',
  'quickRematchLoserAdjustment',
])
const LEGACY_QUICK_REMATCH_SETTING_FIELDS = Object.freeze([
  'enabled',
  'maxDaysSincePreviousMeeting',
  'loserAdjustment',
  'wellRestedAdjustmentEnabled',
  'backToBackHomeAdjustment',
  'backToBackAwayAdjustment',
  'fourInSixAdjustment',
])
const QUICK_REMATCH_SETTING_FIELDS = Object.freeze([
  ...SCHEDULE_ADJUSTMENT_SETTING_FIELDS,
  ...LEGACY_QUICK_REMATCH_SETTING_FIELDS,
])
const REQUIRED_QUICK_REMATCH_SETTING_FIELDS = Object.freeze([])
const QUICK_REMATCH_SETTINGS_LIMITS = Object.freeze({
  backToBackAdjustment: { max: 0, min: -3 },
  backToBackTravelAdjustment: { max: 0, min: -3 },
  quickRematchLoserAdjustment: { max: 1, min: 0 },
  quickRematchMaximumDays: { max: 14, min: 1 },
  threeInFourAdjustment: { max: 0, min: -3 },
  wellRestedAdjustment: { max: 1, min: 0 },
})
const QUICK_REMATCH_ADJUSTMENT_STEP = 0.05
const DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS = Object.freeze({
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
const LEGACY_FIELD_UNSET = Object.freeze(
  LEGACY_QUICK_REMATCH_SETTING_FIELDS.reduce(
    (unsetFields, field) => ({
      ...unsetFields,
      [field]: '',
    }),
    {},
  ),
)

class QuickRematchSettingsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'QuickRematchSettingsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const buildDefaultQuickRematchSettings = () => ({
  ...DEFAULT_QUICK_REMATCH_SETTINGS,
})

const getSettingsModel = (options = {}) =>
  options.settingsModel ?? QuickRematchSettings

const roundToStep = (value, step = QUICK_REMATCH_ADJUSTMENT_STEP) =>
  Number((Math.round(value / step) * step).toFixed(2))

const withLegacyQuickRematchAliases = (settings) => ({
  ...settings,
  enabled: settings.quickRematchEnabled,
  loserAdjustment: settings.quickRematchLoserAdjustment,
  maxDaysSincePreviousMeeting: settings.quickRematchMaximumDays,
  wellRestedAdjustmentEnabled: settings.wellRestedEnabled,
})

const DEFAULT_QUICK_REMATCH_SETTINGS = Object.freeze(
  withLegacyQuickRematchAliases(DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS),
)

const hasExplicitSettingValue = (settings, field) => {
  if (!settings) {
    return false
  }

  if (
    typeof settings.$isDefault === 'function' &&
    settings.$isDefault(field)
  ) {
    return false
  }

  return (
    settings[field] !== null &&
    settings[field] !== undefined &&
    settings[field] !== ''
  )
}

const getFirstExplicitValue = (settings, fields) => {
  const field = fields.find((candidateField) =>
    hasExplicitSettingValue(settings, candidateField),
  )

  return field ? settings[field] : undefined
}

const coerceBooleanSetting = (settings, fields, fallback) => {
  const value = getFirstExplicitValue(settings, fields)

  return typeof value === 'boolean' ? value : fallback
}

const coerceNumberSetting = (settings, fields, fallback) => {
  const value = getFirstExplicitValue(settings, fields)
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const normalizeScheduleAdjustmentSettings = (
  settings = buildDefaultQuickRematchSettings(),
) =>
  withLegacyQuickRematchAliases({
    backToBackAdjustment: coerceNumberSetting(
      settings,
      [
        'backToBackAdjustment',
        'backToBackHomeAdjustment',
        'backToBackAwayAdjustment',
      ],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackAdjustment,
    ),
    backToBackEnabled: coerceBooleanSetting(
      settings,
      ['backToBackEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackEnabled,
    ),
    backToBackTravelAdjustment: coerceNumberSetting(
      settings,
      ['backToBackTravelAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackTravelAdjustment,
    ),
    backToBackTravelEnabled: coerceBooleanSetting(
      settings,
      ['backToBackTravelEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackTravelEnabled,
    ),
    quickRematchEnabled: coerceBooleanSetting(
      settings,
      ['quickRematchEnabled', 'enabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchEnabled,
    ),
    quickRematchLoserAdjustment: coerceNumberSetting(
      settings,
      ['quickRematchLoserAdjustment', 'loserAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchLoserAdjustment,
    ),
    quickRematchMaximumDays: coerceNumberSetting(
      settings,
      ['quickRematchMaximumDays', 'maxDaysSincePreviousMeeting'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchMaximumDays,
    ),
    restFatigueEnabled: coerceBooleanSetting(
      settings,
      ['restFatigueEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.restFatigueEnabled,
    ),
    threeInFourAdjustment: coerceNumberSetting(
      settings,
      ['threeInFourAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.threeInFourAdjustment,
    ),
    threeInFourEnabled: coerceBooleanSetting(
      settings,
      ['threeInFourEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.threeInFourEnabled,
    ),
    wellRestedAdjustment: coerceNumberSetting(
      settings,
      ['wellRestedAdjustment'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.wellRestedAdjustment,
    ),
    wellRestedEnabled: coerceBooleanSetting(
      settings,
      ['wellRestedEnabled', 'wellRestedAdjustmentEnabled'],
      DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.wellRestedEnabled,
    ),
  })

const serializeQuickRematchSettings = normalizeScheduleAdjustmentSettings

const normalizeSettingsDocument = (document) =>
  serializeQuickRematchSettings(document ?? buildDefaultQuickRematchSettings())

const getPayloadValue = (payload, fields) => {
  const field = fields.find((candidateField) =>
    Object.hasOwn(payload, candidateField),
  )

  return {
    field,
    value: field ? payload[field] : undefined,
  }
}

const getPayloadValueForSetting = (payload, settingKey) => {
  if (settingKey === 'quickRematchEnabled') {
    return getPayloadValue(payload, ['quickRematchEnabled', 'enabled'])
  }

  if (settingKey === 'quickRematchMaximumDays') {
    return getPayloadValue(payload, [
      'quickRematchMaximumDays',
      'maxDaysSincePreviousMeeting',
    ])
  }

  if (settingKey === 'quickRematchLoserAdjustment') {
    return getPayloadValue(payload, [
      'quickRematchLoserAdjustment',
      'loserAdjustment',
    ])
  }

  if (settingKey === 'wellRestedEnabled') {
    return getPayloadValue(payload, [
      'wellRestedEnabled',
      'wellRestedAdjustmentEnabled',
    ])
  }

  if (settingKey === 'backToBackAdjustment') {
    return getPayloadValue(payload, [
      'backToBackAdjustment',
      'backToBackHomeAdjustment',
      'backToBackAwayAdjustment',
    ])
  }

  return getPayloadValue(payload, [settingKey])
}

const requireBooleanSetting = ({ fieldErrors, payload, settingKey, settings }) => {
  const { field, value } = getPayloadValueForSetting(payload, settingKey)

  if (!field) {
    return
  }

  if (typeof value !== 'boolean') {
    fieldErrors[settingKey] = `${settingKey} must be true or false.`
    return
  }

  settings[settingKey] = value
}

const requireNumberSetting = ({
  fieldErrors,
  integer = false,
  payload,
  settingKey,
  settings,
}) => {
  const { field, value } = getPayloadValueForSetting(payload, settingKey)

  if (!field) {
    return
  }

  const numberValue = Number(value)
  const limits = QUICK_REMATCH_SETTINGS_LIMITS[settingKey]

  if (
    !Number.isFinite(numberValue) ||
    numberValue < limits.min ||
    numberValue > limits.max ||
    (integer && !Number.isInteger(numberValue))
  ) {
    const rangeDescription = integer
      ? `an integer from ${limits.min} to ${limits.max}`
      : `at least ${limits.min} and no more than ${limits.max}`

    fieldErrors[settingKey] = `${settingKey} must be ${rangeDescription}.`
    return
  }

  settings[settingKey] = integer ? numberValue : roundToStep(numberValue)
}

const normalizeSettingsPayload = (payload = {}, options = {}) => {
  if (!isPlainObject(payload)) {
    throw new QuickRematchSettingsError('Request body must be an object.', 400)
  }

  const payloadFields = Object.keys(payload)
  const unsupportedFields = payloadFields.filter(
    (field) => !QUICK_REMATCH_SETTING_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new QuickRematchSettingsError(
      'Request body contains unsupported quick rematch settings fields.',
      400,
      { unsupportedFields },
    )
  }

  const normalizedSettings = normalizeScheduleAdjustmentSettings(
    options.baseSettings ?? buildDefaultQuickRematchSettings(),
  )
  const fieldErrors = {}
  const booleanSettings = [
    'backToBackEnabled',
    'backToBackTravelEnabled',
    'quickRematchEnabled',
    'restFatigueEnabled',
    'threeInFourEnabled',
    'wellRestedEnabled',
  ]
  const numberSettings = [
    'backToBackAdjustment',
    'backToBackTravelAdjustment',
    'quickRematchLoserAdjustment',
    'threeInFourAdjustment',
    'wellRestedAdjustment',
  ]

  booleanSettings.forEach((settingKey) => {
    requireBooleanSetting({
      fieldErrors,
      payload,
      settingKey,
      settings: normalizedSettings,
    })
  })

  numberSettings.forEach((settingKey) => {
    requireNumberSetting({
      fieldErrors,
      payload,
      settingKey,
      settings: normalizedSettings,
    })
  })

  requireNumberSetting({
    fieldErrors,
    integer: true,
    payload,
    settingKey: 'quickRematchMaximumDays',
    settings: normalizedSettings,
  })

  if (Object.keys(fieldErrors).length > 0) {
    throw new QuickRematchSettingsError(
      'Quick rematch settings validation failed.',
      400,
      { fieldErrors },
    )
  }

  return normalizeScheduleAdjustmentSettings(normalizedSettings)
}

const getPersistedScheduleAdjustmentSettings = (settings = {}) =>
  SCHEDULE_ADJUSTMENT_SETTING_FIELDS.reduce((persistedSettings, field) => {
    persistedSettings[field] = settings[field]

    return persistedSettings
  }, {})

const getQuickRematchSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new QuickRematchSettingsError(
      'Authenticated userId is required.',
      401,
    )
  }

  const settingsModel = getSettingsModel(options)
  const settingsDocument = await settingsModel.findOne({ userId })

  return {
    settings: normalizeSettingsDocument(settingsDocument),
    usingDefaults: !settingsDocument,
  }
}

const updateQuickRematchSettings = async (
  userId,
  payload = {},
  options = {},
) => {
  if (!userId) {
    throw new QuickRematchSettingsError(
      'Authenticated userId is required.',
      401,
    )
  }

  const settingsModel = getSettingsModel(options)
  const existingSettingsDocument = await settingsModel.findOne({ userId })
  const normalizedSettings = normalizeSettingsPayload(payload, {
    baseSettings: existingSettingsDocument ?? buildDefaultQuickRematchSettings(),
  })
  const settingsDocument = await settingsModel.findOneAndUpdate(
    { userId },
    {
      $set: getPersistedScheduleAdjustmentSettings(normalizedSettings),
      $unset: LEGACY_FIELD_UNSET,
      $setOnInsert: { userId },
    },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )

  return {
    settings: normalizeSettingsDocument(settingsDocument),
    success: true,
  }
}

const resetQuickRematchSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new QuickRematchSettingsError(
      'Authenticated userId is required.',
      401,
    )
  }

  const settingsModel = getSettingsModel(options)

  await settingsModel.deleteOne({ userId })

  return {
    settings: buildDefaultQuickRematchSettings(),
    success: true,
    usingDefaults: true,
  }
}

module.exports = {
  DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS,
  DEFAULT_QUICK_REMATCH_SETTINGS,
  LEGACY_QUICK_REMATCH_SETTING_FIELDS,
  QUICK_REMATCH_ADJUSTMENT_STEP,
  REQUIRED_QUICK_REMATCH_SETTING_FIELDS,
  QUICK_REMATCH_SETTING_FIELDS,
  QUICK_REMATCH_SETTINGS_LIMITS,
  SCHEDULE_ADJUSTMENT_SETTING_FIELDS,
  QuickRematchSettingsError,
  buildDefaultQuickRematchSettings,
  getQuickRematchSettings,
  normalizeScheduleAdjustmentSettings,
  normalizeSettingsPayload,
  resetQuickRematchSettings,
  updateQuickRematchSettings,
}
