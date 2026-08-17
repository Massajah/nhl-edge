process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  NHL_API_CACHE_TTLS_MS,
  buildScheduleDateRequests,
  createNhlApiRequester,
  getCacheTtlMs,
  getHistoricalScheduleRangeCacheKey,
  getRosterForTeam,
  getScheduleGamesForDateRange,
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

test('standings cache uses short current and long historical TTLs', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  assert.equal(
    getCacheTtlMs('/standings/now', now),
    NHL_API_CACHE_TTLS_MS.currentStandings,
  )
  assert.equal(
    getCacheTtlMs('/standings/2025-04-17', now),
    NHL_API_CACHE_TTLS_MS.historicalStandings,
  )
  assert.equal(
    NHL_API_CACHE_TTLS_MS.currentStandings <
      NHL_API_CACHE_TTLS_MS.historicalStandings,
    true,
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

test('interactive requester defaults to one bounded 429 retry', async () => {
  let callCount = 0
  const sleeps = []
  const requester = createNhlApiRequester({
    fetchImpl: async () => {
      callCount += 1

      return createResponse({
        headers: { 'retry-after': '3' },
        ok: false,
        status: 429,
      })
    },
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs)
    },
  })

  await assert.rejects(
    () => requester('https://example.test', '/roster/DAL/current'),
    (error) => error.upstreamStatus === 429,
  )
  assert.equal(callCount, 2)
  assert.deepEqual(sleeps, [3000])
})

test('interactive Retry-After delay is capped to avoid excessive page waits', async () => {
  const sleeps = []
  const responses = [
    createResponse({
      headers: { 'retry-after': '60' },
      ok: false,
      status: 429,
    }),
    createResponse({ body: { recovered: true } }),
  ]
  const requester = createNhlApiRequester({
    fetchImpl: async () => responses.shift(),
    maxRetries: 1,
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs)
    },
  })

  assert.deepEqual(
    await requester('https://example.test', '/roster/DAL/current'),
    { recovered: true },
  )
  assert.deepEqual(sleeps, [5000])
})

test('NHL API requester returns stale metadata after a provider 429', async () => {
  const cache = new Map()
  let currentTime = Date.parse('2026-07-30T12:00:00.000Z')
  let callCount = 0
  const requester = createNhlApiRequester({
    cache,
    fetchImpl: async () => {
      callCount += 1

      return callCount === 1
        ? createResponse({ body: { roster: 'cached' } })
        : createResponse({ ok: false, status: 429 })
    },
    maxRetries: 0,
    now: () => currentTime,
    sleepImpl: async () => {},
  })

  await requester('https://example.test', '/roster/DAL/current')
  currentTime += NHL_API_CACHE_TTLS_MS.default + 1
  const staleResult = await requester(
    'https://example.test',
    '/roster/DAL/current',
    { allowStale: true, includeMetadata: true },
  )

  assert.deepEqual(staleResult.data, { roster: 'cached' })
  assert.equal(staleResult.source, 'stale_cache')
  assert.equal(staleResult.stale, true)
  assert.match(staleResult.fetchedAt, /^2026-07-30T12:00:00\.000Z$/)
  assert.equal(callCount, 2)
})

test('concurrent callers share the same bounded 429 retry', async () => {
  let callCount = 0
  const sleeps = []
  const requester = createNhlApiRequester({
    fetchImpl: async () => {
      callCount += 1

      return callCount === 1
        ? createResponse({
            headers: { 'retry-after': '1' },
            ok: false,
            status: 429,
          })
        : createResponse({ body: { recovered: true } })
    },
    maxRetries: 1,
    now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs)
    },
  })

  const first = requester('https://example.test', '/roster/DAL/current')
  const duplicate = requester('https://example.test', '/roster/DAL/current')
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate])

  assert.equal(callCount, 2)
  assert.deepEqual(sleeps, [1000])
  assert.equal(duplicateResult, firstResult)
})

test('one team roster response supplies all position groups', async () => {
  let providerCalls = 0
  const result = await getRosterForTeam('DAL', {
    includeProviderState: true,
    requestRoster: async () => {
      providerCalls += 1

      return {
        data: {
          defensemen: [{ id: 2, positionCode: 'D' }],
          forwards: [{ id: 1, positionCode: 'C' }],
          goalies: [{ id: 3, positionCode: 'G' }],
        },
        fetchedAt: '2026-08-06T10:00:00.000Z',
        source: 'live',
        stale: false,
      }
    },
  })

  assert.equal(providerCalls, 1)
  assert.equal(result.data.forwards.length, 1)
  assert.equal(result.data.defensemen.length, 1)
  assert.equal(result.data.goalies.length, 1)
  assert.equal(result.status, 'ready')
})

test('schedule date range requests use weekly batches with endpoint coverage', () => {
  assert.deepEqual(buildScheduleDateRequests('2026-01-01', '2026-01-16'), [
    '2026-01-01',
    '2026-01-08',
    '2026-01-15',
    '2026-01-16',
  ])
  assert.equal(
    [
      ['2025-10-07', '2026-04-16'],
      ['2024-10-04', '2025-04-17'],
      ['2023-10-10', '2024-04-18'],
    ].reduce(
      (total, [dateFrom, dateTo]) =>
        total + buildScheduleDateRequests(dateFrom, dateTo).length,
      0,
    ),
    87,
  )
})

test('historical season range loading is bounded, canonical and reused from cache', async () => {
  let active = 0
  let maximumActive = 0
  let providerCalls = 0
  const scheduleProvider = async (date) => {
    active += 1
    providerCalls += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1

    return {
      data: {
        gameWeek: [
          {
            date,
            games: [],
          },
        ],
      },
      fetchedAt: '2099-10-01T00:00:00.000Z',
      source: 'live',
      stale: false,
    }
  }
  const first = await getScheduleGamesForDateRange(
    '2099-10-01',
    '2099-10-16',
    {
      getScheduleForDateProvider: scheduleProvider,
      includeProviderState: true,
      seasonId: '2099–00',
    },
  )
  const second = await getScheduleGamesForDateRange(
    '2099-10-01',
    '2099-10-16',
    {
      getScheduleForDateProvider: async () => {
        throw new Error('cache was not reused')
      },
      includeProviderState: true,
      seasonId: '20992100',
    },
  )

  assert.equal(first.requestCount, 4)
  assert.equal(providerCalls, 4)
  assert.equal(maximumActive, 2)
  assert.equal(second.source, 'season_cache')
  assert.equal(
    getHistoricalScheduleRangeCacheKey(
      '2099-00',
      '2099-10-01',
      '2099-10-16',
    ),
    '/historical-schedule-season/20992100/2099-10-01/2099-10-16',
  )
})
