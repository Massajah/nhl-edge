process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  NHL_API_CACHE_TTLS_MS,
  buildScheduleDateRequests,
  createNhlApiRequester,
  getCacheTtlMs,
} = require('../services/nhlApiService')

const createResponse = ({ body = {}, headers = {}, ok = true, status = 200 }) => ({
  headers: {
    get: (headerName) => headers[headerName.toLowerCase()] ?? null,
  },
  json: async () => body,
  ok,
  status,
})

const waitForMicrotasks = () =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

const waitUntil = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return
    }

    await waitForMicrotasks()
  }

  throw new Error('Timed out waiting for async condition.')
}

test('NHL API requester de-duplicates concurrent identical requests', async () => {
  let callCount = 0
  let resolveFetch
  const requester = createNhlApiRequester({
    fetchImpl: async () => {
      callCount += 1
      await new Promise((resolve) => {
        resolveFetch = resolve
      })

      return createResponse({ body: { ok: true } })
    },
    jitterMs: () => 0,
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async () => {},
  })

  const firstRequest = requester('https://example.test', '/schedule/2026-01-01')
  const secondRequest = requester('https://example.test', '/schedule/2026-01-01')

  await waitUntil(() => Boolean(resolveFetch))
  assert.equal(callCount, 1)

  resolveFetch()

  const [first, second] = await Promise.all([firstRequest, secondRequest])

  assert.deepEqual(first, { ok: true })
  assert.equal(second, first)
})

test('NHL API requester serves cached schedule responses within TTL', async () => {
  let callCount = 0
  const requester = createNhlApiRequester({
    fetchImpl: async () => {
      callCount += 1

      return createResponse({ body: { callCount } })
    },
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async () => {},
  })

  const first = await requester('https://example.test', '/schedule/2026-01-01')
  const second = await requester('https://example.test', '/schedule/2026-01-01')

  assert.deepEqual(first, { callCount: 1 })
  assert.deepEqual(second, { callCount: 1 })
  assert.equal(callCount, 1)
  assert.equal(
    getCacheTtlMs(
      '/schedule/2026-01-01',
      new Date('2026-07-30T12:00:00.000Z'),
    ),
    NHL_API_CACHE_TTLS_MS.historicalSchedule,
  )
  assert.equal(
    getCacheTtlMs(
      '/schedule/2026-07-30',
      new Date('2026-07-30T16:00:00.000Z'),
    ),
    NHL_API_CACHE_TTLS_MS.currentSchedule,
  )
})

test('NHL API requester limits concurrent distinct upstream requests', async () => {
  let activeCount = 0
  let maxActiveCount = 0
  const resolvers = []
  const requester = createNhlApiRequester({
    concurrencyLimit: 2,
    fetchImpl: async (url) => {
      activeCount += 1
      maxActiveCount = Math.max(maxActiveCount, activeCount)

      await new Promise((resolve) => {
        resolvers.push(resolve)
      })

      activeCount -= 1

      return createResponse({ body: { url } })
    },
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async () => {},
  })
  const requests = ['/one', '/two', '/three', '/four'].map((path) =>
    requester('https://example.test', path),
  )

  await waitUntil(() => resolvers.length === 2)
  assert.equal(activeCount, 2)

  for (let index = 0; index < requests.length; index += 1) {
    await waitUntil(() => resolvers.length > 0)
    resolvers.shift()()
    await waitForMicrotasks()
  }

  await Promise.all(requests)
  assert.equal(maxActiveCount, 2)
})

test('NHL API requester retries 429 responses with Retry-After', async () => {
  const sleeps = []
  const responses = [
    createResponse({
      headers: {
        'retry-after': '2',
      },
      ok: false,
      status: 429,
    }),
    createResponse({
      body: {
        recovered: true,
      },
    }),
  ]
  const requester = createNhlApiRequester({
    fetchImpl: async () => responses.shift(),
    jitterMs: () => 0,
    maxRetries: 2,
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs)
    },
  })

  const response = await requester('https://example.test', '/schedule/2026-01-01')

  assert.deepEqual(response, { recovered: true })
  assert.deepEqual(sleeps, [2000])
})

test('NHL API requester stops after configured 429 retry attempts', async () => {
  let callCount = 0
  const sleeps = []
  const requester = createNhlApiRequester({
    fetchImpl: async () => {
      callCount += 1

      return createResponse({
        headers: {
          'retry-after': '1',
        },
        ok: false,
        status: 429,
      })
    },
    jitterMs: () => 0,
    maxRetries: 2,
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs)
    },
  })

  await assert.rejects(
    () => requester('https://example.test', '/schedule/2026-01-01'),
    (error) => error.upstreamStatus === 429 && error.statusCode === 429,
  )
  assert.equal(callCount, 3)
  assert.deepEqual(sleeps, [1000, 1000])
})

test('schedule date range requests use weekly batches with endpoint coverage', () => {
  assert.deepEqual(buildScheduleDateRequests('2026-01-01', '2026-01-16'), [
    '2026-01-01',
    '2026-01-08',
    '2026-01-15',
    '2026-01-16',
  ])
})
