process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const authService = require('../services/authService')
const {
  RESULT_TYPES,
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
} = require('../services/powerRatingEngine')
const {
  AUTOMATIC_UPDATE_STATUSES,
  applyAutomaticPowerRatingUpdate,
  applyCompletedGamesToPowerRatings,
  normalizeAutomaticUpdateInput,
  normalizeUpdateDateRange,
} = require('../services/ratingUpdateService')
const {
  eligibilityFixtures,
  fixtureGames,
  fixtureTeams,
} = require('./fixtures/powerRatingReplayFixtures')

const USER_ID = new mongoose.Types.ObjectId().toString()
const DEFAULT_TEST_ENGINE_SETTINGS = Object.freeze({
  modelVersion: 'power-rating-v1',
  kFactor: 1.2,
  homeAdvantage: 4,
  regulationMultiplier: 1,
  overtimeMultiplier: 0.7,
  shootoutMultiplier: 0.5,
})

const assertAlmostEqual = (actual, expected, tolerance = 1e-9) => {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${actual} was not within ${tolerance} of ${expected}`,
  )
}

const queryOf = (value) => ({
  lean() {
    return this
  },
  limit() {
    return this
  },
  select() {
    return this
  },
  session() {
    return this
  },
  sort() {
    return this
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
  catch(reject) {
    return Promise.resolve(value).catch(reject)
  },
})

const sameUser = (left, right) => String(left) === String(right)

const makeRatingDocument = ({
  baseRating = 50,
  homeAdjustment = 0,
  teamId,
  userId = USER_ID,
}) => ({
  abbreviation: teamId,
  baseRating,
  homeAdvantage: homeAdjustment,
  lastRatingChange: 0,
  manualAdjustment: 0,
  teamId,
  teamName: fixtureTeams[teamId] ?? teamId,
  userId,
})

const makeProcessedGameRecord = ({
  awayScore = 2,
  awayTeam = 'TOR',
  gameDate = '2025-03-01T00:00:00.000Z',
  gameId = 2001,
  homeScore = 4,
  homeTeam = 'BOS',
  processedAt = '2025-03-01T04:00:00.000Z',
  settings = DEFAULT_TEST_ENGINE_SETTINGS,
  userId = USER_ID,
} = {}) => ({
  awayRatingAfter: 49.4,
  awayRatingBefore: 50,
  awayRatingChange: -0.6,
  awayScore,
  awayTeamAbbreviation: awayTeam,
  awayTeamId: awayTeam,
  baseHomeAdvantage: settings.homeAdvantage,
  effectiveHomeAdvantage: settings.homeAdvantage,
  engineSettingsSnapshot: {
    ...settings,
  },
  gameDate: new Date(gameDate),
  gameId,
  homeRatingAfter: 50.6,
  homeRatingBefore: 50,
  homeRatingChange: 0.6,
  homeScore,
  homeTeamAbbreviation: homeTeam,
  homeTeamAdjustment: 0,
  homeTeamId: homeTeam,
  processedAt: new Date(processedAt),
  resultType: 'REGULATION',
  userId,
})

const makeModels = ({ processedGames = [], ratings = [] }) => {
  const updateCalls = []

  return {
    powerRatingModel: {
      find(filter) {
        const requestedTeamIds = filter.teamId?.$in ?? []

        return queryOf(
          ratings.filter(
            (rating) =>
              sameUser(rating.userId, filter.userId) &&
              requestedTeamIds.includes(rating.teamId),
          ),
        )
      },
      async updateOne(filter, update) {
        updateCalls.push({ filter, update })

        const rating = ratings.find(
          (candidate) =>
            sameUser(candidate.userId, filter.userId) &&
            candidate.teamId === filter.teamId,
        )

        if (rating) {
          Object.assign(rating, update.$set)
        }

        return {
          matchedCount: rating ? 1 : 0,
          modifiedCount: rating ? 1 : 0,
        }
      },
    },
    processedGames,
    processedRatingGameModel: {
      find(filter) {
        const requestedGameIds = filter.gameId?.$in ?? []

        return queryOf(
          processedGames.filter(
            (game) =>
              sameUser(game.userId, filter.userId) &&
              (requestedGameIds.length === 0 ||
                requestedGameIds.includes(Number(game.gameId))),
          ),
        )
      },
      findOne(filter) {
        const [latestProcessedGame] = processedGames
          .filter((game) => sameUser(game.userId, filter.userId))
          .sort((gameA, gameB) => {
            const dateDifference =
              new Date(gameB.gameDate).getTime() -
              new Date(gameA.gameDate).getTime()

            if (dateDifference !== 0) {
              return dateDifference
            }

            return Number(gameB.gameId) - Number(gameA.gameId)
          })

        return queryOf(latestProcessedGame ?? null)
      },
      async create(records) {
        const normalizedRecords = Array.isArray(records) ? records : [records]

        normalizedRecords.forEach((record) => {
          const duplicate = processedGames.some(
            (game) =>
              sameUser(game.userId, record.userId) &&
              Number(game.gameId) === Number(record.gameId),
          )

          if (duplicate) {
            const error = new Error('Duplicate key')
            error.code = 11000
            throw error
          }
        })

        processedGames.push(...normalizedRecords)

        return normalizedRecords
      },
      async deleteOne(filter) {
        const index = processedGames.findIndex(
          (game) =>
            sameUser(game.userId, filter.userId) &&
            Number(game.gameId) === Number(filter.gameId),
        )

        if (index >= 0) {
          processedGames.splice(index, 1)
        }
      },
    },
    ratings,
    updateCalls,
  }
}

const cloneGame = (game, overrides = {}) => ({
  ...game,
  ...overrides,
  awayTeam: {
    ...game.awayTeam,
    ...(overrides.awayTeam ?? {}),
    score: Object.hasOwn(overrides, 'awayScore')
      ? overrides.awayScore
      : game.awayTeam?.score,
  },
  gameOutcome: Object.hasOwn(overrides, 'lastPeriodType')
    ? {
        lastPeriodType: overrides.lastPeriodType,
      }
    : game.gameOutcome,
  homeTeam: {
    ...game.homeTeam,
    ...(overrides.homeTeam ?? {}),
    score: Object.hasOwn(overrides, 'homeScore')
      ? overrides.homeScore
      : game.homeTeam?.score,
  },
})

const runUpdate = (games, models, payload = {}) =>
  applyCompletedGamesToPowerRatings(USER_ID, payload, {
    gamesProvider: async () => games,
    powerRatingModel: models.powerRatingModel,
    processedRatingGameModel: models.processedRatingGameModel,
    settingsProvider: async () => DEFAULT_TEST_ENGINE_SETTINGS,
    todayProvider: () => '2025-03-05',
    useTransactions: false,
  })

const runUpdateWithOptions = (games, models, payload = {}, options = {}) =>
  applyCompletedGamesToPowerRatings(options.userId ?? USER_ID, payload, {
    gamesProvider: async () => games,
    powerRatingModel: models.powerRatingModel,
    processedRatingGameModel: models.processedRatingGameModel,
    settingsProvider: async (userId) =>
      options.settingsByUser?.[String(userId)] ?? DEFAULT_TEST_ENGINE_SETTINGS,
    todayProvider: () => '2025-03-05',
    useTransactions: false,
  })

const runAutomaticUpdateWithOptions = (
  games,
  models,
  payload = {},
  options = {},
) =>
  applyAutomaticPowerRatingUpdate(options.userId ?? USER_ID, payload, {
    gamesProvider:
      options.gamesProvider ??
      (async (range) => {
        options.onGamesRequest?.(range)
        return games
      }),
    powerRatingModel: models.powerRatingModel,
    processedRatingGameModel: models.processedRatingGameModel,
    settingsProvider: async (userId) =>
      options.settingsByUser?.[String(userId)] ?? DEFAULT_TEST_ENGINE_SETTINGS,
    todayProvider: () => options.today ?? '2025-03-05',
    useTransactions: false,
  })

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const text = await response.text()

    return {
      body: text ? JSON.parse(text) : null,
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve)
    })
  }
}

test('live update combines base home advantage with home team adjustment', async () => {
  const ratings = [
    makeRatingDocument({ homeAdjustment: 0.5, teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate([eligibilityFixtures.regularSeason], models, {
    from: '2025-03-01',
    to: '2025-03-01',
  })
  const auditRecord = models.processedGames[0]
  const pregameProbability = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 4.5,
    homeRating: 50,
  })
  const expectedUpdate = calculateRatingUpdate({
    awayExpectedProbability: pregameProbability.awayProbability,
    homeExpectedProbability: pregameProbability.homeProbability,
    resultType: RESULT_TYPES.REGULATION,
    winner: WINNERS.HOME,
  })

  assert.deepEqual(Object.keys(result).sort(), [
    'dateRange',
    'errors',
    'gamesAlreadyProcessed',
    'gamesFound',
    'gamesProcessed',
    'gamesSkipped',
    'processedGames',
    'success',
  ])
  assert.equal(result.gamesProcessed, 1)
  assert.equal(result.success, true)
  assert.deepEqual(result.dateRange, {
    from: '2025-03-01',
    to: '2025-03-01',
  })
  assert.equal(auditRecord.engineSettingsSnapshot.homeAdvantage, 4)
  assert.equal(auditRecord.baseHomeAdvantage, 4)
  assert.equal(auditRecord.homeTeamAdjustment, 0.5)
  assert.equal(auditRecord.effectiveHomeAdvantage, 4.5)
  assert.equal(result.processedGames[0].baseHomeAdvantage, 4)
  assert.equal(result.processedGames[0].homeTeamAdjustment, 0.5)
  assert.equal(result.processedGames[0].effectiveHomeAdvantage, 4.5)
  assert.equal(result.processedGames[0].gameDate, '2025-03-01')
  assert.equal(result.processedGames[0].awayScore, 2)
  assert.equal(result.processedGames[0].homeScore, 4)
  assert.equal(auditRecord.resultType, 'REGULATION')
  assert.equal(pregameProbability.homeProbability > 0.5, true)
  assert.equal(auditRecord.homeRatingChange < 0.6, true)
  assertAlmostEqual(auditRecord.homeRatingChange, expectedUpdate.homeDelta)
})

test('different home teams can use different home adjustments', async () => {
  const ratings = [
    makeRatingDocument({ homeAdjustment: 0.5, teamId: 'BOS' }),
    makeRatingDocument({ homeAdjustment: -1.2, teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate(
    [eligibilityFixtures.regularSeason, fixtureGames[4]],
    models,
    {
      from: '2025-01-01',
      to: '2025-03-01',
    },
  )

  assert.equal(result.gamesProcessed, 2)
  assert.deepEqual(
    models.processedGames.map((game) => game.homeTeamId),
    ['TOR', 'BOS'],
  )
  assert.deepEqual(
    models.processedGames.map((game) => game.homeTeamAdjustment),
    [-1.2, 0.5],
  )
  assert.deepEqual(
    models.processedGames.map((game) => game.effectiveHomeAdvantage),
    [2.8, 4.5],
  )
})

test('underdog road win receives a larger positive adjustment', async () => {
  const underdogWin = cloneGame(eligibilityFixtures.regularSeason, {
    awayScore: 4,
    homeScore: 2,
    id: 3001,
  })
  const ratings = [
    makeRatingDocument({ baseRating: 56, teamId: 'BOS' }),
    makeRatingDocument({ baseRating: 50, teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate([underdogWin], models, {
    from: '2025-03-01',
    to: '2025-03-01',
  })
  const auditRecord = models.processedGames[0]

  assert.equal(result.gamesProcessed, 1)
  assert.equal(auditRecord.awayTeamAbbreviation, 'TOR')
  assert.equal(auditRecord.awayRatingChange > 0.6, true)
  assert.equal(auditRecord.homeRatingChange < 0, true)
})

test('completed games are applied chronologically and sequentially', async () => {
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate([fixtureGames[4], fixtureGames[0]], models, {
    from: '2025-01-01',
    to: '2025-01-03',
  })

  assert.equal(result.gamesProcessed, 2)
  assert.deepEqual(
    models.processedGames.map((game) => game.gameId),
    [1001, 1005],
  )
  assertAlmostEqual(
    models.processedGames[1].awayRatingBefore,
    models.processedGames[0].homeRatingAfter,
  )
})

test('already processed games are not applied again', async () => {
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [
      {
        gameId: eligibilityFixtures.regularSeason.id,
        userId: USER_ID,
      },
    ],
    ratings,
  })
  const result = await runUpdate([eligibilityFixtures.regularSeason], models, {
    from: '2025-03-01',
    to: '2025-03-01',
  })

  assert.equal(result.gamesFound, 1)
  assert.equal(result.gamesAlreadyProcessed, 1)
  assert.equal(result.gamesProcessed, 0)
  assert.equal(models.updateCalls.length, 0)
  assert.equal(models.processedGames.length, 1)
})

test('missing persisted team rating causes a clear skip', async () => {
  const ratings = [makeRatingDocument({ teamId: 'BOS' })]
  const models = makeModels({ ratings })
  const result = await runUpdate([eligibilityFixtures.regularSeason], models, {
    from: '2025-03-01',
    to: '2025-03-01',
  })

  assert.equal(result.gamesProcessed, 0)
  assert.equal(result.gamesSkipped, 1)
  assert.match(result.errors[0].reason, /Missing Power Rating/)
  assert.match(result.errors[0].reason, /TOR/)
  assert.equal(models.processedGames.length, 0)
})

test('live update response reports mixed processed and skipped games', async () => {
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate(
    [eligibilityFixtures.regularSeason, fixtureGames[1]],
    models,
    {
      from: '2025-01-01',
      to: '2025-03-01',
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.gamesFound, 2)
  assert.equal(result.gamesProcessed, 1)
  assert.equal(result.gamesSkipped, 1)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].reason, /Missing Power Rating/)
  assert.equal(result.processedGames.length, 1)
  assert.equal(result.processedGames[0].gameDate, '2025-03-01')
})

test('invalid update date range is rejected', () => {
  assert.throws(
    () =>
      normalizeUpdateDateRange(
        {
          from: '2025-03-02',
          to: '2025-03-01',
        },
        {
          todayProvider: () => '2025-03-05',
        },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'from must be on or before to.',
  )
})

test('only completed regular-season games are eligible for live updates', async () => {
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const result = await runUpdate(
    [
      eligibilityFixtures.playoff,
      eligibilityFixtures.preseason,
      eligibilityFixtures.scheduled,
      eligibilityFixtures.regularSeason,
    ],
    models,
    {
      from: '2025-03-01',
      to: '2025-03-01',
    },
  )

  assert.equal(result.gamesFound, 1)
  assert.equal(result.gamesProcessed, 1)
  assert.equal(result.gamesSkipped, 0)
  assert.equal(models.processedGames[0].gameId, eligibilityFixtures.regularSeason.id)
})

test('live rating update uses the requesting user persisted settings', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const ratings = [
    makeRatingDocument({ teamId: 'BOS', userId: userA }),
    makeRatingDocument({ teamId: 'TOR', userId: userA }),
    makeRatingDocument({ teamId: 'BOS', userId: userB }),
    makeRatingDocument({ teamId: 'TOR', userId: userB }),
  ]
  const models = makeModels({ ratings })
  const settingsByUser = {
    [userA]: {
      ...DEFAULT_TEST_ENGINE_SETTINGS,
      homeAdvantage: 2,
      kFactor: 1,
    },
    [userB]: {
      ...DEFAULT_TEST_ENGINE_SETTINGS,
      homeAdvantage: 8,
      kFactor: 2,
    },
  }

  await runUpdateWithOptions(
    [eligibilityFixtures.regularSeason],
    models,
    {
      from: '2025-03-01',
      to: '2025-03-01',
    },
    {
      settingsByUser,
      userId: userA,
    },
  )
  await runUpdateWithOptions(
    [cloneGame(eligibilityFixtures.regularSeason, { id: 3002 })],
    models,
    {
      from: '2025-03-01',
      to: '2025-03-01',
    },
    {
      settingsByUser,
      userId: userB,
    },
  )

  const [userAProcessedGame, userBProcessedGame] = models.processedGames

  assert.equal(userAProcessedGame.engineSettingsSnapshot.homeAdvantage, 2)
  assert.equal(userAProcessedGame.engineSettingsSnapshot.kFactor, 1)
  assert.equal(userBProcessedGame.engineSettingsSnapshot.homeAdvantage, 8)
  assert.equal(userBProcessedGame.engineSettingsSnapshot.kFactor, 2)
  assert.notEqual(
    userAProcessedGame.homeRatingChange,
    userBProcessedGame.homeRatingChange,
  )
})

test('changing settings does not alter already processed games', async () => {
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({ ratings })
  const firstSettings = {
    ...DEFAULT_TEST_ENGINE_SETTINGS,
    kFactor: 1,
  }
  const secondSettings = {
    ...DEFAULT_TEST_ENGINE_SETTINGS,
    kFactor: 2,
  }

  await runUpdateWithOptions(
    [eligibilityFixtures.regularSeason],
    models,
    {
      from: '2025-03-01',
      to: '2025-03-01',
    },
    {
      settingsByUser: {
        [USER_ID]: firstSettings,
      },
    },
  )

  const firstSnapshot = {
    ...models.processedGames[0].engineSettingsSnapshot,
  }

  await runUpdateWithOptions(
    [cloneGame(eligibilityFixtures.regularSeason, { id: 3003 })],
    models,
    {
      from: '2025-03-01',
      to: '2025-03-01',
    },
    {
      settingsByUser: {
        [USER_ID]: secondSettings,
      },
    },
  )

  assert.equal(models.processedGames.length, 2)
  assert.deepEqual(
    models.processedGames[0].engineSettingsSnapshot,
    firstSnapshot,
  )
  assert.equal(models.processedGames[1].engineSettingsSnapshot.kFactor, 2)
})

test('automatic update requires initialization when no processed baseline exists', async () => {
  let gamesRequested = false
  const models = makeModels({
    ratings: [
      makeRatingDocument({ teamId: 'BOS' }),
      makeRatingDocument({ teamId: 'TOR' }),
    ],
  })
  const result = await runAutomaticUpdateWithOptions([], models, {}, {
    gamesProvider: async () => {
      gamesRequested = true
      return []
    },
  })

  assert.equal(
    result.status,
    AUTOMATIC_UPDATE_STATUSES.REQUIRES_INITIALIZATION,
  )
  assert.equal(result.success, false)
  assert.equal(result.gamesProcessed, 0)
  assert.equal(result.dateRange, null)
  assert.equal(gamesRequested, false)
  assert.match(result.message, /initial processing point/)
})

test('automatic update input validates throughDate safely', () => {
  assert.throws(
    () =>
      normalizeAutomaticUpdateInput(
        {
          throughDate: '2025-03-06',
        },
        {
          todayProvider: () => '2025-03-05',
        },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'throughDate cannot be after today.',
  )
})

test('automatic update uses latest processed game date with a safe overlap', async () => {
  let requestedRange = null
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-03-01T00:00:00.000Z',
    gameId: eligibilityFixtures.regularSeason.id,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3004,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions(
    [eligibilityFixtures.regularSeason, newGame],
    models,
    {
      throughDate: '2025-03-03',
    },
    {
      onGamesRequest: (range) => {
        requestedRange = range
      },
    },
  )

  assert.equal(requestedRange.dateFrom, '2025-02-28')
  assert.equal(requestedRange.dateTo, '2025-03-03')
  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UPDATED)
  assert.deepEqual(result.dateRange, {
    from: '2025-02-28',
    to: '2025-03-03',
  })
  assert.equal(result.gamesFound, 2)
  assert.equal(result.gamesAlreadyProcessed, 1)
  assert.equal(result.gamesProcessed, 1)
  assert.equal(models.processedGames.length, 2)
  assert.equal(models.processedGames[1].gameId, 3004)
})

test('automatic update returns up_to_date when overlap finds no new games', async () => {
  const existingGame = makeProcessedGameRecord()
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions(
    [eligibilityFixtures.regularSeason],
    models,
  )

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UP_TO_DATE)
  assert.equal(result.gamesProcessed, 0)
  assert.equal(result.gamesAlreadyProcessed, 1)
  assert.equal(result.latestProcessedGame.gameId, existingGame.gameId)
  assert.equal(result.ratingSettingsUsed.kFactor, DEFAULT_TEST_ENGINE_SETTINGS.kFactor)
  assert.equal(models.updateCalls.length, 0)
})

test('automatic update ignores live, scheduled, and unsupported games', async () => {
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-02-28T00:00:00.000Z',
    gameId: 2999,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3005,
    startTimeUTC: '2025-03-01T00:00:00.000Z',
  })
  const liveGame = cloneGame(eligibilityFixtures.regularSeason, {
    gameState: 'LIVE',
    id: 3006,
    startTimeUTC: '2025-03-01T01:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions(
    [
      eligibilityFixtures.playoff,
      eligibilityFixtures.scheduled,
      eligibilityFixtures.unsupportedGameType,
      liveGame,
      newGame,
    ],
    models,
  )

  assert.equal(result.gamesFound, 1)
  assert.equal(result.gamesProcessed, 1)
  assert.equal(result.gamesSkipped, 0)
  assert.equal(models.processedGames.at(-1).gameId, 3005)
})

test('automatic update uses latest settings without rewriting old snapshots', async () => {
  const oldSettings = {
    ...DEFAULT_TEST_ENGINE_SETTINGS,
    kFactor: 1,
  }
  const newSettings = {
    ...DEFAULT_TEST_ENGINE_SETTINGS,
    kFactor: 2,
  }
  const existingGame = makeProcessedGameRecord({
    gameId: 3000,
    settings: oldSettings,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3007,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions([newGame], models, {}, {
    settingsByUser: {
      [USER_ID]: newSettings,
    },
  })

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UPDATED)
  assert.equal(models.processedGames[0].engineSettingsSnapshot.kFactor, 1)
  assert.equal(models.processedGames[1].engineSettingsSnapshot.kFactor, 2)
  assert.equal(result.ratingSettingsUsed.kFactor, 2)
})

test('automatic update does not recalculate ratings when settings change but no new games exist', async () => {
  const oldSettings = {
    ...DEFAULT_TEST_ENGINE_SETTINGS,
    kFactor: 1,
  }
  const existingGame = makeProcessedGameRecord({
    settings: oldSettings,
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions(
    [eligibilityFixtures.regularSeason],
    models,
    {},
    {
      settingsByUser: {
        [USER_ID]: {
          ...DEFAULT_TEST_ENGINE_SETTINGS,
          kFactor: 3,
        },
      },
    },
  )

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UP_TO_DATE)
  assert.equal(models.updateCalls.length, 0)
  assert.equal(models.processedGames.length, 1)
  assert.equal(models.processedGames[0].engineSettingsSnapshot.kFactor, 1)
})

test('repeated automatic updates process the same game only once', async () => {
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-03-01T00:00:00.000Z',
    gameId: 3001,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3008,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })

  const firstResult = await runAutomaticUpdateWithOptions([newGame], models)
  const secondResult = await runAutomaticUpdateWithOptions([newGame], models)

  assert.equal(firstResult.status, AUTOMATIC_UPDATE_STATUSES.UPDATED)
  assert.equal(secondResult.status, AUTOMATIC_UPDATE_STATUSES.UP_TO_DATE)
  assert.equal(
    models.processedGames.filter((game) => game.gameId === 3008).length,
    1,
  )
  assert.equal(models.updateCalls.length, 2)
})

test('concurrent automatic updates for one user share the same in-flight run', async () => {
  let gamesProviderCalls = 0
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-03-01T00:00:00.000Z',
    gameId: 3002,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3009,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const gamesProvider = async () => {
    gamesProviderCalls += 1
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    return [newGame]
  }

  const [firstResult, secondResult] = await Promise.all([
    runAutomaticUpdateWithOptions([], models, {}, { gamesProvider }),
    runAutomaticUpdateWithOptions([], models, {}, { gamesProvider }),
  ])

  assert.equal(gamesProviderCalls, 1)
  assert.equal(firstResult, secondResult)
  assert.equal(firstResult.gamesProcessed, 1)
  assert.equal(models.updateCalls.length, 2)
})

test('automatic update locks do not block different users', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  let gamesProviderCalls = 0
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3010,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS', userId: userA }),
    makeRatingDocument({ teamId: 'TOR', userId: userA }),
    makeRatingDocument({ teamId: 'BOS', userId: userB }),
    makeRatingDocument({ teamId: 'TOR', userId: userB }),
  ]
  const models = makeModels({
    processedGames: [
      makeProcessedGameRecord({ gameId: 3003, userId: userA }),
      makeProcessedGameRecord({ gameId: 3004, userId: userB }),
    ],
    ratings,
  })
  const gamesProvider = async () => {
    gamesProviderCalls += 1
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    return [newGame]
  }
  const [userAResult, userBResult] = await Promise.all([
    runAutomaticUpdateWithOptions([], models, {}, { gamesProvider, userId: userA }),
    runAutomaticUpdateWithOptions([], models, {}, { gamesProvider, userId: userB }),
  ])

  assert.equal(gamesProviderCalls, 2)
  assert.equal(userAResult.gamesProcessed, 1)
  assert.equal(userBResult.gamesProcessed, 1)
  assert.equal(
    models.processedGames.filter((game) => game.gameId === 3010).length,
    2,
  )
})

test('automatic update handles duplicate-key races without rating movement', async () => {
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-03-01T00:00:00.000Z',
    gameId: 3005,
  })
  const newGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3011,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })

  models.processedRatingGameModel.create = async () => {
    const error = new Error('Duplicate key')
    error.code = 11000
    throw error
  }

  const result = await runAutomaticUpdateWithOptions([newGame], models)

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UP_TO_DATE)
  assert.equal(result.gamesAlreadyProcessed, 1)
  assert.equal(result.gamesProcessed, 0)
  assert.equal(models.updateCalls.length, 0)
  assert.equal(models.processedGames.length, 1)
})

test('automatic update reports partial when a later eligible game is skipped', async () => {
  const existingGame = makeProcessedGameRecord({
    gameDate: '2025-03-01T00:00:00.000Z',
    gameId: 3006,
  })
  const processedGame = cloneGame(eligibilityFixtures.regularSeason, {
    id: 3012,
    startTimeUTC: '2025-03-02T00:00:00.000Z',
  })
  const skippedGame = cloneGame(fixtureGames[1], {
    id: 3013,
    startTimeUTC: '2025-03-02T03:00:00.000Z',
  })
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions(
    [processedGame, skippedGame],
    models,
  )

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.PARTIAL)
  assert.equal(result.success, false)
  assert.equal(result.gamesProcessed, 1)
  assert.equal(result.gamesSkipped, 1)
  assert.match(result.errors[0].reason, /Missing Power Rating/)
})

test('automatic update returns unavailable when schedule retrieval fails', async () => {
  const existingGame = makeProcessedGameRecord()
  const ratings = [
    makeRatingDocument({ teamId: 'BOS' }),
    makeRatingDocument({ teamId: 'TOR' }),
  ]
  const models = makeModels({
    processedGames: [existingGame],
    ratings,
  })
  const result = await runAutomaticUpdateWithOptions([], models, {}, {
    gamesProvider: async () => {
      throw new Error('Schedule service unavailable.')
    },
  })

  assert.equal(result.status, AUTOMATIC_UPDATE_STATUSES.UNAVAILABLE)
  assert.equal(result.success, false)
  assert.equal(result.gamesProcessed, 0)
  assert.equal(models.updateCalls.length, 0)
  assert.equal(models.processedGames.length, 1)
  assert.match(result.errors[0].reason, /Schedule service unavailable/)
})

test('update endpoint rejects unauthenticated requests', async () => {
  const response = await request('/api/power-ratings/update', {
    body: JSON.stringify({}),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 401)
  assert.equal(response.body.message, 'Authentication required.')
})

test('update endpoint validates invalid date ranges', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await request('/api/power-ratings/update', {
    body: JSON.stringify({
      from: '2025-03-02',
      to: '2025-03-01',
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'from must be on or before to.')
})

test('automatic update endpoint rejects unauthenticated requests', async () => {
  const response = await request('/api/power-ratings/auto-update', {
    body: JSON.stringify({}),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 401)
  assert.equal(response.body.message, 'Authentication required.')
})
