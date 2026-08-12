process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const HistoricalNhlGame = require('../models/HistoricalNhlGame')
const HistoricalSeasonDataset = require('../models/HistoricalSeasonDataset')
const { NhlApiError } = require('../services/nhlApiService')
const {
  MINIMUM_PLAUSIBLE_GAMES,
  RATE_LIMIT_MESSAGE,
  buildImportWindows,
  ensureHistoricalSeason,
  ensureHistoricalSeasons,
  getHistoricalSeasonStatuses,
  loadPreparedSeasons,
  normalizeHistoricalGames,
  prepareHistoricalSeason,
  validateStoredSeasonDataset,
} = require('../services/historicalNhlDataService')

const teams = [
  { abbreviation: 'BOS', teamId: 'BOS', teamName: 'Boston Bruins' },
  { abbreviation: 'TOR', teamId: 'TOR', teamName: 'Toronto Maple Leafs' },
]

const shortSeason = {
  expectedApproximateGames: 2,
  id: '20242025',
  label: 'Test season',
  regularSeasonEnd: '2024-10-14',
  regularSeasonStart: '2024-10-01',
}

const makeApiGame = ({
  date,
  gameId,
  resultType = 'REG',
  startTimeUTC = `${date}T23:00:00.000Z`,
}) => ({
  __replayScheduleDate: date,
  awayTeam: { abbrev: 'TOR', score: 2 },
  gameId,
  gameOutcome: { lastPeriodType: resultType },
  gameState: 'OFF',
  gameType: 2,
  homeTeam: { abbrev: 'BOS', score: 3 },
  season: 20242025,
  startTimeUTC,
})

const makeStoredGame = ({
  date,
  gameId,
  resultType = 'regulation',
  seasonId = '20242025',
}) => ({
  awayScore: 2,
  awayTeamAbbreviation: 'TOR',
  awayTeamId: 'TOR',
  gameDate: date,
  gameId: String(gameId),
  gameState: 'OFF',
  gameType: 2,
  homeScore: 3,
  homeTeamAbbreviation: 'BOS',
  homeTeamId: 'BOS',
  importedAt: new Date('2026-08-07T00:00:00.000Z'),
  resultType,
  seasonId,
  source: 'NHL API',
  sourceUpdatedAt: new Date('2026-08-07T00:00:00.000Z'),
  startTimeUTC: new Date(`${date}T23:00:00.000Z`),
})

class MemoryRepository {
  constructor({ datasets = [], games = [] } = {}) {
    this.datasets = new Map(datasets.map((dataset) => [dataset.seasonId, dataset]))
    this.games = new Map(games.map((game) => [String(game.gameId), game]))
    this.calls = {
      getDatasets: 0,
      getGamesBySeasons: 0,
      upsertGames: 0,
    }
  }

  async getDataset(seasonId) {
    return this.datasets.get(seasonId) ?? null
  }

  async getDatasets(seasonIds) {
    this.calls.getDatasets += 1
    return seasonIds
      .map((seasonId) => this.datasets.get(seasonId))
      .filter(Boolean)
  }

  async getGamesBySeason(seasonId) {
    return [...this.games.values()].filter((game) => game.seasonId === seasonId)
  }

  async getGamesBySeasons(seasonIds) {
    this.calls.getGamesBySeasons += 1
    return [...this.games.values()].filter((game) =>
      seasonIds.includes(game.seasonId),
    )
  }

  async upsertDataset(seasonId, values) {
    const dataset = {
      ...(this.datasets.get(seasonId) ?? { seasonId }),
      ...values,
    }
    this.datasets.set(seasonId, dataset)
    return dataset
  }

  async upsertGames(games) {
    this.calls.upsertGames += 1
    games.forEach((game) => this.games.set(String(game.gameId), game))
    return { upsertedCount: games.length }
  }
}

test('historical game storage is shared, uniquely keyed and indexed by season date', async () => {
  const gamePaths = HistoricalNhlGame.schema.paths
  const gameIndexes = HistoricalNhlGame.schema.indexes()
  const datasetIndexes = HistoricalSeasonDataset.schema.indexes()

  assert.equal(gamePaths.userId, undefined)
  assert.equal(HistoricalSeasonDataset.schema.paths.userId, undefined)
  assert.equal(gamePaths.gameId.options.unique, true)
  assert.equal(HistoricalSeasonDataset.schema.paths.seasonId.options.unique, true)
  assert.equal(
    gameIndexes.some(([fields]) => fields.seasonId === 1 && fields.gameDate === 1),
    true,
  )
  assert.equal(
    datasetIndexes.some(([, options]) => options.unique === true),
    true,
  )

  const invalidGame = new HistoricalNhlGame({
    ...makeStoredGame({ date: '2024-10-01', gameId: 'invalid-score' }),
    homeScore: 2.5,
  })
  await assert.rejects(invalidGame.validate(), (error) => {
    assert.ok(error.errors.homeScore)
    return true
  })
})

test('normalization persists only completed regular-season games and preserves result type', () => {
  const result = normalizeHistoricalGames({
    games: [
      makeApiGame({ date: '2024-10-01', gameId: 1, resultType: 'REG' }),
      makeApiGame({ date: '2024-10-02', gameId: 2, resultType: 'OT' }),
      makeApiGame({ date: '2024-10-03', gameId: 3, resultType: 'SO' }),
      { ...makeApiGame({ date: '2024-10-04', gameId: 4 }), gameState: 'FUT' },
      { ...makeApiGame({ date: '2024-10-05', gameId: 5 }), gameType: 3 },
    ],
    now: new Date('2026-08-07T00:00:00.000Z'),
    season: shortSeason,
    sourceFetchedAt: '2026-08-06T00:00:00.000Z',
    teamsById: new Map(teams.map((team) => [team.abbreviation, team])),
  })

  assert.deepEqual(
    result.records.map((game) => game.resultType),
    ['regulation', 'overtime', 'shootout'],
  )
  assert.equal(result.skipReasons.NOT_COMPLETED, 1)
  assert.equal(result.skipReasons.UNSUPPORTED_GAME_TYPE, 1)
  assert.equal(result.records.every((game) => game.gameType === 2), true)
})

test('a 429 pauses immediately, checkpoints progress and resumes at the missing window', async () => {
  const repository = new MemoryRepository()
  const requestedWindows = []
  let rateLimited = true
  const windowProvider = async (window) => {
    requestedWindows.push(`${window.dateFrom}:${window.dateTo}`)

    if (window.dateFrom === '2024-10-08' && rateLimited) {
      throw new NhlApiError('raw upstream failure', {
        statusCode: 429,
        upstreamStatus: 429,
      })
    }

    return {
      fetchedAt: '2026-08-07T00:00:00.000Z',
      games: [
        makeApiGame({
          date: window.dateFrom === '2024-10-01' ? '2024-10-01' : '2024-10-14',
          gameId: window.dateFrom,
        }),
      ],
    }
  }
  const options = {
    minimumPlausibleGames: 2,
    repository,
    season: shortSeason,
    teamsProvider: async () => teams,
    windowProvider,
  }
  const paused = await ensureHistoricalSeason(shortSeason.id, options)

  assert.equal(paused.status, 'partial')
  assert.equal(paused.message, RATE_LIMIT_MESSAGE)
  assert.equal(paused.dataset.lastErrorCode, 'rate_limited')
  assert.equal(paused.dataset.completedWindows, 1)
  assert.equal(repository.games.size, 1)
  assert.deepEqual(requestedWindows, [
    '2024-10-01:2024-10-07',
    '2024-10-08:2024-10-14',
  ])

  rateLimited = false
  const resumed = await ensureHistoricalSeason(shortSeason.id, options)

  assert.equal(resumed.status, 'ready')
  assert.equal(resumed.dataset.completedWindows, 2)
  assert.equal(resumed.dataset.completedGames, 2)
  assert.equal(resumed.dataset.firstGameDate, '2024-10-01')
  assert.equal(resumed.dataset.lastGameDate, '2024-10-14')
  assert.deepEqual(requestedWindows, [
    '2024-10-01:2024-10-07',
    '2024-10-08:2024-10-14',
    '2024-10-08:2024-10-14',
  ])
})

test('ready seasons are DB-only and concurrent ensures share one import', async () => {
  const readyGame = makeStoredGame({ date: '2024-10-01', gameId: 'ready' })
  const readyRepository = new MemoryRepository({
    datasets: [
      {
        completedGames: 1,
        completedWindows: [],
        expectedApproximateGames: 1312,
        importedGames: 1,
        seasonId: shortSeason.id,
        status: 'ready',
      },
    ],
    games: [readyGame],
  })
  let providerCalls = 0
  const ready = await ensureHistoricalSeason(shortSeason.id, {
    repository: readyRepository,
    season: shortSeason,
    windowProvider: async () => {
      providerCalls += 1
      return { games: [] }
    },
  })

  assert.equal(ready.status, 'ready')
  assert.equal(ready.games.length, 1)
  assert.equal(providerCalls, 0)

  const singleWindowSeason = {
    ...shortSeason,
    id: '20232024',
    regularSeasonEnd: '2024-10-01',
  }
  const importRepository = new MemoryRepository()
  const importProvider = async () => {
    providerCalls += 1
    return {
      games: [
        {
          ...makeApiGame({ date: '2024-10-01', gameId: 'shared-import' }),
          season: 20232024,
        },
      ],
    }
  }
  const sharedOptions = {
    minimumPlausibleGames: 1,
    repository: importRepository,
    season: singleWindowSeason,
    teamsProvider: async () => teams,
    windowProvider: importProvider,
  }
  const [first, second] = await Promise.all([
    ensureHistoricalSeason(singleWindowSeason.id, sharedOptions),
    ensureHistoricalSeason(singleWindowSeason.id, sharedOptions),
  ])

  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.equal(providerCalls, 1)
})

test('a rate limit pauses the remaining multi-season import queue', async () => {
  const secondSeason = {
    ...shortSeason,
    id: '20232024',
  }
  const repository = new MemoryRepository()
  const requestedSeasonIds = []
  const results = await ensureHistoricalSeasons([shortSeason, secondSeason], {
    minimumPlausibleGames: 1,
    repository,
    teamsProvider: async () => teams,
    windowProvider: async (_window, { seasonId }) => {
      requestedSeasonIds.push(seasonId)
      throw new NhlApiError('provider throttled', {
        statusCode: 429,
        upstreamStatus: 429,
      })
    },
  })

  assert.deepEqual(requestedSeasonIds, [shortSeason.id])
  assert.equal(
    results.get(shortSeason.id).dataset.lastErrorCode,
    'rate_limited',
  )
  assert.equal(results.get(secondSeason.id).status, 'not_imported')
  assert.equal(results.get(secondSeason.id).message, RATE_LIMIT_MESSAGE)
})

test('explicit refresh rechecks a ready old season while stale importing state is resumable', async () => {
  const repository = new MemoryRepository({
    datasets: [
      {
        completedGames: 1,
        completedWindows: [],
        expectedApproximateGames: 2,
        importedGames: 1,
        seasonId: shortSeason.id,
        status: 'ready',
      },
    ],
    games: [makeStoredGame({ date: '2024-10-01', gameId: 'old-ready-game' })],
  })
  let providerCalls = 0
  const refreshed = await prepareHistoricalSeason(
    shortSeason.id,
    { refresh: true },
    {
      minimumPlausibleGames: 2,
      repository,
      season: shortSeason,
      teamsProvider: async () => teams,
      windowProvider: async (window) => {
        providerCalls += 1
        return {
          games: [
            makeApiGame({
              date:
                window.dateFrom === shortSeason.regularSeasonStart
                  ? shortSeason.regularSeasonStart
                  : shortSeason.regularSeasonEnd,
              gameId: `refresh-${window.dateFrom}`,
            }),
          ],
        }
      },
    },
  )

  assert.equal(providerCalls, 2)
  assert.equal(refreshed.status, 'ready')

  repository.datasets.set(shortSeason.id, {
    ...repository.datasets.get(shortSeason.id),
    completedAt: null,
    importedGames: 3,
    status: 'importing',
  })
  const [resumableStatus] = await getHistoricalSeasonStatuses([shortSeason], {
    repository,
  })
  assert.equal(resumableStatus.status, 'partial')
})

test('modern season completeness requires boundaries, all windows and at least 1250 games', () => {
  const season = {
    ...shortSeason,
    expectedApproximateGames: 1312,
  }
  const windows = buildImportWindows(
    season.regularSeasonStart,
    season.regularSeasonEnd,
  )
  const completedWindows = windows.map((window) => ({ ...window }))
  const games = Array.from({ length: MINIMUM_PLAUSIBLE_GAMES - 1 }, (_, index) =>
    makeStoredGame({
      date:
        index === 0
          ? season.regularSeasonStart
          : index === MINIMUM_PLAUSIBLE_GAMES - 2
            ? season.regularSeasonEnd
            : '2024-10-07',
      gameId: index,
    }),
  )
  const partial = validateStoredSeasonDataset({
    completedWindows,
    games,
    season,
    windows,
  })
  const ready = validateStoredSeasonDataset({
    completedWindows,
    games: [
      ...games,
      makeStoredGame({ date: '2024-10-07', gameId: games.length }),
    ],
    season,
    windows,
  })

  assert.equal(partial.ready, false)
  assert.equal(partial.lastErrorCode, 'insufficient_games')
  assert.equal(ready.ready, true)
})

test('prepared multi-season loads use two bulk reads and sort games in memory', async () => {
  const secondSeason = { ...shortSeason, id: '20232024' }
  const repository = new MemoryRepository({
    datasets: [
      { seasonId: shortSeason.id, status: 'ready' },
      { seasonId: secondSeason.id, status: 'ready' },
    ],
    games: [
      makeStoredGame({ date: '2024-10-03', gameId: 'later' }),
      makeStoredGame({ date: '2024-10-01', gameId: 'earlier' }),
      makeStoredGame({
        date: '2024-10-02',
        gameId: 'other-season',
        seasonId: secondSeason.id,
      }),
    ],
  })
  const loaded = await loadPreparedSeasons(
    [shortSeason.id, secondSeason.id],
    { repository },
  )

  assert.equal(repository.calls.getDatasets, 1)
  assert.equal(repository.calls.getGamesBySeasons, 1)
  assert.deepEqual(
    loaded.gamesBySeason.get(shortSeason.id).map((game) => game.gameId),
    ['earlier', 'later'],
  )

  const ensured = await ensureHistoricalSeasons([shortSeason, secondSeason], {
    repository,
  })
  assert.equal(ensured.get(shortSeason.id).status, 'ready')
  assert.equal(ensured.get(secondSeason.id).status, 'ready')
})

test('prepare endpoint input rejects identity fields and supports explicit refresh', async () => {
  await assert.rejects(
    prepareHistoricalSeason(shortSeason.id, { userId: 'another-user' }, {
      repository: new MemoryRepository(),
      season: shortSeason,
    }),
    /unsupported fields/,
  )
})
