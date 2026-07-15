export const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

export const calculateImpliedProbability = (decimalOdds) =>
  1 / Math.max(toNumber(decimalOdds), 1.01)

const recommendationForEdge = (edge) => {
  if (edge >= 0.05) {
    return 'BET'
  }

  if (edge >= 0.02) {
    return 'LEAN'
  }

  return 'NO BET'
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
    toNumber(home.recentForm) +
    toNumber(home.motivation)

  const awayFinalRating =
    toNumber(away.baseRating) +
    awayInjuryAdjustment +
    toNumber(away.goalieAdjustment) +
    toNumber(away.recentForm) +
    toNumber(away.motivation)

  const ratingDifference = homeFinalRating - awayFinalRating
  const homeWinProbability = 1 / (1 + Math.exp(-ratingDifference / 6))
  const awayWinProbability = 1 - homeWinProbability
  const homeImpliedProbability = calculateImpliedProbability(home.marketOdds)
  const awayImpliedProbability = calculateImpliedProbability(away.marketOdds)
  const homeEdge = homeWinProbability - homeImpliedProbability
  const awayEdge = awayWinProbability - awayImpliedProbability

  return {
    homeFinalRating,
    awayFinalRating,
    ratingDifference,
    homeWinProbability,
    awayWinProbability,
    homeFairOdds: 1 / homeWinProbability,
    awayFairOdds: 1 / awayWinProbability,
    homeImpliedProbability,
    awayImpliedProbability,
    homeEdge,
    awayEdge,
    homeRecommendation: recommendationForEdge(homeEdge),
    awayRecommendation: recommendationForEdge(awayEdge),
  }
}
