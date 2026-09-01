const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  clearCalibrationAnalysisContexts,
  getCalibrationAnalysisContext,
  storeCalibrationAnalysisContext,
} = require('../calibration/calibrationAnalysisContextStore')
const {
  buildPairedCalibrationObservations,
  buildSeasonSensitivity,
  buildSeasonTemporalBlocks,
  calculateLogLoss,
  createAnalysisId,
  createSeededRandom,
  runPairedBlockBootstrap,
  sampleSeasonStratifiedBlocks,
  summarizeObserved,
} = require('../calibration/calibrationRobustness')
const {
  CalibrationRobustnessError,
  runCalibrationRobustness,
} = require('../calibration/calibrationRobustnessService')

const makePredictions = ({
  probability,
  seasonDefinitions = [
    { count: 8, seasonId: '20232024', start: '2023-10-10' },
    { count: 8, seasonId: '20242025', start: '2024-10-08' },
    { count: 8, seasonId: '20252026', start: '2025-10-07' },
  ],
}) => seasonDefinitions.flatMap(({ count, seasonId, start }) => {
  const startTimestamp = Date.parse(`${start}T00:00:00.000Z`)

  return Array.from({ length: count }, (_, index) => {
    const actualHomeWin = index % 2
    const timestamp = startTimestamp + index * 3 * 24 * 60 * 60 * 1000

    return {
      actualHomeWin,
      awayTeamId: `AWAY-${index % 4}`,
      gameDate: new Date(timestamp).toISOString().slice(0, 10),
      gameId: `${seasonId}-${index + 1}`,
      homeProbability: probability({ actualHomeWin, index, seasonId }),
      homeTeamId: `HOME-${index % 4}`,
      resultType: index % 3 === 0 ? 'OVERTIME' : 'REGULATION',
      seasonId,
      timestamp,
    }
  })
})

const baselinePredictions = makePredictions({
  probability: ({ index }) => 0.42 + (index % 4) * 0.05,
})
const clearlyBetterPredictions = makePredictions({
  probability: ({ actualHomeWin, index }) =>
    actualHomeWin ? 0.72 + (index % 2) * 0.08 : 0.28 - (index % 2) * 0.08,
})
const clearlyWorsePredictions = makePredictions({
  probability: ({ actualHomeWin, index }) =>
    actualHomeWin ? 0.2 + (index % 2) * 0.05 : 0.8 - (index % 2) * 0.05,
})

const buildObservationSet = (
  candidatePredictions = clearlyBetterPredictions,
) => buildPairedCalibrationObservations({
  baselinePredictions,
  candidatePredictions,
})

const makeContext = (candidatePredictions = clearlyBetterPredictions) => {
  const observationSet = buildObservationSet(candidatePredictions)
  const observed = summarizeObserved(observationSet.observations)
  const sensitivity = buildSeasonSensitivity(observationSet.observations)

  return {
    baseline: {
      candidateId: 'baseline',
      identity: 'CURRENT_PRODUCTION',
      label: 'Current Production',
      metrics: {
        logLoss: observed.baselineLogLoss,
        pooledBrier: observed.baselineBrier,
      },
      signature: 'baseline-signature',
    },
    candidates: {
      candidate: {
        candidate: {
          candidateId: 'candidate',
          candidateType: 'REST_FATIGUE',
          configurationSignature: 'candidate-signature',
          label: 'Rest candidate',
          metrics: {
            logLoss: observed.logLoss,
            pooledBrier: observed.brier,
          },
          modelVersion: 'base-model-v1',
          seasonConsistency: {
            seasonCount: 3,
            seasonsEqual: sensitivity.seasonsEqual,
            seasonsImproved: sensitivity.seasonsImproved,
            seasonsWorse: sensitivity.seasonsWorse,
          },
        },
        eligible: true,
        observationSet,
      },
      failed: {
        candidate: {
          candidateId: 'failed',
          candidateType: 'BASE_MODEL',
          configurationSignature: null,
          label: 'Failed candidate',
        },
        eligible: false,
        observationSet: null,
      },
    },
    metadata: {
      baselineSignature: 'baseline-signature',
      datasetSignature: 'dataset-signature',
      gameIdSignature: 'game-id-signature',
      productionSnapshotId: 'snapshot-1',
      productionWrites: false,
      seasons: ['20232024', '20242025', '20252026'],
      startingStateSignature: 'starting-state-signature',
    },
    runId: 'run-1',
  }
}

const makeRequest = (overrides = {}) => ({
  candidateId: 'candidate',
  identity: {
    baselineSignature: 'baseline-signature',
    candidateConfigurationSignature: 'candidate-signature',
    datasetSignature: 'dataset-signature',
    gameIdSignature: 'game-id-signature',
    productionSnapshotId: 'snapshot-1',
    startingStateSignature: 'starting-state-signature',
  },
  intervalLevel: 0.95,
  replicates: 1000,
  runId: 'run-1',
  seed: 123456,
  ...overrides,
})

test('paired block bootstrap reports deterministic strong improvement', () => {
  const observationSet = buildObservationSet()
  const blockDesign = buildSeasonTemporalBlocks(observationSet.observations, 7)
  const first = runPairedBlockBootstrap({
    blockDesign,
    intervalLevel: 0.95,
    replicates: 1000,
    seed: 42,
  })
  const second = runPairedBlockBootstrap({
    blockDesign,
    intervalLevel: 0.95,
    replicates: 1000,
    seed: 42,
  })
  const observed = summarizeObserved(observationSet.observations)

  assert.ok(observed.deltaBrier < 0)
  assert.deepEqual(first, second)
  assert.ok(first.deltaBrier.upper < 0)
  assert.equal(first.deltaBrier.proportionBetter, 1)
  assert.equal(first.deltaBrier.proportionWorse, 0)
  assert.ok(first.deltaLogLoss.upper < 0)
})

test('identical predictions preserve exact tie semantics in every bootstrap summary', () => {
  const observationSet = buildObservationSet(baselinePredictions)
  const blockDesign = buildSeasonTemporalBlocks(observationSet.observations)
  const bootstrap = runPairedBlockBootstrap({
    blockDesign,
    intervalLevel: 0.99,
    replicates: 1000,
    seed: 7,
  })
  const observed = summarizeObserved(observationSet.observations)

  assert.equal(observed.deltaBrier, 0)
  assert.equal(observed.deltaLogLoss, 0)
  assert.deepEqual(bootstrap.deltaBrier, {
    intervalCrossesZero: true,
    lower: 0,
    mean: 0,
    median: 0,
    proportionBetter: 0,
    proportionEqual: 1,
    proportionWorse: 0,
    upper: 0,
  })
  assert.equal(bootstrap.deltaLogLoss.proportionEqual, 1)
})

test('clearly worse predictions produce positive observed and resampled deltas', () => {
  const observationSet = buildObservationSet(clearlyWorsePredictions)
  const blockDesign = buildSeasonTemporalBlocks(observationSet.observations)
  const bootstrap = runPairedBlockBootstrap({
    blockDesign,
    intervalLevel: 0.9,
    replicates: 1000,
    seed: 91,
  })

  assert.ok(summarizeObserved(observationSet.observations).deltaBrier > 0)
  assert.equal(bootstrap.deltaBrier.proportionBetter, 0)
  assert.equal(bootstrap.deltaBrier.proportionWorse, 1)
  assert.ok(bootstrap.deltaBrier.lower > 0)
})

test('block sampling preserves complete paired blocks inside season strata including final partial blocks', () => {
  const shortDefinitions = [
    { count: 5, seasonId: '20232024', start: '2023-10-10' },
    { count: 4, seasonId: '20242025', start: '2024-10-08' },
  ]
  const baseline = makePredictions({
    probability: () => 0.5,
    seasonDefinitions: shortDefinitions,
  })
  const candidate = makePredictions({
    probability: ({ actualHomeWin }) => actualHomeWin ? 0.6 : 0.4,
    seasonDefinitions: shortDefinitions,
  })
  const observationSet = buildPairedCalibrationObservations({
    baselinePredictions: baseline,
    candidatePredictions: candidate,
  })
  const design = buildSeasonTemporalBlocks(observationSet.observations, 7)
  const first = sampleSeasonStratifiedBlocks(design, createSeededRandom(123))
  const second = sampleSeasonStratifiedBlocks(design, createSeededRandom(123))

  assert.deepEqual(first.sampledBlockIds, second.sampledBlockIds)
  assert.deepEqual(first.sampledSeasons, ['20232024', '20242025'])
  assert.equal(
    design.seasons.every((seasonId) =>
      design.blocksBySeason[seasonId].at(-1).count > 0),
    true,
  )
  first.sampledBlocks.forEach((block) => {
    const sampledIds = first.observationIds.filter((gameId) =>
      block.observationIds.includes(gameId))

    assert.equal(sampledIds.length % block.observationIds.length, 0)
  })
  first.observations.forEach((observation) => {
    assert.equal(
      observation.deltaBrierLoss,
      observation.candidateBrierLoss - observation.baselineBrierLoss,
    )
  })
})

test('bootstrap consumes completed paired observations without replaying or reordering rating updates', () => {
  const observationSet = buildObservationSet()
  const originalOrder = observationSet.observations.map((item) => item.gameId)
  const design = buildSeasonTemporalBlocks(observationSet.observations)

  runPairedBlockBootstrap({
    blockDesign: design,
    intervalLevel: 0.95,
    replicates: 1000,
    seed: 1,
  })

  assert.deepEqual(
    observationSet.observations.map((item) => item.gameId),
    originalOrder,
  )
  assert.equal(Object.isFrozen(observationSet.observations), true)
})

test('leave-one-season-out sensitivity detects a season-driven sign reversal', () => {
  const definitions = [
    { count: 8, seasonId: '20232024', start: '2023-10-10' },
    { count: 2, seasonId: '20242025', start: '2024-10-08' },
    { count: 2, seasonId: '20252026', start: '2025-10-07' },
  ]
  const baseline = makePredictions({
    probability: () => 0.5,
    seasonDefinitions: definitions,
  })
  const candidate = makePredictions({
    probability: ({ actualHomeWin, seasonId }) =>
      seasonId === '20232024'
        ? actualHomeWin ? 0.9 : 0.1
        : actualHomeWin ? 0.25 : 0.75,
    seasonDefinitions: definitions,
  })
  const observationSet = buildPairedCalibrationObservations({
    baselinePredictions: baseline,
    candidatePredictions: candidate,
  })
  const sensitivity = buildSeasonSensitivity(observationSet.observations)

  assert.ok(summarizeObserved(observationSet.observations).deltaBrier < 0)
  assert.equal(sensitivity.resultSensitiveToSeasonRemoval, true)
  assert.equal(
    sensitivity.leaveOneSeasonOut.find((entry) =>
      entry.excludedSeasonId === '20232024').directionChanged,
    true,
  )
})

test('leave-one-season-out sensitivity remains stable when all seasons improve', () => {
  const sensitivity = buildSeasonSensitivity(
    buildObservationSet().observations,
  )

  assert.equal(sensitivity.seasonsImproved, 3)
  assert.equal(sensitivity.seasonsWorse, 0)
  assert.equal(sensitivity.resultSensitiveToSeasonRemoval, false)
})

test('observation signatures are stable and change with block date, game, prediction, or outcome identity', () => {
  const original = buildObservationSet()
  const equivalent = buildPairedCalibrationObservations({
    baselinePredictions: [...baselinePredictions].reverse(),
    candidatePredictions: [...clearlyBetterPredictions].reverse(),
  })

  assert.equal(original.signature, equivalent.signature)

  const changeCandidate = structuredClone(clearlyBetterPredictions)
  changeCandidate[0].homeProbability += 0.001
  const changeOutcomeBaseline = structuredClone(baselinePredictions)
  const changeOutcomeCandidate = structuredClone(clearlyBetterPredictions)
  changeOutcomeBaseline[0].actualHomeWin = 1 - changeOutcomeBaseline[0].actualHomeWin
  changeOutcomeCandidate[0].actualHomeWin = changeOutcomeBaseline[0].actualHomeWin
  const changeGameBaseline = structuredClone(baselinePredictions)
  const changeGameCandidate = structuredClone(clearlyBetterPredictions)
  changeGameBaseline[0].gameId = 'different-game'
  changeGameCandidate[0].gameId = 'different-game'
  const changeDateBaseline = structuredClone(baselinePredictions)
  const changeDateCandidate = structuredClone(clearlyBetterPredictions)
  changeDateBaseline[0].gameDate = '2023-10-11'
  changeDateBaseline[0].timestamp = Date.parse('2023-10-11T00:00:00.000Z')
  changeDateCandidate[0].gameDate = '2023-10-11'
  changeDateCandidate[0].timestamp = Date.parse('2023-10-11T00:00:00.000Z')

  assert.notEqual(
    original.signature,
    buildPairedCalibrationObservations({
      baselinePredictions,
      candidatePredictions: changeCandidate,
    }).signature,
  )
  assert.notEqual(
    original.signature,
    buildPairedCalibrationObservations({
      baselinePredictions: changeOutcomeBaseline,
      candidatePredictions: changeOutcomeCandidate,
    }).signature,
  )
  assert.notEqual(
    original.signature,
    buildPairedCalibrationObservations({
      baselinePredictions: changeGameBaseline,
      candidatePredictions: changeGameCandidate,
    }).signature,
  )
  assert.notEqual(
    original.signature,
    buildPairedCalibrationObservations({
      baselinePredictions: changeDateBaseline,
      candidatePredictions: changeDateCandidate,
    }).signature,
  )
})

test('Log Loss uncertainty uses the shared calibration clipping boundary', () => {
  assert.equal(Number.isFinite(calculateLogLoss(0, 1)), true)
  assert.equal(Number.isFinite(calculateLogLoss(1, 0)), true)
  assert.ok(calculateLogLoss(0, 1) > calculateLogLoss(0.5, 1))
})

test('robustness service returns normalized deterministic metadata and summaries', () => {
  const context = makeContext()
  const contextProvider = (userId, runId) => {
    assert.equal(userId, 'user-1')
    assert.equal(runId, 'run-1')
    return context
  }
  const first = runCalibrationRobustness('user-1', makeRequest(), {
    contextProvider,
    now: () => 100,
  })
  const second = runCalibrationRobustness('user-1', makeRequest(), {
    contextProvider,
    now: () => 100,
  })
  const differentSeed = runCalibrationRobustness(
    'user-1',
    makeRequest({ seed: 654321 }),
    { contextProvider, now: () => 100 },
  )
  const defaultSeedRequest = makeRequest()
  delete defaultSeedRequest.seed
  const defaultSeedFirst = runCalibrationRobustness(
    'user-1',
    defaultSeedRequest,
    { contextProvider, now: () => 100 },
  )
  const defaultSeedSecond = runCalibrationRobustness(
    'user-1',
    defaultSeedRequest,
    { contextProvider, now: () => 100 },
  )

  assert.deepEqual(first, second)
  assert.notEqual(first.analysisId, differentSeed.analysisId)
  assert.deepEqual(first.observed, differentSeed.observed)
  assert.deepEqual(defaultSeedFirst, defaultSeedSecond)
  assert.equal(Number.isInteger(defaultSeedFirst.method.seed), true)
  assert.equal(first.method.resamplingMethod,
    'season_stratified_temporal_block_bootstrap')
  assert.equal(first.method.intervalMethod, 'percentile')
  assert.equal(first.method.blockSizeDays, 7)
  assert.equal(first.observationSet.games, 24)
  assert.deepEqual(first.observationSet.seasons, [
    '20232024',
    '20242025',
    '20252026',
  ])
  assert.equal(first.bootstrap.deltaBrier.proportionBetter, 1)
  assert.equal(first.diagnostics.bootstrapRerunsReplay, false)
  assert.equal(first.metadata.productionWrites, false)
})

test('robustness service rejects every frozen identity mismatch and non-comparable targets', () => {
  const context = makeContext()
  const contextProvider = () => context

  Object.keys(makeRequest().identity).forEach((field) => {
    const request = makeRequest({
      identity: {
        ...makeRequest().identity,
        [field]: field === 'productionSnapshotId' ? 'other-snapshot' : 'other',
      },
    })

    assert.throws(
      () => runCalibrationRobustness('user-1', request, { contextProvider }),
      (error) =>
        error instanceof CalibrationRobustnessError &&
        error.statusCode === 409 &&
        error.details.mismatches.includes(field),
    )
  })

  assert.throws(
    () => runCalibrationRobustness(
      'user-1',
      makeRequest({ candidateId: 'failed' }),
      { contextProvider },
    ),
    /Failed or non-comparable candidates/,
  )
  assert.throws(
    () => runCalibrationRobustness(
      'user-1',
      { ...makeRequest(), userId: 'attacker' },
      { contextProvider },
    ),
    /unsupported fields/,
  )
})

test('ephemeral analysis contexts are user-scoped, bounded by expiry, and contain no client metrics', () => {
  clearCalibrationAnalysisContexts()
  const context = makeContext()
  const result = {
    baseline: {
      candidateId: 'baseline',
      label: 'Current Production',
      metadata: { modelVersion: 'base-model-v1' },
      metrics: context.baseline.metrics,
    },
    baselineMode: 'CURRENT_PRODUCTION',
    candidates: [{
      candidateId: 'candidate',
      candidateType: 'REST_FATIGUE',
      diagnostics: {
        comparability: { comparable: true },
        executionStatus: 'completed',
        seasonConsistency:
          context.candidates.candidate.candidate.seasonConsistency,
      },
      label: 'Rest candidate',
      metadata: {
        configurationSignature: 'candidate-signature',
        modelVersion: 'base-model-v1',
      },
      metrics: context.candidates.candidate.candidate.metrics,
    }],
    evaluationContext: {
      baselineSignature: 'baseline-signature',
      datasetSignature: 'dataset-signature',
      gameIdSignature: 'game-id-signature',
      productionSnapshotId: 'snapshot-1',
      seasons: context.metadata.seasons,
      startingStateSignature: 'starting-state-signature',
    },
    runId: 'stored-run',
  }
  const baselineReplay = { predictions: baselinePredictions }
  const candidateReplays = new Map([
    ['candidate', { predictions: clearlyBetterPredictions }],
  ])

  storeCalibrationAnalysisContext({
    baselineReplay,
    candidateReplays,
    now: 100,
    result,
    ttlMs: 50,
    userId: 'user-a',
  })

  assert.ok(getCalibrationAnalysisContext('user-a', 'stored-run', { now: 120 }))
  assert.equal(
    getCalibrationAnalysisContext('user-b', 'stored-run', { now: 120 }),
    null,
  )
  assert.equal(
    getCalibrationAnalysisContext('user-a', 'stored-run', { now: 151 }),
    null,
  )
  clearCalibrationAnalysisContexts()
})

test('analysis identity includes method, seed, interval, and observation configuration', () => {
  const observationSet = buildObservationSet()
  const blockDesign = buildSeasonTemporalBlocks(observationSet.observations)
  const base = {
    baselineSignature: 'baseline',
    blockDesign,
    candidateId: 'candidate',
    configurationSignature: 'configuration',
    intervalLevel: 0.95,
    observationSignature: observationSet.signature,
    replicates: 1000,
    seed: 1,
  }

  assert.notEqual(
    createAnalysisId(base),
    createAnalysisId({ ...base, seed: 2 }),
  )
  assert.notEqual(
    createAnalysisId(base),
    createAnalysisId({ ...base, intervalLevel: 0.9 }),
  )
  assert.notEqual(
    createAnalysisId(base),
    createAnalysisId({ ...base, replicates: 2500 }),
  )
})
