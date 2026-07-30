import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let Dashboard
let dashboardUtils
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
  dashboardUtils = await vite.ssrLoadModule('/src/utils/dashboard.js')
  powerRatingUtils = await vite.ssrLoadModule('/src/utils/powerRatings.js')
})

after(async () => {
  await vite?.close()
})

test('dashboard helpers keep status priority and candidate rules centralized', () => {
  const analysis = {
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
    dashboardUtils.DASHBOARD_GAME_STATUSES.POTENTIAL_VALUE,
  )
  assert.equal(started.status, dashboardUtils.DASHBOARD_GAME_STATUSES.GAME_STARTED)
  assert.equal(needsOdds.status, dashboardUtils.DASHBOARD_GAME_STATUSES.NEEDS_ODDS)
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
  assert.match(html, /<strong>1<\/strong><span>Candidates<\/span>/)
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

test('Dashboard card render separates model lean from betting value', () => {
  const html = renderDashboard()

  assert.match(html, /class="schedule-card candidate"/)
  assert.match(html, /Bet candidate/)
  assert.match(html, /Model lean[\s\S]*Boston Bruins[\s\S]*win probability/)
  assert.match(html, /Best value[\s\S]*Toronto Maple Leafs \+/)
  assert.match(html, /class="schedule-card neutral"/)
  assert.match(html, /No current value/)
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
  assert.match(html, /Bet saved/)
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
  assert.match(html, /Bet saved/)
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
