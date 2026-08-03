process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const { getMarketOddsConfig } = require('../config/marketOdds')
const {
  MarketOddsProviderError,
  createMarketOddsProvider,
  normalizeProviderEvent,
  normalizeProviderEvents,
  normalizeQuotaHeaders,
} = require('../services/marketOddsProvider')
const {
  MATCH_TOLERANCE_MS,
  buildCommenceTimeWindow,
  createMarketOddsService,
  getMarketOddsCacheKey,
  matchEventsToGames,
} = require('../services/marketOddsService')
const { getNhlTeamIdentity } = require('../services/nhlTeamIdentity')
const { normalizeCreatePayload } = require('../services/betsService')

const NOW_ISO = '2026-08-03T12:00:00.000Z'
const API_KEY = 'secret-market-odds-key'

const createHeaders = (values = {}) => ({
  get(name) {
    return values[name.toLowerCase()] ?? null
  },
})

const createResponse = ({ body, headers = {}, ok = true, status = 200 }) => ({
  headers: createHeaders(headers),
  ok,
  status,
  text: async () => JSON.stringify(body),
})

const createProviderBody = ({ commenceTime = '2026-08-04T00:00:00Z' } = {}) => [
  {
    id: 'event-1',
    sport_key: 'icehockey_nhl',
    commence_time: commenceTime,
    home_team: 'Boston Bruins',
    away_team: 'Toronto Maple Leafs',
    bookmakers: [
      {
        key: 'book-a',
        title: 'Book A',
        markets: [
          {
            key: 'h2h',
            last_update: '2026-08-03T11:58:00Z',
            outcomes: [
              { name: 'Boston Bruins', price: 1.72 },
              { name: 'Toronto Maple Leafs', price: 2.3 },
            ],
          },
        ],
      },
      {
        key: 'book-b',
        title: 'Book B',
        markets: [
          {
            key: 'h2h',
            last_update: '2026-08-03T11:59:00Z',
            outcomes: [
              { name: 'Boston Bruins', price: 1.8 },
              { name: 'Toronto Maple Leafs', price: 2.2 },
            ],
          },
        ],
      },
    ],
  },
]

const createConfig = (overrides = {}) => ({
  ...getMarketOddsConfig({
    MARKET_ODDS_CACHE_TTL_MS: '600000',
    MARKET_ODDS_LOW_CREDIT_THRESHOLD: '25',
    MARKET_ODDS_MIN_REFRESH_INTERVAL_MS: '30000',
    THE_ODDS_API_KEY: API_KEY,
  }),
  ...overrides,
})

const createNormalizedEvents = () =>
  normalizeProviderEvents(createProviderBody(), NOW_ISO)

const createSchedule = (date = '2026-08-03') => ({
  date,
  games: [
    {
      gameId: 'game-1',
      gameState: 'FUT',
      startTimeUTC: '2026-08-04T00:00:00Z',
      awayTeam: { abbreviation: 'TOR', name: 'Toronto Maple Leafs' },
      homeTeam: { abbreviation: 'BOS', name: 'Boston Bruins' },
      status: 'Scheduled',
    },
  ],
})

test('provider reports not_configured without issuing a request', async () => {
  let calls = 0
  const provider = createMarketOddsProvider({
    fetchImpl: async () => {
      calls += 1
    },
    getConfig: () => createConfig({ apiKey: '' }),
  })

  const result = await provider.fetchNhlOdds(buildCommenceTimeWindow('2026-08-03'))

  assert.equal(result.status, 'not_configured')
  assert.equal(calls, 0)
})

test('provider constructs the fixed NHL EU h2h decimal request server-side', async () => {
  let requestUrl
  const provider = createMarketOddsProvider({
    fetchImpl: async (url) => {
      requestUrl = new URL(url)
      return createResponse({ body: createProviderBody() })
    },
    getConfig: () => createConfig(),
    now: () => new Date(NOW_ISO),
  })
  const window = buildCommenceTimeWindow('2026-08-03')

  await provider.fetchNhlOdds(window)

  assert.equal(requestUrl.origin, 'https://api.the-odds-api.com')
  assert.equal(requestUrl.pathname, '/v4/sports/icehockey_nhl/odds')
  assert.equal(requestUrl.searchParams.get('apiKey'), API_KEY)
  assert.equal(requestUrl.searchParams.get('regions'), 'eu')
  assert.equal(requestUrl.searchParams.get('markets'), 'h2h')
  assert.equal(requestUrl.searchParams.get('oddsFormat'), 'decimal')
  assert.equal(requestUrl.searchParams.get('dateFormat'), 'iso')
  assert.equal(requestUrl.searchParams.get('commenceTimeFrom'), window.commenceTimeFrom)
  assert.equal(requestUrl.searchParams.get('commenceTimeTo'), window.commenceTimeTo)
})

test('normalization preserves bookmakers and selects independent best prices', () => {
  const event = normalizeProviderEvent(createProviderBody()[0], NOW_ISO)

  assert.equal(event.bookmakers.length, 2)
  assert.deepEqual(event.bestAvailable.away, {
    bookmakerKey: 'book-a',
    bookmakerTitle: 'Book A',
    lastUpdate: '2026-08-03T11:58:00Z',
    odds: 2.3,
  })
  assert.equal(event.bestAvailable.home.bookmakerKey, 'book-b')
  assert.equal(event.bestAvailable.home.odds, 1.8)
})

test('invalid odds, incomplete bookmakers, and h2h_lay are ignored', () => {
  const body = createProviderBody()[0]
  body.bookmakers = [
    {
      key: 'invalid',
      title: 'Invalid',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Boston Bruins', price: 1 },
            { name: 'Toronto Maple Leafs', price: 'NaN' },
          ],
        },
      ],
    },
    {
      key: 'incomplete',
      markets: [
        { key: 'h2h', outcomes: [{ name: 'Boston Bruins', price: 1.9 }] },
      ],
    },
    {
      key: 'exchange-lay',
      markets: [
        {
          key: 'h2h_lay',
          outcomes: [
            { name: 'Boston Bruins', price: 2.1 },
            { name: 'Toronto Maple Leafs', price: 2.1 },
          ],
        },
      ],
    },
  ]

  const event = normalizeProviderEvent(body, NOW_ISO)

  assert.deepEqual(event.bookmakers, [])
  assert.equal(event.bestAvailable.away, null)
  assert.equal(event.bestAvailable.home, null)
})

test('malformed provider JSON shape is rejected with a safe error', () => {
  assert.throws(
    () => normalizeProviderEvents({ events: [] }, NOW_ISO),
    (error) =>
      error.status === 'invalid_response' &&
      !error.message.includes(API_KEY),
  )
})

test('quota headers expose only normalized credit metadata', () => {
  assert.deepEqual(
    normalizeQuotaHeaders(
      createHeaders({
        'x-requests-last': '1',
        'x-requests-remaining': '24',
        'x-requests-used': '76',
      }),
      NOW_ISO,
    ),
    { lastCost: 1, observedAt: NOW_ISO, remaining: 24, used: 76 },
  )
})

test('quota exhaustion and rate limiting return structured secret-free errors', async () => {
  for (const responseOptions of [
    {
      body: { error_code: 'OUT_OF_USAGE_CREDITS', message: API_KEY },
      status: 401,
    },
    { body: { message: 'slow down' }, status: 429 },
  ]) {
    const provider = createMarketOddsProvider({
      fetchImpl: async () =>
        createResponse({ ...responseOptions, ok: false }),
      getConfig: () => createConfig(),
    })

    await assert.rejects(
      () => provider.fetchNhlOdds(buildCommenceTimeWindow('2026-08-03')),
      (error) =>
        ['quota_exhausted', 'rate_limited'].includes(error.status) &&
        !error.message.includes(API_KEY),
    )
  }
})

test('team identity mapper handles abbreviations, aliases, punctuation, and Utah naming', () => {
  assert.equal(getNhlTeamIdentity('MTL'), 'MTL')
  assert.equal(getNhlTeamIdentity('Montréal Canadiens'), 'MTL')
  assert.equal(getNhlTeamIdentity('St. Louis Blues'), 'STL')
  assert.equal(getNhlTeamIdentity('Utah Hockey Club'), 'UTA')
  assert.equal(getNhlTeamIdentity('Utah Mammoth'), 'UTA')
})

test('matching requires home-away order and time tolerance', () => {
  const schedule = createSchedule()
  const events = createNormalizedEvents()
  const exact = matchEventsToGames({
    events,
    games: schedule.games,
    nowMs: Date.parse(NOW_ISO),
  })

  assert.equal(exact.games[0].oddsStatus, 'ready')
  assert.equal(exact.games[0].marketOdds.awayBest.odds, 2.3)

  const reversed = {
    ...events[0],
    awayTeamIdentity: 'BOS',
    homeTeamIdentity: 'TOR',
  }
  const reversedResult = matchEventsToGames({
    events: [reversed],
    games: schedule.games,
    nowMs: Date.parse(NOW_ISO),
  })

  assert.equal(reversedResult.games[0].oddsStatus, 'unmatched')
  assert.equal(reversedResult.games[0].marketOdds, null)

  const late = {
    ...events[0],
    commenceTime: new Date(
      Date.parse(schedule.games[0].startTimeUTC) + MATCH_TOLERANCE_MS + 1,
    ).toISOString(),
  }
  const lateResult = matchEventsToGames({
    events: [late],
    games: schedule.games,
    nowMs: Date.parse(NOW_ISO),
  })

  assert.equal(lateResult.games[0].oddsStatus, 'unmatched')
  assert.equal(lateResult.games[0].marketOdds, null)
})

test('started games never receive current pre-match odds', () => {
  const result = matchEventsToGames({
    events: createNormalizedEvents(),
    games: [{ ...createSchedule().games[0], gameState: 'LIVE' }],
    nowMs: Date.parse(NOW_ISO),
  })

  assert.equal(result.games[0].oddsStatus, 'started')
  assert.equal(result.games[0].marketOdds, null)
})

test('service does not spend provider credits when every schedule game has started', async () => {
  let calls = 0
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    getGamesForDate: async () => ({
      ...createSchedule(),
      games: [{ ...createSchedule().games[0], gameState: 'FINAL' }],
    }),
    now: () => Date.parse(NOW_ISO),
    provider: {
      async fetchNhlOdds() {
        calls += 1
      },
    },
  })
  const result = await service.getNhlMarketOdds({ date: '2026-08-03' })

  assert.equal(calls, 0)
  assert.equal(result.status, 'no_events')
  assert.equal(result.games[0].oddsStatus, 'started')
})

test('cache is shared, expires, keys include windows, and forced refresh is bounded', async () => {
  let nowMs = Date.parse(NOW_ISO)
  let calls = 0
  const provider = {
    async fetchNhlOdds() {
      calls += 1
      return {
        events: createNormalizedEvents(),
        providerFetchedAt: new Date(nowMs).toISOString(),
        quota: { lastCost: 1, observedAt: NOW_ISO, remaining: 100, used: calls },
        status: 'ready',
      }
    },
  }
  const config = createConfig({ cacheTtlMs: 1000, minimumRefreshIntervalMs: 30000 })
  const service = createMarketOddsService({
    getConfig: () => config,
    getGamesForDate: async (date) => createSchedule(date),
    now: () => nowMs,
    provider,
  })

  const [first, concurrent] = await Promise.all([
    service.getNhlMarketOdds({ date: '2026-08-03' }),
    service.getNhlMarketOdds({ date: '2026-08-03' }),
  ])
  const cached = await service.getNhlMarketOdds({ date: '2026-08-03' })
  const forcedTooSoon = await service.getNhlMarketOdds({
    date: '2026-08-03',
    refresh: true,
  })

  assert.equal(calls, 1)
  assert.equal(first.status, 'ready')
  assert.equal(concurrent.status, 'ready')
  assert.equal(cached.status, 'cached')
  assert.equal(forcedTooSoon.status, 'cached')
  assert.equal(service.getStatus().status, 'cached')
  assert.deepEqual(cached.availableBookmakers, [
    { bookmakerKey: 'book-a', bookmakerTitle: 'Book A' },
    { bookmakerKey: 'book-b', bookmakerTitle: 'Book B' },
  ])

  nowMs += 1001
  await service.getNhlMarketOdds({ date: '2026-08-03' })
  assert.equal(calls, 2)

  const firstWindow = buildCommenceTimeWindow('2026-08-03')
  const secondWindow = buildCommenceTimeWindow('2026-08-04')
  assert.notEqual(
    getMarketOddsCacheKey(config, firstWindow),
    getMarketOddsCacheKey(config, secondWindow),
  )
})

test('fresh cache is used when a safe forced refresh is rate limited', async () => {
  let nowMs = Date.parse(NOW_ISO)
  let calls = 0
  const provider = {
    async fetchNhlOdds() {
      calls += 1
      if (calls > 1) {
        throw new MarketOddsProviderError('rate_limited', 'Rate limited.')
      }
      return {
        events: createNormalizedEvents(),
        providerFetchedAt: NOW_ISO,
        quota: { lastCost: 1, observedAt: NOW_ISO, remaining: 100, used: 1 },
        status: 'ready',
      }
    },
  }
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    getGamesForDate: async () => createSchedule(),
    now: () => nowMs,
    provider,
  })

  await service.getNhlMarketOdds({ date: '2026-08-03' })
  nowMs += 31000
  const fallback = await service.getNhlMarketOdds({
    date: '2026-08-03',
    refresh: true,
  })

  assert.equal(calls, 2)
  assert.equal(fallback.status, 'cached')
  assert.equal(fallback.games[0].oddsStatus, 'ready')
})

test('quota exhaustion preserves non-expired cached odds and blocks repeated calls', async () => {
  let nowMs = Date.parse(NOW_ISO)
  let calls = 0
  const provider = {
    async fetchNhlOdds() {
      calls += 1
      if (calls > 1) {
        throw new MarketOddsProviderError(
          'quota_exhausted',
          'No credits remain.',
          {
            quota: {
              lastCost: 1,
              observedAt: new Date(nowMs).toISOString(),
              remaining: 0,
              used: 100,
            },
          },
        )
      }
      return {
        events: createNormalizedEvents(),
        providerFetchedAt: NOW_ISO,
        quota: { lastCost: 1, observedAt: NOW_ISO, remaining: 100, used: 1 },
        status: 'ready',
      }
    },
  }
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    getGamesForDate: async () => createSchedule(),
    now: () => nowMs,
    provider,
  })

  await service.getNhlMarketOdds({ date: '2026-08-03' })
  nowMs += 31000
  const exhausted = await service.getNhlMarketOdds({
    date: '2026-08-03',
    refresh: true,
  })
  const repeated = await service.getNhlMarketOdds({
    date: '2026-08-03',
    refresh: true,
  })

  assert.equal(calls, 2)
  assert.equal(exhausted.status, 'quota_exhausted')
  assert.equal(exhausted.source, 'cache')
  assert.equal(exhausted.games[0].oddsStatus, 'ready')
  assert.equal(exhausted.quota.remaining, 0)
  assert.equal(repeated.games[0].marketOdds.awayBest.odds, 2.3)
})

test('failed requests are negatively throttled to prevent a refresh storm', async () => {
  let calls = 0
  const service = createMarketOddsService({
    getConfig: () => createConfig(),
    getGamesForDate: async () => createSchedule(),
    now: () => Date.parse(NOW_ISO),
    provider: {
      async fetchNhlOdds() {
        calls += 1
        throw new MarketOddsProviderError('unavailable', 'Network failure.')
      },
    },
  })

  const first = await service.getNhlMarketOdds({ date: '2026-08-03' })
  const second = await service.getNhlMarketOdds({
    date: '2026-08-03',
    refresh: true,
  })
  const third = await service.getNhlMarketOdds({ date: '2026-08-03' })

  assert.equal(calls, 1)
  assert.equal(first.status, 'unavailable')
  assert.equal(second.status, 'unavailable')
  assert.equal(third.status, 'unavailable')
})

test('missing configuration is graceful and safe status never exposes a key', async () => {
  const service = createMarketOddsService({
    getConfig: () => createConfig({ apiKey: '' }),
    getGamesForDate: async () => createSchedule(),
    provider: { fetchNhlOdds: async () => assert.fail('provider called') },
  })
  const result = await service.getNhlMarketOdds({ date: '2026-08-03' })

  assert.equal(result.status, 'not_configured')
  assert.equal(result.games[0].oddsStatus, 'provider_unavailable')
  assert.equal(JSON.stringify(result).includes(API_KEY), false)
})

test('market odds endpoint requires authentication', async (t) => {
  const server = app.listen(0)
  t.after(() => server.close())
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  const response = await fetch(
    `http://127.0.0.1:${port}/api/market-odds/nhl?date=2026-08-03&userId=ignored`,
  )

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: 'Authentication required.',
    message: 'Authentication required.',
  })
})

const createBetPayload = (overrides = {}) => ({
  awayTeam: { abbreviation: 'TOR', name: 'Toronto Maple Leafs', teamId: 'TOR' },
  homeTeam: { abbreviation: 'BOS', name: 'Boston Bruins', teamId: 'BOS' },
  marketOdds: 2.3,
  modelProbability: 0.46,
  selectedSide: {
    abbreviation: 'TOR',
    homeAway: 'away',
    name: 'Toronto Maple Leafs',
    teamId: 'TOR',
  },
  selectedTeam: { abbreviation: 'TOR', name: 'Toronto Maple Leafs', teamId: 'TOR' },
  stake: 10,
  ...overrides,
})

test('saved bet normalization preserves provider snapshot and actual offered odds', () => {
  const normalized = normalizeCreatePayload(
    createBetPayload({
      bookmakerKey: 'book-a',
      bookmakerLastUpdate: '2026-08-03T11:59:00.000Z',
      bookmakerTitle: 'Book A',
      marketOddsSource: 'provider',
      offeredOdds: 9.99,
      providerEventId: 'event-1',
      providerFetchedAt: '2026-08-03T12:00:00.000Z',
      providerName: 'The Odds API',
    }),
  )

  assert.equal(normalized.marketOddsSource, 'provider')
  assert.equal(normalized.bookmakerTitle, 'Book A')
  assert.equal(normalized.providerEventId, 'event-1')
  assert.equal(normalized.offeredOdds, 2.3)
})

test('manual override saved bets cannot claim provider bookmaker metadata', () => {
  const normalized = normalizeCreatePayload(
    createBetPayload({
      bookmakerKey: 'book-a',
      bookmakerTitle: 'Book A',
      marketOdds: 2.4,
      marketOddsSource: 'manual_override',
      providerEventId: 'event-1',
      providerName: 'The Odds API',
    }),
  )

  assert.equal(normalized.marketOddsSource, 'manual_override')
  assert.equal(normalized.offeredOdds, 2.4)
  assert.equal(normalized.providerName, null)
  assert.equal(normalized.providerEventId, null)
  assert.equal(normalized.bookmakerKey, null)
  assert.equal(normalized.bookmakerTitle, null)
})
