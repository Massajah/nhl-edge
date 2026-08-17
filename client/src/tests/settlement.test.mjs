import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let apiClient
let betsApi
let settlementUtils
let vite

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
  betsApi = await vite.ssrLoadModule('/src/services/betsApi.js')
  settlementUtils = await vite.ssrLoadModule('/src/utils/savedAnalyses.js')
})

after(async () => {
  await vite?.close()
})

const createBet = (overrides = {}) => ({
  awayTeam: { abbreviation: 'TOR', name: 'Toronto', teamId: 'TOR' },
  betType: 'moneyline',
  finalAwayScore: null,
  finalHomeScore: null,
  gameId: '2025020999',
  homeTeam: { abbreviation: 'BOS', name: 'Boston', teamId: 'BOS' },
  id: 'bet-1',
  marketOdds: 1.8,
  result: 'pending',
  selectedSide: {
    homeAway: 'home',
    name: 'Boston',
    teamId: 'BOS',
  },
  selectedTeam: { name: 'Boston', teamId: 'BOS' },
  stake: 10,
  ...overrides,
})

test('settlement display distinguishes automatic, manual, pending and legacy states', () => {
  const automaticWin = settlementUtils.getBetSettlementDisplay(
    createBet({
      finalAwayScore: 2,
      finalHomeScore: 4,
      result: 'win',
      settlementSource: 'automatic',
    }),
  )
  const automaticLoss = settlementUtils.getBetSettlementDisplay(
    createBet({ result: 'loss', settlementSource: 'automatic' }),
  )
  const manualVoid = settlementUtils.getBetSettlementDisplay(
    createBet({ result: 'void', settlementSource: 'manual' }),
  )
  const pending = settlementUtils.getBetSettlementDisplay(createBet())
  const legacy = settlementUtils.getBetSettlementDisplay(
    createBet({ betType: '', gameId: '' }),
  )
  const providerError = settlementUtils.getBetSettlementDisplay(
    createBet({ settlementIssue: 'Unable to retrieve the NHL game result.' }),
  )

  assert.equal(automaticWin.label, 'Win')
  assert.equal(automaticWin.message, 'Auto-settled')
  assert.equal(automaticWin.finalScore, 'TOR 2–4 BOS')
  assert.equal(automaticLoss.label, 'Loss')
  assert.equal(automaticLoss.message, 'Auto-settled')
  assert.equal(manualVoid.message, 'Manual')
  assert.equal(pending.message, 'Awaiting final result')
  assert.match(legacy.message, /game not linked/i)
  assert.match(providerError.message, /retrieve/i)
})

test('settlement summary reports wins, losses and remaining pending bets', () => {
  assert.equal(
    settlementUtils.formatSettlementSummary({
      losses: 1,
      settled: 2,
      stillPending: 3,
      wins: 1,
    }),
    '2 bets settled · 1 win · 1 loss · 3 still pending',
  )
})

test('settlement action uses one authenticated POST and returns its summary', async () => {
  const originalFetch = globalThis.fetch
  const requests = []

  apiClient.setAuthToken('settlement-token')
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      authorization: new Headers(options.headers).get('Authorization'),
      method: options.method,
      url,
    })

    return new Response(
      JSON.stringify({
        summary: {
          losses: 1,
          settled: 2,
          stillPending: 3,
          wins: 1,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }

  try {
    const summary = await betsApi.settleCompletedBets()

    assert.equal(summary.settled, 2)
    assert.deepEqual(requests, [
      {
        authorization: 'Bearer settlement-token',
        method: 'POST',
        url: '/api/bets/settle',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
    apiClient.setAuthToken('')
  }
})

test('Bet Tracker triggers settlement only from its explicit action and refreshes state', async () => {
  const source = await readFile(
    new URL('../components/BetTracker.jsx', import.meta.url),
    'utf8',
  )

  assert.equal((source.match(/await settleCompletedBets\(\)/g) ?? []).length, 1)
  assert.match(source, /onClick=\{handleSettleCompletedBets\}/)
  assert.match(source, /const refreshedBets = await fetchBets\(\)/)
  assert.match(source, /await refreshBankrollQuietly\(\)/)
})
