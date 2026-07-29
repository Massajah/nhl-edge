const BettingSettings = require('../models/BettingSettings')

const KELLY_MODES = BettingSettings.KELLY_MODES
const BANKROLL_BASES = BettingSettings.BANKROLL_BASES
const STAKE_ROUNDING_INCREMENTS = BettingSettings.STAKE_ROUNDING_INCREMENTS

const BETTING_SETTING_FIELDS = Object.freeze([
  'kellyMode',
  'customKellyFraction',
  'maximumStakePercent',
  'minimumEdgePercent',
  'stakeRoundingIncrement',
  'bankrollBasis',
])
const DEFAULT_BETTING_SETTINGS = Object.freeze({
  bankrollBasis: 'AVAILABLE',
  customKellyFraction: 0.25,
  kellyMode: 'QUARTER',
  maximumStakePercent: 3,
  minimumEdgePercent: 2,
  stakeRoundingIncrement: 0.5,
})
const BETTING_SETTINGS_LIMITS = Object.freeze({
  customKellyFraction: {
    max: 1,
    min: 0,
    minExclusive: true,
  },
  maximumStakePercent: {
    max: 100,
    min: 0,
    minExclusive: true,
  },
  minimumEdgePercent: {
    max: 100,
    min: 0,
  },
})

class BettingSettingsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'BettingSettingsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const buildDefaultBettingSettings = () => ({
  ...DEFAULT_BETTING_SETTINGS,
})

const serializeBettingSettings = (settings = buildDefaultBettingSettings()) => ({
  bankrollBasis: settings.bankrollBasis,
  customKellyFraction: settings.customKellyFraction,
  kellyMode: settings.kellyMode,
  maximumStakePercent: settings.maximumStakePercent,
  minimumEdgePercent: settings.minimumEdgePercent,
  stakeRoundingIncrement: settings.stakeRoundingIncrement,
})

const getSettingsModel = (options = {}) =>
  options.settingsModel ?? BettingSettings

const normalizeSettingsDocument = (document) =>
  serializeBettingSettings(document ?? buildDefaultBettingSettings())

const normalizeEnumValue = ({ supportedValues, value }) => {
  const normalizedValue = String(value ?? '')
    .trim()
    .toUpperCase()

  return supportedValues.includes(normalizedValue) ? normalizedValue : null
}

const validateNumericSetting = ({ label, limits, rawValue }) => {
  const value = Number(rawValue)
  const belowMinimum = limits.minExclusive
    ? value <= limits.min
    : value < limits.min

  if (rawValue === null || rawValue === '' || !Number.isFinite(value)) {
    return {
      error: `${label} must be a finite number.`,
      value: null,
    }
  }

  if (belowMinimum || value > limits.max) {
    const minimumLabel = limits.minExclusive
      ? `greater than ${limits.min}`
      : `at least ${limits.min}`

    return {
      error: `${label} must be ${minimumLabel} and no more than ${limits.max}.`,
      value: null,
    }
  }

  return {
    error: '',
    value,
  }
}

const normalizeSettingsPayload = (payload = {}) => {
  if (!isPlainObject(payload)) {
    throw new BettingSettingsError('Request body must be an object.', 400)
  }

  const payloadFields = Object.keys(payload)
  const unsupportedFields = payloadFields.filter(
    (field) => !BETTING_SETTING_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new BettingSettingsError(
      'Request body contains unsupported betting settings fields.',
      400,
      { unsupportedFields },
    )
  }

  const missingFields = BETTING_SETTING_FIELDS.filter(
    (field) => !Object.hasOwn(payload, field),
  )

  if (missingFields.length > 0) {
    throw new BettingSettingsError(
      'Request body is missing required betting settings fields.',
      400,
      { missingFields },
    )
  }

  const fieldErrors = {}
  const normalizedSettings = {}
  const kellyMode = normalizeEnumValue({
    supportedValues: KELLY_MODES,
    value: payload.kellyMode,
  })
  const bankrollBasis = normalizeEnumValue({
    supportedValues: BANKROLL_BASES,
    value: payload.bankrollBasis,
  })

  if (!kellyMode) {
    fieldErrors.kellyMode = `kellyMode must be one of: ${KELLY_MODES.join(
      ', ',
    )}.`
  } else {
    normalizedSettings.kellyMode = kellyMode
  }

  if (!bankrollBasis) {
    fieldErrors.bankrollBasis = `bankrollBasis must be one of: ${BANKROLL_BASES.join(
      ', ',
    )}.`
  } else {
    normalizedSettings.bankrollBasis = bankrollBasis
  }

  const numericFields = [
    ['customKellyFraction', 'customKellyFraction'],
    ['maximumStakePercent', 'maximumStakePercent'],
    ['minimumEdgePercent', 'minimumEdgePercent'],
  ]

  numericFields.forEach(([field, label]) => {
    const result = validateNumericSetting({
      label,
      limits: BETTING_SETTINGS_LIMITS[field],
      rawValue: payload[field],
    })

    if (result.error) {
      fieldErrors[field] = result.error
      return
    }

    normalizedSettings[field] = result.value
  })

  const roundingIncrement = Number(payload.stakeRoundingIncrement)
  const isSupportedRoundingIncrement = STAKE_ROUNDING_INCREMENTS.some(
    (increment) => Math.abs(increment - roundingIncrement) < 0.000001,
  )

  if (!Number.isFinite(roundingIncrement) || !isSupportedRoundingIncrement) {
    fieldErrors.stakeRoundingIncrement = `stakeRoundingIncrement must be one of: ${STAKE_ROUNDING_INCREMENTS.join(
      ', ',
    )}.`
  } else {
    normalizedSettings.stakeRoundingIncrement = roundingIncrement
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new BettingSettingsError(
      'Betting settings validation failed.',
      400,
      { fieldErrors },
    )
  }

  return normalizedSettings
}

const getBettingSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new BettingSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)
  const settingsDocument = await settingsModel.findOne({ userId })

  return {
    settings: normalizeSettingsDocument(settingsDocument),
    usingDefaults: !settingsDocument,
  }
}

const updateBettingSettings = async (userId, payload = {}, options = {}) => {
  if (!userId) {
    throw new BettingSettingsError('Authenticated userId is required.', 401)
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

const resetBettingSettings = async (userId, options = {}) => {
  if (!userId) {
    throw new BettingSettingsError('Authenticated userId is required.', 401)
  }

  const settingsModel = getSettingsModel(options)

  await settingsModel.deleteOne({ userId })

  return {
    settings: buildDefaultBettingSettings(),
    success: true,
    usingDefaults: true,
  }
}

module.exports = {
  BANKROLL_BASES,
  BETTING_SETTING_FIELDS,
  BETTING_SETTINGS_LIMITS,
  DEFAULT_BETTING_SETTINGS,
  KELLY_MODES,
  STAKE_ROUNDING_INCREMENTS,
  BettingSettingsError,
  buildDefaultBettingSettings,
  getBettingSettings,
  normalizeSettingsPayload,
  resetBettingSettings,
  updateBettingSettings,
}
