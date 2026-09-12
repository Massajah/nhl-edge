process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const { CLOSING_SAFETY_REASON } = require('../services/oddsClosingMarketContracts')
const {
  ModelPerformanceError,
  getModelPerformance,
  getModelPerformanceGames,
  normalizePerformanceQuery,
} = require('../services/modelPerformanceService')
const {
  buildBetPeriodFilter,
  buildPredictionFilter,
} = require('../services/modelPerformanceRepository')

const USER_ID = '507f1f77bcf86cd799439011'
const OTHER_USER_ID = '507f191e810c19729de860ea'
const SEASON = {
  endDate: '2027-04-30',
  id: '20262027',
  isCurrent: true,
  label: '2026–27',
  startDate: '2026-10-01',
}
const SEASON_METADATA = {
  currentSeasonId: SEASON.id,
  seasons: [SEASON],
}
const STARTS = [
  '2026-10-08T19:00:00.000Z',
  '2026-10-09T19:00:00.000Z',
  '2026-10-10T19:00:00.000Z',
  '2026-10-11T19:00:00.000Z',
]

const makePrediction = (index, overrides = {}) => {
  const scheduledStartAtCapture = STARTS[index]
  const start = new Date(scheduledStartAtCapture).getTime()

  return {
    adjustments: {
      away: { injuries: -0.5, specialTeams: 0.25 },
      home: { homeAdvantage: 3.5, quickRematch: 0.5 },
    },
    awayFairOdds: 5,
    awayTeamId: 'COL',
    awayWinProbability: 0.2,
    calculationContractVersion: 'automatic-prediction-v1',
    completeness: {
      goalies: { away: 'AVAILABLE', home: 'AVAILABLE' },
      injuries: { away: 'AVAILABLE', home: 'AVAILABLE' },
      ratings: 'AVAILABLE',
      schedule: { away: 'AVAILABLE', home: 'AVAILABLE' },
      specialTeams: { away: 'AVAILABLE', home: 'AVAILABLE' },
    },
    gameId: `202602000${index + 1}`,
    gameType: 2,
    generatedAt: new Date(start - 90 * 60 * 1000),
    homeTeamId: 'BOS',
    homeFairOdds: 1.25,
    homeWinProbability: 0.8,
    modelState: {
      away: { baseRating: 48, effectiveRating: 47.75 },
      home: { baseRating: 52, effectiveRating: 56 },
    },
    modelVersion: 'power-rating-v1',
    predictionDefinition: 'OFFICIAL_T2_AUTOMATIC_V1',
    scheduledStartAtCapture: new Date(scheduledStartAtCapture),
    seasonId: SEASON.id,
    settingsFingerprint: `${index % 2 ? 'b' : 'a'}`.repeat(64),
    targetAt: new Date(start - 120 * 60 * 1000),
    ...overrides,
  }
}

const makeHistoricalGame = (prediction, overrides = {}) => ({
  awayScore: 2,
  awayTeamAbbreviation: prediction.awayTeamId,
  awayTeamId: prediction.awayTeamId,
  gameId: prediction.gameId,
  gameState: 'FINAL',
  gameType: prediction.gameType,
  homeScore: 3,
  homeTeamAbbreviation: prediction.homeTeamId,
  homeTeamId: prediction.homeTeamId,
  resultType: 'REGULATION',
  seasonId: prediction.seasonId,
  startTimeUTC: prediction.scheduledStartAtCapture,
  ...overrides,
})

const makeT2 = (prediction, bookmakers = null) => ({
  awayTeamId: prediction.awayTeamId,
  bookmakers:
    bookmakers ?? [
      { awayOdds: 2.2, homeOdds: 1.8, key: 'pinnacle' },
    ],
  capturedAt: new Date(+prediction.scheduledStartAtCapture - 2 * 60 * 60 * 1000),
  gameId: prediction.gameId,
  gameType: prediction.gameType,
  homeTeamId: prediction.homeTeamId,
  scheduledStartAtCapture: prediction.scheduledStartAtCapture,
  seasonId: prediction.seasonId,
  snapshotType: 'T2',
})

const makeClosing = (prediction, bookmakers = null) => {
  const observedAt = new Date(+prediction.scheduledStartAtCapture - 5 * 60 * 1000)
  const rows =
    bookmakers ?? [
      {
        awayOdds: 2.1,
        homeOdds: 1.9,
        key: 'pinnacle',
        observedAt,
        providerCommenceTime: prediction.scheduledStartAtCapture,
        safetyReason: CLOSING_SAFETY_REASON,
      },
    ]

  return {
    awayTeamId: prediction.awayTeamId,
    bestFinal: {
      away: null,
      home: {
        bookmakerKey: rows[0].key,
        observedAt,
        odds: rows[0].homeOdds,
      },
    },
    finalBookmakers: rows,
    finalizedAt: prediction.scheduledStartAtCapture,
    gameId: prediction.gameId,
    gameType: prediction.gameType,
    homeTeamId: prediction.homeTeamId,
    scheduledStartAtCapture: prediction.scheduledStartAtCapture,
    seasonId: prediction.seasonId,
  }
}

const createRepository = ({
  bets = [],
  closings = [],
  historicalGames = [],
  latestModelVersion = 'power-rating-v1',
  predictions = [],
  t2Snapshots = [],
  timelineSnapshots = t2Snapshots,
} = {}) => {
  const calls = []

  return {
    captureHealthScheduleProvider: async () => ({
      games: [],
      source: 'fixture',
      stale: false,
    }),
    calls,
    async findBets(filter) {
      calls.push(['findBets', filter])
      assert.equal(filter.userId, USER_ID)
      return bets.filter((bet) => bet.userId !== OTHER_USER_ID)
    },
    async findClosingMarkets(gameIds) {
      calls.push(['findClosingMarkets', gameIds])
      return closings.filter((row) => gameIds.includes(row.gameId))
    },
    async findCaptureHealthClosingMarkets(gameIds, seasonId) {
      calls.push(['findCaptureHealthClosingMarkets', gameIds, seasonId])
      return closings.filter((row) => gameIds.includes(row.gameId))
    },
    async findCaptureHealthSnapshots(gameIds, seasonId) {
      calls.push(['findCaptureHealthSnapshots', gameIds, seasonId])
      return timelineSnapshots.filter((row) => gameIds.includes(row.gameId))
    },
    async findHistoricalGames(gameIds) {
      calls.push(['findHistoricalGames', gameIds])
      return historicalGames.filter((row) => gameIds.includes(row.gameId))
    },
    async findLatestModelVersion(filter) {
      calls.push(['findLatestModelVersion', filter])
      assert.equal(filter.userId, USER_ID)
      return latestModelVersion
    },
    async findModelVersions(filter) {
      calls.push(['findModelVersions', filter])
      assert.equal(filter.userId, USER_ID)
      return [...new Set(predictions.map(({ modelVersion }) => modelVersion))]
    },
    async findPredictions(filter) {
      calls.push(['findPredictions', filter])
      assert.equal(filter.userId, USER_ID)
      assert.equal(filter.predictionDefinition, 'OFFICIAL_T2_AUTOMATIC_V1')
      return predictions.filter(
        (prediction) =>
          prediction.userId !== OTHER_USER_ID &&
          prediction.modelVersion === filter.modelVersion,
      )
    },
    async findT2Snapshots(gameIds, seasonId) {
      calls.push(['findT2Snapshots', gameIds, seasonId])
      return t2Snapshots.filter((row) => gameIds.includes(row.gameId))
    },
    async findTimelineSnapshots(gameIds, seasonId) {
      calls.push(['findTimelineSnapshots', gameIds, seasonId])
      return timelineSnapshots.filter((row) => gameIds.includes(row.gameId))
    },
  }
}

test('aggregate is owner/version scoped, surfaces mixed settings, and uses paired markets', async () => {
  const predictions = [
    makePrediction(0),
    makePrediction(1, { awayWinProbability: 0.4, homeWinProbability: 0.6 }),
    makePrediction(2, { awayWinProbability: 0.5, homeWinProbability: 0.5 }),
    makePrediction(3, { awayWinProbability: 0.3, homeWinProbability: 0.7 }),
    makePrediction(0, { modelVersion: 'power-rating-v2' }),
  ]
  const historicalGames = [
    makeHistoricalGame(predictions[0]),
    makeHistoricalGame(predictions[1], { awayScore: 4, homeScore: 1 }),
    makeHistoricalGame(predictions[2]),
  ]
  const t2Snapshots = [makeT2(predictions[0]), makeT2(predictions[1])]
  const closings = [makeClosing(predictions[0])]
  const bets = [
    {
      bookmakerKey: 'pinnacle',
      createdAt: new Date(+predictions[0].scheduledStartAtCapture - 60 * 60 * 1000),
      gameId: predictions[0].gameId,
      marketOdds: 2,
      marketOddsSource: 'provider',
      profit: 10,
      result: 'win',
      scheduledStart: predictions[0].scheduledStartAtCapture,
      selectedSide: { homeAway: 'home', teamId: 'BOS' },
      stake: 10,
      userId: USER_ID,
    },
    {
      bookmakerKey: null,
      createdAt: new Date(+predictions[1].scheduledStartAtCapture - 60 * 60 * 1000),
      gameId: predictions[1].gameId,
      marketOdds: 2,
      marketOddsSource: 'manual',
      profit: 0,
      result: 'pending',
      scheduledStart: predictions[1].scheduledStartAtCapture,
      selectedSide: { homeAway: 'away' },
      stake: 5,
      userId: USER_ID,
    },
    {
      gameId: predictions[0].gameId,
      profit: 999,
      result: 'win',
      userId: OTHER_USER_ID,
    },
  ]
  const repository = createRepository({
    bets,
    closings,
    historicalGames,
    predictions,
    t2Snapshots,
  })
  const result = await getModelPerformance(
    USER_ID,
    { modelVersion: 'power-rating-v1', season: SEASON.id },
    {
      gameProvider: async (gameId) => ({
        awayTeam: { abbreviation: 'COL', score: null },
        gameId,
        gameState: 'FUT',
        gameType: 2,
        homeTeam: { abbreviation: 'BOS', score: null },
        season: SEASON.id,
        startTimeUTC: STARTS[3],
      }),
      repository,
      seasonMetadata: SEASON_METADATA,
    },
  )

  assert.equal(result.metadata.modelVersion, 'power-rating-v1')
  assert.deepEqual(result.metadata.availableModelVersions, [
    'power-rating-v1',
    'power-rating-v2',
  ])
  assert.equal(result.metadata.availableSeasons[0].id, SEASON.id)
  assert.equal(result.metadata.season.regularSeasonEndDate, '2027-04-30')
  assert.equal(result.metadata.season.performanceEndDate, '2027-07-15')
  assert.equal(result.metadata.settingsFingerprintCount, 2)
  assert.equal(result.metadata.mixedSettings, true)
  assert.equal(repository.calls.some(([name]) => name === 'findTimelineSnapshots'), false)
  assert.equal(repository.calls.some(([name]) => name === 'findT2Snapshots'), true)
  assert.equal(result.coverage.forward.officialPredictions, 4)
  assert.equal(result.coverage.forward.validFinalResults, 3)
  assert.equal(result.coverage.forward.validT2Markets, 2)
  assert.equal(result.coverage.forward.validFinalMarkets, 1)
  assert.equal(result.coverage.forward.validT2AndFinalMarkets, 1)
  assert.equal(result.forwardOverview.modelBrier.sampleSize, 3)
  assert.ok(
    Math.abs(result.forwardOverview.modelBrier.value - (0.04 + 0.36 + 0.25) / 3) <
      1e-15,
  )
  assert.equal(result.forwardOverview.accuracy.sampleSize, 2)
  assert.equal(result.forwardOverview.accuracy.noPickCount, 1)
  assert.equal(result.marketComparison.t2.pairedSampleSize, 2)
  assert.equal(result.marketComparison.final.pairedSampleSize, 1)
  assert.equal(result.marketComparison.movementTowardModel.sampleSize, 1)
  assert.equal(result.betPerformance.totalRelevantBets, 2)
  assert.equal(result.betPerformance.profit, 10)
  assert.equal(result.clv.eligibleBetCount, 1)
  assert.equal(result.coverage.bets.betsWithRecognizedBookmaker, 1)
  assert.equal(result.coverage.bets.sameBookClvEligibleBets, 1)
  assert.ok(result.dataQuality.reasons.includes('RESULT_PENDING'))
  assert.ok(result.dataQuality.reasons.includes('MISSING_FINAL_MARKET'))
})

test('default model version is the latest owner-scoped relevant snapshot', async () => {
  const prediction = makePrediction(0, { modelVersion: 'power-rating-v2' })
  const repository = createRepository({
    historicalGames: [makeHistoricalGame(prediction)],
    latestModelVersion: 'power-rating-v2',
    predictions: [prediction],
  })
  const result = await getModelPerformance(USER_ID, {}, {
    repository,
    seasonMetadata: SEASON_METADATA,
  })

  assert.equal(result.metadata.modelVersion, 'power-rating-v2')
  assert.equal(result.metadata.officialPredictionCount, 1)
  assert.ok(repository.calls.some(([name]) => name === 'findLatestModelVersion'))
})

test('season/date filters are intersected before owner-scoped repository reads', async () => {
  const repository = createRepository()

  await getModelPerformance(
    USER_ID,
    { from: '2026-11-01', season: SEASON.id, to: '2026-11-30' },
    { repository, seasonMetadata: SEASON_METADATA },
  )

  const predictionCall = repository.calls.find(
    ([name]) => name === 'findPredictions',
  )[1]
  const betCall = repository.calls.find(([name]) => name === 'findBets')[1]
  assert.equal(predictionCall.seasonId, SEASON.id)
  assert.equal(predictionCall.start.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(
    predictionCall.endExclusive.toISOString(),
    '2026-12-01T00:00:00.000Z',
  )
  assert.equal(betCall.userId, USER_ID)
  assert.equal(betCall.start.toISOString(), '2026-11-01T00:00:00.000Z')
})

test('empty cohort returns null metrics rather than misleading zero performance', async () => {
  const result = await getModelPerformance(USER_ID, {}, {
    repository: createRepository(),
    seasonMetadata: SEASON_METADATA,
  })

  assert.equal(result.forwardOverview.modelBrier.value, null)
  assert.equal(result.forwardOverview.modelBrier.sampleSize, 0)
  assert.equal(result.betPerformance.roiPercent, null)
  assert.equal(result.clv.averageClvPercent, null)
  assert.equal(result.coverage.forward.resultCoveragePercent, 0)
  assert.equal(result.dataQuality.status, 'unavailable')
})

test('games endpoint paginates compact rows and supports resolved/missing-market filters', async () => {
  const predictions = [makePrediction(0), makePrediction(1), makePrediction(2)]
  const repository = createRepository({
    historicalGames: predictions.map((prediction) =>
      makeHistoricalGame(prediction),
    ),
    predictions,
    t2Snapshots: [makeT2(predictions[0])],
  })
  const options = { repository, seasonMetadata: SEASON_METADATA }
  const page = await getModelPerformanceGames(
    USER_ID,
    { limit: '1', page: '2', status: 'resolved' },
    options,
  )
  const missing = await getModelPerformanceGames(
    USER_ID,
    { status: 'missing_market' },
    options,
  )

  assert.equal(page.items.length, 1)
  assert.equal(page.pagination.totalItems, 3)
  assert.equal(page.pagination.totalPages, 3)
  assert.equal(page.pagination.hasNextPage, true)
  assert.equal(page.items[0].result.status, 'FINAL')
  assert.equal(Object.hasOwn(page.items[0], 'settingsFingerprint'), true)
  assert.equal(page.items[0].model.homeFairOdds, 1.25)
  assert.equal(page.items[0].model.state.home.baseRating, 52)
  assert.equal(Object.hasOwn(page.items[0].t2Market, 'bookmakers'), false)
  assert.equal(missing.pagination.totalItems, 3)
})

test('games expose only durable saved-bet audit values and exact same-book price checkpoints', async () => {
  const prediction = makePrediction(0)
  const t24 = {
    ...makeT2(prediction, [
      { awayOdds: 1.75, homeOdds: 2.3, key: 'pinnacle' },
    ]),
    capturedAt: new Date(+prediction.scheduledStartAtCapture - 24 * 60 * 60 * 1000),
    snapshotType: 'T24',
  }
  const t6 = {
    ...makeT2(prediction, [
      { awayOdds: 1.8, homeOdds: 2.2, key: 'pinnacle' },
    ]),
    capturedAt: new Date(+prediction.scheduledStartAtCapture - 6 * 60 * 60 * 1000),
    snapshotType: 'T6',
  }
  const t2 = makeT2(prediction, [
    { awayOdds: 1.85, homeOdds: 2.1, key: 'pinnacle' },
  ])
  const repository = createRepository({
    bets: [
      {
        _id: 'bet-1',
        bookmakerKey: 'pinnacle',
        bookmakerTitle: 'Pinnacle',
        createdAt: new Date(+prediction.scheduledStartAtCapture - 60 * 60 * 1000),
        expectedValue: 8.4,
        fairOdds: 1.94,
        gameId: prediction.gameId,
        marketOdds: 2.18,
        marketOddsSource: 'provider',
        modelProbability: 0.515,
        probabilityEdge: 0.0563,
        profit: 11.8,
        result: 'win',
        scheduledStart: prediction.scheduledStartAtCapture,
        selectedSide: { homeAway: 'home', teamId: 'BOS' },
        stake: 10,
        userId: USER_ID,
      },
    ],
    closings: [makeClosing(prediction)],
    historicalGames: [makeHistoricalGame(prediction)],
    predictions: [prediction],
    timelineSnapshots: [t24, t6, t2],
  })
  const result = await getModelPerformanceGames(USER_ID, {}, {
    repository,
    seasonMetadata: SEASON_METADATA,
  })
  const detail = result.items[0].betDetails[0]

  assert.equal(repository.calls.some(([name]) => name === 'findTimelineSnapshots'), true)
  assert.equal(repository.calls.some(([name]) => name === 'findT2Snapshots'), false)
  assert.equal(detail.modelAtBet.probability, 0.515)
  assert.equal(detail.modelAtBet.fairOdds, 1.94)
  assert.equal(detail.marketOdds, 2.18)
  assert.equal(detail.priceTimeline.earliestCaptured.odds, 2.3)
  assert.equal(detail.priceTimeline.earliestCaptured.snapshotType, 'T24')
  assert.equal(detail.priceTimeline.t6.odds, 2.2)
  assert.equal(detail.priceTimeline.t2.odds, 2.1)
  assert.equal(detail.priceTimeline.final.odds, 1.9)
  assert.equal(detail.closingComparison.sameBookFinalOdds, 1.9)
  assert.equal(detail.closingComparison.bestFinalOdds, 1.9)
  assert.equal(Object.hasOwn(detail, 'userId'), false)
})

test('capture health uses the authenticated prediction cohort and exact schedule range', async () => {
  const owned = makePrediction(0, { userId: USER_ID })
  const other = makePrediction(1, { userId: OTHER_USER_ID })
  const repository = createRepository({ predictions: [owned, other] })
  const result = await getModelPerformance(
    USER_ID,
    { season: SEASON.id },
    {
      captureHealthNow: new Date(+other.scheduledStartAtCapture - 74 * 60 * 1000),
      captureHealthScheduleProvider: async () => ({
        games: [
          {
            awayTeam: { abbreviation: 'COL' },
            gameId: owned.gameId,
            gameState: 'FUT',
            gameType: 2,
            homeTeam: { abbreviation: 'BOS' },
            season: SEASON.id,
            startTimeUTC: owned.scheduledStartAtCapture,
            status: 'Scheduled',
          },
          {
            awayTeam: { abbreviation: 'COL' },
            gameId: other.gameId,
            gameState: 'FUT',
            gameType: 2,
            homeTeam: { abbreviation: 'BOS' },
            season: SEASON.id,
            startTimeUTC: other.scheduledStartAtCapture,
            status: 'Scheduled',
          },
          {
            awayTeam: { abbreviation: 'COL' },
            gameId: '2026020999',
            gameState: 'FUT',
            gameType: 2,
            homeTeam: { abbreviation: 'BOS' },
            season: SEASON.id,
            startTimeUTC: '2027-08-01T19:00:00.000Z',
            status: 'Scheduled',
          },
        ],
        source: 'fixture',
        stale: false,
      }),
      repository,
      seasonMetadata: SEASON_METADATA,
    },
  )

  assert.equal(result.captureHealth.officialT2.expectedOfficialT2, 2)
  assert.equal(result.captureHealth.officialT2.capturedOfficialT2, 1)
  assert.equal(result.captureHealth.officialT2.missedOfficialT2, 1)
  assert.equal(Object.hasOwn(result.captureHealth, 'missingGames'), false)
})

test('games endpoint paginates compact missing-capture drill-down rows', async () => {
  const dueStart = STARTS[0]
  const repository = createRepository()
  const options = {
    captureHealthNow: new Date(
      new Date(dueStart).getTime() - 74 * 60 * 1000,
    ),
    captureHealthScheduleProvider: async () => ({
      games: [
        {
          awayTeam: { abbreviation: 'COL' },
          gameId: '2026020001',
          gameState: 'FUT',
          gameType: 2,
          homeTeam: { abbreviation: 'BOS' },
          season: SEASON.id,
          startTimeUTC: dueStart,
          status: 'Scheduled',
        },
      ],
      source: 'fixture',
      stale: false,
    }),
    repository,
    seasonMetadata: SEASON_METADATA,
  }
  const official = await getModelPerformanceGames(
    USER_ID,
    { status: 'missed_official_t2' },
    options,
  )
  const t24 = await getModelPerformanceGames(
    USER_ID,
    { status: 'missing_t24' },
    options,
  )

  assert.equal(official.pagination.totalItems, 1)
  assert.equal(official.items[0].captureCheckpoint, 'OFFICIAL_T2')
  assert.equal(official.items[0].reason, 'OFFICIAL_T2_CAPTURE_MISSED')
  assert.equal(t24.pagination.totalItems, 1)
  assert.equal(t24.items[0].captureCheckpoint, 'T24')
  assert.equal(Object.hasOwn(official.items[0], 'model'), false)
  assert.equal(Object.hasOwn(official.items[0], 'userId'), false)
})

test('invalid filters fail before repository access', async () => {
  const options = { seasonMetadata: SEASON_METADATA }

  await assert.rejects(
    () => normalizePerformanceQuery({ from: '2026-02-30' }, options),
    (error) => error instanceof ModelPerformanceError && error.statusCode === 400,
  )
  await assert.rejects(
    () =>
      normalizePerformanceQuery(
        { limit: '101', status: 'mystery' },
        options,
        { games: true },
      ),
    (error) => error.statusCode === 400,
  )
  await assert.rejects(
    () => normalizePerformanceQuery({ modelVersion: '$bad' }, options),
    (error) => error.statusCode === 400,
  )

  const playoffRange = await normalizePerformanceQuery(
    { from: '2027-06-01', to: '2027-06-30' },
    options,
  )
  assert.equal(playoffRange.start.toISOString(), '2027-06-01T00:00:00.000Z')
  assert.equal(
    playoffRange.endExclusive.toISOString(),
    '2027-07-01T00:00:00.000Z',
  )
})

test('repository filters bind owner identity and preserve scheduled-start date fallback', () => {
  const start = new Date('2026-10-01T00:00:00.000Z')
  const endExclusive = new Date('2027-07-16T00:00:00.000Z')
  const predictionFilter = buildPredictionFilter({
    endExclusive,
    modelVersion: 'power-rating-v1',
    predictionDefinition: 'OFFICIAL_T2_AUTOMATIC_V1',
    seasonId: SEASON.id,
    start,
    userId: USER_ID,
  })
  const betFilter = buildBetPeriodFilter({ endExclusive, start, userId: USER_ID })

  assert.equal(predictionFilter.userId, USER_ID)
  assert.equal(predictionFilter.modelVersion, 'power-rating-v1')
  assert.deepEqual(predictionFilter.scheduledStartAtCapture, {
    $gte: start,
    $lt: endExclusive,
  })
  assert.equal(betFilter.userId, USER_ID)
  assert.deepEqual(betFilter.$and[0].$or[0], {
    scheduledStart: { $gte: start, $lt: endExclusive },
  })
  assert.deepEqual(betFilter.$and[0].$or[1].$and[1], {
    analyzedAt: { $gte: start, $lt: endExclusive },
  })
})
