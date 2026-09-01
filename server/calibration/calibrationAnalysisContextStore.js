const { deepFreeze } = require('./calibrationIdentity')
const {
  buildPairedCalibrationObservations,
} = require('./calibrationRobustness')

const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000
const DEFAULT_MAX_CONTEXTS = 12
const contexts = new Map()

const contextKey = (userId, runId) => `${String(userId)}:${String(runId)}`

const purgeExpiredContexts = (now = Date.now()) => {
  contexts.forEach((context, key) => {
    if (context.expiresAt <= now) contexts.delete(key)
  })
}

const enforceContextLimit = (maximumContexts) => {
  while (contexts.size > maximumContexts) {
    const oldestKey = contexts.keys().next().value
    contexts.delete(oldestKey)
  }
}

const createCandidateContext = ({
  baselineReplay,
  candidate,
  candidateReplay,
}) => {
  const eligible =
    candidate.diagnostics?.executionStatus === 'completed' &&
    candidate.diagnostics?.comparability?.comparable === true &&
    Boolean(candidateReplay)

  return {
    candidate: {
      candidateId: candidate.candidateId,
      candidateType: candidate.candidateType,
      comparison: candidate.comparison,
      components: candidate.components,
      configuration: candidate.configuration,
      configurationSignature:
        candidate.metadata?.configurationSignature ?? null,
      evaluation: candidate.evaluation,
      label: candidate.label,
      metrics: candidate.metrics,
      modelVersion: candidate.metadata?.modelVersion ?? null,
      perSeason: candidate.perSeason,
      seasonConsistency: candidate.diagnostics?.seasonConsistency ?? null,
    },
    eligible,
    observationSet: eligible
      ? buildPairedCalibrationObservations({
          baselinePredictions: baselineReplay.predictions,
          candidatePredictions: candidateReplay.predictions,
        })
      : null,
  }
}

const createCalibrationAnalysisContext = ({
  baselineReplay,
  candidateReplays,
  promotionContext = null,
  result,
}) => {
  const candidates = Object.fromEntries(
    result.candidates.map((candidate) => [
      candidate.candidateId,
      createCandidateContext({
        baselineReplay,
        candidate,
        candidateReplay: candidateReplays.get(candidate.candidateId),
      }),
    ]),
  )

  return {
    baseline: {
      candidateId: result.baseline.candidateId,
      configuration: result.evaluationContext.baselineConfiguration,
      identity: result.baselineMode,
      label: result.baseline.label,
      metrics: result.baseline.metrics,
      modelVersion: result.baseline.metadata?.modelVersion ?? null,
      signature: result.evaluationContext.baselineSignature,
    },
    candidates,
    metadata: {
      baselineSignature: result.evaluationContext.baselineSignature,
      datasetSignature: result.evaluationContext.datasetSignature,
      gameIdSignature: result.evaluationContext.gameIdSignature,
      productionSnapshotId:
        result.evaluationContext.productionSnapshotId ?? null,
      productionWrites: false,
      seasons: result.evaluationContext.seasons,
      startingStateSignature:
        result.evaluationContext.startingStateSignature,
    },
    promotion: promotionContext,
    runId: result.runId,
  }
}

const storeCalibrationAnalysisContext = ({
  baselineReplay,
  candidateReplays,
  maximumContexts = DEFAULT_MAX_CONTEXTS,
  now = Date.now(),
  promotionContext = null,
  result,
  ttlMs = DEFAULT_CONTEXT_TTL_MS,
  userId,
}) => {
  if (!userId || !result?.runId) {
    throw new TypeError('Analysis context requires userId and runId.')
  }

  purgeExpiredContexts(now)
  const key = contextKey(userId, result.runId)
  const analysisContext = createCalibrationAnalysisContext({
    baselineReplay,
    candidateReplays,
    promotionContext,
    result,
  })
  const stored = deepFreeze({
    ...analysisContext,
    createdAt: now,
    expiresAt: now + ttlMs,
  })

  contexts.delete(key)
  contexts.set(key, stored)
  enforceContextLimit(maximumContexts)
  return stored
}

const getCalibrationAnalysisContext = (
  userId,
  runId,
  { now = Date.now() } = {},
) => {
  purgeExpiredContexts(now)
  return contexts.get(contextKey(userId, runId)) ?? null
}

const clearCalibrationAnalysisContexts = () => {
  contexts.clear()
}

const getCalibrationAnalysisContextCount = () => contexts.size

const summarizeRobustnessResult = (result) => ({
  analysisId: result.analysisId,
  available: true,
  bootstrap: {
    deltaBrier: result.bootstrap?.deltaBrier ?? null,
  },
  method: {
    intervalLevel: result.method?.intervalLevel ?? null,
    replicates: result.method?.replicates ?? null,
  },
  observed: {
    deltaBrier: result.observed?.deltaBrier ?? null,
  },
  seasonSensitivity: result.seasonSensitivity ?? null,
})

const storeCalibrationRobustnessResult = (
  userId,
  runId,
  result,
  { now = Date.now() } = {},
) => {
  const context = getCalibrationAnalysisContext(userId, runId, { now })
  const candidateId = result?.candidate?.candidateId
  const candidateContext = context?.candidates?.[candidateId]

  if (!context || !candidateContext) return null

  const updated = deepFreeze({
    ...context,
    candidates: {
      ...context.candidates,
      [candidateId]: {
        ...candidateContext,
        robustnessSummary: summarizeRobustnessResult(result),
      },
    },
  })

  contexts.set(contextKey(userId, runId), updated)
  return updated.candidates[candidateId].robustnessSummary
}

module.exports = {
  DEFAULT_CONTEXT_TTL_MS,
  DEFAULT_MAX_CONTEXTS,
  clearCalibrationAnalysisContexts,
  createCalibrationAnalysisContext,
  getCalibrationAnalysisContext,
  getCalibrationAnalysisContextCount,
  storeCalibrationRobustnessResult,
  storeCalibrationAnalysisContext,
}
