process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const Bet = require('../models/Bet')
const GameContext = require('../models/GameContext')
const GoalieAdjustment = require('../models/GoalieAdjustment')
const HistoricalNhlGame = require('../models/HistoricalNhlGame')
const HistoricalSeasonDataset = require('../models/HistoricalSeasonDataset')
const Injury = require('../models/Injury')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const authService = require('../services/authService')
const calibrationService = require('../services/baseModelCalibrationService')
const { extractScheduleGamesForDateRange } = require('../services/nhlApiService')
const { getNhlTeamIdentity } = require('../services/nhlTeamIdentity')
const {
  STARTING_MODES,
  STARTING_ORDERING_SOURCES,
  buildWarnings,
  buildStartingState,
  calculateSanityBaselines,
  calculateMetrics,
  getCalibrationOptions,
  normalizeCalibrationInput,
  normalizeSeasonSelections,
  replayDataset,
  runBaseModelCalibration,
} = calibrationService

const productionSettings = {
  homeAdvantage: 4,
  kFactor: 1.2,
  modelVersion: 'power-rating-v1',
  overtimeMultiplier: 0.7,
  regulationMultiplier: 1,
  shootoutMultiplier: 0.5,
}

const teams = [
  {
    abbreviation: 'BOS',
    teamId: 'BOS',
    teamName: 'Boston Bruins',
  },
  {
    abbreviation: 'TOR',
    teamId: 'TOR',
    teamName: 'Toronto Maple Leafs',
  },
]

const currentRatings = [
  {
    abbreviation: 'BOS',
    baseRating: 55,
    teamId: 'BOS',
  },
  {
    abbreviation: 'TOR',
    baseRating: 45,
    teamId: 'TOR',
  },
]

const makeGame = ({
  away = 'TOR',
  awayScore = 2,
  gameState = 'OFF',
  home = 'BOS',
  homeScore = 4,
  id,
  lastPeriodType = 'REG',
  startTimeUTC,
}) => ({
  awayTeam: { abbrev: away, score: awayScore },
  gameOutcome: { lastPeriodType },
  gameState,
  gameType: 2,
  homeTeam: { abbrev: home, score: homeScore },
  id,
  season: 20242025,
  startTimeUTC,
})

const makePayload = (overrides = {}) => ({
  configuration: {
    kFactor: 1.2,
    overtimeMultiplier: 0.7,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  },
  dateFrom: '2025-01-01',
  dateTo: '2025-04-17',
  homeAdvantage: 4,
  probabilityScale: 6,
  seasonId: '20242025',
  startingRatings: {
    center: 46,
    mode: STARTING_MODES.CURRENT,
    spread: 18,
  },
  ...overrides,
})

const makeInput = (overrides = {}) =>
  normalizeCalibrationInput(makePayload(overrides), productionSettings)

const seasonsProvider = async () => ({
  seasons: [
    {
      endDate: '2025-04-17',
      id: '20242025',
      label: '2024–25',
      startDate: '2024-10-04',
    },
  ],
})

const multiSeasonsProvider = async () => ({
  metadataSource: 'fallback',
  seasons: [
    {
      endDate: '2025-04-17',
      id: '20242025',
      label: '2024–25',
      startDate: '2024-10-04',
    },
    {
      endDate: '2024-04-18',
      id: '20232024',
      label: '2023–24',
      startDate: '2023-10-10',
    },
  ],
})

const threeSeasonsProvider = async () => ({
  metadataSource: 'tested-explicit',
  seasons: [
    {
      endDate: '2026-04-16',
      id: '20252026',
      label: '2025–26',
      startDate: '2025-10-07',
    },
    ...(await multiSeasonsProvider()).seasons,
  ],
})

const makeMultiPayload = (overrides = {}) => ({
  configuration: {
    kFactor: 1.2,
    overtimeMultiplier: 0.7,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  },
  homeAdvantage: 4,
  label: 'Cross-season fixed spread',
  probabilityScale: 6,
  seasonIds: ['20242025', '20232024'],
  startingRatings: {
    center: 46,
    mode: STARTING_MODES.FIXED_SPREAD,
    spread: 18,
  },
  useCustomDateRange: false,
  ...overrides,
})

const assertAlmostEqual = (actual, expected, tolerance = 1e-8) => {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${actual} was not within ${tolerance} of ${expected}`,
  )
}

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
    await new Promise((resolve) => server.close(resolve))
  }
}

test('custom probability scale is explicit while Rating Lab defaults stay calibrated', () => {
  const input = makeInput({ probabilityScale: 9 })
  const defaultPayload = makePayload()

  delete defaultPayload.probabilityScale

  assert.equal(input.probabilityScale, 9)
  assert.equal(
    normalizeCalibrationInput(defaultPayload, {
      ...productionSettings,
      probabilityScale: 7,
    }).probabilityScale,
    20,
  )
})

test('production custom settings do not silently change Rating Lab test defaults', () => {
  const payload = makePayload()

  payload.configuration = {}
  payload.startingRatings = {}
  delete payload.homeAdvantage
  delete payload.probabilityScale

  const input = normalizeCalibrationInput(payload, {
    homeAdvantage: 9,
    kFactor: 4,
    modelVersion: 'power-rating-v1',
    overtimeMultiplier: 1.5,
    probabilityScale: 7,
    regulationMultiplier: 1.8,
    shootoutMultiplier: 1.2,
  })

  assert.deepEqual(input.configuration, {
    kFactor: 1.3,
    modelVersion: 'power-rating-v1',
    overtimeMultiplier: 0.4,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
  })
  assert.equal(input.homeAdvantage, 3.5)
  assert.equal(input.probabilityScale, 20)
  assert.deepEqual(input.startingRatings, {
    center: 46,
    mode: STARTING_MODES.CURRENT,
    spread: 8,
  })
})

test('calibration numeric validation accepts ordinary scale and K decimals', () => {
  ;[6, 6.0, 6.01, 8, 10].forEach((probabilityScale) => {
    assert.equal(makeInput({ probabilityScale }).probabilityScale, probabilityScale)
  })

  ;[1.2, '1.20', 1.21].forEach((kFactor) => {
    const input = makeInput({
      configuration: {
        ...makePayload().configuration,
        kFactor,
      },
    })

    assert.equal(input.configuration.kFactor, Number(kFactor))
  })

  assert.equal(makeInput({ homeAdvantage: 4.25 }).homeAdvantage, 4.25)
  assert.equal(
    makeInput({
      configuration: {
        kFactor: 1.2,
        overtimeMultiplier: 0.75,
        regulationMultiplier: 1,
        shootoutMultiplier: 0.55,
      },
    }).configuration.shootoutMultiplier,
    0.55,
  )
})

test('calibration numeric validation still rejects zero and negative scale', () => {
  ;[0, -0.01, ''].forEach((probabilityScale) => {
    assert.throws(
      () => makeInput({ probabilityScale }),
      /probabilityScale must be a finite number|probabilityScale must be greater than 0/,
    )
  })
})

test('batched schedule extraction retains calibration result metadata', () => {
  const rawGame = makeGame({
    id: 41,
    lastPeriodType: 'OT',
    startTimeUTC: '2025-01-01T00:00:00Z',
  })
  const games = extractScheduleGamesForDateRange(
    [
      {
        gameWeek: [
          {
            date: '2025-01-01',
            games: [rawGame],
          },
        ],
      },
    ],
    '2025-01-01',
    '2025-01-01',
  )

  assert.equal(games.length, 1)
  assert.equal(games[0].gameType, 2)
  assert.equal(games[0].season, 20242025)
  assert.equal(games[0].gameOutcome.lastPeriodType, 'OT')
})

test('calibration rejects client-provided user identity and unsupported nested fields', () => {
  assert.throws(
    () => makeInput({ userId: 'another-user' }),
    /unsupported calibration fields/,
  )
  assert.throws(
    () =>
      makeInput({
        configuration: {
          ...makePayload().configuration,
          goalieAdjustment: 2,
        },
      }),
    /configuration contains unsupported fields/,
  )
})

test('fixed spread follows current production ordering and preserves center', () => {
  const input = makeInput({
    startingRatings: {
      center: 46,
      mode: STARTING_MODES.FIXED_SPREAD,
      spread: 18,
    },
  })
  const state = buildStartingState({ currentRatings, input, teams })

  assert.equal(state.get('BOS').startingRating, 55)
  assert.equal(state.get('TOR').startingRating, 37)
  assert.equal(
    (state.get('BOS').startingRating + state.get('TOR').startingRating) / 2,
    46,
  )
})

test('replay is chronological and predicts before updating ratings', () => {
  const input = makeInput({ homeAdvantage: 0 })
  const startingState = buildStartingState({ currentRatings, input, teams })
  const laterGame = makeGame({
    away: 'BOS',
    awayScore: 1,
    home: 'TOR',
    homeScore: 2,
    id: 2,
    startTimeUTC: '2025-01-02T00:00:00Z',
  })
  const earlierGame = makeGame({
    id: 1,
    startTimeUTC: '2025-01-01T00:00:00Z',
  })
  const includedGames = [earlierGame, laterGame].map((game) => ({
    awayTeam: teams.find((team) => team.teamId === game.awayTeam.abbrev),
    game,
    homeTeam: teams.find((team) => team.teamId === game.homeTeam.abbrev),
    resultType: 'regulation',
    winner: 'home',
  }))
  const replay = replayDataset({ includedGames, input, ratingState: startingState })
  const expectedFirstProbability = 1 / (1 + Math.exp(-10 / 6))

  assert.equal(replay.predictions[0].gameId, 1)
  assertAlmostEqual(
    replay.predictions[0].homeProbability,
    expectedFirstProbability,
  )
  assert.equal(
    replay.predictions[1].homeProbability < 1 / (1 + Math.exp(10 / 6)),
    true,
    'the second prediction should use ratings updated after the first result',
  )
})

test('starting spread and probability scale change confidence in the expected direction', () => {
  const wideInput = makeInput({
    homeAdvantage: 0,
    startingRatings: { center: 46, mode: 'fixed_spread', spread: 18 },
  })
  const narrowInput = makeInput({
    homeAdvantage: 0,
    startingRatings: { center: 46, mode: 'fixed_spread', spread: 8 },
  })
  const lowerScaleInput = makeInput({
    homeAdvantage: 0,
    probabilityScale: 3,
    startingRatings: { center: 46, mode: 'fixed_spread', spread: 18 },
  })
  const game = makeGame({ id: 9, startTimeUTC: '2025-01-01T00:00:00Z' })
  const includedGames = [
    {
      awayTeam: teams[1],
      game,
      homeTeam: teams[0],
      resultType: 'regulation',
      winner: 'home',
    },
  ]
  const getFirstProbability = (input) =>
    replayDataset({
      includedGames,
      input,
      ratingState: buildStartingState({ currentRatings, input, teams }),
    }).predictions[0].homeProbability
  const wideProbability = getFirstProbability(wideInput)

  assert.equal(getFirstProbability(narrowInput) < wideProbability, true)
  assert.equal(getFirstProbability(lowerScaleInput) > wideProbability, true)
})

test('existing result multipliers remain part of the temporary update', () => {
  const input = makeInput({ homeAdvantage: 0 })
  const equalRatings = currentRatings.map((rating) => ({
    ...rating,
    baseRating: 50,
  }))
  const game = makeGame({
    id: 10,
    lastPeriodType: 'OT',
    startTimeUTC: '2025-01-01T00:00:00Z',
  })
  const replay = replayDataset({
    includedGames: [
      {
        awayTeam: teams[1],
        game,
        homeTeam: teams[0],
        resultType: 'overtime',
        winner: 'home',
      },
    ],
    input,
    ratingState: buildStartingState({ currentRatings: equalRatings, input, teams }),
  })

  assertAlmostEqual(replay.ratingState.get('BOS').finalRating, 50.42)
  assertAlmostEqual(replay.ratingState.get('TOR').finalRating, 49.58)
})

test('Brier, clipped log loss, ECE, accuracy and distributions are deterministic', () => {
  const metrics = calculateMetrics([
    {
      actualHomeWin: 1,
      favoriteConfidence: 0.8,
      homeProbability: 0.8,
      predictedCorrect: true,
    },
    {
      actualHomeWin: 0,
      favoriteConfidence: 0.7,
      homeProbability: 0.3,
      predictedCorrect: true,
    },
  ])

  assertAlmostEqual(metrics.brierScore, 0.065)
  assertAlmostEqual(
    metrics.logLoss,
    (-Math.log(0.8) - Math.log(0.7)) / 2,
  )
  assertAlmostEqual(metrics.expectedCalibrationError, 0.25)
  assert.equal(metrics.accuracy.rate, 1)
  assert.equal(metrics.predictionDistribution.minimum, 0.3)
  assert.equal(metrics.predictionDistribution.maximum, 0.8)
  assert.equal(metrics.predictionDistribution.median, 0.55)
  assert.equal(metrics.predictionDistribution.favoriteConfidenceAbove65Rate, 1)
  assert.equal(metrics.predictionDistribution.favoriteConfidenceAbove75Rate, 0.5)
  assert.equal(
    metrics.calibrationBuckets.reduce((total, bucket) => total + bucket.count, 0),
    2,
  )
})

test('log loss clips exact zero and one probabilities safely', () => {
  const metrics = calculateMetrics([
    {
      actualHomeWin: 1,
      favoriteConfidence: 1,
      homeProbability: 0,
      predictedCorrect: false,
    },
    {
      actualHomeWin: 0,
      favoriteConfidence: 1,
      homeProbability: 1,
      predictedCorrect: false,
    },
  ])

  assert.equal(metrics.clippedPredictions, 2)
  assert.equal(Number.isFinite(metrics.logLoss), true)
  assert.equal(metrics.brierScore, 1)
})

test('sanity baselines calculate 50 percent and historical home-rate fixtures', () => {
  const predictions = [1, 1, 1, 0].map((actualHomeWin) => ({
    actualHomeWin,
  }))
  const baselines = calculateSanityBaselines(predictions)

  assert.equal(baselines.constant50.probability, 0.5)
  assertAlmostEqual(baselines.constant50.brierScore, 0.25)
  assertAlmostEqual(baselines.constant50.logLoss, Math.log(2))
  assert.equal(baselines.historicalHomeRate.probability, 0.75)
  assertAlmostEqual(baselines.historicalHomeRate.brierScore, 0.1875)
  assertAlmostEqual(
    baselines.historicalHomeRate.logLoss,
    -(3 * Math.log(0.75) + Math.log(0.25)) / 4,
  )
})

const makeWarningInputs = (overrides = {}) => ({
  baselineComparison: {
    constant50: 'better',
    historicalHomeRate: 'better',
    ...overrides.baselineComparison,
  },
  dataset: {
    summary: { gamesIncluded: 1000, gamesSkipped: 0 },
  },
  metrics: {
    clippedPredictions: 0,
    expectedCalibrationError: 0.02,
    predictionDistribution: { maximum: 0.8, minimum: 0.2 },
    ...overrides.metrics,
  },
})

test('worse-than-home-rate baseline produces a diagnostic warning', () => {
  const warnings = buildWarnings(
    makeWarningInputs({
      baselineComparison: { historicalHomeRate: 'worse' },
    }),
  )

  assert.equal(
    warnings.some(
      (warning) =>
        warning.message ===
        'This configuration does not outperform a constant home-win-rate prediction on this dataset.',
    ),
    true,
  )
})

test('ECE above ten percentage points produces a diagnostic warning', () => {
  const warnings = buildWarnings(
    makeWarningInputs({
      metrics: { expectedCalibrationError: 0.100001 },
    }),
  )

  assert.equal(
    warnings.some(
      (warning) =>
        warning.message ===
        'Large calibration error: predicted probabilities differ substantially from observed outcomes.',
    ),
    true,
  )
})

test('full calibration run is isolated, user-scoped and center invariant', async () => {
  const capturedUserIds = []
  let gamesProviderCalls = 0
  const games = [
    makeGame({ id: 1, startTimeUTC: '2025-01-01T00:00:00Z' }),
    makeGame({
      away: 'BOS',
      awayScore: 3,
      home: 'TOR',
      homeScore: 2,
      id: 2,
      lastPeriodType: 'OT',
      startTimeUTC: '2025-01-02T00:00:00Z',
    }),
  ]
  const result = await runBaseModelCalibration('user-a', makePayload(), {
    currentRatingsProvider: async (userId) => {
      capturedUserIds.push(userId)
      return currentRatings
    },
    gamesProvider: async () => {
      gamesProviderCalls += 1
      return games
    },
    settingsProvider: async (userId) => {
      capturedUserIds.push(userId)
      return productionSettings
    },
    seasonsProvider,
    teamsProvider: async () => teams,
  })

  assert.deepEqual(capturedUserIds, ['user-a', 'user-a'])
  assert.equal(gamesProviderCalls, 1)
  assert.equal(result.dataset.gamesFound, 2)
  assert.equal(result.dataset.gamesIncluded, 2)
  assert.equal(result.diagnostics.productionWrites, false)
  assert.equal(result.diagnostics.predictionCalculatedBeforeUpdate, true)
  assert.equal(result.diagnostics.centerInvariance.passed, true)
  assert.equal(result.teamResults.length, 2)
  assert.equal(result.dataset.source, 'NHL API / shared cache')
  assert.equal(result.finalRatingSummary.topTeams.length, 2)
  assert.equal(result.finalRatingSummary.bottomTeams.length, 2)
  assert.match(result.displayLabel, /^2024–25 · Current · Scale 6$/)
  assert.equal(result.sanityBaselines.constant50.brierScore, 0.25)
  assert.equal(
    ['better', 'equal', 'worse'].includes(
      result.baselineComparison.historicalHomeRate,
    ),
    true,
  )
  assert.deepEqual(currentRatings, [
    { abbreviation: 'BOS', baseRating: 55, teamId: 'BOS' },
    { abbreviation: 'TOR', baseRating: 45, teamId: 'TOR' },
  ])
})

test('production calibration loads prepared Mongo games without an API games provider', async () => {
  let historicalLoadCalls = 0
  const storedGame = makeGame({
    id: 'stored-game',
    startTimeUTC: '2025-01-01T00:00:00Z',
  })
  const result = await runBaseModelCalibration('user-a', makePayload(), {
    currentRatingsProvider: async () => currentRatings,
    historicalSeasonsProvider: async (selectedSeasons) => {
      historicalLoadCalls += 1
      assert.deepEqual(
        selectedSeasons.map((season) => season.id),
        ['20242025'],
      )
      return new Map([
        [
          '20242025',
          {
            dataset: {
              completedGames: 1,
              importedGames: 1,
              lastErrorCode: null,
              skippedGames: 0,
              status: 'ready',
            },
            games: [storedGame],
            status: 'ready',
          },
        ],
      ])
    },
    seasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
  })

  assert.equal(historicalLoadCalls, 1)
  assert.equal(result.dataset.gamesIncluded, 1)
  assert.equal(result.dataset.source, 'MongoDB historical dataset')
})

test('rate-limited preparation failures expose saved progress without raw errors', async () => {
  await assert.rejects(
    runBaseModelCalibration('user-a', makePayload(), {
      currentRatingsProvider: async () => currentRatings,
      historicalSeasonsProvider: async () =>
        new Map([
          [
            '20242025',
            {
              dataset: {
                completedGames: 600,
                importedGames: 600,
                lastErrorCode: 'rate_limited',
                skippedGames: 4,
                status: 'partial',
              },
              games: [],
              message:
                'Historical season preparation paused because the NHL service is rate limiting requests. Saved progress will be reused when you resume.',
              status: 'partial',
            },
          ],
        ]),
      seasonsProvider,
      settingsProvider: async () => productionSettings,
      teamsProvider: async () => teams,
    }),
    (error) => {
      assert.equal(error.errorCode, 'rate_limited')
      assert.doesNotMatch(error.message, /raw|429/i)
      assert.equal(error.details.seasons[0].gamesFound, 600)
      assert.equal(error.details.seasons[0].status, 'rate_limited')
      return true
    },
  )
})

test('multi-season calibration uses exact boundaries, resets ratings and pools predictions', async () => {
  const requests = []
  const result = await runBaseModelCalibration('user-a', makeMultiPayload(), {
    currentRatingsProvider: async () => currentRatings,
    gamesProvider: async (dateFrom, dateTo, requestOptions) => {
      requests.push({ dateFrom, dateTo, seasonId: requestOptions.seasonId })
      const startTimeUTC = dateFrom.startsWith('2024')
        ? '2025-01-01T00:00:00Z'
        : '2024-01-01T00:00:00Z'

      return [makeGame({ id: requestOptions.seasonId, startTimeUTC })]
    },
    seasonsProvider: multiSeasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
    todayProvider: () => '2026-08-06',
  })

  assert.deepEqual(requests, [
    {
      dateFrom: '2024-10-04',
      dateTo: '2025-04-17',
      seasonId: '20242025',
    },
    {
      dateFrom: '2023-10-10',
      dateTo: '2024-04-18',
      seasonId: '20232024',
    },
  ])
  assert.equal(result.diagnostics.ratingResetBetweenSeasons, true)
  assert.equal(result.seasonResults.length, 2)
  assert.deepEqual(
    result.seasonResults[0].teamResults,
    result.seasonResults[1].teamResults,
  )
  const weightedBrier =
    result.seasonResults.reduce(
      (total, season) =>
        total + season.metrics.brierScore * season.dataset.gamesIncluded,
      0,
    ) / result.dataset.gamesIncluded
  const averageSeasonBrier =
    result.seasonResults.reduce(
      (total, season) => total + season.metrics.brierScore,
      0,
    ) / result.seasonResults.length

  assertAlmostEqual(result.metrics.brierScore, weightedBrier)
  assertAlmostEqual(result.aggregate.averageSeasonBrier, averageSeasonBrier)
  assert.equal(result.aggregate.completedSeasons, 2)
  assert.equal(result.aggregate.incomplete, false)
  assert.match(result.displayLabel, /^Aggregate · 2 seasons/)
  assert.equal(result.aggregate.bestSeason.seasonId, '20242025')
  assert.equal(result.aggregate.worstSeason.seasonId, '20242025')
  assert.equal(result.aggregate.brierStandardDeviation, 0)
  assert.equal(result.seasonResults[1].metadataSource, 'fallback')
  assert.equal(
    result.seasonResults.every(
      (season) =>
        season.orderingSource === STARTING_ORDERING_SOURCES.ALPHABETICAL,
    ),
    true,
  )
  assert.equal(
    result.parameters.startingRatings.policy,
    'FIXED_SPREAD_ALPHABETICAL',
  )
  assert.equal(
    result.parameters.startingRatings.label,
    'Fixed 37–55 · Alphabetical ordering',
  )
  assert.equal(result.parameters.startingRatings.comparableToUnifiedMultiSeason, true)
  assert.equal(
    result.parameters.startingRatings.startingStateSignature,
    result.diagnostics.startingStateSignature,
  )
  assert.equal(result.finalRatingSummary, null)
  assert.equal(result.stability.seasonsEvaluated, 2)
})

test('multi-season fixed spread stays alphabetical for the latest season and has a stable signature', async () => {
  const makeRunOptions = (ratings) => ({
    currentRatingsProvider: async () => ratings,
    gamesProvider: async (dateFrom, _dateTo, requestOptions) => [
      makeGame({
        id: requestOptions.seasonId,
        startTimeUTC: `${dateFrom.slice(0, 4)}-12-01T00:00:00Z`,
      }),
    ],
    seasonsProvider: threeSeasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
    todayProvider: () => '2026-08-06',
  })
  const payload = makeMultiPayload({
    seasonIds: ['20252026', '20242025', '20232024'],
    startingRatings: {
      center: 46,
      mode: STARTING_MODES.FIXED_SPREAD,
      spread: 8,
    },
  })
  const currentOrder = [
    { abbreviation: 'BOS', baseRating: 40, teamId: 'BOS' },
    { abbreviation: 'TOR', baseRating: 60, teamId: 'TOR' },
  ]
  const reversedOrder = [
    { abbreviation: 'BOS', baseRating: 60, teamId: 'BOS' },
    { abbreviation: 'TOR', baseRating: 40, teamId: 'TOR' },
  ]
  const first = await runBaseModelCalibration(
    'user-a',
    payload,
    makeRunOptions(currentOrder),
  )
  const second = await runBaseModelCalibration(
    'user-a',
    payload,
    makeRunOptions(reversedOrder),
  )
  const withoutProductionRatings = await runBaseModelCalibration(
    'user-a',
    payload,
    makeRunOptions([]),
  )

  assert.equal(
    first.seasonResults.every(
      (season) =>
        season.orderingSource === STARTING_ORDERING_SOURCES.ALPHABETICAL &&
        season.startingState.policy === 'FIXED_SPREAD_ALPHABETICAL',
    ),
    true,
  )
  assert.equal(first.seasonResults[0].seasonId, '20252026')
  assert.equal(
    first.seasonResults[0].orderingSource,
    STARTING_ORDERING_SOURCES.ALPHABETICAL,
  )
  assert.equal(
    first.diagnostics.startingStateSignature,
    second.diagnostics.startingStateSignature,
  )
  assert.equal(
    first.diagnostics.startingStateSignature,
    withoutProductionRatings.diagnostics.startingStateSignature,
  )
  assert.deepEqual(first.metrics, second.metrics)
  assert.deepEqual(first.metrics, withoutProductionRatings.metrics)
})

test('single-season latest fixed spread preserves the current-order scenario mode', async () => {
  const scenarioRatings = [
    { abbreviation: 'BOS', baseRating: 40, teamId: 'BOS' },
    { abbreviation: 'TOR', baseRating: 60, teamId: 'TOR' },
  ]
  const result = await runBaseModelCalibration(
    'user-a',
    makeMultiPayload({
      seasonIds: ['20252026'],
      startingRatings: {
        center: 46,
        mode: STARTING_MODES.FIXED_SPREAD,
        spread: 8,
      },
    }),
    {
      currentRatingsProvider: async () => scenarioRatings,
      gamesProvider: async () => [
        makeGame({ id: 1, startTimeUTC: '2025-12-01T00:00:00Z' }),
      ],
      seasonsProvider: threeSeasonsProvider,
      settingsProvider: async () => productionSettings,
      teamsProvider: async () => teams,
      todayProvider: () => '2026-08-06',
    },
  )

  assert.equal(
    result.parameters.startingRatings.orderingSource,
    STARTING_ORDERING_SOURCES.CURRENT_RATING_ORDER,
  )
  assert.equal(
    result.parameters.startingRatings.policy,
    'CURRENT_PRODUCTION_ORDER',
  )
  assert.equal(result.parameters.startingRatings.comparableToUnifiedMultiSeason, false)
  assert.match(result.parameters.startingRatings.label, /Scenario only/)
  assert.equal(
    result.teamResults.find((team) => team.teamId === 'TOR').startingRating,
    50,
  )
  assert.equal(
    result.teamResults.find((team) => team.teamId === 'BOS').startingRating,
    42,
  )
})

test('single selected season uses its exact metadata range and season-only baselines', async () => {
  let capturedRange
  const result = await runBaseModelCalibration(
    'user-a',
    makeMultiPayload({ seasonIds: ['20232024'] }),
    {
      currentRatingsProvider: async () => currentRatings,
      gamesProvider: async (dateFrom, dateTo) => {
        capturedRange = { dateFrom, dateTo }
        return [makeGame({ id: 1, startTimeUTC: '2024-01-01T00:00:00Z' })]
      },
      seasonsProvider: multiSeasonsProvider,
      settingsProvider: async () => productionSettings,
      teamsProvider: async () => teams,
      todayProvider: () => '2026-08-06',
    },
  )

  assert.deepEqual(capturedRange, {
    dateFrom: '2023-10-10',
    dateTo: '2024-04-18',
  })
  assert.equal(result.seasonResults.length, 1)
  assert.equal(result.sanityBaselines.constant50.brierScore, 0.25)
  assert.equal(result.filters.seasonId, '20232024')
  assert.match(result.displayLabel, /^2023–24 · Cross-season fixed spread/)
  assert.equal(result.stability.level, 'not_assessed')
})

test('three selected seasons execute sequentially and all contribute to pooled metrics', async () => {
  let activeSeasonLoads = 0
  let maximumActiveSeasonLoads = 0
  const requestedSeasonIds = []
  const result = await runBaseModelCalibration(
    'user-a',
    makeMultiPayload({
      seasonIds: ['20252026', '20242025', '20232024'],
    }),
    {
      currentRatingsProvider: async () => currentRatings,
      gamesProvider: async (dateFrom, _dateTo, requestOptions) => {
        activeSeasonLoads += 1
        maximumActiveSeasonLoads = Math.max(
          maximumActiveSeasonLoads,
          activeSeasonLoads,
        )
        requestedSeasonIds.push(requestOptions.seasonId)
        await new Promise((resolve) => setImmediate(resolve))
        activeSeasonLoads -= 1

        return [
          makeGame({
            id: requestOptions.seasonId,
            startTimeUTC: `${dateFrom.slice(0, 4)}-12-01T00:00:00Z`,
          }),
        ]
      },
      seasonsProvider: threeSeasonsProvider,
      settingsProvider: async () => productionSettings,
      teamsProvider: async () => teams,
      todayProvider: () => '2026-08-06',
    },
  )

  assert.deepEqual(requestedSeasonIds, [
    '20252026',
    '20242025',
    '20232024',
  ])
  assert.equal(maximumActiveSeasonLoads, 1)
  assert.equal(result.aggregate.completedSeasons, 3)
  assert.equal(result.coverage.seasons.length, 3)
  assert.equal(
    result.coverage.seasons.every((season) => season.status === 'completed'),
    true,
  )
  assert.equal(result.dataset.gamesIncluded, 3)
  assert.equal(result.stability.seasonsEvaluated, 3)
  assert.equal(result.stability.seasonsSelected, 3)
})

test('multi-season calibration preserves successful seasons when one season fails', async () => {
  const result = await runBaseModelCalibration('user-a', makeMultiPayload(), {
    currentRatingsProvider: async () => currentRatings,
    gamesProvider: async (dateFrom, _dateTo, requestOptions) => {
      if (requestOptions.seasonId === '20232024') {
        throw new Error('upstream detail must stay private')
      }

      return [makeGame({ id: 1, startTimeUTC: `${dateFrom.slice(0, 4)}-12-01T00:00:00Z` })]
    },
    seasonsProvider: multiSeasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
    todayProvider: () => '2026-08-06',
  })

  assert.equal(result.aggregate.completedSeasons, 1)
  assert.equal(result.aggregate.incomplete, true)
  assert.deepEqual(result.coverage.failedSeasonIds, ['20232024'])
  assert.equal(result.coverage.seasons.length, 2)
  assert.equal(result.coverage.seasons[1].status, 'simulation_failed')
  assert.equal(result.coverage.seasons[1].errorCode, 'simulation_failed')
  assert.equal(result.seasonFailures[0].message, 'Season data could not be loaded or calibrated.')
  assert.match(result.displayLabel, /^Partial aggregate · 1 of 2 seasons/)
  assert.equal(
    result.warnings.some((warning) => warning.code === 'INCOMPLETE_SEASON_COVERAGE'),
    true,
  )
})

test('suspiciously low full-season data is reported instead of ranked as complete', async () => {
  const leagueTeams = [
    ...teams,
    ...Array.from({ length: 30 }, (_item, index) => ({
      abbreviation: `T${String(index).padStart(2, '0')}`,
      teamId: `T${String(index).padStart(2, '0')}`,
      teamName: `Test Team ${index}`,
    })),
  ]

  await assert.rejects(
    runBaseModelCalibration(
      'user-a',
      makeMultiPayload({ seasonIds: ['20232024'] }),
      {
        currentRatingsProvider: async () => currentRatings,
        gamesProvider: async () => [
          makeGame({ id: 1, startTimeUTC: '2024-01-01T00:00:00Z' }),
        ],
        seasonsProvider: multiSeasonsProvider,
        settingsProvider: async () => productionSettings,
        teamsProvider: async () => leagueTeams,
        todayProvider: () => '2026-08-06',
      },
    ),
    (error) => {
      assert.equal(error.errorCode, 'incomplete_historical_data')
      assert.equal(error.details.seasons[0].status, 'data_unavailable')
      assert.equal(error.details.seasons[0].gamesIncluded, 1)
      assert.match(error.details.seasons[0].userMessage, /historical data may be incomplete/)
      return true
    },
  )
})

test('cross-season input rejects custom ranges and current production starts', async () => {
  const metadata = await multiSeasonsProvider()

  assert.throws(
    () =>
      normalizeSeasonSelections(
        makeMultiPayload({
          dateFrom: '2024-10-04',
          dateTo: '2025-04-17',
          useCustomDateRange: true,
        }),
        metadata,
        '2026-08-06',
      ),
    /custom date range can only be used with one historical season/,
  )

  await assert.rejects(
    runBaseModelCalibration(
      'user-a',
      makeMultiPayload({
        startingRatings: { center: 46, mode: STARTING_MODES.CURRENT, spread: 18 },
      }),
      {
        currentRatingsProvider: async () => currentRatings,
        seasonsProvider: multiSeasonsProvider,
        settingsProvider: async () => productionSettings,
        teamsProvider: async () => teams,
        todayProvider: () => '2026-08-06',
      },
    ),
    /cannot be used for cross-season calibration/,
  )
})

test('calibration selection normalizes display season labels to canonical IDs', async () => {
  const metadata = await multiSeasonsProvider()
  const selected = normalizeSeasonSelections(
    makeMultiPayload({ seasonIds: ['2024–25', '2023-24'] }),
    metadata,
    '2026-08-06',
  )

  assert.deepEqual(
    selected.map((season) => season.id),
    ['20242025', '20232024'],
  )
})

test('historical Arizona identity resolves to the current Utah franchise key', () => {
  assert.equal(getNhlTeamIdentity('ARI'), 'UTA')
  assert.equal(getNhlTeamIdentity('Arizona Coyotes'), 'UTA')
  assert.equal(getNhlTeamIdentity('Utah Hockey Club'), 'UTA')
})

test('calibration options expose completed historical seasons with metadata source', async () => {
  const result = await getCalibrationOptions('user-a', {
    currentRatingsProvider: async () => currentRatings,
    seasonsProvider: async () => ({
      metadataSource: 'fallback',
      seasons: [
        {
          endDate: '2027-04-30',
          id: '20262027',
          label: '2026–27',
          startDate: '2026-10-01',
        },
        ...(await multiSeasonsProvider()).seasons,
      ],
      warning: 'Season dates loaded from tested fallback metadata.',
    }),
    settingsProvider: async () => productionSettings,
    historicalStatusProvider: async (seasons) =>
      seasons.map((season, index) => ({
        completedGames: index === 0 ? 1307 : 1312,
        expectedApproximateGames: 1312,
        importedGames: index === 0 ? 1307 : 1312,
        seasonId: season.id,
        status: 'ready',
      })),
    todayProvider: () => '2026-08-06',
  })

  assert.deepEqual(
    result.seasons.map((season) => season.id),
    ['20242025', '20232024'],
  )
  assert.equal(result.seasons[0].metadataSource, 'fallback')
  assert.equal(result.seasons[0].historicalDataset.status, 'ready')
  assert.equal(result.seasons[0].historicalDataset.completedGames, 1307)
  assert.equal(result.defaults.seasonId, '20242025')
  assert.deepEqual(result.defaults.configuration, {
    kFactor: 1.3,
    overtimeMultiplier: 0.4,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
  })
  assert.equal(result.defaults.homeAdvantage, 3.5)
  assert.equal(result.defaults.probabilityScale, 20)
  assert.deepEqual(result.defaults.startingRatings, {
    center: 46,
    mode: STARTING_MODES.CURRENT,
    spread: 8,
  })
  assert.deepEqual(result.startingStatePolicies.multiSeason, {
    description:
      'Every evaluated season uses the same deterministic seed-team alphabetical order.',
    label: 'Fixed 42–50 · Alphabetical ordering',
    policy: 'FIXED_SPREAD_ALPHABETICAL',
  })
  assert.equal(
    result.startingStatePolicies.singleSeasonScenarios.currentProductionAvailable,
    true,
  )
  assert.equal(
    result.warning,
    'Season dates loaded from tested fallback metadata.',
  )
})

test('calibration never calls production model write methods', async () => {
  const writeModels = [
    Bet,
    GameContext,
    GoalieAdjustment,
    HistoricalNhlGame,
    HistoricalSeasonDataset,
    Injury,
    PowerRating,
    ProcessedRatingGame,
    RatingEngineSettings,
  ]
  const writeMethods = [
    'bulkWrite',
    'create',
    'deleteMany',
    'deleteOne',
    'findOneAndUpdate',
    'insertMany',
    'updateMany',
    'updateOne',
  ]
  const patches = writeModels.flatMap((model) =>
    writeMethods.map((method) => [
      model,
      method,
      async () => {
        throw new Error(`${model.modelName}.${method} must not be called`)
      },
    ]),
  )

  await withPatches(patches, async () => {
    const result = await runBaseModelCalibration('user-a', makePayload(), {
      currentRatingsProvider: async () => currentRatings,
      gamesProvider: async () => [
        makeGame({ id: 1, startTimeUTC: '2025-01-01T00:00:00Z' }),
      ],
      seasonsProvider,
      settingsProvider: async () => productionSettings,
      teamsProvider: async () => teams,
    })

    assert.equal(result.diagnostics.productionWrites, false)
    assert.equal(
      result.parameters.startingRatings.policy,
      'CURRENT_PRODUCTION_ORDER',
    )
    assert.match(result.parameters.startingRatings.label, /Scenario only/)
  })
})

test('identical calibration runs are deterministic', async () => {
  const runOptions = {
    currentRatingsProvider: async () => currentRatings,
    gamesProvider: async () => [
      makeGame({ id: 1, startTimeUTC: '2025-01-01T00:00:00Z' }),
    ],
    seasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
  }
  const first = await runBaseModelCalibration('user-a', makePayload(), runOptions)
  const second = await runBaseModelCalibration('user-a', makePayload(), runOptions)

  assert.deepEqual(second, first)
})

test('calibration requires complete finite starting ratings', async () => {
  await assert.rejects(
    runBaseModelCalibration('user-a', makePayload(), {
      currentRatingsProvider: async () => currentRatings.slice(0, 1),
      gamesProvider: async () => [
        makeGame({ id: 1, startTimeUTC: '2025-01-01T00:00:00Z' }),
      ],
      settingsProvider: async () => productionSettings,
      seasonsProvider,
      teamsProvider: async () => teams,
    }),
    /complete set of finite current Power Ratings/,
  )
})

test('calibration rejects unsupported seasons and dates outside season bounds', async () => {
  const runOptions = {
    currentRatingsProvider: async () => currentRatings,
    gamesProvider: async () => [],
    seasonsProvider,
    settingsProvider: async () => productionSettings,
    teamsProvider: async () => teams,
  }

  await assert.rejects(
    runBaseModelCalibration(
      'user-a',
      makePayload({ seasonId: '20192020' }),
      runOptions,
    ),
    /seasonId is not available/,
  )
  await assert.rejects(
    runBaseModelCalibration(
      'user-a',
      makePayload({ dateFrom: '2024-09-01' }),
      runOptions,
    ),
    /dates must stay within the selected regular season/,
  )
})

test('calibration routes require authentication', async () => {
  const optionsResponse = await request(
    '/api/power-rating-simulations/calibration/options',
  )
  const runResponse = await request(
    '/api/power-rating-simulations/calibration/run',
    {
      body: JSON.stringify(makePayload()),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const prepareResponse = await request(
    '/api/power-rating-simulations/calibration/historical-seasons/20242025/prepare',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )

  assert.equal(optionsResponse.status, 401)
  assert.equal(runResponse.status, 401)
  assert.equal(prepareResponse.status, 401)
})

test('authenticated calibration route uses the authenticated user', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const token = authService.signAuthToken(userId)
  const originalRun = calibrationService.runBaseModelCalibration
  let capturedUserId = null
  let capturedPayload = null

  calibrationService.runBaseModelCalibration = async (
    authenticatedUserId,
    requestPayload,
  ) => {
    capturedUserId = authenticatedUserId
    capturedPayload = requestPayload
    return { experimental: true }
  }

  try {
    const response = await request(
      '/api/power-rating-simulations/calibration/run',
      {
        body: JSON.stringify(
          makeMultiPayload({
            seasonIds: ['20252026', '20242025', '20232024'],
          }),
        ),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.experimental, true)
    assert.equal(capturedUserId, userId)
    assert.deepEqual(capturedPayload.seasonIds, [
      '20252026',
      '20242025',
      '20232024',
    ])
  } finally {
    calibrationService.runBaseModelCalibration = originalRun
  }
})
