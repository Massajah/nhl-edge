import { BANKROLL_DEFAULT_CURRENCY } from './bankroll.js'
import {
  createKellyStakeRecommendation,
} from './kellyStaking.js'
import { calculateProfit } from './savedAnalyses.js'

const POSITIVE_EPSILON = 1e-9

export const DASHBOARD_GAME_STATUSES = Object.freeze({
  ANALYZED_NO_VALUE: 'ANALYZED_NO_VALUE',
  BET_CANDIDATE: 'BET_CANDIDATE',
  BET_SAVED: 'BET_SAVED',
  FINAL: 'FINAL',
  GAME_STARTED: 'GAME_STARTED',
  NEEDS_ODDS: 'NEEDS_ODDS',
  NOT_ANALYZED: 'NOT_ANALYZED',
  POTENTIAL_VALUE: 'POTENTIAL_VALUE',
})

export const DASHBOARD_GAME_STATUS_PRESENTATION = Object.freeze({
  [DASHBOARD_GAME_STATUSES.ANALYZED_NO_VALUE]: {
    label: 'No current value',
    tone: 'neutral',
  },
  [DASHBOARD_GAME_STATUSES.BET_CANDIDATE]: {
    label: 'Bet candidate',
    tone: 'candidate',
  },
  [DASHBOARD_GAME_STATUSES.BET_SAVED]: {
    label: 'Bet saved',
    tone: 'saved',
  },
  [DASHBOARD_GAME_STATUSES.FINAL]: {
    label: 'Final',
    tone: 'final',
  },
  [DASHBOARD_GAME_STATUSES.GAME_STARTED]: {
    label: 'In progress',
    tone: 'neutral',
  },
  [DASHBOARD_GAME_STATUSES.NEEDS_ODDS]: {
    label: 'Add odds',
    tone: 'needs-odds',
  },
  [DASHBOARD_GAME_STATUSES.NOT_ANALYZED]: {
    label: '',
    tone: 'neutral',
  },
  [DASHBOARD_GAME_STATUSES.POTENTIAL_VALUE]: {
    label: 'Worth reviewing',
    tone: 'attention',
  },
})

export const toLocalDateValue = (date = new Date()) => {
  const safeDate = date instanceof Date ? date : new Date(date)

  if (Number.isNaN(safeDate.getTime())) {
    return toLocalDateValue(new Date())
  }

  const year = safeDate.getFullYear()
  const month = String(safeDate.getMonth() + 1).padStart(2, '0')
  const day = String(safeDate.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export const parseLocalDateValue = (dateValue) => {
  const [year, month, day] = String(dateValue ?? '').split('-').map(Number)
  const parsedDate = new Date(year, month - 1, day, 12)

  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
}

export const shiftLocalDateValue = (dateValue, dayCount) => {
  const nextDate = parseLocalDateValue(dateValue)
  nextDate.setDate(nextDate.getDate() + dayCount)

  return toLocalDateValue(nextDate)
}

export const getPreviousLocalDateValue = (dateValue) =>
  shiftLocalDateValue(dateValue, -1)

export const getDashboardDateContextLabels = ({
  selectedDateValue,
  todayDateValue = toLocalDateValue(new Date()),
} = {}) => {
  const isCurrentLocalDate =
    Boolean(selectedDateValue) && selectedDateValue === todayDateValue

  return {
    activityAriaLabel: isCurrentLocalDate
      ? "Today's game activity"
      : 'Selected day game activity',
    gameBetsLabel: isCurrentLocalDate ? "today's games" : "selected day's games",
    gamesEyebrow: isCurrentLocalDate ? "Today's Games" : 'Selected Day',
    gamesTitlePrefix: isCurrentLocalDate ? '' : 'Games on ',
    isCurrentLocalDate,
    previousEyebrow: isCurrentLocalDate ? 'Last Night' : 'Previous Day',
  }
}

export const getGameLocalDateValue = (game = {}) =>
  game.startTimeUTC ? toLocalDateValue(new Date(game.startTimeUTC)) : ''

export const isGameFinal = (game = {}) =>
  String(game.gameState ?? '').toUpperCase() === 'FINAL' ||
  String(game.gameState ?? '').toUpperCase() === 'OFF' ||
  String(game.status ?? '').toLowerCase().includes('final')

export const isGameStarted = (game = {}) => {
  const gameState = String(game.gameState ?? '').toUpperCase()

  if (!gameState) {
    return isGameFinal(game)
  }

  return !['FUT', 'PRE'].includes(gameState) || isGameFinal(game)
}

const getGameId = (gameOrBet = {}) =>
  String(gameOrBet.gameId ?? gameOrBet.id ?? '').trim()

const toNumber = (value, fallback = 0) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const toNullableNumber = (value) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

export const groupBetsByGameId = (bets = []) =>
  bets.reduce((groups, bet) => {
    const gameId = getGameId(bet)

    if (!gameId) {
      return groups
    }

    groups[gameId] = [...(groups[gameId] ?? []), bet]

    return groups
  }, {})

export const getBetsForGames = (bets = [], games = []) => {
  const gameIds = new Set(games.map(getGameId).filter(Boolean))

  return bets.filter((bet) => gameIds.has(getGameId(bet)))
}

export const summarizeSavedBets = (bets = []) => {
  const betCount = bets.length
  const totalStake = bets.reduce((total, bet) => total + toNumber(bet.stake), 0)
  const pendingCount = bets.filter((bet) => bet.result === 'pending').length
  const firstBet = bets[0] ?? null

  return {
    betCount,
    firstBet,
    hasBets: betCount > 0,
    pendingCount,
    totalStake: Number(totalStake.toFixed(2)),
  }
}

export const getModelLean = (analysis, awayTeam = {}, homeTeam = {}) => {
  const awayProbability = toNullableNumber(analysis?.awayMarket?.modelProbability)
  const homeProbability = toNullableNumber(analysis?.homeMarket?.modelProbability)

  if (awayProbability === null || homeProbability === null) {
    return {
      probability: null,
      side: '',
      team: null,
    }
  }

  return homeProbability >= awayProbability
    ? {
        probability: homeProbability,
        side: 'home',
        team: homeTeam,
      }
    : {
        probability: awayProbability,
        side: 'away',
        team: awayTeam,
      }
}

const getDashboardSideOpportunities = ({
  analysis,
  awayTeam = {},
  bankrollSummary = null,
  bettingSettings,
  homeTeam = {},
}) => {
  if (!analysis) {
    return []
  }

  return [
    {
      market: analysis.awayMarket,
      side: 'away',
      team: awayTeam,
    },
    {
      market: analysis.homeMarket,
      side: 'home',
      team: homeTeam,
    },
  ].map((side) => {
    const recommendation = createKellyStakeRecommendation({
      bankrollSummary,
      decimalOdds: side.market?.marketOdds,
      modelProbability: side.market?.modelProbability,
      settings: bettingSettings,
    })
    const edge = toNullableNumber(side.market?.edge)
    const expectedValue = toNullableNumber(side.market?.expectedValue)
    const hasValidOdds = toNullableNumber(side.market?.marketOdds) !== null
    const hasPositiveEdge = edge !== null && edge > POSITIVE_EPSILON

    return {
      ...side,
      edge,
      expectedValue,
      hasPositiveEdge,
      hasValidOdds,
      recommendation,
    }
  })
}

const getBestOpportunity = (opportunities = []) =>
  opportunities
    .filter((opportunity) => opportunity.hasValidOdds && opportunity.hasPositiveEdge)
    .sort((opportunityA, opportunityB) => {
      const edgeDifference =
        toNumber(opportunityB.edge) - toNumber(opportunityA.edge)

      if (edgeDifference !== 0) {
        return edgeDifference
      }

      return toNumber(opportunityB.expectedValue) - toNumber(opportunityA.expectedValue)
    })[0] ?? null

export const getDashboardGameStatus = ({
  analysis = null,
  awayTeam = {},
  bankrollSummary = null,
  bettingSettings,
  game = {},
  homeTeam = {},
  savedBets = [],
} = {}) => {
  const savedBetSummary = summarizeSavedBets(savedBets)

  if (savedBetSummary.hasBets) {
    return {
      bestOpportunity: null,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.BET_SAVED,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.BET_SAVED],
    }
  }

  if (isGameFinal(game)) {
    return {
      bestOpportunity: null,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.FINAL,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.FINAL],
    }
  }

  if (isGameStarted(game)) {
    return {
      bestOpportunity: null,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.GAME_STARTED,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.GAME_STARTED],
    }
  }

  if (!analysis) {
    return {
      bestOpportunity: null,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.NOT_ANALYZED,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.NOT_ANALYZED],
    }
  }

  const opportunities = getDashboardSideOpportunities({
    analysis,
    awayTeam,
    bankrollSummary,
    bettingSettings,
    homeTeam,
  })
  const bestOpportunity = getBestOpportunity(opportunities)
  const hasAnyOdds = opportunities.some((opportunity) => opportunity.hasValidOdds)
  const hasCandidate = opportunities.some(
    (opportunity) =>
      opportunity.hasValidOdds &&
      opportunity.hasPositiveEdge &&
      opportunity.recommendation?.eligible,
  )

  if (hasCandidate) {
    return {
      bestOpportunity,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.BET_CANDIDATE,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.BET_CANDIDATE],
    }
  }

  if (bestOpportunity) {
    return {
      bestOpportunity,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.POTENTIAL_VALUE,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.POTENTIAL_VALUE],
    }
  }

  if (!hasAnyOdds) {
    return {
      bestOpportunity: null,
      savedBetSummary,
      status: DASHBOARD_GAME_STATUSES.NEEDS_ODDS,
      statusPresentation:
        DASHBOARD_GAME_STATUS_PRESENTATION[DASHBOARD_GAME_STATUSES.NEEDS_ODDS],
    }
  }

  return {
    bestOpportunity: null,
    savedBetSummary,
    status: DASHBOARD_GAME_STATUSES.ANALYZED_NO_VALUE,
    statusPresentation:
      DASHBOARD_GAME_STATUS_PRESENTATION[
        DASHBOARD_GAME_STATUSES.ANALYZED_NO_VALUE
      ],
  }
}

export const hasModelProbabilities = (analysis = null) =>
  Number.isFinite(analysis?.awayMarket?.modelProbability) &&
  Number.isFinite(analysis?.homeMarket?.modelProbability)

export const buildTodayActivitySummary = ({
  bets = [],
  gameStatuses = [],
  games = [],
  preliminaryAnalyses = [],
} = {}) => {
  const todayBets = getBetsForGames(bets, games)

  return {
    analyzedCount: preliminaryAnalyses.filter(hasModelProbabilities).length,
    candidateCount: gameStatuses.filter(
      (status) => status.status === DASHBOARD_GAME_STATUSES.BET_CANDIDATE,
    ).length,
    gameCount: games.length,
    savedBetCount: todayBets.length,
  }
}

export const buildOpenBetSummary = (bets = []) => {
  const openBets = bets.filter((bet) => bet.result === 'pending')
  const pendingExposure = openBets.reduce(
    (total, bet) => total + toNumber(bet.stake),
    0,
  )

  return {
    openBetCount: openBets.length,
    pendingExposure: Number(pendingExposure.toFixed(2)),
  }
}

export const getBetProfit = (bet = {}) =>
  Number.isFinite(bet.profit) ? bet.profit : calculateProfit(bet)

export const buildLastNightBettingSummary = (bets = []) =>
  bets.reduce(
    (summary, bet) => {
      const profit = getBetProfit(bet)

      summary.betCount += 1

      if (bet.result === 'win') {
        summary.wonCount += 1
        summary.netProfit += profit
      } else if (bet.result === 'loss') {
        summary.lostCount += 1
        summary.netProfit += profit
      } else if (bet.result === 'pending') {
        summary.pendingCount += 1
      } else {
        summary.netProfit += profit
      }

      summary.netProfit = Number(summary.netProfit.toFixed(2))

      return summary
    },
    {
      betCount: 0,
      lostCount: 0,
      netProfit: 0,
      pendingCount: 0,
      wonCount: 0,
    },
  )

export const getWinner = (game = {}) => {
  const awayScore = toNullableNumber(game.awayTeam?.score)
  const homeScore = toNullableNumber(game.homeTeam?.score)

  if (awayScore === null || homeScore === null || awayScore === homeScore) {
    return null
  }

  return awayScore > homeScore ? game.awayTeam : game.homeTeam
}

export const getDashboardCurrency = (bankrollSummary = null) =>
  bankrollSummary?.currency ?? BANKROLL_DEFAULT_CURRENCY
