const mongoose = require('mongoose')
const RatingLabPromotionAudit = require('../models/RatingLabPromotionAudit')
const {
  getTierHomeAdvantageAdjustment,
} = require('../services/homeAdvantageCalibrationService')
const {
  updateHomeAdjustments,
} = require('../services/powerRatingsService')
const {
  updateQuickRematchSettings,
} = require('../services/quickRematchSettingsService')
const {
  updateSpecialTeamsSettings,
} = require('../services/ratingEngineSettingsService')
const {
  getCalibrationAnalysisContext,
} = require('./calibrationAnalysisContextStore')
const {
  captureCalibrationProductionSnapshot,
} = require('./calibrationProductionSnapshot')
const {
  canonicalize,
  createDeterministicSignature,
  deepFreeze,
  stableSerialize,
} = require('./calibrationIdentity')
const {
  normalizeReplayConfiguration,
} = require('./calibrationOrchestrator')
const {
  calibrationPromotionPreviewStore,
  DEFAULT_PROMOTION_PREVIEW_TTL_MS,
} = require('./calibrationPromotionPreviewStore')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
} = require('./calibrationResultContract')
const {
  FAMILY_LABELS,
  buildDiff,
} = require('./calibrationPromotionDiff')

const PROMOTABLE_FEATURE_FAMILIES = Object.freeze([
  CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  CANDIDATE_TYPES.REST_FATIGUE,
  CANDIDATE_TYPES.QUICK_REMATCH,
  CANDIDATE_TYPES.SPECIAL_TEAMS,
])
const PREVIEW_REQUEST_FIELDS = new Set(['candidateId', 'runId'])
const APPLY_REQUEST_FIELDS = new Set(['promotionPreviewId'])
const REQUIRED_CONTEXT_IDENTITIES = Object.freeze([
  'baselineSignature',
  'datasetSignature',
  'gameIdSignature',
  'productionSnapshotId',
  'startingStateSignature',
])

class CalibrationPromotionError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message)
    this.name = 'CalibrationPromotionError'
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
    throw new CalibrationPromotionError(`${field} is required.`, 400, {
      field,
    })
  }

  return normalized
}

const normalizeRequest = (request, fields, label) => {
  if (!isPlainObject(request)) {
    throw new CalibrationPromotionError(`${label} request must be an object.`)
  }

  const unsupportedFields = Object.keys(request).filter(
    (field) => !fields.has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new CalibrationPromotionError(
      `${label} request contains unsupported fields.`,
      400,
      { unsupportedFields },
    )
  }

  return request
}

const normalizePreviewRequest = (request) => {
  const normalized = normalizeRequest(
    request,
    PREVIEW_REQUEST_FIELDS,
    'Promotion preview',
  )

  return {
    candidateId: requireIdentifier(normalized.candidateId, 'candidateId'),
    runId: requireIdentifier(normalized.runId, 'runId'),
  }
}

const normalizeApplyRequest = (request) => {
  const normalized = normalizeRequest(
    request,
    APPLY_REQUEST_FIELDS,
    'Promotion apply',
  )

  return {
    promotionPreviewId: requireIdentifier(
      normalized.promotionPreviewId,
      'promotionPreviewId',
    ),
  }
}

const getAffectedFamilies = (candidate) => {
  if (PROMOTABLE_FEATURE_FAMILIES.includes(candidate.candidateType)) {
    return [candidate.candidateType]
  }
  if (candidate.candidateType === CANDIDATE_TYPES.BASE_MODEL) {
    throw new CalibrationPromotionError(
      'Base Model promotion is not supported in this workflow.',
      400,
      { code: 'BASE_MODEL_PROMOTION_UNSUPPORTED' },
    )
  }
  if (candidate.candidateType !== CANDIDATE_TYPES.COMBINED) {
    throw new CalibrationPromotionError(
      'Candidate type is outside controlled promotion scope.',
      400,
      { code: 'CANDIDATE_TYPE_UNSUPPORTED' },
    )
  }

  const componentTypes = (candidate.components ?? []).map(
    (component) => component.type,
  )

  if (
    componentTypes.length < 2 ||
    componentTypes.some((type) => !PROMOTABLE_FEATURE_FAMILIES.includes(type)) ||
    new Set(componentTypes).size !== componentTypes.length
  ) {
    throw new CalibrationPromotionError(
      'Combined candidate contains unsupported or duplicate feature families.',
      400,
      { code: 'COMBINED_CANDIDATE_UNSUPPORTED', componentTypes },
    )
  }

  return [...componentTypes].sort()
}

const validateFrozenContext = (context, candidateContext) => {
  if (context.baseline?.identity !== BASELINE_IDENTITIES.CURRENT_PRODUCTION) {
    throw new CalibrationPromotionError(
      'Promotion requires a calibration run evaluated against Current Production.',
      400,
      { code: 'CURRENT_PRODUCTION_BASELINE_REQUIRED' },
    )
  }

  const missingIdentities = REQUIRED_CONTEXT_IDENTITIES.filter(
    (field) => !context.metadata?.[field],
  )

  if (missingIdentities.length > 0 || !context.runId) {
    throw new CalibrationPromotionError(
      'The frozen calibration identity is incomplete. Run calibration again.',
      409,
      { code: 'FROZEN_IDENTITY_INCOMPLETE', missingIdentities },
    )
  }
  if (!candidateContext.eligible) {
    throw new CalibrationPromotionError(
      'Failed or non-comparable candidates cannot be promoted.',
      400,
      { code: 'CANDIDATE_NOT_COMPARABLE' },
    )
  }

  const candidate = candidateContext.candidate

  if (!candidate?.configuration || !candidate.configurationSignature) {
    throw new CalibrationPromotionError(
      'Trusted candidate configuration is unavailable. Run calibration again.',
      409,
      { code: 'CANDIDATE_CONFIGURATION_UNAVAILABLE' },
    )
  }

  const calculatedSignature = createDeterministicSignature(
    'nhl-edge/calibration-candidate-configuration/v1',
    candidate.configuration,
  )

  if (calculatedSignature !== candidate.configurationSignature) {
    throw new CalibrationPromotionError(
      'Trusted candidate configuration signature could not be revalidated.',
      409,
      { code: 'CANDIDATE_CONFIGURATION_SIGNATURE_MISMATCH' },
    )
  }

  return getAffectedFamilies(candidate)
}

const toSortedTeamAdjustmentMap = (rows = []) => Object.fromEntries(
  [...rows]
    .sort((left, right) => String(left.teamId).localeCompare(String(right.teamId)))
    .map((row) => [String(row.teamId), Number(row.adjustment) || 0]),
)

const getProductionFamilyStates = (configuration) => {
  const features = configuration.features
  const rest = features.restFatigue
  const quick = features.quickRematch
  const special = features.specialTeams

  return canonicalize({
    [CANDIDATE_TYPES.QUICK_REMATCH]: {
      quickRematchEnabled: quick.enabled === true,
      quickRematchLoserAdjustment: Number(quick.loserAdjustment) || 0,
      quickRematchMaximumDays: Number(quick.maximumDays) || 0,
    },
    [CANDIDATE_TYPES.REST_FATIGUE]: {
      backToBackAdjustment: Number(rest.rules.backToBack.adjustment) || 0,
      backToBackEnabled: rest.rules.backToBack.enabled === true,
      backToBackTravelAdjustment:
        Number(rest.rules.backToBackTravel.adjustment) || 0,
      backToBackTravelEnabled:
        rest.rules.backToBackTravel.enabled === true,
      restFatigueEnabled: rest.enabled === true,
      threeInFourAdjustment: Number(rest.rules.threeInFour.adjustment) || 0,
      threeInFourEnabled: rest.rules.threeInFour.enabled === true,
      wellRestedAdjustment: Number(rest.rules.wellRested.adjustment) || 0,
      wellRestedEnabled: rest.rules.wellRested.enabled === true,
    },
    [CANDIDATE_TYPES.SPECIAL_TEAMS]: {
      specialTeamsAdjustment: Number(special.adjustmentMagnitude) || 0,
      specialTeamsAlertsEnabled: special.alertsEnabled === true,
      specialTeamsMode: special.mode,
      specialTeamsRankThreshold: Number(special.topBottomN) || 0,
    },
    [CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]: {
      teamAdjustments: toSortedTeamAdjustmentMap(
        features.teamHomeAdvantage.adjustments,
      ),
    },
  })
}

const resolveTeamHomeProposal = ({ candidate, context, current }) => {
  const feature = candidate.configuration.features.teamHomeAdvantage
  const currentTeamIds = Object.keys(current.teamAdjustments).sort()
  let candidateMap

  if (feature.enabled !== true) {
    candidateMap = new Map()
  } else if (feature.mode === 'team_map') {
    candidateMap = new Map(
      (feature.adjustments ?? []).map((row) => [row.teamId, row.adjustment]),
    )
  } else if (feature.mode === 'tier') {
    const frozenTiers = context.promotion?.teamHomeAdvantageSnapshot?.tiers

    if (!frozenTiers) {
      throw new CalibrationPromotionError(
        'Frozen Team Home Advantage tiers are unavailable for production resolution.',
        409,
        { code: 'TEAM_HOME_TIER_SNAPSHOT_UNAVAILABLE' },
      )
    }

    candidateMap = new Map(
      Object.entries(frozenTiers).map(([teamId, tier]) => [
        teamId,
        getTierHomeAdvantageAdjustment(tier, Number(feature.adjustment) || 0),
      ]),
    )
  } else {
    throw new CalibrationPromotionError(
      'Team Home Advantage candidate uses an unsupported production representation.',
      400,
      { code: 'TEAM_HOME_CONFIGURATION_UNSUPPORTED' },
    )
  }

  const unknownTeamIds = [...candidateMap.keys()].filter(
    (teamId) => !currentTeamIds.includes(teamId),
  )

  if (unknownTeamIds.length > 0) {
    throw new CalibrationPromotionError(
      'Candidate Team Home Advantage identities do not match current production.',
      409,
      { code: 'TEAM_HOME_TEAM_SET_MISMATCH', unknownTeamIds },
    )
  }

  return {
    teamAdjustments: Object.fromEntries(
      currentTeamIds.map((teamId) => [
        teamId,
        feature.enabled === true ? Number(candidateMap.get(teamId)) || 0 : 0,
      ]),
    ),
  }
}

const resolveRestProposal = (candidate) => {
  const feature = candidate.configuration.features.restFatigue
  const adjustments = feature.adjustments
  const enabled = feature.enabled === true
  const threeInFour = Number(adjustments['3_games_in_4_days']) || 0
  const backToBack = Number(adjustments.back_to_back) || 0
  const backToBackTravel = Number(adjustments.back_to_back_travel) || 0
  const wellRested = Number(adjustments.well_rested) || 0

  return {
    backToBackAdjustment: backToBack,
    backToBackEnabled: enabled && backToBack !== 0,
    backToBackTravelAdjustment: backToBackTravel,
    backToBackTravelEnabled: enabled && backToBackTravel !== 0,
    restFatigueEnabled: enabled,
    threeInFourAdjustment: threeInFour,
    threeInFourEnabled: enabled && threeInFour !== 0,
    wellRestedAdjustment: wellRested,
    wellRestedEnabled: enabled && feature.includeWellRested === true,
  }
}

const resolveQuickRematchProposal = (candidate) => {
  const feature = candidate.configuration.features.quickRematch

  return {
    quickRematchEnabled: feature.enabled === true,
    quickRematchLoserAdjustment: Number(feature.loserAdjustment) || 0,
    quickRematchMaximumDays: Number(feature.maximumDays) || 0,
  }
}

const resolveSpecialTeamsProposal = (candidate) => {
  const feature = candidate.configuration.features.specialTeams
  const mode = feature.enabled !== true
    ? 'off'
    : feature.automaticAdjustmentEnabled === true
      ? 'automatic'
      : 'alert_only'

  return {
    specialTeamsAdjustment: Number(feature.adjustmentMagnitude) || 0,
    specialTeamsAlertsEnabled: mode !== 'off',
    specialTeamsMode: mode,
    specialTeamsRankThreshold: Number(feature.topBottomN) || 0,
  }
}

const buildProposedProduction = ({
  affectedFamilies,
  candidate,
  context,
  currentProduction,
}) => {
  const proposed = canonicalize(currentProduction)

  affectedFamilies.forEach((family) => {
    if (family === CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE) {
      proposed[family] = resolveTeamHomeProposal({
        candidate,
        context,
        current: currentProduction[family],
      })
    } else if (family === CANDIDATE_TYPES.REST_FATIGUE) {
      proposed[family] = resolveRestProposal(candidate)
    } else if (family === CANDIDATE_TYPES.QUICK_REMATCH) {
      proposed[family] = resolveQuickRematchProposal(candidate)
    } else if (family === CANDIDATE_TYPES.SPECIAL_TEAMS) {
      proposed[family] = resolveSpecialTeamsProposal(candidate)
    }
  })

  return canonicalize(proposed)
}

const pickFamilies = (configuration, families) => Object.fromEntries(
  families.map((family) => [family, configuration[family]]),
)

const getChangedRelevantFamilies = (expected, current) => {
  const changed = []

  if (stableSerialize(expected.model) !== stableSerialize(current.model)) {
    changed.push(CANDIDATE_TYPES.BASE_MODEL)
  }
  PROMOTABLE_FEATURE_FAMILIES.forEach((family) => {
    const key = {
      [CANDIDATE_TYPES.QUICK_REMATCH]: 'quickRematch',
      [CANDIDATE_TYPES.REST_FATIGUE]: 'restFatigue',
      [CANDIDATE_TYPES.SPECIAL_TEAMS]: 'specialTeams',
      [CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]: 'teamHomeAdvantage',
    }[family]

    if (stableSerialize(expected.features[key]) !==
      stableSerialize(current.features[key])) {
      changed.push(family)
    }
  })

  return changed
}

const throwProductionChanged = ({
  changedFamilies,
  currentSnapshot,
  expectedProductionSnapshotId,
  expectedStateIdentity,
}) => {
  throw new CalibrationPromotionError(
    'Production settings have changed since this candidate was evaluated. Run a new calibration before promoting it.',
    409,
    {
      changedFamilies,
      code: 'PRODUCTION_STATE_CHANGED',
      currentSnapshot: {
        productionSnapshotId: currentSnapshot.productionSnapshotId,
        relevantStateIdentity: currentSnapshot.baselineSignature,
      },
      expectedSnapshot: {
        productionSnapshotId: expectedProductionSnapshotId,
        relevantStateIdentity: expectedStateIdentity,
      },
      stale: true,
    },
  )
}

const captureCurrentProduction = (userId, { session } = {}) =>
  captureCalibrationProductionSnapshot(userId, {
    engineSettingsOptions: { session },
    powerRatingsOptions: { session },
    scheduleSettingsOptions: { session },
  })

const getNow = (clock) => {
  const value = clock()
  const date = value instanceof Date ? value : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new CalibrationPromotionError('Promotion clock returned an invalid date.', 500)
  }

  return date
}

const createCalibrationPromotionPreview = async (
  userId,
  request,
  options = {},
) => {
  if (!userId) {
    throw new CalibrationPromotionError('Authenticated userId is required.', 401)
  }

  const startedAt = Date.now()
  const normalized = normalizePreviewRequest(request)
  const contextProvider = options.contextProvider ?? getCalibrationAnalysisContext
  const context = contextProvider(userId, normalized.runId)

  if (!context) {
    throw new CalibrationPromotionError(
      'The completed calibration context is unavailable or expired. Run calibration again.',
      404,
      { code: 'CALIBRATION_CONTEXT_UNAVAILABLE' },
    )
  }

  const candidateContext = context.candidates?.[normalized.candidateId]

  if (!candidateContext) {
    throw new CalibrationPromotionError(
      'Candidate does not belong to this completed calibration run.',
      404,
      { code: 'CANDIDATE_NOT_IN_RUN' },
    )
  }

  const affectedFamilies = validateFrozenContext(context, candidateContext)
  const candidate = candidateContext.candidate
  const snapshotProvider = options.snapshotProvider ?? captureCurrentProduction
  const currentSnapshot = await snapshotProvider(userId, {})
  const currentRelevantConfiguration = normalizeReplayConfiguration(
    currentSnapshot.configuration,
  )

  if (currentSnapshot.baselineSignature !== context.metadata.baselineSignature) {
    throwProductionChanged({
      changedFamilies: getChangedRelevantFamilies(
        context.baseline.configuration,
        currentRelevantConfiguration,
      ),
      currentSnapshot,
      expectedProductionSnapshotId: context.metadata.productionSnapshotId,
      expectedStateIdentity: context.metadata.baselineSignature,
    })
  }

  const currentProduction = getProductionFamilyStates(
    currentSnapshot.configuration,
  )
  const proposedProduction = buildProposedProduction({
    affectedFamilies,
    candidate,
    context,
    currentProduction,
  })
  const diff = buildDiff({
    affectedFamilies,
    currentProduction,
    proposedProduction,
  })
  const clock = options.clock ?? (() => new Date())
  const createdAtDate = getNow(clock)
  const ttlMs = options.ttlMs ?? DEFAULT_PROMOTION_PREVIEW_TTL_MS
  const expiresAtDate = new Date(createdAtDate.getTime() + ttlMs)
  const proposedDiffSignature = createDeterministicSignature(
    'nhl-edge/calibration-promotion-diff/v1',
    { affectedFamilies, diff: diff.groups },
  )
  const promotionPreviewId = createDeterministicSignature(
    'nhl-edge/calibration-promotion-preview/v1',
    {
      candidateConfigurationSignature: candidate.configurationSignature,
      candidateId: candidate.candidateId,
      createdAt: createdAtDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
      productionStateIdentity: currentSnapshot.baselineSignature,
      proposedDiffSignature,
      runId: context.runId,
      userId: String(userId),
    },
  )
  const publicPreview = deepFreeze({
    affectedFamilies,
    candidate: {
      calibrationResult: {
        comparison: candidate.comparison,
        metrics: candidate.metrics,
        perSeason: candidate.perSeason,
        seasonConsistency: candidate.seasonConsistency,
      },
      candidateId: candidate.candidateId,
      candidateType: candidate.candidateType,
      configurationSignature: candidate.configurationSignature,
      label: candidate.label,
      productionResolution: affectedFamilies.includes(
        CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
      )
        ? candidate.configuration.features.teamHomeAdvantage.mode === 'tier'
          ? {
              mode: 'FROZEN_TIER_TO_TEAM_MAP',
              sourceSeasonId:
                context.promotion?.teamHomeAdvantageSnapshot?.seasonId ?? null,
            }
          : { mode: 'DIRECT_TEAM_MAP', sourceSeasonId: null }
        : null,
    },
    changes: diff.changes,
    currentProduction: pickFamilies(currentProduction, affectedFamilies),
    diff: diff.groups,
    metadata: {
      createdAt: createdAtDate.toISOString(),
      durationMs: Date.now() - startedAt,
      expiresAt: expiresAtDate.toISOString(),
      productionWrites: false,
      ttlMs,
    },
    promotionPreviewId,
    proposedProduction: pickFamilies(proposedProduction, affectedFamilies),
    robustnessSummary: candidateContext.robustnessSummary ?? {
      available: false,
    },
    runIdentity: {
      baselineIdentity: context.baseline.identity,
      baselineSignature: context.metadata.baselineSignature,
      datasetSignature: context.metadata.datasetSignature,
      gameIdSignature: context.metadata.gameIdSignature,
      modelVersion: candidate.modelVersion,
      productionSnapshotId: context.metadata.productionSnapshotId,
      runId: context.runId,
      startingStateSignature: context.metadata.startingStateSignature,
    },
    unchanged: diff.unchanged,
    validation: {
      candidateEligible: true,
      noChanges: diff.changes.length === 0,
      productionSnapshotCurrent: true,
      stale: false,
    },
  })
  const previewStore = options.previewStore ?? calibrationPromotionPreviewStore

  previewStore.put({
    affectedFamilies,
    appliedResult: null,
    applying: false,
    candidate,
    consumedAt: null,
    contextIdentity: context.metadata,
    currentRelevantConfiguration,
    currentSnapshotId: currentSnapshot.productionSnapshotId,
    expiresAtMs: expiresAtDate.getTime(),
    preview: publicPreview,
    productionStateIdentity: currentSnapshot.baselineSignature,
    promotionPreviewId,
    proposedDiffSignature,
    proposedProduction: pickFamilies(proposedProduction, affectedFamilies),
    userId: String(userId),
  })

  return publicPreview
}

const runInMongoTransaction = async (work) => {
  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await work(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}

const writeProductionFamilies = async ({
  affectedFamilies,
  proposedProduction,
  session,
  userId,
}) => {
  if (affectedFamilies.includes(CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE)) {
    const teamAdjustments = proposedProduction[
      CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE
    ].teamAdjustments

    await updateHomeAdjustments(
      userId,
      Object.entries(teamAdjustments).map(([teamId, adjustment]) => ({
        adjustment,
        teamId,
      })),
      { session },
    )
  }

  const schedulePayload = {}

  if (affectedFamilies.includes(CANDIDATE_TYPES.REST_FATIGUE)) {
    Object.assign(
      schedulePayload,
      proposedProduction[CANDIDATE_TYPES.REST_FATIGUE],
    )
  }
  if (affectedFamilies.includes(CANDIDATE_TYPES.QUICK_REMATCH)) {
    Object.assign(
      schedulePayload,
      proposedProduction[CANDIDATE_TYPES.QUICK_REMATCH],
    )
  }
  if (Object.keys(schedulePayload).length > 0) {
    await updateQuickRematchSettings(userId, schedulePayload, { session })
  }

  if (affectedFamilies.includes(CANDIDATE_TYPES.SPECIAL_TEAMS)) {
    await updateSpecialTeamsSettings(
      userId,
      proposedProduction[CANDIDATE_TYPES.SPECIAL_TEAMS],
      { session },
    )
  }
}

const createAuditRecord = async (record, session) => {
  const [document] = await RatingLabPromotionAudit.create(
    [record],
    { session },
  )

  return typeof document.toJSON === 'function'
    ? document.toJSON()
    : document
}

const applyCalibrationPromotion = async (
  userId,
  request,
  options = {},
) => {
  if (!userId) {
    throw new CalibrationPromotionError('Authenticated userId is required.', 401)
  }

  const startedAt = Date.now()
  const normalized = normalizeApplyRequest(request)
  const previewStore = options.previewStore ?? calibrationPromotionPreviewStore
  const clock = options.clock ?? (() => new Date())
  const applyStartedAt = getNow(clock)
  const begin = previewStore.beginApply(
    userId,
    normalized.promotionPreviewId,
    applyStartedAt.getTime(),
  )

  if (begin.status === 'NOT_FOUND') {
    throw new CalibrationPromotionError(
      'Promotion preview was not found for this user.',
      404,
      { code: 'PROMOTION_PREVIEW_NOT_FOUND' },
    )
  }
  if (begin.status === 'EXPIRED') {
    throw new CalibrationPromotionError(
      'Promotion preview has expired. Generate a fresh preview.',
      410,
      { code: 'PROMOTION_PREVIEW_EXPIRED' },
    )
  }
  if (begin.status === 'CONSUMED') {
    throw new CalibrationPromotionError(
      'Promotion preview has already been applied.',
      409,
      {
        code: 'PROMOTION_PREVIEW_CONSUMED',
        promotionId: begin.record.appliedResult?.promotionId ?? null,
      },
    )
  }
  if (begin.status === 'APPLYING') {
    throw new CalibrationPromotionError(
      'Promotion preview is already being applied.',
      409,
      { code: 'PROMOTION_PREVIEW_APPLYING' },
    )
  }

  const record = begin.record

  if (record.preview.validation.noChanges) {
    previewStore.finishApply(userId, normalized.promotionPreviewId)
    throw new CalibrationPromotionError(
      'Production already matches this candidate.',
      409,
      { code: 'NO_CHANGES' },
    )
  }

  const snapshotProvider = options.snapshotProvider ?? captureCurrentProduction
  const transactionRunner = options.transactionRunner ?? runInMongoTransaction
  const productionWriter = options.productionWriter ?? writeProductionFamilies
  const auditWriter = options.auditWriter ?? createAuditRecord
  const promotionId = createDeterministicSignature(
    'nhl-edge/calibration-promotion/v1',
    { promotionPreviewId: normalized.promotionPreviewId },
  )

  try {
    const result = await transactionRunner(async (session) => {
      const currentSnapshot = await snapshotProvider(userId, { session })
      const currentRelevantConfiguration = normalizeReplayConfiguration(
        currentSnapshot.configuration,
      )

      if (currentSnapshot.baselineSignature !== record.productionStateIdentity) {
        throwProductionChanged({
          changedFamilies: getChangedRelevantFamilies(
            record.currentRelevantConfiguration,
            currentRelevantConfiguration,
          ),
          currentSnapshot,
          expectedProductionSnapshotId: record.currentSnapshotId,
          expectedStateIdentity: record.productionStateIdentity,
        })
      }

      const beforeProduction = getProductionFamilyStates(
        currentSnapshot.configuration,
      )

      await productionWriter({
        affectedFamilies: record.affectedFamilies,
        proposedProduction: record.proposedProduction,
        session,
        userId,
      })

      const readbackSnapshot = await snapshotProvider(userId, { session })
      const readbackProduction = getProductionFamilyStates(
        readbackSnapshot.configuration,
      )
      const mismatchedFamilies = record.affectedFamilies.filter(
        (family) => stableSerialize(readbackProduction[family]) !==
          stableSerialize(record.proposedProduction[family]),
      )

      if (mismatchedFamilies.length > 0) {
        throw new CalibrationPromotionError(
          'Post-write production verification failed. The promotion was rolled back.',
          500,
          { code: 'POST_WRITE_VERIFICATION_FAILED', mismatchedFamilies },
        )
      }

      const appliedAt = getNow(clock).toISOString()
      const auditRecord = {
        affectedFeatureFamilies: record.affectedFamilies,
        afterConfiguration: pickFamilies(
          readbackProduction,
          record.affectedFamilies,
        ),
        applicationStatus: 'APPLIED',
        appliedAt,
        baselineIdentity: record.preview.runIdentity.baselineIdentity,
        baselineSignature: record.preview.runIdentity.baselineSignature,
        beforeConfiguration: pickFamilies(
          beforeProduction,
          record.affectedFamilies,
        ),
        candidateConfigurationSignature:
          record.candidate.configurationSignature,
        candidateId: record.candidate.candidateId,
        candidateLabel: record.candidate.label,
        candidateType: record.candidate.candidateType,
        datasetSignature: record.preview.runIdentity.datasetSignature,
        gameIdSignature: record.preview.runIdentity.gameIdSignature,
        modelVersion: record.preview.runIdentity.modelVersion,
        productionSnapshotId:
          record.preview.runIdentity.productionSnapshotId,
        productionStateIdentityAfter: readbackSnapshot.baselineSignature,
        productionStateIdentityBefore: currentSnapshot.baselineSignature,
        promotionId,
        promotionPreviewId: record.promotionPreviewId,
        robustnessSummary: record.preview.robustnessSummary.available === false
          ? null
          : record.preview.robustnessSummary,
        runId: record.preview.runIdentity.runId,
        startingStateSignature:
          record.preview.runIdentity.startingStateSignature,
        userId,
      }
      const audit = await auditWriter(auditRecord, session)

      return deepFreeze({
        affectedFamilies: record.affectedFamilies,
        appliedAt,
        auditId: audit?.id ?? audit?._id?.toString?.() ?? promotionId,
        beforeProduction: auditRecord.beforeConfiguration,
        diagnostics: {
          durationMs: Date.now() - startedAt,
          postWriteVerified: true,
          transaction: 'mongodb',
        },
        productionStateIdentityAfter: readbackSnapshot.baselineSignature,
        promotionId,
        status: 'APPLIED',
        updatedProduction: auditRecord.afterConfiguration,
      })
    })

    previewStore.finishApply(userId, normalized.promotionPreviewId, {
      appliedResult: result,
      consumedAt: result.appliedAt,
    })
    return result
  } catch (error) {
    previewStore.finishApply(userId, normalized.promotionPreviewId)
    throw error
  }
}

module.exports = {
  CalibrationPromotionError,
  FAMILY_LABELS,
  PROMOTABLE_FEATURE_FAMILIES,
  applyCalibrationPromotion,
  buildDiff,
  buildProposedProduction,
  captureCurrentProduction,
  createCalibrationPromotionPreview,
  getAffectedFamilies,
  getChangedRelevantFamilies,
  getProductionFamilyStates,
  normalizeApplyRequest,
  normalizePreviewRequest,
  runInMongoTransaction,
  validateFrozenContext,
  writeProductionFamilies,
}
