process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const { createMarketOddsService } = require('../services/marketOddsService')
const { MarketOddsProviderError } = require('../services/marketOddsProvider')
const {
  makeProviderEvent,
} = require('./fixtures/oddsSnapshotFixtures')

const WINDOW = {
  commenceTimeFrom: '2026-10-08T18:00:00.000Z',
  commenceTimeTo: '2026-10-08T20:00:00.000Z',
}

const createConfig = (apiKey = 'test-key') => ({
  apiKey,
  baseUrl: 'https://example.invalid',
  bookmakers: REQUESTED_BOOKMAKERS,
  cacheTtlMs: 60 * 60 * 1000,
  dateFormat: 'iso',
  lowCreditThreshold: 5,
  market: 'h2h',
  minimumRefreshIntervalMs: 30 * 1000,
  oddsFormat: 'decimal',
  requestTimeoutMs: 1000,
  sport: 'icehockey_nhl',
})

test('capture provider data preserves cache observation time and refreshes stale data once', async () => {
  let nowMs = Date.parse('2026-10-08T18:40:00.000Z')
  let providerCalls = 0
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    now: () => nowMs,
    provider: {
      async fetchNhlMoneylineOdds() {
        providerCalls += 1
        const providerFetchedAt = new Date(nowMs).toISOString()

        return {
          events: [
            makeProviderEvent({
              bestAvailable: {
                away: { bookmakerKey: 'pinnacle', odds: 2.1 },
                home: { bookmakerKey: 'pinnacle', odds: 1.8 },
              },
              commenceTime: '2026-10-08T19:00:00.000Z',
              providerFetchedAt,
            }),
          ],
          providerFetchedAt,
          quota: {
            lastCost: 1,
            observedAt: providerFetchedAt,
            remaining: 99 - providerCalls,
            used: providerCalls,
          },
          status: 'ready',
        }
      },
    },
  })

  const first = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })
  nowMs = Date.parse('2026-10-08T18:48:00.000Z')
  const cached = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })
  nowMs = Date.parse('2026-10-08T18:51:00.000Z')
  const refreshed = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })

  assert.equal(first.requestAttempted, true)
  assert.equal(first.providerFetchedAt, '2026-10-08T18:40:00.000Z')
  assert.equal(cached.requestAttempted, false)
  assert.equal(cached.source, 'cache')
  assert.equal(cached.providerFetchedAt, '2026-10-08T18:40:00.000Z')
  assert.equal(refreshed.requestAttempted, true)
  assert.equal(refreshed.providerFetchedAt, '2026-10-08T18:51:00.000Z')
  assert.equal(providerCalls, 2)
})

test('capture provider data makes no request when the API key is absent', async () => {
  let providerCalls = 0
  const service = createMarketOddsService({
    getConfig: () => createConfig(''),
    provider: {
      async fetchNhlMoneylineOdds() {
        providerCalls += 1
        return null
      },
    },
  })
  const result = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })

  assert.equal(result.status, 'not_configured')
  assert.equal(result.requestAttempted, false)
  assert.equal(providerCalls, 0)
})

test('only actual provider calls are accounted with their manual or automatic source', async () => {
  const accounted = []
  let providerCalls = 0
  const nowMs = Date.parse('2026-10-08T18:40:00.000Z')
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    getGamesForDate: async () => ({
      date: '2026-10-08',
      games: [
        {
          awayTeam: { abbreviation: 'MTL', name: 'Montreal Canadiens' },
          gameId: '2026020001',
          gameState: 'PRE',
          homeTeam: { abbreviation: 'TOR', name: 'Toronto Maple Leafs' },
          startTimeUTC: '2026-10-08T19:00:00.000Z',
        },
      ],
    }),
    now: () => nowMs,
    provider: {
      async fetchNhlMoneylineOdds() {
        providerCalls += 1
        return {
          events: [
            makeProviderEvent({
              bestAvailable: {
                away: { bookmakerKey: 'pinnacle', odds: 2.1 },
                home: { bookmakerKey: 'pinnacle', odds: 1.8 },
              },
              commenceTime: '2026-10-08T19:00:00.000Z',
              providerFetchedAt: '2026-10-08T18:40:00.000Z',
            }),
          ],
          providerFetchedAt: '2026-10-08T18:40:00.000Z',
          quota: { lastCost: 1, remaining: 300 - providerCalls, used: providerCalls },
          status: 'ready',
        }
      },
    },
    recordProviderRequest: async (entry) => accounted.push(entry),
  })

  await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })
  await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })
  await service.getNhlMarketOdds({ date: '2026-10-08' })

  assert.equal(providerCalls, 2)
  assert.deepEqual(accounted.map(({ source }) => source), [
    'AUTOMATIC',
    'MANUAL',
  ])
  assert.equal(accounted.every(({ successful }) => successful), true)
})

test('failed actual provider calls are accounted once and cache-free throttles are not', async () => {
  const accounted = []
  let providerCalls = 0
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    now: () => Date.parse('2026-10-08T18:40:00.000Z'),
    provider: {
      async fetchNhlMoneylineOdds() {
        providerCalls += 1
        throw new MarketOddsProviderError('rate_limited', 'Rate limited.', {
          quota: { lastCost: 1, remaining: 250, used: 50 },
        })
      },
    },
    recordProviderRequest: async (entry) => accounted.push(entry),
  })

  const first = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })
  const throttled = await service.getNhlOddsCaptureData({
    ...WINDOW,
    maximumProviderAgeMs: 10 * 60 * 1000,
  })

  assert.equal(first.status, 'rate_limited')
  assert.equal(throttled.requestAttempted, false)
  assert.equal(providerCalls, 1)
  assert.equal(accounted.length, 1)
  assert.equal(accounted[0].source, 'AUTOMATIC')
  assert.equal(accounted[0].successful, false)
})
