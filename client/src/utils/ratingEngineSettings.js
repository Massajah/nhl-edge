export const DEFAULT_RATING_ENGINE_SETTINGS = Object.freeze({
  kFactor: 1.2,
  homeAdvantage: 4,
  regulationMultiplier: 1,
  overtimeMultiplier: 0.7,
  shootoutMultiplier: 0.5,
})

export const RATING_ENGINE_SETTING_FIELDS = Object.freeze([
  {
    key: 'kFactor',
    label: 'K Factor',
    max: 10,
    min: 0,
    minExclusive: true,
    step: 0.01,
  },
  {
    key: 'homeAdvantage',
    label: 'Base Home Advantage',
    max: 15,
    min: 0,
    step: 0.01,
  },
  {
    key: 'regulationMultiplier',
    label: 'Regulation Multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
  {
    key: 'overtimeMultiplier',
    label: 'Overtime Multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
  {
    key: 'shootoutMultiplier',
    label: 'Shootout Multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
])

export const createRatingEngineSettingsDraft = (
  settings = DEFAULT_RATING_ENGINE_SETTINGS,
) =>
  RATING_ENGINE_SETTING_FIELDS.reduce((draft, field) => {
    draft[field.key] = String(
      settings[field.key] ?? DEFAULT_RATING_ENGINE_SETTINGS[field.key],
    )

    return draft
  }, {})

export const normalizeRatingEngineSettings = (
  settings = DEFAULT_RATING_ENGINE_SETTINGS,
) =>
  RATING_ENGINE_SETTING_FIELDS.reduce((normalizedSettings, field) => {
    const sourceValue = settings[field.key]
    const value = Number(
      typeof sourceValue === 'string'
        ? sourceValue.trim().replace(',', '.')
        : sourceValue,
    )

    normalizedSettings[field.key] = Number.isFinite(value)
      ? value
      : DEFAULT_RATING_ENGINE_SETTINGS[field.key]

    return normalizedSettings
  }, {})

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

    settings[field.key] = value
  })

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    settings,
  }
}
