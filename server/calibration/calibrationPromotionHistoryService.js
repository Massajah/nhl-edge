const RatingLabPromotionAudit = require('../models/RatingLabPromotionAudit')
const { buildDiff } = require('./calibrationPromotionDiff')

const DEFAULT_HISTORY_LIMIT = 20
const MAXIMUM_HISTORY_LIMIT = 50

class CalibrationPromotionHistoryError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message)
    this.name = 'CalibrationPromotionHistoryError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const requireUserId = (userId) => {
  const value = String(userId ?? '').trim()

  if (!value) {
    throw new CalibrationPromotionHistoryError(
      'Authenticated userId is required.',
      401,
    )
  }

  return value
}

const normalizeLimit = (value) => {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_HISTORY_LIMIT
  }
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    throw new CalibrationPromotionHistoryError(
      `limit must be an integer from 1 to ${MAXIMUM_HISTORY_LIMIT}.`,
      400,
      { field: 'limit' },
    )
  }

  const limit = Number(value)

  if (limit < 1 || limit > MAXIMUM_HISTORY_LIMIT) {
    throw new CalibrationPromotionHistoryError(
      `limit must be an integer from 1 to ${MAXIMUM_HISTORY_LIMIT}.`,
      400,
      { field: 'limit' },
    )
  }

  return limit
}

const encodeCursor = ({ appliedAt, promotionId }) => Buffer.from(
  JSON.stringify({
    appliedAt: new Date(appliedAt).toISOString(),
    promotionId: String(promotionId),
  }),
).toString('base64url')

const decodeCursor = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) {
    throw new CalibrationPromotionHistoryError(
      'cursor must identify one promotion-history position.',
      400,
      { field: 'cursor' },
    )
  }

  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString())
    const appliedAt = new Date(parsed.appliedAt)
    const promotionId = String(parsed.promotionId ?? '').trim()

    if (!Number.isFinite(appliedAt.getTime()) || !promotionId) throw new Error()
    return { appliedAt, promotionId }
  } catch {
    throw new CalibrationPromotionHistoryError(
      'cursor is invalid or expired.',
      400,
      { field: 'cursor' },
    )
  }
}

const normalizeNumber = (value) =>
  value !== null && value !== undefined && value !== '' &&
    Number.isFinite(Number(value))
    ? Number(value)
    : null

const normalizeSeasonRow = (row = {}) => ({
  deltaBrier: normalizeNumber(row.deltaBrier),
  excludedSeasonId: row.excludedSeasonId == null
    ? null
    : String(row.excludedSeasonId),
  seasonId: row.seasonId == null ? null : String(row.seasonId),
})

const normalizeRobustnessSummary = (summary) => {
  if (!summary || summary.available === false) return null

  const deltaBrier = summary.bootstrap?.deltaBrier ?? {}
  const sensitivity = summary.seasonSensitivity ?? {}

  return {
    analysisId: summary.analysisId == null ? null : String(summary.analysisId),
    available: true,
    bootstrap: {
      deltaBrier: {
        intervalCrossesZero:
          typeof deltaBrier.intervalCrossesZero === 'boolean'
            ? deltaBrier.intervalCrossesZero
            : null,
        lower: normalizeNumber(deltaBrier.lower),
        mean: normalizeNumber(deltaBrier.mean),
        median: normalizeNumber(deltaBrier.median),
        proportionBetter: normalizeNumber(deltaBrier.proportionBetter),
        proportionEqual: normalizeNumber(deltaBrier.proportionEqual),
        proportionWorse: normalizeNumber(deltaBrier.proportionWorse),
        upper: normalizeNumber(deltaBrier.upper),
      },
    },
    method: {
      intervalLevel: normalizeNumber(summary.method?.intervalLevel),
      replicates: normalizeNumber(summary.method?.replicates),
    },
    observed: {
      deltaBrier: normalizeNumber(summary.observed?.deltaBrier),
    },
    seasonSensitivity: {
      directionChanges: (sensitivity.directionChanges ?? [])
        .map(normalizeSeasonRow),
      leaveOneSeasonOut: (sensitivity.leaveOneSeasonOut ?? [])
        .map(normalizeSeasonRow),
      perSeason: (sensitivity.perSeason ?? []).map(normalizeSeasonRow),
      resultSensitiveToSeasonRemoval:
        typeof sensitivity.resultSensitiveToSeasonRemoval === 'boolean'
          ? sensitivity.resultSensitiveToSeasonRemoval
          : null,
      seasonsEqual: normalizeNumber(sensitivity.seasonsEqual),
      seasonsImproved: normalizeNumber(sensitivity.seasonsImproved),
      seasonsWorse: normalizeNumber(sensitivity.seasonsWorse),
    },
  }
}

const buildHistoricalDiff = (audit) => buildDiff({
  affectedFamilies: audit.affectedFeatureFamilies,
  currentProduction: audit.beforeConfiguration,
  proposedProduction: audit.afterConfiguration,
})

const createSummaryDto = (audit) => {
  const diff = buildHistoricalDiff(audit)

  return {
    affectedFeatureFamilies: [...audit.affectedFeatureFamilies],
    appliedAt: new Date(audit.appliedAt).toISOString(),
    candidate: {
      candidateId: audit.candidateId,
      label: audit.candidateLabel,
      type: audit.candidateType,
    },
    changeCount: diff.changes.length,
    promotionId: audit.promotionId,
    robustnessAvailable: Boolean(audit.robustnessSummary),
    runId: audit.runId,
    status: audit.applicationStatus,
  }
}

const createDetailDto = (audit) => {
  const diff = buildHistoricalDiff(audit)

  return {
    ...createSummaryDto(audit),
    afterConfiguration: audit.afterConfiguration,
    baseline: {
      identity: audit.baselineIdentity,
      signature: audit.baselineSignature,
    },
    beforeConfiguration: audit.beforeConfiguration,
    candidate: {
      candidateId: audit.candidateId,
      configurationSignature: audit.candidateConfigurationSignature,
      label: audit.candidateLabel,
      type: audit.candidateType,
    },
    diff: diff.groups,
    identities: {
      datasetSignature: audit.datasetSignature,
      gameIdSignature: audit.gameIdSignature,
      productionSnapshotId: audit.productionSnapshotId,
      productionStateIdentityAfter: audit.productionStateIdentityAfter,
      productionStateIdentityBefore: audit.productionStateIdentityBefore,
      startingStateSignature: audit.startingStateSignature,
    },
    modelVersion: audit.modelVersion,
    robustnessSummary: normalizeRobustnessSummary(audit.robustnessSummary),
  }
}

const createHistoryFilter = (userId, cursor) => {
  const filter = { userId }

  if (cursor) {
    filter.$or = [
      { appliedAt: { $lt: cursor.appliedAt } },
      {
        appliedAt: cursor.appliedAt,
        promotionId: { $lt: cursor.promotionId },
      },
    ]
  }

  return filter
}

const historyMetadata = Object.freeze({
  auditTrailOnly: true,
  currentProductionMayDiffer: true,
  productionWrites: false,
  readOnly: true,
})

const listCalibrationPromotions = async (userId, query = {}, options = {}) => {
  const authenticatedUserId = requireUserId(userId)
  const limit = normalizeLimit(query.limit)
  const cursor = decodeCursor(query.cursor)
  const auditModel = options.auditModel ?? RatingLabPromotionAudit
  const documents = await auditModel
    .find(createHistoryFilter(authenticatedUserId, cursor))
    .sort({ appliedAt: -1, promotionId: -1 })
    .limit(limit + 1)
    .lean()
  const hasMore = documents.length > limit
  const page = hasMore ? documents.slice(0, limit) : documents
  const last = page.at(-1)

  return {
    metadata: historyMetadata,
    pagination: {
      hasMore,
      limit,
      nextCursor: hasMore && last
        ? encodeCursor(last)
        : null,
    },
    promotions: page.map(createSummaryDto),
  }
}

const getCalibrationPromotion = async (
  userId,
  promotionId,
  options = {},
) => {
  const authenticatedUserId = requireUserId(userId)
  const normalizedPromotionId = String(promotionId ?? '').trim()

  if (!normalizedPromotionId) {
    throw new CalibrationPromotionHistoryError(
      'promotionId is required.',
      400,
      { field: 'promotionId' },
    )
  }

  const auditModel = options.auditModel ?? RatingLabPromotionAudit
  const document = await auditModel.findOne({
    promotionId: normalizedPromotionId,
    userId: authenticatedUserId,
  }).lean()

  if (!document) {
    throw new CalibrationPromotionHistoryError(
      'Promotion history entry was not found.',
      404,
      { code: 'PROMOTION_HISTORY_NOT_FOUND' },
    )
  }

  return {
    metadata: historyMetadata,
    promotion: createDetailDto(document),
  }
}

module.exports = {
  CalibrationPromotionHistoryError,
  DEFAULT_HISTORY_LIMIT,
  MAXIMUM_HISTORY_LIMIT,
  createDetailDto,
  createSummaryDto,
  decodeCursor,
  encodeCursor,
  getCalibrationPromotion,
  listCalibrationPromotions,
  normalizeLimit,
  normalizeRobustnessSummary,
}
