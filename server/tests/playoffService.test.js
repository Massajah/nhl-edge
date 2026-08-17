process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const nhlApiService = require('../services/nhlApiService')
const playoffService = require('../services/playoffService')
const {
  CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS,
  HISTORICAL_PLAYOFF_CACHE_TTL_MS,
  PROJECTED_PLAYOFF_CACHE_TTL_MS,
  buildProjectedBracket,
  getPlayoffs,
  normalizeActualBracket,
} = playoffService

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

const makeNormalizedStanding = ({
  abbreviation,
  conference,
  conferenceRank,
  division,
  divisionRank,
  name = `${abbreviation} Team`,
  wildcardRank = 0,
}) => ({
  conference,
  conferenceRank,
  division,
  divisionRank,
  officialRank: conference === 'Eastern'
    ? conferenceRank
    : conferenceRank + 16,
  teamAbbreviation: abbreviation,
  teamId: abbreviation,
  teamLogo: `https://assets.nhle.com/${abbreviation}.svg`,
  teamName: name,
  wildcardRank,
})

const makeConferenceStandings = ({ conference, divisions, prefix }) => {
  let conferenceRank = 1
  const divisionRows = divisions.flatMap((division, divisionIndex) =>
    [1, 2, 3].map((divisionRank) => {
      const abbreviation = `${prefix}${divisionIndex}${divisionRank}`
      const row = makeNormalizedStanding({
        abbreviation,
        conference,
        conferenceRank,
        division,
        divisionRank,
      })

      conferenceRank += 1
      return row
    }),
  )
  const wildcardRows = [1, 2].map((wildcardRank) => {
    const abbreviation = `${prefix}W${wildcardRank}`
    const row = makeNormalizedStanding({
      abbreviation,
      conference,
      conferenceRank,
      division: divisions[wildcardRank - 1],
      divisionRank: 4,
      wildcardRank,
    })

    conferenceRank += 1
    return row
  })

  return [...divisionRows, ...wildcardRows]
}

const PROJECTED_STANDINGS = [
  ...makeConferenceStandings({
    conference: 'Eastern',
    divisions: ['Atlantic', 'Metropolitan'],
    prefix: 'E',
  }),
  ...makeConferenceStandings({
    conference: 'Western',
    divisions: ['Central', 'Pacific'],
    prefix: 'W',
  }),
]

const makeProviderTeam = (id, abbreviation, name = `${abbreviation} Team`) => ({
  abbrev: abbreviation,
  id,
  logo: `https://assets.nhle.com/${abbreviation}.svg`,
  name: { default: name },
})

const makeActualSeries = ({
  bottomAbbreviation = 'TBL',
  bottomId = 14,
  bottomWins = 2,
  letter = 'A',
  round = 1,
  topAbbreviation = 'FLA',
  topId = 13,
  topWins = 4,
  winnerId = topId,
} = {}) => ({
  bottomSeedRankAbbrev: 'WC1',
  bottomSeedTeam: makeProviderTeam(bottomId, bottomAbbreviation),
  bottomSeedWins: bottomWins,
  playoffRound: round,
  seriesLetter: letter,
  seriesTitle: round === 4 ? 'Stanley Cup Final' : `${round} Round`,
  topSeedRankAbbrev: 'D1',
  topSeedTeam: makeProviderTeam(topId, topAbbreviation),
  topSeedWins: topWins,
  winningTeamId: winnerId,
})

const ACTUAL_BRACKET = Object.freeze({
  series: [
    makeActualSeries(),
    makeActualSeries({ letter: 'I', round: 2 }),
    makeActualSeries({ letter: 'M', round: 3 }),
    makeActualSeries({
      bottomAbbreviation: 'EDM',
      bottomId: 22,
      bottomWins: 3,
      letter: 'O',
      round: 4,
    }),
  ],
})

const makeStandingsResponse = ({
  season = CURRENT_SEASON,
  standings = PROJECTED_STANDINGS,
  status = 'ready',
} = {}) => ({
  currentSeasonId: CURRENT_SEASON.id,
  error: status === 'provider_error'
    ? { code: status, message: 'Standings unavailable.' }
    : null,
  provider: {
    endpoint: season.isCurrent ? '/standings/now' : `/standings/${season.endDate}`,
    fetchedAt: '2026-01-15T12:00:00.000Z',
    name: 'NHL Web API',
    source: 'cache',
    stale: false,
  },
  season,
  selectedSeasonId: season.id,
  standings,
  status,
})

const createOptions = (standingsResponse, overrides = {}) => ({
  bracketProvider: async () => {
    const error = new Error('No bracket yet')
    error.upstreamStatus = 404
    throw error
  },
  cache: new Map(),
  inFlightRequests: new Map(),
  standingsResponseProvider: async () => standingsResponse,
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

test('shared playoff route forwards the selected standings season', async () => {
  const originalGetPlayoffs = playoffService.getPlayoffs
  let receivedQuery = null

  playoffService.getPlayoffs = async (query) => {
    receivedQuery = query
    return {
      currentSeasonId: CURRENT_SEASON.id,
      selectedSeasonId: HISTORICAL_SEASON.id,
      status: 'unavailable',
    }
  }

  try {
    const response = await request(
      `/api/standings/playoffs?season=${HISTORICAL_SEASON.id}`,
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.status, 'unavailable')
  } finally {
    playoffService.getPlayoffs = originalGetPlayoffs
  }

  assert.equal(receivedQuery.season, HISTORICAL_SEASON.id)
})

test('historical selection retrieves and normalizes the official bracket year', async () => {
  let requestedYear = null
  const result = await getPlayoffs(
    { season: HISTORICAL_SEASON.id },
    createOptions(makeStandingsResponse({ season: HISTORICAL_SEASON }), {
      bracketProvider: async (year) => {
        requestedYear = year
        return {
          data: ACTUAL_BRACKET,
          fetchedAt: '2025-06-18T12:00:00.000Z',
          source: 'live',
          stale: false,
        }
      },
    }),
  )

  assert.equal(requestedYear, '2025')
  assert.equal(result.selectedSeasonId, HISTORICAL_SEASON.id)
  assert.equal(result.mode, 'actual')
  assert.equal(result.status, 'ready')
  assert.equal(result.provider.endpoint, '/playoff-bracket/2025')
})

test('actual rounds expose conference, series score, winner and pending slots', () => {
  const result = normalizeActualBracket(ACTUAL_BRACKET, HISTORICAL_SEASON)
  const easternRounds = result.conferences.eastern.rounds
  const firstSeries = easternRounds[0].series[0]

  assert.deepEqual(
    easternRounds.map((round) => round.label),
    ['Round 1', 'Round 2', 'Conference Final'],
  )
  assert.equal(firstSeries.conference, 'eastern')
  assert.equal(firstSeries.higherSeedTeam.wins, 4)
  assert.equal(firstSeries.lowerSeedTeam.wins, 2)
  assert.equal(firstSeries.status, 'complete')
  assert.equal(firstSeries.winner.teamId, 'FLA')
  assert.equal(easternRounds[0].series.length, 4)
  assert.equal(easternRounds[0].series[1].status, 'pending')
})

test('Stanley Cup Final identifies the provider-confirmed champion', () => {
  const result = normalizeActualBracket(ACTUAL_BRACKET, HISTORICAL_SEASON)

  assert.equal(result.stanleyCupFinal.roundName, 'Stanley Cup Final')
  assert.equal(result.stanleyCupFinal.higherSeedTeam.wins, 4)
  assert.equal(result.stanleyCupFinal.lowerSeedTeam.wins, 3)
  assert.equal(result.champion.name, 'FLA Team')
  assert.equal(result.champion.isWinner, true)
})

test('active series expose live scores without inventing a winner', () => {
  const result = normalizeActualBracket(
    {
      series: [
        makeActualSeries({
          bottomWins: 2,
          topWins: 3,
          winnerId: null,
        }),
      ],
    },
    CURRENT_SEASON,
  )
  const series = result.conferences.eastern.rounds[0].series[0]

  assert.equal(series.status, 'active')
  assert.equal(series.higherSeedTeam.wins, 3)
  assert.equal(series.lowerSeedTeam.wins, 2)
  assert.equal(series.winner, null)
  assert.equal(series.winnerTeamId, null)
})

test('actual brackets retain historical display identity and canonical franchise ID', () => {
  const result = normalizeActualBracket(
    {
      series: [
        makeActualSeries({
          letter: 'E',
          topAbbreviation: 'ARI',
          topId: 53,
        }),
      ],
    },
    HISTORICAL_SEASON,
  )
  const arizona = result.conferences.western.rounds[0].series[0].higherSeedTeam

  assert.equal(arizona.abbreviation, 'ARI')
  assert.equal(arizona.name, 'ARI Team')
  assert.equal(arizona.teamId, 'UTA')
  assert.match(arizona.logo, /ARI/)
})

test('current pre-playoff response is explicitly projected from standings', async () => {
  const result = await getPlayoffs(
    {},
    createOptions(makeStandingsResponse()),
  )

  assert.equal(result.mode, 'projected')
  assert.equal(result.status, 'ready')
  assert.equal(result.champion, null)
  assert.equal(result.stanleyCupFinal.status, 'pending')
  assert.equal(result.conferences.eastern.rounds[0].series.length, 4)
})

test('projected seeding respects divisions and inverse wildcard assignment', () => {
  const result = buildProjectedBracket(PROJECTED_STANDINGS, CURRENT_SEASON)
  const easternRoundOne = result.conferences.eastern.rounds[0].series

  assert.equal(easternRoundOne[0].higherSeedTeam.teamId, 'E01')
  assert.equal(easternRoundOne[0].lowerSeedTeam.teamId, 'EW2')
  assert.equal(easternRoundOne[1].higherSeedTeam.teamId, 'E02')
  assert.equal(easternRoundOne[1].lowerSeedTeam.teamId, 'E03')
  assert.equal(easternRoundOne[2].higherSeedTeam.teamId, 'E11')
  assert.equal(easternRoundOne[2].lowerSeedTeam.teamId, 'EW1')
  assert.equal(easternRoundOne.every((series) => series.status === 'projected'), true)
  assert.equal(easternRoundOne.every((series) => series.winner === null), true)
})

test('current active playoffs prefer actual official series over projections', async () => {
  const result = await getPlayoffs(
    {},
    createOptions(makeStandingsResponse(), {
      bracketProvider: async () => ({ data: ACTUAL_BRACKET, source: 'live' }),
    }),
  )

  assert.equal(result.mode, 'actual')
  assert.equal(result.champion.teamId, 'FLA')
})

test('missing projection inputs and historical brackets use structured states', async () => {
  const projected = await getPlayoffs(
    {},
    createOptions(makeStandingsResponse({ standings: [], status: 'no_standings' })),
  )
  const historical = await getPlayoffs(
    { season: HISTORICAL_SEASON.id },
    createOptions(makeStandingsResponse({ season: HISTORICAL_SEASON })),
  )

  assert.equal(projected.status, 'projected_unavailable')
  assert.equal(projected.error.code, 'projected_unavailable')
  assert.equal(historical.status, 'unavailable')
  assert.equal(historical.error.code, 'unavailable')
})

test('provider errors are safe and do not expose raw upstream details', async () => {
  const result = await getPlayoffs(
    {},
    createOptions(makeStandingsResponse(), {
      bracketProvider: async () => {
        throw new Error('secret provider response')
      },
    }),
  )

  assert.equal(result.status, 'provider_error')
  assert.equal(result.error.code, 'provider_error')
  assert.equal(JSON.stringify(result).includes('secret provider response'), false)
})

test('current and historical playoff responses use mode-appropriate caches', async () => {
  let now = 1000
  let providerCalls = 0
  const cache = new Map()
  const currentOptions = createOptions(makeStandingsResponse(), {
    bracketProvider: async () => {
      providerCalls += 1
      return { data: ACTUAL_BRACKET, source: 'live' }
    },
    cache,
    nowProvider: () => now,
  })

  await getPlayoffs({}, currentOptions)
  await getPlayoffs({}, currentOptions)
  assert.equal(providerCalls, 1)
  assert.equal(
    cache.get(`${CURRENT_SEASON.id}:${CURRENT_SEASON.id}`).expiresAt,
    now + CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS,
  )

  now += CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS + 1
  await getPlayoffs({}, currentOptions)
  assert.equal(providerCalls, 2)

  const historicalOptions = createOptions(
    makeStandingsResponse({ season: HISTORICAL_SEASON }),
    {
      bracketProvider: currentOptions.bracketProvider,
      cache,
      nowProvider: () => now,
    },
  )
  await getPlayoffs({ season: HISTORICAL_SEASON.id }, historicalOptions)
  assert.equal(
    cache.get(`${CURRENT_SEASON.id}:${HISTORICAL_SEASON.id}`).expiresAt,
    now + HISTORICAL_PLAYOFF_CACHE_TTL_MS,
  )
})

test('projected response cache follows the current standings cadence', async () => {
  let now = 5000
  const cache = new Map()
  const options = createOptions(makeStandingsResponse(), {
    cache,
    nowProvider: () => now,
  })

  await getPlayoffs({}, options)

  assert.equal(
    cache.get(`${CURRENT_SEASON.id}:${CURRENT_SEASON.id}`).expiresAt,
    now + PROJECTED_PLAYOFF_CACHE_TTL_MS,
  )
})

test('playoff API rejects malformed postseason years before network access', async () => {
  await assert.rejects(
    () => nhlApiService.getPlayoffBracket('2025-26'),
    (error) => error.statusCode === 400,
  )
})
