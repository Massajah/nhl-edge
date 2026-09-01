import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let ModelCalibration
let RatingLab
let apiClient
let calibrationUtils
let simulationsApi
let vite

const productionConfiguration = {
  features: {
    quickRematch: {
      enabled: true,
      loserAdjustment: 0.25,
      maximumDays: 7,
    },
    restFatigue: {
      adjustments: {
        back_to_back: -0.75,
        back_to_back_travel: -1.5,
        '3_games_in_4_days': -0.5,
        well_rested: 0,
      },
      enabled: true,
      includeWellRested: false,
    },
    specialTeams: {
      adjustmentMagnitude: 0.5,
      automaticAdjustmentEnabled: true,
      enabled: true,
      topBottomN: 8,
    },
    teamHomeAdvantage: {
      adjustments: [{ adjustment: 0.5, teamId: 'BOS' }],
      enabled: true,
      mode: 'team_map',
    },
  },
  model: {
    baseHomeAdvantage: 3.5,
    kFactor: 1.3,
    overtimeMultiplier: 0.4,
    probabilityScale: 20,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
  },
}

const canonicalConfiguration = {
  ...productionConfiguration,
  features: {
    ...productionConfiguration.features,
    quickRematch: { enabled: false, loserAdjustment: 0, maximumDays: 7 },
    specialTeams: {
      adjustmentMagnitude: 0,
      automaticAdjustmentEnabled: false,
      enabled: false,
      topBottomN: 6,
    },
    teamHomeAdvantage: { adjustments: [], enabled: false, mode: 'team_map' },
  },
  model: {
    ...productionConfiguration.model,
    baseHomeAdvantage: 4,
    probabilityScale: 18,
  },
}

const options = {
  baselineModes: [
    {
      configuration: productionConfiguration,
      description: 'Current user-scoped model configuration.',
      id: 'CURRENT_PRODUCTION',
      label: 'Current Production',
      productionSnapshotId: 'snapshot-1',
    },
    {
      configuration: canonicalConfiguration,
      description: 'Fixed calibration reference.',
      id: 'CANONICAL_BASE_MODEL_V1',
      label: 'Canonical Base Model v1',
      productionSnapshotId: null,
    },
  ],
  candidateDefinitions: {
    quickRematch: {
      adjustmentOptions: [0, 0.1, 0.25, 0.5],
      windowOptions: [3, 5, 7, 10, 14],
    },
    restFatigue: {
      precedence: [
        'back_to_back_travel',
        'back_to_back',
        '3_games_in_4_days',
        'well_rested',
      ],
      rules: [
        { id: 'well_rested', label: 'Well Rested', presetValues: [0, 0.25] },
        { id: '3_games_in_4_days', label: '3 Games in 4 Days', presetValues: [0, -0.5] },
        { id: 'back_to_back', label: 'Back-to-Back', presetValues: [0, -0.75] },
        { id: 'back_to_back_travel', label: 'Back-to-Back + Travel', presetValues: [0, -1.5] },
      ],
    },
    specialTeams: {
      adjustmentOptions: [0, 0.25, 0.5, 0.75, 1],
      thresholdOptions: [6, 8, 10],
    },
    teamHomeAdvantage: {
      adjustmentOptions: [0, 0.25, 0.5, 0.75, 1],
    },
  },
  defaultBaselineMode: 'CURRENT_PRODUCTION',
  defaultSeasonIds: ['20232024', '20242025', '20252026'],
  isolation: { productionWrites: false, readOnly: true },
  seasons: ['20232024', '20242025', '20252026'].map((id) => ({
    historicalDataset: { status: 'ready' },
    id,
    label: `${id.slice(0, 4)}–${id.slice(6)}`,
    readiness: {
      baseModel: true,
      quickRematch: true,
      restFatigue: true,
      specialTeams: true,
      teamHomeAdvantage: true,
    },
  })),
  startingState: {
    description: 'Each season starts from the fixed 42–50 Base Model spread.',
    label: 'Fixed 42–50 historical ordering',
    policy: 'FIXED_SPREAD_ALPHABETICAL',
  },
}

const makeCandidate = ({
  accuracy = 0.564,
  averageSeasonBrier,
  candidateId,
  candidateType = 'BASE_MODEL',
  comparable = true,
  deltaAccuracy = null,
  deltaBrier,
  deltaLogLoss = null,
  ece = 0.018,
  executionStatus = 'completed',
  label,
  logLoss = 0.681,
  pooledBrier,
  seasonsImproved = 2,
  worstSeasonBrier,
}) => ({
  candidateId,
  candidateType,
  comparison: {
    deltaAccuracy,
    deltaBrier,
    deltaLogLoss,
  },
  diagnostics: {
    comparability: {
      comparable,
      warnings: comparable
        ? []
        : [{ code: 'STARTING_STATE_MISMATCH', message: 'Starting state differs.' }],
    },
    error: executionStatus === 'failed'
      ? { code: 'FixtureError', message: 'Candidate replay failed.' }
      : null,
    executionStatus,
    seasonConsistency: {
      seasonCount: 3,
      seasonsEqual: 0,
      seasonsImproved,
      seasonsWorse: 3 - seasonsImproved,
    },
  },
  evaluation: { games: executionStatus === 'failed' ? 0 : 3936, seasons: options.defaultSeasonIds },
  label,
  metadata: {
    baselineSignature: 'baseline-signature',
    configurationSignature: executionStatus === 'failed'
      ? null
      : `configuration-${candidateId}`,
    datasetSignature: 'dataset-signature',
    productionSnapshotId: 'snapshot-1',
    startingStateSignature: 'starting-signature',
  },
  metrics: {
    accuracy: executionStatus === 'failed' ? null : accuracy,
    averageSeasonBrier: executionStatus === 'failed'
      ? null
      : averageSeasonBrier ?? pooledBrier,
    ece: executionStatus === 'failed' ? null : ece,
    logLoss: executionStatus === 'failed' ? null : logLoss,
    pooledBrier: executionStatus === 'failed' ? null : pooledBrier,
    worstSeasonBrier: executionStatus === 'failed'
      ? null
      : worstSeasonBrier ?? pooledBrier + 0.001,
  },
  overrides: candidateType === 'SPECIAL_TEAMS'
    ? { adjustment: 0.5, topBottomN: 8 }
    : { kFactor: 1.1 },
  perSeason: executionStatus === 'failed'
    ? []
    : options.defaultSeasonIds.map((seasonId, index) => ({
        accuracy: 0.56 + index / 100,
        brier: pooledBrier + (index - 1) / 1000,
        ece: 0.018 + index / 1000,
        games: 1312,
        logLoss: 0.681 + index / 1000,
        seasonId,
      })),
})

const baseline = makeCandidate({
  candidateId: 'baseline',
  candidateType: 'BASELINE',
  deltaBrier: null,
  label: 'Current Production',
  pooledBrier: 0.2418,
  seasonsImproved: 0,
})
baseline.overrides = {}
baseline.perSeason = baseline.perSeason.map((season, index) => ({
  ...season,
  brier: 0.2418 + (index - 1) / 1000,
}))

const rankedSecond = makeCandidate({
  candidateId: 'team-ha',
  candidateType: 'TEAM_HOME_ADVANTAGE',
  deltaBrier: -0.0011,
  label: 'Team HA ±0.50',
  pooledBrier: 0.2407,
})
rankedSecond.overrides = { adjustment: 0.5 }

const rankedFirst = makeCandidate({
  candidateId: 'special-teams',
  candidateType: 'SPECIAL_TEAMS',
  deltaBrier: -0.0019,
  label: 'Special Teams candidate',
  pooledBrier: 0.2399,
  seasonsImproved: 3,
})

const combinedCandidate = makeCandidate({
  candidateId: 'combined-special-ha',
  candidateType: 'COMBINED',
  deltaBrier: -0.0021,
  label: 'Combined · Special Teams + Team HA',
  pooledBrier: 0.2397,
  seasonsImproved: 3,
})
combinedCandidate.components = [
  {
    candidateId: 'special-teams',
    label: 'Special Teams candidate',
    overrides: { adjustment: 0.5, topBottomN: 8 },
    type: 'SPECIAL_TEAMS',
  },
  {
    candidateId: 'team-ha',
    label: 'Team HA ±0.50',
    overrides: { adjustment: 0.5 },
    type: 'TEAM_HOME_ADVANTAGE',
  },
]
combinedCandidate.configuration = productionConfiguration
combinedCandidate.diagnostics.interaction = {
  bestComponentBrier: 0.2399,
  bestComponentCandidateId: 'special-teams',
  combinedVsBestComponentDeltaBrier: -0.0002,
  componentCandidateIds: ['special-teams', 'team-ha'],
  interpretation: 'descriptive_only_not_a_statistical_interaction_estimate',
}
combinedCandidate.overrides = {
  SPECIAL_TEAMS: { adjustment: 0.5, topBottomN: 8 },
  TEAM_HOME_ADVANTAGE: { adjustment: 0.5 },
}

const nonComparable = makeCandidate({
  candidateId: 'non-comparable',
  comparable: false,
  deltaBrier: -0.003,
  label: 'Different starting state',
  pooledBrier: 0.2388,
})

const failed = makeCandidate({
  candidateId: 'failed-candidate',
  deltaBrier: null,
  executionStatus: 'failed',
  label: 'Failed candidate',
  pooledBrier: null,
})

const result = {
  baseline,
  baselineMode: 'CURRENT_PRODUCTION',
  candidates: [rankedSecond, nonComparable, failed, rankedFirst],
  diagnostics: { productionWrites: false },
  evaluationContext: {
    baselineConfiguration: productionConfiguration,
    baselineSignature: 'baseline-signature',
    datasetSignature: 'dataset-signature',
    gameCount: 3936,
    gameIdSignature: 'game-id-signature',
    productionSnapshotId: 'snapshot-1',
    startingStateSignature: 'starting-signature',
  },
  ranking: {
    comparable: [
      { candidateId: 'special-teams', rank: 1 },
      { candidateId: 'team-ha', rank: 2 },
    ],
    failed: [{ candidateId: 'failed-candidate' }],
    notComparable: [{ candidateId: 'non-comparable' }],
  },
  runId: 'calibration-run-1',
}

const robustnessResult = {
  analysisId: 'robustness-analysis-1',
  baseline: {
    identity: 'CURRENT_PRODUCTION',
    label: 'Current Production',
    signature: 'baseline-signature',
  },
  bootstrap: {
    deltaBrier: {
      intervalCrossesZero: true,
      lower: -0.0031,
      mean: -0.00182,
      median: -0.00185,
      proportionBetter: 0.928,
      proportionEqual: 0,
      proportionWorse: 0.072,
      upper: 0.00006,
    },
    deltaLogLoss: {
      intervalCrossesZero: true,
      lower: -0.007,
      mean: -0.0021,
      median: -0.002,
      proportionBetter: 0.91,
      proportionEqual: 0,
      proportionWorse: 0.09,
      upper: 0.0004,
    },
  },
  candidate: {
    candidateId: rankedFirst.candidateId,
    candidateType: rankedFirst.candidateType,
    configurationSignature: rankedFirst.metadata.configurationSignature,
    label: rankedFirst.label,
  },
  diagnostics: {
    bootstrapRerunsReplay: false,
    durationMs: 34,
    pairedObservations: true,
    productionWrites: false,
  },
  metadata: {
    baselineSignature: 'baseline-signature',
    datasetSignature: 'dataset-signature',
    gameIdSignature: 'game-id-signature',
    modelVersion: 'base-model-v1',
    productionSnapshotId: 'snapshot-1',
    productionWrites: false,
    startingStateSignature: 'starting-signature',
  },
  method: {
    blockDefinition:
      "7-day fixed chronological calendar blocks anchored to each season's first included game",
    blockSizeDays: 7,
    intervalLevel: 0.95,
    intervalMethod: 'percentile',
    replicates: 2500,
    resamplingMethod: 'season_stratified_temporal_block_bootstrap',
    seed: 123456789,
    totalBlocks: 78,
  },
  observationSet: {
    games: 3936,
    seasons: options.defaultSeasonIds,
    signature: 'sha256:observation-signature',
  },
  observed: {
    baselineBrier: 0.2418,
    baselineLogLoss: 0.683,
    brier: 0.2399,
    deltaBrier: -0.0019,
    deltaLogLoss: -0.002,
    logLoss: 0.681,
  },
  runId: result.runId,
  seasonSensitivity: {
    leaveOneSeasonOut: options.defaultSeasonIds.map((seasonId, index) => ({
      deltaBrier: [-0.0012, 0.0001, -0.0024][index],
      directionChanged: index === 1,
      excludedSeasonId: seasonId,
      gamesRetained: 2624,
    })),
    perSeason: options.defaultSeasonIds.map((seasonId, index) => ({
      deltaBrier: [-0.0022, 0.0003, -0.0038][index],
      games: 1312,
      seasonId,
    })),
    resultSensitiveToSeasonRemoval: true,
    seasonsEqual: 0,
    seasonsImproved: 2,
    seasonsWorse: 1,
  },
  warnings: [
    {
      code: 'POST_SELECTION_CAUTION',
      message: 'Repeated evaluation can introduce selection bias.',
    },
  ],
}

const promotionPreview = {
  affectedFamilies: ['SPECIAL_TEAMS'],
  candidate: {
    calibrationResult: {
      comparison: rankedFirst.comparison,
      metrics: rankedFirst.metrics,
      perSeason: rankedFirst.perSeason,
      seasonConsistency: rankedFirst.diagnostics.seasonConsistency,
    },
    candidateId: rankedFirst.candidateId,
    candidateType: rankedFirst.candidateType,
    configurationSignature: rankedFirst.metadata.configurationSignature,
    label: rankedFirst.label,
  },
  changes: [{
    after: 0.75,
    before: 0.5,
    changed: true,
    family: 'SPECIAL_TEAMS',
    familyLabel: 'Special Teams',
    label: 'Adjustment',
    path: 'specialTeamsAdjustment',
  }],
  currentProduction: {
    SPECIAL_TEAMS: {
      specialTeamsAdjustment: 0.5,
      specialTeamsAlertsEnabled: true,
      specialTeamsMode: 'automatic',
      specialTeamsRankThreshold: 8,
    },
  },
  diff: [{
    family: 'SPECIAL_TEAMS',
    label: 'Special Teams',
    fields: [
      {
        after: 0.75,
        before: 0.5,
        changed: true,
        label: 'Adjustment',
        path: 'specialTeamsAdjustment',
      },
      {
        after: 8,
        before: 8,
        changed: false,
        label: 'Top / Bottom N',
        path: 'specialTeamsRankThreshold',
      },
    ],
  }],
  metadata: {
    createdAt: '2026-08-31T12:00:00.000Z',
    expiresAt: '2026-08-31T12:10:00.000Z',
    productionWrites: false,
    ttlMs: 600000,
  },
  promotionPreviewId: 'preview-1',
  proposedProduction: {
    SPECIAL_TEAMS: {
      specialTeamsAdjustment: 0.75,
      specialTeamsAlertsEnabled: true,
      specialTeamsMode: 'automatic',
      specialTeamsRankThreshold: 8,
    },
  },
  robustnessSummary: {
    analysisId: robustnessResult.analysisId,
    available: true,
    bootstrap: {
      deltaBrier: {
        ...robustnessResult.bootstrap.deltaBrier,
        intervalCrossesZero: false,
      },
    },
    observed: { deltaBrier: robustnessResult.observed.deltaBrier },
    seasonSensitivity: robustnessResult.seasonSensitivity,
  },
  runIdentity: {
    baselineIdentity: 'CURRENT_PRODUCTION',
    baselineSignature: 'baseline-signature',
    datasetSignature: 'dataset-signature',
    gameIdSignature: 'game-id-signature',
    modelVersion: 'base-model-v1',
    productionSnapshotId: 'snapshot-1',
    runId: result.runId,
    startingStateSignature: 'starting-signature',
  },
  unchanged: [{
    after: 8,
    before: 8,
    changed: false,
    family: 'SPECIAL_TEAMS',
    familyLabel: 'Special Teams',
    label: 'Top / Bottom N',
    path: 'specialTeamsRankThreshold',
  }],
  validation: {
    candidateEligible: true,
    noChanges: false,
    productionSnapshotCurrent: true,
    stale: false,
  },
}

const promotionResult = {
  affectedFamilies: ['SPECIAL_TEAMS'],
  appliedAt: '2026-08-31T12:03:00.000Z',
  auditId: 'audit-1',
  promotionId: 'promotion-1',
  status: 'APPLIED',
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })

  ModelCalibration = (
    await vite.ssrLoadModule('/src/components/ModelCalibration.jsx')
  ).default
  RatingLab = (
    await vite.ssrLoadModule('/src/components/RatingLab.jsx')
  ).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  calibrationUtils = await vite.ssrLoadModule('/src/utils/modelCalibration.js')
  simulationsApi = await vite.ssrLoadModule(
    '/src/services/powerRatingSimulationsApi.js',
  )
})

after(async () => {
  await vite?.close()
})

const renderModelCalibration = (props = {}) =>
  renderToStaticMarkup(React.createElement(ModelCalibration, {
    initialOptions: options,
    ...props,
  }))

test('Rating Lab exposes the unified navigation and preserves Advanced Labs', () => {
  const replayHtml = renderToStaticMarkup(React.createElement(RatingLab))
  const baseHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'calibration',
  }))
  const homeHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'home-advantage',
  }))
  const scheduleHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'schedule-context',
  }))
  const specialTeamsHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'special-teams',
  }))

  assert.match(replayHtml, /Historical Replay/)
  assert.match(replayHtml, /Model Calibration/)
  assert.match(replayHtml, /Advanced Labs/)
  assert.match(replayHtml, /Run Replay/)
  assert.match(baseHtml, /Base Model Calibration/)
  assert.match(homeHtml, /Loading Team Home Advantage/)
  assert.match(scheduleHtml, /Loading Schedule &amp; Context calibration/)
  assert.match(specialTeamsHtml, /Loading Special Teams calibration/)
  assert.doesNotMatch(baseHtml, /Deprecated|Legacy/)
})

test('request construction maps baselines and builds only explicit selected combinations', () => {
  const form = calibrationUtils.createModelCalibrationForm(options)

  assert.equal(form.baselineMode, 'CURRENT_PRODUCTION')
  form.teamHomeAdvantage.selectedAdjustments = [0.5]
  form.specialTeams.enabled = true
  const request = calibrationUtils.createModelCalibrationRequest(form)

  assert.deepEqual(request.evaluationSeasons, options.defaultSeasonIds)
  assert.equal(request.startingStatePolicy, 'FIXED_SPREAD_ALPHABETICAL')
  assert.equal(request.experiments.length, 2)
  assert.deepEqual(
    request.experiments.map((candidate) => candidate.type),
    ['TEAM_HOME_ADVANTAGE', 'SPECIAL_TEAMS'],
  )
  assert.equal(request.experiments.some((candidate) => candidate.type === 'COMBINED'), false)
  assert.equal(
    request.experiments.some((candidate) =>
      Object.hasOwn(candidate.overrides, 'adjustment') &&
      Object.hasOwn(candidate.overrides, 'topBottomN')),
    true,
  )

  const isolatedIds = request.experiments.map((candidate) =>
    candidate.candidateId)

  form.combinedDraftCandidateIds = [...isolatedIds].reverse()
  const withCombined = calibrationUtils.addModelCalibrationCombinedSelection(form)
  const combinedRequest = calibrationUtils.createModelCalibrationRequest(
    withCombined,
  )
  const combined = combinedRequest.experiments.find((candidate) =>
    candidate.type === 'COMBINED')

  assert.equal(combinedRequest.experiments.length, 3)
  assert.ok(combined)
  assert.deepEqual(
    combined.components.map((component) => component.type),
    ['SPECIAL_TEAMS', 'TEAM_HOME_ADVANTAGE'],
  )
  assert.deepEqual(
    combined.components.map((component) => component.candidateId),
    ['special-teams-8-0-5', 'team-ha-0-5'],
  )
  assert.equal(
    calibrationUtils.createCombinedModelCalibrationExperiment(
      isolatedIds,
      request.experiments,
    ).candidateId,
    combined.candidateId,
  )

  const canonicalForm = calibrationUtils.createModelCalibrationForm({
    ...options,
    defaultBaselineMode: 'CANONICAL_BASE_MODEL_V1',
  })
  assert.equal(canonicalForm.baselineMode, 'CANONICAL_BASE_MODEL_V1')
  assert.match(
    calibrationUtils.validateModelCalibrationForm(options, {
      ...form,
      baselineMode: '',
    }),
    /explicit baseline/,
  )
})

test('combined-candidate helpers support multiple add/remove operations and reject duplicate families', () => {
  let form = calibrationUtils.createModelCalibrationForm(options)

  form.teamHomeAdvantage.selectedAdjustments = [0.25, 0.5]
  form.restFatigue.enabled = true
  form.quickRematch.enabled = true
  const isolated = calibrationUtils.createIsolatedModelCalibrationExperiments(form)
  const homeCandidates = isolated.filter((candidate) =>
    candidate.type === 'TEAM_HOME_ADVANTAGE')
  const rest = isolated.find((candidate) => candidate.type === 'REST_FATIGUE')
  const quick = isolated.find((candidate) => candidate.type === 'QUICK_REMATCH')

  assert.equal(
    calibrationUtils.createCombinedModelCalibrationExperiment(
      homeCandidates.map((candidate) => candidate.candidateId),
      isolated,
    ),
    null,
  )

  form.combinedDraftCandidateIds = [homeCandidates[0].candidateId, rest.candidateId]
  form = calibrationUtils.addModelCalibrationCombinedSelection(form)
  form.combinedDraftCandidateIds = [homeCandidates[1].candidateId, quick.candidateId]
  form = calibrationUtils.addModelCalibrationCombinedSelection(form)

  let combined = calibrationUtils.createModelCalibrationExperiments(form)
    .filter((candidate) => candidate.type === 'COMBINED')

  assert.equal(combined.length, 2)
  assert.equal(calibrationUtils.validateModelCalibrationForm(options, form), '')

  form = calibrationUtils.removeModelCalibrationCombinedSelection(
    form,
    combined[0].candidateId,
  )
  combined = calibrationUtils.createModelCalibrationExperiments(form)
    .filter((candidate) => candidate.type === 'COMBINED')

  assert.equal(combined.length, 1)
  assert.deepEqual(
    combined[0].components.map((component) => component.type),
    ['QUICK_REMATCH', 'TEAM_HOME_ADVANTAGE'],
  )

  const completedRequest = calibrationUtils.createModelCalibrationRequest(form)
  const frozenRequestSnapshot = JSON.stringify(completedRequest)

  form.quickRematch.loserAdjustment = 0.1
  form.combinedCandidates = []
  assert.equal(JSON.stringify(completedRequest), frozenRequestSnapshot)
})

test('focused client API uses authenticated Model Calibration routes', async () => {
  const originalFetch = globalThis.fetch
  const captured = []

  apiClient.setAuthToken('calibration-token')
  globalThis.fetch = async (url, requestOptions) => {
    captured.push({
      body: requestOptions.body ? JSON.parse(requestOptions.body) : null,
      headers: requestOptions.headers,
      method: requestOptions.method,
      url,
    })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  const payload = { baselineMode: 'CURRENT_PRODUCTION', experiments: [] }
  const robustnessPayload = {
    candidateId: 'candidate-1',
    runId: 'run-1',
  }

  try {
    await simulationsApi.getModelCalibrationOptions()
    await simulationsApi.runModelCalibration(payload)
    await simulationsApi.runModelCalibrationRobustness(robustnessPayload)
    await simulationsApi.previewModelCalibrationPromotion(robustnessPayload)
    await simulationsApi.applyModelCalibrationPromotion('preview-1')
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(captured.map((request) => [request.method, request.url]), [
    ['GET', '/api/power-rating-simulations/model-calibration/options'],
    ['POST', '/api/power-rating-simulations/model-calibration/run'],
    ['POST', '/api/power-rating-simulations/model-calibration/robustness'],
    ['POST', '/api/power-rating-simulations/model-calibration/promotion/preview'],
    ['POST', '/api/power-rating-simulations/model-calibration/promotion/apply'],
  ])
  assert.equal(captured[0].headers.get('Authorization'), 'Bearer calibration-token')
  assert.deepEqual(captured[1].body, payload)
  assert.deepEqual(captured[3].body, robustnessPayload)
  assert.deepEqual(captured[4].body, { promotionPreviewId: 'preview-1' })
  assert.deepEqual(captured[2].body, robustnessPayload)
})

test('Model Calibration renders compact workflow, readiness, baseline and candidate count', () => {
  const html = renderModelCalibration({
    initialExpandedFamilies: ['baseModel'],
  })

  assert.match(html, /Read-only calibration/)
  assert.match(html, /No production writes/)
  assert.match(html, /2023–24/)
  assert.match(html, /Current Production/)
  assert.match(html, /Canonical Base Model v1/)
  assert.match(html, /Current user-scoped model configuration/)
  assert.match(html, /Probability Scale/)
  assert.match(html, /20\.00/)
  assert.match(html, /Starting state/)
  assert.match(html, /Isolated candidates change one selected feature family/)
  assert.match(html, /Combined candidates test only the explicit cross-family combinations/)
  assert.match(html, /Baseline \+ 0 isolated \+ 0 combined/)
  assert.match(
    html,
    /Run Calibration is unavailable: Select at least one isolated candidate/,
  )
  assert.match(html, /Starting Rating experiments remain in Advanced Labs/)
  assert.match(html, /Selected Combined Candidates/)
  assert.match(html, /Configure isolated feature candidates above/)
  assert.match(html, /Add explicit combination/)
  assert.match(html, /Only combinations you explicitly add are evaluated/)
  assert.match(html, /1 total evaluations/)
  assert.match(
    html,
    /<button[^>]*aria-describedby="model-calibration-run-reason"[^>]*disabled[^>]*>/,
  )
})

test('results respect server ranking and preserve baseline, non-comparable and failed rows', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst, rankedSecond, nonComparable, failed],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: result,
  })

  const baselineIndex = html.indexOf('Current Production')
  const firstIndex = html.indexOf('Special Teams candidate')
  const secondIndex = html.indexOf('Team HA ±0.50')
  const nonComparableIndex = html.indexOf('Different starting state')
  const failedIndex = html.indexOf('Failed candidate')

  assert.ok(baselineIndex >= 0)
  assert.ok(firstIndex > baselineIndex)
  assert.ok(secondIndex > firstIndex)
  assert.ok(nonComparableIndex > secondIndex)
  assert.ok(failedIndex > nonComparableIndex)
  assert.match(html, /-0\.0019/)
  assert.match(html, /Best comparable Brier/)
  assert.match(html, /Not directly comparable/)
  assert.match(html, />Failed</)
  assert.match(html, /Lower Brier is better/)
  assert.doesNotMatch(html, />Apply<|>Promote<|Save to Production/)
})

test('expanded candidate and baseline rows show frozen overrides and per-season metrics', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialExpandedRowIds: ['baseline', 'special-teams'],
    initialResult: result,
  })

  assert.match(html, /Frozen baseline configuration/)
  assert.match(html, /Frozen production snapshot used for this run/)
  assert.match(html, /Exact frozen feature configuration/)
  assert.match(html, /3 Games in 4 Days/)
  assert.match(html, /1 exact team adjustments/)
  assert.match(html, /Tested override/)
  assert.match(html, /Top \/ Bottom N/)
  assert.match(html, /0\.50/)
  assert.match(html, /Season breakdown/)
  assert.match(html, /2023–24/)
  assert.match(html, /ECE/)
  assert.match(html, /3 improved · 0 equal · 0 worse/)
  assert.match(html, /Run Details/)
  assert.match(html, /calibration-run-1/)
})

test('combined results use the shared table and disclose components, configuration and descriptive diagnostics', () => {
  const combinedResult = {
    ...result,
    candidates: [rankedFirst, rankedSecond, combinedCandidate],
    ranking: {
      comparable: [
        { candidateId: combinedCandidate.candidateId, rank: 1 },
        { candidateId: rankedFirst.candidateId, rank: 2 },
        { candidateId: rankedSecond.candidateId, rank: 3 },
      ],
      unranked: [],
    },
  }
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst, rankedSecond, combinedCandidate],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialExpandedRowIds: [combinedCandidate.candidateId],
    initialResult: combinedResult,
  })

  assert.match(html, /Combined · Special Teams \+ Team HA/)
  assert.match(html, /model-calibration-type-badge combined/)
  assert.match(html, /Combined Candidate · 2 features/)
  assert.match(html, /Combined components/)
  assert.match(html, /Special Teams candidate/)
  assert.match(html, /Team HA ±0\.50/)
  assert.match(html, /Exact frozen feature configuration/)
  assert.match(html, /Descriptive component comparison/)
  assert.match(html, /Best included isolated component Brier/)
  assert.match(html, /not a statistical interaction estimate/)
})

test('shortlist helpers add, remove, deduplicate and enforce baseline, comparability and the five-candidate limit', () => {
  const comparableCandidates = Array.from({ length: 6 }, (_, index) =>
    makeCandidate({
      candidateId: `candidate-${index + 1}`,
      deltaBrier: -0.001 - index / 10000,
      label: `Candidate ${index + 1}`,
      pooledBrier: 0.24 - index / 10000,
    }))
  const shortlistResult = {
    ...result,
    candidates: [...comparableCandidates, nonComparable],
    ranking: {
      comparable: comparableCandidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        rank: index + 1,
      })),
    },
    runId: 'shortlist-run-a',
  }
  let state = calibrationUtils.createModelCalibrationShortlistState(
    shortlistResult,
  )

  const add = (candidateId) => {
    const update = calibrationUtils.updateModelCalibrationShortlist(
      shortlistResult,
      state,
      candidateId,
      true,
    )

    state = update.state
    return update
  }

  add('candidate-1')
  const afterDuplicate = add('candidate-1')
  assert.deepEqual(state.candidateIds, ['candidate-1'])
  assert.equal(afterDuplicate.message, '')

  const nonComparableUpdate = add(nonComparable.candidateId)
  assert.equal(
    nonComparableUpdate.message,
    'Not directly comparable to this run baseline.',
  )
  assert.deepEqual(state.candidateIds, ['candidate-1'])

  comparableCandidates.slice(1, 5).forEach((candidate) =>
    add(candidate.candidateId))
  const sixthUpdate = add('candidate-6')
  assert.equal(
    sixthUpdate.message,
    'Shortlist supports up to 5 candidates.',
  )
  assert.equal(state.candidateIds.length, 5)
  assert.equal(state.candidateIds.includes('candidate-6'), false)

  const baselineUpdate = calibrationUtils.updateModelCalibrationShortlist(
    shortlistResult,
    state,
    baseline.candidateId,
    false,
  )
  assert.deepEqual(baselineUpdate.state, state)
  assert.equal(
    calibrationUtils.getOrderedModelCalibrationShortlist(
      shortlistResult,
      state,
    )[0].candidateId,
    baseline.candidateId,
  )

  const removeUpdate = calibrationUtils.updateModelCalibrationShortlist(
    shortlistResult,
    state,
    'candidate-3',
    false,
  )
  assert.equal(removeUpdate.state.candidateIds.includes('candidate-3'), false)
})

test('a completed new run receives fresh shortlist state while form changes cannot alter frozen comparison data', () => {
  let runAState = calibrationUtils.createModelCalibrationShortlistState(result)

  runAState = calibrationUtils.updateModelCalibrationShortlist(
    result,
    runAState,
    rankedFirst.candidateId,
    true,
  ).state
  assert.deepEqual(runAState.candidateIds, [rankedFirst.candidateId])

  const runB = { ...result, runId: 'calibration-run-2' }
  const runBState = calibrationUtils.createModelCalibrationShortlistState(runB)

  assert.deepEqual(runBState.candidateIds, [])
  assert.deepEqual(
    calibrationUtils.getOrderedModelCalibrationShortlist(runB, runAState)
      .map((candidate) => candidate.candidateId),
    [baseline.candidateId],
  )

  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialOptions: {
      ...options,
      defaultBaselineMode: 'CANONICAL_BASE_MODEL_V1',
    },
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(html, /Shortlist Comparison/)
  assert.match(html, /Comparing Current Production with 1 shortlisted candidate/)
  assert.match(html, /Special Teams candidate/)
  assert.match(html, /0\.239900/)
  assert.match(html, /3 seasons/)
  assert.match(html, /3(?:,|\s|&#xA0;)936/)
})

test('descriptive highlights use source metrics, ignore nulls and preserve tolerance-level ties', () => {
  const tiedFirst = makeCandidate({
    candidateId: 'tied-first',
    deltaBrier: -0.01,
    ece: 0.02,
    label: 'Tied first',
    logLoss: 0.61,
    pooledBrier: 0.2,
    seasonsImproved: 3,
    worstSeasonBrier: 0.215,
  })
  const tiedSecond = makeCandidate({
    candidateId: 'tied-second',
    deltaBrier: -0.01,
    ece: 0.018,
    label: 'Tied second',
    logLoss: 0.62,
    pooledBrier: 0.2000000000005,
    seasonsImproved: 3,
    worstSeasonBrier: 0.22,
  })
  const highlights = calibrationUtils.getModelCalibrationHighlights([
    tiedFirst,
    tiedSecond,
  ])
  const byKey = new Map(highlights.map((highlight) => [
    highlight.key,
    highlight.candidateIds,
  ]))

  assert.deepEqual(byKey.get('pooled-brier'), ['tied-first', 'tied-second'])
  assert.deepEqual(byKey.get('log-loss'), ['tied-first'])
  assert.deepEqual(byKey.get('ece'), ['tied-second'])
  assert.deepEqual(byKey.get('worst-season-brier'), ['tied-first'])
  assert.deepEqual(byKey.get('seasons-improved'), ['tied-first', 'tied-second'])
  assert.match(
    calibrationUtils.getModelCalibrationReviewFlags(
      tiedFirst,
      highlights,
    ).find((flag) => flag.key === 'pooled-brier').label,
    /^Tied ·/,
  )

  const missing = {
    ...makeCandidate({
      candidateId: 'missing',
      deltaBrier: null,
      label: 'Missing metrics',
      pooledBrier: null,
    }),
    diagnostics: {},
    metrics: {
      accuracy: null,
      averageSeasonBrier: null,
      ece: null,
      logLoss: null,
      pooledBrier: null,
      worstSeasonBrier: null,
    },
  }

  assert.deepEqual(calibrationUtils.getModelCalibrationHighlights([missing]), [])
})

test('delta presentation encodes metric direction in text and suppresses floating-point noise', () => {
  assert.deepEqual(
    calibrationUtils.getModelCalibrationDeltaPresentation(-0.00048, 'brier'),
    { direction: 'better', symbol: '↓', text: '↓ 0.000480 better' },
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(0.0002, 'brier')
      .direction,
    'worse',
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(-0.002, 'logLoss')
      .direction,
    'better',
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(0.01, 'accuracy')
      .direction,
    'better',
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(-0.01, 'accuracy')
      .direction,
    'worse',
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(-3e-14, 'brier')
      .text,
    '↔ 0.000000 equal',
  )
  assert.equal(
    calibrationUtils.getModelCalibrationDeltaPresentation(null, 'brier')
      .text,
    '—',
  )
})

test('per-season shortlist rows join candidates by season identifier instead of array position', () => {
  const reordered = {
    ...rankedFirst,
    perSeason: [
      { ...rankedFirst.perSeason[2], brier: 0.2401 },
      { ...rankedFirst.perSeason[0], brier: 0.2381 },
      { ...rankedFirst.perSeason[1], brier: 0.2391 },
    ],
  }
  const seasons = calibrationUtils.getShortlistSeasonComparisonRows([
    baseline,
    reordered,
  ])
  const firstSeason = seasons.find((season) =>
    season.seasonId === '20232024')

  assert.equal(firstSeason.candidates[1].brier, 0.2381)
  assert.ok(
    Math.abs(firstSeason.candidates[1].deltaBrier - (0.2381 - 0.2408)) < 1e-12,
  )
})

test('shortlist comparison renders the production-sized isolated and combined shape with null-safe metrics', () => {
  const nullMetricsCandidate = {
    ...rankedSecond,
    metrics: {
      ...rankedSecond.metrics,
      averageSeasonBrier: null,
      ece: null,
      worstSeasonBrier: null,
    },
  }
  const comparisonResult = {
    ...result,
    candidates: [rankedFirst, nullMetricsCandidate, combinedCandidate],
    ranking: {
      comparable: [
        { candidateId: combinedCandidate.candidateId, rank: 1 },
        { candidateId: rankedFirst.candidateId, rank: 2 },
        { candidateId: nullMetricsCandidate.candidateId, rank: 3 },
      ],
    },
  }
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst, nullMetricsCandidate, combinedCandidate],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: comparisonResult,
    initialShortlistCandidateIds: [
      nullMetricsCandidate.candidateId,
      combinedCandidate.candidateId,
    ],
  })
  const shortlistIndex = html.indexOf('Shortlist Comparison')
  const baselineIndex = html.indexOf('Current Production', shortlistIndex)
  const combinedIndex = html.indexOf(
    'Combined · Special Teams + Team HA',
    shortlistIndex,
  )
  const isolatedIndex = html.indexOf('Team HA ±0.50', shortlistIndex)

  assert.ok(shortlistIndex >= 0)
  assert.ok(baselineIndex > shortlistIndex)
  assert.ok(combinedIndex > baselineIndex)
  assert.ok(isolatedIndex > combinedIndex)
  assert.match(html, /Average Season Brier/)
  assert.match(html, /Worst Season Brier/)
  assert.match(html, /Seasons Improved \/ Equal \/ Worse/)
  assert.match(html, /Candidate Type/)
  assert.match(html, /Combined Candidate · 2 features/)
  assert.match(html, /Special Teams candidate \+ Team HA ±0\.50/)
  assert.match(html, /↓ 0\.000200 better/)
  assert.match(html, /vs Special Teams candidate/)
  assert.match(html, /Per-season comparison/)
  assert.match(html, /2023–24/)
  assert.doesNotMatch(html, /synergy|Best Overall|Production ready/i)
  assert.doesNotMatch(html, />0\.000000<\/td>/)
})

test('main results expose one accessible shortlist control and disable it for non-comparable candidates', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: result.candidates,
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: result,
  })

  assert.match(html, /Add Special Teams candidate to shortlist comparison/)
  assert.match(
    html,
    /aria-label="Add Different starting state to shortlist comparison"[^>]*disabled=""[^>]*title="Not directly comparable to this run baseline\."/,
  )
  assert.doesNotMatch(html, /Shortlist Comparison/)
})

test('robustness request helpers validate shortlist scope and send frozen identities without client metrics', () => {
  const shortlist = calibrationUtils.createModelCalibrationShortlistState(
    result,
    [rankedFirst.candidateId],
  )
  const form = calibrationUtils.createModelCalibrationRobustnessForm(
    rankedFirst.candidateId,
  )

  assert.equal(
    calibrationUtils.validateModelCalibrationRobustnessForm(
      result,
      shortlist,
      form,
    ),
    '',
  )
  assert.deepEqual(
    calibrationUtils.createModelCalibrationRobustnessRequest(result, form),
    {
      candidateId: rankedFirst.candidateId,
      identity: {
        baselineSignature: 'baseline-signature',
        candidateConfigurationSignature:
          rankedFirst.metadata.configurationSignature,
        datasetSignature: 'dataset-signature',
        gameIdSignature: 'game-id-signature',
        productionSnapshotId: 'snapshot-1',
        startingStateSignature: 'starting-signature',
      },
      intervalLevel: 0.95,
      replicates: 2500,
      runId: result.runId,
    },
  )
  assert.equal(
    Object.hasOwn(
      calibrationUtils.createModelCalibrationRobustnessRequest(result, form),
      'metrics',
    ),
    false,
  )
  assert.match(
    calibrationUtils.validateModelCalibrationRobustnessForm(
      result,
      shortlist,
      { ...form, candidateId: nonComparable.candidateId },
    ),
    /shortlisted comparable candidate/,
  )
  assert.match(
    calibrationUtils.validateModelCalibrationRobustnessForm(
      result,
      shortlist,
      { ...form, seed: '4294967296' },
    ),
    /Seed must be an integer/,
  )
  assert.equal(
    calibrationUtils.createModelCalibrationRobustnessRequest(result, {
      ...form,
      seed: '42',
    }).seed,
    42,
  )
})

test('Robustness Analysis renders frozen observed, bootstrap, season and reproducibility results descriptively', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialOptions: {
      ...options,
      defaultBaselineMode: 'CANONICAL_BASE_MODEL_V1',
    },
    initialResult: result,
    initialRobustnessCandidateId: rankedFirst.candidateId,
    initialRobustnessResult: robustnessResult,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(html, /Robustness Analysis/)
  assert.match(html, /Paired · Review only/)
  assert.match(html, /does not rerun or reorder the rating engine/)
  assert.match(html, /Bootstrap samples/)
  assert.match(html, /2(?:,|\s|&#xA0;)500/)
  assert.match(html, /Observed Δ Brier/)
  assert.match(html, /↓ 0\.001900 better/)
  assert.match(html, /95% bootstrap interval/)
  assert.match(html, /-0\.003100 to \+0\.000060/)
  assert.match(html, /Interval includes zero/)
  assert.match(html, /92\.8%/)
  assert.match(html, /2 improved · 0 equal · 1 worse/)
  assert.match(html, /Leave-one-season-out sensitivity/)
  assert.match(html, /Result changes direction when 2024–25 is excluded/)
  assert.match(html, /Observed Δ Log Loss/)
  assert.match(html, /Method details/)
  assert.match(html, /season stratified temporal block bootstrap/)
  assert.match(html, /123456789/)
  assert.match(html, /sha256:observation-signature/)
  assert.match(html, /selection bias/)
  assert.match(html, /Against Current Production/)
  assert.doesNotMatch(html, /confidence candidate|statistically proven|production ready/i)
})

test('removing an analyzed shortlist candidate preserves its frozen analysis predictably', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: result,
    initialRobustnessResult: robustnessResult,
    initialShortlistCandidateIds: [],
  })

  assert.match(html, /Robustness Analysis/)
  assert.match(html, /Shortlist a comparable candidate to run another analysis/)
  assert.match(html, /Special Teams candidate/)
  assert.match(html, /robustness-analysis-heading/)
})

test('Robustness Analysis has an independent loading state and blocks duplicate submissions', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: result,
    initialRobustnessCandidateId: rankedFirst.candidateId,
    initialRobustnessStatus: 'loading',
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(html, /Analyzing…/)
  assert.match(html, /Building paired temporal blocks/)
  assert.match(html, /Run Calibration/)
  assert.match(html, /<button[^>]*disabled=""[^>]*type="submit"/)
})

test('promotion eligibility stays explicit, feature-scoped, and independent of metrics', () => {
  const best = calibrationUtils.getModelCalibrationPromotionEligibility(
    result,
    rankedFirst,
  )
  const worseButComparable = makeCandidate({
    candidateId: 'worse-rest',
    candidateType: 'REST_FATIGUE',
    deltaBrier: 0.01,
    label: 'Worse rest candidate',
    pooledBrier: 0.25,
    seasonsImproved: 0,
  })
  const worse = calibrationUtils.getModelCalibrationPromotionEligibility(
    result,
    worseButComparable,
  )
  const base = makeCandidate({
    candidateId: 'base-model',
    candidateType: 'BASE_MODEL',
    deltaBrier: -0.01,
    label: 'Base Model candidate',
    pooledBrier: 0.23,
  })

  assert.deepEqual(best, {
    eligible: true,
    families: ['SPECIAL_TEAMS'],
    reason: '',
  })
  assert.equal(worse.eligible, true)
  assert.equal(
    calibrationUtils.getModelCalibrationPromotionEligibility(result, base).reason,
    'Base Model promotion is not supported in this workflow.',
  )
  assert.deepEqual(
    calibrationUtils.createModelCalibrationPromotionPreviewRequest(
      result,
      rankedFirst.candidateId,
    ),
    { candidateId: rankedFirst.candidateId, runId: result.runId },
  )
})

test('shortlist review is the deliberate promotion entry and raw results stay deployment-free', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(html, /Controlled production promotion/)
  assert.match(html, /Review for Production/)
  assert.match(html, /Metrics never authorize promotion automatically/)
  assert.equal(
    (html.match(/>Review for Production<\/button>/g) ?? []).length,
    1,
  )
  assert.doesNotMatch(html, /Deploy Best|Use Recommended Model|Promote Best/)
})

test('shortlisted Base Model candidate states that production promotion is unsupported', () => {
  const baseCandidate = makeCandidate({
    candidateId: 'base-model-reviewed',
    candidateType: 'BASE_MODEL',
    deltaBrier: -0.002,
    label: 'Reviewed Base Model',
    pooledBrier: 0.2398,
  })
  const baseResult = {
    ...result,
    candidates: [baseCandidate],
    ranking: {
      ...result.ranking,
      comparable: [{ candidateId: baseCandidate.candidateId, rank: 1 }],
    },
  }
  const html = renderModelCalibration({
    initialResult: baseResult,
    initialShortlistCandidateIds: [baseCandidate.candidateId],
  })

  assert.match(
    html,
    /Base Model promotion is not supported in this workflow/,
  )
  assert.doesNotMatch(html, />Review for Production<\/button>/)
})

test('promotion review renders exact diff, robustness, identity, and explicit confirmation', () => {
  const html = renderModelCalibration({
    initialCompletedRequest: {
      baselineMode: 'CURRENT_PRODUCTION',
      evaluationSeasons: options.defaultSeasonIds,
      experiments: [rankedFirst],
      startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    initialPromotionPreview: promotionPreview,
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(html, /Production Review/)
  assert.match(html, /Special Teams candidate/)
  assert.match(html, /Exact production diff/)
  assert.match(html, /0\.50/)
  assert.match(html, /\+0\.75/)
  assert.match(html, /Changed/)
  assert.match(html, /Unchanged/)
  assert.match(html, /Observed Δ Brier/)
  assert.match(html, /Does not include zero/)
  assert.match(html, /92\.8%/)
  assert.match(html, /Frozen identity details/)
  assert.match(html, /Apply to Production/)
  assert.match(html, /This changes the production analysis model/)
  assert.doesNotMatch(html, /Approved|Statistically safe|threshold passed/i)
})

test('promotion review clearly renders missing robustness, stale, no-op, and success states', () => {
  const missingRobustness = {
    ...promotionPreview,
    robustnessSummary: { available: false },
  }
  const missingHtml = renderModelCalibration({
    initialPromotionPreview: missingRobustness,
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })
  const staleHtml = renderModelCalibration({
    initialPromotionError:
      'Production settings changed after this calibration run. Re-run Model Calibration before promoting this candidate.',
    initialPromotionPreview: promotionPreview,
    initialPromotionStatus: 'stale',
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })
  const noOpHtml = renderModelCalibration({
    initialPromotionPreview: {
      ...promotionPreview,
      changes: [],
      validation: { ...promotionPreview.validation, noChanges: true },
    },
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })
  const successHtml = renderModelCalibration({
    initialPromotionPreview: promotionPreview,
    initialPromotionResult: promotionResult,
    initialResult: result,
    initialShortlistCandidateIds: [rankedFirst.candidateId],
  })

  assert.match(
    missingHtml,
    /Robustness analysis has not been run for this candidate/,
  )
  assert.match(staleHtml, /Production settings changed after this calibration run/)
  assert.match(staleHtml, /Apply to Production/)
  assert.match(staleHtml, /disabled=""/)
  assert.doesNotMatch(staleHtml, /Force Apply/)
  assert.match(noOpHtml, /Production already matches this candidate/)
  assert.match(noOpHtml, /No write or promotion audit record will be created/)
  assert.match(successHtml, /Production settings updated/)
  assert.match(successHtml, /promotion-1/)
  assert.match(successHtml, /now historical/)
  assert.doesNotMatch(successHtml, /Apply to Production/)
})
