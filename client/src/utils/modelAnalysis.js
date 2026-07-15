import { calculateGame, calculateImpliedProbability } from './calculateGame.js'
import { getTeamInjurySummary } from './injuries.js'
import { getTeamPowerRating } from './powerRatings.js'

export const defaultGameInputs = {
  home: {
    baseRating: 50,
    marketOdds: 1.85,
    storedInjuryImpact: 0,
    homeAdvantage: 0,
    injuries: 0,
    goalieAdjustment: 0,
    recentForm: 0,
    motivation: 0,
  },
  away: {
    baseRating: 50,
    marketOdds: 2.05,
    storedInjuryImpact: 0,
    injuries: 0,
    goalieAdjustment: 0,
    recentForm: 0,
    motivation: 0,
  },
}

const parseMarketOdds = (value) => {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) && parsedValue >= 1.01
    ? parsedValue
    : null
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
  const parsedMarketOdds = parseMarketOdds(marketOdds)

  if (!parsedMarketOdds) {
    return {
      edge: null,
      fairOdds,
      impliedProbability: null,
      marketOdds: null,
      modelProbability,
      oddsValuePercentage: null,
    }
  }

  const impliedProbability = calculateImpliedProbability(parsedMarketOdds)
  const edge = modelProbability - impliedProbability

  return {
    edge,
    fairOdds,
    impliedProbability,
    marketOdds: parsedMarketOdds,
    modelProbability,
    oddsValuePercentage: parsedMarketOdds / fairOdds - 1,
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
  const bestEdge = Math.max(homeMarket.edge ?? -Infinity, awayMarket.edge ?? -Infinity)
  const bestOddsValue = Math.max(
    homeMarket.oddsValuePercentage ?? -Infinity,
    awayMarket.oddsValuePercentage ?? -Infinity,
  )
  const hasPositiveValue =
    hasAnyMarketOdds && (bestEdge > 0 || bestOddsValue > 0)

  return {
    awayFinalRating: result.awayFinalRating,
    awayMarket,
    hasAnyMarketOdds,
    hasPositiveValue,
    homeFinalRating: result.homeFinalRating,
    homeMarket,
    inputs,
    status: !hasAnyMarketOdds
      ? 'Add market odds'
      : hasPositiveValue
        ? 'Potential value'
        : 'No preliminary value',
  }
}
