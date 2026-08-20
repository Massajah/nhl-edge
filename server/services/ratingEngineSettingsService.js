const {
  DEFAULT_RATING_ENGINE_CONFIGURATION,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const {
  BASE_MODEL_V1,
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  MAXIMUM_GOALIE_PENALTY_LIMITS,
  MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS,
  PRODUCTION_PROBABILITY_SCALE_LIMITS,
  SPECIAL_TEAMS_ADJUSTMENT_LIMITS,
  SPECIAL_TEAMS_MODES,
} = require('../config/baseModel')

const DEFAULT_PRODUCTION_HOME_ADVANTAGE = BASE_MODEL_V1.baseHomeAdvantage

const RATING_ENGINE_SETTING_FIELDS = Object.freeze([
  'kFactor',
  'homeAdvantage',
  'maximumGoaliePenalty',
  'maximumPlayerInjuryPenalty',
  'probabilityScale',
  'regulationMultiplier',
  'overtimeMultiplier',
  'shootoutMultiplier',
  'specialTeamsAdjustment',
  'specialTeamsAlertsEnabled',
  'specialTeamsMode',
  'specialTeamsRankThreshold',
])
const OPTIONAL_LEGACY_SETTING_FIELDS = Object.freeze([
  'probabilityScale',
  'maximumGoaliePenalty',
  'maximumPlayerInjuryPenalty',
  'specialTeamsAdjustment',
  'specialTeamsAlertsEnabled',
  'specialTeamsMode',
  'specialTeamsRankThreshold',
])
const RATING_ENGINE_SETTINGS_LIMITS = Object.freeze({
  kFactor: { max: 10, min: 0, minExclusive: true },
  homeAdvantage: { max: 15, min: 0 },
  maximumGoaliePenalty: MAXIMUM_GOALIE_PENALTY_LIMITS,
  maximumPlayerInjuryPenalty: {
    ...MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS,
    halfPoint: true,
  },
  probabilityScale: PRODUCTION_PROBABILITY_SCALE_LIMITS,
  regulationMultiplier: { max: 2, min: 0 },
  overtimeMultiplier: { max: 2, min: 0 },
  shootoutMultiplier: { max: 2, min: 0 },
  specialTeamsAdjustment: {
    increment: SPECIAL_TEAMS_ADJUSTMENT_LIMITS.step,
    max: SPECIAL_TEAMS_ADJUSTMENT_LIMITS.max,
    min: SPECIAL_TEAMS_ADJUSTMENT_LIMITS.min,
  },
  specialTeamsRankThreshold: { integer: true, max: 12, min: 3 },
})
const RATING_ENGINE_RESET_SCOPES = Object.freeze({
  ALL: 'all',
  ENGINE: 'engine',
  MODEL_ADJUSTMENTS: 'model-adjustments',
})
const ENGINE_RESET_FIELDS = Object.freeze([
  'kFactor',
  'probabilityScale',
  'regulationMultiplier',
  'overtimeMultiplier',
  'shootoutMultiplier',
])
const MODEL_ADJUSTMENT_FIELDS = Object.freeze([
  'homeAdvantage',
  'maximumGoaliePenalty',
  'maximumPlayerInjuryPenalty',
  'specialTeamsAdjustment',
  'specialTeamsAlertsEnabled',
  'specialTeamsMode',
  'specialTeamsRankThreshold',
])
const DEFAULT_RATING_ENGINE_MODEL_VERSION =
  DEFAULT_RATING_ENGINE_CONFIGURATION.modelVersion

class RatingEngineSettingsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'RatingEngineSettingsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const buildDefaultSettings = () => ({
  ...DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
})

const getNormalizedSpecialTeamsMode = (settings = {}) => {
  const modeWasSchemaDefaulted =
    typeof settings?.$isDefault === 'function' &&
    settings.$isDefault('specialTeamsMode')
  const mode = String(
    modeWasSchemaDefaulted ? '' : settings.specialTeamsMode ?? '',
  )
    .trim()
    .toLowerCase()

  if (Object.values(SPECIAL_TEAMS_MODES).includes(mode)) {
    return mode
  }

  return settings.specialTeamsAlertsEnabled === false
    ? SPECIAL_TEAMS_MODES.OFF
    : SPECIAL_TEAMS_MODES.ALERT_ONLY
}

const getNormalizedPersistedValue = (
  settings,
  field,
  specialTeamsMode = getNormalizedSpecialTeamsMode(settings),
) => {
  const rawValue = settings?.[field]

  if (field === 'specialTeamsAlertsEnabled') {
    return specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  }

  if (field === 'specialTeamsMode') {
    return specialTeamsMode
  }

  const value = Number(rawValue)
  const limits = RATING_ENGINE_SETTINGS_LIMITS[field]
  const belowMinimum = limits.minExclusive
    ? value <= limits.min
    : value < limits.min

  return rawValue !== null &&
    rawValue !== '' &&
    Number.isFinite(value) &&
    (!limits.integer || Number.isInteger(value)) &&
    (!limits.halfPoint || Number.isInteger(value * 2)) &&
    (!limits.increment || Number.isInteger(value / limits.increment)) &&
    !belowMinimum &&
    value <= limits.max
    ? value
    : DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS[field]
}

const serializeRatingEngineSettings = (settings) => {
  const specialTeamsMode = getNormalizedSpecialTeamsMode(settings)

  return RATING_ENGINE_SETTING_FIELDS.reduce(
    (serialized, field) => ({
      ...serialized,
      [field]: getNormalizedPersistedValue(
        settings,
        field,
        specialTeamsMode,
      ),
    }),
    {},
  )
}

const serializeProductionRatingEngineSettings = (settings) => ({
  modelVersion: DEFAULT_RATING_ENGINE_MODEL_VERSION,
  ...serializeRatingEngineSettings(settings),
})

const getSettingsModel = (options = {}) =>
  options.settingsModel ?? RatingEngineSettings

const normalizeSettingsDocument = (document) =>
  serializeRatingEngineSettings(document ?? buildDefaultSettings())

const settingsUseAllDefaults = (settings) =>
  RATING_ENGINE_SETTING_FIELDS.every(
    (field) =>
      settings[field] === DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS[field],
  )

const getRatingEngineSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const settingsDocument = await settingsModel.findOne({ userId })
  const settings = normalizeSettingsDocument(settingsDocument)

  return {
    settings,
    usingDefaults: !settingsDocument || settingsUseAllDefaults(settings),
  }
}

const normalizeSettingsPayload = (
  payload = {},
  fallbackSettings = DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
) => {
  if (!isPlainObject(payload)) {
    throw new RatingEngineSettingsError('Request body must be an object.', 400)
  }

  const payloadFields = Object.keys(payload)
  const unsupportedFields = payloadFields.filter(
    (field) => !RATING_ENGINE_SETTING_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new RatingEngineSettingsError(
      'Request body contains unsupported rating engine settings fields.',
      400,
      { unsupportedFields },
    )
  }

  const missingFields = RATING_ENGINE_SETTING_FIELDS.filter(
    (field) =>
      !OPTIONAL_LEGACY_SETTING_FIELDS.includes(field) &&
      !Object.hasOwn(payload, field),
  )

  if (missingFields.length > 0) {
    throw new RatingEngineSettingsError(
      'Request body is missing required rating engine settings fields.',
      400,
      { missingFields },
    )
  }

  const fieldErrors = {}
  const normalizedSettings = {}

  RATING_ENGINE_SETTING_FIELDS.forEach((field) => {
    const rawValue = Object.hasOwn(payload, field)
      ? payload[field]
      : fallbackSettings[field]

    if (field === 'specialTeamsAlertsEnabled') {
      if (typeof rawValue !== 'boolean') {
        fieldErrors[field] = `${field} must be a boolean.`
      } else {
        normalizedSettings[field] = rawValue
      }
      return
    }

    if (field === 'specialTeamsMode') {
      const mode = String(rawValue ?? '').trim().toLowerCase()

      if (!Object.values(SPECIAL_TEAMS_MODES).includes(mode)) {
        fieldErrors[field] =
          `${field} must be off, alert_only, or automatic.`
      } else {
        normalizedSettings[field] = mode
      }
      return
    }

    const value = Number(rawValue)
    const limits = RATING_ENGINE_SETTINGS_LIMITS[field]
    const belowMinimum = limits.minExclusive
      ? value <= limits.min
      : value < limits.min

    if (rawValue === null || rawValue === '' || !Number.isFinite(value)) {
      fieldErrors[field] = `${field} must be a finite number.`
      return
    }

    if (limits.integer && !Number.isInteger(value)) {
      fieldErrors[field] = `${field} must be an integer.`
      return
    }

    if (limits.halfPoint && !Number.isInteger(value * 2)) {
      fieldErrors[field] = `${field} must use 0.50-point increments.`
      return
    }

    if (limits.increment && !Number.isInteger(value / limits.increment)) {
      fieldErrors[field] =
        `${field} must use ${limits.increment.toFixed(2)}-point increments.`
      return
    }

    if (belowMinimum || value > limits.max) {
      const minimumLabel = limits.minExclusive
        ? `greater than ${limits.min}`
        : `at least ${limits.min}`

      fieldErrors[field] =
        `${field} must be ${minimumLabel} and no more than ${limits.max}.`
      return
    }

    normalizedSettings[field] = value
  })

  if (
    !Object.hasOwn(payload, 'specialTeamsMode') &&
    Object.hasOwn(payload, 'specialTeamsAlertsEnabled') &&
    typeof normalizedSettings.specialTeamsAlertsEnabled === 'boolean'
  ) {
    normalizedSettings.specialTeamsMode =
      normalizedSettings.specialTeamsAlertsEnabled
        ? SPECIAL_TEAMS_MODES.ALERT_ONLY
        : SPECIAL_TEAMS_MODES.OFF
  }

  if (normalizedSettings.specialTeamsMode) {
    normalizedSettings.specialTeamsAlertsEnabled =
      normalizedSettings.specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new RatingEngineSettingsError(
      'Rating engine settings validation failed.',
      400,
      { fieldErrors },
    )
  }

  return normalizedSettings
}

const updateRatingEngineSettings = async (userId, payload = {}, options = {}) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const existingDocument = await settingsModel.findOne({ userId })
  const normalizedSettings = normalizeSettingsPayload(
    payload,
    normalizeSettingsDocument(existingDocument),
  )
  const settingsDocument = await settingsModel.findOneAndUpdate(
    { userId },
    {
      $set: normalizedSettings,
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

const normalizeScopedSettingsPayload = (payload, fields, scopeLabel) => {
  if (!isPlainObject(payload)) {
    throw new RatingEngineSettingsError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => !fields.includes(field),
  )
  const missingFields = fields.filter((field) => !Object.hasOwn(payload, field))

  if (unsupportedFields.length > 0 || missingFields.length > 0) {
    throw new RatingEngineSettingsError(
      `Request body must contain only ${scopeLabel} fields.`,
      400,
      { missingFields, unsupportedFields },
    )
  }

  const fieldErrors = {}
  const normalizedSettings = {}

  fields.forEach((field) => {
    const rawValue = payload[field]

    if (field === 'specialTeamsAlertsEnabled') {
      if (typeof rawValue !== 'boolean') {
        fieldErrors[field] = `${field} must be a boolean.`
      } else {
        normalizedSettings[field] = rawValue
      }
      return
    }

    if (field === 'specialTeamsMode') {
      const mode = String(rawValue ?? '').trim().toLowerCase()

      if (!Object.values(SPECIAL_TEAMS_MODES).includes(mode)) {
        fieldErrors[field] =
          `${field} must be off, alert_only, or automatic.`
      } else {
        normalizedSettings[field] = mode
      }
      return
    }

    const value = Number(rawValue)
    const limits = RATING_ENGINE_SETTINGS_LIMITS[field]
    const belowMinimum = limits.minExclusive
      ? value <= limits.min
      : value < limits.min

    if (rawValue === null || rawValue === '' || !Number.isFinite(value)) {
      fieldErrors[field] = `${field} must be a finite number.`
    } else if (limits.integer && !Number.isInteger(value)) {
      fieldErrors[field] = `${field} must be an integer.`
    } else if (limits.halfPoint && !Number.isInteger(value * 2)) {
      fieldErrors[field] = `${field} must use 0.50-point increments.`
    } else if (
      limits.increment &&
      !Number.isInteger(value / limits.increment)
    ) {
      fieldErrors[field] =
        `${field} must use ${limits.increment.toFixed(2)}-point increments.`
    } else if (belowMinimum || value > limits.max) {
      const minimumLabel = limits.minExclusive
        ? `greater than ${limits.min}`
        : `at least ${limits.min}`
      fieldErrors[field] =
        `${field} must be ${minimumLabel} and no more than ${limits.max}.`
    } else {
      normalizedSettings[field] = value
    }
  })

  if (normalizedSettings.specialTeamsMode) {
    normalizedSettings.specialTeamsAlertsEnabled =
      normalizedSettings.specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new RatingEngineSettingsError(
      'Rating engine settings validation failed.',
      400,
      { fieldErrors },
    )
  }

  return normalizedSettings
}

const updateScopedRatingEngineSettings = async (
  userId,
  payload,
  fields,
  scopeLabel,
  options = {},
) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const normalizedSettings = normalizeScopedSettingsPayload(
    payload,
    fields,
    scopeLabel,
  )
  const settingsDocument = await settingsModel.findOneAndUpdate(
    { userId },
    {
      $set: normalizedSettings,
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

const updateRatingEngineParameters = (userId, payload, options = {}) =>
  updateScopedRatingEngineSettings(
    userId,
    payload,
    ENGINE_RESET_FIELDS,
    'Power Rating Engine',
    options,
  )

const updateRatingEngineModelAdjustments = async (
  userId,
  payload,
  options = {},
) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  if (!isPlainObject(payload)) {
    throw new RatingEngineSettingsError('Request body must be an object.', 400)
  }

  const settingsModel = getSettingsModel(options)
  const existingDocument = await settingsModel.findOne({ userId })
  const fallbackSettings = normalizeSettingsDocument(existingDocument)

  if (
    Object.hasOwn(payload, 'specialTeamsAlertsEnabled') &&
    typeof payload.specialTeamsAlertsEnabled !== 'boolean'
  ) {
    throw new RatingEngineSettingsError(
      'Rating engine settings validation failed.',
      400,
      {
        fieldErrors: {
          specialTeamsAlertsEnabled:
            'specialTeamsAlertsEnabled must be a boolean.',
        },
      },
    )
  }

  const normalizedPayload = {
    maximumGoaliePenalty: fallbackSettings.maximumGoaliePenalty,
    maximumPlayerInjuryPenalty:
      fallbackSettings.maximumPlayerInjuryPenalty,
    specialTeamsAdjustment:
      fallbackSettings.specialTeamsAdjustment,
    specialTeamsAlertsEnabled:
      fallbackSettings.specialTeamsAlertsEnabled,
    specialTeamsMode:
      fallbackSettings.specialTeamsMode,
    specialTeamsRankThreshold:
      fallbackSettings.specialTeamsRankThreshold,
    ...payload,
  }

  if (
    !Object.hasOwn(payload, 'specialTeamsMode') &&
    Object.hasOwn(payload, 'specialTeamsAlertsEnabled')
  ) {
    normalizedPayload.specialTeamsMode = payload.specialTeamsAlertsEnabled
      ? SPECIAL_TEAMS_MODES.ALERT_ONLY
      : SPECIAL_TEAMS_MODES.OFF
  }

  normalizedPayload.specialTeamsAlertsEnabled =
    normalizedPayload.specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF

  return updateScopedRatingEngineSettings(
    userId,
    normalizedPayload,
    MODEL_ADJUSTMENT_FIELDS,
    'Model Adjustments',
    options,
  )
}

const normalizeResetScope = (scope) => {
  const normalizedScope = scope ?? RATING_ENGINE_RESET_SCOPES.ALL

  if (!Object.values(RATING_ENGINE_RESET_SCOPES).includes(normalizedScope)) {
    throw new RatingEngineSettingsError(
      'Rating engine reset scope is not supported.',
      400,
      { scope },
    )
  }

  return normalizedScope
}

const resetRatingEngineSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const scope = normalizeResetScope(options.scope)

  if (scope === RATING_ENGINE_RESET_SCOPES.ALL) {
    await settingsModel.deleteOne({ userId })

    return {
      settings: buildDefaultSettings(),
      success: true,
      usingDefaults: true,
    }
  }

  const existingDocument = await settingsModel.findOne({ userId })
  const currentSettings = normalizeSettingsDocument(existingDocument)
  const fieldsToReset =
    scope === RATING_ENGINE_RESET_SCOPES.ENGINE
      ? ENGINE_RESET_FIELDS
      : MODEL_ADJUSTMENT_FIELDS
  const resetValues = fieldsToReset.reduce(
    (values, field) => ({
      ...values,
      [field]: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS[field],
    }),
    {},
  )
  const settingsDocument = await settingsModel.findOneAndUpdate(
    { userId },
    {
      $set: resetValues,
      $setOnInsert: { userId },
    },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )
  const settings = normalizeSettingsDocument({
    ...currentSettings,
    ...settingsDocument,
    ...resetValues,
  })

  return {
    settings,
    success: true,
    usingDefaults: settingsUseAllDefaults(settings),
  }
}

const getProductionRatingEngineSettings = async (userId, options = {}) => {
  const { settings } = await getRatingEngineSettings(userId, options)

  return serializeProductionRatingEngineSettings(settings)
}

const getRatingUpdateConfiguration = (settings) =>
  createRatingEngineConfiguration({
    modelVersion: settings.modelVersion ?? DEFAULT_RATING_ENGINE_MODEL_VERSION,
    kFactor: settings.kFactor,
    regulationMultiplier: settings.regulationMultiplier,
    overtimeMultiplier: settings.overtimeMultiplier,
    shootoutMultiplier: settings.shootoutMultiplier,
  })

module.exports = {
  DEFAULT_PRODUCTION_HOME_ADVANTAGE,
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  DEFAULT_RATING_ENGINE_MODEL_VERSION,
  ENGINE_RESET_FIELDS,
  MODEL_ADJUSTMENT_FIELDS,
  RATING_ENGINE_SETTING_FIELDS,
  RATING_ENGINE_RESET_SCOPES,
  RATING_ENGINE_SETTINGS_LIMITS,
  RatingEngineSettingsError,
  getRatingEngineSettings,
  getProductionRatingEngineSettings,
  getRatingUpdateConfiguration,
  normalizeSettingsPayload,
  normalizeScopedSettingsPayload,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
  updateRatingEngineModelAdjustments,
  updateRatingEngineParameters,
}
