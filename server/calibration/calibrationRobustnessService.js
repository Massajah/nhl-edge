const {
  getCalibrationAnalysisContext,
  storeCalibrationRobustnessResult,
} = require('./calibrationAnalysisContextStore')
const {
  DEFAULT_BLOCK_SIZE_DAYS,
  DEFAULT_INTERVAL_LEVEL,
  DEFAULT_REPLICATES,
  INTERVAL_METHOD,
  RESAMPLING_METHOD,
  SUPPORTED_INTERVAL_LEVELS,
  SUPPORTED_REPLICATES,
  buildSeasonSensitivity,
  buildSeasonTemporalBlocks,
  createAnalysisId,
  deriveDefaultSeed,
  runPairedBlockBootstrap,
  summarizeObserved,
} = require('./calibrationRobustness')
const { deepFreeze } = require('./calibrationIdentity')

const ALLOWED_REQUEST_FIELDS = new Set([
  'candidateId',
  'identity',
  'intervalLevel',
  'replicates',
  'runId',
  'seed',
])
const IDENTITY_FIELDS = Object.freeze([
  'baselineSignature',
  'candidateConfigurationSignature',
  'datasetSignature',
  'gameIdSignature',
  'productionSnapshotId',
  'startingStateSignature',
])

class CalibrationRobustnessError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message)
    this.name = 'CalibrationRobustnessError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requireIdentifier = (value, field) => {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    throw new CalibrationRobustnessError(`${field} is required.`, 400, {
      field,
    })
  }

  return normalized
}

const normalizeRobustnessRequest = (request = {}) => {
  if (!isPlainObject(request)) {
    throw new CalibrationRobustnessError(
      'Robustness request must be an object.',
    )
  }

  const unsupportedFields = Object.keys(request).filter(
    (field) => !ALLOWED_REQUEST_FIELDS.has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new CalibrationRobustnessError(
      'Robustness request contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  const replicates = request.replicates ?? DEFAULT_REPLICATES
  const intervalLevel = request.intervalLevel ?? DEFAULT_INTERVAL_LEVEL

  if (!SUPPORTED_REPLICATES.includes(replicates)) {
    throw new CalibrationRobustnessError(
      `replicates must be one of ${SUPPORTED_REPLICATES.join(', ')}.`,
      400,
      { field: 'replicates' },
    )
  }
  if (!SUPPORTED_INTERVAL_LEVELS.includes(intervalLevel)) {
    throw new CalibrationRobustnessError(
      'intervalLevel must be one of 0.9, 0.95, or 0.99.',
      400,
      { field: 'intervalLevel' },
    )
  }
  if (
    request.seed !== undefined &&
    (!Number.isInteger(request.seed) ||
      request.seed < 0 ||
      request.seed > 0xFFFFFFFF)
  ) {
    throw new CalibrationRobustnessError(
      'seed must be an integer from 0 through 4294967295.',
      400,
      { field: 'seed' },
    )
  }
  if (!isPlainObject(request.identity)) {
    throw new CalibrationRobustnessError(
      'Frozen analysis identity is required.',
      400,
      { field: 'identity' },
    )
  }

  const unsupportedIdentityFields = Object.keys(request.identity).filter(
    (field) => !IDENTITY_FIELDS.includes(field),
  )

  if (unsupportedIdentityFields.length > 0) {
    throw new CalibrationRobustnessError(
      'Frozen analysis identity contains unsupported fields.',
      400,
      { unsupportedFields: unsupportedIdentityFields },
    )
  }
  const missingIdentityFields = IDENTITY_FIELDS.filter(
    (field) => !Object.hasOwn(request.identity, field),
  )

  if (missingIdentityFields.length > 0) {
    throw new CalibrationRobustnessError(
      'Frozen analysis identity is incomplete.',
      400,
      { missingIdentityFields },
    )
  }

  return {
    candidateId: requireIdentifier(request.candidateId, 'candidateId'),
    identity: { ...request.identity },
    intervalLevel,
    replicates,
    runId: requireIdentifier(request.runId, 'runId'),
    seed: request.seed,
  }
}

const validateFrozenIdentity = ({ candidateContext, context, identity }) => {
  const expected = {
    baselineSignature: context.metadata.baselineSignature,
    candidateConfigurationSignature:
      candidateContext.candidate.configurationSignature,
    datasetSignature: context.metadata.datasetSignature,
    gameIdSignature: context.metadata.gameIdSignature,
    productionSnapshotId: context.metadata.productionSnapshotId,
    startingStateSignature: context.metadata.startingStateSignature,
  }
  const mismatches = IDENTITY_FIELDS.filter((field) =>
    identity[field] !== expected[field])

  if (mismatches.length > 0) {
    throw new CalibrationRobustnessError(
      'Robustness analysis identity does not match the frozen calibration run.',
      409,
      { mismatches },
    )
  }
}

const createObservedResult = (context, candidateContext, observations) => {
  const derived = summarizeObserved(observations)
  const baselineMetrics = context.baseline.metrics
  const candidateMetrics = candidateContext.candidate.metrics

  return {
    baselineBrier: baselineMetrics?.pooledBrier ?? derived.baselineBrier,
    baselineLogLoss: baselineMetrics?.logLoss ?? derived.baselineLogLoss,
    brier: candidateMetrics?.pooledBrier ?? derived.brier,
    deltaBrier:
      Number.isFinite(candidateMetrics?.pooledBrier) &&
      Number.isFinite(baselineMetrics?.pooledBrier)
        ? candidateMetrics.pooledBrier - baselineMetrics.pooledBrier
        : derived.deltaBrier,
    deltaLogLoss:
      Number.isFinite(candidateMetrics?.logLoss) &&
      Number.isFinite(baselineMetrics?.logLoss)
        ? candidateMetrics.logLoss - baselineMetrics.logLoss
        : derived.deltaLogLoss,
    logLoss: candidateMetrics?.logLoss ?? derived.logLoss,
  }
}

const runCalibrationRobustness = (
  userId,
  request,
  {
    contextProvider = getCalibrationAnalysisContext,
    now = Date.now,
    resultStore = contextProvider === getCalibrationAnalysisContext
      ? storeCalibrationRobustnessResult
      : null,
  } = {},
) => {
  if (!userId) {
    throw new CalibrationRobustnessError(
      'Authenticated userId is required.',
      401,
    )
  }

  const startedAt = now()
  const normalized = normalizeRobustnessRequest(request)
  const context = contextProvider(userId, normalized.runId)

  if (!context) {
    throw new CalibrationRobustnessError(
      'The completed calibration analysis context is unavailable or expired. Run calibration again.',
      404,
    )
  }

  const candidateContext = context.candidates[normalized.candidateId]

  if (!candidateContext) {
    throw new CalibrationRobustnessError(
      'Candidate does not belong to this completed calibration run.',
      400,
      { field: 'candidateId' },
    )
  }
  if (!candidateContext.eligible || !candidateContext.observationSet) {
    throw new CalibrationRobustnessError(
      'Failed or non-comparable candidates cannot be analyzed against this run baseline.',
      400,
      { field: 'candidateId' },
    )
  }

  validateFrozenIdentity({ candidateContext, context, identity: normalized.identity })

  const observationSet = candidateContext.observationSet
  const seed = normalized.seed ?? deriveDefaultSeed({
    candidateId: normalized.candidateId,
    observationSignature: observationSet.signature,
    runId: normalized.runId,
  })
  const blockDesign = buildSeasonTemporalBlocks(
    observationSet.observations,
    DEFAULT_BLOCK_SIZE_DAYS,
  )
  const bootstrap = runPairedBlockBootstrap({
    blockDesign,
    intervalLevel: normalized.intervalLevel,
    replicates: normalized.replicates,
    seed,
  })
  const derivedSensitivity = buildSeasonSensitivity(
    observationSet.observations,
  )
  const completedConsistency = candidateContext.candidate.seasonConsistency
  const seasonSensitivity = {
    ...derivedSensitivity,
    seasonsEqual:
      completedConsistency?.seasonsEqual ?? derivedSensitivity.seasonsEqual,
    seasonsImproved:
      completedConsistency?.seasonsImproved ??
      derivedSensitivity.seasonsImproved,
    seasonsWorse:
      completedConsistency?.seasonsWorse ?? derivedSensitivity.seasonsWorse,
  }
  const analysisId = createAnalysisId({
    baselineSignature: context.metadata.baselineSignature,
    blockDesign,
    candidateId: normalized.candidateId,
    configurationSignature:
      candidateContext.candidate.configurationSignature,
    intervalLevel: normalized.intervalLevel,
    observationSignature: observationSet.signature,
    replicates: normalized.replicates,
    seed,
  })

  const result = deepFreeze({
    analysisId,
    baseline: {
      identity: context.baseline.identity,
      label: context.baseline.label,
      signature: context.baseline.signature,
    },
    bootstrap,
    candidate: {
      candidateId: candidateContext.candidate.candidateId,
      candidateType: candidateContext.candidate.candidateType,
      configurationSignature:
        candidateContext.candidate.configurationSignature,
      label: candidateContext.candidate.label,
    },
    diagnostics: {
      bootstrapRerunsReplay: false,
      durationMs: now() - startedAt,
      pairedObservations: true,
      productionWrites: false,
    },
    metadata: {
      baselineSignature: context.metadata.baselineSignature,
      datasetSignature: context.metadata.datasetSignature,
      gameIdSignature: context.metadata.gameIdSignature,
      modelVersion: candidateContext.candidate.modelVersion,
      productionSnapshotId: context.metadata.productionSnapshotId,
      productionWrites: false,
      startingStateSignature: context.metadata.startingStateSignature,
    },
    method: {
      blockDefinition: blockDesign.blockDefinition,
      blockSizeDays: blockDesign.blockSizeDays,
      intervalLevel: normalized.intervalLevel,
      intervalMethod: INTERVAL_METHOD,
      replicates: normalized.replicates,
      resamplingMethod: RESAMPLING_METHOD,
      seed,
      totalBlocks: blockDesign.totalBlocks,
    },
    observationSet: {
      games: observationSet.games,
      seasons: observationSet.seasons,
      signature: observationSet.signature,
    },
    observed: createObservedResult(
      context,
      candidateContext,
      observationSet.observations,
    ),
    runId: context.runId,
    seasonSensitivity,
    warnings: [
      {
        code: 'DESCRIPTIVE_BOOTSTRAP_ONLY',
        message:
          'Bootstrap summaries are descriptive and do not establish production readiness or statistical proof.',
      },
      {
        code: 'POST_SELECTION_CAUTION',
        message:
          'Repeatedly evaluating many candidates can introduce selection bias; this analysis does not correct for multiple comparisons.',
      },
    ],
  })

  resultStore?.(userId, context.runId, result, { now: now() })
  return result
}

module.exports = {
  CalibrationRobustnessError,
  IDENTITY_FIELDS,
  normalizeRobustnessRequest,
  runCalibrationRobustness,
  validateFrozenIdentity,
}
