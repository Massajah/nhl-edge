export const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

export const MINIMUM_POSITIVE_EV = 3

export const MODEL_STATUSES = {
  POSITIVE_VALUE: 'Positive Value',
  BELOW_THRESHOLD: 'Below Threshold',
  NO_VALUE: 'No Value',
  LEGACY: 'Legacy bet',
}

export const ADD_MARKET_ODDS_STATUS = 'Add market odds'

export const PROBABILITY_EDGE_HELP_TEXT =
  'Probability Edge = difference between the model probability and the market implied probability, measured in percentage points (pp).'

const isValidProbability = (value) =>
  Number.isFinite(value) && value > 0 && value <= 1

export const parseMarketOdds = (decimalOdds) => {
  if (decimalOdds === '' || decimalOdds === null || decimalOdds === undefined) {
    return null
  }

  const parsedOdds = Number(decimalOdds)

  return Number.isFinite(parsedOdds) && parsedOdds > 1 ? parsedOdds : null
}

export const calculateFairOdds = (modelProbability) => {
  const probability = Number(modelProbability)

  return isValidProbability(probability) ? 1 / probability : null
}

export const calculateImpliedProbability = (decimalOdds) => {
  const marketOdds = parseMarketOdds(decimalOdds)

  return marketOdds ? 1 / marketOdds : null
}

export const calculateProbabilityEdge = (
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

export const calculateExpectedValue = (modelProbability, marketOdds) => {
  const probability = Number(modelProbability)
  const parsedMarketOdds = parseMarketOdds(marketOdds)

  return isValidProbability(probability) && parsedMarketOdds
    ? (probability * parsedMarketOdds - 1) * 100
    : null
}

export const calculateOddsDifference = (marketOdds, fairOdds) => {
  const parsedMarketOdds = parseMarketOdds(marketOdds)

  return parsedMarketOdds && Number.isFinite(fairOdds)
    ? parsedMarketOdds - fairOdds
    : null
}

export const getModelStatus = (
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

export const normalizeModelStatus = (status) => {
  const normalizedStatus =
    typeof status === 'string' ? status.trim().toLowerCase() : ''

  if (normalizedStatus === 'positive value') {
    return MODEL_STATUSES.POSITIVE_VALUE
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

export const getValueRecommendation = ({
  expectedValue,
  marketOdds,
  minimumPositiveEv = MINIMUM_POSITIVE_EV,
}) => {
  if (!parseMarketOdds(marketOdds)) {
    return ADD_MARKET_ODDS_STATUS
  }

  return getModelStatus(expectedValue, minimumPositiveEv)
}

export const calculateMarketComparison = ({
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

export function calculateGame(home, away) {
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
    toNumber(home.motivation) +
    toNumber(home.manualAdjustment)

  const awayFinalRating =
    toNumber(away.baseRating) +
    awayInjuryAdjustment +
    toNumber(away.goalieAdjustment) +
    toNumber(away.restFatigue ?? away.recentForm) +
    toNumber(away.quickRematchAdjustment) +
    toNumber(away.motivation) +
    toNumber(away.manualAdjustment)

  const ratingDifference = homeFinalRating - awayFinalRating
  const homeWinProbability = 1 / (1 + Math.exp(-ratingDifference / 6))
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
