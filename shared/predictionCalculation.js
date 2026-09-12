// Shared browser/Node calculation. Keep changes versioned and fixture-tested.
const DEFAULT_PROBABILITY_SCALE = 20

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const MINIMUM_POSITIVE_EV = 3

const MODEL_STATUSES = {
  BET_CANDIDATE: 'Bet Candidate',
  POSITIVE_VALUE: 'Positive Value',
  POSITIVE_VALUE_BELOW_THRESHOLD: 'Positive Value · Below Threshold',
  BELOW_THRESHOLD: 'Below Threshold',
  NO_VALUE: 'No Value',
  LEGACY: 'Legacy bet',
}

const ADD_MARKET_ODDS_STATUS = 'Add market odds'

const PROBABILITY_EDGE_HELP_TEXT =
  'Probability Edge = difference between the model probability and the market implied probability, measured in percentage points (pp).'

const isValidProbability = (value) =>
  Number.isFinite(value) && value > 0 && value <= 1

const parseMarketOdds = (decimalOdds) => {
  if (decimalOdds === '' || decimalOdds === null || decimalOdds === undefined) {
    return null
  }

  const parsedOdds = Number(decimalOdds)

  return Number.isFinite(parsedOdds) && parsedOdds > 1 ? parsedOdds : null
}

const calculateFairOdds = (modelProbability) => {
  const probability = Number(modelProbability)

  return isValidProbability(probability) ? 1 / probability : null
}

const calculateImpliedProbability = (decimalOdds) => {
  const marketOdds = parseMarketOdds(decimalOdds)

  return marketOdds ? 1 / marketOdds : null
}

const calculateProbabilityEdge = (
  modelProbability,
  impliedMarketProbability,
) => {
  const probability = Number(modelProbability)

  return isValidProbability(probability) &&
    Number.isFinite(impliedMarketProbability) &&
    impliedMarketProbability > 0 &&
    impliedMarketProbability <= 1
    ? probability - impliedMarketProbability
    : null
}

const calculateExpectedValue = (modelProbability, marketOdds) => {
  const probability = Number(modelProbability)
  const parsedMarketOdds = parseMarketOdds(marketOdds)

  return isValidProbability(probability) && parsedMarketOdds
    ? (probability * parsedMarketOdds - 1) * 100
    : null
}

const calculateOddsDifference = (marketOdds, fairOdds) => {
  const parsedMarketOdds = parseMarketOdds(marketOdds)

  return parsedMarketOdds && Number.isFinite(fairOdds)
    ? parsedMarketOdds - fairOdds
    : null
}

const getModelStatus = (
  expectedValue,
  minimumPositiveEv = MINIMUM_POSITIVE_EV,
) => {
  if (
    expectedValue === null ||
    expectedValue === '' ||
    expectedValue === undefined
  ) {
    return null
  }

  const value = Number(expectedValue)
  const threshold = Number(minimumPositiveEv)

  if (!Number.isFinite(value) || !Number.isFinite(threshold)) {
    return null
  }

  if (value >= threshold) {
    return MODEL_STATUSES.POSITIVE_VALUE
  }

  if (value >= 0) {
    return MODEL_STATUSES.BELOW_THRESHOLD
  }

  return MODEL_STATUSES.NO_VALUE
}

const normalizeModelStatus = (status) => {
  const normalizedStatus =
    typeof status === 'string' ? status.trim().toLowerCase() : ''

  if (normalizedStatus === 'positive value') {
    return MODEL_STATUSES.POSITIVE_VALUE
  }

  if (
    normalizedStatus === 'positive value · below threshold' ||
    normalizedStatus === 'positive value below threshold' ||
    normalizedStatus === 'positive_value_below_threshold'
  ) {
    return MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD
  }

  if (
    normalizedStatus === 'bet candidate' ||
    normalizedStatus === 'bet_candidate'
  ) {
    return MODEL_STATUSES.BET_CANDIDATE
  }

  if (normalizedStatus === 'below threshold') {
    return MODEL_STATUSES.BELOW_THRESHOLD
  }

  if (normalizedStatus === 'no value') {
    return MODEL_STATUSES.NO_VALUE
  }

  if (normalizedStatus === 'legacy bet') {
    return MODEL_STATUSES.LEGACY
  }

  return null
}

const getValueRecommendation = ({
  expectedValue,
  marketOdds,
  minimumPositiveEv = MINIMUM_POSITIVE_EV,
}) => {
  if (!parseMarketOdds(marketOdds)) {
    return ADD_MARKET_ODDS_STATUS
  }

  return getModelStatus(expectedValue, minimumPositiveEv)
}

const calculateMarketComparison = ({
  marketOdds,
  minimumPositiveEv = MINIMUM_POSITIVE_EV,
  modelProbability,
}) => {
  const fairOdds = calculateFairOdds(modelProbability)
  const parsedMarketOdds = parseMarketOdds(marketOdds)
  const impliedProbability = calculateImpliedProbability(marketOdds)
  const probabilityEdge = calculateProbabilityEdge(
    modelProbability,
    impliedProbability,
  )
  const expectedValue = calculateExpectedValue(modelProbability, marketOdds)
  const oddsDifference = calculateOddsDifference(marketOdds, fairOdds)
  const modelStatus = parsedMarketOdds
    ? getModelStatus(expectedValue, minimumPositiveEv)
    : null

  return {
    expectedValue,
    fairOdds,
    hasValidMarketOdds: Boolean(parsedMarketOdds),
    impliedProbability,
    marketOdds: parsedMarketOdds,
    modelProbability,
    modelStatus,
    oddsDifference,
    probabilityEdge,
    recommendation: modelStatus ?? ADD_MARKET_ODDS_STATUS,
  }
}

function calculateGame(
  home,
  away,
  probabilityScale = DEFAULT_PROBABILITY_SCALE,
) {
  const homeInjuryAdjustment =
    toNumber(home.storedInjuryImpact) + toNumber(home.injuries)
  const awayInjuryAdjustment =
    toNumber(away.storedInjuryImpact) + toNumber(away.injuries)
  const homeFinalRating =
    toNumber(home.baseRating) +
    toNumber(home.homeAdvantage) +
    homeInjuryAdjustment +
    toNumber(home.goalieAdjustment) +
    toNumber(home.restFatigue ?? home.recentForm) +
    toNumber(home.quickRematchAdjustment) +
    toNumber(home.specialTeamsAdjustment) +
    toNumber(home.motivation) +
    toNumber(home.manualAdjustment)

  const awayFinalRating =
    toNumber(away.baseRating) +
    awayInjuryAdjustment +
    toNumber(away.goalieAdjustment) +
    toNumber(away.restFatigue ?? away.recentForm) +
    toNumber(away.quickRematchAdjustment) +
    toNumber(away.specialTeamsAdjustment) +
    toNumber(away.motivation) +
    toNumber(away.manualAdjustment)

  const ratingDifference = homeFinalRating - awayFinalRating
  const parsedProbabilityScale = Number(probabilityScale)
  const normalizedProbabilityScale =
    Number.isFinite(parsedProbabilityScale) && parsedProbabilityScale > 0
      ? parsedProbabilityScale
      : DEFAULT_PROBABILITY_SCALE
  const homeWinProbability =
    1 / (1 + Math.exp(-ratingDifference / normalizedProbabilityScale))
  const awayWinProbability = 1 - homeWinProbability
  const homeMarket = calculateMarketComparison({
    marketOdds: home.marketOdds,
    modelProbability: homeWinProbability,
  })
  const awayMarket = calculateMarketComparison({
    marketOdds: away.marketOdds,
    modelProbability: awayWinProbability,
  })

  return {
    homeFinalRating,
    awayFinalRating,
    ratingDifference,
    probabilityScale: normalizedProbabilityScale,
    homeWinProbability,
    awayWinProbability,
    homeFairOdds: homeMarket.fairOdds,
    awayFairOdds: awayMarket.fairOdds,
    homeImpliedProbability: homeMarket.impliedProbability,
    awayImpliedProbability: awayMarket.impliedProbability,
    homeEdge: homeMarket.probabilityEdge,
    awayEdge: awayMarket.probabilityEdge,
    homeExpectedValue: homeMarket.expectedValue,
    awayExpectedValue: awayMarket.expectedValue,
    homeOddsDifference: homeMarket.oddsDifference,
    awayOddsDifference: awayMarket.oddsDifference,
    homeModelStatus: homeMarket.modelStatus,
    awayModelStatus: awayMarket.modelStatus,
    homeRecommendation: homeMarket.recommendation,
    awayRecommendation: awayMarket.recommendation,
  }
}

const predictionCalculation = { DEFAULT_PROBABILITY_SCALE, toNumber, MINIMUM_POSITIVE_EV, MODEL_STATUSES, ADD_MARKET_ODDS_STATUS, PROBABILITY_EDGE_HELP_TEXT, parseMarketOdds, calculateFairOdds, calculateImpliedProbability, calculateProbabilityEdge, calculateExpectedValue, calculateOddsDifference, getModelStatus, normalizeModelStatus, getValueRecommendation, calculateMarketComparison, calculateGame }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = predictionCalculation
}
if (typeof globalThis !== 'undefined') {
  globalThis.__NHL_EDGE_PREDICTION_CALCULATION__ = predictionCalculation
}

