process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  FALLBACK_METADATA_SOURCE,
  FALLBACK_SEASONS,
  NHL_API_METADATA_SOURCE,
  buildFallbackSeasons,
  deriveSeasonBoundaryFromSchedules,
  getAvailablePowerRatingHistorySeasons,
  getSeasonForDate,
  normalizeSeasonId,
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
  let clubScheduleCalls = 0
  const result = await getAvailablePowerRatingHistorySeasons({
    clubScheduleSeasonProvider: async (...args) => {
      clubScheduleCalls += 1
      return clubScheduleSeasonProvider(...args)
    },
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
  assert.equal(clubScheduleCalls, 0)
  assert.equal(result.seasons[0].metadataSource, 'tested-explicit')
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
  assert.equal(
    result.warning,
    'Season dates loaded from tested fallback metadata.',
  )
})

test('season metadata failure uses documented fallback behavior', async () => {
  const result = await getAvailablePowerRatingHistorySeasons({
    currentSeasonContextProvider: async () => {
      throw new Error('NHL API unavailable')
    },
    skipCache: true,
    teamsProvider,
    todayProvider: () => '2026-11-01',
  })

  assert.equal(result.metadataSource, FALLBACK_METADATA_SOURCE)
  assert.equal(result.currentSeasonId, '20262027')
  assert.equal(result.seasons[0].id, '20262027')
  assert.equal(
    result.warning,
    'Season dates loaded from tested fallback metadata.',
  )
})

test('supported season identifiers normalize to one canonical provider format', () => {
  ;[
    ['2026–27', '20262027'],
    ['2025-26', '20252026'],
    ['20242025', '20242025'],
    ['2023—24', '20232024'],
    ['2022-23', '20222023'],
    ['2021–22', '20212022'],
  ].forEach(([input, expected]) => {
    assert.equal(normalizeSeasonId(input), expected)
  })

  assert.equal(normalizeSeasonId('2024'), '')
  assert.equal(normalizeSeasonId('20242026'), '')
})

test('supported completed seasons keep explicit inclusive final dates', () => {
  const expectedEndDates = {
    20212022: '2022-04-29',
    20222023: '2023-04-14',
    20232024: '2024-04-18',
    20242025: '2025-04-17',
    20252026: '2026-04-16',
  }

  Object.entries(expectedEndDates).forEach(([seasonId, endDate]) => {
    const season = FALLBACK_SEASONS.find((candidate) => candidate.id === seasonId)

    assert.equal(season.endDate, endDate)
  })
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
