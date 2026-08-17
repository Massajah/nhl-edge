import { BASE_MODEL_V1 } from '../config/baseModel.js'

export const STARTING_RATING_SCALE_MODES = Object.freeze({
  CUSTOM: 'custom',
  STANDARD: 'standard',
})

export const STANDARD_STARTING_RATING_SCALES = Object.freeze([
  Object.freeze({
    center: 45,
    id: '42-48',
    label: '42–48',
    max: 48,
    min: 42,
    spread: 6,
  }),
  Object.freeze({
    calibratedDefault: true,
    center: 46,
    id: '42-50',
    label: '42–50 · Calibrated default',
    max: 50,
    min: 42,
    spread: 8,
  }),
  Object.freeze({
    center: 45,
    id: '40-50',
    label: '40–50',
    max: 50,
    min: 40,
    spread: 10,
  }),
  Object.freeze({
    center: 46,
    id: '40-52',
    label: '40–52',
    max: 52,
    min: 40,
    spread: 12,
  }),
])

export const STARTING_RATING_SCALE_LIMITS = Object.freeze({
  rating: Object.freeze({ max: 100, min: 0 }),
})

export const DEFAULT_STARTING_RATING_SCALE = Object.freeze({
  calibratedDefault: true,
  center: BASE_MODEL_V1.startingRatings.center,
  max: BASE_MODEL_V1.startingRatings.max,
  min: BASE_MODEL_V1.startingRatings.min,
  mode: STARTING_RATING_SCALE_MODES.STANDARD,
  spread: BASE_MODEL_V1.startingRatings.spread,
})

export const deriveStartingRatingRange = ({ center, spread }) => ({
  max: center + spread / 2,
  min: center - spread / 2,
})

export const deriveStartingRatingCenterAndSpread = ({ max, min }) => ({
  center: (min + max) / 2,
  spread: max - min,
})

const toScaleNumber = (value) =>
  Number(
    typeof value === 'string' ? value.trim().replace(',', '.') : value,
  )

const isSupportedRange = ({ max, min }) =>
  Number.isFinite(min) &&
  Number.isFinite(max) &&
  min >= STARTING_RATING_SCALE_LIMITS.rating.min &&
  max <= STARTING_RATING_SCALE_LIMITS.rating.max &&
  min < max

const getStandardScale = (scale) =>
  STANDARD_STARTING_RATING_SCALES.find(
    (option) =>
      option.spread === toScaleNumber(scale?.spread) ||
      (option.min === toScaleNumber(scale?.min) &&
        option.max === toScaleNumber(scale?.max)),
  )

const serializeScale = ({ max, min, mode }) => {
  const derived = deriveStartingRatingCenterAndSpread({ max, min })

  return {
    calibratedDefault:
      mode === STARTING_RATING_SCALE_MODES.STANDARD &&
      min === BASE_MODEL_V1.startingRatings.min &&
      max === BASE_MODEL_V1.startingRatings.max,
    ...derived,
    max,
    min,
    mode,
  }
}

export const normalizeStartingRatingScale = (
  scale = DEFAULT_STARTING_RATING_SCALE,
) => {
  if (scale?.mode === STARTING_RATING_SCALE_MODES.CUSTOM) {
    const directRange = {
      max: toScaleNumber(scale.max),
      min: toScaleNumber(scale.min),
    }
    const derivedRange = deriveStartingRatingRange({
      center: toScaleNumber(scale.center),
      spread: toScaleNumber(scale.spread),
    })
    const range = isSupportedRange(directRange) ? directRange : derivedRange

    if (isSupportedRange(range)) {
      return serializeScale({
        ...range,
        mode: STARTING_RATING_SCALE_MODES.CUSTOM,
      })
    }
  }

  if (scale?.mode === STARTING_RATING_SCALE_MODES.STANDARD) {
    const standardScale = getStandardScale(scale)

    if (standardScale) {
      return serializeScale({
        max: standardScale.max,
        min: standardScale.min,
        mode: STARTING_RATING_SCALE_MODES.STANDARD,
      })
    }
  }

  return { ...DEFAULT_STARTING_RATING_SCALE }
}

export const createStartingRatingScaleDraft = (
  scale = DEFAULT_STARTING_RATING_SCALE,
) => {
  const normalizedScale = normalizeStartingRatingScale(scale)
  const preset = getStandardScale(normalizedScale)

  return {
    max: String(normalizedScale.max),
    min: String(normalizedScale.min),
    mode: normalizedScale.mode,
    preset:
      normalizedScale.mode === STARTING_RATING_SCALE_MODES.CUSTOM
        ? STARTING_RATING_SCALE_MODES.CUSTOM
        : preset?.id,
  }
}

export const parseStartingRatingScaleDraft = (draft = {}) => {
  const mode = draft.mode
  const min = toScaleNumber(draft.min)
  const max = toScaleNumber(draft.max)
  const fieldErrors = {}

  if (!Object.values(STARTING_RATING_SCALE_MODES).includes(mode)) {
    fieldErrors.mode = 'Choose a supported Starting Rating Scale.'
  }

  if (String(draft.min ?? '').trim() === '' || !Number.isFinite(min)) {
    fieldErrors.min = 'Minimum starting rating must be a number.'
  }

  if (String(draft.max ?? '').trim() === '' || !Number.isFinite(max)) {
    fieldErrors.max = 'Maximum starting rating must be a number.'
  }

  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min >= max) {
      fieldErrors.max =
        'Maximum starting rating must be greater than the minimum.'
    } else if (
      min < STARTING_RATING_SCALE_LIMITS.rating.min ||
      max > STARTING_RATING_SCALE_LIMITS.rating.max
    ) {
      fieldErrors.max = 'The starting range must stay between 0 and 100.'
    }
  }

  if (
    mode === STARTING_RATING_SCALE_MODES.STANDARD &&
    !STANDARD_STARTING_RATING_SCALES.some(
      (option) => option.min === min && option.max === max,
    )
  ) {
    fieldErrors.mode = 'Choose a supported standard Starting Rating Scale.'
  }

  const isValid = Object.keys(fieldErrors).length === 0

  return {
    fieldErrors,
    isValid,
    scale: isValid
      ? serializeScale({ max, min, mode })
      : {
          calibratedDefault: false,
          center: Number.NaN,
          max,
          min,
          mode,
          spread: Number.NaN,
        },
  }
}

export const isStartingRatingScaleDirty = (draft, savedScale) => {
  const parsed = parseStartingRatingScaleDraft(draft)
  const normalizedSavedScale = normalizeStartingRatingScale(savedScale)

  return (
    !parsed.isValid ||
    parsed.scale.mode !== normalizedSavedScale.mode ||
    parsed.scale.min !== normalizedSavedScale.min ||
    parsed.scale.max !== normalizedSavedScale.max
  )
}

export const isStartingRatingWithinScale = (rating, scale) => {
  const value = Number(rating)
  const normalizedScale = normalizeStartingRatingScale(scale)

  return (
    Number.isFinite(value) &&
    value >= normalizedScale.min &&
    value <= normalizedScale.max
  )
}
