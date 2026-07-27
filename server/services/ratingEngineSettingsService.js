const {
  DEFAULT_RATING_ENGINE_CONFIGURATION,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')
const RatingEngineSettings = require('../models/RatingEngineSettings')

const DEFAULT_PRODUCTION_HOME_ADVANTAGE = 4

const RATING_ENGINE_SETTING_FIELDS = Object.freeze([
  'kFactor',
  'homeAdvantage',
  'regulationMultiplier',
  'overtimeMultiplier',
  'shootoutMultiplier',
])
const RATING_ENGINE_SETTINGS_LIMITS = Object.freeze({
  kFactor: { max: 10, min: 0, minExclusive: true },
  homeAdvantage: { max: 15, min: 0 },
  regulationMultiplier: { max: 2, min: 0 },
  overtimeMultiplier: { max: 2, min: 0 },
  shootoutMultiplier: { max: 2, min: 0 },
})
const DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS = Object.freeze({
  kFactor: DEFAULT_RATING_ENGINE_CONFIGURATION.kFactor,
  homeAdvantage: DEFAULT_PRODUCTION_HOME_ADVANTAGE,
  regulationMultiplier:
    DEFAULT_RATING_ENGINE_CONFIGURATION.regulationMultiplier,
  overtimeMultiplier: DEFAULT_RATING_ENGINE_CONFIGURATION.overtimeMultiplier,
  shootoutMultiplier: DEFAULT_RATING_ENGINE_CONFIGURATION.shootoutMultiplier,
})
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

const serializeRatingEngineSettings = (settings) => ({
  kFactor: settings.kFactor,
  homeAdvantage: settings.homeAdvantage,
  regulationMultiplier: settings.regulationMultiplier,
  overtimeMultiplier: settings.overtimeMultiplier,
  shootoutMultiplier: settings.shootoutMultiplier,
})

const serializeProductionRatingEngineSettings = (settings) => ({
  modelVersion: DEFAULT_RATING_ENGINE_MODEL_VERSION,
  ...serializeRatingEngineSettings(settings),
})

const getSettingsModel = (options = {}) =>
  options.settingsModel ?? RatingEngineSettings

const normalizeSettingsDocument = (document) =>
  serializeRatingEngineSettings(document ?? buildDefaultSettings())

const getRatingEngineSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const settingsDocument = await settingsModel.findOne({ userId })

  return {
    settings: normalizeSettingsDocument(settingsDocument),
    usingDefaults: !settingsDocument,
  }
}

const normalizeSettingsPayload = (payload = {}) => {
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
    (field) => !Object.hasOwn(payload, field),
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
    const rawValue = payload[field]
    const value = Number(rawValue)
    const limits = RATING_ENGINE_SETTINGS_LIMITS[field]
    const belowMinimum = limits.minExclusive
      ? value <= limits.min
      : value < limits.min

    if (rawValue === null || rawValue === '' || !Number.isFinite(value)) {
      fieldErrors[field] = `${field} must be a finite number.`
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
  const normalizedSettings = normalizeSettingsPayload(payload)
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

const resetRatingEngineSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new RatingEngineSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)

  await settingsModel.deleteOne({ userId })

  return {
    settings: buildDefaultSettings(),
    success: true,
    usingDefaults: true,
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
  RATING_ENGINE_SETTING_FIELDS,
  RATING_ENGINE_SETTINGS_LIMITS,
  RatingEngineSettingsError,
  getRatingEngineSettings,
  getProductionRatingEngineSettings,
  getRatingUpdateConfiguration,
  normalizeSettingsPayload,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
}
