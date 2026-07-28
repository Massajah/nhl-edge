process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  FALLBACK_METADATA_SOURCE,
  NHL_API_METADATA_SOURCE,
  buildFallbackSeasons,
  deriveSeasonBoundaryFromSchedules,
  getAvailablePowerRatingHistorySeasons,
  getSeasonForDate,
  normalizeSeasonBoundary,
} = require('../services/nhlSeasonService')

const teamsProvider = async () => [
  {
    abbreviation: 'BOS',
    teamId: 'BOS',
    teamName: 'Boston Bruins',
  },
  {
    abbreviation: 'CAR',
    teamId: 'CAR',
    teamName: 'Carolina Hurricanes',
  },
]

const scheduleBySeason = {
  20262027: {
    games: [
      {
        gameDate: '2026-09-28',
        gameType: 1,
      },
      {
        gameDate: '2026-10-01',
        gameType: 2,
      },
      {
        gameDate: '2027-04-30',
        gameType: 2,
      },
      {
        gameDate: '2027-05-02',
        gameType: 3,
      },
    ],
  },
  20252026: {
    games: [
      {
        gameDate: '2025-10-07',
        gameType: 2,
      },
      {
        gameDate: '2026-04-16',
        gameType: 2,
      },
    ],
  },
  20242025: {
    games: [
      {
        gameDate: '2024-10-04',
        gameType: 2,
      },
      {
        gameDate: '2025-04-17',
        gameType: 2,
      },
    ],
  },
}

const clubScheduleSeasonProvider = async (_teamAbbreviation, seasonId) =>
  scheduleBySeason[String(seasonId)] ?? {
    games: [
      {
        gameDate: `${String(seasonId).slice(0, 4)}-10-01`,
        gameType: 2,
      },
    ],
  }

test('available seasons from NHL schedule metadata are sorted newest first', async () => {
  const result = await getAvailablePowerRatingHistorySeasons({
    clubScheduleSeasonProvider,
    count: 3,
    currentSeasonContextProvider: async () => ({
      currentSeasonId: 20262027,
    }),
    skipCache: true,
    teamsProvider,
    todayProvider: () => '2026-11-01',
  })

  assert.equal(result.metadataSource, NHL_API_METADATA_SOURCE)
  assert.deepEqual(
    result.seasons.map((season) => season.id),
    ['20262027', '20252026', '20242025'],
  )
})

test('current offseason resolves to the upcoming NHL season deterministically', async () => {
  const result = await getAvailablePowerRatingHistorySeasons({
    clubScheduleSeasonProvider,
    count: 2,
    currentSeasonContextProvider: async () => ({
      currentSeasonId: 20252026,
    }),
    skipCache: true,
    teamsProvider,
    todayProvider: () => '2026-07-28',
  })

  assert.equal(result.currentSeasonId, '20262027')
  assert.equal(result.seasons[0].isCurrent, true)
  assert.equal(result.seasons[0].label, '2026\u201327')
})

test('season boundaries are normalized from regular-season games only', async () => {
  const season = await deriveSeasonBoundaryFromSchedules({
    clubScheduleSeasonProvider,
    seasonId: '20262027',
    teamsProvider,
  })

  assert.deepEqual(season, {
    endDate: '2027-04-30',
    id: '20262027',
    label: '2026\u201327',
    startDate: '2026-10-01',
  })
})

test('fallback season metadata is newest first and marks current season', () => {
  const result = buildFallbackSeasons({
    count: 3,
    today: '2026-07-28',
  })

  assert.equal(result.metadataSource, FALLBACK_METADATA_SOURCE)
  assert.equal(result.currentSeasonId, '20262027')
  assert.deepEqual(
    result.seasons.map((season) => season.id),
    ['20262027', '20252026', '20242025'],
  )
  assert.equal(result.seasons[0].isCurrent, true)
  assert.match(result.warning, /fallback NHL regular-season boundaries/)
})

test('season metadata failure uses documented fallback behavior', async () => {
  const result = await getAvailablePowerRatingHistorySeasons({
    clubScheduleSeasonProvider: async () => {
      throw new Error('NHL API unavailable')
    },
    currentSeasonContextProvider: async () => ({
      currentSeasonId: 20262027,
    }),
    skipCache: true,
    teamsProvider,
    todayProvider: () => '2026-11-01',
  })

  assert.equal(result.metadataSource, FALLBACK_METADATA_SOURCE)
  assert.equal(result.currentSeasonId, '20262027')
  assert.equal(result.seasons[0].id, '20262027')
  assert.match(result.warning, /fallback NHL regular-season boundaries/)
})

test('season date lookup returns the upcoming season during the offseason gap', () => {
  const seasons = [
    normalizeSeasonBoundary({
      endDate: '2026-04-16',
      id: '20252026',
      startDate: '2025-10-07',
    }),
    normalizeSeasonBoundary({
      endDate: '2027-04-30',
      id: '20262027',
      startDate: '2026-10-01',
    }),
  ]

  assert.equal(getSeasonForDate(seasons, '2026-07-28').id, '20262027')
  assert.equal(getSeasonForDate(seasons, '2026-01-10').id, '20252026')
})
