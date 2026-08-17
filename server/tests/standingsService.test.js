process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const standingsService = require('../services/standingsService')
const {
  CURRENT_STANDINGS_CACHE_TTL_MS,
  HISTORICAL_STANDINGS_CACHE_TTL_MS,
  StandingsError,
  getStandings,
  normalizeStandingRow,
} = require('../services/standingsService')

const CURRENT_SEASON = Object.freeze({
  endDate: '2026-04-16',
  id: '20252026',
  isCurrent: true,
  label: '2025–26',
  startDate: '2025-10-07',
})
const HISTORICAL_SEASON = Object.freeze({
  endDate: '2025-04-17',
  id: '20242025',
  isCurrent: false,
  label: '2024–25',
  startDate: '2024-10-04',
})
const SEASON_METADATA = Object.freeze({
  currentSeasonId: CURRENT_SEASON.id,
  seasons: [CURRENT_SEASON, HISTORICAL_SEASON],
})

const makeStanding = ({
  abbreviation = 'BOS',
  conference = 'Eastern',
  division = 'Atlantic',
  leagueSequence = 1,
  name = 'Boston Bruins',
  seasonId = 20252026,
} = {}) => ({
  clinchIndicator: 'x',
  conferenceName: conference,
  conferenceSequence: leagueSequence,
  divisionName: division,
  divisionSequence: leagueSequence,
  gameTypeId: 2,
  gamesPlayed: 82,
  goalAgainst: 220,
  goalFor: 255,
  l10Losses: 2,
  l10OtLosses: 1,
  l10Wins: 7,
  leagueSequence,
  losses: 24,
  otLosses: 8,
  pointPctg: 0.646341,
  points: 106,
  regulationPlusOtWins: 47,
  regulationWins: 42,
  seasonId,
  streakCode: 'W',
  streakCount: 3,
  teamAbbrev: { default: abbreviation },
  teamLogo: `https://assets.nhle.com/${abbreviation}.svg`,
  teamName: { default: name },
  wildcardSequence: 0,
  wins: 50,
})

const createOptions = (standings, overrides = {}) => ({
  cache: new Map(),
  inFlightRequests: new Map(),
  seasonMetadataProvider: async () => SEASON_METADATA,
  standingsProvider: async () => ({
    data: { standings },
    fetchedAt: '2026-01-15T12:00:00.000Z',
    source: 'live',
    stale: false,
  }),
  ...overrides,
})

const request = async (path) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)

    return {
      body: await response.json(),
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve)
    })
  }
}

test('shared standings route forwards only the validated season query', async () => {
  const originalGetStandings = standingsService.getStandings
  let receivedQuery = null

  standingsService.getStandings = async (query) => {
    receivedQuery = query

    return {
      currentSeasonId: CURRENT_SEASON.id,
      season: CURRENT_SEASON,
      seasons: [CURRENT_SEASON],
      selectedSeasonId: CURRENT_SEASON.id,
      standings: [],
      status: 'no_standings',
    }
  }

  try {
    const response = await request(
      `/api/standings?season=${HISTORICAL_SEASON.id}`,
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.status, 'no_standings')
  } finally {
    standingsService.getStandings = originalGetStandings
  }

  assert.equal(receivedQuery.season, HISTORICAL_SEASON.id)
})

test('current season resolves canonically and uses one league-wide now request', async () => {
  const providerRequests = []
  const rows = [
    makeStanding(),
    makeStanding({
      abbreviation: 'COL',
      conference: 'Western',
      division: 'Central',
      leagueSequence: 2,
      name: 'Colorado Avalanche',
    }),
  ]
  const result = await getStandings(
    {},
    createOptions(rows, {
      standingsProvider: async (standingDate) => {
        providerRequests.push(standingDate)

        return { data: { standings: rows }, source: 'live' }
      },
    }),
  )

  assert.equal(result.selectedSeasonId, CURRENT_SEASON.id)
  assert.equal(result.season.label, '2025–26')
  assert.equal(result.status, 'ready')
  assert.equal(result.standings.length, 2)
  assert.deepEqual(providerRequests, ['now'])
  assert.deepEqual(
    new Set(result.standings.map((row) => row.conference)),
    new Set(['Eastern', 'Western']),
  )
  assert.deepEqual(
    new Set(result.standings.map((row) => row.division)),
    new Set(['Atlantic', 'Central']),
  )
})

test('historical season uses its canonical final regular-season date', async () => {
  let requestedDate = null
  const historicalRow = makeStanding({ seasonId: 20242025 })
  const result = await getStandings(
    { season: '2024–25' },
    createOptions([historicalRow], {
      standingsProvider: async (standingDate) => {
        requestedDate = standingDate

        return { data: { standings: [historicalRow] }, source: 'cache' }
      },
    }),
  )

  assert.equal(requestedDate, HISTORICAL_SEASON.endDate)
  assert.equal(result.selectedSeasonId, HISTORICAL_SEASON.id)
  assert.equal(result.provider.endpoint, '/standings/2025-04-17')
  assert.equal(result.standings[0].officialRank, 1)
})

test('standing normalization exposes stable records, percentages and goals', () => {
  const normalized = normalizeStandingRow(makeStanding())

  assert.deepEqual(normalized, {
    clinchIndicator: 'x',
    conference: 'Eastern',
    conferenceRank: 1,
    division: 'Atlantic',
    divisionRank: 1,
    gamesPlayed: 82,
    goalDifferential: 35,
    goalsAgainst: 220,
    goalsFor: 255,
    last10Record: '7-2-1',
    losses: 24,
    officialRank: 1,
    overtimeLosses: 8,
    pointPercentage: 0.646341,
    points: 106,
    regulationPlusOvertimeWins: 47,
    regulationWins: 42,
    streak: 'W3',
    teamAbbreviation: 'BOS',
    teamId: 'BOS',
    teamLogo: 'https://assets.nhle.com/BOS.svg',
    teamName: 'Boston Bruins',
    wildcardRank: 0,
    wins: 50,
  })
})

test('historical Arizona display identity is preserved while franchise ID is canonical', () => {
  const normalized = normalizeStandingRow(
    makeStanding({
      abbreviation: 'ARI',
      name: 'Arizona Coyotes',
      seasonId: 20232024,
    }),
  )

  assert.equal(normalized.teamId, 'UTA')
  assert.equal(normalized.teamAbbreviation, 'ARI')
  assert.equal(normalized.teamName, 'Arizona Coyotes')
  assert.match(normalized.teamLogo, /ARI/)
})

test('preseason current season ignores prior-season standings without error', async () => {
  const result = await getStandings(
    {},
    createOptions([makeStanding({ seasonId: 20242025 })]),
  )

  assert.equal(result.status, 'no_standings')
  assert.deepEqual(result.standings, [])
  assert.equal(result.error, null)
})

test('preseason zero-game rows use the same calm empty state', async () => {
  const zeroGameRow = {
    ...makeStanding(),
    gamesPlayed: 0,
    losses: 0,
    otLosses: 0,
    points: 0,
    wins: 0,
  }
  const result = await getStandings({}, createOptions([zeroGameRow]))

  assert.equal(result.status, 'no_standings')
  assert.deepEqual(result.standings, [])
})

test('unsupported historical data returns an explicit unavailable state', async () => {
  const result = await getStandings(
    { season: HISTORICAL_SEASON.id },
    createOptions([]),
  )

  assert.equal(result.status, 'unavailable')
  assert.equal(result.error.code, 'unavailable')
  assert.match(result.error.message, /selected season/)
})

test('invalid or out-of-range seasons are rejected before provider access', async () => {
  let providerCalls = 0
  const options = createOptions([], {
    standingsProvider: async () => {
      providerCalls += 1
      return { standings: [] }
    },
  })

  await assert.rejects(
    () => getStandings({ season: 'not-a-season' }, options),
    (error) =>
      error instanceof StandingsError &&
      error.statusCode === 400 &&
      error.details.code === 'invalid_season',
  )
  await assert.rejects(
    () => getStandings({ season: '20192020' }, options),
    (error) =>
      error.statusCode === 400 && error.details.code === 'invalid_season',
  )
  assert.equal(providerCalls, 0)
})

test('provider failure returns a structured safe state', async () => {
  const result = await getStandings(
    {},
    createOptions([], {
      standingsProvider: async () => {
        throw new Error('raw provider body must not escape')
      },
    }),
  )

  assert.equal(result.status, 'provider_error')
  assert.equal(result.error.code, 'provider_error')
  assert.equal(JSON.stringify(result).includes('raw provider body'), false)
})

test('normalized standings cache prevents repeated provider traffic by season', async () => {
  let now = 1000
  let providerCalls = 0
  const cache = new Map()
  const rows = [makeStanding()]
  const options = createOptions(rows, {
    cache,
    nowProvider: () => now,
    standingsProvider: async () => {
      providerCalls += 1
      return { data: { standings: rows }, source: 'live' }
    },
  })

  await getStandings({}, options)
  await getStandings({}, options)
  assert.equal(providerCalls, 1)

  now += CURRENT_STANDINGS_CACHE_TTL_MS + 1
  await getStandings({}, options)
  assert.equal(providerCalls, 2)

  const historicalOptions = {
    ...options,
    nowProvider: () => now,
  }
  await getStandings({ season: HISTORICAL_SEASON.id }, historicalOptions)
  const historicalCacheEntry = cache.get(
    `${CURRENT_SEASON.id}:${HISTORICAL_SEASON.id}`,
  )

  assert.equal(providerCalls, 3)
  assert.equal(
    historicalCacheEntry.expiresAt,
    now + HISTORICAL_STANDINGS_CACHE_TTL_MS,
  )
})
