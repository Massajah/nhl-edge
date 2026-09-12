process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const modelPerformanceService = require('../services/modelPerformanceService')

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

test('both Model Performance endpoints require authentication', async () => {
  const aggregate = await request('/api/model-performance')
  const games = await request('/api/model-performance/games')

  assert.equal(aggregate.status, 401)
  assert.equal(games.status, 401)
  assert.equal(aggregate.body.message, 'Authentication required.')
})

test('aggregate route uses only authenticated identity and forwards supported query data', async () => {
  const original = modelPerformanceService.getModelPerformance
  const token = authSessionService.createTestAuthSession('authenticated-owner')
  let received = null

  modelPerformanceService.getModelPerformance = async (userId, query) => {
    received = { query, userId }
    return { metadata: { modelVersion: 'power-rating-v1' } }
  }

  try {
    const response = await request(
      '/api/model-performance?season=20262027&userId=attacker',
      { headers: { Cookie: `nhl_edge_session=${token}` } },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.metadata.modelVersion, 'power-rating-v1')
  } finally {
    modelPerformanceService.getModelPerformance = original
  }

  assert.equal(received.userId, 'authenticated-owner')
  assert.equal(received.query.season, '20262027')
  assert.notEqual(received.userId, received.query.userId)
})

test('games route returns pagination and preserves validated filter inputs', async () => {
  const original = modelPerformanceService.getModelPerformanceGames
  const token = authSessionService.createTestAuthSession('games-owner')
  let received = null

  modelPerformanceService.getModelPerformanceGames = async (userId, query) => {
    received = { query, userId }
    return {
      items: [],
      pagination: { page: 2, pageSize: 10, totalItems: 0, totalPages: 0 },
    }
  }

  try {
    const response = await request(
      '/api/model-performance/games?status=missing_market&page=2&limit=10',
      { headers: { Cookie: `nhl_edge_session=${token}` } },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.pagination.page, 2)
  } finally {
    modelPerformanceService.getModelPerformanceGames = original
  }

  assert.equal(received.userId, 'games-owner')
  assert.equal(received.query.status, 'missing_market')
  assert.equal(received.query.limit, '10')
})

test('validation errors use the existing safe API error contract', async () => {
  const original = modelPerformanceService.getModelPerformance
  const token = authSessionService.createTestAuthSession('validation-owner')

  modelPerformanceService.getModelPerformance = async () => {
    throw new modelPerformanceService.ModelPerformanceError(
      'modelVersion is invalid.',
      400,
      { field: 'modelVersion' },
    )
  }

  try {
    const response = await request('/api/model-performance?modelVersion=%24bad', {
      headers: { Cookie: `nhl_edge_session=${token}` },
    })

    assert.equal(response.status, 400)
    assert.equal(response.body.message, 'modelVersion is invalid.')
    assert.deepEqual(response.body.details, { field: 'modelVersion' })
  } finally {
    modelPerformanceService.getModelPerformance = original
  }
})
