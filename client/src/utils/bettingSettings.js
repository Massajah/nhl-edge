import {
  BANKROLL_DEFAULT_CURRENCY,
  formatBankrollCurrency,
} from './bankroll.js'

export const KELLY_MODES = Object.freeze(['FULL', 'HALF', 'QUARTER', 'CUSTOM'])
export const BANKROLL_BASES = Object.freeze(['AVAILABLE', 'CURRENT'])
export const STAKE_ROUNDING_INCREMENTS = Object.freeze([
  0.01,
  0.05,
  0.1,
  0.5,
  1,
  5,
])
export const DEFAULT_BETTING_SETTINGS = Object.freeze({
  bankrollBasis: 'AVAILABLE',
  customKellyFraction: 0.25,
  kellyMode: 'QUARTER',
  maximumStakePercent: 3,
  minimumEdgePercent: 2,
  stakeRoundingIncrement: 0.5,
})
export const BETTING_SETTING_KEYS = Object.freeze(
  Object.keys(DEFAULT_BETTING_SETTINGS),
)

export const KELLY_MODE_OPTIONS = Object.freeze([
  {
    fraction: 0.25,
    label: 'Quarter Kelly',
    value: 'QUARTER',
  },
  {
    fraction: 0.5,
    label: 'Half Kelly',
    value: 'HALF',
  },
  {
    fraction: 1,
    label: 'Full Kelly',
    value: 'FULL',
  },
  {
    fraction: null,
    label: 'Custom',
    value: 'CUSTOM',
  },
])

export const BANKROLL_BASIS_OPTIONS = Object.freeze([
  {
    label: 'Available bankroll',
    value: 'AVAILABLE',
  },
  {
    label: 'Current bankroll',
    value: 'CURRENT',
  },
])

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const normalizeEnum = (value, supportedValues, fallback) => {
  const normalizedValue = String(value ?? '')
    .trim()
    .toUpperCase()

  return supportedValues.includes(normalizedValue) ? normalizedValue : fallback
}

const normalizeRoundingIncrement = (value) => {
  const numericValue = Number(value)

  return STAKE_ROUNDING_INCREMENTS.some(
    (increment) => Math.abs(increment - numericValue) < 0.000001,
  )
    ? numericValue
    : DEFAULT_BETTING_SETTINGS.stakeRoundingIncrement
}

export const normalizeBettingSettings = (
  settings = DEFAULT_BETTING_SETTINGS,
) => {
  const source = isPlainObject(settings) ? settings : {}
  const customKellyFraction = toNumber(
    source.customKellyFraction,
    DEFAULT_BETTING_SETTINGS.customKellyFraction,
  )
  const maximumStakePercent = toNumber(
    source.maximumStakePercent,
    DEFAULT_BETTING_SETTINGS.maximumStakePercent,
  )
  const minimumEdgePercent = toNumber(
    source.minimumEdgePercent,
    DEFAULT_BETTING_SETTINGS.minimumEdgePercent,
  )

  return {
    bankrollBasis: normalizeEnum(
      source.bankrollBasis,
      BANKROLL_BASES,
      DEFAULT_BETTING_SETTINGS.bankrollBasis,
    ),
    customKellyFraction:
      customKellyFraction > 0 && customKellyFraction <= 1
        ? customKellyFraction
        : DEFAULT_BETTING_SETTINGS.customKellyFraction,
    kellyMode: normalizeEnum(
      source.kellyMode,
      KELLY_MODES,
      DEFAULT_BETTING_SETTINGS.kellyMode,
    ),
    maximumStakePercent:
      maximumStakePercent > 0 && maximumStakePercent <= 100
        ? maximumStakePercent
        : DEFAULT_BETTING_SETTINGS.maximumStakePercent,
    minimumEdgePercent:
      minimumEdgePercent >= 0 && minimumEdgePercent <= 100
        ? minimumEdgePercent
        : DEFAULT_BETTING_SETTINGS.minimumEdgePercent,
    stakeRoundingIncrement: normalizeRoundingIncrement(
      source.stakeRoundingIncrement,
    ),
  }
}

export const createBettingSettingsDraft = (
  settings = DEFAULT_BETTING_SETTINGS,
) => {
  const normalizedSettings = normalizeBettingSettings(settings)

  return {
    bankrollBasis: normalizedSettings.bankrollBasis,
    customKellyFraction: String(normalizedSettings.customKellyFraction),
    kellyMode: normalizedSettings.kellyMode,
    maximumStakePercent: String(normalizedSettings.maximumStakePercent),
    minimumEdgePercent: String(normalizedSettings.minimumEdgePercent),
    stakeRoundingIncrement: String(normalizedSettings.stakeRoundingIncrement),
  }
}

const validateNumber = ({
  fieldErrors,
  key,
  label,
  max,
  min,
  minExclusive = false,
  value,
}) => {
  const rawValue = value
  const numberValue = Number(rawValue)

  if (rawValue === null || String(rawValue ?? '').trim() === '') {
    fieldErrors[key] = `${label} is required.`
    return null
  }

  if (!Number.isFinite(numberValue)) {
    fieldErrors[key] = `${label} must be a number.`
    return null
  }

  if (minExclusive && numberValue <= min) {
    fieldErrors[key] = `${label} must be greater than ${min}.`
    return null
  }

  if (numberValue < min || numberValue > max) {
    fieldErrors[key] = `${label} must be between ${min} and ${max}.`
    return null
  }

  return numberValue
}

const normalizeCustomKellyDraftValue = (value) => {
  const numberValue = toNumber(
    value,
    DEFAULT_BETTING_SETTINGS.customKellyFraction,
  )

  return numberValue > 0 && numberValue <= 1
    ? numberValue
    : DEFAULT_BETTING_SETTINGS.customKellyFraction
}

export const parseBettingSettingsDraft = (draft = {}) => {
  const fieldErrors = {}
  const kellyMode = normalizeEnum(draft.kellyMode, KELLY_MODES, '')
  const bankrollBasis = normalizeEnum(draft.bankrollBasis, BANKROLL_BASES, '')
  const stakeRoundingIncrement = Number(draft.stakeRoundingIncrement)
  const settings = {}

  if (!kellyMode) {
    fieldErrors.kellyMode = 'Kelly Mode is required.'
  } else {
    settings.kellyMode = kellyMode
  }

  if (!bankrollBasis) {
    fieldErrors.bankrollBasis = 'Bankroll Basis is required.'
  } else {
    settings.bankrollBasis = bankrollBasis
  }

  if (kellyMode === 'CUSTOM') {
    settings.customKellyFraction = validateNumber({
      fieldErrors,
      key: 'customKellyFraction',
      label: 'Custom Kelly Fraction',
      max: 1,
      min: 0,
      minExclusive: true,
      value: draft.customKellyFraction,
    })
  } else {
    settings.customKellyFraction = normalizeCustomKellyDraftValue(
      draft.customKellyFraction,
    )
  }
  settings.maximumStakePercent = validateNumber({
    fieldErrors,
    key: 'maximumStakePercent',
    label: 'Maximum Stake',
    max: 100,
    min: 0,
    minExclusive: true,
    value: draft.maximumStakePercent,
  })
  settings.minimumEdgePercent = validateNumber({
    fieldErrors,
    key: 'minimumEdgePercent',
    label: 'Minimum Edge',
    max: 100,
    min: 0,
    value: draft.minimumEdgePercent,
  })

  if (
    !STAKE_ROUNDING_INCREMENTS.some(
      (increment) => Math.abs(increment - stakeRoundingIncrement) < 0.000001,
    )
  ) {
    fieldErrors.stakeRoundingIncrement = 'Stake Rounding must use a supported increment.'
  } else {
    settings.stakeRoundingIncrement = stakeRoundingIncrement
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    settings,
  }
}

export const shouldShowCustomKellyFraction = (kellyMode) =>
  normalizeEnum(kellyMode, KELLY_MODES, DEFAULT_BETTING_SETTINGS.kellyMode) ===
  'CUSTOM'

export const applyKellyModeSelection = (draft = {}, kellyMode) => ({
  ...draft,
  kellyMode: normalizeEnum(
    kellyMode,
    KELLY_MODES,
    DEFAULT_BETTING_SETTINGS.kellyMode,
  ),
})

export const getKellyModeFraction = (settings = DEFAULT_BETTING_SETTINGS) => {
  const normalizedSettings = normalizeBettingSettings(settings)

  if (normalizedSettings.kellyMode === 'FULL') {
    return 1
  }

  if (normalizedSettings.kellyMode === 'HALF') {
    return 0.5
  }

  if (normalizedSettings.kellyMode === 'CUSTOM') {
    return normalizedSettings.customKellyFraction
  }

  return 0.25
}

export const getKellyModeLabel = (kellyMode) =>
  KELLY_MODE_OPTIONS.find((option) => option.value === kellyMode)?.label ??
  'Quarter Kelly'

export const getBankrollBasisLabel = (bankrollBasis) =>
  BANKROLL_BASIS_OPTIONS.find((option) => option.value === bankrollBasis)
    ?.label ?? 'Available bankroll'

export const formatStakeRoundingLabel = (
  increment,
  currency = BANKROLL_DEFAULT_CURRENCY,
) => formatBankrollCurrency(Number(increment), currency)

export const getStakeRoundingOptions = (
  currency = BANKROLL_DEFAULT_CURRENCY,
) =>
  STAKE_ROUNDING_INCREMENTS.map((increment) => ({
    label: formatStakeRoundingLabel(increment, currency),
    value: String(increment),
  }))

export const formatApiFieldErrors = (details = {}) => {
  if (details?.fieldErrors) {
    return details.fieldErrors
  }

  return {}
}
