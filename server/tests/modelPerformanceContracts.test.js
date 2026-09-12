process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const { CLOSING_SAFETY_REASON } = require('../services/oddsClosingMarketContracts')
const {
  CALIBRATION_BUCKETS,
  PERFORMANCE_REASON_CODES,
  calculateAccuracy,
  calculateBetClv,
  calculateBetPerformance,
  calculateBrier,
  calculateCalibration,
  calculateMarketMovement,
  calculateNoVigConsensus,
  calculatePairedBrier,
  summarizeClv,
  validateOfficialPrediction,
} = require('../services/modelPerformanceContracts')

test('official prediction validation exposes model-version and post-start failures', () => {
  const scheduledStartAtCapture = new Date('2026-10-08T19:00:00.000Z')
  const valid = {
    awayTeamId: 'COL',
    awayWinProbability: 0.4,
    calculationContractVersion: 'automatic-prediction-v1',
    gameId: '2026020001',
    gameType: 2,
    generatedAt: new Date('2026-10-08T17:30:00.000Z'),
    homeTeamId: 'BOS',
    homeWinProbability: 0.6,
    modelVersion: 'power-rating-v1',
    predictionDefinition: 'OFFICIAL_T2_AUTOMATIC_V1',
    scheduledStartAtCapture,
    seasonId: '20262027',
    settingsFingerprint: 'a'.repeat(64),
    targetAt: new Date('2026-10-08T17:00:00.000Z'),
  }

  assert.equal(validateOfficialPrediction(valid), null)
  assert.equal(
    validateOfficialPrediction({ ...valid, modelVersion: '' }),
    PERFORMANCE_REASON_CODES.MODEL_VERSION_MISSING,
  )
  assert.equal(
    validateOfficialPrediction({
      ...valid,
      generatedAt: new Date(+scheduledStartAtCapture + 1),
    }),
    PERFORMANCE_REASON_CODES.PREDICTION_AFTER_START,
  )
})

test('Brier uses one home-win observation per game and excludes missing results', () => {
  const metric = calculateBrier(
    [
      { outcome: 1, probability: 0.8 },
      { outcome: 0, probability: 0.3 },
    ],
    3,
  )

  assert.ok(Math.abs(metric.value - 0.065) < 1e-15)
  assert.equal(metric.sampleSize, 2)
  assert.equal(metric.eligibleCount, 2)
  assert.equal(metric.excludedCount, 1)
})

test('accuracy counts favorite wins/losses and excludes exact 50/50 as NO_PICK', () => {
  const metric = calculateAccuracy([
    { homeProbability: 0.7, homeWon: true },
    { homeProbability: 0.4, homeWon: true },
    { homeProbability: 0.5, homeWon: false },
  ])

  assert.deepEqual(metric, {
    accuracyPercent: 50,
    correctCount: 1,
    incorrectCount: 1,
    noPickCount: 1,
    sampleSize: 2,
    status: 'available',
  })
})

test('calibration fixed boundaries are non-overlapping and retain empty buckets', () => {
  const boundaries = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 1]
  const calibration = calculateCalibration(
    boundaries.map((homeProbability) => ({ homeProbability, homeWon: true })),
  )

  assert.deepEqual(
    calibration.map(({ sampleSize }) => sampleSize),
    [1, 1, 1, 1, 1, 1, 2],
  )
  assert.deepEqual(
    calibration.map(({ lowerBound, upperBound, upperInclusive }) => ({
      lowerBound,
      upperBound,
      upperInclusive,
    })),
    CALIBRATION_BUCKETS,
  )
  assert.equal(calibration[0].averagePredictedProbability, 0.5)
  assert.equal(calibration[0].actualWinRate, 1)
  assert.equal(calibration[0].calibrationGapPercentagePoints, 50)

  const empty = calculateCalibration([])
  assert.equal(empty.length, 7)
  assert.equal(empty[0].averagePredictedProbability, null)
  assert.equal(empty[0].actualWinRate, null)
  assert.equal(empty[0].status, 'unavailable')
})

test('no-vig consensus normalizes each complete bookmaker then takes the median', () => {
  const single = calculateNoVigConsensus([
    { awayOdds: 2.2, homeOdds: 1.8, key: 'pinnacle' },
  ])
  const expected = (1 / 1.8) / (1 / 1.8 + 1 / 2.2)

  assert.equal(single.homeProbability, expected)
  assert.equal(single.awayProbability, 1 - expected)
  assert.equal(single.bookmakerCount, 1)

  const multiple = calculateNoVigConsensus([
    { awayOdds: 2.5, homeOdds: 1.5, key: 'coolbet' },
    { awayOdds: 2, homeOdds: 2, key: 'pinnacle' },
    { awayOdds: 1.5, homeOdds: 2.5, key: 'unibet_fi' },
  ])
  assert.equal(multiple.homeProbability, 0.5)
  assert.equal(multiple.bookmakerCount, 3)
})

test('no-vig consensus rejects missing opposing sides and invalid decimal odds', () => {
  const result = calculateNoVigConsensus([
    { homeOdds: 2, key: 'coolbet' },
    { awayOdds: 2, homeOdds: 1, key: 'pinnacle' },
  ])

  assert.equal(result.homeProbability, null)
  assert.equal(result.bookmakerCount, 0)
  assert.equal(
    result.reason,
    PERFORMANCE_REASON_CODES.INCOMPLETE_TWO_SIDED_ODDS,
  )
})

test('paired Brier never mixes a larger raw model population into market comparison', () => {
  const comparison = calculatePairedBrier({
    marketCoverageCount: 1,
    observations: [
      {
        bookmakerCount: 2,
        marketProbability: 0.6,
        modelProbability: 0.8,
        outcome: 1,
      },
      {
        bookmakerCount: 0,
        marketProbability: null,
        modelProbability: 0.1,
        outcome: 0,
      },
    ],
    resolvedCount: 2,
  })

  assert.equal(comparison.pairedSampleSize, 1)
  assert.ok(Math.abs(comparison.pairedModelBrier - 0.04) < 1e-15)
  assert.ok(Math.abs(comparison.marketBrier - 0.16) < 1e-15)
  assert.ok(Math.abs(comparison.brierImprovement - 0.12) < 1e-15)
  assert.equal(comparison.excludedResolvedCount, 1)
})

test('market movement classifies toward, away and tolerance-equivalent observations', () => {
  const metric = calculateMarketMovement([
    { finalProbability: 0.68, modelProbability: 0.7, t2Probability: 0.6 },
    { finalProbability: 0.5, modelProbability: 0.7, t2Probability: 0.6 },
    {
      finalProbability: 0.6000000000005,
      modelProbability: 0.7,
      t2Probability: 0.6,
    },
  ])

  assert.equal(metric.towardCount, 1)
  assert.equal(metric.awayCount, 1)
  assert.equal(metric.unchangedCount, 1)
  assert.equal(metric.sampleSize, 3)
  assert.ok(metric.averageDistanceAtT2PercentagePoints > 9.99)
  assert.ok(metric.averageDistanceAtFinalPercentagePoints > 10.66)
  assert.ok(metric.averageDistanceChangePercentagePoints > 0)
})

test('bet performance uses stored profit and settled-stake ROI including push and void stakes', () => {
  const performance = calculateBetPerformance([
    { marketOdds: 2, profit: 7, result: 'win', stake: 10 },
    { marketOdds: 3, profit: -5, result: 'loss', stake: 5 },
    { marketOdds: 1.9, profit: 0, result: 'push', stake: 4 },
    { marketOdds: 2.2, profit: 0, result: 'void', stake: 6 },
    { marketOdds: 9, profit: 99, result: 'pending', stake: 100 },
  ])

  assert.equal(performance.totalRelevantBets, 5)
  assert.equal(performance.settledBets, 4)
  assert.equal(performance.wins, 1)
  assert.equal(performance.losses, 1)
  assert.equal(performance.pushes, 1)
  assert.equal(performance.voids, 1)
  assert.equal(performance.pendingBets, 1)
  assert.equal(performance.totalStake, 25)
  assert.equal(performance.profit, 2)
  assert.equal(performance.roiPercent, 8)

  const empty = calculateBetPerformance([])
  assert.equal(empty.roiPercent, null)
  assert.equal(empty.profit, null)
  assert.equal(empty.totalStake, null)
})

const START = '2026-10-08T19:00:00.000Z'
const makeClosingMarket = (overrides = {}) => ({
  bestFinal: {
    away: null,
    home: {
      bookmakerKey: 'coolbet',
      observedAt: '2026-10-08T18:55:00.000Z',
      odds: 2.05,
    },
  },
  finalBookmakers: [
    {
      awayOdds: 1.8,
      homeOdds: 2.05,
      key: 'coolbet',
      observedAt: '2026-10-08T18:55:00.000Z',
      providerCommenceTime: START,
      safetyReason: CLOSING_SAFETY_REASON,
    },
    {
      awayOdds: 1.85,
      homeOdds: 2,
      key: 'pinnacle',
      observedAt: '2026-10-08T18:54:00.000Z',
      providerCommenceTime: START,
      safetyReason: CLOSING_SAFETY_REASON,
    },
  ],
  finalizedAt: '2026-10-08T19:01:00.000Z',
  gameId: '2026020001',
  homeTeamId: 'BOS',
  awayTeamId: 'COL',
  scheduledStartAtCapture: START,
  ...overrides,
})
const makeBet = (overrides = {}) => ({
  bookmakerKey: 'coolbet',
  createdAt: '2026-10-08T18:00:00.000Z',
  gameId: '2026020001',
  marketOdds: 2.1,
  marketOddsSource: 'provider',
  scheduledStart: START,
  selectedSide: { homeAway: 'home', teamId: 'BOS' },
  ...overrides,
})

test('strict same-book CLV returns positive, negative and zero odds-ratio observations', () => {
  const closing = makeClosingMarket()
  const positive = calculateBetClv(makeBet(), closing)
  const negative = calculateBetClv(makeBet({ marketOdds: 2 }), closing)
  const zero = calculateBetClv(makeBet({ marketOdds: 2.05 }), closing)
  const summary = summarizeClv([positive, negative, zero], 3)

  assert.ok(positive.clvPercent > 0)
  assert.ok(negative.clvPercent < 0)
  assert.equal(zero.clvPercent, 0)
  assert.equal(summary.positiveClvCount, 1)
  assert.equal(summary.negativeClvCount, 1)
  assert.equal(summary.zeroClvCount, 1)
  assert.equal(summary.eligibleBetCount, 3)
  assert.equal(summary.coveragePercent, 100)
  assert.equal(summary.vsBestFinal.label, 'vs Best FINAL')
  assert.equal(positive.bestFinalOdds, 2.05)
  assert.equal(positive.finalObservedAt, '2026-10-08T18:55:00.000Z')
})

test('strict CLV rejects manual/unknown/missing same-book, stale, post-start and rescheduled links', () => {
  const closing = makeClosingMarket()
  const cases = [
    [
      makeBet({ marketOddsSource: 'manual' }),
      closing,
      PERFORMANCE_REASON_CODES.MANUAL_ODDS,
    ],
    [
      makeBet({ bookmakerKey: 'some free text' }),
      closing,
      PERFORMANCE_REASON_CODES.UNKNOWN_BOOKMAKER,
    ],
    [
      makeBet({ bookmakerKey: 'unibet_fi' }),
      closing,
      PERFORMANCE_REASON_CODES.NO_LATER_SAME_BOOK_FINAL,
    ],
    [
      makeBet({ selectedSide: { homeAway: 'home', teamId: 'COL' } }),
      closing,
      PERFORMANCE_REASON_CODES.INVALID_BET_SIDE,
    ],
    [
      makeBet({ createdAt: '2026-10-08T18:56:00.000Z' }),
      closing,
      PERFORMANCE_REASON_CODES.NO_LATER_SAME_BOOK_FINAL,
    ],
    [
      makeBet({ createdAt: START }),
      closing,
      PERFORMANCE_REASON_CODES.BET_AFTER_START,
    ],
    [
      makeBet({ scheduledStart: '2026-10-08T20:00:00.000Z' }),
      closing,
      PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH,
    ],
  ]

  cases.forEach(([bet, market, reason]) => {
    const result = calculateBetClv(bet, market)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.reason, reason)
  })

  const noSameBook = calculateBetClv(
    makeBet({ bookmakerKey: 'unibet_fi' }),
    closing,
  )
  assert.equal(noSameBook.clvPercent, null)
  assert.equal(noSameBook.vsBestFinalPercent, null)
})
