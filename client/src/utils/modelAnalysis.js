import {
  ADD_MARKET_ODDS_STATUS,
  MODEL_STATUSES,
  calculateGame,
  calculateMarketComparison,
  parseMarketOdds,
} from './calculateGame.js'
import { getTeamInjurySummary } from './injuries.js'
import { getTeamPowerRating } from './powerRatings.js'

export const defaultGameInputs = {
  home: {
    baseRating: 50,
    marketOdds: '',
    selectedGoalieId: '',
    storedInjuryImpact: 0,
    homeAdvantage: 0,
    injuries: 0,
    goalieAdjustment: 0,
    restFatigue: 0,
    motivation: 0,
    manualAdjustment: 0,
  },
  away: {
    baseRating: 50,
    marketOdds: '',
    selectedGoalieId: '',
    storedInjuryImpact: 0,
    injuries: 0,
    goalieAdjustment: 0,
    restFatigue: 0,
    motivation: 0,
    manualAdjustment: 0,
  },
}

export const createInputsForTeams = (
  powerRatings,
  teams,
  marketOdds = {},
  injurySummaries = {},
) => {
  const homeRating = getTeamPowerRating(powerRatings, teams.home)
  const awayRating = getTeamPowerRating(powerRatings, teams.away)
  const homeInjurySummary = getTeamInjurySummary(injurySummaries, teams.home)
  const awayInjurySummary = getTeamInjurySummary(injurySummaries, teams.away)
  const homeMarketOdds = parseMarketOdds(marketOdds.home)
  const awayMarketOdds = parseMarketOdds(marketOdds.away)

  return {
    home: {
      ...defaultGameInputs.home,
      baseRating: homeRating.baseRating,
      homeAdvantage: homeRating.homeAdvantage,
      storedInjuryImpact: homeInjurySummary.totalImpact,
      marketOdds: homeMarketOdds ?? defaultGameInputs.home.marketOdds,
    },
    away: {
      ...defaultGameInputs.away,
      baseRating: awayRating.baseRating,
      storedInjuryImpact: awayInjurySummary.totalImpact,
      marketOdds: awayMarketOdds ?? defaultGameInputs.away.marketOdds,
    },
  }
}

export const applyTeamRatingsToInputs = (
  powerRatings,
  teams,
  inputs,
  injurySummaries = {},
) => {
  const homeRating = getTeamPowerRating(powerRatings, teams.home)
  const awayRating = getTeamPowerRating(powerRatings, teams.away)
  const homeInjurySummary = getTeamInjurySummary(injurySummaries, teams.home)
  const awayInjurySummary = getTeamInjurySummary(injurySummaries, teams.away)

  return {
    home: {
      ...inputs.home,
      baseRating: homeRating.baseRating,
      homeAdvantage: homeRating.homeAdvantage,
      storedInjuryImpact: homeInjurySummary.totalImpact,
    },
    away: {
      ...inputs.away,
      baseRating: awayRating.baseRating,
      storedInjuryImpact: awayInjurySummary.totalImpact,
    },
  }
}

const createMarketSide = ({ fairOdds, marketOdds, modelProbability }) => {
  const comparison = calculateMarketComparison({
    marketOdds,
    modelProbability,
  })

  return {
    edge: comparison.probabilityEdge,
    expectedValue: comparison.expectedValue,
    fairOdds: comparison.fairOdds ?? fairOdds,
    impliedProbability: comparison.impliedProbability,
    marketOdds: comparison.marketOdds,
    modelProbability: comparison.modelProbability,
    modelStatus: comparison.modelStatus,
    oddsDifference: comparison.oddsDifference,
    oddsValuePercentage:
      comparison.expectedValue === null ? null : comparison.expectedValue / 100,
    recommendation: comparison.modelStatus ?? comparison.recommendation,
  }
}

export const calculatePreliminaryAnalysis = ({
  awayTeamId,
  homeTeamId,
  marketOdds = {},
  powerRatings,
  injurySummaries = {},
}) => {
  const teams = {
    away: awayTeamId,
    home: homeTeamId,
  }
  const inputs = createInputsForTeams(
    powerRatings,
    teams,
    marketOdds,
    injurySummaries,
  )
  const result = calculateGame(inputs.home, inputs.away)
  const homeMarket = createMarketSide({
    fairOdds: result.homeFairOdds,
    marketOdds: marketOdds.home,
    modelProbability: result.homeWinProbability,
  })
  const awayMarket = createMarketSide({
    fairOdds: result.awayFairOdds,
    marketOdds: marketOdds.away,
    modelProbability: result.awayWinProbability,
  })
  const hasAnyMarketOdds = Boolean(homeMarket.marketOdds || awayMarket.marketOdds)
  const hasPositiveValue =
    homeMarket.modelStatus === MODEL_STATUSES.POSITIVE_VALUE ||
    awayMarket.modelStatus === MODEL_STATUSES.POSITIVE_VALUE
  const hasBelowThreshold =
    homeMarket.modelStatus === MODEL_STATUSES.BELOW_THRESHOLD ||
    awayMarket.modelStatus === MODEL_STATUSES.BELOW_THRESHOLD

  return {
    awayFinalRating: result.awayFinalRating,
    awayMarket,
    hasAnyMarketOdds,
    hasPositiveValue,
    homeFinalRating: result.homeFinalRating,
    homeMarket,
    inputs,
    status: !hasAnyMarketOdds
      ? ADD_MARKET_ODDS_STATUS
      : hasPositiveValue
        ? MODEL_STATUSES.POSITIVE_VALUE
        : hasBelowThreshold
          ? MODEL_STATUSES.BELOW_THRESHOLD
          : MODEL_STATUSES.NO_VALUE,
  }
}
