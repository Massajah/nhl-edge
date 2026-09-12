import '../../../shared/predictionCalculation.js'

export const BASE_MODEL_V1 = Object.freeze({
  baseHomeAdvantage: 3.5,
  kFactor: 1.3,
  overtimeMultiplier: 0.4,
  probabilityScale: globalThis.__NHL_EDGE_PREDICTION_CALCULATION__.DEFAULT_PROBABILITY_SCALE,
  regulationMultiplier: 1,
  shootoutMultiplier: 0.1,
  startingRatings: Object.freeze({
    center: 46,
    max: 50,
    min: 42,
    spread: 8,
  }),
})

export const PRODUCTION_PROBABILITY_SCALE_LIMITS = Object.freeze({
  max: 50,
  min: 1,
})

export const MAXIMUM_GOALIE_PENALTY_LIMITS = Object.freeze({
  max: 0,
  min: -5,
})

export const DEFAULT_MAXIMUM_GOALIE_PENALTY = -4

export const MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS = Object.freeze({
  max: 0,
  min: -5,
  step: 0.5,
})

export const DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY = -2.5
