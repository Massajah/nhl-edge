const DEFAULT_RATING_ENGINE_CONFIGURATION = Object.freeze({
  modelVersion: 'power-rating-v1',
  kFactor: 1.2,
  regulationMultiplier: 1.0,
  overtimeMultiplier: 0.7,
  shootoutMultiplier: 0.5,
})

const DEFAULT_BASE_RATING = 50
const PROBABILITY_SCALE = 6
const PROBABILITY_TOLERANCE = 1e-9
const RESULT_TYPES = Object.freeze({
  REGULATION: 'regulation',
  OVERTIME: 'overtime',
  SHOOTOUT: 'shootout',
  UNRESOLVED: 'unresolved',
})
const WINNERS = Object.freeze({
  HOME: 'home',
  AWAY: 'away',
})
const COMPLETED_GAME_STATES = new Set(['FINAL', 'OFF'])
const RESULT_TYPE_BY_NHL_PERIOD_TYPE = Object.freeze({
  REG: RESULT_TYPES.REGULATION,
  REGULAR: RESULT_TYPES.REGULATION,
  REGULATION: RESULT_TYPES.REGULATION,
  OT: RESULT_TYPES.OVERTIME,
  OVERTIME: RESULT_TYPES.OVERTIME,
  SO: RESULT_TYPES.SHOOTOUT,
  SHOOTOUT: RESULT_TYPES.SHOOTOUT,
})
const MULTIPLIER_FIELD_BY_RESULT_TYPE = Object.freeze({
  [RESULT_TYPES.REGULATION]: 'regulationMultiplier',
  [RESULT_TYPES.OVERTIME]: 'overtimeMultiplier',
  [RESULT_TYPES.SHOOTOUT]: 'shootoutMultiplier',
})
const CONFIGURATION_LIMITS = Object.freeze({
  kFactor: { max: 10, min: 0, minExclusive: true },
  regulationMultiplier: { max: 2, min: 0 },
  overtimeMultiplier: { max: 2, min: 0 },
  shootoutMultiplier: { max: 2, min: 0 },
})

class PowerRatingEngineError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message)
    this.name = 'PowerRatingEngineError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toFiniteNumber = (value, field) => {
  const numberValue = Number(value)

  if (!Number.isFinite(numberValue)) {
    throw new PowerRatingEngineError(`${field} must be a finite number.`, 400, {
      field,
    })
  }

  return numberValue
}

const validateConfigurationValue = (field, value) => {
  const numberValue = toFiniteNumber(value, `configuration.${field}`)
  const limits = CONFIGURATION_LIMITS[field]
  const belowMinimum = limits.minExclusive
    ? numberValue <= limits.min
    : numberValue < limits.min

  if (belowMinimum || numberValue > limits.max) {
    const minimumLabel = limits.minExclusive
      ? `greater than ${limits.min}`
      : `at least ${limits.min}`

    throw new PowerRatingEngineError(
      `configuration.${field} must be ${minimumLabel} and no more than ${limits.max}.`,
      400,
      { field: `configuration.${field}` },
    )
  }

  return numberValue
}

const createRatingEngineConfiguration = (overrides = {}) => {
  if (overrides === null || overrides === undefined) {
    return { ...DEFAULT_RATING_ENGINE_CONFIGURATION }
  }

  if (!isPlainObject(overrides)) {
    throw new PowerRatingEngineError('configuration must be an object.', 400, {
      field: 'configuration',
    })
  }

  if (
    Object.hasOwn(overrides, 'modelVersion') &&
    overrides.modelVersion !== DEFAULT_RATING_ENGINE_CONFIGURATION.modelVersion
  ) {
    throw new PowerRatingEngineError(
      `configuration.modelVersion must be ${DEFAULT_RATING_ENGINE_CONFIGURATION.modelVersion}.`,
      400,
      { field: 'configuration.modelVersion' },
    )
  }

  const supportedFields = new Set([
    ...Object.keys(CONFIGURATION_LIMITS),
    'modelVersion',
  ])
  const unsupportedFields = Object.keys(overrides).filter(
    (field) => !supportedFields.has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new PowerRatingEngineError(
      'configuration contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  return Object.keys(CONFIGURATION_LIMITS).reduce(
    (configuration, field) => ({
      ...configuration,
      [field]: Object.hasOwn(overrides, field)
        ? validateConfigurationValue(field, overrides[field])
        : configuration[field],
    }),
    { ...DEFAULT_RATING_ENGINE_CONFIGURATION },
  )
}

const normalizeSideAdjustment = (automaticAdjustments, side) => {
  const legacyField = `${side}Adjustment`
  const sideValue = automaticAdjustments[side]
  const legacyValue = automaticAdjustments[legacyField]

  if (sideValue === null || sideValue === undefined) {
    return Object.hasOwn(automaticAdjustments, legacyField)
      ? toFiniteNumber(legacyValue, `automaticAdjustments.${legacyField}`)
      : 0
  }

  if (isPlainObject(sideValue)) {
    return Object.hasOwn(sideValue, 'total')
      ? toFiniteNumber(sideValue.total, `automaticAdjustments.${side}.total`)
      : 0
  }

  return toFiniteNumber(sideValue, `automaticAdjustments.${side}`)
}

const normalizeAutomaticAdjustments = (automaticAdjustments = {}) => {
  if (automaticAdjustments === null || automaticAdjustments === undefined) {
    return {
      away: { total: 0 },
      home: { total: 0 },
    }
  }

  if (!isPlainObject(automaticAdjustments)) {
    throw new PowerRatingEngineError(
      'automaticAdjustments must be an object.',
      400,
      { field: 'automaticAdjustments' },
    )
  }

  return {
    away: {
      total: normalizeSideAdjustment(automaticAdjustments, WINNERS.AWAY),
    },
    home: {
      total: normalizeSideAdjustment(automaticAdjustments, WINNERS.HOME),
    },
  }
}

const calculateLogisticProbability = (ratingDifference) => {
  const scaledDifference = ratingDifference / PROBABILITY_SCALE

  if (scaledDifference >= 0) {
    const exponent = Math.exp(-scaledDifference)

    return 1 / (1 + exponent)
  }

  const exponent = Math.exp(scaledDifference)

  return exponent / (1 + exponent)
}

const validateProbability = (value, field) => {
  const probability = toFiniteNumber(value, field)

  if (probability < 0 || probability > 1) {
    throw new PowerRatingEngineError(`${field} must be between 0 and 1.`, 400, {
      field,
    })
  }

  return probability
}

const validateExpectedProbabilities = ({
  awayExpectedProbability,
  homeExpectedProbability,
}) => {
  const homeProbability = validateProbability(
    homeExpectedProbability,
    'homeExpectedProbability',
  )
  const awayProbability = validateProbability(
    awayExpectedProbability,
    'awayExpectedProbability',
  )
  const probabilityTotal = homeProbability + awayProbability

  if (Math.abs(probabilityTotal - 1) > PROBABILITY_TOLERANCE) {
    throw new PowerRatingEngineError(
      'Expected probabilities must sum to 1.',
      400,
      {
        awayExpectedProbability: awayProbability,
        homeExpectedProbability: homeProbability,
      },
    )
  }

  return {
    awayExpectedProbability: awayProbability,
    homeExpectedProbability: homeProbability,
  }
}

const calculatePregameProbability = ({
  awayRating,
  automaticAdjustments = {},
  homeAdvantage,
  homeRating,
}) => {
  const normalizedHomeRating = toFiniteNumber(homeRating, 'homeRating')
  const normalizedAwayRating = toFiniteNumber(awayRating, 'awayRating')
  const normalizedHomeAdvantage = toFiniteNumber(
    homeAdvantage,
    'homeAdvantage',
  )
  const normalizedAdjustments =
    normalizeAutomaticAdjustments(automaticAdjustments)
  const homeEffectiveRating =
    normalizedHomeRating +
    normalizedHomeAdvantage +
    normalizedAdjustments.home.total
  const awayEffectiveRating =
    normalizedAwayRating + normalizedAdjustments.away.total
  const ratingDifference = homeEffectiveRating - awayEffectiveRating
  const homeProbability = calculateLogisticProbability(ratingDifference)
  const awayProbability = 1 - homeProbability

  return {
    automaticAdjustments: normalizedAdjustments,
    awayEffectiveRating,
    awayProbability,
    awayRating: normalizedAwayRating,
    homeAdvantage: normalizedHomeAdvantage,
    homeEffectiveRating,
    homeProbability,
    homeRating: normalizedHomeRating,
    probabilityScale: PROBABILITY_SCALE,
    ratingDifference,
  }
}

const calculateRatingUpdate = ({
  awayExpectedProbability,
  configuration,
  homeExpectedProbability,
  resultType,
  winner,
}) => {
  const normalizedConfiguration =
    createRatingEngineConfiguration(configuration)
  const probabilities = validateExpectedProbabilities({
    awayExpectedProbability,
    homeExpectedProbability,
  })

  if (!Object.values(WINNERS).includes(winner)) {
    throw new PowerRatingEngineError('winner must be home or away.', 400, {
      field: 'winner',
    })
  }

  const multiplierField = MULTIPLIER_FIELD_BY_RESULT_TYPE[resultType]

  if (!multiplierField) {
    throw new PowerRatingEngineError(
      'resultType must be regulation, overtime or shootout.',
      400,
      { field: 'resultType' },
    )
  }

  const resultMultiplier = normalizedConfiguration[multiplierField]
  const homeActualResult = winner === WINNERS.HOME ? 1 : 0
  const awayActualResult = 1 - homeActualResult
  const homeDelta =
    normalizedConfiguration.kFactor *
    (homeActualResult - probabilities.homeExpectedProbability) *
    resultMultiplier
  const awayDelta = -homeDelta

  return {
    awayDelta,
    homeDelta,
    resultMultiplier,
    calculationInputs: {
      awayActualResult,
      awayExpectedProbability: probabilities.awayExpectedProbability,
      configuration: normalizedConfiguration,
      homeActualResult,
      homeExpectedProbability: probabilities.homeExpectedProbability,
      resultType,
      winner,
    },
  }
}

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  return value?.default ?? ''
}

const normalizePeriodType = (periodType) =>
  getLocalizedValue(periodType).trim().toUpperCase()

const getFinalScore = (game = {}) => ({
  away: Number(game.awayTeam?.score),
  home: Number(game.homeTeam?.score),
})

const buildResultWarning = (game, code, message) => ({
  code,
  gameId: game?.id ?? game?.gameId ?? null,
  message,
  fields: {
    gameOutcome: game?.gameOutcome ?? null,
    gameScheduleState: game?.gameScheduleState ?? null,
    gameState: game?.gameState ?? null,
    periodDescriptor: game?.periodDescriptor ?? null,
  },
})

const classifyCompletedGameResult = (game = {}) => {
  const gameState = getLocalizedValue(game.gameState).toUpperCase()

  if (!COMPLETED_GAME_STATES.has(gameState)) {
    return {
      isResolved: false,
      resultType: RESULT_TYPES.UNRESOLVED,
      warning: buildResultWarning(
        game,
        'GAME_NOT_FINAL',
        'Game is not marked final by the NHL API.',
      ),
      winner: null,
    }
  }

  const finalScore = getFinalScore(game)

  if (!Number.isFinite(finalScore.home) || !Number.isFinite(finalScore.away)) {
    return {
      isResolved: false,
      resultType: RESULT_TYPES.UNRESOLVED,
      warning: buildResultWarning(
        game,
        'MISSING_FINAL_SCORE',
        'Completed game is missing a numeric final score.',
      ),
      winner: null,
    }
  }

  if (finalScore.home === finalScore.away) {
    return {
      isResolved: false,
      resultType: RESULT_TYPES.UNRESOLVED,
      warning: buildResultWarning(
        game,
        'TIED_FINAL_SCORE',
        'Completed game has a tied final score.',
      ),
      winner: null,
    }
  }

  const explicitPeriodType = normalizePeriodType(
    game.gameOutcome?.lastPeriodType ?? game.periodDescriptor?.periodType,
  )
  const resultType = RESULT_TYPE_BY_NHL_PERIOD_TYPE[explicitPeriodType]

  if (!resultType) {
    return {
      isResolved: false,
      resultType: RESULT_TYPES.UNRESOLVED,
      warning: buildResultWarning(
        game,
        'UNRESOLVED_RESULT_TYPE',
        'Completed game is missing a supported explicit NHL result type.',
      ),
      winner: null,
    }
  }

  return {
    finalScore,
    isResolved: true,
    resultType,
    warning: null,
    winner: finalScore.home > finalScore.away ? WINNERS.HOME : WINNERS.AWAY,
  }
}

module.exports = {
  DEFAULT_BASE_RATING,
  DEFAULT_RATING_ENGINE_CONFIGURATION,
  PROBABILITY_SCALE,
  PROBABILITY_TOLERANCE,
  PowerRatingEngineError,
  RESULT_TYPES,
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
  classifyCompletedGameResult,
  createRatingEngineConfiguration,
}
