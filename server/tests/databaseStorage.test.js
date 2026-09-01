process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const authService = require('../services/authService')
const databaseStorageService = require('../services/databaseStorageService')

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

const atlasResult = (overrides = {}) => ({
  atlasSize: 80 * 1024 ** 2,
  host: 'must-not-leak.example.net',
  ok: 1,
  totals: {
    collections: 44,
    dataSize: 60 * 1024 ** 2,
    indexSize: 20 * 1024 ** 2,
    storageSize: 999999999,
  },
  ...overrides,
})

test('capacity calculation returns percentage and remaining bytes', () => {
  assert.deepEqual(
    databaseStorageService.calculateCapacity(128 * 1024 ** 2, 512 * 1024 ** 2),
    {
      percentUsed: 25,
      remainingBytes: 384 * 1024 ** 2,
    },
  )
})

test('capacity calculation clamps over-capacity results and rejects invalid limits', () => {
  assert.deepEqual(databaseStorageService.calculateCapacity(600, 512), {
    percentUsed: 100,
    remainingBytes: 0,
  })
  assert.equal(databaseStorageService.calculateCapacity(10, 0), null)
  assert.equal(databaseStorageService.calculateCapacity(-1, 512), null)
})

test('atlasSize is normalized without leaking raw MongoDB response fields', () => {
  const result = databaseStorageService.buildStorageResult(atlasResult(), {
    checkedAt: '2026-09-01T06:42:00.000Z',
    limitBytes: 512 * 1024 ** 2,
    limitSource: 'configured_atlas_free_tier',
  })

  assert.deepEqual(Object.keys(result).sort(), [
    'available',
    'checkedAt',
    'dataBytes',
    'indexBytes',
    'limitBytes',
    'percentUsed',
    'remainingBytes',
    'source',
    'usedBytes',
  ])
  assert.equal(result.available, true)
  assert.equal(result.usedBytes, 80 * 1024 ** 2)
  assert.equal(result.dataBytes, 60 * 1024 ** 2)
  assert.equal(result.indexBytes, 20 * 1024 ** 2)
  assert.equal(result.percentUsed, 15.63)
  assert.equal(Object.hasOwn(result, 'host'), false)
  assert.equal(Object.hasOwn(result, 'ok'), false)
  assert.equal(Object.hasOwn(result, 'totals'), false)
  assert.equal(Object.hasOwn(result, 'storageSize'), false)
})

test('MongoDB command failures produce a graceful unavailable result', async () => {
  databaseStorageService.clearDatabaseStorageCache()

  const result = await databaseStorageService.getDatabaseStorageStatus({
    command: async () => {
      throw new Error('connection closed')
    },
    limitBytes: 512,
    now: () => Date.parse('2026-09-01T06:42:00.000Z'),
  })

  assert.equal(result.available, false)
  assert.equal(result.reason, 'measurement_failed')
  assert.equal(result.percentUsed, null)
  assert.equal(result.remainingBytes, null)
  assert.equal(result.message, 'Database storage usage is temporarily unavailable.')
})

test('unsupported atlasSize is identified without fabricating quota usage', async () => {
  databaseStorageService.clearDatabaseStorageCache()
  const error = new Error('atlasSize is not allowed on this deployment')
  error.codeName = 'CommandNotFound'

  const result = await databaseStorageService.getDatabaseStorageStatus({
    command: async () => {
      throw error
    },
    limitBytes: 512,
    now: () => Date.parse('2026-09-01T06:43:00.000Z'),
  })

  assert.equal(result.available, false)
  assert.equal(result.reason, 'unsupported')
  assert.equal(result.usedBytes, null)
  assert.match(result.message, /does not expose a reliable quota-usage value/)
})

test('storage result cache is shared, short-lived, and explicitly bypassed', async () => {
  databaseStorageService.clearDatabaseStorageCache()
  let commandCalls = 0
  let currentTime = Date.parse('2026-09-01T06:44:00.000Z')
  const command = async () => {
    commandCalls += 1
    return atlasResult({ atlasSize: commandCalls * 1024 })
  }
  const options = {
    cacheTtlMs: 180000,
    command,
    limitBytes: 512 * 1024 ** 2,
    now: () => currentTime,
  }

  const initial = await databaseStorageService.getDatabaseStorageStatus(options)
  const cached = await databaseStorageService.getDatabaseStorageStatus(options)
  const refreshed = await databaseStorageService.getDatabaseStorageStatus({
    ...options,
    refresh: true,
  })
  currentTime += 180001
  const expired = await databaseStorageService.getDatabaseStorageStatus(options)

  assert.equal(initial.cached, false)
  assert.equal(cached.cached, true)
  assert.equal(cached.usedBytes, initial.usedBytes)
  assert.equal(refreshed.cached, false)
  assert.notEqual(refreshed.usedBytes, initial.usedBytes)
  assert.equal(expired.cached, false)
  assert.equal(commandCalls, 3)
})

test('storage endpoint rejects unauthenticated requests', async () => {
  const response = await request('/api/settings/storage')

  assert.equal(response.status, 401)
  assert.equal(response.body.message, 'Authentication required.')
})

test('authenticated storage endpoint returns normalized metadata and honors refresh', async () => {
  const originalGetStatus = databaseStorageService.getDatabaseStorageStatus
  const capturedOptions = []
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())

  databaseStorageService.getDatabaseStorageStatus = async (options) => {
    capturedOptions.push(options)
    return {
      available: true,
      cached: false,
      checkedAt: '2026-09-01T06:45:00.000Z',
      dataBytes: 300,
      indexBytes: 100,
      limitBytes: 512,
      percentUsed: 78.13,
      remainingBytes: 112,
      source: {
        limit: 'configured_atlas_free_tier',
        usage: 'mongodb_atlas_atlasSize',
      },
      usedBytes: 400,
    }
  }

  try {
    const response = await request(
      '/api/settings/storage?refresh=true&userId=another-user',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.usedBytes, 400)
    assert.equal(response.body.percentUsed, 78.13)
    assert.deepEqual(capturedOptions, [{ refresh: true }])
    assert.equal(Object.hasOwn(response.body, 'userId'), false)
    assert.equal(Object.hasOwn(response.body, 'uri'), false)
    assert.equal(Object.hasOwn(response.body, 'databaseName'), false)
  } finally {
    databaseStorageService.getDatabaseStorageStatus = originalGetStatus
  }
})
