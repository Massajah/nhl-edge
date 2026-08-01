import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let Dashboard
let GameAnalyzer
let calculateGameUtils
let dashboardUtils
let modelAnalysisUtils
let powerRatingUtils
let vite

const team = (abbreviation, name, score) => ({
  abbreviation,
  logo: '',
  name,
  score,
})

const createGame = ({
  away = team('TOR', 'Toronto Maple Leafs'),
  gameId,
  gameState = 'FUT',
  home = team('BOS', 'Boston Bruins'),
  startTimeUTC = '2026-01-15T00:00:00.000Z',
  status = 'Scheduled',
}) => ({
  awayTeam: away,
  gameId,
  gameState,
  homeTeam: home,
  startTimeUTC,
  status,
})

const createBet = (overrides = {}) => ({
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    teamId: 'TOR',
  },
  expectedValue: 8,
  fairOdds: 2,
  gameId: 'game-saved',
  homeTeam: {
    abbreviation: 'NYR',
    name: 'New York Rangers',
    teamId: 'NYR',
  },
  id: overrides.id ?? 'bet-saved',
  marketOdds: 2.8,
  modelProbability: 0.55,
  profit: 0,
  result: 'pending',
  selectedSide: {
    abbreviation: 'NYR',
    homeAway: 'home',
    name: 'New York Rangers',
    teamId: 'NYR',
  },
  selectedTeam: {
    abbreviation: 'NYR',
    name: 'New York Rangers',
    teamId: 'NYR',
  },
  stake: 20,
  ...overrides,
})

const bettingSettings = {
  bankrollBasis: 'AVAILABLE',
  customKellyFraction: 0.25,
  kellyMode: 'QUARTER',
  maximumStakePercent: 3,
  minimumEdgePercent: 2,
  stakeRoundingIncrement: 0.5,
}

const bankrollSummary = {
  availableBankroll: 475,
  currency: 'EUR',
  currentBankroll: 500,
  initialized: true,
  pendingStake: 25,
}

const createRatings = () => {
  const ratings = powerRatingUtils.createDefaultPowerRatings()

  ratings.BOS = {
    ...ratings.BOS,
    baseRating: 56,
  }
  ratings.TOR = {
    ...ratings.TOR,
    baseRating: 50,
  }
  ratings.NYR = {
    ...ratings.NYR,
    baseRating: 53,
  }
  ratings.CAR = {
    ...ratings.CAR,
    baseRating: 52,
  }
  ratings.COL = {
    ...ratings.COL,
    baseRating: 51,
  }
  ratings.DAL = {
    ...ratings.DAL,
    baseRating: 51,
  }

  return ratings
}

const todayGames = () => [
  createGame({
    gameId: 'game-candidate',
  }),
  createGame({
    away: team('CAR', 'Carolina Hurricanes'),
    gameId: 'game-saved',
    home: team('NYR', 'New York Rangers'),
  }),
  createGame({
    away: team('DAL', 'Dallas Stars'),
    gameId: 'game-neutral',
    home: team('COL', 'Colorado Avalanche'),
  }),
]

const previousGames = () => [
  createGame({
    away: team('TOR', 'Toronto Maple Leafs', 2),
    gameId: 'last-win',
    gameState: 'FINAL',
    home: team('BOS', 'Boston Bruins', 3),
    startTimeUTC: '2026-01-14T00:00:00.000Z',
    status: 'Final',
  }),
]

const dashboardBets = () => [
  createBet(),
  createBet({
    gameId: 'last-win',
    homeTeam: {
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
    id: 'bet-win',
    marketOdds: 1.9,
    profit: 18,
    result: 'win',
    selectedSide: {
      abbreviation: 'BOS',
      homeAway: 'home',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
    selectedTeam: {
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
    stake: 20,
  }),
  createBet({
    gameId: 'last-win',
    id: 'bet-loss',
    marketOdds: 2.1,
    profit: -10,
    result: 'loss',
    selectedSide: {
      abbreviation: 'TOR',
      homeAway: 'away',
      name: 'Toronto Maple Leafs',
      teamId: 'TOR',
    },
    selectedTeam: {
      abbreviation: 'TOR',
      name: 'Toronto Maple Leafs',
      teamId: 'TOR',
    },
    stake: 10,
  }),
  createBet({
    gameId: 'last-win',
    id: 'bet-pending',
    marketOdds: 1.9,
    result: 'pending',
    selectedSide: {
      abbreviation: 'BOS',
      homeAway: 'home',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
    selectedTeam: {
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
    stake: 5,
  }),
]

const marketOdds = {
  'game-candidate': {
    away: '4.50',
    home: '1.35',
  },
  'game-neutral': {
    away: '1.20',
    home: '1.20',
  },
}

const renderDashboard = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(Dashboard, {
      baseHomeAdvantage: 0,
      initialBankrollSummary: bankrollSummary,
      initialBets: dashboardBets(),
      initialBettingSettings: bettingSettings,
      initialMarketOdds: marketOdds,
      initialPreviousSchedule: {
        date: '2026-01-14',
        games: previousGames(),
      },
      initialSchedule: {
        date: '2026-01-15',
        games: todayGames(),
      },
      injurySummaries: {},
      injurySummaryStatus: 'success',
      onAnalyzeGame: () => {},
      onNavigate: () => {},
      onRetryInjuries: () => {},
      onRetryPowerRatings: () => {},
      onRetryRatingEngineSettings: () => {},
      powerRatings: createRatings(),
      powerRatingsStatus: 'success',
      ratingEngineSettingsStatus: 'success',
      todayDateValue: '2026-01-15',
      ...props,
    }),
  )

const assertNoInvalidNumbers = (html) => {
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
}

const countMatches = (source, pattern) => source.match(pattern)?.length ?? 0

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  Dashboard = (await vite.ssrLoadModule('/src/components/Dashboard.jsx')).default
  GameAnalyzer = (await vite.ssrLoadModule('/src/components/GameAnalyzer.jsx'))
    .default
  calculateGameUtils = await vite.ssrLoadModule('/src/utils/calculateGame.js')
  dashboardUtils = await vite.ssrLoadModule('/src/utils/dashboard.js')
  modelAnalysisUtils = await vite.ssrLoadModule('/src/utils/modelAnalysis.js')
  powerRatingUtils = await vite.ssrLoadModule('/src/utils/powerRatings.js')
})

after(async () => {
  await vite?.close()
})

test('dashboard helpers keep status priority and candidate rules centralized', () => {
  const analysis = {
    available: true,
    awayMarket: {
      edge: -0.14,
      expectedValue: -20,
      marketOdds: 1.35,
      modelProbability: 0.27,
    },
    hasAnyMarketOdds: true,
    homeMarket: {
      edge: 0.08,
      expectedValue: 16,
      marketOdds: 2.1,
      modelProbability: 0.55,
    },
  }
  const game = createGame({ gameId: 'status-game' })
  const candidate = dashboardUtils.getDashboardGameStatus({
    analysis,
    bankrollSummary,
    bettingSettings,
    game,
    savedBets: [],
  })
  const saved = dashboardUtils.getDashboardGameStatus({
    analysis,
    bankrollSummary,
    bettingSettings,
    game: {
      ...game,
      gameState: 'FINAL',
      status: 'Final',
    },
    savedBets: [createBet({ gameId: 'status-game' })],
  })
  const potential = dashboardUtils.getDashboardGameStatus({
    analysis,
    bankrollSummary: {
      ...bankrollSummary,
      initialized: false,
    },
    bettingSettings,
    game,
    savedBets: [],
  })
  const started = dashboardUtils.getDashboardGameStatus({
    analysis,
    bankrollSummary,
    bettingSettings,
    game: {
      ...game,
      gameState: 'LIVE',
      status: 'Live',
    },
    savedBets: [],
  })
  const needsOdds = dashboardUtils.getDashboardGameStatus({
    analysis: {
      available: true,
      awayMarket: {
        marketOdds: null,
        modelProbability: 0.48,
      },
      hasAnyMarketOdds: false,
      homeMarket: {
        marketOdds: null,
        modelProbability: 0.52,
      },
    },
    bankrollSummary,
    bettingSettings,
    game,
    savedBets: [],
  })

  assert.equal(
    candidate.status,
    dashboardUtils.DASHBOARD_GAME_STATUSES.BET_CANDIDATE,
  )
  assert.equal(saved.status, dashboardUtils.DASHBOARD_GAME_STATUSES.BET_SAVED)
  assert.equal(
    potential.status,
    dashboardUtils.DASHBOARD_GAME_STATUSES.WORTH_REVIEWING,
  )
  assert.equal(started.status, dashboardUtils.DASHBOARD_GAME_STATUSES.GAME_STARTED)
  assert.equal(needsOdds.status, dashboardUtils.DASHBOARD_GAME_STATUSES.ADD_ODDS)
})

test('dashboard helper classifies no odds, one-sided value, no value and final games', () => {
  const game = createGame({ gameId: 'classification-game' })
  const noOdds = dashboardUtils.getDashboardGameStatus({
    analysis: {
      available: true,
      awayMarket: {
        marketOdds: null,
        modelProbability: 0.48,
      },
      homeMarket: {
        marketOdds: null,
        modelProbability: 0.52,
      },
    },
    bankrollSummary,
    bettingSettings,
    game,
    savedBets: [],
  })
  const oneSidedReview = dashboardUtils.getDashboardGameStatus({
    analysis: {
      available: true,
      awayMarket: {
        edge: 0.01,
        expectedValue: 2,
        marketOdds: 2,
        modelProbability: 0.51,
      },
      homeMarket: {
        marketOdds: null,
        modelProbability: 0.49,
      },
    },
    bankrollSummary,
    bettingSettings,
    game,
    savedBets: [],
  })
  const noValue = dashboardUtils.getDashboardGameStatus({
    analysis: {
      available: true,
      awayMarket: {
        edge: -0.2,
        expectedValue: -30,
        marketOdds: 1.2,
        modelProbability: 0.63,
      },
      homeMarket: {
        marketOdds: null,
        modelProbability: 0.37,
      },
    },
    bankrollSummary,
    bettingSettings,
    game,
    savedBets: [],
  })
  const final = dashboardUtils.getDashboardGameStatus({
    analysis: {
      available: true,
      awayMarket: {
        edge: 0.08,
        expectedValue: 16,
        marketOdds: 2.1,
        modelProbability: 0.55,
      },
      homeMarket: {
        edge: -0.08,
        expectedValue: -16,
        marketOdds: 1.7,
        modelProbability: 0.45,
      },
    },
    bankrollSummary,
    bettingSettings,
    game: {
      ...game,
      gameState: 'FINAL',
      status: 'Final',
    },
    savedBets: [],
  })

  assert.equal(noOdds.status, dashboardUtils.DASHBOARD_GAME_STATUSES.ADD_ODDS)
  assert.equal(
    oneSidedReview.status,
    dashboardUtils.DASHBOARD_GAME_STATUSES.WORTH_REVIEWING,
  )
  assert.equal(oneSidedReview.evaluatedSideCount, 1)
  assert.equal(oneSidedReview.valueSide.side, 'away')
  assert.match(oneSidedReview.statusReason, /Below 2\.00 pp minimum/)
  assert.equal(
    noValue.status,
    dashboardUtils.DASHBOARD_GAME_STATUSES.NO_CURRENT_VALUE,
  )
  assert.equal(noValue.evaluatedSideCount, 1)
  assert.equal(final.status, dashboardUtils.DASHBOARD_GAME_STATUSES.FINAL)
  assert.doesNotMatch(
    JSON.stringify([noOdds, oneSidedReview, noValue, final]),
    /NaN|Infinity/,
  )
})

test('preliminary analysis reuses the Analyzer calculation service', () => {
  const marketOdds = {
    away: '4.50',
    home: '1.35',
  }
  const teams = {
    away: 'TOR',
    home: 'BOS',
  }
  const analysis = modelAnalysisUtils.calculatePreliminaryAnalysis({
    awayTeamId: teams.away,
    baseHomeAdvantage: 1,
    homeTeamId: teams.home,
    injurySummaries: {
      BOS: {
        totalImpact: -0.5,
      },
      TOR: {
        totalImpact: -1,
      },
    },
    marketOdds,
    powerRatings: createRatings(),
  })
  const analyzerInputs = modelAnalysisUtils.createInputsForTeams(
    createRatings(),
    teams,
    marketOdds,
    {
      BOS: {
        totalImpact: -0.5,
      },
      TOR: {
        totalImpact: -1,
      },
    },
    1,
  )
  const analyzerResult = calculateGameUtils.calculateGame(
    analyzerInputs.home,
    analyzerInputs.away,
  )

  assert.equal(analysis.available, true)
  assert.equal(analysis.usesUnknownInputs, true)
  assert.equal(
    analysis.inputStatus,
    modelAnalysisUtils.PRELIMINARY_ANALYSIS_INPUT_STATUS.USES_DEFAULTS,
  )
  assert.equal(analysis.inputs.home.marketOdds, analyzerInputs.home.marketOdds)
  assert.equal(analysis.inputs.away.marketOdds, analyzerInputs.away.marketOdds)
  assert.equal(analysis.homeMarket.modelProbability, analyzerResult.homeWinProbability)
  assert.equal(analysis.awayMarket.modelProbability, analyzerResult.awayWinProbability)
})

test('preliminary analysis reports missing core model data without defaults', () => {
  const analysis = modelAnalysisUtils.calculatePreliminaryAnalysis({
    awayTeamId: 'TOR',
    homeTeamId: 'BOS',
    marketOdds: {
      away: '2.10',
      home: '1.90',
    },
    powerRatings: {
      BOS: {
        baseRating: 52,
        teamId: 'BOS',
      },
    },
  })
  const status = dashboardUtils.getDashboardGameStatus({
    analysis,
    bankrollSummary,
    bettingSettings,
    game: createGame({ gameId: 'missing-core' }),
    savedBets: [],
  })

  assert.equal(analysis.available, false)
  assert.deepEqual(analysis.missingCoreData, ['away.powerRating'])
  assert.equal(
    status.status,
    dashboardUtils.DASHBOARD_GAME_STATUSES.PRELIMINARY_ANALYSIS_UNAVAILABLE,
  )
})

test('value side selection uses edge, expected value, then away-home order', () => {
  const edgeWinner = dashboardUtils.getDashboardValueSide([
    {
      edge: 0.02,
      expectedValue: 6,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'away',
    },
    {
      edge: 0.04,
      expectedValue: 5,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'home',
    },
  ])
  const evWinner = dashboardUtils.getDashboardValueSide([
    {
      edge: 0.02,
      expectedValue: 4,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'away',
    },
    {
      edge: 0.02,
      expectedValue: 7,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'home',
    },
  ])
  const stableWinner = dashboardUtils.getDashboardValueSide([
    {
      edge: 0.02,
      expectedValue: 4,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'away',
    },
    {
      edge: 0.02,
      expectedValue: 4,
      hasPositiveEdge: true,
      hasValidOdds: true,
      side: 'home',
    },
  ])

  assert.equal(edgeWinner.side, 'home')
  assert.equal(evWinner.side, 'home')
  assert.equal(stableWinner.side, 'away')
})

test('dashboard summaries count open exposure, game activity and last-night bets', () => {
  const bets = dashboardBets()
  const openSummary = dashboardUtils.buildOpenBetSummary(bets)
  const lastNightSummary = dashboardUtils.buildLastNightBettingSummary(
    bets.filter((bet) => bet.gameId === 'last-win'),
  )
  const grouped = dashboardUtils.groupBetsByGameId(bets)
  const todayBets = dashboardUtils.getBetsForGames(bets, todayGames())

  assert.deepEqual(openSummary, {
    openBetCount: 2,
    pendingExposure: 25,
  })
  assert.equal(grouped['last-win'].length, 3)
  assert.equal(todayBets.length, 1)
  assert.deepEqual(lastNightSummary, {
    betCount: 3,
    lostCount: 1,
    netProfit: 8,
    pendingCount: 1,
    wonCount: 1,
  })
})

test('dashboard local-date helpers avoid UTC string slicing behavior', () => {
  const localLateNight = new Date(2026, 0, 1, 23, 30)

  assert.equal(dashboardUtils.toLocalDateValue(localLateNight), '2026-01-01')
  assert.equal(dashboardUtils.shiftLocalDateValue('2026-03-01', -1), '2026-02-28')
  assert.equal(dashboardUtils.parseLocalDateValue('2026-01-01').getHours(), 12)
})

test('Dashboard renders bankroll in a separate labeled section', () => {
  const html = renderDashboard()
  const headerHtml =
    html.match(/<div class="section-heading dashboard-heading">[\s\S]*?<\/div><\/div>/)
      ?.[0] ?? ''

  assert.match(html, /class="dashboard-bankroll-section"/)
  assert.match(html, /Bankroll Overview/)
  assert.match(html, /class="dashboard-bankroll-grid"/)
  assert.match(html, /Current Bankroll/)
  assert.match(html, /Available Bankroll/)
  assert.match(html, /Pending Exposure/)
  assert.match(html, /Open Bets<\/span><strong>2<\/strong>/)
  assert.doesNotMatch(html, /daily-overview-grid/)
  assert.doesNotMatch(html, /<span>3 games<\/span>/)
  assert.doesNotMatch(headerHtml, /3 games/)
  assertNoInvalidNumbers(html)
})

test('Dashboard places activity metadata inside the games section', () => {
  const html = renderDashboard()

  assert.match(html, /class="dashboard-daily-layout"/)
  assert.match(html, /<main class="dashboard-today-column"/)
  assert.match(html, /<aside class="dashboard-last-night-column"/)
  assert.match(
    html,
    /<main class="dashboard-today-column"[\s\S]*class="today-activity-strip"[\s\S]*class="dashboard-today-games-grid"/,
  )
  assert.match(html, /<strong>3<\/strong><span>Games<\/span>/)
  assert.match(html, /<strong>3<\/strong><span>Analyzed<\/span>/)
  assert.match(html, /<strong>1<\/strong><span>Bet Candidates<\/span>/)
  assert.match(html, /<strong>1<\/strong><span>Bets saved<\/span>/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders bankroll-not-initialized state without fabricated balances', () => {
  const html = renderDashboard({
    initialBankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
      pendingStake: 0,
    },
    initialBets: [],
  })

  assert.match(html, /Bankroll not set up/)
  assert.match(html, /Set up bankroll in Bet Tracker/)
  assert.match(html, /Open Bets<\/span><strong>0<\/strong>/)
  assertNoInvalidNumbers(html)
})

test('Dashboard card render removes model lean and shows value side', () => {
  const html = renderDashboard()

  assert.match(html, /class="schedule-card candidate"/)
  assert.match(html, /Bet Candidate/)
  assert.doesNotMatch(html, /Model lean|Model Lean|Highest EV|Best value/)
  assert.match(html, /Value Side[\s\S]*Toronto Maple Leafs/)
  assert.match(html, /Edge[\s\S]*\+[0-9]+\.[0-9]{2} pp/)
  assert.match(html, /Kelly[\s\S]*(?:€|EUR)/)
  assert.match(html, /class="schedule-card neutral"/)
  assert.match(html, /No current value/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders Add Odds without a value side', () => {
  const html = renderDashboard({
    initialBets: [],
    initialMarketOdds: {},
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
  })

  assert.match(html, /class="schedule-card needs-odds"/)
  assert.match(html, /Add odds/)
  assert.match(html, /Preliminary probabilities are ready\./)
  assert.match(html, /Enter market odds to evaluate betting value\./)
  assert.doesNotMatch(html, /Value Side/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders one-sided no-value odds neutrally', () => {
  const html = renderDashboard({
    initialBets: [],
    initialMarketOdds: {
      'game-candidate': {
        away: '1.20',
        home: '',
      },
    },
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
  })

  assert.match(html, /class="schedule-card neutral"/)
  assert.match(html, /No current value/)
  assert.match(html, /No positive edge at the entered odds\./)
  assert.match(html, /Only one side evaluated\./)
  assert.doesNotMatch(html, /Value Side/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders below-minimum value as Worth Reviewing without Kelly amount', () => {
  const html = renderDashboard({
    initialBets: [],
    initialBettingSettings: {
      ...bettingSettings,
      minimumEdgePercent: 10,
    },
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
  })

  assert.match(html, /class="schedule-card attention"/)
  assert.match(html, /Worth reviewing/)
  assert.match(html, /Value Side[\s\S]*Toronto Maple Leafs/)
  assert.match(html, /Below 10\.00 pp minimum/)
  assert.doesNotMatch(html, /Kelly[\s\S]*(?:€|EUR)/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders preliminary unavailable state without stale value labels', () => {
  const html = renderDashboard({
    initialBets: [],
    initialMarketOdds: {
      'game-candidate': {
        away: '4.50',
        home: '1.35',
      },
    },
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
    powerRatings: {
      BOS: {
        baseRating: 56,
        teamId: 'BOS',
      },
    },
  })

  assert.match(html, /Preliminary analysis unavailable/)
  assert.match(html, /Missing core model data/)
  assert.doesNotMatch(html, /Value Side|Add odds/)
  assertNoInvalidNumbers(html)
})

test('Dashboard validates invalid entered market odds safely', () => {
  const html = renderDashboard({
    initialBets: [],
    initialMarketOdds: {
      'game-candidate': {
        away: '1.00',
        home: '',
      },
    },
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
  })

  assert.match(html, /Add odds/)
  assert.match(html, /Market odds must be greater than 1\./)
  assert.doesNotMatch(html, /Value Side/)
  assertNoInvalidNumbers(html)
})

test('potential-value cards receive restrained attention styling', () => {
  const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8')
  const html = renderDashboard({
    initialBankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
      pendingStake: 0,
    },
    initialBets: [],
    initialSchedule: {
      date: '2026-01-15',
      games: [todayGames()[0]],
    },
  })

  assert.match(html, /class="schedule-card attention"/)
  assert.match(html, /Worth reviewing/)
  assert.match(css, /\.schedule-card\.attention/)
  assert.match(css, /\.schedule-card\.candidate/)
  assertNoInvalidNumbers(html)
})

test('saved bets have display priority and render stake plus odds', () => {
  const html = renderDashboard()

  assert.match(html, /class="schedule-card saved has-saved-bet"/)
  assert.match(html, /Bet Saved/)
  assert.match(html, /New York Rangers/)
  assert.match(html, /@ 2\.80/)
  assert.match(html, /View Bet/)
  assertNoInvalidNumbers(html)
})

test('Last Night renders results, settled profit, losses and pending settlements', () => {
  const html = renderDashboard()

  assert.match(html, /Last Night/)
  assert.match(html, /Winner <strong>Boston Bruins<\/strong>/)
  assert.match(html, /class="last-night-compact-summary"/)
  assert.match(html, /<dt>Bets<\/dt><dd>3<\/dd>/)
  assert.match(html, /<dt>Record<\/dt><dd>1-1<\/dd>/)
  assert.match(html, /<dt>Pending<\/dt><dd>1<\/dd>/)
  assert.match(html, /<dt>Net<\/dt><dd>\+/)
  assert.match(html, /class="last-night-result-card has-bet"/)
  assert.match(html, /class="last-night-scoreline"/)
  assert.match(html, /Toronto Maple Leafs[\s\S]*2/)
  assert.match(html, /Boston Bruins[\s\S]*3/)
  assert.match(html, /Bet won/)
  assert.match(html, /Profit \+/)
  assert.match(html, /Bet lost/)
  assert.match(html, /Profit -/)
  assert.match(html, /Settlement pending/)
  assertNoInvalidNumbers(html)
})

test('completed selected-day games render one Final status and contextual actions', () => {
  const completedGame = createGame({
    away: team('CAR', 'Carolina Hurricanes', 2),
    gameId: 'completed-saved',
    gameState: 'FINAL',
    home: team('NYR', 'New York Rangers', 4),
    status: 'Final',
  })
  const html = renderDashboard({
    initialBets: [
      createBet({
        gameId: 'completed-saved',
      }),
    ],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [completedGame],
    },
  })

  assert.equal(countMatches(html, />Final</g), 1)
  assert.match(html, /Bet Saved/)
  assert.match(html, /View Analysis/)
  assert.match(html, /View Bet/)
  assert.doesNotMatch(html, /<span class="dashboard-card-status final">Final/)
  assertNoInvalidNumbers(html)
})

test('Final overtime and shootout statuses are preserved without duplicate Final badges', () => {
  const overtimeHtml = renderDashboard({
    initialBets: [],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [
        createGame({
          away: team('CAR', 'Carolina Hurricanes', 2),
          gameId: 'final-ot',
          gameState: 'FINAL',
          home: team('NYR', 'New York Rangers', 3),
          status: 'Final / OT',
        }),
      ],
    },
  })
  const shootoutHtml = renderDashboard({
    initialBets: [],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [
        createGame({
          away: team('CAR', 'Carolina Hurricanes', 2),
          gameId: 'final-so',
          gameState: 'FINAL',
          home: team('NYR', 'New York Rangers', 3),
          status: 'Final / SO',
        }),
      ],
    },
  })

  assert.equal(countMatches(overtimeHtml, /Final \/ OT/g), 1)
  assert.equal(countMatches(shootoutHtml, /Final \/ SO/g), 1)
  assert.match(overtimeHtml, /Analyze Game/)
  assert.match(shootoutHtml, /Analyze Game/)
  assertNoInvalidNumbers(`${overtimeHtml}${shootoutHtml}`)
})

test('Last Night no-bet state still shows completed games', () => {
  const html = renderDashboard({
    initialBets: [],
  })

  assert.match(html, /No bets were recorded for this day/)
  assert.match(html, /class="last-night-result-card "/)
  assert.match(html, /Toronto Maple Leafs[\s\S]*2/)
  assert.match(html, /Boston Bruins[\s\S]*3/)
  assert.match(html, /No bet recorded/)
  assertNoInvalidNumbers(html)
})

test('Dashboard renders empty states for no games and no last-night completions', () => {
  const html = renderDashboard({
    initialBets: [],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [],
    },
  })

  assert.match(html, /No NHL games scheduled/)
  assert.match(html, /No bets saved for today&#x27;s games/)
  assert.match(html, /No NHL games were completed last night/)
  assertNoInvalidNumbers(html)
})

test('selected historical date uses date-aware section labels', () => {
  const html = renderDashboard({
    todayDateValue: '2026-07-29',
  })

  assert.match(html, /Selected Day/)
  assert.match(html, /Games on/)
  assert.match(html, /Previous Day/)
  assert.doesNotMatch(html, /Day before selected schedule date/)
  assert.doesNotMatch(html, /Today&#x27;s Games/)
  assert.doesNotMatch(html, /Last Night/)
  assertNoInvalidNumbers(html)
})

test('Dashboard responsive CSS preserves primary and secondary columns', () => {
  const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(css, /\.app-layout\.page-dashboard \.app-shell/)
  assert.match(
    css,
    /\.dashboard-daily-layout\s*{[^}]+grid-template-columns:\s*minmax\(0, 2\.35fr\) minmax\(280px, 0\.95fr\)/s,
  )
  assert.match(
    css,
    /@media \(max-width: 1100px\)[\s\S]*?\.dashboard-daily-layout\s*{[^}]+grid-template-columns:\s*1fr/s,
  )
  assert.match(css, /\.dashboard-today-games-grid\s*{[^}]+auto-fit/s)
  assert.match(css, /\.last-night-compact-summary\s*{[^}]+repeat\(2/s)
})

test('Previous Day compact summary renders negative Net values', () => {
  const html = renderDashboard({
    initialBets: [
      createBet({
        gameId: 'last-win',
        id: 'bet-loss-only',
        marketOdds: 2.1,
        profit: -15,
        result: 'loss',
        selectedTeam: {
          abbreviation: 'TOR',
          name: 'Toronto Maple Leafs',
          teamId: 'TOR',
        },
        stake: 15,
      }),
    ],
  })

  assert.match(html, /<dt>Bets<\/dt><dd>1<\/dd>/)
  assert.match(html, /<dt>Record<\/dt><dd>0-1<\/dd>/)
  assert.match(html, /<dt>Pending<\/dt><dd>0<\/dd>/)
  assert.match(html, /<div class="net negative">/)
  assert.match(html, /<dt>Net<\/dt><dd>-/)
  assertNoInvalidNumbers(html)
})

test('partial bankroll failure still renders schedule content', () => {
  const html = renderDashboard({
    initialBankrollError: 'Summary request failed.',
    initialBankrollStatus: 'error',
    initialBankrollSummary: null,
  })

  assert.match(html, /Unavailable/)
  assert.match(html, /Summary request failed\./)
  assert.match(html, /Today&#x27;s Games/)
  assert.match(html, /class="dashboard-today-games-grid"/)
  assert.match(html, /Toronto Maple Leafs/)
  assert.match(html, /Analyze Game/)
  assertNoInvalidNumbers(html)
})

test('partial Previous Day failure does not hide today games', () => {
  const html = renderDashboard({
    initialPreviousError: 'Previous schedule failed.',
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialPreviousStatus: 'error',
  })

  assert.match(html, /Last night unavailable/)
  assert.match(html, /Previous schedule failed\./)
  assert.match(html, /class="dashboard-today-games-grid"/)
  assert.match(html, /Toronto Maple Leafs/)
  assert.match(html, /Analyze Game/)
  assertNoInvalidNumbers(html)
})

test('GameAnalyzer separates detected rest conditions from applied modifiers', () => {
  const html = renderToStaticMarkup(
    React.createElement(GameAnalyzer, {
      baseHomeAdvantage: 0,
      injurySummaries: {},
      injurySummaryStatus: 'success',
      onNavigate: () => {},
      onRetryInjuries: () => {},
      onRetryPowerRatings: () => {},
      onRetryRatingEngineSettings: () => {},
      powerRatings: createRatings(),
      powerRatingsStatus: 'success',
      prefillMatchup: {
        away: 'LAK',
        gameContext: {
          awayContext: {
            adjustmentBreakdown: [],
            automaticRestFatigueAdjustment: 0,
            conditions: ['well_rested', '4_games_in_6_days'],
            effectiveRestFatigueAdjustment: 0,
            quickRematch: {
              reason: 'No previous head-to-head meeting.',
            },
            restDays: 2,
            restFatigueCondition: 'fourInSix',
            totalGameContextAdjustment: 0,
          },
          awayTeam: {
            abbreviation: 'LAK',
            name: 'Los Angeles Kings',
            teamId: 'LAK',
          },
          gameId: '2025021044',
          homeContext: {
            adjustmentBreakdown: [
              {
                adjustment: 0,
                condition: 'normal',
              },
            ],
            quickRematch: {
              reason: 'No previous head-to-head meeting.',
            },
            restFatigueCondition: 'normal',
          },
          homeTeam: {
            abbreviation: 'NYI',
            name: 'New York Islanders',
            teamId: 'NYI',
          },
          scheduledStart: '2026-03-13T23:30:00.000Z',
        },
        gameId: '2025021044',
        home: 'NYI',
        marketOdds: {
          away: '2.05',
          home: '1.85',
        },
        scheduledStart: '2026-03-13T23:30:00.000Z',
      },
      ratingEngineSettingsStatus: 'success',
    }),
  )

  assert.match(html, /Well Rested[\s\S]*adjustment disabled/)
  assert.match(html, /4 Games in 6 Days[\s\S]*info only/)
  assert.match(html, /No applied modifiers/)
  assert.match(html, /<dt>Rest Days<\/dt><dd>2<\/dd>/)
  assert.match(html, /<dt>Rest\/Fatigue<\/dt><dd>\+0\.00<\/dd>/)
  assert.doesNotMatch(html, /4 Games in 6 Days[\s\S]*-0\.50/)
  assertNoInvalidNumbers(html)
})
