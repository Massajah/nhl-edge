process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const calibrationOrchestrator = require('../calibration/calibrationOrchestrator')
const calibrationOrchestrationOptions = require(
  '../calibration/calibrationOrchestrationOptions'
)
const calibrationRobustnessService = require(
  '../calibration/calibrationRobustnessService'
)
const calibrationPromotionService = require(
  '../calibration/calibrationPromotionService'
)
const calibrationPromotionHistoryService = require(
  '../calibration/calibrationPromotionHistoryService'
)

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const text = await response.text()

    return {
      body: text ? JSON.parse(text) : null,
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const withPatch = async (target, property, replacement, callback) => {
  const original = target[property]
  target[property] = replacement

  try {
    return await callback()
  } finally {
    target[property] = original
  }
}

test('Model Calibration routes require authentication', async () => {
  const optionsResponse = await request(
    '/api/power-rating-simulations/model-calibration/options',
  )
  const runResponse = await request(
    '/api/power-rating-simulations/model-calibration/run',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const promotionHistoryResponse = await request(
    '/api/power-rating-simulations/model-calibration/promotions',
  )
  const promotionHistoryDetailResponse = await request(
    '/api/power-rating-simulations/model-calibration/promotions/promotion-1',
  )
  const robustnessResponse = await request(
    '/api/power-rating-simulations/model-calibration/robustness',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const promotionPreviewResponse = await request(
    '/api/power-rating-simulations/model-calibration/promotion/preview',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const promotionApplyResponse = await request(
    '/api/power-rating-simulations/model-calibration/promotion/apply',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )

  assert.equal(optionsResponse.status, 401)
  assert.equal(runResponse.status, 401)
  assert.equal(promotionHistoryResponse.status, 401)
  assert.equal(promotionHistoryDetailResponse.status, 401)
  assert.equal(robustnessResponse.status, 401)
  assert.equal(promotionPreviewResponse.status, 401)
  assert.equal(promotionApplyResponse.status, 401)
  assert.equal(optionsResponse.body.message, 'Authentication required.')
  assert.equal(runResponse.body.message, 'Authentication required.')
  assert.equal(promotionHistoryResponse.body.message, 'Authentication required.')
  assert.equal(
    promotionHistoryDetailResponse.body.message,
    'Authentication required.',
  )
  assert.equal(robustnessResponse.body.message, 'Authentication required.')
  assert.equal(promotionPreviewResponse.body.message, 'Authentication required.')
  assert.equal(promotionApplyResponse.body.message, 'Authentication required.')
})

test('promotion history routes use authenticated scope and ignore query identity', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const attackerUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  const captured = []

  await withPatch(
    calibrationPromotionHistoryService,
    'listCalibrationPromotions',
    async (userId, query) => {
      captured.push({ operation: 'list', query, userId })
      return { pagination: { hasMore: false }, promotions: [] }
    },
    async () => withPatch(
      calibrationPromotionHistoryService,
      'getCalibrationPromotion',
      async (userId, promotionId) => {
        captured.push({ operation: 'detail', promotionId, userId })
        return { promotion: { promotionId } }
      },
      async () => {
        const headers = { Cookie: `nhl_edge_session=${token}` }
        const list = await request(
          `/api/power-rating-simulations/model-calibration/promotions?limit=2&userId=${attackerUserId}`,
          { headers },
        )
        const detail = await request(
          '/api/power-rating-simulations/model-calibration/promotions/promotion-1',
          { headers },
        )

        assert.equal(list.status, 200)
        assert.deepEqual(list.body.promotions, [])
        assert.equal(detail.status, 200)
        assert.equal(detail.body.promotion.promotionId, 'promotion-1')
      },
    ),
  )

  assert.equal(captured[0].userId, authenticatedUserId)
  assert.equal(captured[0].query.userId, attackerUserId)
  assert.notEqual(captured[0].userId, captured[0].query.userId)
  assert.deepEqual(captured[1], {
    operation: 'detail',
    promotionId: 'promotion-1',
    userId: authenticatedUserId,
  })
})

test('promotion routes use authenticated scope and delegate only candidate or preview identity', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const attackerUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  const headers = {
    Cookie: `nhl_edge_session=${token}`,
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
  }
  const previewPayload = {
    candidateId: 'candidate-1',
    runId: 'run-1',
    userId: attackerUserId,
  }
  const applyPayload = {
    promotionPreviewId: 'preview-1',
    userId: attackerUserId,
  }
  const captured = []

  await withPatch(
    calibrationPromotionService,
    'createCalibrationPromotionPreview',
    async (userId, payload) => {
      captured.push({ operation: 'preview', payload, userId })
      return { promotionPreviewId: 'preview-1' }
    },
    async () => withPatch(
      calibrationPromotionService,
      'applyCalibrationPromotion',
      async (userId, payload) => {
        captured.push({ operation: 'apply', payload, userId })
        return { promotionId: 'promotion-1', status: 'APPLIED' }
      },
      async () => {
        const preview = await request(
          '/api/power-rating-simulations/model-calibration/promotion/preview',
          {
            body: JSON.stringify(previewPayload),
            headers,
            method: 'POST',
          },
        )
        const apply = await request(
          '/api/power-rating-simulations/model-calibration/promotion/apply',
          {
            body: JSON.stringify(applyPayload),
            headers,
            method: 'POST',
          },
        )

        assert.equal(preview.status, 200)
        assert.equal(preview.body.promotionPreviewId, 'preview-1')
        assert.equal(apply.status, 200)
        assert.equal(apply.body.promotionId, 'promotion-1')
      },
    ),
  )

  assert.deepEqual(captured, [
    {
      operation: 'preview',
      payload: previewPayload,
      userId: authenticatedUserId,
    },
    {
      operation: 'apply',
      payload: applyPayload,
      userId: authenticatedUserId,
    },
  ])
  assert.notEqual(captured[0].userId, attackerUserId)
  assert.notEqual(captured[1].userId, attackerUserId)
})

test('robustness route uses authenticated scope and delegates only the requested frozen analysis identity', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const attackerUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  const payload = {
    candidateId: 'candidate-1',
    identity: {
      baselineSignature: 'baseline-signature',
      candidateConfigurationSignature: 'configuration-signature',
      datasetSignature: 'dataset-signature',
      gameIdSignature: 'game-id-signature',
      productionSnapshotId: 'snapshot-1',
      startingStateSignature: 'starting-state-signature',
    },
    intervalLevel: 0.95,
    replicates: 1000,
    runId: 'run-1',
    seed: 42,
    userId: attackerUserId,
  }
  let capturedPayload = null
  let capturedUserId = null

  await withPatch(
    calibrationRobustnessService,
    'runCalibrationRobustness',
    (userId, requestPayload) => {
      capturedUserId = userId
      capturedPayload = requestPayload
      return {
        analysisId: 'analysis-1',
        diagnostics: { productionWrites: false },
      }
    },
    async () => {
      const response = await request(
        '/api/power-rating-simulations/model-calibration/robustness',
        {
          body: JSON.stringify(payload),
          headers: {
            Cookie: `nhl_edge_session=${token}`,
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          method: 'POST',
        },
      )

      assert.equal(response.status, 200)
      assert.equal(response.body.analysisId, 'analysis-1')
      assert.equal(response.body.diagnostics.productionWrites, false)
    },
  )

  assert.equal(capturedUserId, authenticatedUserId)
  assert.notEqual(capturedUserId, attackerUserId)
  assert.deepEqual(capturedPayload, payload)
})

test('run route delegates the exact request to the calibration orchestrator using only the authenticated user', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const attackerUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  const payload = {
    baselineMode: 'CURRENT_PRODUCTION',
    evaluationSeasons: ['20242025'],
    experiments: [
      {
        candidateId: 'base-k-1-1',
        overrides: { kFactor: 1.1 },
        type: 'BASE_MODEL',
      },
    ],
    startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
    userId: attackerUserId,
  }
  let capturedPayload = null
  let capturedUserId = null

  await withPatch(
    calibrationOrchestrator,
    'runCalibrationOrchestration',
    async (userId, requestPayload) => {
      capturedUserId = userId
      capturedPayload = requestPayload
      return {
        diagnostics: { productionWrites: false },
        runId: 'read-only-run',
      }
    },
    async () => {
      const response = await request(
        '/api/power-rating-simulations/model-calibration/run',
        {
          body: JSON.stringify(payload),
          headers: {
            Cookie: `nhl_edge_session=${token}`,
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          method: 'POST',
        },
      )

      assert.equal(response.status, 200)
      assert.equal(response.body.runId, 'read-only-run')
      assert.equal(response.body.diagnostics.productionWrites, false)
    },
  )

  assert.equal(capturedUserId, authenticatedUserId)
  assert.deepEqual(capturedPayload, payload)
  assert.notEqual(capturedUserId, attackerUserId)
})

test('authenticated run route accepts valid COMBINED requests and rejects duplicate families', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  const headers = {
    Cookie: `nhl_edge_session=${token}`,
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
  }
  const basePayload = {
    baselineMode: 'CANONICAL_BASE_MODEL_V1',
    evaluationSeasons: ['20242025'],
    startingStatePolicy: 'FIXED_SPREAD_ALPHABETICAL',
  }

  await withPatch(
    calibrationOrchestrator,
    'runCalibrationOrchestration',
    async (_userId, requestPayload) => ({
      diagnostics: { productionWrites: false },
      normalizedRequest: calibrationOrchestrator.normalizeRequest(requestPayload),
    }),
    async () => {
      const valid = await request(
        '/api/power-rating-simulations/model-calibration/run',
        {
          body: JSON.stringify({
            ...basePayload,
            experiments: [{
              candidateId: 'combined-ha-rest',
              components: [
                {
                  candidateId: 'ha',
                  overrides: { adjustment: 0.5 },
                  type: 'TEAM_HOME_ADVANTAGE',
                },
                {
                  candidateId: 'rest',
                  overrides: { backToBack: -0.75 },
                  type: 'REST_FATIGUE',
                },
              ],
              type: 'COMBINED',
            }],
          }),
          headers,
          method: 'POST',
        },
      )
      const invalid = await request(
        '/api/power-rating-simulations/model-calibration/run',
        {
          body: JSON.stringify({
            ...basePayload,
            experiments: [{
              candidateId: 'combined-duplicate-ha',
              components: [
                { overrides: { adjustment: 0.25 }, type: 'TEAM_HOME_ADVANTAGE' },
                { overrides: { adjustment: 0.5 }, type: 'TEAM_HOME_ADVANTAGE' },
              ],
              type: 'COMBINED',
            }],
          }),
          headers,
          method: 'POST',
        },
      )

      assert.equal(valid.status, 200)
      assert.equal(valid.body.normalizedRequest.experiments[0].type, 'COMBINED')
      assert.equal(valid.body.normalizedRequest.experiments[0].components.length, 2)
      assert.equal(invalid.status, 400)
      assert.match(invalid.body.message, /unique feature-family component types/)
    },
  )
})

test('options route resolves user-scoped production context through the focused service', async () => {
  const authenticatedUserId = new mongoose.Types.ObjectId().toString()
  const token = authSessionService.createTestAuthSession(authenticatedUserId)
  let capturedUserId = null

  await withPatch(
    calibrationOrchestrationOptions,
    'getCalibrationOrchestrationOptions',
    async (userId) => {
      capturedUserId = userId
      return {
        defaultBaselineMode: 'CURRENT_PRODUCTION',
        isolation: { productionWrites: false, readOnly: true },
      }
    },
    async () => {
      const response = await request(
        '/api/power-rating-simulations/model-calibration/options',
        { headers: { Cookie: `nhl_edge_session=${token}` } },
      )

      assert.equal(response.status, 200)
      assert.equal(response.body.defaultBaselineMode, 'CURRENT_PRODUCTION')
      assert.deepEqual(response.body.isolation, {
        productionWrites: false,
        readOnly: true,
      })
    },
  )

  assert.equal(capturedUserId, authenticatedUserId)
})

test('options service reuses shared readiness and exposes exact baseline configurations', async () => {
  const canonical = calibrationOrchestrator.buildCanonicalBaseline()
  let requestedGameDefinitions = null
  let requestedSpecialTeamsSeasons = null
  const result = await calibrationOrchestrationOptions
    .getCalibrationOrchestrationOptions('user-1', {
      gameStatusProvider: async (definitions) => {
        requestedGameDefinitions = definitions
        return definitions.map((definition) => ({
          completedGames: 1312,
          importedGames: 1312,
          seasonId: definition.id,
          status: 'ready',
        }))
      },
      productionSnapshotProvider: async () => ({
        configuration: canonical.configuration,
        productionSnapshotId: 'production-snapshot-1',
      }),
      specialTeamsStatusProvider: async (seasonIds) => {
        requestedSpecialTeamsSeasons = seasonIds
        return seasonIds.map((seasonId) => ({ seasonId, status: 'ready' }))
      },
    })

  assert.deepEqual(
    result.seasons.map((season) => season.id),
    ['20232024', '20242025', '20252026'],
  )
  assert.deepEqual(result.defaultSeasonIds, [
    '20232024',
    '20242025',
    '20252026',
  ])
  assert.deepEqual(
    result.baselineModes.map((baseline) => baseline.id),
    ['CURRENT_PRODUCTION', 'CANONICAL_BASE_MODEL_V1'],
  )
  assert.equal(result.baselineModes[0].productionSnapshotId, 'production-snapshot-1')
  assert.deepEqual(
    result.baselineModes[0].configuration,
    canonical.configuration,
  )
  assert.equal(result.startingState.policy, 'FIXED_SPREAD_ALPHABETICAL')
  assert.deepEqual(result.isolation, { productionWrites: false, readOnly: true })
  assert.equal(
    result.seasons.every((season) =>
      season.readiness.baseModel &&
      season.readiness.teamHomeAdvantage &&
      season.readiness.specialTeams),
    true,
  )
  assert.ok(requestedGameDefinitions.length > result.seasons.length)
  assert.ok(requestedSpecialTeamsSeasons.length > 0)
  assert.equal(Object.isFrozen(result), true)
})
