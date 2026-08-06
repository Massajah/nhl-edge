import {
  ADD_MARKET_ODDS_STATUS,
  MODEL_STATUSES,
  calculateGame,
  calculateMarketComparison,
  parseMarketOdds,
} from './calculateGame.js'
import { getTeamInjurySummary } from './injuries.js'
import { applyGameContextToInputs } from './gameContext.js'
import {
  GOALIE_SELECTION_TYPES,
  applyGameGoalieSelectionsToInputs,
  getGoalieSelectionForSide,
} from './goalies.js'
import {
  getEffectiveHomeAdvantage,
  getTeamPowerRating,
} from './powerRatings.js'

export const PRELIMINARY_ANALYSIS_INPUT_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  UNAVAILABLE: 'UNAVAILABLE',
  USES_DEFAULTS: 'USES_DEFAULTS',
})

const DEFAULTED_PRELIMINARY_INPUTS = Object.freeze([
  'away.goalieAdjustment',
  'away.restFatigue',
  'away.quickRematchAdjustment',
  'away.motivation',
  'away.manualAdjustment',
  'home.goalieAdjustment',
  'home.restFatigue',
  'home.quickRematchAdjustment',
  'home.motivation',
  'home.manualAdjustment',
])

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const toFiniteNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const getRatingTeamId = (rating = {}) =>
  normalizeIdentifier(rating.teamId ?? rating.id ?? rating.abbreviation)

const getSourcePowerRating = (powerRatings, teamId) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  if (!normalizedTeamId || !powerRatings) {
    return null
  }

  if (Array.isArray(powerRatings)) {
    return (
      powerRatings.find(
        (rating) => getRatingTeamId(rating) === normalizedTeamId,
      ) ?? null
    )
  }

  const directRating = powerRatings[normalizedTeamId]

  if (directRating) {
    return directRating
  }

  return (
    Object.entries(powerRatings).find(
      ([key, rating]) =>
        normalizeIdentifier(key) === normalizedTeamId ||
        getRatingTeamId(rating) === normalizedTeamId,
    )?.[1] ?? null
  )
}

const getMissingCoreData = ({ awayTeamId, homeTeamId, powerRatings }) => {
  const missingCoreData = []
  const teams = [
    ['away', awayTeamId],
    ['home', homeTeamId],
  ]

  teams.forEach(([side, teamId]) => {
    const normalizedTeamId = normalizeIdentifier(teamId)

    if (!normalizedTeamId) {
      missingCoreData.push(`${side}.team`)
      return
    }

    const rating = getSourcePowerRating(powerRatings, normalizedTeamId)

    if (!rating) {
      missingCoreData.push(`${side}.powerRating`)
      return
    }

    if (toFiniteNumberOrNull(rating.baseRating) === null) {
      missingCoreData.push(`${side}.baseRating`)
    }
  })

  return missingCoreData
}

export const defaultGameInputs = {
  home: {
    baseRating: 50,
    marketOdds: '',
    selectedGoalieId: '',
    selectedGoalieName: '',
    teamGoalieId: '',
    goalieSelectionType: 'unknown',
    goalieSource: 'unknown',
    goalieConfirmationStatus: 'unknown',
    goalieTeamId: '',
    goalieNhlPlayerId: null,
    goalieCustomNote: '',
    goalieTeamDefaultAdjustment: null,
    goalieManualAdjustment: null,
    goalieOverrideEnabled: false,
    storedInjuryImpact: 0,
    homeAdvantage: 0,
    injuries: 0,
    goalieAdjustment: 0,
    restFatigue: 0,
    quickRematchAdjustment: 0,
    motivation: 0,
    manualAdjustment: 0,
  },
  away: {
    baseRating: 50,
    marketOdds: '',
    selectedGoalieId: '',
    selectedGoalieName: '',
    teamGoalieId: '',
    goalieSelectionType: 'unknown',
    goalieSource: 'unknown',
    goalieConfirmationStatus: 'unknown',
    goalieTeamId: '',
    goalieNhlPlayerId: null,
    goalieCustomNote: '',
    goalieTeamDefaultAdjustment: null,
    goalieManualAdjustment: null,
    goalieOverrideEnabled: false,
    storedInjuryImpact: 0,
    injuries: 0,
    goalieAdjustment: 0,
    restFatigue: 0,
    quickRematchAdjustment: 0,
    motivation: 0,
    manualAdjustment: 0,
  },
}

export const createInputsForTeams = (
  powerRatings,
  teams,
  marketOdds = {},
  injurySummaries = {},
  baseHomeAdvantage = 0,
  gameContext = null,
) => {
  const homeRating = getTeamPowerRating(powerRatings, teams.home)
  const awayRating = getTeamPowerRating(powerRatings, teams.away)
  const homeInjurySummary = getTeamInjurySummary(injurySummaries, teams.home)
  const awayInjurySummary = getTeamInjurySummary(injurySummaries, teams.away)
  const homeMarketOdds = parseMarketOdds(marketOdds.home)
  const awayMarketOdds = parseMarketOdds(marketOdds.away)

  const inputs = {
    home: {
      ...defaultGameInputs.home,
      baseRating: homeRating.baseRating,
      homeAdvantage: getEffectiveHomeAdvantage({
        baseHomeAdvantage,
        homeRating,
      }),
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

  return applyGameGoalieSelectionsToInputs(
    applyGameContextToInputs(inputs, gameContext),
    gameContext,
    teams,
  )
}

export const applyTeamRatingsToInputs = (
  powerRatings,
  teams,
  inputs,
  injurySummaries = {},
  baseHomeAdvantage = 0,
  gameContext = null,
) => {
  const homeRating = getTeamPowerRating(powerRatings, teams.home)
  const awayRating = getTeamPowerRating(powerRatings, teams.away)
  const homeInjurySummary = getTeamInjurySummary(injurySummaries, teams.home)
  const awayInjurySummary = getTeamInjurySummary(injurySummaries, teams.away)

  const updatedInputs = {
    home: {
      ...inputs.home,
      baseRating: homeRating.baseRating,
      homeAdvantage: getEffectiveHomeAdvantage({
        baseHomeAdvantage,
        homeRating,
      }),
      storedInjuryImpact: homeInjurySummary.totalImpact,
    },
    away: {
      ...inputs.away,
      baseRating: awayRating.baseRating,
      storedInjuryImpact: awayInjurySummary.totalImpact,
    },
  }

  return applyGameContextToInputs(updatedInputs, gameContext)
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
  baseHomeAdvantage = 0,
  homeTeamId,
  marketOdds = {},
  powerRatings,
  injurySummaries = {},
  gameContext = null,
}) => {
  const missingCoreData = getMissingCoreData({
    awayTeamId,
    homeTeamId,
    powerRatings,
  })

  if (missingCoreData.length > 0) {
    return {
      available: false,
      defaultedInputFields: [],
      hasAnyMarketOdds: Boolean(
        parseMarketOdds(marketOdds.away) || parseMarketOdds(marketOdds.home),
      ),
      inputStatus: PRELIMINARY_ANALYSIS_INPUT_STATUS.UNAVAILABLE,
      missingCoreData,
      status: PRELIMINARY_ANALYSIS_INPUT_STATUS.UNAVAILABLE,
      usesUnknownInputs: false,
    }
  }

  const teams = {
    away: awayTeamId,
    home: homeTeamId,
  }
  const inputs = createInputsForTeams(
    powerRatings,
    teams,
    marketOdds,
    injurySummaries,
    baseHomeAdvantage,
    gameContext,
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

  const defaultedInputFields = (gameContext
    ? DEFAULTED_PRELIMINARY_INPUTS.filter(
        (field) =>
          !field.endsWith('.restFatigue') &&
          !field.endsWith('.quickRematchAdjustment'),
      )
    : DEFAULTED_PRELIMINARY_INPUTS
  ).filter((field) => {
    if (!field.endsWith('.goalieAdjustment')) {
      return true
    }

    const side = field.startsWith('away.') ? 'away' : 'home'

    return (
      getGoalieSelectionForSide(gameContext, side, teams[side])
        .selectionType === GOALIE_SELECTION_TYPES.UNKNOWN
    )
  })

  return {
    available: true,
    awayFinalRating: result.awayFinalRating,
    awayMarket,
    defaultedInputFields,
    hasAnyMarketOdds,
    hasPositiveValue,
    homeFinalRating: result.homeFinalRating,
    homeMarket,
    inputStatus:
      defaultedInputFields.length > 0
        ? PRELIMINARY_ANALYSIS_INPUT_STATUS.USES_DEFAULTS
        : PRELIMINARY_ANALYSIS_INPUT_STATUS.COMPLETE,
    inputs,
    missingCoreData: [],
    status: !hasAnyMarketOdds
      ? ADD_MARKET_ODDS_STATUS
      : hasPositiveValue
        ? MODEL_STATUSES.POSITIVE_VALUE
        : hasBelowThreshold
          ? MODEL_STATUSES.BELOW_THRESHOLD
          : MODEL_STATUSES.NO_VALUE,
    usesUnknownInputs: defaultedInputFields.length > 0,
  }
}
