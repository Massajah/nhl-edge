const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createCalibrationDatasetContext,
  getHistoricalDatasetRevision,
  getHistoricalPreparationMetadata,
} = require('../calibration/calibrationDatasetContext')
const {
  STARTING_STATE_POLICIES,
  createBaselineConfigurationIdentity,
  createGameIdSignature,
  createStartingStateIdentity,
} = require('../calibration/calibrationIdentity')
const {
  captureCalibrationProductionSnapshot,
} = require('../calibration/calibrationProductionSnapshot')
const {
  adaptBaseModelCalibrationResult,
} = require('../calibration/calibrationResultAdapters')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
  compareCalibrationCandidates,
  createCalibrationCandidate,
} = require('../calibration/calibrationResultContract')

const clone = (value) => JSON.parse(JSON.stringify(value))

const preparationMetadata = [
  {
    completedAt: '2025-05-01T12:00:00.000Z',
    completedGames: 2,
    completedWindows: [
      {
        completedAt: '2025-05-01T12:00:00.000Z',
        dateFrom: '2024-10-01',
        dateTo: '2025-04-17',
        gamesFound: 2,
        gamesPersisted: 2,
      },
    ],
    firstGameDate: '2024-10-08',
    importedGames: 2,
    lastGameDate: '2025-04-17',
    seasonId: '20242025',
    source: 'NHL API',
    status: 'ready',
    updatedAt: '2025-05-02T12:00:00.000Z',
    __v: 7,
  },
]

const makeStartingState = (overrides = {}) => ({
  policy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
  seasonStartingStates: [
    {
      orderingSource: 'franchise_normalized_alphabetical',
      seasonId: '20242025',
      teams: [
        { startingRating: 42, teamId: 'ANA' },
        { startingRating: 50, teamId: 'WPG' },
      ],
    },
  ],
  ...overrides,
})

const makeBaselineConfiguration = () => ({
  features: {
    quickRematch: {
      enabled: false,
      loserAdjustment: 0,
      maximumDays: 0,
    },
    restFatigue: {
      enabled: false,
      rules: {
        backToBack: { adjustment: 0, enabled: false },
      },
    },
    specialTeams: {
      adjustmentMagnitude: 0,
      enabled: false,
      mode: 'off',
      topBottomN: 6,
    },
    teamHomeAdvantage: {
      adjustments: [],
      enabled: false,
    },
  },
  model: {
    baseHomeAdvantage: 3.5,
    kFactor: 1.3,
    modelVersion: 'power-rating-v1',
    overtimeMultiplier: 0.4,
    probabilityScale: 20,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
  },
})

const productionEngineSettings = {
  homeAdvantage: 3.75,
  kFactor: 1.4,
  maximumGoaliePenalty: -4,
  maximumPlayerInjuryPenalty: -2.5,
  modelVersion: 'power-rating-v1',
  overtimeMultiplier: 0.45,
  probabilityScale: 21,
  regulationMultiplier: 1,
  shootoutMultiplier: 0.15,
  specialTeamsAdjustment: 0.75,
  specialTeamsAlertsEnabled: true,
  specialTeamsMode: 'automatic',
  specialTeamsRankThreshold: 7,
}

const productionScheduleSettings = {
  backToBackAdjustment: -0.8,
  backToBackEnabled: true,
  backToBackTravelAdjustment: -1.3,
  backToBackTravelEnabled: true,
  quickRematchEnabled: true,
  quickRematchLoserAdjustment: 0.3,
  quickRematchMaximumDays: 6,
  restFatigueEnabled: true,
  threeInFourAdjustment: -0.55,
  threeInFourEnabled: true,
  wellRestedAdjustment: 0.2,
  wellRestedEnabled: false,
}

const productionRatings = [
  { homeAdvantage: -0.5, teamId: 'WPG' },
  { homeAdjustment: 0.75, teamId: 'ANA' },
]

const captureSnapshot = (overrides = {}) =>
  captureCalibrationProductionSnapshot('user-a', {
    clock: () => new Date('2026-08-25T10:00:00.000Z'),
    engineSettingsProvider: async () => clone(
      overrides.engineSettings ?? productionEngineSettings,
    ),
    powerRatingsProvider: async () => clone(
      overrides.ratings ?? productionRatings,
    ),
    scheduleSettingsProvider: async () => ({
      settings: clone(overrides.scheduleSettings ?? productionScheduleSettings),
    }),
  })

test('game-ID signature is independent of retrieval order', () => {
  assert.equal(
    createGameIdSignature(['2024020002', '2024020001']),
    createGameIdSignature(['2024020001', '2024020002']),
  )
})

test('dataset signature changes when a game is added or removed', () => {
  const twoGames = createCalibrationDatasetContext({
    includedGameIds: ['1', '2'],
    seasons: ['20242025'],
  })
  const threeGames = createCalibrationDatasetContext({
    includedGameIds: ['1', '2', '3'],
    seasons: ['20242025'],
  })

  assert.notEqual(twoGames.datasetSignature, threeGames.datasetSignature)
  assert.notEqual(twoGames.gameIdSignature, threeGames.gameIdSignature)
})

test('dataset signature changes for different exact game IDs at the same count', () => {
  const left = createCalibrationDatasetContext({
    includedGameIds: ['1', '2'],
    seasons: ['20242025'],
  })
  const right = createCalibrationDatasetContext({
    includedGameIds: ['1', '3'],
    seasons: ['20242025'],
  })

  assert.equal(left.gameCount, right.gameCount)
  assert.notEqual(left.datasetSignature, right.datasetSignature)
})

test('dataset context freezes sorted exact IDs and stable preparation metadata', () => {
  const context = createCalibrationDatasetContext({
    includedGameIds: ['2024020002', '2024020001'],
    preparationMetadata,
    seasons: ['20242025'],
  })

  assert.deepEqual(context.includedGameIds, ['2024020001', '2024020002'])
  assert.equal(context.gameCount, 2)
  assert.equal(context.datasetRevision, null)
  assert.equal(
    context.preparationMetadata[0].completedAt,
    '2025-05-01T12:00:00.000Z',
  )
  assert.equal(context.preparationMetadata[0].completedWindowCount, 1)
  assert.ok(Object.isFrozen(context))
  assert.ok(Object.isFrozen(context.includedGameIds))
})

test('existing HistoricalSeasonDataset metadata has no reliable revision signal', () => {
  const metadata = getHistoricalPreparationMetadata(preparationMetadata[0])

  assert.equal(getHistoricalDatasetRevision(preparationMetadata[0]), null)
  assert.equal(metadata.datasetRevision, null)
  assert.equal(
    getHistoricalDatasetRevision({ datasetRevision: 'revision-12' }),
    'revision-12',
  )
})

test('starting-state signature is independent of team input order', () => {
  const left = createStartingStateIdentity(makeStartingState())
  const right = createStartingStateIdentity(
    makeStartingState({
      seasonStartingStates: [
        {
          orderingSource: 'franchise_normalized_alphabetical',
          seasonId: '20242025',
          teams: [
            { startingRating: 50, teamId: 'WPG' },
            { startingRating: 42, teamId: 'ANA' },
          ],
        },
      ],
    }),
  )

  assert.equal(left.startingStateSignature, right.startingStateSignature)
  assert.deepEqual(left.seasons[0].teams, [
    { startingRating: 42, teamId: 'ANA' },
    { startingRating: 50, teamId: 'WPG' },
  ])
})

test('same nominal 42–50 range with different team assignments has a different signature', () => {
  const left = createStartingStateIdentity(makeStartingState())
  const right = createStartingStateIdentity(
    makeStartingState({
      seasonStartingStates: [
        {
          orderingSource: 'franchise_normalized_alphabetical',
          seasonId: '20242025',
          teams: [
            { startingRating: 50, teamId: 'ANA' },
            { startingRating: 42, teamId: 'WPG' },
          ],
        },
      ],
    }),
  )

  assert.notEqual(left.startingStateSignature, right.startingStateSignature)
})

test('changing one season starting state changes the multi-season signature', () => {
  const season2024 = makeStartingState().seasonStartingStates[0]
  const season2025 = {
    ...season2024,
    seasonId: '20252026',
  }
  const left = createStartingStateIdentity(
    makeStartingState({ seasonStartingStates: [season2024, season2025] }),
  )
  const right = createStartingStateIdentity(
    makeStartingState({
      seasonStartingStates: [
        season2024,
        {
          ...season2025,
          teams: [
            { startingRating: 42.5, teamId: 'ANA' },
            { startingRating: 49.5, teamId: 'WPG' },
          ],
        },
      ],
    }),
  )

  assert.notEqual(left.startingStateSignature, right.startingStateSignature)
})

test('baseline signature is stable for identical exact settings', () => {
  const left = createBaselineConfigurationIdentity({
    configuration: makeBaselineConfiguration(),
    identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  })
  const reordered = clone(makeBaselineConfiguration())
  const right = createBaselineConfigurationIdentity({
    configuration: {
      model: reordered.model,
      features: reordered.features,
    },
    identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  })

  assert.equal(left.baselineSignature, right.baselineSignature)
})

test('baseline signature changes when K changes', () => {
  const base = makeBaselineConfiguration()
  const changed = clone(base)

  changed.model.kFactor = 1.31
  assert.notEqual(
    createBaselineConfigurationIdentity({ configuration: base }).baselineSignature,
    createBaselineConfigurationIdentity({ configuration: changed })
      .baselineSignature,
  )
})

test('baseline signature changes when the OT multiplier changes', () => {
  const base = makeBaselineConfiguration()
  const changed = clone(base)

  changed.model.overtimeMultiplier = 0.41
  assert.notEqual(
    createBaselineConfigurationIdentity({ configuration: base }).baselineSignature,
    createBaselineConfigurationIdentity({ configuration: changed })
      .baselineSignature,
  )
})

test('baseline signature changes when one feature setting changes', () => {
  const base = makeBaselineConfiguration()
  const changed = clone(base)

  changed.features.quickRematch.enabled = true
  assert.notEqual(
    createBaselineConfigurationIdentity({ configuration: base }).baselineSignature,
    createBaselineConfigurationIdentity({ configuration: changed })
      .baselineSignature,
  )
})

test('baseline identity meaning remains separate from exact-value signature', () => {
  const configuration = makeBaselineConfiguration()
  const canonical = createBaselineConfigurationIdentity({
    configuration,
    identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  })
  const production = createBaselineConfigurationIdentity({
    configuration,
    identity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  })

  assert.equal(canonical.baselineSignature, production.baselineSignature)
  assert.notEqual(canonical.identity, production.identity)
})

test('production snapshot captures each actual source once, stays immutable, and performs no writes', async () => {
  const calls = { engine: 0, ratings: 0, schedule: 0 }
  const userIds = []
  const snapshot = await captureCalibrationProductionSnapshot('user-a', {
    clock: () => new Date('2026-08-25T10:00:00.000Z'),
    engineSettingsProvider: async (userId) => {
      calls.engine += 1
      userIds.push(userId)
      return clone(productionEngineSettings)
    },
    powerRatingsProvider: async (userId) => {
      calls.ratings += 1
      userIds.push(userId)
      return clone(productionRatings)
    },
    scheduleSettingsProvider: async (userId) => {
      calls.schedule += 1
      userIds.push(userId)
      return { settings: clone(productionScheduleSettings) }
    },
  })

  assert.deepEqual(calls, { engine: 1, ratings: 1, schedule: 1 })
  assert.deepEqual(userIds, ['user-a', 'user-a', 'user-a'])
  assert.equal(
    snapshot.baselineIdentity,
    BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  )
  assert.equal(snapshot.configuration.model.probabilityScale, 21)
  assert.equal(snapshot.configuration.model.baseHomeAdvantage, 3.75)
  assert.equal(snapshot.configuration.model.kFactor, 1.4)
  assert.equal(snapshot.configuration.model.overtimeMultiplier, 0.45)
  assert.deepEqual(
    snapshot.configuration.features.teamHomeAdvantage.adjustments,
    [
      { adjustment: 0.75, teamId: 'ANA' },
      { adjustment: -0.5, teamId: 'WPG' },
    ],
  )
  assert.equal(snapshot.configuration.features.restFatigue.enabled, true)
  assert.equal(
    snapshot.configuration.features.restFatigue.rules.backToBack.adjustment,
    -0.8,
  )
  assert.equal(
    snapshot.configuration.features.quickRematch.maximumDays,
    6,
  )
  assert.deepEqual(
    snapshot.configuration.features.specialTeams.historicalWindow,
    {
      completedSeasonCount: 3,
      methodology: 'previous_three_completed_regular_seasons_average',
    },
  )
  assert.equal(snapshot.configuration.features.specialTeams.mode, 'automatic')
  assert.equal(
    snapshot.configuration.features.specialTeams.adjustmentMagnitude,
    0.75,
  )
  assert.equal(
    snapshot.configuration.modelAdjustmentGuardrails.maximumGoaliePenalty,
    -4,
  )
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.configuration.features.restFatigue.rules))

  snapshot.configuration.model.kFactor = 99
  assert.equal(snapshot.configuration.model.kFactor, 1.4)
})

test('production snapshot ID ignores capture time and input ordering', async () => {
  const first = await captureSnapshot()
  const second = await captureCalibrationProductionSnapshot('user-a', {
    clock: () => new Date('2026-08-26T10:00:00.000Z'),
    engineSettingsProvider: async () => clone(productionEngineSettings),
    powerRatingsProvider: async () => clone([...productionRatings].reverse()),
    scheduleSettingsProvider: async () => ({
      settings: clone(productionScheduleSettings),
    }),
  })

  assert.notEqual(first.capturedAt, second.capturedAt)
  assert.equal(first.productionSnapshotId, second.productionSnapshotId)
  assert.equal(first.baselineSignature, second.baselineSignature)
})

test('changing one production-relevant value changes productionSnapshotId', async (t) => {
  const control = await captureSnapshot()
  const cases = [
    {
      name: 'K factor',
      overrides: {
        engineSettings: { ...productionEngineSettings, kFactor: 1.41 },
      },
    },
    {
      name: 'Quick Rematch enabled state',
      overrides: {
        scheduleSettings: {
          ...productionScheduleSettings,
          quickRematchEnabled: false,
        },
      },
    },
    {
      name: 'one team Home Adjustment',
      overrides: {
        ratings: [
          productionRatings[0],
          { ...productionRatings[1], homeAdjustment: 0.8 },
        ],
      },
    },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const changed = await captureSnapshot(item.overrides)

      assert.notEqual(control.productionSnapshotId, changed.productionSnapshotId)
    })
  }
})

const makeComparableCandidate = ({
  baselineIdentity = BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  baselineSignature,
  candidateId,
  datasetSignature,
  productionSnapshotId = null,
  startingStateSignature,
}) =>
  createCalibrationCandidate({
    baseline: { identity: baselineIdentity },
    candidateId,
    candidateType: CANDIDATE_TYPES.BASE_MODEL,
    evaluation: {
      excludedGames: 0,
      games: 2,
      includedGames: 2,
      seasons: ['20242025'],
    },
    metadata: {
      baselineSignature,
      datasetSignature,
      productionSnapshotId,
      startingStateSignature,
    },
  })

test('comparability is conclusive for matching Step 2 identities', () => {
  const dataset = createCalibrationDatasetContext({
    includedGameIds: ['1', '2'],
    seasons: ['20242025'],
  })
  const startingState = createStartingStateIdentity(makeStartingState())
  const baseline = createBaselineConfigurationIdentity({
    configuration: makeBaselineConfiguration(),
    identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  })
  const identity = {
    baselineSignature: baseline.baselineSignature,
    datasetSignature: dataset.datasetSignature,
    startingStateSignature: startingState.startingStateSignature,
  }
  const left = makeComparableCandidate({ candidateId: 'left', ...identity })
  const right = makeComparableCandidate({ candidateId: 'right', ...identity })

  assert.deepEqual(compareCalibrationCandidates(left, right), {
    comparable: true,
    warnings: [],
  })
})

test('comparability reports the exact Step 2 identity that differs', async (t) => {
  const base = {
    baselineSignature: 'baseline-a',
    datasetSignature: 'dataset-a',
    startingStateSignature: 'starting-a',
  }
  const cases = [
    ['datasetSignature', 'dataset-b', 'DATASET_SIGNATURE_MISMATCH'],
    [
      'startingStateSignature',
      'starting-b',
      'STARTING_STATE_SIGNATURE_MISMATCH',
    ],
    ['baselineSignature', 'baseline-b', 'BASELINE_SIGNATURE_MISMATCH'],
  ]

  for (const [field, value, expectedCode] of cases) {
    await t.test(expectedCode, () => {
      const left = makeComparableCandidate({ candidateId: 'left', ...base })
      const right = makeComparableCandidate({
        candidateId: 'right',
        ...base,
        [field]: value,
      })
      const safety = compareCalibrationCandidates(left, right)

      assert.equal(safety.comparable, false)
      assert.equal(safety.warnings[0].code, expectedCode)
      assert.deepEqual(safety.warnings[0].details, {
        left: base[field],
        right: value,
      })
    })
  }
})

test('production comparability requires the same production snapshot ID', () => {
  const common = {
    baselineIdentity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
    baselineSignature: 'baseline-a',
    datasetSignature: 'dataset-a',
    startingStateSignature: 'starting-a',
  }
  const left = makeComparableCandidate({
    candidateId: 'left',
    productionSnapshotId: 'production-a',
    ...common,
  })
  const right = makeComparableCandidate({
    candidateId: 'right',
    productionSnapshotId: 'production-b',
    ...common,
  })
  const safety = compareCalibrationCandidates(left, right)

  assert.equal(safety.comparable, false)
  assert.equal(
    safety.warnings[0].code,
    'PRODUCTION_SNAPSHOT_ID_MISMATCH',
  )
})

test('legacy adapters populate identities only from an explicitly supplied frozen context', async () => {
  const datasetContext = createCalibrationDatasetContext({
    includedGameIds: ['1', '2'],
    seasons: ['20242025'],
  })
  const startingStateIdentity = createStartingStateIdentity(makeStartingState())
  const productionSnapshot = await captureSnapshot()
  const [candidate] = adaptBaseModelCalibrationResult(
    {
      dataset: { gamesIncluded: 2, gamesSkipped: 0 },
      metrics: { brierScore: 0.22 },
      modelVersion: 'power-rating-v1',
      seasonResults: [
        {
          dataset: { gamesIncluded: 2 },
          metrics: { brierScore: 0.22 },
          seasonId: '20242025',
        },
      ],
    },
    { datasetContext, productionSnapshot, startingStateIdentity },
  )

  assert.equal(
    candidate.baseline.identity,
    BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  )
  assert.equal(candidate.metadata.datasetSignature, datasetContext.datasetSignature)
  assert.equal(
    candidate.metadata.startingStateSignature,
    startingStateIdentity.startingStateSignature,
  )
  assert.equal(
    candidate.metadata.baselineSignature,
    productionSnapshot.baselineSignature,
  )
  assert.equal(
    candidate.metadata.productionSnapshotId,
    productionSnapshot.productionSnapshotId,
  )
})
