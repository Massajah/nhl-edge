import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let ModelPerformance
let modelPerformanceApi
let modelPerformanceUtils
let vite

const calibration = [
  [0.5, 0.55, 4, 0.526, 0.5],
  [0.55, 0.6, 12, 0.574, 0.583],
  [0.6, 0.65, 28, 0.623, 0.643],
  [0.65, 0.7, 31, 0.674, 0.677],
  [0.7, 0.75, 22, 0.724, 0.727],
  [0.75, 0.8, 0, null, null],
  [0.8, 1, 7, 0.836, 0.714],
].map(([lowerBound, upperBound, sampleSize, predicted, actual], index) => ({
  actualWinRate: actual,
  averagePredictedProbability: predicted,
  calibrationGapPercentagePoints:
    actual == null ? null : (actual - predicted) * 100,
  lowerBound,
  sampleSize,
  status: sampleSize ? 'available' : 'unavailable',
  upperBound,
  upperInclusive: index === 6,
}))

const checkpointCoverage = (
  capturedCount,
  expectedCount,
  status = capturedCount === expectedCount ? 'CAPTURED' : 'MISSED',
) => ({
  capturedCount,
  coveragePercent:
    expectedCount > 0 ? (capturedCount / expectedCount) * 100 : null,
  expectedCount,
  missingCount: expectedCount - capturedCount,
  status,
})

const captureHealthFixture = (overrides = {}) => ({
  marketCheckpoints: {
    FINAL: checkpointCoverage(401, 401),
    T2: checkpointCoverage(405, 405),
    T6: checkpointCoverage(404, 404),
    T24: checkpointCoverage(400, 400),
  },
  observedAt: '2026-10-09T00:00:00.000Z',
  officialT2: {
    capturedOfficialT2: 412,
    expectedOfficialT2: 412,
    missedOfficialT2: 0,
    officialT2CoveragePercent: 100,
    status: 'CAPTURED',
  },
  reason: null,
  schedule: { source: 'fixture', stale: false },
  status: 'CAPTURED',
  ...overrides,
})

const aggregateFixture = (overrides = {}) => ({
  betPerformance: {
    averageDecimalOdds: 2.08,
    losses: 13,
    pendingBets: 3,
    profit: 12.4,
    pushes: 2,
    reasons: [],
    roiPercent: 6.2,
    settledBets: 34,
    status: 'available',
    totalRelevantBets: 37,
    totalStake: 200,
    voids: 1,
    wins: 18,
  },
  calibration,
  clv: {
    averageClvPercent: 4.2,
    coveragePercent: 72.97,
    eligibleBetCount: 27,
    medianClvPercent: 3.6,
    negativeClvCount: 8,
    positiveClvCount: 18,
    reasons: ['MANUAL_ODDS'],
    status: 'available',
    unavailableBetCount: 10,
    vsBestFinal: {
      averagePercent: 1.4,
      eligibleBetCount: 20,
      label: 'vs Best FINAL',
      medianPercent: 1.1,
      status: 'available',
    },
    zeroClvCount: 1,
  },
  cohortDefinition: {
    modelVersion: 'power-rating-v1',
    predictionDefinition: 'OFFICIAL_T2_AUTOMATIC_V1',
  },
  captureHealth: captureHealthFixture(),
  coverage: {
    bets: {
      betsWithRecognizedBookmaker: 31,
      clvCoveragePercent: 72.97,
      sameBookClvEligibleBets: 27,
      settledBets: 34,
      totalRelevantBets: 37,
    },
    forward: {
      finalMarketCoveragePercent: 94.8,
      officialPredictions: 412,
      resolvedPredictions: 405,
      resultCoveragePercent: 98.3,
      t2MarketCoveragePercent: 96.4,
      validFinalMarkets: 389,
      validFinalResults: 405,
      validT2AndFinalMarkets: 381,
      validT2Markets: 397,
    },
  },
  dataQuality: {
    bets: {
      reasonCounts: { MANUAL_ODDS: 4 },
      reasons: ['MANUAL_ODDS'],
    },
    forward: {
      reasonCounts: { MISSING_FINAL_MARKET: 16, RESULT_PENDING: 7 },
      reasons: ['MISSING_FINAL_MARKET', 'RESULT_PENDING'],
    },
    reasonCounts: { MANUAL_ODDS: 4, MISSING_FINAL_MARKET: 16, RESULT_PENDING: 7 },
    reasons: ['MANUAL_ODDS', 'MISSING_FINAL_MARKET', 'RESULT_PENDING'],
    status: 'partial',
  },
  forwardOverview: {
    accuracy: {
      accuracyPercent: 61.2,
      correctCount: 245,
      incorrectCount: 155,
      noPickCount: 5,
      sampleSize: 400,
      status: 'available',
    },
    modelBrier: {
      eligibleCount: 405,
      excludedCount: 7,
      reasons: ['RESULT_PENDING'],
      sampleSize: 405,
      status: 'available',
      value: 0.184,
    },
  },
  marketComparison: {
    final: {
      brierImprovement: 0.011,
      finalMarketBrier: 0.195,
      marketBrier: 0.195,
      marketCoverageCount: 389,
      pairedModelBrier: 0.184,
      pairedSampleSize: 382,
      status: 'available',
    },
    movementTowardModel: {
      averageDistanceAtFinalPercentagePoints: 3.6,
      averageDistanceAtT2PercentagePoints: 4.8,
      averageDistanceChangePercentagePoints: -1.2,
      awayCount: 45,
      sampleSize: 136,
      status: 'available',
      towardCount: 84,
      towardPercent: 61.8,
      unchangedCount: 7,
    },
    t2: {
      brierImprovement: 0.006,
      marketBrier: 0.201,
      marketCoverageCount: 397,
      pairedModelBrier: 0.195,
      pairedSampleSize: 390,
      status: 'available',
    },
  },
  metadata: {
    availableModelVersions: ['power-rating-v1', 'power-rating-v2'],
    availableSeasons: [
      {
        endDate: '2027-04-30',
        id: '20262027',
        isCurrent: true,
        label: '2026–27',
        startDate: '2026-10-01',
      },
      {
        endDate: '2026-04-30',
        id: '20252026',
        isCurrent: false,
        label: '2025–26',
        startDate: '2025-10-01',
      },
    ],
    mixedSettings: true,
    modelVersion: 'power-rating-v1',
    officialPredictionCount: 412,
    predictionDefinition: 'OFFICIAL_T2_AUTOMATIC_V1',
    season: { id: '20262027', label: '2026–27' },
    settingsFingerprintCount: 2,
  },
  ...overrides,
})

const gameFixture = (overrides = {}) => ({
  awayTeamId: 'COL',
  betDetails: [
    {
      bookmaker: { key: 'pinnacle', name: 'Pinnacle', source: 'provider' },
      closingComparison: {
        bestFinalOdds: 2.05,
        clvPercent: 7.92,
        reason: null,
        sameBookFinalOdds: 2.02,
        status: 'available',
        vsBestFinalPercent: 6.34,
      },
      createdAt: '2026-10-08T18:00:00.000Z',
      expectedValuePercent: 12.3,
      id: 'bet-1',
      marketOdds: 2.18,
      modelAtBet: {
        fairOdds: 1.94,
        probability: 0.515,
        probabilityEdge: 0.0563,
      },
      priceTimeline: {
        bet: { observedAt: '2026-10-08T18:00:00.000Z', odds: 2.18 },
        earliestCaptured: {
          observedAt: '2026-10-07T19:00:00.000Z',
          odds: 2.3,
          snapshotType: 'T24',
        },
        final: { observedAt: '2026-10-08T18:55:00.000Z', odds: 2.02 },
        t2: { observedAt: '2026-10-08T17:00:00.000Z', odds: 2.14, snapshotType: 'T2' },
        t6: { observedAt: '2026-10-08T13:00:00.000Z', odds: 2.2, snapshotType: 'T6' },
      },
      profit: 11.8,
      result: 'win',
      selectedSide: { homeAway: 'home', teamId: 'BOS' },
      stake: 10,
    },
  ],
  bets: {
    averageSameBookClvPercent: 7.92,
    betCount: 1,
    profit: 11.8,
    sameBookClvEligibleCount: 1,
    sameBookClvReasons: [],
    settledCount: 1,
  },
  completeness: {
    goalies: { away: 'AVAILABLE', home: 'AVAILABLE' },
    injuries: { away: 'STORED_USER_DATA', home: 'STORED_USER_DATA' },
    ratings: 'AVAILABLE',
    schedule: { away: 'AVAILABLE', home: 'AVAILABLE' },
    specialTeams: { away: 'AVAILABLE', home: 'AVAILABLE' },
  },
  finalMarket: {
    bookmakerCount: 4,
    homeProbability: 0.552,
    reason: null,
    status: 'available',
  },
  gameId: '2026020001',
  generatedAt: '2026-10-08T17:30:00.000Z',
  homeTeamId: 'BOS',
  marketDistance: {
    changePercentagePoints: -1.2,
    finalPercentagePoints: 2.1,
    movement: 'TOWARD_MODEL',
    t2PercentagePoints: 3.3,
  },
  model: {
    adjustments: {
      away: { goalie: 0, homeAdvantage: 0, injuries: -0.5, quickRematch: 0, ratingAdjustment: 0, restFatigue: 0, specialTeams: 0.25 },
      home: { goalie: 0.5, homeAdvantage: 3.5, injuries: 0, quickRematch: 0.5, ratingAdjustment: 0, restFatigue: -1, specialTeams: 0 },
    },
    awayFairOdds: 2.58,
    awayWinProbability: 0.388,
    homeFairOdds: 1.63,
    homeWinProbability: 0.612,
    pick: 'home',
    state: {
      away: { baseRating: 51, effectiveRating: 50.75 },
      home: { baseRating: 52, effectiveRating: 55.5 },
    },
  },
  modelVersion: 'power-rating-v1',
  reasons: [],
  result: {
    awayScore: 2,
    homeScore: 3,
    homeWon: true,
    reason: null,
    resultType: 'OVERTIME',
    source: 'HistoricalNhlGame',
    status: 'FINAL',
  },
  scheduledStart: '2026-10-08T19:00:00.000Z',
  settingsFingerprint: 'a'.repeat(64),
  status: 'RESOLVED',
  t2Market: {
    bookmakerCount: 5,
    homeProbability: 0.579,
    reason: null,
    status: 'available',
  },
  ...overrides,
})

const gamesFixture = (items = [gameFixture()]) => ({
  filters: {
    limit: 20,
    modelVersion: 'power-rating-v1',
    page: 1,
    season: '20262027',
    status: 'all',
  },
  items,
  pagination: {
    hasNextPage: true,
    hasPreviousPage: false,
    page: 1,
    pageSize: 20,
    totalItems: 21,
    totalPages: 2,
  },
})

const captureGapGamesFixture = () => ({
  captureHealth: captureHealthFixture(),
  filters: {
    limit: 20,
    modelVersion: 'power-rating-v1',
    page: 1,
    season: '20262027',
    status: 'missing_t24',
  },
  items: [
    {
      awayTeamId: 'COL',
      captureCheckpoint: 'T24',
      captureStatus: 'MISSED',
      gameId: '2026020001',
      homeTeamId: 'BOS',
      reason: 'MISSING_T24_MARKET',
      scheduledStart: '2026-10-08T19:00:00.000Z',
      seasonId: '20262027',
    },
  ],
  pagination: {
    hasNextPage: false,
    hasPreviousPage: false,
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  },
})

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })

  ModelPerformance = (
    await vite.ssrLoadModule('/src/components/ModelPerformance.jsx')
  ).default
  modelPerformanceApi = await vite.ssrLoadModule(
    '/src/services/modelPerformanceApi.js',
  )
  modelPerformanceUtils = await vite.ssrLoadModule(
    '/src/utils/modelPerformance.js',
  )
})

after(async () => {
  await vite?.close()
})

const renderPerformance = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(ModelPerformance, {
      initialAggregate: aggregateFixture(),
      initialAggregateStatus: 'success',
      ...props,
    }),
  )

test('Model Performance route sits between Power Ratings and Rating Lab', async () => {
  const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8')
  const ratings = appSource.indexOf('label: "Power Ratings"')
  const performance = appSource.indexOf('label: "Model Performance"')
  const lab = appSource.indexOf('label: "Rating Lab"')

  assert.ok(ratings >= 0 && ratings < performance && performance < lab)
  assert.match(appSource, /path: "\/model-performance"/)
  assert.match(appSource, /activePage === "model-performance"[\s\S]*<ModelPerformance/)
  assert.match(appSource, /path: "\/rating-lab"/)
})

test('global filters render season, date range, model version, apply and reset', () => {
  const html = renderPerformance()

  assert.match(html, /id="model-performance-season"/)
  assert.match(html, /2026–27 · Current/)
  assert.match(html, /2025–26/)
  assert.match(html, /id="model-performance-from"/)
  assert.match(html, /id="model-performance-to"/)
  assert.match(html, /id="model-performance-version"/)
  assert.match(html, /power-rating-v2/)
  assert.match(html, />Apply<\/button>/)
  assert.match(html, />Reset<\/button>/)
})

test('API query builders send only supported filters and no user identity', async () => {
  const originalFetch = globalThis.fetch
  const requests = []

  globalThis.fetch = async (url) => {
    requests.push(url)
    return new Response(JSON.stringify({ metadata: {}, items: [] }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await modelPerformanceApi.fetchModelPerformance({
      from: '2026-10-01',
      modelVersion: 'power-rating-v1',
      season: '20262027',
      to: '2026-11-01',
      userId: 'attacker',
    })
    await modelPerformanceApi.fetchModelPerformanceGames({
      limit: 20,
      page: 2,
      season: '20262027',
      status: 'missing_t24',
      userId: 'attacker',
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(
    requests[0],
    '/api/model-performance?season=20262027&from=2026-10-01&to=2026-11-01&modelVersion=power-rating-v1',
  )
  assert.equal(
    requests[1],
    '/api/model-performance/games?season=20262027&status=missing_t24&page=2&limit=20',
  )
  assert.equal(requests.some((url) => url.includes('userId')), false)
})

test('filter defaults reset to server-selected current cohort', () => {
  assert.deepEqual(modelPerformanceUtils.createModelPerformanceFilters(), {
    from: '',
    modelVersion: '',
    season: '',
    to: '',
  })
  assert.equal(modelPerformanceUtils.buildModelPerformanceQueryString({}), '')
})

test('Forward Model presents the concise primary and secondary metrics', () => {
  const html = renderPerformance()

  assert.match(html, /Model Brier/)
  assert.match(html, />0\.184</)
  assert.match(html, /FINAL Market Brier/)
  assert.match(html, />0\.195</)
  assert.match(html, /Brier Improvement vs FINAL/)
  assert.match(html, />\+0\.011</)
  assert.match(html, /Accuracy/)
  assert.match(html, />61\.2%</)
  assert.match(html, /T2 Market Brier/)
  assert.match(html, /Brier Improvement vs T2/)
  assert.match(html, /Market moved toward model/)
  assert.match(html, />61\.8%</)
  assert.match(html, /84 toward · 45 away · 7 unchanged/)
  assert.match(html, /directional diagnostic only/)
})

test('all sample-size states have neutral explicit labels', () => {
  assert.deepEqual(
    [0, 1, 9, 10, 49, 50, 199, 200].map(
      (sample) => modelPerformanceUtils.getSampleState(sample).id,
    ),
    ['empty', 'exploratory', 'exploratory', 'very-small', 'very-small', 'developing', 'developing', 'normal'],
  )
  assert.equal(modelPerformanceUtils.getMetricTone(5, 49), 'neutral')
  assert.equal(modelPerformanceUtils.getMetricTone(5, 50), 'positive')
})

test('calibration keeps all fixed buckets and distinguishes sparse/cautious points', () => {
  const html = renderPerformance()

  for (const label of ['50–55%', '55–60%', '60–65%', '65–70%', '70–75%', '75–80%', '80–100%']) {
    assert.match(html, new RegExp(label))
  }
  assert.match(html, /class="calibration-point sparse"/)
  assert.match(html, /class="calibration-point cautious"/)
  assert.match(html, /class="calibration-point normal"/)
  assert.match(html, /class="calibration-perfect-line"/)
  assert.match(html, /n&lt;10/)
  assert.match(html, /<td>—<\/td>/)
})

test('coverage uses backend counts and presents missing coverage neutrally', () => {
  const html = renderPerformance()

  assert.match(html, /Official T2 captures/)
  assert.match(html, />412 \/ 412</)
  assert.match(html, /100\.0% · 0 missed/)
  assert.match(html, /405 \/ 412/)
  assert.match(html, /397 \/ 412/)
  assert.match(html, /389 \/ 412/)
  assert.match(html, /27 \/ 37 bets/)
  assert.match(html, /Market checkpoint coverage/)
  assert.match(html, />400 \/ 400</)
  assert.match(html, />404 \/ 404</)
  assert.match(html, />405 \/ 405</)
  assert.match(html, />401 \/ 401</)
  assert.match(html, /Capture health OK/)
  assert.match(html, /Missing coverage is informational and is not treated as model failure/)
  assert.match(html, /Multiple model settings configurations exist in this cohort/)
})

test('not-due and unavailable capture health render without false failures', () => {
  const notDueCoverage = checkpointCoverage(0, 0, 'NOT_DUE')
  const notDue = captureHealthFixture({
    marketCheckpoints: {
      FINAL: notDueCoverage,
      T2: notDueCoverage,
      T6: notDueCoverage,
      T24: notDueCoverage,
    },
    officialT2: {
      capturedOfficialT2: 0,
      expectedOfficialT2: 0,
      missedOfficialT2: 0,
      officialT2CoveragePercent: null,
      status: 'NOT_DUE',
    },
    status: 'NOT_DUE',
  })
  const unavailableCoverage = {
    capturedCount: null,
    coveragePercent: null,
    expectedCount: null,
    missingCount: null,
    status: 'UNAVAILABLE',
  }
  const unavailable = captureHealthFixture({
    marketCheckpoints: {
      FINAL: unavailableCoverage,
      T2: unavailableCoverage,
      T6: unavailableCoverage,
      T24: unavailableCoverage,
    },
    officialT2: {
      capturedOfficialT2: null,
      expectedOfficialT2: null,
      missedOfficialT2: null,
      officialT2CoveragePercent: null,
      status: 'UNAVAILABLE',
    },
    reason: 'SCHEDULE_UNAVAILABLE',
    status: 'UNAVAILABLE',
  })
  const notDueHtml = renderPerformance({
    initialAggregate: aggregateFixture({ captureHealth: notDue }),
  })
  const unavailableHtml = renderPerformance({
    initialAggregate: aggregateFixture({ captureHealth: unavailable }),
  })

  assert.match(notDueHtml, /No checkpoints due yet/)
  assert.equal((notDueHtml.match(/>Not due</g) ?? []).length, 4)
  assert.doesNotMatch(notDueHtml, /capture-health-item missed/)
  assert.match(unavailableHtml, /Capture health unavailable/)
  assert.match(unavailableHtml, /<strong>—<\/strong>/)
  assert.equal((unavailableHtml.match(/>Unavailable</g) ?? []).length, 5)
  assert.doesNotMatch(unavailableHtml, /capture-health-item missed/)
})

test('overdue captures render a compact warning with actionable checkpoints', () => {
  const captureHealth = captureHealthFixture({
    marketCheckpoints: {
      FINAL: checkpointCoverage(49, 50),
      T2: checkpointCoverage(48, 50),
      T6: checkpointCoverage(49, 50),
      T24: checkpointCoverage(47, 50),
    },
    officialT2: {
      capturedOfficialT2: 14,
      expectedOfficialT2: 15,
      missedOfficialT2: 1,
      officialT2CoveragePercent: 93.3333333333,
      status: 'MISSED',
    },
    status: 'MISSED',
  })
  const html = renderPerformance({
    initialAggregate: aggregateFixture({ captureHealth }),
  })

  assert.match(html, /Capture gaps detected/)
  assert.match(html, />14 \/ 15</)
  assert.match(html, /93\.3% · 1 missed/)
  assert.equal((html.match(/capture-health-item missed/g) ?? []).length, 4)
  assert.equal((html.match(/coverage-item actionable/g) ?? []).length, 1)
  assert.match(html, />47 \/ 50</)
  assert.match(html, /94\.0% · 3 missing/)
})

test('Bets & CLV keeps settled economics and CLV separate from model metrics', () => {
  const html = renderPerformance({ initialTab: 'bets' })

  assert.match(html, /Settled Bets/)
  assert.match(html, />34</)
  assert.match(html, /\+12\.40u/)
  assert.match(html, />6\.2%</)
  assert.match(html, /Average Same-Book CLV/)
  assert.match(html, /\+4\.2%/)
  assert.match(html, /Median 3\.6%/)
  assert.match(html, /18–13–2–1/)
  assert.match(html, /3 open excluded/)
  assert.match(html, /vs Best FINAL/)
  assert.match(html, /Separate comparison/)
})

test('zero performance and no-bet cohorts never render numeric zero as performance', () => {
  const emptyAggregate = aggregateFixture({
    betPerformance: {
      losses: 0, pendingBets: 0, profit: null, pushes: 0, roiPercent: null,
      settledBets: 0, status: 'unavailable', totalRelevantBets: 0,
      totalStake: null, voids: 0, wins: 0,
    },
    clv: {
      averageClvPercent: null, coveragePercent: 0, eligibleBetCount: 0,
      medianClvPercent: null, negativeClvCount: 0, positiveClvCount: 0,
      reasons: ['NO_RELEVANT_BET'], status: 'unavailable', unavailableBetCount: 0,
      vsBestFinal: { averagePercent: null, eligibleBetCount: 0, label: 'vs Best FINAL', medianPercent: null, status: 'unavailable' },
      zeroClvCount: 0,
    },
    coverage: {
      bets: { clvCoveragePercent: 0, sameBookClvEligibleBets: 0, settledBets: 0, totalRelevantBets: 0 },
      forward: { finalMarketCoveragePercent: 0, officialPredictions: 0, resultCoveragePercent: 0, t2MarketCoveragePercent: 0, validFinalMarkets: 0, validFinalResults: 0, validT2Markets: 0 },
    },
    forwardOverview: {
      accuracy: { accuracyPercent: null, correctCount: 0, incorrectCount: 0, noPickCount: 0, sampleSize: 0, status: 'unavailable' },
      modelBrier: { sampleSize: 0, status: 'unavailable', value: null },
    },
  })
  const forwardHtml = renderPerformance({ initialAggregate: emptyAggregate })
  const betsHtml = renderPerformance({ initialAggregate: emptyAggregate, initialTab: 'bets' })

  assert.match(forwardHtml, /No forward performance data yet/)
  assert.doesNotMatch(forwardHtml, />0\.000</)
  assert.match(betsHtml, /No bets in this period/)
  assert.match(betsHtml, /<span>ROI<\/span><strong>—<\/strong>/)
  assert.match(betsHtml, /<span>Average Same-Book CLV<\/span><strong>—<\/strong>/)
})

test('missing dates never render as the Unix epoch', () => {
  assert.equal(modelPerformanceUtils.formatGameDate(null), '—')
  assert.equal(modelPerformanceUtils.formatTimestamp(undefined), '—')
  assert.equal(modelPerformanceUtils.formatTimestamp(''), '—')
})

test('expanded game details distinguish official T2, Model at Bet, Bet, and FINAL prices', () => {
  const html = renderPerformance({
    initialExpandedGameIds: ['2026020001'],
    initialGames: gamesFixture(),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })

  assert.match(html, /Official Model Fair Odds @ T2/)
  assert.match(html, /Model Fair Odds @ Bet/)
  assert.match(html, /Model Probability @ Bet/)
  assert.match(html, /Bet Odds/)
  assert.match(html, /Same-book FINAL/)
  assert.match(html, /Same-book CLV/)
  assert.match(html, /Best FINAL odds/)
  assert.match(html, /2\.30/)
  assert.match(html, /2\.20/)
  assert.match(html, /2\.14/)
  assert.match(html, /2\.18/)
  assert.match(html, /2\.02/)
  assert.match(html, /Official T2 and Model @ Bet are separate stored observations/)
})

test('earliest captured semantics are explicit and missing checkpoints are omitted', () => {
  const bet = gameFixture().betDetails[0]
  const full = modelPerformanceUtils.buildPriceTimelinePoints(bet)
  const partial = modelPerformanceUtils.buildPriceTimelinePoints({
    priceTimeline: { bet: { odds: 2.1 }, final: { odds: 2.02 } },
  })

  assert.deepEqual(full.map(({ key }) => key), ['earliestCaptured', 't6', 't2', 'bet', 'final'])
  assert.equal(full[0].label, 'Earliest captured market')
  assert.deepEqual(partial.map(({ key }) => key), ['bet', 'final'])

  const html = renderPerformance({
    initialExpandedGameIds: ['2026020001'],
    initialGames: gamesFixture(),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })
  assert.match(html, /not the bookmaker’s opening odds/)
  assert.doesNotMatch(html, />Opening odds</)
})

test('games table is concise, paginated, expandable, and includes a mobile card view', () => {
  const html = renderPerformance({
    initialGames: gamesFixture(),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })

  for (const column of ['Date', 'Game', 'Model', 'T2 Market', 'FINAL Market', 'Result', 'Bet / Profit', 'CLV']) {
    assert.match(html, new RegExp(`>${column}<\\/th>`))
  }
  assert.match(html, /COL @ BOS/)
  assert.match(html, /BOS 2–3 OT/)
  assert.match(html, /Page 1 of 2 · 21 games/)
  assert.match(html, /class="performance-game-cards"/)
  assert.match(html, /aria-expanded="false"/)
})

test('capture gap drill-down is compact, paginated, and has a mobile card view', () => {
  const html = renderPerformance({
    initialGames: captureGapGamesFixture(),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })

  for (const column of ['Date', 'Game', 'Missing capture', 'Reason']) {
    assert.match(html, new RegExp(`>${column}<\\/th>`))
  }
  assert.match(html, /COL @ BOS/)
  assert.match(html, /T24/)
  assert.match(html, /T24 market checkpoint missed/)
  assert.match(html, /Page 1 of 1 · 1 game/)
  assert.match(html, /class="performance-game-cards capture-gap-cards"/)
  assert.doesNotMatch(html, />Model<\/th>/)
  assert.doesNotMatch(html, /aria-expanded=/)
})

test('unresolved, missing-market, no-bet, and unavailable CLV states stay explicit', () => {
  const unavailable = gameFixture({
    betDetails: [],
    bets: null,
    finalMarket: { bookmakerCount: 0, homeProbability: null, reason: 'MISSING_FINAL_MARKET', status: 'unavailable' },
    gameId: '2026020002',
    reasons: ['RESULT_PENDING', 'MISSING_FINAL_MARKET'],
    result: { awayScore: null, homeScore: null, homeWon: null, reason: 'RESULT_PENDING', resultType: null, status: 'RESULT_PENDING' },
    status: 'PENDING',
  })
  const html = renderPerformance({
    initialExpandedGameIds: ['2026020002'],
    initialGames: gamesFixture([unavailable]),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })

  assert.match(html, /Result pending/)
  assert.match(html, /FINAL market unavailable/)
  assert.match(html, /No bet/)
  assert.match(html, /No bet was saved for this game/)
})

test('bet without safely linked FINAL shows an explicit CLV reason', () => {
  const game = gameFixture()
  game.betDetails[0] = {
    ...game.betDetails[0],
    closingComparison: {
      bestFinalOdds: null,
      clvPercent: null,
      reason: 'NO_LATER_SAME_BOOK_FINAL',
      sameBookFinalOdds: null,
      status: 'unavailable',
      vsBestFinalPercent: null,
    },
  }
  const html = renderPerformance({
    initialExpandedGameIds: [game.gameId],
    initialGames: gamesFixture([game]),
    initialGamesStatus: 'success',
    initialTab: 'games',
  })

  assert.match(html, /Same-book CLV unavailable: No later same-book FINAL price/)
})

test('aggregate and games errors have independent retry states', () => {
  const aggregateError = renderToStaticMarkup(
    React.createElement(ModelPerformance, {
      initialAggregateError: 'Aggregate failed.',
      initialAggregateStatus: 'error',
    }),
  )
  const gamesError = renderPerformance({
    initialGamesError: 'Games failed.',
    initialGamesStatus: 'error',
    initialTab: 'games',
  })

  assert.match(aggregateError, /Model Performance unavailable/)
  assert.match(aggregateError, /Aggregate failed/)
  assert.match(gamesError, /Games unavailable/)
  assert.match(gamesError, /Games failed/)
  assert.equal((gamesError.match(/Try again/g) ?? []).length, 1)
})

test('responsive CSS swaps the desktop table for stacked cards without hiding key detail', async () => {
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.performance-games-table-wrap\s*\{[\s\S]*?display: none[\s\S]*?\.performance-game-cards\s*\{[\s\S]*?display: grid/,
  )
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.performance-game-details[\s\S]*?grid-template-columns: 1fr/,
  )
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.capture-health-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2/,
  )
  assert.match(
    css,
    /@media \(max-width: 480px\)[\s\S]*?\.capture-health-grid,[\s\S]*?grid-template-columns: 1fr/,
  )
  assert.match(css, /\.capture-gap-card\s*\{[\s\S]*?display: grid/)
})

test('Model Performance remains read-only and imports no calculation or mutation service', async () => {
  const componentSource = await readFile(
    new URL('../components/ModelPerformance.jsx', import.meta.url),
    'utf8',
  )
  const apiSource = await readFile(
    new URL('../services/modelPerformanceApi.js', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(componentSource, /calculateGame|powerRatingsApi|settleCompletedBets|createBet|updateBet/)
  assert.doesNotMatch(apiSource, /method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
  assert.match(apiSource, /fetchModelPerformanceGames/)
})
