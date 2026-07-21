process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const PowerRating = require('../models/PowerRating')
const authService = require('../services/authService')
const nhlApiService = require('../services/nhlApiService')
const {
  calculateTeamRatingSummary,
  previewPowerRatingSimulation,
  replayHistoricalPowerRatings,
} = require('../services/powerRatingSimulationService')
const {
  SKIP_REASONS,
  classifyGameEligibility,
} = require('../services/nhlGameEligibility')
const {
  eligibilityFixtures,
  fixtureGames,
  fixtureTeams,
  replayQualityFixtureGames,
  shuffledFixtureGames,
} = require('./fixtures/powerRatingReplayFixtures')

const assertAlmostEqual = (actual, expected, tolerance = 1e-6) => {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${actual} was not within ${tolerance} of ${expected}`,
  )
}

const queryOf = (value) => ({
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

const withPatches = async (patches, callback) => {
  const originals = patches.map(([target, property, replacement]) => {
    const original = target[property]
    target[property] = replacement

    return [target, property, original]
  })

  try {
    return await callback()
  } finally {
    originals.reverse().forEach(([target, property, original]) => {
      target[property] = original
    })
  }
}

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

const postPreview = (token, body) =>
  request('/api/power-rating-simulations/preview', {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

const makeTeamsById = () =>
  [
    'BOS',
    'CAR',
    'COL',
    'DAL',
    'EDM',
    'NJD',
    'NYR',
    'TOR',
    'VAN',
  ].reduce((teamsById, teamId) => {
    teamsById.set(teamId, {
      abbreviation: teamId,
      teamId,
      teamName: fixtureTeams[teamId] ?? teamId,
    })

    return teamsById
  }, new Map())

const makeEligibilityContext = (overrides = {}) => ({
  dateFrom: '2025-03-01',
  dateFromTimestamp: Date.UTC(2025, 2, 1),
  dateTo: '2025-03-01',
  dateToTimestamp: Date.UTC(2025, 2, 1),
  gameTypes: {
    playoffs: true,
    preseason: false,
    regularSeason: true,
  },
  teamsById: makeTeamsById(),
  ...overrides,
})

const makeRatingDocument = ({
  baseRating,
  homeAdvantage = 2.5,
  teamId,
  userId,
}) => ({
  _id: new mongoose.Types.ObjectId(),
  abbreviation: teamId,
  baseRating,
  homeAdvantage,
  lastRatingChange: 0,
  manualAdjustment: 0,
  teamId,
  teamName: fixtureTeams[teamId] ?? teamId,
  userId,
})

const makeScheduleFromFixtureGames = () => {
  const gamesByDate = new Map()

  fixtureGames.forEach((game) => {
    const date = game.startTimeUTC.slice(0, 10)
    const dateGames = gamesByDate.get(date) ?? []

    dateGames.push(game)
    gamesByDate.set(date, dateGames)
  })

  return async (date) => ({
    gameWeek: [
      {
        date,
        games: gamesByDate.get(date) ?? [],
      },
    ],
  })
}

test('regular-season NHL club game is eligible', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.regularSeason,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, true)
  assert.equal(eligibility.details.gameTypeLabel, 'regularSeason')
})

test('playoff NHL club game is eligible', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.playoff,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, true)
  assert.equal(eligibility.details.gameTypeLabel, 'playoffs')
})

test('preseason is excluded by default', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.preseason,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.UNSUPPORTED_GAME_TYPE)
})

test('preseason can be included only when explicitly enabled', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.preseason,
    makeEligibilityContext({
      gameTypes: {
        playoffs: false,
        preseason: true,
        regularSeason: false,
      },
    }),
  )

  assert.equal(eligibility.eligible, true)
})

test('national-team game is excluded as a non-NHL game', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.international,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.NON_NHL_GAME)
})

test('unknown team is excluded safely', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.unknownTeam,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.UNKNOWN_TEAM_MAPPING)
})

test('unsupported game type is excluded', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.unsupportedGameType,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.UNSUPPORTED_GAME_TYPE)
})

test('malformed game is skipped', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.malformed,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.MALFORMED_GAME)
})

test('incomplete game is skipped', () => {
  const eligibility = classifyGameEligibility(
    eligibilityFixtures.scheduled,
    makeEligibilityContext(),
  )

  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reason, SKIP_REASONS.NOT_COMPLETED)
})

test('duplicate gameId is processed once', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => [
      eligibilityFixtures.regularSeason,
      {
        ...eligibilityFixtures.regularSeason,
        startTimeUTC: '2025-03-01T00:30:00Z',
      },
      eligibilityFixtures.shootout,
    ],
    includeGameResults: true,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.summary.gamesFetched, 2)
  assert.equal(replay.summary.gamesProcessed, 2)
  assert.deepEqual(
    replay.gameResults.map((game) => game.gameId),
    [2001, 2011],
  )
})

test('games outside requested date range are excluded', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => [
      eligibilityFixtures.regularSeason,
      eligibilityFixtures.outsideDateRange,
    ],
    includeSkippedGames: true,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.summary.gamesFetched, 2)
  assert.equal(replay.summary.gamesProcessed, 1)
  assert.equal(replay.skipReasons[SKIP_REASONS.OUTSIDE_DATE_RANGE], 1)
})

test('skipReasons counts match gamesSkipped', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    includeSkippedGames: true,
    startingMode: 'equal',
    userId: 'user-1',
  })
  const skipReasonTotal = Object.values(replay.skipReasons).reduce(
    (total, value) => total + value,
    0,
  )

  assert.equal(skipReasonTotal, replay.summary.gamesSkipped)
  assert.equal(replay.summary.gamesProcessed + replay.summary.gamesSkipped, replay.summary.gamesFetched)
})

test('teamResults are always returned and sorted descending', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    startingMode: 'equal',
    userId: 'user-1',
  })
  const ratings = replay.teamResults.map((team) => team.finalRating)
  const sortedRatings = [...ratings].sort((ratingA, ratingB) => ratingB - ratingA)

  assert.equal(Array.isArray(replay.teamResults), true)
  assert.equal(replay.teamResults.length > 0, true)
  assert.deepEqual(ratings, sortedRatings)
})

test('default response omits gameResults', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.gameResultsIncluded, false)
  assert.equal(Object.hasOwn(replay, 'gameResults'), false)
})

test('includeGameResults true includes processed gameResults', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    includeGameResults: true,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.gameResultsIncluded, true)
  assert.equal(Array.isArray(replay.gameResults), true)
  assert.equal(replay.gameResults.length, replay.summary.gamesProcessed)
})

test('default response omits skippedGames', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.skippedGamesIncluded, false)
  assert.equal(Object.hasOwn(replay, 'skippedGames'), false)
})

test('includeSkippedGames true includes compact skippedGames', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    includeSkippedGames: true,
    startingMode: 'equal',
    userId: 'user-1',
  })
  const skippedGame = replay.skippedGames[0]

  assert.equal(replay.skippedGamesIncluded, true)
  assert.equal(replay.skippedGames.length, replay.summary.gamesSkipped)
  assert.equal(Object.hasOwn(skippedGame, 'gameId'), true)
  assert.equal(Object.hasOwn(skippedGame, 'reason'), true)
})

test('skippedGames do not expose full raw NHL payloads', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-03-01',
    dateTo: '2025-03-01',
    gamesProvider: async () => replayQualityFixtureGames,
    includeSkippedGames: true,
    startingMode: 'equal',
    userId: 'user-1',
  })
  const skippedGame = replay.skippedGames.find(
    (game) => game.reason === SKIP_REASONS.UNRESOLVED_RESULT_TYPE,
  )

  assert.equal(Object.hasOwn(skippedGame, 'gameOutcome'), false)
  assert.equal(Object.hasOwn(skippedGame, 'periodDescriptor'), false)
  assert.equal(Object.hasOwn(skippedGame.homeTeam, 'score'), false)
  assert.equal(Object.hasOwn(skippedGame.awayTeam, 'score'), false)
})

test('unresolved games are skipped during replay', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-01-01',
    dateTo: '2025-01-12',
    gamesProvider: async () => fixtureGames,
    includeGameResults: true,
    includeSkippedGames: true,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(replay.summary.gamesFetched, 24)
  assert.equal(replay.summary.gamesEligible, 24)
  assert.equal(replay.summary.gamesProcessed, 23)
  assert.equal(replay.summary.gamesSkipped, 1)
  assert.equal(replay.skipReasons[SKIP_REASONS.UNRESOLVED_RESULT_TYPE], 1)
  assert.equal(
    replay.skippedGames.find((game) => game.gameId === 1024).reason,
    SKIP_REASONS.UNRESOLVED_RESULT_TYPE,
  )
  assert.equal(
    replay.gameResults.some((game) => game.gameId === 1024),
    false,
  )
})

test('replay processes games chronologically even when fixtures are shuffled', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-01-01',
    dateTo: '2025-01-12',
    gamesProvider: async () => shuffledFixtureGames,
    includeGameResults: true,
    startingMode: 'equal',
    userId: 'user-1',
  })
  const gameDates = replay.gameResults.map((game) => game.gameDate)
  const sortedGameDates = [...gameDates].sort()

  assert.deepEqual(gameDates, sortedGameDates)
  assert.equal(replay.gameResults[0].gameId, 1001)
  assert.equal(replay.gameResults.at(-1).gameId, 1023)
})

test('replay is deterministic for the same fixture inputs', async () => {
  const runReplay = () =>
    replayHistoricalPowerRatings({
      dateFrom: '2025-01-01',
      dateTo: '2025-01-12',
      gamesProvider: async () => shuffledFixtureGames,
      includeGameResults: true,
      includeSkippedGames: true,
      startingMode: 'equal',
      userId: 'user-1',
    })

  const firstReplay = await runReplay()
  const secondReplay = await runReplay()

  assert.deepEqual(secondReplay, firstReplay)
})

test('equal starting mode initializes teams at 50', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    gamesProvider: async () => [],
    startingMode: 'equal',
    userId: 'user-1',
  })

  assert.equal(
    replay.teamResults.every((team) => team.startingRating === 50),
    true,
  )
  assert.equal(replay.teamResults.every((team) => team.finalRating === 50), true)
})

test('current starting mode clones user ratings without modifying them', async () => {
  const userId = 'user-1'
  const documents = [
    makeRatingDocument({
      baseRating: 55,
      teamId: 'BOS',
      userId,
    }),
    makeRatingDocument({
      baseRating: 48,
      homeAdvantage: 3,
      teamId: 'TOR',
      userId,
    }),
  ]
  const originalDocuments = JSON.parse(JSON.stringify(documents))
  let providerUserId = null

  const replay = await replayHistoricalPowerRatings({
    currentRatingsProvider: async (requestedUserId) => {
      providerUserId = requestedUserId
      return documents
    },
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    gamesProvider: async () => [],
    startingMode: 'current',
    userId,
  })
  const boston = replay.teamResults.find((team) => team.teamId === 'BOS')
  const toronto = replay.teamResults.find((team) => team.teamId === 'TOR')

  assert.equal(providerUserId, userId)
  assert.equal(boston.startingRating, 55)
  assert.equal(boston.finalRating, 55)
  assert.equal(toronto.startingRating, 48)
  assert.equal(toronto.finalRating, 48)
  assert.deepEqual(JSON.parse(JSON.stringify(documents)), originalDocuments)
})

test('invalid gameTypes values return 400', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await postPreview(token, {
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    gameTypes: {
      regularSeason: 'yes',
    },
    startingMode: 'equal',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'gameTypes.regularSeason must be a boolean.')
})

test('all game types false returns 400', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await postPreview(token, {
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    gameTypes: {
      playoffs: false,
      preseason: false,
      regularSeason: false,
    },
    startingMode: 'equal',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'At least one supported game type must be enabled.')
})

test('invalid includeGameResults returns 400', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await postPreview(token, {
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    includeGameResults: 'false',
    startingMode: 'equal',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'includeGameResults must be a boolean.')
})

test('invalid includeSkippedGames returns 400', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await postPreview(token, {
    dateFrom: '2025-01-01',
    dateTo: '2025-01-01',
    includeSkippedGames: 1,
    startingMode: 'equal',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'includeSkippedGames must be a boolean.')
})

test('summary average is approximately 50 in a zero-sum replay', async () => {
  const replay = await replayHistoricalPowerRatings({
    dateFrom: '2025-01-01',
    dateTo: '2025-01-12',
    gamesProvider: async () => fixtureGames,
    startingMode: 'equal',
    userId: 'user-1',
  })

  assertAlmostEqual(replay.summary.averageRating, 50)
})

test('median calculation is correct', () => {
  const summary = calculateTeamRatingSummary([
    { abbreviation: 'A', finalRating: 40, teamId: 'A' },
    { abbreviation: 'B', finalRating: 50, teamId: 'B' },
    { abbreviation: 'C', finalRating: 60, teamId: 'C' },
    { abbreviation: 'D', finalRating: 80, teamId: 'D' },
  ])

  assert.equal(summary.medianRating, 55)
})

test('population standard deviation calculation is correct', () => {
  const summary = calculateTeamRatingSummary([
    { abbreviation: 'A', finalRating: 40, teamId: 'A' },
    { abbreviation: 'B', finalRating: 50, teamId: 'B' },
    { abbreviation: 'C', finalRating: 60, teamId: 'C' },
  ])

  assertAlmostEqual(summary.standardDeviation, 8.164966)
})

test('highest and lowest rating values are correct', () => {
  const summary = calculateTeamRatingSummary([
    { abbreviation: 'A', finalRating: 40, teamId: 'A' },
    { abbreviation: 'B', finalRating: 50, teamId: 'B' },
    { abbreviation: 'C', finalRating: 60, teamId: 'C' },
  ])

  assert.equal(summary.highestRating, 60)
  assert.equal(summary.highestRatedTeam.abbreviation, 'C')
  assert.equal(summary.lowestRating, 40)
  assert.equal(summary.lowestRatedTeam.abbreviation, 'A')
})

test('preview endpoint rejects unauthenticated requests', async () => {
  const response = await request('/api/power-rating-simulations/preview', {
    body: JSON.stringify({
      dateFrom: '2025-01-02',
      dateTo: '2025-01-01',
      startingMode: 'equal',
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 401)
  assert.equal(response.body.message, 'Authentication required.')
})

test('preview endpoint validates input', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())
  const response = await postPreview(token, {
    dateFrom: '2025-01-02',
    dateTo: '2025-01-01',
    startingMode: 'equal',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.message, 'dateFrom must be on or before dateTo.')
})

test('preview endpoint cannot access another user rating from request body', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const token = authService.signAuthToken(userA)
  let capturedFilter = null

  await withPatches(
    [
      [
        PowerRating,
        'find',
        (filter) => {
          capturedFilter = filter
          return queryOf([])
        },
      ],
      [nhlApiService, 'getScheduleForDate', async (date) => ({
        gameWeek: [
          {
            date,
            games: [],
          },
        ],
      })],
    ],
    async () => {
      const response = await postPreview(token, {
        dateFrom: '2025-01-01',
        dateTo: '2025-01-01',
        startingMode: 'current',
        userId: userB,
      })

      assert.equal(response.status, 200)
      assert.equal(capturedFilter.userId, userA)
    },
  )
})

test('preview endpoint does not change PowerRating documents', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const token = authService.signAuthToken(userId)
  const documents = [
    makeRatingDocument({
      baseRating: 54,
      teamId: 'BOS',
      userId,
    }),
  ]
  const originalDocuments = JSON.parse(JSON.stringify(documents))

  await withPatches(
    [
      [PowerRating, 'find', () => queryOf(documents)],
      [PowerRating, 'bulkWrite', async () => {
        throw new Error('bulkWrite should not be called by preview.')
      }],
      [nhlApiService, 'getScheduleForDate', async (date) => ({
        gameWeek: [
          {
            date,
            games: [],
          },
        ],
      })],
    ],
    async () => {
      const response = await postPreview(token, {
        dateFrom: '2025-01-01',
        dateTo: '2025-01-01',
        startingMode: 'current',
      })

      assert.equal(response.status, 200)
      assert.deepEqual(JSON.parse(JSON.stringify(documents)), originalDocuments)
    },
  )
})

test('mocked external NHL API replay works correctly', async () => {
  await withPatches(
    [[nhlApiService, 'getScheduleForDate', makeScheduleFromFixtureGames()]],
    async () => {
      const replay = await previewPowerRatingSimulation('user-1', {
        dateFrom: '2025-01-01',
        dateTo: '2025-01-12',
        includeGameResults: true,
        startingMode: 'equal',
      })

      assert.equal(replay.summary.gamesFetched, 24)
      assert.equal(replay.summary.gamesProcessed, 23)
      assert.equal(replay.summary.gamesSkipped, 1)
      assert.equal(replay.gameResults[0].gameId, 1001)
    },
  )
})
