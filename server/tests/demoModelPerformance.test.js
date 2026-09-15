process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEMO_MODEL_PERFORMANCE_DATASET,
  DEMO_PERFORMANCE_MODEL_VERSION,
  DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  DEMO_PERFORMANCE_SEASON_ID,
} = require('../services/demoModelPerformanceDataset')
const {
  getDemoModelPerformance,
  getDemoModelPerformanceGames,
} = require('../services/demoModelPerformanceService')

const OWNER_ID = '507f1f77bcf86cd799439011'
const closeTo = (actual, expected, tolerance = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}.`,
  )
}

test('shared demo observations are immutable, anonymous, and explicitly non-production', () => {
  assert.equal(Object.isFrozen(DEMO_MODEL_PERFORMANCE_DATASET), true)
  assert.equal(DEMO_MODEL_PERFORMANCE_DATASET.predictions.length, 150)
  assert.equal(DEMO_MODEL_PERFORMANCE_DATASET.historicalGames.length, 150)
  assert.equal(DEMO_MODEL_PERFORMANCE_DATASET.bets.length, 50)
  assert.equal(
    DEMO_MODEL_PERFORMANCE_DATASET.predictions.every(
      (prediction) =>
        prediction.predictionDefinition ===
          DEMO_PERFORMANCE_PREDICTION_DEFINITION &&
        prediction.predictionDefinition !== 'OFFICIAL_T2_AUTOMATIC_V1' &&
        !Object.hasOwn(prediction, 'userId'),
    ),
    true,
  )
})

test('demo performance derives stable V1 metrics from 150 underlying games', async () => {
  const result = await getDemoModelPerformance(OWNER_ID)

  assert.equal(result.dataMode, 'DEMO_SAMPLE')
  assert.equal(result.metadata.dataMode, 'DEMO_SAMPLE')
  assert.equal(result.metadata.datasetVersion, 1)
  assert.equal(result.metadata.modelVersion, DEMO_PERFORMANCE_MODEL_VERSION)
  assert.equal(
    result.metadata.predictionDefinition,
    DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  )
  assert.equal(result.metadata.officialPredictionCount, 150)
  assert.equal(result.coverage.forward.officialPredictions, 150)
  closeTo(result.forwardOverview.modelBrier.value, 0.21262500000000012)
  closeTo(result.marketComparison.final.marketBrier, 0.20880943730110985)
  closeTo(result.marketComparison.final.brierImprovement, 0.0030120235080062507)
  closeTo(result.marketComparison.t2.marketBrier, 0.21686048243368125)
  closeTo(result.marketComparison.t2.brierImprovement, 0.002787206571612161)
  closeTo(result.forwardOverview.accuracy.accuracyPercent, 67.33333333333333)
  assert.deepEqual(
    {
      away: result.marketComparison.movementTowardModel.awayCount,
      sample: result.marketComparison.movementTowardModel.sampleSize,
      toward: result.marketComparison.movementTowardModel.towardCount,
      unchanged: result.marketComparison.movementTowardModel.unchangedCount,
    },
    { away: 54, sample: 141, toward: 72, unchanged: 15 },
  )
  assert.equal(
    result.calibration.reduce((sum, bucket) => sum + bucket.sampleSize, 0),
    150,
  )
  assert.equal(result.calibration.every(({ sampleSize }) => sampleSize > 0), true)
  assert.deepEqual(
    {
      losses: result.betPerformance.losses,
      pending: result.betPerformance.pendingBets,
      profit: result.betPerformance.profit,
      pushes: result.betPerformance.pushes,
      settled: result.betPerformance.settledBets,
      voids: result.betPerformance.voids,
      wins: result.betPerformance.wins,
    },
    {
      losses: 12,
      pending: 3,
      profit: -8.019999999999996,
      pushes: 3,
      settled: 47,
      voids: 2,
      wins: 30,
    },
  )
  closeTo(result.betPerformance.roiPercent, -1.5664062499999991)
  assert.equal(result.clv.eligibleBetCount, 31)
  closeTo(result.clv.coveragePercent, 62)
  closeTo(result.clv.averageClvPercent, -0.1490759162371696)
  assert.ok(result.clv.positiveClvCount > 0)
  assert.ok(result.clv.negativeClvCount > 0)
  assert.equal(result.captureHealth.officialT2.capturedCount, 146)
  assert.equal(result.captureHealth.marketCheckpoints.T24.capturedCount, 138)
  assert.equal(result.captureHealth.marketCheckpoints.T6.capturedCount, 142)
  assert.equal(result.captureHealth.marketCheckpoints.T2.capturedCount, 145)
  assert.equal(result.captureHealth.marketCheckpoints.FINAL.capturedCount, 145)
})

test('demo date/version filters, pagination, details, and capture gaps use real endpoint semantics', async () => {
  const filtered = await getDemoModelPerformance(OWNER_ID, {
    from: '2024-10-05',
    modelVersion: DEMO_PERFORMANCE_MODEL_VERSION,
    season: DEMO_PERFORMANCE_SEASON_ID,
    to: '2024-10-14',
  })
  const emptyVersion = await getDemoModelPerformance(OWNER_ID, {
    modelVersion: 'DEMO_SAMPLE_UNKNOWN',
    season: DEMO_PERFORMANCE_SEASON_ID,
  })
  const page = await getDemoModelPerformanceGames(OWNER_ID, {
    limit: '20',
    page: '1',
    season: DEMO_PERFORMANCE_SEASON_ID,
  })
  const gaps = await getDemoModelPerformanceGames(OWNER_ID, {
    captureHealth: 'finalMissing',
    limit: '20',
    season: DEMO_PERFORMANCE_SEASON_ID,
  })

  assert.equal(filtered.metadata.officialPredictionCount, 10)
  assert.equal(emptyVersion.metadata.officialPredictionCount, 0)
  assert.equal(emptyVersion.dataMode, 'DEMO_SAMPLE')
  assert.deepEqual(page.pagination, {
    hasNextPage: true,
    hasPreviousPage: false,
    page: 1,
    pageSize: 20,
    totalItems: 150,
    totalPages: 8,
  })
  assert.equal(page.items[0].betDetails.length, 1)
  assert.equal(page.items[0].betDetails[0].priceTimeline.bet !== null, true)
  assert.equal(page.items[11].betDetails[0].priceTimeline.t6 !== null, true)
  assert.equal(gaps.pagination.totalItems, 5)
  assert.equal(gaps.items.every(({ checkpoint }) => checkpoint === 'FINAL'), true)
})
