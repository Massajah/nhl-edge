const assert = require('node:assert/strict')
const test = require('node:test')
const {
  adaptBaseModelCalibrationResult,
  adaptHomeAdvantageCalibrationResult,
  adaptScheduleCalibrationResult,
  adaptSpecialTeamsCalibrationResult,
} = require('../calibration/calibrationResultAdapters')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
  DELTA_BRIER_DIRECTION,
  compareCalibrationCandidates,
  createCalibrationCandidate,
} = require('../calibration/calibrationResultContract')
const {
  baseModelResultFixture,
  homeAdvantageResultFixture,
  scheduleResultFixture,
  specialTeamsResultFixture,
} = require('./fixtures/calibrationResultFixtures')

const cloneFixture = (value) => JSON.parse(JSON.stringify(value))

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }

  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const makeComparableCandidate = (overrides = {}) => {
  const {
    evaluation: evaluationOverrides,
    metadata: metadataOverrides,
    ...candidateOverrides
  } = overrides

  return createCalibrationCandidate({
    baseline: {
      identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
    },
    candidateId: overrides.candidateId ?? 'candidate-a',
    candidateType: CANDIDATE_TYPES.BASE_MODEL,
    evaluation: {
      excludedGames: 0,
      games: 200,
      includedGames: 200,
      seasons: ['20232024', '20242025'],
      ...evaluationOverrides,
    },
    metadata: {
      baselineSignature: 'baseline-v1',
      datasetSignature: 'dataset-v1',
      startingStateSignature: 'start-v1',
      ...metadataOverrides,
    },
    metrics: { pooledBrier: 0.21 },
    ...candidateOverrides,
  })
}

test('contract exposes phase-neutral candidate and baseline enums', () => {
  assert.deepEqual(Object.values(CANDIDATE_TYPES).sort(), [
    'BASELINE',
    'BASE_MODEL',
    'COMBINED',
    'QUICK_REMATCH',
    'REST_FATIGUE',
    'SPECIAL_TEAMS',
    'TEAM_HOME_ADVANTAGE',
  ])
  assert.deepEqual(Object.values(BASELINE_IDENTITIES).sort(), [
    'CANONICAL_BASE_MODEL_V1',
    'CURRENT_PRODUCTION',
    'PHASE_CONTROL',
    'UNKNOWN',
  ])
  assert.equal(DELTA_BRIER_DIRECTION, 'candidate_minus_baseline')
})

test('Base Model adapter preserves pooled and per-season metrics without inventing a production baseline', () => {
  const [candidate] = adaptBaseModelCalibrationResult(
    cloneFixture(baseModelResultFixture),
  )

  assert.equal(candidate.candidateType, CANDIDATE_TYPES.BASE_MODEL)
  assert.equal(candidate.baseline.identity, BASELINE_IDENTITIES.UNKNOWN)
  assert.equal(candidate.baseline.metrics, null)
  assert.deepEqual(candidate.evaluation, {
    excludedGames: 4,
    games: 200,
    includedGames: 200,
    seasons: ['20232024', '20242025'],
  })
  assert.deepEqual(candidate.metrics, {
    accuracy: 0.605,
    averageSeasonBrier: 0.214,
    ece: 0.028,
    logLoss: 0.617,
    pooledBrier: 0.2135,
    worstSeasonBrier: 0.218,
  })
  assert.deepEqual(candidate.perSeason[0], {
    accuracy: 0.610526,
    brier: 0.21,
    ece: 0.025,
    games: 95,
    logLoss: 0.61,
    seasonId: '20232024',
  })
  assert.deepEqual(
    candidate.overrides,
    baseModelResultFixture.parameters,
  )
  assert.deepEqual(
    candidate.diagnostics.sanityBaselines,
    baseModelResultFixture.sanityBaselines,
  )
  assert.equal(candidate.metadata.productionWrites, false)
})

test('Team HA adapter preserves the canonical control relationship, settings, tiers, and metrics', () => {
  const candidates = adaptHomeAdvantageCalibrationResult(
    cloneFixture(homeAdvantageResultFixture),
  )
  const candidate = candidates.find(
    (item) => item.candidateId === 'team-home-advantage:adjustment:2',
  )

  assert.equal(candidates.length, 2)
  assert.equal(
    candidate.baseline.identity,
    BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  )
  assert.equal(
    candidate.baseline.candidateId,
    'team-home-advantage:adjustment:0',
  )
  assert.equal(candidate.baseline.metrics.pooledBrier, 0.221)
  assert.deepEqual(candidate.overrides, {
    adjustment: 2,
    effectiveHomeAdvantage: { normal: 4, strong: 6, weak: 2 },
  })
  assert.deepEqual(candidate.metrics, {
    accuracy: 0.61,
    averageSeasonBrier: 0.216,
    ece: 0.027,
    logLoss: 0.63,
    pooledBrier: 0.216,
    worstSeasonBrier: 0.218,
  })
  assert.equal(candidate.evaluation.games, 210)
  assert.equal(candidate.perSeason[1].brier, 0.218)
  assert.deepEqual(
    candidate.diagnostics.currentAnalysis.tierSizes,
    { normal: 16, strong: 8, weak: 8 },
  )
  assert.equal(candidate.diagnostics.stability.level, 'stable')
  assert.deepEqual(candidate.comparison, {
    deltaAccuracy: 0.02,
    deltaBrier: -0.005,
    deltaLogLoss: -0.008,
  })
})

test('Schedule adapter preserves individual rule and combined rest/fatigue diagnostics', () => {
  const candidates = adaptScheduleCalibrationResult(
    cloneFixture(scheduleResultFixture),
  )
  const ruleCandidate = candidates.find(
    (item) =>
      item.candidateId ===
      'rest-fatigue:road_back_to_back:adjustment:-2',
  )
  const combinedCandidate = candidates.find(
    (item) => item.candidateId === 'rest-fatigue:combined-selection',
  )

  assert.equal(candidates.length, 5)
  assert.equal(ruleCandidate.candidateType, CANDIDATE_TYPES.REST_FATIGUE)
  assert.equal(
    ruleCandidate.baseline.identity,
    BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  )
  assert.equal(ruleCandidate.metrics.pooledBrier, 0.219)
  assert.equal(ruleCandidate.metrics.ece, 0.032)
  assert.equal(ruleCandidate.evaluation.games, 120)
  assert.equal(ruleCandidate.diagnostics.occurrences, 24)
  assert.equal(ruleCandidate.diagnostics.gamesAffected, 24)
  assert.equal(ruleCandidate.diagnostics.ruleId, 'road_back_to_back')
  assert.deepEqual(ruleCandidate.diagnostics.priorityCounts, [
    { road_back_to_back: 24 },
  ])
  assert.equal(ruleCandidate.overrides.adjustment, -2)
  assert.equal(ruleCandidate.comparison.deltaBrier, -0.006)
  assert.deepEqual(
    combinedCandidate.overrides.configurationSnapshot,
    scheduleResultFixture.combinedRestFatigueResult.configurationSnapshot,
  )
  assert.equal(
    combinedCandidate.diagnostics.variant,
    'combined_rest_fatigue_selection',
  )
})

test('Schedule adapter preserves quick-rematch window, occurrences, and baseline', () => {
  const candidates = adaptScheduleCalibrationResult(
    cloneFixture(scheduleResultFixture),
  )
  const candidate = candidates.find(
    (item) =>
      item.candidateId === 'quick-rematch:days:14:adjustment:-1',
  )

  assert.equal(candidate.candidateType, CANDIDATE_TYPES.QUICK_REMATCH)
  assert.equal(candidate.baseline.candidateId, 'quick-rematch:disabled')
  assert.deepEqual(candidate.overrides, {
    adjustment: -1,
    configuration: {
      quickRematch: {
        enabled: true,
        loserAdjustment: -1,
        maximumDays: 14,
      },
    },
    disabled: false,
    windowDays: 14,
  })
  assert.equal(candidate.diagnostics.occurrences, 12)
  assert.equal(candidate.diagnostics.occurrenceRate, 0.1)
  assert.equal(candidate.metrics.logLoss, 0.64)
  assert.equal(candidate.perSeason[0].accuracy, 0.6)
})

test('Special Teams adapter preserves top/bottom N, signals, games, and phase control', () => {
  const candidates = adaptSpecialTeamsCalibrationResult(
    cloneFixture(specialTeamsResultFixture),
  )
  const candidate = candidates.find(
    (item) =>
      item.candidateId === 'special-teams:top-bottom:5:adjustment:2',
  )

  assert.equal(candidates.length, 2)
  assert.equal(candidate.candidateType, CANDIDATE_TYPES.SPECIAL_TEAMS)
  assert.equal(
    candidate.baseline.identity,
    BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  )
  assert.equal(
    candidate.baseline.candidateId,
    'special-teams:top-bottom:5:adjustment:0',
  )
  assert.deepEqual(candidate.overrides, { adjustment: 2, topBottomN: 5 })
  assert.equal(candidate.evaluation.games, 130)
  assert.equal(candidate.metrics.pooledBrier, 0.222)
  assert.equal(candidate.metrics.averageSeasonBrier, 0.222)
  assert.equal(candidate.metrics.worstSeasonBrier, 0.222)
  assert.equal(candidate.perSeason[0].ece, 0.035)
  assert.deepEqual(candidate.diagnostics.occurrences, {
    gamesAffected: 23,
    negativeOccurrences: 11,
    positiveOccurrences: 12,
  })
  assert.deepEqual(candidate.diagnostics.signalDiagnostics, {
    negative: { count: 11 },
    positive: { count: 12 },
  })
  assert.equal(candidate.comparison.deltaBrier, -0.008)
})

test('all adapters leave deeply frozen source results unchanged', () => {
  const cases = [
    [adaptBaseModelCalibrationResult, baseModelResultFixture],
    [adaptHomeAdvantageCalibrationResult, homeAdvantageResultFixture],
    [adaptScheduleCalibrationResult, scheduleResultFixture],
    [adaptSpecialTeamsCalibrationResult, specialTeamsResultFixture],
  ]

  cases.forEach(([adapter, fixture]) => {
    const input = cloneFixture(fixture)
    const before = cloneFixture(input)

    deepFreeze(input)
    assert.doesNotThrow(() => adapter(input))
    assert.deepEqual(input, before)
  })
})

test('missing signatures, production identity, and optional metrics remain explicit nulls', () => {
  const [candidate] = adaptBaseModelCalibrationResult({
    dataset: { gamesIncluded: 10 },
    label: 'Sparse candidate',
    metrics: { brierScore: 0.24 },
    seasonResults: [],
  })

  assert.equal(candidate.baseline.identity, BASELINE_IDENTITIES.UNKNOWN)
  assert.deepEqual(candidate.metadata, {
    baselineSignature: null,
    configurationSignature: null,
    datasetSignature: null,
    modelVersion: null,
    productionSnapshotId: null,
    productionWrites: false,
    startingStateSignature: null,
  })
  assert.deepEqual(candidate.metrics, {
    accuracy: null,
    averageSeasonBrier: null,
    ece: null,
    logLoss: null,
    pooledBrier: 0.24,
    worstSeasonBrier: null,
  })
  assert.deepEqual(candidate.comparison, {
    deltaAccuracy: null,
    deltaBrier: null,
    deltaLogLoss: null,
  })
})

test('adapters never infer CURRENT_PRODUCTION and allow it only when explicitly supplied', () => {
  const defaultCandidates = adaptHomeAdvantageCalibrationResult(
    cloneFixture(homeAdvantageResultFixture),
  )
  const explicitCandidates = adaptHomeAdvantageCalibrationResult(
    cloneFixture(homeAdvantageResultFixture),
    {
      baselineIdentity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
      metadata: { productionSnapshotId: 'production-2026-08-25' },
    },
  )

  assert.ok(
    defaultCandidates.every(
      (candidate) =>
        candidate.baseline.identity ===
        BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
    ),
  )
  assert.ok(
    explicitCandidates.every(
      (candidate) =>
        candidate.baseline.identity === BASELINE_IDENTITIES.CURRENT_PRODUCTION,
    ),
  )
  assert.equal(
    explicitCandidates[0].metadata.productionSnapshotId,
    'production-2026-08-25',
  )
})

test('delta Brier is candidate minus baseline: negative improves and positive worsens', () => {
  const improving = adaptHomeAdvantageCalibrationResult(
    cloneFixture(homeAdvantageResultFixture),
  )[1]
  const worseFixture = cloneFixture(homeAdvantageResultFixture)

  worseFixture.comparisons[1].metrics.brierScore = 0.226
  const worsening = adaptHomeAdvantageCalibrationResult(worseFixture)[1]

  assert.equal(improving.comparison.deltaBrier, -0.005)
  assert.ok(improving.comparison.deltaBrier < 0)
  assert.equal(worsening.comparison.deltaBrier, 0.005)
  assert.ok(worsening.comparison.deltaBrier > 0)
})

test('comparison safety accepts candidates with matching coverage and signatures', () => {
  const left = makeComparableCandidate()
  const right = makeComparableCandidate({ candidateId: 'candidate-b' })

  assert.deepEqual(compareCalibrationCandidates(left, right), {
    comparable: true,
    warnings: [],
  })
})

test('comparison safety warns and refuses to assume missing identities are equal', () => {
  const [left] = adaptBaseModelCalibrationResult(
    cloneFixture(baseModelResultFixture),
  )
  const [right] = adaptBaseModelCalibrationResult(
    cloneFixture(baseModelResultFixture),
    { candidateId: 'other-base-candidate' },
  )
  const safety = compareCalibrationCandidates(left, right)

  assert.equal(safety.comparable, false)
  assert.deepEqual(
    safety.warnings.map((warning) => warning.code),
    [
      'MISSING_DATASET_SIGNATURE',
      'MISSING_STARTING_STATE_SIGNATURE',
      'MISSING_BASELINE_SIGNATURE',
    ],
  )
})

test('comparison safety reports season, game-count, signature, and baseline mismatches', () => {
  const left = makeComparableCandidate()
  const right = makeComparableCandidate({
    baseline: { identity: BASELINE_IDENTITIES.PHASE_CONTROL },
    candidateId: 'candidate-b',
    evaluation: {
      games: 199,
      includedGames: 199,
      seasons: ['20242025'],
    },
    metadata: {
      baselineSignature: 'baseline-v2',
      datasetSignature: 'dataset-v2',
      startingStateSignature: 'start-v2',
    },
  })
  const safety = compareCalibrationCandidates(left, right)

  assert.equal(safety.comparable, false)
  assert.deepEqual(
    safety.warnings.map((warning) => warning.code),
    [
      'SEASONS_MISMATCH',
      'GAME_COUNT_MISMATCH',
      'INCLUDED_GAMES_MISMATCH',
      'DATASET_SIGNATURE_MISMATCH',
      'STARTING_STATE_SIGNATURE_MISMATCH',
      'BASELINE_SIGNATURE_MISMATCH',
      'BASELINE_IDENTITY_MISMATCH',
    ],
  )
})

test('comparison safety treats an empty season list as unavailable coverage', () => {
  const left = makeComparableCandidate()
  const right = makeComparableCandidate({
    candidateId: 'candidate-b',
    evaluation: { seasons: [] },
  })
  const safety = compareCalibrationCandidates(left, right)

  assert.equal(safety.comparable, false)
  assert.equal(safety.warnings[0].code, 'MISSING_SEASONS')
})

test('comparison safety requires matching production snapshots for CURRENT_PRODUCTION', () => {
  const left = makeComparableCandidate({
    baseline: { identity: BASELINE_IDENTITIES.CURRENT_PRODUCTION },
  })
  const right = makeComparableCandidate({
    baseline: { identity: BASELINE_IDENTITIES.CURRENT_PRODUCTION },
    candidateId: 'candidate-b',
  })
  const safety = compareCalibrationCandidates(left, right)

  assert.equal(safety.comparable, false)
  assert.equal(
    safety.warnings.at(-1).code,
    'MISSING_PRODUCTION_SNAPSHOT_ID',
  )
})
