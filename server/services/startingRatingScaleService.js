const { BASE_MODEL_V1 } = require('../config/baseModel')
const PowerRatingSettings = require('../models/PowerRatingSettings')

const STARTING_RATING_SCALE_MODES = Object.freeze({
  CUSTOM: 'custom',
  STANDARD: 'standard',
})
const STANDARD_STARTING_RATING_SCALES = Object.freeze([
  Object.freeze({ center: 45, max: 48, min: 42, spread: 6 }),
  Object.freeze({
    calibratedDefault: true,
    center: 46,
    max: 50,
    min: 42,
    spread: 8,
  }),
  Object.freeze({ center: 45, max: 50, min: 40, spread: 10 }),
  Object.freeze({ center: 46, max: 52, min: 40, spread: 12 }),
])
const STANDARD_STARTING_RATING_SPREADS = Object.freeze(
  STANDARD_STARTING_RATING_SCALES.map((scale) => scale.spread),
)
const STARTING_RATING_SCALE_LIMITS = Object.freeze({
  rating: Object.freeze({ max: 100, min: 0 }),
})
const STARTING_RATING_ASSIGNMENT_STEP = 0.5
const DEFAULT_STARTING_RATING_SCALE = Object.freeze({
  center: BASE_MODEL_V1.startingRatings.center,
  mode: STARTING_RATING_SCALE_MODES.STANDARD,
  spread: BASE_MODEL_V1.startingRatings.spread,
})

class StartingRatingScaleError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'StartingRatingScaleError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const deriveStartingRatingRange = ({ center, spread }) => ({
  max: center + spread / 2,
  min: center - spread / 2,
})

const deriveStartingRatingCenterAndSpread = ({ max, min }) => ({
  center: (min + max) / 2,
  spread: max - min,
})

const isSupportedRange = ({ max, min }) =>
  Number.isFinite(min) &&
  Number.isFinite(max) &&
  min >= STARTING_RATING_SCALE_LIMITS.rating.min &&
  max <= STARTING_RATING_SCALE_LIMITS.rating.max &&
  min < max

const isRatingAlignedToStep = (
  value,
  step = STARTING_RATING_ASSIGNMENT_STEP,
) => {
  const numericValue = Number(value)
  const numericStep = Number(step)

  if (!Number.isFinite(numericValue) || !Number.isFinite(numericStep) || numericStep <= 0) {
    return false
  }

  const stepCount = numericValue / numericStep

  return Math.abs(stepCount - Math.round(stepCount)) <= 1e-9
}

const formatStartingRatingBoundary = (value) =>
  Number(value).toFixed(2).replace(/0$/, '')

const getStandardScaleBySpread = (spread) =>
  STANDARD_STARTING_RATING_SCALES.find(
    (scale) => scale.spread === Number(spread),
  )

const getStandardScaleByRange = ({ max, min }) =>
  STANDARD_STARTING_RATING_SCALES.find(
    (scale) => scale.min === min && scale.max === max,
  )

const serializeStartingRatingScale = ({ center, mode, spread }) => {
  const range = deriveStartingRatingRange({ center, spread })
  const calibratedDefault =
    mode === STARTING_RATING_SCALE_MODES.STANDARD &&
    range.min === BASE_MODEL_V1.startingRatings.min &&
    range.max === BASE_MODEL_V1.startingRatings.max

  return {
    calibratedDefault,
    center,
    max: range.max,
    min: range.min,
    mode,
    spread,
  }
}

const serializeStandardScale = (scale) =>
  serializeStartingRatingScale({
    center: scale.center,
    mode: STARTING_RATING_SCALE_MODES.STANDARD,
    spread: scale.spread,
  })

const normalizeStartingRatingScale = (settings) => {
  const mode = settings?.startingRatingScaleMode ?? settings?.mode
  const center = Number(settings?.startingRatingCenter ?? settings?.center)
  const spread = Number(settings?.startingRatingSpread ?? settings?.spread)

  if (mode === STARTING_RATING_SCALE_MODES.CUSTOM) {
    const range = deriveStartingRatingRange({ center, spread })

    if (isSupportedRange(range)) {
      return serializeStartingRatingScale({ center, mode, spread })
    }
  }

  if (mode === STARTING_RATING_SCALE_MODES.STANDARD) {
    const standardScale = getStandardScaleBySpread(spread)

    if (standardScale) {
      return serializeStandardScale(standardScale)
    }
  }

  return serializeStartingRatingScale(DEFAULT_STARTING_RATING_SCALE)
}

const getFinitePayloadNumber = (payload, field, fieldErrors, label) => {
  const rawValue = payload[field]
  const value = Number(rawValue)

  if (
    rawValue === null ||
    String(rawValue ?? '').trim() === '' ||
    !Number.isFinite(value)
  ) {
    fieldErrors[field] = `${label} must be a finite number.`
    return Number.NaN
  }

  return value
}

const normalizeStartingRatingScalePayload = (payload = {}) => {
  if (!isPlainObject(payload)) {
    throw new StartingRatingScaleError('Request body must be an object.', 400)
  }

  const supportedFields = ['center', 'max', 'min', 'mode', 'spread']
  const unsupportedFields = Object.keys(payload).filter(
    (field) => !supportedFields.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new StartingRatingScaleError(
      'Request body contains unsupported starting rating scale fields.',
      400,
      { unsupportedFields },
    )
  }

  const mode = payload.mode
  const fieldErrors = {}
  const hasRangeFields =
    Object.hasOwn(payload, 'min') || Object.hasOwn(payload, 'max')
  let min
  let max

  if (!Object.values(STARTING_RATING_SCALE_MODES).includes(mode)) {
    fieldErrors.mode = 'Starting Rating Scale mode must be standard or custom.'
  }

  if (hasRangeFields) {
    min = getFinitePayloadNumber(
      payload,
      'min',
      fieldErrors,
      'Minimum starting rating',
    )
    max = getFinitePayloadNumber(
      payload,
      'max',
      fieldErrors,
      'Maximum starting rating',
    )
  } else {
    const center = getFinitePayloadNumber(
      payload,
      'center',
      fieldErrors,
      'Center',
    )
    const spread = getFinitePayloadNumber(
      payload,
      'spread',
      fieldErrors,
      'Total spread',
    )
    const range = deriveStartingRatingRange({ center, spread })

    min = range.min
    max = range.max
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

  let normalizedScale = null

  if (
    mode === STARTING_RATING_SCALE_MODES.STANDARD &&
    Number.isFinite(min) &&
    Number.isFinite(max)
  ) {
    const standardScale = hasRangeFields
      ? getStandardScaleByRange({ max, min })
      : getStandardScaleBySpread(Number(payload.spread))

    if (!standardScale) {
      fieldErrors.mode = 'Choose a supported standard Starting Rating Scale.'
    } else {
      normalizedScale = serializeStandardScale(standardScale)
    }
  }

  if (
    mode === STARTING_RATING_SCALE_MODES.CUSTOM &&
    Object.keys(fieldErrors).length === 0
  ) {
    const derived = deriveStartingRatingCenterAndSpread({ max, min })

    normalizedScale = serializeStartingRatingScale({
      ...derived,
      mode: STARTING_RATING_SCALE_MODES.CUSTOM,
    })
  }

  if (Object.keys(fieldErrors).length > 0 || !normalizedScale) {
    throw new StartingRatingScaleError(
      'Starting Rating Scale validation failed.',
      400,
      { fieldErrors },
    )
  }

  return normalizedScale
}

const getSettingsModel = (options = {}) =>
  options.settingsModel ?? PowerRatingSettings

const getStartingRatingScale = async (userId, options = {}) => {
  if (!userId) {
    throw new StartingRatingScaleError('Authenticated userId is required.', 401)
  }

  const settings = await getSettingsModel(options).findOne({ userId })
  const scale = normalizeStartingRatingScale(settings)

  return {
    scale,
    usingDefault: scale.calibratedDefault,
  }
}

const updateStartingRatingScale = async (
  userId,
  payload = {},
  options = {},
) => {
  if (!userId) {
    throw new StartingRatingScaleError('Authenticated userId is required.', 401)
  }

  const scale = normalizeStartingRatingScalePayload(payload)
  const settings = await getSettingsModel(options).findOneAndUpdate(
    { userId },
    {
      $set: {
        startingRatingCenter: scale.center,
        startingRatingScaleMode: scale.mode,
        startingRatingSpread: scale.spread,
      },
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
    scale: normalizeStartingRatingScale(settings ?? scale),
    success: true,
  }
}

const validateStartingRatingAssignment = (value, scale) => {
  const rating = Number(value)
  const normalizedScale = normalizeStartingRatingScale(scale)

  if (!Number.isFinite(rating)) {
    throw new StartingRatingScaleError(
      'Starting Rating must be a finite number.',
      400,
      { field: 'baseRating' },
    )
  }

  if (rating < normalizedScale.min || rating > normalizedScale.max) {
    throw new StartingRatingScaleError(
      `Starting Rating must be between ${formatStartingRatingBoundary(normalizedScale.min)} and ${formatStartingRatingBoundary(normalizedScale.max)}.`,
      400,
      {
        field: 'baseRating',
        max: normalizedScale.max,
        min: normalizedScale.min,
      },
    )
  }

  if (!isRatingAlignedToStep(rating)) {
    throw new StartingRatingScaleError(
      `Starting Rating must use ${STARTING_RATING_ASSIGNMENT_STEP}-point increments.`,
      400,
      {
        field: 'baseRating',
        step: STARTING_RATING_ASSIGNMENT_STEP,
      },
    )
  }

  return rating
}

module.exports = {
  DEFAULT_STARTING_RATING_SCALE,
  STANDARD_STARTING_RATING_SCALES,
  STANDARD_STARTING_RATING_SPREADS,
  STARTING_RATING_ASSIGNMENT_STEP,
  STARTING_RATING_SCALE_LIMITS,
  STARTING_RATING_SCALE_MODES,
  StartingRatingScaleError,
  deriveStartingRatingCenterAndSpread,
  deriveStartingRatingRange,
  getStartingRatingScale,
  isRatingAlignedToStep,
  normalizeStartingRatingScale,
  normalizeStartingRatingScalePayload,
  updateStartingRatingScale,
  validateStartingRatingAssignment,
}
