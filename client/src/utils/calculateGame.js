import '../../../shared/predictionCalculation.js'

export const {
  toNumber,
  MINIMUM_POSITIVE_EV,
  MODEL_STATUSES,
  ADD_MARKET_ODDS_STATUS,
  PROBABILITY_EDGE_HELP_TEXT,
  parseMarketOdds,
  calculateFairOdds,
  calculateImpliedProbability,
  calculateProbabilityEdge,
  calculateExpectedValue,
  calculateOddsDifference,
  getModelStatus,
  normalizeModelStatus,
  getValueRecommendation,
  calculateMarketComparison,
  calculateGame,
} = globalThis.__NHL_EDGE_PREDICTION_CALCULATION__
