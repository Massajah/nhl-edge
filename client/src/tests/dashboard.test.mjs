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
  gameOutcome,
  gameState = 'FUT',
  home = team('BOS', 'Boston Bruins'),
  periodDescriptor,
  startTimeUTC = '2026-01-15T00:00:00.000Z',
  status = 'Scheduled',
} = {}) => ({
  awayTeam: away,
  gameId,
  gameOutcome,
  gameState,
  homeTeam: home,
  periodDescriptor,
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

const specialTeamsData = (overrides = {}) => ({
  leagueTeamCount: 32,
  previousThreeSeasonIds: [20222023, 20232024, 20242025],
  teams: [
    {
      penaltyKillLeagueRank: 4,
      powerPlayLeagueRank: 5,
      teamAbbreviation: 'BOS',
    },
    {
      penaltyKillLeagueRank: 29,
      powerPlayLeagueRank: 28,
      teamAbbreviation: 'TOR',
    },
    {
      penaltyKillLeagueRank: 16,
      powerPlayLeagueRank: 16,
      teamAbbreviation: 'CAR',
    },
    {
      penaltyKillLeagueRank: 16,
      powerPlayLeagueRank: 16,
      teamAbbreviation: 'NYR',
    },
    {
      penaltyKillLeagueRank: 16,
      powerPlayLeagueRank: 7,
      teamAbbreviation: 'DAL',
    },
    {
      penaltyKillLeagueRank: 25,
      powerPlayLeagueRank: 16,
      teamAbbreviation: 'COL',
    },
    {
      penaltyKillLeagueRank: 4,
      powerPlayLeagueRank: 5,
      teamAbbreviation: 'LAK',
    },
    {
      penaltyKillLeagueRank: 28,
      powerPlayLeagueRank: 29,
      teamAbbreviation: 'NYI',
    },
  ],
  ...overrides,
})

const automaticUpdateResult = (overrides = {}) => ({
  dateRange: {
    from: '2026-01-14',
    to: '2026-01-15',
  },
  errors: [],
  gamesAlreadyProcessed: 1,
  gamesFound: 2,
  gamesProcessed: 1,
  gamesSkipped: 0,
  latestProcessedGame: {
    awayScore: 2,
    awayTeam: 'TOR',
    gameDate: '2026-01-15',
    gameId: 'auto-game',
    homeScore: 3,
    homeTeam: 'BOS',
    result: 'TOR 2-3 BOS',
    resultType: 'REGULATION',
  },
  processedGames: [],
  ratingSettingsUsed: {
    homeAdvantage: 4,
    kFactor: 1.2,
    modelVersion: 'power-rating-v1',
    overtimeMultiplier: 0.7,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  },
  status: 'updated',
  success: true,
  ...overrides,
})

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

const renderGameAnalyzer = (gameContext, props = {}) =>
  renderToStaticMarkup(
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
        game: {
          awayTeam: team('LAK', 'Los Angeles Kings'),
          gameId: '2025021044',
          gameState: gameContext.gameState ?? 'FUT',
          homeTeam: team('NYI', 'New York Islanders'),
          startTimeUTC: '2026-03-13T23:30:00.000Z',
          status: gameContext.status ?? 'Scheduled',
        },
        gameContext,
        gameId: '2025021044',
        home: 'NYI',
        marketOdds: {
          away: '2.05',
          home: '1.85',
        },
        scheduledStart: '2026-03-13T23:30:00.000Z',
      },
      ratingEngineSettingsStatus: 'success',
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
    probabilityScale: 14,
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
    14,
  )
  const safeFallbackResult = calculateGameUtils.calculateGame(
    analyzerInputs.home,
    analyzerInputs.away,
    Number.NaN,
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
  assert.equal(analyzerResult.probabilityScale, 14)
  assert.equal(safeFallbackResult.probabilityScale, 20)
  assert.equal(Number.isFinite(safeFallbackResult.homeWinProbability), true)
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

test('Dashboard game-status labels use explicit NHL ending metadata and safe fallbacks', () => {
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(
      createGame({
        gameOutcome: { lastPeriodType: 'REG' },
        gameState: 'OFF',
        status: 'Final',
      }),
    ),
    'FINAL',
  )
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(
      createGame({
        gameOutcome: { lastPeriodType: 'OT' },
        gameState: 'OFF',
        status: 'Final',
      }),
    ),
    'FINAL OT',
  )
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(
      createGame({
        gameState: 'OFF',
        periodDescriptor: { periodType: 'SO' },
        status: 'Final',
      }),
    ),
    'FINAL SO',
  )
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(
      createGame({ gameState: 'OFF', status: 'Final / OT' }),
    ),
    'FINAL',
  )
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(createGame()),
    'Scheduled',
  )
  assert.equal(
    dashboardUtils.getDashboardGameStatusLabel(
      createGame({ gameState: 'LIVE', status: 'Live' }),
    ),
    'Live',
  )
})

test('Dashboard date helpers use explicit English labels without changing local time semantics', () => {
  const sameDayStart = new Date(2026, 2, 22, 19, 0)
  const crossMidnightStart = new Date(2026, 2, 23, 1, 0)

  assert.equal(
    dashboardUtils.formatDashboardScheduleDate('2026-08-24'),
    'Monday, August 24, 2026',
  )
  assert.equal(
    dashboardUtils.formatDashboardStartTime(
      sameDayStart.toISOString(),
      '2026-03-22',
    ),
    '7:00 PM',
  )
  assert.equal(
    dashboardUtils.formatDashboardStartTime(
      crossMidnightStart.toISOString(),
      '2026-03-22',
    ),
    'Mar 23 · 1:00 AM',
  )
  assert.doesNotMatch(
    dashboardUtils.formatDashboardStartTime(
      crossMidnightStart.toISOString(),
      '2026-03-22',
    ),
    /klo|maanantaina|tiistaina|keskiviikkona|torstaina|perjantaina|lauantaina|sunnuntaina/i,
  )
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

test('Dashboard renders compact automatic Power Rating update states', () => {
  const checkingHtml = renderDashboard({
    initialAutomaticRatingUpdateStatus: 'checking',
  })
  const updatedHtml = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult(),
  })
  const upToDateHtml = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult({
      gamesAlreadyProcessed: 2,
      gamesProcessed: 0,
      status: 'up_to_date',
    }),
  })
  const partialHtml = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult({
      errors: [
        {
          code: 'MISSING_RATING',
          gameId: 'partial-game',
          reason: 'Missing Power Rating for NJD.',
        },
      ],
      gamesProcessed: 1,
      gamesSkipped: 1,
      status: 'partial',
      success: false,
    }),
  })
  const unavailableHtml = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult({
      errors: [
        {
          code: 'AUTO_UPDATE_UNAVAILABLE',
          gameId: null,
          reason: 'Schedule unavailable.',
        },
      ],
      gamesFound: 0,
      gamesProcessed: 0,
      gamesSkipped: 1,
      status: 'unavailable',
      success: false,
    }),
  })

  assert.match(checkingHtml, /Checking ratings\.\.\./)
  assert.match(updatedHtml, /Power Ratings updated: 1 game/)
  assert.match(updatedHtml, /latest game: 2026-01-15 TOR at BOS/)
  assert.match(upToDateHtml, /Power Ratings up to date/)
  assert.match(partialHtml, /Power Rating update partially completed/)
  assert.match(partialHtml, /Missing Power Rating for NJD\./)
  assert.match(unavailableHtml, /Power Rating update unavailable/)
  assert.match(unavailableHtml, /Schedule unavailable\./)
  assert.doesNotMatch(updatedHtml, /class="dashboard-metric-card"[\s\S]*Power Ratings updated/)
  assertNoInvalidNumbers(
    `${checkingHtml}${updatedHtml}${upToDateHtml}${partialHtml}${unavailableHtml}`,
  )
})

test('Dashboard preseason-ready status is neutral and requires no action', () => {
  const html = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult({
      dateRange: null,
      gamesAlreadyProcessed: 0,
      gamesFound: 0,
      gamesProcessed: 0,
      gamesSkipped: 0,
      latestProcessedGame: null,
      message: 'Power Ratings are ready for season start.',
      ratingSettingsUsed: null,
      status: 'preseason_ready',
      success: true,
    }),
    onOpenManualPowerRatingUpdate: () => {},
  })

  assert.equal(countMatches(html, /Power Ratings ready for season start/g), 1)
  assert.match(html, /✓ Power Ratings ready for season start/)
  assert.match(html, /automatic-rating-update-status neutral/)
  assert.doesNotMatch(html, /Power Ratings are ready for season start./)
  assert.doesNotMatch(html, /initialization required/i)
  assert.doesNotMatch(html, /Manual Rating Update<\/button>/)
  assertNoInvalidNumbers(html)
})

test('Dashboard unprocessed-games status links to update workflow', () => {
  const html = renderDashboard({
    initialAutomaticRatingUpdateResult: automaticUpdateResult({
      gamesAlreadyProcessed: 0,
      gamesFound: 3,
      gamesProcessed: 0,
      latestProcessedGame: null,
      message: 'Completed games are waiting to be processed.',
      status: 'unprocessed_games',
      success: false,
    }),
    onOpenManualPowerRatingUpdate: () => {},
  })

  assert.match(html, /Power Rating update available/)
  assert.match(html, /Completed games are waiting to be processed\./)
  assert.match(html, /Manual Rating Update/)
  assert.doesNotMatch(html, /initialization required/i)
  assertNoInvalidNumbers(html)
})

test('Dashboard automatic update trigger stays on initial load and Refresh', () => {
  const dashboardSource = readFileSync(
    new URL('../components/Dashboard.jsx', import.meta.url),
    'utf8',
  )
  const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const dateChangeBlock =
    dashboardSource.match(
      /const handleDateChange = \(event\) => \{[\s\S]*?const handleShiftDate/,
    )?.[0] ?? ''

  assert.match(
    dashboardSource,
    /useEffect\(\(\) => \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*triggerAutomaticPowerRatingUpdate\(\)[\s\S]*clearTimeout\(timerId\)[\s\S]*\}, \[triggerAutomaticPowerRatingUpdate\]\)/,
  )
  assert.match(
    dashboardSource,
    /const handleRefreshDashboard = \(\) => \{[\s\S]*?marketOddsRefreshDateRef\.current = displayDate[\s\S]*?handleRetry\(\)[\s\S]*?loadAccountData\(\)[\s\S]*?triggerAutomaticPowerRatingUpdate\(\)[\s\S]*?loadMarketOdds\(displayDate, \{ refresh: true \}\)[\s\S]*?\}/,
  )
  assert.doesNotMatch(dateChangeBlock, /triggerAutomaticPowerRatingUpdate/)
  assert.match(
    appSource,
    /if \(result\.gamesProcessed > 0\) \{[\s\S]*fetchPowerRatings\(\)[\s\S]*applyPowerRatingDocuments/,
  )
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
    initialMarketOdds: {
      'game-candidate': {
        away: '2.75',
        home: '1.35',
      },
    },
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
    gameOutcome: { lastPeriodType: 'REG' },
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

  assert.equal(countMatches(html, />FINAL</g), 1)
  assert.match(html, /class="schedule-card final compact-final has-saved-bet"/)
  assert.match(html, /Bet Saved/)
  assert.match(html, /Settlement pending/)
  assert.match(html, /View Analysis/)
  assert.match(html, /View Bet/)
  assert.doesNotMatch(html, />Analyze Game</)
  assert.doesNotMatch(html, /aria-label="Stored injury impact"/)
  assert.doesNotMatch(html, /aria-label="Goalie selections"/)
  assert.doesNotMatch(html, /aria-label="Schedule adjustments"/)
  assert.doesNotMatch(html, /<span class="dashboard-card-status final">Final/)
  assertNoInvalidNumbers(html)
})

test('compact final cards use authoritative overtime and shootout status labels', () => {
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
          gameOutcome: { lastPeriodType: 'OT' },
          gameState: 'OFF',
          home: team('NYR', 'New York Rangers', 3),
          periodDescriptor: { periodType: 'OT' },
          status: 'Final',
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
          gameOutcome: { lastPeriodType: 'SO' },
          gameState: 'OFF',
          home: team('NYR', 'New York Rangers', 3),
          periodDescriptor: { periodType: 'SO' },
          status: 'Final',
        }),
      ],
    },
  })

  assert.equal(countMatches(overtimeHtml, />FINAL OT</g), 1)
  assert.equal(countMatches(shootoutHtml, />FINAL SO</g), 1)
  assert.match(overtimeHtml, /class="schedule-card final compact-final"/)
  assert.match(overtimeHtml, /Carolina Hurricanes[\s\S]*2/)
  assert.match(overtimeHtml, /New York Rangers[\s\S]*3/)
  assert.match(overtimeHtml, /Winner <strong>New York Rangers<\/strong>/)
  assert.doesNotMatch(overtimeHtml, /Analyze Game|View Analysis|View Bet/)
  assert.doesNotMatch(shootoutHtml, /Analyze Game|View Analysis|View Bet/)
  assert.doesNotMatch(
    `${overtimeHtml}${shootoutHtml}`,
    /Stored injury impact|Goalie selections|Schedule adjustments|Preliminary Analysis/,
  )
  assertNoInvalidNumbers(`${overtimeHtml}${shootoutHtml}`)
})

test('Previous Day uses the same OT and SO final status labels', () => {
  const html = renderDashboard({
    initialBets: [],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [
        createGame({
          away: team('ANA', 'Anaheim Ducks', 4),
          gameId: 'previous-ot',
          gameOutcome: { lastPeriodType: 'OT' },
          gameState: 'OFF',
          home: team('WPG', 'Winnipeg Jets', 3),
          periodDescriptor: { periodType: 'OT' },
          status: 'Final',
        }),
        createGame({
          away: team('MIN', 'Minnesota Wild', 4),
          gameId: 'previous-so',
          gameOutcome: { lastPeriodType: 'SO' },
          gameState: 'OFF',
          home: team('WSH', 'Washington Capitals', 3),
          periodDescriptor: { periodType: 'SO' },
          status: 'Final',
        }),
      ],
    },
  })
  const previousDayHtml =
    html.match(/<aside class="dashboard-last-night-column"[\s\S]*<\/aside>/)?.[0] ??
    ''

  assert.match(previousDayHtml, />FINAL OT</)
  assert.match(previousDayHtml, />FINAL SO</)
  assert.match(previousDayHtml, /Anaheim Ducks[\s\S]*4/)
  assert.match(previousDayHtml, /Winnipeg Jets[\s\S]*3/)
  assert.match(previousDayHtml, /Minnesota Wild[\s\S]*4/)
  assert.match(previousDayHtml, /Washington Capitals[\s\S]*3/)
  assertNoInvalidNumbers(previousDayHtml)
})

test('scheduled and live Dashboard status labels remain unchanged', () => {
  const html = renderDashboard({
    initialBets: [],
    initialPreviousSchedule: {
      date: '2026-01-14',
      games: [],
    },
    initialSchedule: {
      date: '2026-01-15',
      games: [
        createGame({ gameId: 'still-scheduled' }),
        createGame({
          away: team('CAR', 'Carolina Hurricanes', 1),
          gameId: 'still-live',
          gameState: 'LIVE',
          home: team('NYR', 'New York Rangers', 2),
          status: 'Live',
        }),
      ],
    },
  })

  assert.match(html, />Scheduled</)
  assert.match(html, />Live</)
  assert.doesNotMatch(html, /compact-final|>FINAL(?: OT| SO)?</)
  assertNoInvalidNumbers(html)
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
    initialPreviousSchedule: {
      date: '2026-03-21',
      games: [],
    },
    initialSchedule: {
      date: '2026-03-22',
      games: [],
    },
    todayDateValue: '2026-08-24',
  })

  assert.match(html, /Selected Day/)
  assert.match(html, /Games on Sunday, March 22, 2026/)
  assert.match(html, /Previous Day/)
  assert.match(html, /Saturday, March 21, 2026/)
  assert.doesNotMatch(html, /Day before selected schedule date/)
  assert.doesNotMatch(html, /Today&#x27;s Games/)
  assert.doesNotMatch(html, /Last Night/)
  assert.doesNotMatch(
    html,
    /maanantaina|tiistaina|keskiviikkona|torstaina|perjantaina|lauantaina|sunnuntaina|klo/i,
  )
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

test('GameAnalyzer renders an automatic zero state without fatigue controls', () => {
  const html = renderGameAnalyzer({
    awayContext: {
      adjustmentBreakdown: [],
      conditions: ['well_rested', '4_games_in_6_days'],
      quickRematch: {
        reason: 'No previous head-to-head meeting.',
      },
      restDays: 2,
      restFatigueCondition: 'fourInSix',
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      teamId: 'LAK',
    },
    gameId: '2025021044',
    gameState: 'FUT',
    homeContext: {
      adjustmentBreakdown: [],
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      teamId: 'NYI',
    },
    scheduledStart: '2026-03-13T23:30:00.000Z',
    status: 'Scheduled',
  })

  assert.match(html, /Automatic Adjustments/)
  assert.match(html, /Read-only values supplied to the model/)
  assert.match(
    html,
    /data-testid="analyzer-away-restFatigue"[\s\S]*?<strong>0\.00<\/strong>[\s\S]*?No fatigue adjustment/,
  )
  assert.doesNotMatch(html, /<small>Well Rested<\/small>/)
  assert.doesNotMatch(html, /game-context-overrides/)
  assert.doesNotMatch(html, /<input[^>]*id="analyzer-away-restFatigue"/)
  assert.doesNotMatch(html, /rest and fatigue override/i)
  assertNoInvalidNumbers(html)
})

test('GameAnalyzer keeps automatic context and Effective Rating aligned', () => {
  const context = {
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: -1.25,
          category: 'restFatigue',
          condition: 'back_to_back_travel',
        },
        {
          adjustment: 0.25,
          category: 'quickRematch',
          condition: 'quick_rematch',
        },
      ],
      conditions: [
        '3_games_in_4_days',
        'back_to_back_travel',
        '4_games_in_6_days',
      ],
      quickRematch: {
        eligible: true,
      },
      restDays: 0,
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      teamId: 'LAK',
    },
    gameId: '2025021044',
    gameState: 'LIVE',
    homeContext: {
      adjustmentBreakdown: [],
      restDays: 2,
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      teamId: 'NYI',
    },
    status: 'Live',
  }
  const ratings = createRatings()
  const inputs = modelAnalysisUtils.createInputsForTeams(
    ratings,
    { away: 'LAK', home: 'NYI' },
    {},
    {},
    0,
    context,
  )
  const expectedAwayRating = calculateGameUtils
    .calculateGame(inputs.home, inputs.away)
    .awayFinalRating.toFixed(1)
  const html = renderGameAnalyzer(context)

  assert.match(html, /Back-to-Back \+ Travel/)
  assert.match(html, /Quick Rematch/)
  assert.match(
    html,
    /data-testid="analyzer-away-restFatigue"[\s\S]*?<strong>-1\.25<\/strong>/,
  )
  assert.match(
    html,
    /data-testid="analyzer-away-quickRematchAdjustment"[\s\S]*?<strong>\+0\.25<\/strong>/,
  )
  assert.match(
    html,
    new RegExp(
      `data-testid="analyzer-away-effective-rating">${expectedAwayRating}`,
    ),
  )
  assert.doesNotMatch(html, /game-context-overrides|Manual override active/)
  assert.doesNotMatch(
    html,
    /<input[^>]*id="analyzer-away-quickRematchAdjustment"/,
  )
  assertNoInvalidNumbers(html)
})

test('GameAnalyzer displays production fatigue conditions read-only and applies each once', () => {
  const cases = [
    {
      adjustment: -0.5,
      condition: '3_games_in_4_days',
      label: /3 Games in 4 Days/,
    },
    {
      adjustment: -1,
      condition: 'back_to_back',
      label: /Back-to-Back/,
    },
    {
      adjustment: -4,
      condition: 'back_to_back_travel',
      label: /Back-to-Back \+ Travel/,
    },
    {
      adjustment: 0.75,
      condition: 'well_rested',
      label: /Well Rested/,
    },
  ]

  cases.forEach(({ adjustment, condition, label }) => {
    const context = {
      awayContext: {
        adjustmentBreakdown: [{ adjustment, category: 'restFatigue', condition }],
        restFatigueCondition: condition,
      },
      awayTeam: {
        abbreviation: 'LAK',
        name: 'Los Angeles Kings',
        teamId: 'LAK',
      },
      gameId: `context-${condition}`,
      homeContext: {
        adjustmentBreakdown: [],
        restFatigueCondition: 'normal',
      },
      homeTeam: {
        abbreviation: 'NYI',
        name: 'New York Islanders',
        teamId: 'NYI',
      },
      status: 'Scheduled',
    }
    const ratings = createRatings()
    const inputs = modelAnalysisUtils.createInputsForTeams(
      ratings,
      { away: 'LAK', home: 'NYI' },
      {},
      {},
      0,
      context,
    )
    const expectedAwayRating = calculateGameUtils
      .calculateGame(inputs.home, inputs.away)
      .awayFinalRating.toFixed(1)
    const html = renderGameAnalyzer(context)

    assert.match(html, label)
    assert.match(
      html,
      new RegExp(
        `data-testid="analyzer-away-restFatigue"[\\s\\S]*?<strong>${adjustment > 0 ? '\\+' : ''}${adjustment.toFixed(2)}<\\/strong>`,
      ),
    )
    assert.match(
      html,
      new RegExp(
        `data-testid="analyzer-away-effective-rating">${expectedAwayRating}`,
      ),
    )
    assert.doesNotMatch(
      html,
      /<input[^>]*id="analyzer-away-restFatigue"/,
    )
  })
})

test('Dashboard uses concise schedule-adjustment labels and omits neutral context', () => {
  const adjustedContext = {
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: -1.25,
          condition: 'back_to_back_travel',
        },
        {
          adjustment: 0.25,
          category: 'quickRematch',
          condition: 'quick_rematch',
        },
      ],
      quickRematch: {
        eligible: true,
      },
    },
    awayTeam: {
      abbreviation: 'TOR',
      name: 'Toronto Maple Leafs',
      teamId: 'TOR',
    },
    gameId: 'game-candidate',
    homeContext: {
      adjustmentBreakdown: [
        {
          adjustment: -0.75,
          condition: 'back_to_back',
        },
      ],
    },
    homeTeam: {
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
  }
  const neutralContext = {
    ...adjustedContext,
    awayContext: {
      adjustmentBreakdown: [],
    },
    homeContext: {
      adjustmentBreakdown: [],
    },
  }
  const adjustedHtml = renderDashboard({
    initialGameContexts: [adjustedContext],
    initialGameContextsStatus: 'success',
  })
  const neutralHtml = renderDashboard({
    initialGameContexts: [neutralContext],
    initialGameContextsStatus: 'success',
  })

  assert.match(adjustedHtml, /aria-label="Schedule adjustments"/)
  assert.match(adjustedHtml, /aria-label="Stored injury impact"/)
  assert.match(adjustedHtml, /aria-label="Goalie selections"/)
  assert.match(adjustedHtml, />Analyze Game</)
  assert.match(adjustedHtml, /Away[\s\S]*B2B \+ Travel \+ Quick Rematch[\s\S]*-1\.00/)
  assert.match(adjustedHtml, /Home[\s\S]*B2B[\s\S]*-0\.75/)
  assert.doesNotMatch(adjustedHtml, /Away context|Home context/)
  assert.doesNotMatch(neutralHtml, /aria-label="Schedule adjustments"/)
  assertNoInvalidNumbers(`${adjustedHtml}${neutralHtml}`)
})

const createMarketOddsResponse = (overrides = {}) => ({
  date: '2026-01-15',
  fetchedAt: '2026-01-14T22:15:00.000Z',
  games: [
    {
      gameId: 'game-candidate',
      oddsStatus: 'ready',
      marketOdds: {
        allBookmakers: [
          {
            awayOdds: 2.3,
            bookmakerKey: 'book-a',
            bookmakerTitle: 'Bookmaker A',
            enabled: true,
            homeOdds: 1.68,
            lastUpdate: '2026-01-14T22:14:00.000Z',
          },
          {
            awayOdds: 2.2,
            bookmakerKey: 'book-b',
            bookmakerTitle: 'Bookmaker B',
            enabled: true,
            homeOdds: 1.72,
            lastUpdate: '2026-01-14T22:14:00.000Z',
          },
        ],
        awayBest: {
          bookmakerKey: 'book-a',
          bookmakerTitle: 'Bookmaker A',
          lastUpdate: '2026-01-14T22:14:00.000Z',
          odds: 2.3,
        },
        bookmakers: [],
        fetchedAt: '2026-01-14T22:15:00.000Z',
        homeBest: {
          bookmakerKey: 'book-b',
          bookmakerTitle: 'Bookmaker B',
          lastUpdate: '2026-01-14T22:14:00.000Z',
          odds: 1.72,
        },
        providerEventId: 'provider-event-1',
        providerName: 'The Odds API',
        source: 'provider',
      },
    },
  ],
  lowQuota: false,
  quota: { lastCost: 1, remaining: 100, used: 10 },
  source: 'provider',
  status: 'ready',
  ...overrides,
})

test('Dashboard renders provider best odds, bookmaker sources, and ready status', () => {
  const html = renderDashboard({
    initialMarketOdds: {},
    initialMarketOddsResponse: createMarketOddsResponse(),
  })

  assert.match(html, /Ready/)
  assert.match(html, /Market odds[\s\S]*Away 2\.30[\s\S]*Bookmaker A/)
  assert.match(html, /Home 1\.72[\s\S]*Bookmaker B/)
  assert.match(html, /View Market Odds/)
  assertNoInvalidNumbers(html)
})

test('manual Dashboard odds keep priority over refreshed provider values', () => {
  const html = renderDashboard({
    initialMarketOdds: {
      'game-candidate': { away: '4.50', home: '1.35' },
    },
    initialMarketOddsResponse: createMarketOddsResponse(),
  })

  assert.match(html, /Market odds[\s\S]*Away 4\.50[\s\S]*Manual/)
  assert.match(html, /Home 1\.35[\s\S]*Manual/)
})

test('Dashboard market status covers cache, unavailable, configuration, quota, and low credits', () => {
  const cached = renderDashboard({
    initialMarketOddsResponse: createMarketOddsResponse({
      source: 'cache',
      status: 'cached',
    }),
  })
  const unavailable = renderDashboard({
    initialMarketOddsResponse: createMarketOddsResponse({
      games: [],
      status: 'unavailable',
    }),
  })
  const notConfigured = renderDashboard({
    initialMarketOddsResponse: createMarketOddsResponse({
      games: [],
      status: 'not_configured',
    }),
  })
  const exhausted = renderDashboard({
    initialMarketOddsResponse: createMarketOddsResponse({
      games: [],
      status: 'quota_exhausted',
    }),
  })
  const low = renderDashboard({
    initialMarketOddsResponse: createMarketOddsResponse({
      lowQuota: true,
      quota: { lastCost: 1, remaining: 25, used: 75 },
    }),
  })

  assert.match(cached, /Cached/)
  assert.match(unavailable, /Provider unavailable/)
  assert.match(notConfigured, /Provider unavailable/)
  assert.match(exhausted, /Quota exhausted/)
  assert.match(low, /Low API credits: 25 remaining/)
  assert.doesNotMatch(cached, /Low API credits/)
})

test('one-sided provider odds leave the other side in Add Odds flow', () => {
  const response = createMarketOddsResponse()
  response.games[0].marketOdds.homeBest = null
  const html = renderDashboard({
    initialMarketOdds: {},
    initialMarketOddsResponse: response,
  })

  assert.match(html, /Away 2\.30/)
  assert.match(html, /Value side|Worth Reviewing|No positive edge/)
  assert.match(html, /aria-label="Boston Bruins market odds"[^>]*value=""/)
  assertNoInvalidNumbers(html)
})

test('Dashboard explains when provider markets have not opened yet', () => {
  const html = renderDashboard({
    initialMarketOdds: {},
    initialMarketOddsResponse: createMarketOddsResponse({
      games: [],
      status: 'no_events',
    }),
  })

  assert.equal(
    countMatches(
      html,
      /Market odds unavailable — markets have not opened yet\./g,
    ),
    1,
  )
  assert.doesNotMatch(html, /No markets available yet/)
  assert.match(html, /Preliminary/)
})

test('GameAnalyzer exposes explicit latest-odds action for provider prefill', () => {
  const context = {
    awayContext: { adjustmentBreakdown: [] },
    homeContext: { adjustmentBreakdown: [] },
  }
  const providerSide = (odds, bookmakerTitle) => ({
    bookmakerKey: bookmakerTitle.toLowerCase(),
    bookmakerLastUpdate: '2026-03-13T22:00:00.000Z',
    bookmakerTitle,
    offeredOdds: odds,
    providerEventId: 'event-1',
    providerFetchedAt: '2026-03-13T22:01:00.000Z',
    providerName: 'The Odds API',
    source: 'provider',
  })
  const html = renderGameAnalyzer(context, {
    prefillMatchup: {
      away: 'LAK',
      gameContext: context,
      gameId: '2025021044',
      home: 'NYI',
      marketOdds: {
        allBookmakers: [
          {
            awayOdds: 2.05,
            bookmakerKey: 'book-a',
            bookmakerTitle: 'Book A',
            enabled: true,
            homeOdds: 1.8,
            lastUpdate: '2026-03-13T22:00:00.000Z',
          },
        ],
        away: '2.05',
        home: '1.85',
        latestProvider: {
          away: providerSide(2.05, 'Book A'),
          home: providerSide(1.85, 'Book B'),
        },
        metadata: {
          away: providerSide(2.05, 'Book A'),
          home: providerSide(1.85, 'Book B'),
        },
      },
      scheduledStart: '2026-03-13T23:30:00.000Z',
    },
  })

  assert.match(html, /Use Latest Market Odds/)
  assert.match(html, /Market source/)
  assert.match(html, /Book A \/ Book B · Away 2\.05 · Home 1\.85/)
  assert.match(html, /View All Bookmakers/)
  assert.match(html, /Manual edits remain unchanged/)
  assertNoInvalidNumbers(html)
})

test('GameAnalyzer keeps the compact market source bar mounted before odds entry', () => {
  const context = {
    awayContext: { adjustmentBreakdown: [] },
    homeContext: { adjustmentBreakdown: [] },
  }
  const withoutOdds = renderGameAnalyzer(context, {
    prefillMatchup: {
      away: 'LAK',
      gameContext: context,
      gameId: '2025021044',
      home: 'NYI',
      scheduledStart: '2026-03-13T23:30:00.000Z',
    },
  })
  const withOdds = renderGameAnalyzer(context)

  for (const html of [withoutOdds, withOdds]) {
    assert.equal(
      (html.match(/analyzer-current-market-source compact/g) ?? []).length,
      1,
    )
  }

  assert.match(withoutOdds, /Manual entry · Add odds below/)
  assert.match(withOdds, /Manual · Away 2\.05 · Home 1\.85/)
})

test('Dashboard renders positive and negative Special Teams alerts independently', () => {
  const html = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
  })

  assert.match(html, /Boston Bruins special teams edge/)
  assert.match(html, /PP #5 vs TOR PK #29/)
  assert.match(html, /Strong PP vs Weak PK/)
  assert.match(html, /Toronto Maple Leafs special teams disadvantage/)
  assert.match(html, /PP #28 vs BOS PK #4/)
  assert.match(html, /Weak PP vs Strong PK/)
  assert.doesNotMatch(html, /Automatic adjustment/)
})

test('Dashboard keeps neutral, disabled, and missing Special Teams states quiet', () => {
  const neutral = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
  })
  const disabled = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsAlertsEnabled: false,
  })
  const missing = renderDashboard({
    initialSpecialTeams: specialTeamsData({ teams: [] }),
    initialSpecialTeamsStatus: 'success',
  })

  assert.doesNotMatch(neutral, /Dallas Stars special teams edge/)
  assert.doesNotMatch(disabled, /special teams (edge|disadvantage)/i)
  assert.doesNotMatch(missing, /special teams (edge|disadvantage)/i)
  assert.match(missing, /Analyze Game/)
})

test('Dashboard threshold changes the signal without changing model probabilities', () => {
  const baseline = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsAlertsEnabled: false,
  })
  const thresholdSix = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsRankThreshold: 6,
  })
  const thresholdEight = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsRankThreshold: 8,
  })
  const getModelProbabilities = (html) => html.match(/Model \d+\.\d%/g) ?? []

  assert.doesNotMatch(thresholdSix, /Dallas Stars special teams edge/)
  assert.match(thresholdEight, /Dallas Stars special teams edge/)
  assert.match(thresholdEight, /PP #7 vs COL PK #25/)
  assert.deepEqual(
    getModelProbabilities(thresholdEight),
    getModelProbabilities(baseline),
  )
})

test('Dashboard Automatic mode shows each applied value and updates model output', () => {
  const alertOnly = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsMode: 'alert_only',
  })
  const automatic = renderDashboard({
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsAdjustment: 0.5,
    specialTeamsMode: 'automatic',
  })
  const getModelProbabilities = (html) => html.match(/Model \d+\.\d%/g) ?? []

  assert.match(
    automatic,
    /Boston Bruins special teams edge[\s\S]*Automatic adjustment \+0\.50/,
  )
  assert.match(
    automatic,
    /Toronto Maple Leafs special teams disadvantage[\s\S]*Automatic adjustment -0\.50/,
  )
  assert.notDeepEqual(
    getModelProbabilities(automatic),
    getModelProbabilities(alertOnly),
  )
})

test('Game Analyzer uses the shared positive, negative, and neutral matchup logic', () => {
  const signals = renderGameAnalyzer({}, {
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
  })
  const neutralStats = specialTeamsData({
    teams: [
      {
        penaltyKillLeagueRank: 16,
        powerPlayLeagueRank: 16,
        teamAbbreviation: 'LAK',
      },
      {
        penaltyKillLeagueRank: 16,
        powerPlayLeagueRank: 16,
        teamAbbreviation: 'NYI',
      },
    ],
  })
  const neutral = renderGameAnalyzer({}, {
    initialSpecialTeams: neutralStats,
    initialSpecialTeamsStatus: 'success',
  })

  assert.match(signals, /aria-label="Special Teams matchup alerts"/)
  assert.match(signals, /aria-expanded="false"[^>]*>View Special Teams details/)
  assert.match(signals, /PP #5 vs NYI PK #28/)
  assert.match(signals, /Strong PP vs Weak PK/)
  assert.match(signals, /PP #29 vs LAK PK #4/)
  assert.match(signals, /Weak PP vs Strong PK/)
  assert.equal(
    countMatches(neutral, /No strong special teams mismatch/g),
    2,
  )
})

test('Game Analyzer handles disabled and missing Special Teams data without adjustments', () => {
  const disabled = renderGameAnalyzer({}, {
    initialSpecialTeams: specialTeamsData(),
    initialSpecialTeamsStatus: 'success',
    specialTeamsAlertsEnabled: false,
  })
  const missing = renderGameAnalyzer({}, {
    initialSpecialTeams: specialTeamsData({ teams: [] }),
    initialSpecialTeamsStatus: 'success',
  })

  assert.doesNotMatch(disabled, /Special Teams Matchup/)
  assert.match(missing, /Special teams data unavailable/)
  assert.doesNotMatch(missing, /Special Teams Rating Adjustment/)
})

test('Game Analyzer shows read-only mode values and applies Automatic exactly once', () => {
  const data = specialTeamsData()
  const alertOnly = renderGameAnalyzer({}, {
    initialSpecialTeams: data,
    initialSpecialTeamsStatus: 'success',
    specialTeamsMode: 'alert_only',
  })
  const automatic = renderGameAnalyzer({}, {
    initialSpecialTeams: data,
    initialSpecialTeamsStatus: 'success',
    specialTeamsAdjustment: 0.5,
    specialTeamsMode: 'automatic',
  })
  const effectiveRating = (html, side) =>
    Number(
      html.match(
        new RegExp(
          `data-testid="analyzer-${side}-effective-rating"[^>]*>(\\d+\\.\\d)`,
        ),
      )?.[1],
    )

  assert.match(
    alertOnly,
    /data-testid="analyzer-away-specialTeamsAdjustment"[\s\S]*?<strong>0\.00<\/strong>[\s\S]*?Alert only · Strong PP vs Weak PK/,
  )
  assert.match(
    automatic,
    /data-testid="analyzer-away-specialTeamsAdjustment"[\s\S]*?<strong>\+0\.50<\/strong>[\s\S]*?Automatic · Strong PP vs Weak PK/,
  )
  assert.match(
    automatic,
    /data-testid="analyzer-home-specialTeamsAdjustment"[\s\S]*?<strong>-0\.50<\/strong>[\s\S]*?Automatic · Weak PP vs Strong PK/,
  )
  assert.doesNotMatch(
    automatic,
    /<input[^>]*id="analyzer-(away|home)-specialTeamsAdjustment"/,
  )
  assert.equal(
    effectiveRating(automatic, 'away'),
    effectiveRating(alertOnly, 'away') + 0.5,
  )
  assert.equal(
    effectiveRating(automatic, 'home'),
    effectiveRating(alertOnly, 'home') - 0.5,
  )
})

test('Dashboard and Game Analyzer show consistent signals for the same game', () => {
  const data = specialTeamsData()
  const dashboard = renderDashboard({
    initialSpecialTeams: data,
    initialSpecialTeamsStatus: 'success',
  })
  const analyzer = renderGameAnalyzer({}, {
    initialSpecialTeams: data,
    initialSpecialTeamsStatus: 'success',
    prefillMatchup: {
      away: 'TOR',
      home: 'BOS',
      marketOdds: { away: '2.10', home: '1.80' },
    },
  })

  for (const detail of [
    'PP #5 vs TOR PK #29',
    'PP #28 vs BOS PK #4',
    'Strong PP vs Weak PK',
    'Weak PP vs Strong PK',
  ]) {
    assert.match(dashboard, new RegExp(detail))
    assert.match(analyzer, new RegExp(detail))
  }
})
