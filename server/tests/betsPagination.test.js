process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const betsService = require('../services/betsService')

const stringifyId = (value) => value?.toString?.() ?? String(value)

const matchesFilter = (record, filter) =>
  Object.entries(filter).every(([field, expected]) => {
    if (field === '$and') {
      return expected.every((condition) => matchesFilter(record, condition))
    }

    if (field === '$or') {
      return expected.some((condition) => matchesFilter(record, condition))
    }

    const actual = record[field]

    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return actual !== expected.$ne
    }

    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(actual ?? null)
    }

    if (expected && typeof expected === 'object' && '$nin' in expected) {
      return !expected.$nin.includes(actual ?? null)
    }

    if (expected && typeof expected === 'object' && '$exists' in expected) {
      return (actual !== undefined) === expected.$exists
    }

    if (field === 'userId') {
      return stringifyId(actual) === stringifyId(expected)
    }

    if (expected && typeof expected === 'object') {
      if (
        actual === null ||
        actual === undefined
      ) {
        return false
      }

      const actualValue = actual instanceof Date ? actual.getTime() : actual

      if ('$gte' in expected && actualValue < new Date(expected.$gte).getTime()) {
        return false
      }

      if ('$lt' in expected && actualValue >= new Date(expected.$lt).getTime()) {
        return false
      }

      if ('$lte' in expected && actualValue > new Date(expected.$lte).getTime()) {
        return false
      }

      if ('$gt' in expected && actualValue <= new Date(expected.$gt).getTime()) {
        return false
      }

      return true
    }

    if (expected === null) {
      return actual === null || actual === undefined
    }

    return actual === expected
  })

const createQuery = (initialRecords) => {
  let records = [...initialRecords]

  return {
    lean() {
      return this
    },
    limit(limit) {
      records = records.slice(0, limit)
      return this
    },
    select() {
      return this
    },
    skip(skip) {
      records = records.slice(skip)
      return this
    },
    sort(criteria) {
      const entries = Object.entries(criteria)

      records.sort((left, right) => {
        for (const [field, direction] of entries) {
          const leftValue = new Date(left[field]).getTime()
          const rightValue = new Date(right[field]).getTime()

          if (leftValue !== rightValue) {
            return direction < 0 ? rightValue - leftValue : leftValue - rightValue
          }
        }

        return 0
      })
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(records).then(resolve, reject)
    },
  }
}

const createBetModel = (records) => ({
  countDocuments(filter) {
    return Promise.resolve(
      records.filter((record) => matchesFilter(record, filter)).length,
    )
  },
  find(filter) {
    return createQuery(records.filter((record) => matchesFilter(record, filter)))
  },
})

const createBet = (userId, index, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  analyzedAt: new Date(Date.UTC(2026, 0, index + 1)),
  createdAt: new Date(Date.UTC(2026, 0, index + 1)),
  expectedValue: 4,
  marketOdds: 2,
  modelStatus: 'Positive Value',
  profit: 0,
  result: 'pending',
  stake: 1,
  userId,
  ...overrides,
})

test('bet pages default to 5 newest-first user-scoped records', async () => {
  const userId = new mongoose.Types.ObjectId()
  const otherUserId = new mongoose.Types.ObjectId()
  const records = [
    ...Array.from({ length: 24 }, (_, index) =>
      createBet(userId, index, {
        profit: index % 3 === 0 ? 1 : 0,
        result: index % 3 === 0 ? 'win' : 'pending',
      }),
    ),
    createBet(otherUserId, 30, { profit: 999, result: 'win' }),
  ]

  const result = await betsService.getBetsPage(
    userId,
    {},
    { betModel: createBetModel(records) },
  )

  assert.equal(result.items.length, 5)
  assert.equal(result.pagination.page, 1)
  assert.equal(result.pagination.pageSize, 5)
  assert.equal(result.pagination.totalItems, 24)
  assert.equal(result.pagination.totalPages, 5)
  assert.equal(result.pagination.hasPreviousPage, false)
  assert.equal(result.pagination.hasNextPage, true)
  assert.equal(result.summary.totalBets, 24)
  assert.equal(result.summary.wins, 8)
  assert.equal(result.summary.pending, 16)
  assert.ok(
    new Date(result.items[0].analyzedAt) >
      new Date(result.items[result.items.length - 1].analyzedAt),
  )
})

test('bet filters are applied before 20-row pagination and final page state', async () => {
  const userId = new mongoose.Types.ObjectId()
  const records = Array.from({ length: 42 }, (_, index) =>
    createBet(userId, index, {
      modelStatus: index < 30 ? 'Bet Candidate' : 'No Value',
      profit: index < 30 ? 1 : -1,
      result: index < 30 ? 'win' : 'loss',
    }),
  )
  const betModel = createBetModel(records)
  const firstPage = await betsService.getBetsPage(
    userId,
    {
      limit: 20,
      modelStatus: 'Bet Candidate',
      page: 1,
      result: 'settled',
    },
    { betModel },
  )
  const finalPage = await betsService.getBetsPage(
    userId,
    {
      limit: 20,
      modelStatus: 'Bet Candidate',
      page: 2,
      result: 'settled',
    },
    { betModel },
  )

  assert.equal(firstPage.items.length, 20)
  assert.equal(firstPage.pagination.totalItems, 30)
  assert.equal(firstPage.pagination.hasPreviousPage, false)
  assert.equal(firstPage.pagination.hasNextPage, true)
  assert.equal(finalPage.items.length, 10)
  assert.equal(finalPage.pagination.hasPreviousPage, true)
  assert.equal(finalPage.pagination.hasNextPage, false)
  assert.ok(finalPage.items.every((bet) => bet.modelStatus === 'Bet Candidate'))
})

test('bet pagination only accepts the supported 5, 10, and 20 row sizes', () => {
  assert.throws(
    () => betsService.normalizeBetListQuery({ limit: 25 }),
    (error) => error.statusCode === 400 && error.details.field === 'limit',
  )
  assert.throws(
    () => betsService.normalizeBetListQuery({ limit: 6 }),
    (error) => error.statusCode === 400 && error.details.field === 'limit',
  )
})

test('legacy bet filtering keeps sparse historical records pageable', async () => {
  const userId = new mongoose.Types.ObjectId()
  const records = [
    createBet(userId, 1, {
      expectedValue: null,
      modelStatus: '',
    }),
    createBet(userId, 2, {
      modelStatus: 'Legacy bet',
    }),
    createBet(userId, 3, {
      modelStatus: 'Bet Candidate',
    }),
  ]
  const result = await betsService.getBetsPage(
    userId,
    { modelStatus: 'Legacy bet' },
    { betModel: createBetModel(records) },
  )

  assert.equal(result.items.length, 2)
  assert.equal(result.pagination.totalItems, 2)
  assert.equal(result.summary.statusCounts.Legacy, 2)
})

test('season filtering uses canonical NHL boundaries before pagination and summary', async () => {
  const userId = new mongoose.Types.ObjectId()
  const seasonMetadata = {
    currentSeasonId: '20262027',
    seasons: [
      {
        endDate: '2027-04-30',
        id: '20262027',
        isCurrent: true,
        label: '2026–27',
        startDate: '2026-10-01',
      },
      {
        endDate: '2026-04-16',
        id: '20252026',
        isCurrent: false,
        label: '2025–26',
        startDate: '2025-10-07',
      },
    ],
  }
  const records = [
    createBet(userId, 1, {
      analyzedAt: new Date('2025-11-01T12:00:00.000Z'),
      modelStatus: 'Positive Value',
      profit: 2,
      result: 'win',
      scheduledStart: new Date('2025-11-02T00:00:00.000Z'),
      stake: 1,
    }),
    createBet(userId, 2, {
      analyzedAt: new Date('2026-02-01T12:00:00.000Z'),
      modelStatus: 'Below Threshold',
      profit: -2,
      result: 'loss',
      scheduledStart: new Date('2026-02-02T00:00:00.000Z'),
      stake: 2,
    }),
    createBet(userId, 3, {
      analyzedAt: new Date('2026-11-01T12:00:00.000Z'),
      modelStatus: 'No Value',
      profit: 0,
      result: 'pending',
      scheduledStart: new Date('2026-11-02T00:00:00.000Z'),
      stake: 3,
    }),
  ]
  const result = await betsService.getBetsPage(
    userId,
    { limit: 5, season: '20252026' },
    { betModel: createBetModel(records), seasonMetadata },
  )

  assert.equal(result.items.length, 2)
  assert.equal(result.pagination.totalItems, 2)
  assert.equal(result.pagination.totalPages, 1)
  assert.equal(result.summary.totalBets, 2)
  assert.equal(result.summary.wins, 1)
  assert.equal(result.summary.losses, 1)
  assert.equal(result.summary.totalStake, 3)
  assert.equal(result.summary.totalProfit, 0)
  assert.deepEqual(result.summary.statusCounts, {
    'Bet Candidate': 1,
    'Positive Value · Below Threshold': 1,
  })
  assert.equal(result.filters.season, '20252026')
  assert.equal(result.season.label, '2025–26')
})

test('current season resolves through canonical metadata', async () => {
  const userId = new mongoose.Types.ObjectId()
  const records = [
    createBet(userId, 1, {
      analyzedAt: new Date('2026-11-01T12:00:00.000Z'),
    }),
    createBet(userId, 2, {
      analyzedAt: new Date('2026-02-01T12:00:00.000Z'),
    }),
  ]
  const result = await betsService.getBetsPage(
    userId,
    { season: 'current' },
    {
      betModel: createBetModel(records),
      seasonMetadata: {
        currentSeasonId: '20262027',
        seasons: [
          {
            endDate: '2027-04-30',
            id: '20262027',
            isCurrent: true,
            label: '2026–27',
            startDate: '2026-10-01',
          },
        ],
      },
    },
  )

  assert.equal(result.items.length, 1)
  assert.equal(result.filters.season, '20262027')
})

test('legacy recommendation labels normalize into current Bet History groups', async () => {
  const userId = new mongoose.Types.ObjectId()
  const records = [
    createBet(userId, 1, { modelStatus: 'Positive Value' }),
    createBet(userId, 2, { modelStatus: 'Bet Candidate' }),
    createBet(userId, 3, { modelStatus: 'Below Threshold' }),
    createBet(userId, 4, {
      modelStatus: 'Positive Value · Below Threshold',
    }),
    createBet(userId, 5, { modelStatus: 'No Value' }),
  ]
  const result = await betsService.getBetsPage(
    userId,
    { result: 'all' },
    { betModel: createBetModel(records) },
  )

  assert.deepEqual(result.summary.statusCounts, {
    'Bet Candidate': 2,
    'Positive Value · Below Threshold': 2,
    'No Value': 1,
  })

  const candidateResult = await betsService.getBetsPage(
    userId,
    { modelStatus: 'Bet Candidate' },
    { betModel: createBetModel(records) },
  )
  assert.equal(candidateResult.pagination.totalItems, 2)
  assert.equal(candidateResult.summary.statusCounts['Bet Candidate'], 2)
})

test('sparse historical results retain pending and default-stake summary semantics', async () => {
  const userId = new mongoose.Types.ObjectId()
  const sparseBet = createBet(userId, 1, {
    expectedValue: null,
    modelStatus: '',
    result: undefined,
    stake: undefined,
  })
  const result = await betsService.getBetsPage(
    userId,
    { result: 'pending' },
    { betModel: createBetModel([sparseBet]) },
  )

  assert.equal(result.items.length, 1)
  assert.equal(result.summary.pending, 1)
  assert.equal(result.summary.totalStake, 1)
  assert.equal(result.summary.settledStake, 0)
})
