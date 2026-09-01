process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CalibrationPromotionHistoryError,
  getCalibrationPromotion,
  listCalibrationPromotions,
} = require('../calibration/calibrationPromotionHistoryService')

const clone = (value) => structuredClone(value)

const makeAudit = ({
  appliedAt,
  candidateId = 'candidate-1',
  candidateType = 'QUICK_REMATCH',
  promotionId,
  robustnessSummary = null,
  userId = 'user-a',
}) => ({
  _id: `mongo-${promotionId}`,
  affectedFeatureFamilies: [candidateType],
  afterConfiguration: {
    [candidateType]: candidateType === 'QUICK_REMATCH'
      ? {
          quickRematchEnabled: true,
          quickRematchLoserAdjustment: 0.5,
          quickRematchMaximumDays: 7,
        }
      : {
          specialTeamsAdjustment: 0.75,
          specialTeamsAlertsEnabled: true,
          specialTeamsMode: 'automatic',
          specialTeamsRankThreshold: 8,
        },
  },
  applicationStatus: 'APPLIED',
  appliedAt: new Date(appliedAt),
  baselineIdentity: 'CURRENT_PRODUCTION',
  baselineSignature: `baseline-${promotionId}`,
  beforeConfiguration: {
    [candidateType]: candidateType === 'QUICK_REMATCH'
      ? {
          quickRematchEnabled: true,
          quickRematchLoserAdjustment: 0.25,
          quickRematchMaximumDays: 5,
        }
      : {
          specialTeamsAdjustment: 0.5,
          specialTeamsAlertsEnabled: true,
          specialTeamsMode: 'automatic',
          specialTeamsRankThreshold: 8,
        },
  },
  candidateConfigurationSignature: `configuration-${promotionId}`,
  candidateId,
  candidateLabel: `Candidate ${candidateId}`,
  candidateType,
  datasetSignature: `dataset-${promotionId}`,
  gameIdSignature: `games-${promotionId}`,
  modelVersion: 'rating-engine-v1',
  productionSnapshotId: `snapshot-${promotionId}`,
  productionStateIdentityAfter: `production-after-${promotionId}`,
  productionStateIdentityBefore: `production-before-${promotionId}`,
  promotionId,
  promotionPreviewId: `preview-${promotionId}`,
  robustnessSummary,
  runId: `run-${promotionId}`,
  startingStateSignature: `starting-${promotionId}`,
  userId,
})

const compareDescending = (left, right) => {
  const dateDifference = new Date(right.appliedAt) - new Date(left.appliedAt)

  return dateDifference || right.promotionId.localeCompare(left.promotionId)
}

const matchesFilter = (document, filter) => {
  if (String(document.userId) !== String(filter.userId)) return false
  if (!filter.$or) return true

  return filter.$or.some((condition) => {
    if (condition.appliedAt?.$lt) {
      return new Date(document.appliedAt) < condition.appliedAt.$lt
    }

    return new Date(document.appliedAt).getTime() ===
      new Date(condition.appliedAt).getTime() &&
      document.promotionId < condition.promotionId.$lt
  })
}

const createReadOnlyAuditModel = (initialDocuments) => {
  const documents = clone(initialDocuments)
  const calls = []
  let writes = 0

  const createQuery = (matchingDocuments) => {
    let result = matchingDocuments

    return {
      lean: async () => clone(result),
      limit(limit) {
        result = result.slice(0, limit)
        return this
      },
      sort() {
        result = [...result].sort(compareDescending)
        return this
      },
    }
  }

  return {
    calls,
    async create() {
      writes += 1
      throw new Error('history reads must not create records')
    },
    async deleteMany() {
      writes += 1
      throw new Error('history reads must not delete records')
    },
    find(filter) {
      calls.push({ filter: clone(filter), operation: 'find' })
      return createQuery(documents.filter((document) =>
        matchesFilter(document, filter)))
    },
    findOne(filter) {
      calls.push({ filter: clone(filter), operation: 'findOne' })
      const document = documents.find((candidate) =>
        String(candidate.userId) === String(filter.userId) &&
        candidate.promotionId === filter.promotionId)

      return { lean: async () => document ? clone(document) : null }
    },
    getWrites: () => writes,
    async updateMany() {
      writes += 1
      throw new Error('history reads must not update records')
    },
  }
}

const robustnessSummary = {
  analysisId: 'analysis-1',
  available: true,
  bootstrap: {
    deltaBrier: {
      intervalCrossesZero: true,
      lower: -0.0031,
      mean: -0.0017,
      median: -0.0018,
      proportionBetter: 0.928,
      proportionEqual: 0,
      proportionWorse: 0.072,
      upper: 0.00006,
    },
    internalPayload: 'not exposed',
  },
  method: { intervalLevel: 0.95, replicates: 2500, seed: 12345 },
  observed: { deltaBrier: -0.0019, deltaLogLoss: -0.004 },
  seasonSensitivity: {
    directionChanges: [{ deltaBrier: 0.0002, excludedSeasonId: '20242025' }],
    leaveOneSeasonOut: [
      { deltaBrier: -0.001, excludedSeasonId: '20232024' },
    ],
    perSeason: [{ deltaBrier: -0.001, seasonId: '20232024' }],
    resultSensitiveToSeasonRemoval: true,
    seasonsEqual: 0,
    seasonsImproved: 2,
    seasonsWorse: 1,
  },
  unexpected: 'not exposed',
}

test('promotion history is user-scoped, newest-first, stable, bounded, and cursor paginated', async () => {
  const model = createReadOnlyAuditModel([
    makeAudit({ appliedAt: '2026-08-30T12:00:00.000Z', promotionId: 'p-1' }),
    makeAudit({ appliedAt: '2026-08-31T12:00:00.000Z', promotionId: 'p-2' }),
    makeAudit({ appliedAt: '2026-08-31T12:00:00.000Z', promotionId: 'p-3' }),
    makeAudit({
      appliedAt: '2026-09-01T12:00:00.000Z',
      promotionId: 'other-user',
      userId: 'user-b',
    }),
  ])
  const first = await listCalibrationPromotions(
    'user-a',
    { limit: '2', userId: 'user-b' },
    { auditModel: model },
  )

  assert.deepEqual(first.promotions.map(({ promotionId }) => promotionId), [
    'p-3',
    'p-2',
  ])
  assert.equal(first.pagination.limit, 2)
  assert.equal(first.pagination.hasMore, true)
  assert.ok(first.pagination.nextCursor)
  assert.equal(first.metadata.productionWrites, false)
  assert.equal(first.metadata.readOnly, true)
  assert.equal(first.promotions.some(({ promotionId }) =>
    promotionId === 'other-user'), false)

  const second = await listCalibrationPromotions(
    'user-a',
    { cursor: first.pagination.nextCursor, limit: 2 },
    { auditModel: model },
  )

  assert.deepEqual(second.promotions.map(({ promotionId }) => promotionId), [
    'p-1',
  ])
  assert.equal(second.pagination.hasMore, false)
  assert.equal(second.pagination.nextCursor, null)
  assert.equal(model.calls.every(({ filter }) => filter.userId === 'user-a'), true)
  assert.equal(model.getWrites(), 0)
})

test('history list is compact, handles empty data and rejects invalid limits or cursors', async () => {
  const populatedModel = createReadOnlyAuditModel([
    makeAudit({
      appliedAt: '2026-08-31T12:00:00.000Z',
      promotionId: 'p-robust',
      robustnessSummary,
    }),
  ])
  const populated = await listCalibrationPromotions(
    'user-a',
    {},
    { auditModel: populatedModel },
  )
  const summary = populated.promotions[0]

  assert.equal(populated.pagination.limit, 20)
  assert.equal(summary.changeCount, 2)
  assert.equal(summary.robustnessAvailable, true)
  assert.deepEqual(Object.keys(summary).sort(), [
    'affectedFeatureFamilies',
    'appliedAt',
    'candidate',
    'changeCount',
    'promotionId',
    'robustnessAvailable',
    'runId',
    'status',
  ])
  assert.equal('beforeConfiguration' in summary, false)
  assert.equal('_id' in summary, false)
  assert.equal('userId' in summary, false)

  const empty = await listCalibrationPromotions(
    'user-a',
    {},
    { auditModel: createReadOnlyAuditModel([]) },
  )

  assert.deepEqual(empty.promotions, [])
  assert.equal(empty.pagination.hasMore, false)
  for (const query of [
    { limit: 0 },
    { limit: 51 },
    { limit: '2.5' },
    { cursor: 'not-a-cursor' },
  ]) {
    await assert.rejects(
      listCalibrationPromotions('user-a', query, {
        auditModel: populatedModel,
      }),
      (error) => error instanceof CalibrationPromotionHistoryError &&
        error.statusCode === 400,
    )
  }
})

test('history detail returns deliberate immutable audit DTO with robustness present or absent', async () => {
  const robustAudit = makeAudit({
    appliedAt: '2026-08-31T12:00:00.000Z',
    promotionId: 'p-robust',
    robustnessSummary,
  })
  const plainAudit = makeAudit({
    appliedAt: '2026-08-30T12:00:00.000Z',
    candidateId: 'special',
    candidateType: 'SPECIAL_TEAMS',
    promotionId: 'p-plain',
  })
  const model = createReadOnlyAuditModel([robustAudit, plainAudit])
  const robust = await getCalibrationPromotion(
    'user-a',
    'p-robust',
    { auditModel: model },
  )
  const plain = await getCalibrationPromotion(
    'user-a',
    'p-plain',
    { auditModel: model },
  )

  assert.equal(robust.promotion.diff[0].label, 'Quick Rematch')
  assert.equal(robust.promotion.diff[0].fields.length, 3)
  assert.equal(robust.promotion.changeCount, 2)
  assert.equal(robust.promotion.robustnessSummary.observed.deltaBrier, -0.0019)
  assert.equal(
    robust.promotion.robustnessSummary.seasonSensitivity
      .resultSensitiveToSeasonRemoval,
    true,
  )
  assert.equal('unexpected' in robust.promotion.robustnessSummary, false)
  assert.equal('seed' in robust.promotion.robustnessSummary.method, false)
  assert.equal('deltaLogLoss' in robust.promotion.robustnessSummary.observed, false)
  assert.equal(plain.promotion.robustnessSummary, null)
  assert.equal(plain.promotion.robustnessAvailable, false)
  assert.equal('_id' in robust.promotion, false)
  assert.equal('userId' in robust.promotion, false)
  assert.equal('promotionPreviewId' in robust.promotion, false)
  assert.equal(model.getWrites(), 0)
})

test('historical before and after values never derive from later production state', async () => {
  const audit = makeAudit({
    appliedAt: '2026-08-31T12:00:00.000Z',
    promotionId: 'p-immutable',
  })
  const model = createReadOnlyAuditModel([audit])
  const first = await getCalibrationPromotion(
    'user-a',
    audit.promotionId,
    { auditModel: model },
  )
  const currentProduction = {
    quickRematchEnabled: false,
    quickRematchLoserAdjustment: 9,
    quickRematchMaximumDays: 99,
  }
  const second = await getCalibrationPromotion(
    'user-a',
    audit.promotionId,
    { auditModel: model },
  )

  assert.deepEqual(second, first)
  assert.notDeepEqual(
    second.promotion.afterConfiguration.QUICK_REMATCH,
    currentProduction,
  )
  assert.equal(
    second.promotion.beforeConfiguration.QUICK_REMATCH
      .quickRematchLoserAdjustment,
    0.25,
  )
  assert.equal(
    second.promotion.afterConfiguration.QUICK_REMATCH
      .quickRematchLoserAdjustment,
    0.5,
  )
  assert.equal(model.getWrites(), 0)
})

test('history detail cannot retrieve another user record and missing entries are indistinguishable', async () => {
  const model = createReadOnlyAuditModel([
    makeAudit({
      appliedAt: '2026-08-31T12:00:00.000Z',
      promotionId: 'private-promotion',
      userId: 'user-a',
    }),
  ])

  await assert.rejects(
    getCalibrationPromotion('user-b', 'private-promotion', {
      auditModel: model,
    }),
    (error) => error.statusCode === 404 &&
      error.details.code === 'PROMOTION_HISTORY_NOT_FOUND',
  )
  assert.equal(model.calls[0].filter.userId, 'user-b')
  assert.equal(model.getWrites(), 0)
})
