const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  applyExperimentOverrides,
  normalizeReplayConfiguration,
} = require('../calibration/calibrationOrchestrator')
const {
  buildProductionConfiguration,
} = require('../calibration/calibrationProductionSnapshot')
const {
  createDeterministicSignature,
  createProductionConfigurationSignature,
} = require('../calibration/calibrationIdentity')
const {
  createCalibrationPromotionPreviewStore,
} = require('../calibration/calibrationPromotionPreviewStore')
const {
  CalibrationPromotionError,
  applyCalibrationPromotion,
  createCalibrationPromotionPreview,
  getProductionFamilyStates,
} = require('../calibration/calibrationPromotionService')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
} = require('../calibration/calibrationResultContract')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
} = require('../services/ratingEngineSettingsService')
const {
  DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS,
} = require('../services/quickRematchSettingsService')

const clone = (value) => JSON.parse(JSON.stringify(value))

const makeState = () => ({
  engine: {
    ...DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
    modelVersion: 'base-model-v1',
  },
  schedule: { ...DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS },
  teams: [
    { adjustment: 0.25, teamId: 'BOS' },
    { adjustment: -0.25, teamId: 'NYR' },
  ],
})

const snapshotFromState = (state) => {
  const built = buildProductionConfiguration({
    engineSettings: state.engine,
    scheduleSettings: state.schedule,
    teamHomeAdjustments: state.teams,
  })

  return {
    baselineIdentity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
    baselineSignature: built.baselineSignature,
    configuration: built.configuration,
    productionSnapshotId: createProductionConfigurationSignature(
      built.configuration,
    ),
  }
}

const candidateSignature = (configuration) => createDeterministicSignature(
  'nhl-edge/calibration-candidate-configuration/v1',
  configuration,
)

const makeExperiment = (type, overrides, candidateId = type.toLowerCase()) => ({
  candidateId,
  components: [],
  label: `${type} candidate`,
  overrides,
  type,
})

const makeContext = (state, experiments, options = {}) => {
  const snapshot = snapshotFromState(state)
  const baselineConfiguration = normalizeReplayConfiguration(
    snapshot.configuration,
  )
  const candidates = Object.fromEntries(experiments.map((experiment) => {
    const configuration = applyExperimentOverrides(
      baselineConfiguration,
      experiment,
    )
    const eligible = options.ineligibleCandidateId !== experiment.candidateId

    return [experiment.candidateId, {
      candidate: {
        candidateId: experiment.candidateId,
        candidateType: experiment.type,
        comparison: { deltaBrier: -0.001 },
        components: experiment.components ?? [],
        configuration,
        configurationSignature: candidateSignature(configuration),
        evaluation: { games: 30, seasons: ['20232024'] },
        label: experiment.label,
        metrics: { logLoss: 0.67, pooledBrier: 0.24 },
        modelVersion: configuration.model.modelVersion,
        perSeason: [{ brier: 0.24, games: 30, seasonId: '20232024' }],
        seasonConsistency: {
          seasonCount: 1,
          seasonsEqual: 0,
          seasonsImproved: 1,
          seasonsWorse: 0,
        },
      },
      eligible,
      observationSet: eligible ? { games: 30 } : null,
      ...(options.robustnessCandidateId === experiment.candidateId
        ? {
            robustnessSummary: {
              analysisId: 'analysis-1',
              available: true,
              bootstrap: {
                deltaBrier: {
                  intervalCrossesZero: false,
                  lower: -0.002,
                  proportionBetter: 0.98,
                  upper: -0.0002,
                },
              },
              observed: { deltaBrier: -0.001 },
              seasonSensitivity: {
                leaveOneSeasonOut: [],
                seasonsEqual: 0,
                seasonsImproved: 1,
                seasonsWorse: 0,
              },
            },
          }
        : {}),
    }]
  }))

  return {
    baseline: {
      candidateId: 'baseline',
      configuration: baselineConfiguration,
      identity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
      label: 'Current Production',
      metrics: { pooledBrier: 0.241 },
      modelVersion: baselineConfiguration.model.modelVersion,
      signature: snapshot.baselineSignature,
    },
    candidates,
    metadata: {
      baselineSignature: snapshot.baselineSignature,
      datasetSignature: 'dataset-signature',
      gameIdSignature: 'game-signature',
      productionSnapshotId: snapshot.productionSnapshotId,
      productionWrites: false,
      seasons: ['20232024'],
      startingStateSignature: 'starting-signature',
    },
    promotion: {
      teamHomeAdvantageSnapshot: {
        seasonId: '20232024',
        tiers: { BOS: 'Strong', NYR: 'Weak' },
      },
    },
    runId: options.runId ?? 'run-1',
  }
}

const createEnvironment = ({ context, initialState = makeState() }) => {
  let state = clone(initialState)
  const audits = []
  let writes = 0
  const previewStore = createCalibrationPromotionPreviewStore()
  const snapshotProvider = async () => snapshotFromState(state)
  const productionWriter = async ({ affectedFamilies, proposedProduction }) => {
    writes += 1
    if (affectedFamilies.includes(CANDIDATE_TYPES.REST_FATIGUE)) {
      Object.assign(
        state.schedule,
        proposedProduction[CANDIDATE_TYPES.REST_FATIGUE],
      )
    }
    if (affectedFamilies.includes(CANDIDATE_TYPES.QUICK_REMATCH)) {
      Object.assign(
        state.schedule,
        proposedProduction[CANDIDATE_TYPES.QUICK_REMATCH],
      )
    }
    if (affectedFamilies.includes(CANDIDATE_TYPES.SPECIAL_TEAMS)) {
      Object.assign(
        state.engine,
        proposedProduction[CANDIDATE_TYPES.SPECIAL_TEAMS],
      )
    }
    if (affectedFamilies.includes(CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE)) {
      state.teams = Object.entries(
        proposedProduction[CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]
          .teamAdjustments,
      ).map(([teamId, adjustment]) => ({ adjustment, teamId }))
    }
  }
  const transactionRunner = async (work) => {
    const before = clone(state)
    const auditCount = audits.length

    try {
      return await work({ id: 'test-session' })
    } catch (error) {
      state = before
      audits.splice(auditCount)
      throw error
    }
  }
  const auditWriter = async (record) => {
    audits.push(clone(record))
    return { id: `audit-${audits.length}`, ...record }
  }
  const serviceOptions = {
    auditWriter,
    contextProvider: () => context,
    previewStore,
    productionWriter,
    snapshotProvider,
    transactionRunner,
  }

  return {
    audits,
    getState: () => state,
    getWrites: () => writes,
    previewStore,
    productionWriter,
    serviceOptions,
    setState: (next) => { state = clone(next) },
    snapshotProvider,
  }
}

test('combined preview is server-authored, exact, read-only, and stable for one binding', async () => {
  const state = makeState()
  const combined = {
    candidateId: 'rest-quick',
    components: [
      makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, {
        backToBack: -1,
        backToBackTravel: -2,
        threeInFour: -0.5,
        wellRested: 0.25,
      }, 'rest'),
      makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
        enabled: true,
        loserAdjustment: 0.25,
        maximumDays: 7,
      }, 'quick'),
    ],
    label: 'Rest + Quick',
    overrides: {},
    type: CANDIDATE_TYPES.COMBINED,
  }
  const context = makeContext(state, [combined])
  const environment = createEnvironment({ context, initialState: state })
  const fixedClock = () => new Date('2026-08-31T12:00:00.000Z')
  const options = { ...environment.serviceOptions, clock: fixedClock }
  const first = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: combined.candidateId, runId: context.runId },
    options,
  )
  const second = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: combined.candidateId, runId: context.runId },
    options,
  )

  assert.equal(environment.getWrites(), 0)
  assert.equal(environment.audits.length, 0)
  assert.equal(first.promotionPreviewId, second.promotionPreviewId)
  assert.deepEqual(first.affectedFamilies, [
    CANDIDATE_TYPES.QUICK_REMATCH,
    CANDIDATE_TYPES.REST_FATIGUE,
  ])
  assert.equal(first.validation.candidateEligible, true)
  assert.equal(first.validation.stale, false)
  assert.equal(first.metadata.productionWrites, false)
  assert.equal(first.metadata.ttlMs, 10 * 60 * 1000)
  assert.equal(
    first.changes.some((change) =>
      change.path === 'backToBackAdjustment' &&
      change.before === -0.75 &&
      change.after === -1),
    true,
  )
  assert.equal(
    first.unchanged.some((field) =>
      field.path === 'quickRematchLoserAdjustment'),
    true,
  )
})

test('no-op preview reports NO_CHANGES and never writes or audits', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
    enabled: true,
    loserAdjustment: 0.25,
    maximumDays: 5,
  })
  const context = makeContext(state, [candidate])
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    environment.serviceOptions,
  )

  assert.equal(preview.validation.noChanges, true)
  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      environment.serviceOptions,
    ),
    (error) => error.details?.code === 'NO_CHANGES',
  )
  assert.equal(environment.getWrites(), 0)
  assert.equal(environment.audits.length, 0)
})

test('successful apply verifies readback, creates one concise audit, and is single-use', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, {
    backToBack: -1,
    backToBackTravel: -2,
    threeInFour: -0.5,
    wellRested: 0.25,
  })
  const context = makeContext(state, [candidate], {
    robustnessCandidateId: candidate.candidateId,
  })
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const result = await applyCalibrationPromotion(
    'user-1',
    { promotionPreviewId: preview.promotionPreviewId },
    environment.serviceOptions,
  )

  assert.equal(result.status, 'APPLIED')
  assert.equal(result.diagnostics.postWriteVerified, true)
  assert.equal(environment.audits.length, 1)
  assert.equal(environment.audits[0].applicationStatus, 'APPLIED')
  assert.equal(environment.audits[0].robustnessSummary.analysisId, 'analysis-1')
  assert.equal('observations' in environment.audits[0], false)
  assert.equal(environment.getState().schedule.backToBackAdjustment, -1)
  assert.equal(environment.getState().schedule.quickRematchMaximumDays, 5)
  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      environment.serviceOptions,
    ),
    (error) =>
      error.details?.code === 'PROMOTION_PREVIEW_CONSUMED' &&
      error.details.promotionId === result.promotionId,
  )
  assert.equal(environment.audits.length, 1)
})

test('apply rejects stale relevant state and preserves all candidate settings', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
    enabled: true,
    loserAdjustment: 0.5,
    maximumDays: 7,
  })
  const context = makeContext(state, [candidate])
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const changed = clone(environment.getState())
  changed.schedule.backToBackAdjustment = -1.5
  environment.setState(changed)

  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      environment.serviceOptions,
    ),
    (error) =>
      error.details?.code === 'PRODUCTION_STATE_CHANGED' &&
      error.details.changedFamilies.includes(CANDIDATE_TYPES.REST_FATIGUE),
  )
  assert.equal(environment.getWrites(), 0)
  assert.equal(environment.getState().schedule.quickRematchMaximumDays, 5)
  assert.equal(environment.audits.length, 0)
})

test('unrelated goalie guardrail changes do not invalidate a promotion', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
    enabled: true,
    loserAdjustment: 0.5,
    maximumDays: 7,
  })
  const context = makeContext(state, [candidate])
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const changed = clone(environment.getState())
  changed.engine.maximumGoaliePenalty = -3
  environment.setState(changed)

  const result = await applyCalibrationPromotion(
    'user-1',
    { promotionPreviewId: preview.promotionPreviewId },
    environment.serviceOptions,
  )

  assert.equal(result.status, 'APPLIED')
  assert.equal(environment.getState().engine.maximumGoaliePenalty, -3)
})

test('expired and cross-user previews cannot be applied', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
    enabled: true,
    loserAdjustment: 0.5,
    maximumDays: 7,
  })
  const context = makeContext(state, [candidate])
  const environment = createEnvironment({ context, initialState: state })
  let now = Date.parse('2026-08-31T12:00:00.000Z')
  const options = {
    ...environment.serviceOptions,
    clock: () => new Date(now),
    ttlMs: 1000,
  }
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    options,
  )

  await assert.rejects(
    createCalibrationPromotionPreview(
      'user-2',
      { candidateId: candidate.candidateId, runId: context.runId },
      {
        ...options,
        contextProvider: (userId) => userId === 'user-1' ? context : null,
      },
    ),
    (error) => error.details?.code === 'CALIBRATION_CONTEXT_UNAVAILABLE',
  )

  await assert.rejects(
    applyCalibrationPromotion(
      'user-2',
      { promotionPreviewId: preview.promotionPreviewId },
      options,
    ),
    (error) => error.details?.code === 'PROMOTION_PREVIEW_NOT_FOUND',
  )
  now += 1001
  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      options,
    ),
    (error) => error.details?.code === 'PROMOTION_PREVIEW_EXPIRED',
  )
  assert.equal(environment.getWrites(), 0)
})

test('second concurrent preview becomes stale after the first changes production', async () => {
  const state = makeState()
  const rest = makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, {
    backToBack: -1,
  }, 'rest')
  const quick = makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
    enabled: true,
    loserAdjustment: 0.5,
    maximumDays: 7,
  }, 'quick')
  const context = makeContext(state, [rest, quick])
  const environment = createEnvironment({ context, initialState: state })
  const previewA = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: rest.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const previewB = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: quick.candidateId, runId: context.runId },
    environment.serviceOptions,
  )

  await applyCalibrationPromotion(
    'user-1',
    { promotionPreviewId: previewA.promotionPreviewId },
    environment.serviceOptions,
  )
  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: previewB.promotionPreviewId },
      environment.serviceOptions,
    ),
    (error) => error.details?.code === 'PRODUCTION_STATE_CHANGED',
  )
  assert.equal(environment.getState().schedule.quickRematchMaximumDays, 5)
})

test('all four isolated feature families resolve to owned production fields only', async () => {
  const cases = [
    makeExperiment(CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE, {
      adjustments: [{ adjustment: 0.5, teamId: 'BOS' }],
      enabled: true,
    }),
    makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, { backToBack: -1 }),
    makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
      enabled: true,
      loserAdjustment: 0.5,
      maximumDays: 7,
    }),
    makeExperiment(CANDIDATE_TYPES.SPECIAL_TEAMS, {
      adjustment: 0.75,
      topBottomN: 8,
    }),
  ]

  for (const candidate of cases) {
    const state = makeState()
    const before = clone(state)
    const context = makeContext(state, [candidate])
    const environment = createEnvironment({ context, initialState: state })
    const preview = await createCalibrationPromotionPreview(
      'user-1',
      { candidateId: candidate.candidateId, runId: context.runId },
      environment.serviceOptions,
    )

    await applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      environment.serviceOptions,
    )

    assert.deepEqual(preview.affectedFamilies, [candidate.type])
    if (candidate.type !== CANDIDATE_TYPES.SPECIAL_TEAMS) {
      assert.deepEqual(environment.getState().engine, before.engine)
    }
    if (![CANDIDATE_TYPES.REST_FATIGUE, CANDIDATE_TYPES.QUICK_REMATCH]
      .includes(candidate.type)) {
      assert.deepEqual(environment.getState().schedule, before.schedule)
    }
    if (candidate.type !== CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE) {
      assert.deepEqual(environment.getState().teams, before.teams)
    }
  }
})

test('four-family COMBINED promotion commits every component as one verified unit', async () => {
  const state = makeState()
  const combined = {
    candidateId: 'all-features',
    components: [
      makeExperiment(CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE, {
        adjustments: [
          { adjustment: 0.5, teamId: 'BOS' },
          { adjustment: -0.5, teamId: 'NYR' },
        ],
      }, 'home'),
      makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, {
        backToBack: -1,
        backToBackTravel: -2,
      }, 'rest'),
      makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
        loserAdjustment: 0.5,
        maximumDays: 7,
      }, 'quick'),
      makeExperiment(CANDIDATE_TYPES.SPECIAL_TEAMS, {
        adjustment: 0.75,
        topBottomN: 8,
      }, 'special'),
    ],
    label: 'All feature families',
    overrides: {},
    type: CANDIDATE_TYPES.COMBINED,
  }
  const context = makeContext(state, [combined])
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: combined.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const result = await applyCalibrationPromotion(
    'user-1',
    { promotionPreviewId: preview.promotionPreviewId },
    environment.serviceOptions,
  )

  assert.deepEqual(result.affectedFamilies, [
    CANDIDATE_TYPES.QUICK_REMATCH,
    CANDIDATE_TYPES.REST_FATIGUE,
    CANDIDATE_TYPES.SPECIAL_TEAMS,
    CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  ])
  assert.equal(environment.getState().schedule.backToBackAdjustment, -1)
  assert.equal(environment.getState().schedule.quickRematchMaximumDays, 7)
  assert.equal(environment.getState().engine.specialTeamsAdjustment, 0.75)
  assert.deepEqual(environment.getState().teams, [
    { adjustment: 0.5, teamId: 'BOS' },
    { adjustment: -0.5, teamId: 'NYR' },
  ])
  assert.equal(environment.audits.length, 1)
  assert.equal(environment.audits[0].affectedFeatureFamilies.length, 4)
})

test('multi-family failure and failed post-write verification roll back completely', async () => {
  const state = makeState()
  const combined = {
    candidateId: 'rest-quick',
    components: [
      makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, { backToBack: -1 }, 'rest'),
      makeExperiment(CANDIDATE_TYPES.QUICK_REMATCH, {
        enabled: true,
        loserAdjustment: 0.5,
        maximumDays: 7,
      }, 'quick'),
    ],
    label: 'Rest + Quick',
    overrides: {},
    type: CANDIDATE_TYPES.COMBINED,
  }
  const context = makeContext(state, [combined])
  const environment = createEnvironment({ context, initialState: state })
  const before = clone(environment.getState())
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: combined.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  const failingOptions = {
    ...environment.serviceOptions,
    productionWriter: async (values) => {
      await environment.productionWriter(values)
      throw new Error('simulated mid-operation failure')
    },
  }

  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: preview.promotionPreviewId },
      failingOptions,
    ),
    /simulated mid-operation failure/,
  )
  assert.deepEqual(environment.getState(), before)
  assert.equal(environment.audits.length, 0)

  const freshPreview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: combined.candidateId, runId: context.runId },
    environment.serviceOptions,
  )
  await assert.rejects(
    applyCalibrationPromotion(
      'user-1',
      { promotionPreviewId: freshPreview.promotionPreviewId },
      {
        ...environment.serviceOptions,
        productionWriter: async () => {},
      },
    ),
    (error) => error.details?.code === 'POST_WRITE_VERIFICATION_FAILED',
  )
  assert.deepEqual(environment.getState(), before)
  assert.equal(environment.audits.length, 0)
})

test('base-model, failed, forged, and unsupported client requests are rejected', async () => {
  const state = makeState()
  const base = makeExperiment(CANDIDATE_TYPES.BASE_MODEL, { kFactor: 1.5 })
  const failed = makeExperiment(CANDIDATE_TYPES.REST_FATIGUE, {
    backToBack: -1,
  }, 'failed')
  const context = makeContext(state, [base, failed], {
    ineligibleCandidateId: failed.candidateId,
  })
  const environment = createEnvironment({ context, initialState: state })

  await assert.rejects(
    createCalibrationPromotionPreview(
      'user-1',
      { candidateId: base.candidateId, runId: context.runId },
      environment.serviceOptions,
    ),
    (error) => error.details?.code === 'BASE_MODEL_PROMOTION_UNSUPPORTED',
  )
  await assert.rejects(
    createCalibrationPromotionPreview(
      'user-1',
      { candidateId: failed.candidateId, runId: context.runId },
      environment.serviceOptions,
    ),
    (error) => error.details?.code === 'CANDIDATE_NOT_COMPARABLE',
  )
  await assert.rejects(
    createCalibrationPromotionPreview(
      'user-1',
      {
        candidateId: failed.candidateId,
        proposedSettings: { backToBackAdjustment: -3 },
        runId: context.runId,
        userId: 'attacker',
      },
      environment.serviceOptions,
    ),
    (error) =>
      error instanceof CalibrationPromotionError &&
      error.details.unsupportedFields.includes('proposedSettings') &&
      error.details.unsupportedFields.includes('userId'),
  )
  assert.equal(environment.getWrites(), 0)
})

test('production analysis family state matches the successfully promoted readback', async () => {
  const state = makeState()
  const candidate = makeExperiment(CANDIDATE_TYPES.SPECIAL_TEAMS, {
    adjustment: 0.75,
    topBottomN: 8,
  })
  const context = makeContext(state, [candidate])
  const environment = createEnvironment({ context, initialState: state })
  const preview = await createCalibrationPromotionPreview(
    'user-1',
    { candidateId: candidate.candidateId, runId: context.runId },
    environment.serviceOptions,
  )

  await applyCalibrationPromotion(
    'user-1',
    { promotionPreviewId: preview.promotionPreviewId },
    environment.serviceOptions,
  )

  const production = getProductionFamilyStates(
    snapshotFromState(environment.getState()).configuration,
  )

  assert.deepEqual(
    production[CANDIDATE_TYPES.SPECIAL_TEAMS],
    preview.proposedProduction[CANDIDATE_TYPES.SPECIAL_TEAMS],
  )
})
