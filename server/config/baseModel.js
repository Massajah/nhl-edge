const BASE_MODEL_V1 = Object.freeze({
  baseHomeAdvantage: 3.5,
  kFactor: 1.3,
  modelVersion: 'power-rating-v1',
  overtimeMultiplier: 0.4,
  probabilityScale: 20,
  regulationMultiplier: 1.0,
  shootoutMultiplier: 0.1,
  startingRatings: Object.freeze({
    center: 46,
    max: 50,
    min: 42,
    spread: 8,
  }),
})

const PRODUCTION_PROBABILITY_SCALE_LIMITS = Object.freeze({
  max: 50,
  min: 1,
})

const MAXIMUM_GOALIE_PENALTY_LIMITS = Object.freeze({
  max: 0,
  min: -5,
})
const DEFAULT_MAXIMUM_GOALIE_PENALTY = -4

const MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS = Object.freeze({
  max: 0,
  min: -5,
  step: 0.5,
})
const DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY = -2.5

const DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS = Object.freeze({
  homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
  kFactor: BASE_MODEL_V1.kFactor,
  maximumGoaliePenalty: DEFAULT_MAXIMUM_GOALIE_PENALTY,
  maximumPlayerInjuryPenalty: DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY,
  overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
  probabilityScale: BASE_MODEL_V1.probabilityScale,
  regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
  shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  specialTeamsAlertsEnabled: true,
  specialTeamsRankThreshold: 6,
})

module.exports = {
  BASE_MODEL_V1,
  DEFAULT_MAXIMUM_GOALIE_PENALTY,
  DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY,
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  MAXIMUM_GOALIE_PENALTY_LIMITS,
  MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS,
  PRODUCTION_PROBABILITY_SCALE_LIMITS,
}
