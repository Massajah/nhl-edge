import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let apiClient
let bankrollComponents
let betHistoryUtils
let betsApi
let betTrackerComponents
let savedAnalyses
let vite

const createBet = (overrides = {}) =>
  savedAnalyses.normalizeBet({
    analyzedAt: '2026-08-22T07:48:00.000Z',
    awayTeam: {
      abbreviation: 'DAL',
      name: 'Dallas Stars',
      teamId: 'DAL',
    },
    betType: 'moneyline',
    closingOdds: 1.95,
    expectedValue: 5,
    fairOdds: 1.82,
    finalAwayScore: 3,
    finalHomeScore: 2,
    gameId: 'game-1',
    homeTeam: {
      abbreviation: 'COL',
      name: 'Colorado Avalanche',
      teamId: 'COL',
    },
    id: 'bet-1',
    impliedMarketProbability: 0.5,
    marketOdds: 2,
    modelProbability: 0.55,
    modelStatus: 'Bet Candidate',
    notes: 'Watch the goalie confirmation.',
    probabilityEdge: 0.05,
    profit: 0,
    result: 'pending',
    selectedSide: {
      abbreviation: 'DAL',
      homeAway: 'away',
      name: 'Dallas Stars',
      teamId: 'DAL',
    },
    selectedTeam: {
      abbreviation: 'DAL',
      name: 'Dallas Stars',
      teamId: 'DAL',
    },
    sportsbook: 'Example Sportsbook',
    stake: 10.5,
    ...overrides,
  })

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  bankrollComponents = await vite.ssrLoadModule(
    '/src/components/bankroll/BankrollCashActions.jsx',
  )
  betHistoryUtils = await vite.ssrLoadModule('/src/utils/betHistory.js')
  betsApi = await vite.ssrLoadModule('/src/services/betsApi.js')
  betTrackerComponents = await vite.ssrLoadModule(
    '/src/components/BetTracker.jsx',
  )
  savedAnalyses = await vite.ssrLoadModule('/src/utils/savedAnalyses.js')
})

after(async () => {
  await vite?.close()
})

test('collapsed bet row shows primary fields without notes or expanded details', () => {
  const html = renderToStaticMarkup(
    React.createElement(betTrackerComponents.BetCard, {
      bet: createBet(),
      onDelete() {},
      onUpdate() {},
    }),
  )

  assert.match(html, /DAL vs COL/)
  assert.match(html, /Dallas Stars/)
  assert.match(html, /@2\.00/)
  assert.match(html, /10\.50u/)
  assert.match(html, /Bet Candidate/)
  assert.match(html, /Pending/)
  assert.match(html, /View bet details/)
  assert.doesNotMatch(html, /Watch the goalie confirmation/)
  assert.doesNotMatch(html, /Analysis details/)
  assert.doesNotMatch(html, />Delete</)
})

test('expanded bet preserves odds, settlement, editing, analysis, notes, and delete', () => {
  const html = renderToStaticMarkup(
    React.createElement(betTrackerComponents.BetCard, {
      bet: createBet({
        profit: 10.5,
        result: 'win',
        settlementCorrections: [
          {
            correctedAt: '2026-08-22T08:30:00.000Z',
            newResult: 'win',
            previousResult: 'loss',
            source: 'manual',
          },
        ],
        settlementSource: 'automatic',
      }),
      initialExpanded: true,
      onDelete() {},
      onUpdate() {},
    }),
  )

  for (const label of [
    'Fair odds',
    'Edge',
    'EV',
    'Settlement',
    'Final score',
    'Profit',
    'Result',
    'Stake (units)',
    'Sportsbook',
    'Closing odds',
    'Analysis details',
    'Notes',
    'Delete',
  ]) {
    assert.ok(html.includes(label))
  }

  assert.match(html, /Watch the goalie confirmation/)
  assert.match(html, /Hide bet details/)
  assert.match(html, /Auto-settled/)
  assert.match(html, /DAL 3–2 COL/)
  assert.match(html, /1 correction/)
  assert.match(html, /bet-expanded-summary/)
  assert.match(html, /bet-edit-grid/)
  assert.match(html, /rows="2"/)
  assert.equal((html.match(/Market odds/g) ?? []).length, 1)
  assert.doesNotMatch(html, /bet-odds-grid/)
})

test('expanded pending settlement folds source metadata into the compact strip', () => {
  const html = renderToStaticMarkup(
    React.createElement(betTrackerComponents.BetCard, {
      bet: createBet(),
      initialExpanded: true,
      onDelete() {},
      onUpdate() {},
    }),
  )

  assert.match(html, /Pending · Awaiting final result/)
  assert.doesNotMatch(html, /Corrections 0/)
})

test('collapsed settlement states use existing stored profit values', () => {
  const cases = [
    ['pending', 0, 'Pending'],
    ['win', 8.4, 'Won +8.40u'],
    ['loss', -5, 'Lost -5.00u'],
    ['void', 0, 'Void 0.00u'],
    ['push', 0, 'Push 0.00u'],
  ]

  for (const [result, profit, expected] of cases) {
    const html = renderToStaticMarkup(
      React.createElement(betTrackerComponents.BetCard, {
        bet: createBet({ profit, result, stake: 5 }),
        onDelete() {},
        onUpdate() {},
      }),
    )

    assert.ok(html.includes(expected))
  }
})

test('bet pagination renders disabled boundary controls', () => {
  const firstPage = renderToStaticMarkup(
    React.createElement(betTrackerComponents.BetHistoryPagination, {
      onPageChange() {},
      pagination: {
        hasNextPage: true,
        hasPreviousPage: false,
        page: 1,
        totalPages: 3,
      },
      status: 'success',
    }),
  )
  const finalPage = renderToStaticMarkup(
    React.createElement(betTrackerComponents.BetHistoryPagination, {
      onPageChange() {},
      pagination: {
        hasNextPage: false,
        hasPreviousPage: true,
        page: 3,
        totalPages: 3,
      },
      status: 'success',
    }),
  )

  assert.match(firstPage, /disabled=""[^>]*><svg[^>]*>[\s\S]*Prev/)
  assert.match(firstPage, /Page 1 \/ 3/)
  assert.match(finalPage, /Page 3 \/ 3/)
  assert.match(finalPage, /disabled=""[^>]*><span>Next<\/span>/)
})

test('bet API defaults to 5 and sends season, result, and model-status filters', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''

  globalThis.fetch = async (url) => {
    requestedUrl = url

    return new Response(
      JSON.stringify({
        filters: {
          modelStatus: 'Bet Candidate',
          result: 'pending',
        },
        items: Array.from({ length: 5 }, (_, index) =>
          createBet({ id: `bet-${index}` }),
        ),
        pagination: {
          hasNextPage: true,
          hasPreviousPage: false,
          page: 1,
          pageSize: 5,
          totalItems: 12,
          totalPages: 2,
        },
        summary: {
          pending: 12,
          statusCounts: { 'Bet Candidate': 12 },
          totalBets: 12,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }

  try {
    const result = await betsApi.fetchBetsPage({
      modelStatus: 'Bet Candidate',
      result: 'pending',
    })

    assert.equal(result.items.length, 5)
    assert.equal(result.pagination.pageSize, 5)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(
    requestedUrl,
    '/api/bets?page=1&limit=5&result=pending&modelStatus=Bet+Candidate&season=all',
  )
  assert.deepEqual(betHistoryUtils.BET_HISTORY_LIMIT_OPTIONS, [5, 10, 20])
})

test('bankroll ledger buttons expose first and final page boundaries', () => {
  const createLedger = (pagination) =>
    renderToStaticMarkup(
      React.createElement(betTrackerComponents.BankrollLedger, {
        currency: 'EUR',
        onPageChange() {},
        status: 'success',
        transactions: {
          items: [],
          pagination,
        },
      }),
    )
  const firstPage = createLedger({
    hasNextPage: true,
    hasPreviousPage: false,
    page: 1,
    totalItems: 30,
    totalPages: 3,
  })
  const finalPage = createLedger({
    hasNextPage: false,
    hasPreviousPage: true,
    page: 3,
    totalItems: 30,
    totalPages: 3,
  })

  assert.match(firstPage, /Page 1 \/ 3/)
  assert.match(firstPage, /disabled=""[^>]*><svg[^>]*>[\s\S]*Prev/)
  assert.match(finalPage, /Page 3 \/ 3/)
  assert.match(finalPage, /disabled=""[^>]*><span>Next<\/span>/)
})

test('bankroll date fields render only for the Custom period', () => {
  const seasonMetadata = {
    currentSeasonId: '20262027',
    metadataSource: 'api',
    seasons: [
      {
        endDate: '2027-04-15',
        id: '20262027',
        isCurrent: true,
        label: '2026-27',
        startDate: '2026-10-06',
      },
    ],
  }
  const renderControls = (draftFilters) =>
    renderToStaticMarkup(
      React.createElement(betTrackerComponents.BankrollControls, {
        draftFilters,
        filterValidation: { fieldErrors: {} },
        isLoading: false,
        limit: 5,
        seasonMetadata,
        seasonStatus: 'success',
        todayInputValue: '2026-08-24',
        onApplyFilters() {},
        onClearFilters() {},
        onFilterChange() {},
        onLimitChange() {},
        onRefresh() {},
      }),
    )

  for (const draftFilters of [
    { from: '', period: 'all-time', season: 'all', to: '', type: '' },
    {
      from: '2026-10-06',
      period: 'season',
      season: 'current',
      to: '2027-04-15',
      type: '',
    },
    {
      from: '2026-10-06',
      period: 'season',
      season: '20262027',
      to: '2027-04-15',
      type: '',
    },
  ]) {
    const html = renderControls(draftFilters)

    assert.doesNotMatch(html, /id="bankroll-from"/)
    assert.doesNotMatch(html, /id="bankroll-to"/)
    assert.doesNotMatch(html, /bankroll-toolbar-custom/)
  }

  const customHtml = renderControls({
    from: '2026-01-01',
    period: 'custom',
    season: 'custom',
    to: '2026-01-31',
    type: '',
  })

  assert.match(customHtml, /bankroll-toolbar-custom/)
  assert.match(customHtml, /id="bankroll-from"/)
  assert.match(customHtml, /id="bankroll-to"/)
  assert.match(customHtml, /value="2026-01-01"/)
  assert.match(customHtml, /value="2026-01-31"/)
})

test('bankroll actions remain shared deposit and non-destructive withdrawal flows', () => {
  const html = renderToStaticMarkup(
    React.createElement(bankrollComponents.default, {
      availableBankroll: 100,
      currency: 'EUR',
      currentBankroll: 100,
      onTransactionRecorded() {},
      todayInputValue: '2026-08-22',
    }),
  )

  assert.match(html, /bankroll-deposit-button/)
  assert.match(html, /Add Deposit/)
  assert.match(html, /bankroll-withdrawal-button/)
  assert.match(html, /Add Withdrawal/)
  assert.doesNotMatch(html, /delete-bet-button/)
})

test('filter and row changes reset both histories to page 1', async () => {
  const source = await readFile(
    new URL('../components/BetTracker.jsx', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /handleBankrollDraftFilterChange[\s\S]*setBankrollPage\(BANKROLL_DEFAULT_PAGE\)/,
  )
  assert.match(
    source,
    /handleBetFilterChange[\s\S]*setBetPage\(BET_HISTORY_DEFAULT_PAGE\)/,
  )
  assert.match(
    source,
    /handleModelStatusFilterChange[\s\S]*setBetPage\(BET_HISTORY_DEFAULT_PAGE\)/,
  )
  assert.match(
    source,
    /handleBetSeasonFilterChange[\s\S]*setBetPage\(BET_HISTORY_DEFAULT_PAGE\)/,
  )
  assert.match(source, /setBetLimit[\s\S]*setBetPage\(BET_HISTORY_DEFAULT_PAGE\)/)
})

test('Bankroll renders summary, shared cash actions, filters, ledger, then pagination', async () => {
  const source = await readFile(
    new URL('../components/BetTracker.jsx', import.meta.url),
    'utf8',
  )
  const panelStart = source.indexOf('function BankrollPanel')
  const panelEnd = source.indexOf('function BankrollLoadingState')
  const panelSource = source.slice(panelStart, panelEnd)
  const summaryPosition = panelSource.indexOf('<BankrollSummaryCards')
  const cashPosition = panelSource.indexOf('<BankrollCashActions')
  const controlsPosition = panelSource.indexOf('<BankrollControls')
  const ledgerPosition = panelSource.indexOf('<BankrollLedger')

  assert.ok(summaryPosition < cashPosition)
  assert.ok(cashPosition < controlsPosition)
  assert.ok(controlsPosition < ledgerPosition)

  const cardsStart = source.indexOf('function BankrollSummaryCards')
  const cardsEnd = source.indexOf('function BankrollControls')
  const cardsSource = source.slice(cardsStart, cardsEnd)

  assert.match(cardsSource, /label="Current Bankroll"/)
  assert.match(cardsSource, /label="Available Bankroll"/)
  assert.match(cardsSource, /label="Betting Profit"[\s\S]*detail="Selected period"/)
  assert.match(cardsSource, /label="Pending Exposure"/)
  assert.doesNotMatch(cardsSource, /label="Deposits"/)
  assert.doesNotMatch(cardsSource, /label="Withdrawals"/)
})

test('Bet History normalizes obsolete recommendation labels for presentation', () => {
  assert.equal(
    betHistoryUtils.normalizeBetHistoryModelStatus('Positive Value'),
    'Bet Candidate',
  )
  assert.equal(
    betHistoryUtils.normalizeBetHistoryModelStatus('Below Threshold'),
    'Positive Value · Below Threshold',
  )
  assert.equal(
    betHistoryUtils.normalizeBetHistoryModelStatus('Legacy bet'),
    'Legacy',
  )
  assert.deepEqual(
    Object.values(betHistoryUtils.BET_HISTORY_MODEL_STATUSES),
    [
      'Bet Candidate',
      'Positive Value · Below Threshold',
      'No Value',
      'Legacy',
    ],
  )
})

test('Bet History query includes a canonical season selection', () => {
  assert.equal(
    betHistoryUtils.buildBetHistoryQueryString({
      limit: 20,
      season: '20252026',
    }),
    '?page=1&limit=20&result=all&modelStatus=all&season=20252026',
  )
})
