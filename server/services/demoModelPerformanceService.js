const { MODEL_PERFORMANCE_DATA_MODES } = require('../config/modelPerformanceDataModes')
const {
  CAPTURE_HEALTH_REASONS,
} = require('./modelPerformanceCaptureHealthService')
const modelPerformanceService = require('./modelPerformanceService')
const {
  DEMO_MODEL_PERFORMANCE_DATASET,
  DEMO_PERFORMANCE_CALCULATION_CONTRACT,
  DEMO_PERFORMANCE_DATASET_VERSION,
  DEMO_PERFORMANCE_MODEL_VERSION,
  DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  DEMO_PERFORMANCE_SEASON_METADATA,
  validateDemoSamplePrediction,
} = require('./demoModelPerformanceDataset')

const percentage = (numerator, denominator) =>
  denominator > 0 ? (numerator / denominator) * 100 : null

const inPeriod = (date, filter) => {
  const timestamp = new Date(date).getTime()

  return timestamp >= filter.start.getTime() &&
    timestamp < filter.endExclusive.getTime()
}

const matchingGameIds = (gameIds) => new Set(gameIds.map(String))

const demoModelPerformanceRepository = Object.freeze({
  async findBets(filter) {
    return DEMO_MODEL_PERFORMANCE_DATASET.bets.filter((bet) =>
      inPeriod(bet.scheduledStart, filter),
    )
  },

  async findClosingMarkets(gameIds) {
    const selected = matchingGameIds(gameIds)
    return DEMO_MODEL_PERFORMANCE_DATASET.closingMarkets.filter(({ gameId }) =>
      selected.has(String(gameId)),
    )
  },

  async findHistoricalGames(gameIds) {
    const selected = matchingGameIds(gameIds)
    return DEMO_MODEL_PERFORMANCE_DATASET.historicalGames.filter(({ gameId }) =>
      selected.has(String(gameId)),
    )
  },

  async findLatestModelVersion(filter) {
    const exists = DEMO_MODEL_PERFORMANCE_DATASET.predictions.some(
      (prediction) =>
        prediction.predictionDefinition === filter.predictionDefinition &&
        prediction.seasonId === filter.seasonId &&
        inPeriod(prediction.scheduledStartAtCapture, filter),
    )

    return exists ? DEMO_PERFORMANCE_MODEL_VERSION : null
  },

  async findModelVersions(filter) {
    return [
      ...new Set(
        DEMO_MODEL_PERFORMANCE_DATASET.predictions
          .filter(
            (prediction) =>
              prediction.predictionDefinition === filter.predictionDefinition &&
              prediction.seasonId === filter.seasonId &&
              inPeriod(prediction.scheduledStartAtCapture, filter),
          )
          .map(({ modelVersion }) => modelVersion),
      ),
    ]
  },

  async findPredictions(filter) {
    return DEMO_MODEL_PERFORMANCE_DATASET.predictions.filter(
      (prediction) =>
        prediction.modelVersion === filter.modelVersion &&
        prediction.predictionDefinition === filter.predictionDefinition &&
        prediction.seasonId === filter.seasonId &&
        inPeriod(prediction.scheduledStartAtCapture, filter),
    )
  },

  async findT2Snapshots(gameIds, seasonId) {
    const selected = matchingGameIds(gameIds)
    return DEMO_MODEL_PERFORMANCE_DATASET.timelineSnapshots.filter(
      (snapshot) =>
        selected.has(String(snapshot.gameId)) &&
        snapshot.seasonId === seasonId &&
        snapshot.snapshotType === 'T2',
    )
  },

  async findTimelineSnapshots(gameIds, seasonId) {
    const selected = matchingGameIds(gameIds)
    return DEMO_MODEL_PERFORMANCE_DATASET.timelineSnapshots.filter(
      (snapshot) =>
        selected.has(String(snapshot.gameId)) && snapshot.seasonId === seasonId,
    )
  },
})

const toMissingGame = (game, checkpoint, reason) => ({
  awayTeam: game.awayTeamId,
  awayTeamId: game.awayTeamId,
  captureCheckpoint: checkpoint,
  captureStatus: 'MISSED',
  checkpoint,
  gameId: game.gameId,
  homeTeam: game.homeTeamId,
  homeTeamId: game.homeTeamId,
  reason,
  scheduledStart: game.scheduledStart,
  season: DEMO_PERFORMANCE_SEASON_METADATA.currentSeasonId,
  seasonId: DEMO_PERFORMANCE_SEASON_METADATA.currentSeasonId,
  state: 'MISSED',
})

const buildCoverage = (expectedCount, missingCount) => {
  const capturedCount = Math.max(0, expectedCount - missingCount)

  return {
    capturedCount,
    coveragePercent: percentage(capturedCount, expectedCount),
    expectedCount,
    missingCount,
    status: missingCount > 0 ? 'GAPS' : expectedCount > 0 ? 'HEALTHY' : 'NOT_DUE',
  }
}

const buildDemoCaptureHealth = ({ normalized }) => {
  const games = DEMO_MODEL_PERFORMANCE_DATASET.games.filter((game) =>
    inPeriod(game.scheduledStart, normalized),
  )
  const snapshotsByTypeAndGame = new Set(
    DEMO_MODEL_PERFORMANCE_DATASET.timelineSnapshots.map(
      ({ gameId, snapshotType }) => `${snapshotType}|${gameId}`,
    ),
  )
  const closingIds = new Set(
    DEMO_MODEL_PERFORMANCE_DATASET.closingMarkets.map(({ gameId }) => gameId),
  )
  const missingOfficial = games.filter(({ index }) => index % 47 === 0)
  const missingByType = {
    FINAL: games.filter(({ gameId }) => !closingIds.has(gameId)),
    T2: games.filter(
      ({ gameId }) => !snapshotsByTypeAndGame.has(`T2|${gameId}`),
    ),
    T6: games.filter(
      ({ gameId }) => !snapshotsByTypeAndGame.has(`T6|${gameId}`),
    ),
    T24: games.filter(
      ({ gameId }) => !snapshotsByTypeAndGame.has(`T24|${gameId}`),
    ),
  }
  const expectedCount = games.length
  const officialCoverage = buildCoverage(expectedCount, missingOfficial.length)
  const officialT2 = {
    ...officialCoverage,
    capturedOfficialT2: officialCoverage.capturedCount,
    expectedOfficialT2: expectedCount,
    missedCount: missingOfficial.length,
    missedOfficialT2: missingOfficial.length,
    officialT2CoveragePercent: officialCoverage.coveragePercent,
  }
  const reasons = {
    FINAL: CAPTURE_HEALTH_REASONS.MISSING_FINAL_MARKET,
    T2: CAPTURE_HEALTH_REASONS.MISSING_T2_MARKET,
    T6: CAPTURE_HEALTH_REASONS.MISSING_T6_MARKET,
    T24: CAPTURE_HEALTH_REASONS.MISSING_T24_MARKET,
  }

  return {
    marketCheckpoints: Object.fromEntries(
      Object.entries(missingByType).map(([type, missing]) => [
        type,
        buildCoverage(expectedCount, missing.length),
      ]),
    ),
    missingGames: {
      ...Object.fromEntries(
        Object.entries(missingByType).map(([type, missing]) => [
          type,
          missing.map((game) => toMissingGame(game, type, reasons[type])),
        ]),
      ),
      officialT2: missingOfficial.map((game) =>
        toMissingGame(
          game,
          'OFFICIAL_T2',
          CAPTURE_HEALTH_REASONS.OFFICIAL_T2_CAPTURE_MISSED,
        ),
      ),
    },
    observedAt: new Date('2025-03-04T12:00:00.000Z'),
    officialT2,
    reason: null,
    schedule: { source: 'DEMO_SAMPLE_FIXTURE', stale: false },
    status: expectedCount > 0 ? 'GAPS' : 'NOT_DUE',
  }
}

const getOptions = () => ({
  calculationContractVersion: DEMO_PERFORMANCE_CALCULATION_CONTRACT,
  captureHealthProvider: buildDemoCaptureHealth,
  dataMode: MODEL_PERFORMANCE_DATA_MODES.DEMO_SAMPLE,
  datasetVersion: DEMO_PERFORMANCE_DATASET_VERSION,
  defaultModelVersion: DEMO_PERFORMANCE_MODEL_VERSION,
  gameProvider: async () => {
    throw new Error('Demo sample results must resolve from the in-memory fixture.')
  },
  predictionDefinition: DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  predictionValidator: validateDemoSamplePrediction,
  productionCaptureEligible: false,
  repository: demoModelPerformanceRepository,
  resultResolution: 'demo_fixture_exact_identity',
  seasonMetadata: DEMO_PERFORMANCE_SEASON_METADATA,
})

const getDemoModelPerformance = (userId, query = {}) =>
  modelPerformanceService.getModelPerformance(userId, query, getOptions())

const getDemoModelPerformanceGames = (userId, query = {}) =>
  modelPerformanceService.getModelPerformanceGames(userId, query, getOptions())

module.exports = {
  buildDemoCaptureHealth,
  demoModelPerformanceRepository,
  getDemoModelPerformance,
  getDemoModelPerformanceGames,
}
