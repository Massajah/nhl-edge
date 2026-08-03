import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let marketOddsApi
let marketOddsUtils
let savedAnalyses
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  marketOddsApi = await vite.ssrLoadModule('/src/services/marketOddsApi.js')
  marketOddsUtils = await vite.ssrLoadModule('/src/utils/marketOdds.js')
  savedAnalyses = await vite.ssrLoadModule('/src/utils/savedAnalyses.js')
})

after(async () => {
  await vite?.close()
})

const providerGame = {
  gameId: 'game-1',
  oddsStatus: 'ready',
  marketOdds: {
    awayBest: {
      bookmakerKey: 'away-book',
      bookmakerTitle: 'Away Book',
      lastUpdate: '2026-08-03T11:59:00.000Z',
      odds: 2.3,
    },
    bookmakers: [{ bookmakerKey: 'away-book' }],
    fetchedAt: '2026-08-03T12:00:00.000Z',
    homeBest: {
      bookmakerKey: 'home-book',
      bookmakerTitle: 'Home Book',
      lastUpdate: '2026-08-03T11:58:00.000Z',
      odds: 1.72,
    },
    providerEventId: 'event-1',
    providerName: 'The Odds API',
  },
}

test('provider odds index preserves best prices, bookmaker metadata, and status', () => {
  const indexed = marketOddsUtils.indexProviderMarketOdds([providerGame])

  assert.equal(indexed['game-1'].marketOdds.awayBest.odds, 2.3)
  assert.equal(indexed['game-1'].marketOdds.homeBest.bookmakerTitle, 'Home Book')
  assert.equal(indexed['game-1'].marketOdds.bookmakers.length, 1)
  assert.equal(indexed['game-1'].oddsStatus, 'ready')
})

test('manual values take priority while provider metadata remains available explicitly', () => {
  const providerOddsByGame = marketOddsUtils.indexProviderMarketOdds([
    providerGame,
  ])
  const resolved = marketOddsUtils.resolveGameMarketOdds({
    gameId: 'game-1',
    manualOddsByGame: {
      'game-1': { away: '2.55', home: '' },
    },
    providerOddsByGame,
  })

  assert.equal(resolved.away, '2.55')
  assert.equal(resolved.metadata.away.source, 'manual')
  assert.equal(resolved.home, '1.72')
  assert.equal(resolved.metadata.home.source, 'provider')
  assert.equal(resolved.latestProvider.away.offeredOdds, 2.3)
})

test('missing and one-sided provider values never fabricate odds', () => {
  const oneSided = structuredClone(providerGame)
  oneSided.marketOdds.homeBest = null
  const resolved = marketOddsUtils.resolveGameMarketOdds({
    gameId: 'game-1',
    providerOddsByGame: marketOddsUtils.indexProviderMarketOdds([oneSided]),
  })

  assert.equal(resolved.away, '2.3')
  assert.equal(resolved.home, '')
  assert.equal(resolved.metadata.home, null)
})

test('market odds API sends only date and refresh controls', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ options, url: String(url) })
    return new Response(
      JSON.stringify({ date: '2026-08-03', games: [], status: 'no_events' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  }

  try {
    await marketOddsApi.fetchNhlMarketOdds('2026-08-03')
    await marketOddsApi.fetchNhlMarketOdds('2026-08-04', { refresh: true })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.match(requests[0].url, /date=2026-08-03$/)
  assert.match(requests[1].url, /date=2026-08-04&refresh=true$/)
  assert.doesNotMatch(requests.map(({ url }) => url).join(' '), /apiKey|userId/)
})

test('bookmaker preference API persists enabled keys without a userId', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ options, url: String(url) })
    return new Response(
      JSON.stringify({
        preferences: {
          availableBookmakers: [],
          enabledBookmakerKeys: [],
        },
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  }

  try {
    await marketOddsApi.fetchBookmakerPreferences()
    await marketOddsApi.updateBookmakerPreferences(['book-a'])
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.match(requests[0].url, /\/api\/settings\/bookmakers$/)
  assert.equal(requests[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    enabledBookmakerKeys: ['book-a'],
  })
  assert.doesNotMatch(requests[1].options.body, /userId/)
})

const createAnalysisInput = () => ({
  awayTeam: { abbreviation: 'TOR', id: 'TOR', name: 'Toronto Maple Leafs' },
  gameId: 'game-1',
  homeTeam: { abbreviation: 'BOS', id: 'BOS', name: 'Boston Bruins' },
  inputs: {
    away: { baseRating: 50, marketOdds: 2.3 },
    home: { baseRating: 55, marketOdds: 1.72 },
  },
  result: {
    awayEdge: 0.02,
    awayExpectedValue: 4.2,
    awayFairOdds: 2.2,
    awayFinalRating: 50,
    awayImpliedProbability: 1 / 2.3,
    awayModelStatus: 'POSITIVE_VALUE',
    awayOddsDifference: 0.1,
    awayRecommendation: 'POSITIVE_VALUE',
    awayWinProbability: 0.46,
    homeEdge: -0.02,
    homeExpectedValue: -4.2,
    homeFairOdds: 1.85,
    homeFinalRating: 55,
    homeImpliedProbability: 1 / 1.72,
    homeModelStatus: 'NO_VALUE',
    homeOddsDifference: -0.13,
    homeRecommendation: 'NO_VALUE',
    homeWinProbability: 0.54,
    ratingDifference: 5,
  },
  scheduledStart: '2026-08-04T00:00:00.000Z',
  selectedSide: 'away',
  stake: 10,
})

const providerMetadata = {
  away: {
    bookmakerKey: 'away-book',
    bookmakerLastUpdate: '2026-08-03T11:59:00.000Z',
    bookmakerTitle: 'Away Book',
    offeredOdds: 2.3,
    providerEventId: 'event-1',
    providerFetchedAt: '2026-08-03T12:00:00.000Z',
    providerName: 'The Odds API',
    source: 'provider',
  },
}

test('saved bet payload snapshots untouched provider odds and bookmaker provenance', () => {
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    ...createAnalysisInput(),
    marketOddsMetadata: providerMetadata,
  })

  assert.equal(payload.marketOddsSource, 'provider')
  assert.equal(payload.providerName, 'The Odds API')
  assert.equal(payload.providerEventId, 'event-1')
  assert.equal(payload.bookmakerKey, 'away-book')
  assert.equal(payload.bookmakerTitle, 'Away Book')
  assert.equal(payload.providerFetchedAt, '2026-08-03T12:00:00.000Z')
  assert.equal(payload.bookmakerLastUpdate, '2026-08-03T11:59:00.000Z')
  assert.equal(payload.offeredOdds, 2.3)
})

test('edited provider odds are labeled manual without bookmaker claims', () => {
  const analysis = createAnalysisInput()
  analysis.inputs.away.marketOdds = 2.4
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    ...analysis,
    marketOddsMetadata: {
      away: marketOddsUtils.markOddsAsManual(providerMetadata.away, 2.4),
    },
  })

  assert.equal(payload.marketOddsSource, 'manual')
  assert.equal(payload.marketOdds, 2.4)
  assert.equal(payload.offeredOdds, 2.4)
  assert.equal(payload.providerName, null)
  assert.equal(payload.providerEventId, null)
  assert.equal(payload.bookmakerKey, null)
  assert.equal(payload.bookmakerTitle, null)
})

test('normalized historical saved snapshots do not change with new provider data', () => {
  const original = savedAnalyses.normalizeBet({
    ...savedAnalyses.createBetPayloadFromGameAnalysis({
      ...createAnalysisInput(),
      marketOddsMetadata: providerMetadata,
    }),
    id: 'saved-1',
  })
  const refreshedProvider = structuredClone(providerGame)
  refreshedProvider.marketOdds.awayBest.odds = 2.6
  marketOddsUtils.indexProviderMarketOdds([refreshedProvider])

  assert.equal(original.marketOdds, 2.3)
  assert.equal(original.offeredOdds, 2.3)
  assert.equal(original.bookmakerTitle, 'Away Book')
})

test('bookmaker odds sorting supports home, away, and alphabetical order', () => {
  const rows = [
    { awayOdds: 2.3, bookmakerTitle: 'Zulu', homeOdds: 1.7 },
    { awayOdds: 2.1, bookmakerTitle: 'Alpha', homeOdds: 1.9 },
    { awayOdds: 2.5, bookmakerTitle: 'Mike', homeOdds: 1.8 },
  ]

  assert.deepEqual(
    marketOddsUtils
      .sortBookmakerOdds(rows, 'home')
      .map(({ bookmakerTitle }) => bookmakerTitle),
    ['Alpha', 'Mike', 'Zulu'],
  )
  assert.deepEqual(
    marketOddsUtils
      .sortBookmakerOdds(rows, 'away')
      .map(({ bookmakerTitle }) => bookmakerTitle),
    ['Mike', 'Zulu', 'Alpha'],
  )
  assert.deepEqual(
    marketOddsUtils
      .sortBookmakerOdds(rows, 'bookmaker')
      .map(({ bookmakerTitle }) => bookmakerTitle),
    ['Alpha', 'Mike', 'Zulu'],
  )
})

test('market status labels distinguish no markets and cached data', () => {
  assert.equal(
    marketOddsUtils.getMarketOddsStatusLabel('no_events'),
    'No markets available yet',
  )
  assert.equal(
    marketOddsUtils.getMarketOddsStatusLabel('cached'),
    'Cached',
  )
  assert.equal(
    marketOddsUtils.getMarketOddsStatusLabel('rate_limited'),
    'Rate limited',
  )
  assert.equal(
    marketOddsUtils.getMarketOddsStatusLabel('quota_exhausted'),
    'Quota exhausted',
  )
})
