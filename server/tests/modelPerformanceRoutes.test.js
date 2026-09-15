process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const modelPerformanceService = require('../services/modelPerformanceService')
const demoModelPerformanceService = require('../services/demoModelPerformanceService')

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

  modelPerformanceService.getModelPerformance = async (userId, query, options) => {
    received = { options, query, userId }
    return { metadata: { modelVersion: 'power-rating-v1' } }
  }

  try {
    const response = await request(
      '/api/model-performance?season=20262027&userId=attacker&demo=true',
      { headers: { Cookie: `nhl_edge_session=${token}` } },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.metadata.modelVersion, 'power-rating-v1')
  } finally {
    modelPerformanceService.getModelPerformance = original
  }

  assert.equal(received.userId, 'authenticated-owner')
  assert.equal(received.query.season, '20262027')
  assert.deepEqual(received.options, { productionCaptureEligible: true })
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

test('games route forwards capture-health filters without granting client identity authority', async () => {
  const original = modelPerformanceService.getModelPerformanceGames
  const token = authSessionService.createTestAuthSession('capture-health-owner')
  let received = null

  modelPerformanceService.getModelPerformanceGames = async (userId, query) => {
    received = { query, userId }
    return {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }
  }

  try {
    const response = await request(
      '/api/model-performance/games?captureHealth=finalMissing&userId=attacker',
      { headers: { Cookie: `nhl_edge_session=${token}` } },
    )

    assert.equal(response.status, 200)
  } finally {
    modelPerformanceService.getModelPerformanceGames = original
  }

  assert.equal(received.userId, 'capture-health-owner')
  assert.equal(received.query.captureHealth, 'finalMissing')
  assert.notEqual(received.userId, received.query.userId)
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

test('demo Model Performance is explicitly ineligible for production capture health', async () => {
  const original = demoModelPerformanceService.getDemoModelPerformance
  const token = authSessionService.createTestAuthSession('demo-owner', {
    user: {
      _id: 'demo-owner',
      accountType: 'DEMO_SANDBOX',
      role: 'user',
      status: 'active',
    },
  })
  let receivedOptions = null

  demoModelPerformanceService.getDemoModelPerformance = async (
    userId,
    query,
  ) => {
    receivedOptions = { query, userId }
    return { dataMode: 'DEMO_SAMPLE' }
  }

  try {
    const response = await request('/api/model-performance', {
      headers: { Cookie: `nhl_edge_session=${token}` },
    })

    assert.equal(response.status, 200)
  } finally {
    demoModelPerformanceService.getDemoModelPerformance = original
  }

  assert.equal(receivedOptions.userId, 'demo-owner')
  assert.deepEqual({ ...receivedOptions.query }, {})
})

test('demo games route is selected by authenticated account type, not query input', async () => {
  const original = demoModelPerformanceService.getDemoModelPerformanceGames
  const token = authSessionService.createTestAuthSession('demo-games-owner', {
    user: {
      _id: 'demo-games-owner',
      accountType: 'DEMO_SANDBOX',
      role: 'user',
      status: 'active',
    },
  })
  let received = null

  demoModelPerformanceService.getDemoModelPerformanceGames = async (
    userId,
    query,
  ) => {
    received = { query: { ...query }, userId }
    return {
      dataMode: 'DEMO_SAMPLE',
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }
  }

  try {
    const response = await request(
      '/api/model-performance/games?demo=false&page=1',
      { headers: { Cookie: `nhl_edge_session=${token}` } },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.dataMode, 'DEMO_SAMPLE')
  } finally {
    demoModelPerformanceService.getDemoModelPerformanceGames = original
  }

  assert.equal(received.userId, 'demo-games-owner')
  assert.equal(received.query.demo, 'false')
})

test('invalid account type fails closed for Model Performance capture health', async () => {
  const original = modelPerformanceService.getModelPerformance
  const token = authSessionService.createTestAuthSession('invalid-owner', {
    user: {
      _id: 'invalid-owner',
      accountType: 'UNEXPECTED',
      role: 'user',
      status: 'active',
    },
  })
  let receivedOptions = null

  modelPerformanceService.getModelPerformance = async (
    _userId,
    _query,
    options,
  ) => {
    receivedOptions = options
    return { captureHealth: { status: 'UNAVAILABLE' } }
  }

  try {
    const response = await request('/api/model-performance', {
      headers: { Cookie: `nhl_edge_session=${token}` },
    })

    assert.equal(response.status, 200)
  } finally {
    modelPerformanceService.getModelPerformance = original
  }

  assert.deepEqual(receivedOptions, { productionCaptureEligible: false })
})
