process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const bankrollService = require('../services/bankrollService')

const sortRecords = (records, criteria = {}) => {
  const entries = Object.entries(criteria)

  return [...records].sort((left, right) => {
    for (const [field, direction] of entries) {
      const leftValue = left[field]
      const rightValue = right[field]
      const normalizedLeft =
        leftValue instanceof Date ? leftValue.getTime() : leftValue
      const normalizedRight =
        rightValue instanceof Date ? rightValue.getTime() : rightValue

      if (normalizedLeft < normalizedRight) {
        return direction < 0 ? 1 : -1
      }

      if (normalizedLeft > normalizedRight) {
        return direction < 0 ? -1 : 1
      }
    }

    return 0
  })
}

const queryOf = (value) => {
  let result = Array.isArray(value) ? [...value] : value

  return {
    lean() {
      return this
    },
    limit(limit) {
      if (Array.isArray(result)) {
        result = result.slice(0, limit)
      }

      return this
    },
    session() {
      return this
    },
    skip(skip) {
      if (Array.isArray(result)) {
        result = result.slice(skip)
      }

      return this
    },
    sort(criteria) {
      if (Array.isArray(result)) {
        result = sortRecords(result, criteria)
      }

      return this
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
}

const stringifyId = (value) => value?.toString?.() ?? String(value)

const matchesCondition = (actualValue, expectedValue) => {
  if (
    expectedValue &&
    typeof expectedValue === 'object' &&
    !(expectedValue instanceof Date) &&
    !(expectedValue instanceof mongoose.Types.ObjectId)
  ) {
    if ('$in' in expectedValue) {
      return expectedValue.$in.includes(actualValue)
    }

    if ('$ne' in expectedValue && actualValue === expectedValue.$ne) {
      return false
    }

    if ('$gte' in expectedValue && actualValue < expectedValue.$gte) {
      return false
    }

    if ('$lt' in expectedValue && actualValue >= expectedValue.$lt) {
      return false
    }

    if ('$exists' in expectedValue) {
      const exists = actualValue !== undefined

      if (exists !== expectedValue.$exists) {
        return false
      }
    }

    return true
  }

  if (
    actualValue instanceof mongoose.Types.ObjectId ||
    expectedValue instanceof mongoose.Types.ObjectId
  ) {
    return stringifyId(actualValue) === stringifyId(expectedValue)
  }

  return actualValue === expectedValue
}

const matchesFilter = (record, filter = {}) =>
  Object.entries(filter).every(([field, expectedValue]) =>
    matchesCondition(record[field], expectedValue),
  )

const createMemoryModels = ({
  bets = [],
  now = new Date('2026-01-01T00:00:00.000Z'),
  profiles = [],
  transactions = [],
} = {}) => {
  const stampDocument = (document) => {
    document._id = document._id ?? new mongoose.Types.ObjectId()
    document.createdAt = document.createdAt ?? now
    document.updatedAt = now

    return document
  }

  class ProfileModel {
    constructor(payload) {
      Object.assign(this, stampDocument({ ...payload }))
    }

    async save() {
      profiles.push(this)

      return this
    }

    static find(filter) {
      return queryOf(profiles.filter((profile) => matchesFilter(profile, filter)))
    }

    static findOne(filter) {
      return queryOf(
        profiles.find((profile) => matchesFilter(profile, filter)) ?? null,
      )
    }
  }

  class TransactionModel {
    constructor(payload) {
      Object.assign(this, stampDocument({ ...payload }))
    }

    async save() {
      transactions.push(this)

      return this
    }

    static countDocuments(filter) {
      return Promise.resolve(
        transactions.filter((transaction) => matchesFilter(transaction, filter))
          .length,
      )
    }

    static deleteOne(filter) {
      const index = transactions.findIndex((transaction) =>
        matchesFilter(transaction, filter),
      )

      if (index === -1) {
        return Promise.resolve({ deletedCount: 0 })
      }

      transactions.splice(index, 1)

      return Promise.resolve({ deletedCount: 1 })
    }

    static find(filter) {
      return queryOf(
        transactions.filter((transaction) =>
          matchesFilter(transaction, filter),
        ),
      )
    }

    static findOne(filter) {
      return queryOf(
        transactions.find((transaction) => matchesFilter(transaction, filter)) ??
          null,
      )
    }

    static findOneAndUpdate(filter, update, options = {}) {
      let transaction = transactions.find((item) => matchesFilter(item, filter))

      if (!transaction && options.upsert) {
        transaction = stampDocument({
          ...filter,
          ...(update.$setOnInsert ?? {}),
        })
        transactions.push(transaction)
      }

      if (transaction) {
        Object.assign(transaction, update.$set ?? {})
        transaction.updatedAt = now
      }

      return queryOf(transaction)
    }
  }

  class BetModel {
    static find(filter) {
      return queryOf(bets.filter((bet) => matchesFilter(bet, filter)))
    }
  }

  return {
    betModel: BetModel,
    bets,
    profileModel: ProfileModel,
    profiles,
    transactionModel: TransactionModel,
    transactions,
  }
}

const createProfile = (userId, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  currency: 'EUR',
  initializedAt: new Date('2026-01-01T00:00:00.000Z'),
  isActive: true,
  userId,
  ...overrides,
})

const createTransaction = (userId, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  amountCents: 0,
  createdAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00.000Z'),
  occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  type: 'ADJUSTMENT',
  updatedAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00.000Z'),
  userId,
  ...overrides,
})

const createBet = (userId, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  analyzedAt: new Date('2026-01-10T00:00:00.000Z'),
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
  },
  homeTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
  },
  marketOdds: 2.1,
  profit: 0,
  result: 'pending',
  selectedSide: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
  },
  stake: 1,
  userId,
  ...overrides,
})

test('initializeBankroll creates a profile and starting-balance transaction', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = createMemoryModels()

  const result = await bankrollService.initializeBankroll(
    userId,
    {
      currency: 'eur',
      startDate: '2026-01-01',
      startingBalance: '123.45',
    },
    models,
  )

  assert.equal(models.profiles.length, 1)
  assert.equal(models.transactions.length, 1)
  assert.equal(models.transactions[0].type, 'STARTING_BALANCE')
  assert.equal(models.transactions[0].amountCents, 12345)
  assert.equal(result.summary.initialized, true)
  assert.equal(result.summary.currency, 'EUR')
  assert.equal(result.summary.currentBankroll, 123.45)

  await assert.rejects(
    () =>
      bankrollService.initializeBankroll(
        userId,
        {
          currency: 'EUR',
          startDate: '2026-01-01',
          startingBalance: '10.00',
        },
        models,
      ),
    (error) =>
      error.statusCode === 409 &&
      error.message === 'Bankroll is already initialized.',
  )
})

test('summary keeps betting profit separate from deposits and withdrawals', async () => {
  const userId = new mongoose.Types.ObjectId()
  const profile = createProfile(userId)
  const models = createMemoryModels({
    bets: [
      createBet(userId, {
        analyzedAt: new Date('2026-01-12T00:00:00.000Z'),
        stake: 12.34,
      }),
    ],
    profiles: [profile],
    transactions: [
      createTransaction(userId, {
        amountCents: 10000,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        type: 'STARTING_BALANCE',
      }),
      createTransaction(userId, {
        amountCents: 2500,
        occurredAt: new Date('2026-01-02T00:00:00.000Z'),
        type: 'DEPOSIT',
      }),
      createTransaction(userId, {
        amountCents: -1000,
        occurredAt: new Date('2026-01-03T00:00:00.000Z'),
        type: 'WITHDRAWAL',
      }),
      createTransaction(userId, {
        amountCents: 650,
        occurredAt: new Date('2026-01-04T00:00:00.000Z'),
        type: 'BET_SETTLEMENT',
      }),
      createTransaction(userId, {
        amountCents: -300,
        occurredAt: new Date('2026-01-05T00:00:00.000Z'),
        type: 'BET_SETTLEMENT',
      }),
    ],
  })

  const summary = await bankrollService.getBankrollSummary(
    userId,
    { period: 'all-time' },
    models,
  )

  assert.equal(summary.currentBankroll, 118.5)
  assert.equal(summary.availableBankroll, 106.16)
  assert.equal(summary.bettingProfit, 3.5)
  assert.equal(summary.deposits, 25)
  assert.equal(summary.withdrawals, 10)
  assert.equal(summary.cashFlow, 15)
  assert.equal(summary.pendingStake, 12.34)
  assert.equal(summary.settledBets, 2)
})

test('summary and transactions are isolated by user', async () => {
  const userA = new mongoose.Types.ObjectId()
  const userB = new mongoose.Types.ObjectId()
  const models = createMemoryModels({
    profiles: [createProfile(userA), createProfile(userB)],
    transactions: [
      createTransaction(userA, {
        amountCents: 1000,
        type: 'STARTING_BALANCE',
      }),
      createTransaction(userB, {
        amountCents: 999999,
        type: 'STARTING_BALANCE',
      }),
    ],
  })

  const summary = await bankrollService.getBankrollSummary(
    userA,
    { period: 'all-time' },
    models,
  )
  const transactions = await bankrollService.getBankrollTransactions(userA, {}, models)

  assert.equal(summary.currentBankroll, 10)
  assert.equal(transactions.items.length, 1)
  assert.equal(transactions.items[0].amount, 10)
})

test('withdrawals cannot exceed the current bankroll', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = createMemoryModels({
    profiles: [createProfile(userId)],
    transactions: [
      createTransaction(userId, {
        amountCents: 1000,
        type: 'STARTING_BALANCE',
      }),
    ],
  })

  await assert.rejects(
    () =>
      bankrollService.addWithdrawal(
        userId,
        {
          amount: '10.01',
          occurredAt: '2026-01-02',
        },
        models,
      ),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'Withdrawal exceeds current bankroll.',
  )
})

test('settled bet synchronization is idempotent and removes pending settlements', async () => {
  const userId = new mongoose.Types.ObjectId()
  const bet = createBet(userId, {
    profit: 12.345,
    result: 'win',
  })
  const models = createMemoryModels({
    profiles: [createProfile(userId)],
  })

  await bankrollService.syncBetSettlementForBet(userId, bet, models)
  await bankrollService.syncBetSettlementForBet(userId, bet, models)

  assert.equal(models.transactions.length, 1)
  assert.equal(models.transactions[0].type, 'BET_SETTLEMENT')
  assert.equal(models.transactions[0].amountCents, 1235)

  bet.result = 'loss'
  bet.profit = -5
  await bankrollService.syncBetSettlementForBet(userId, bet, models)

  assert.equal(models.transactions.length, 1)
  assert.equal(models.transactions[0].amountCents, -500)

  bet.result = 'pending'
  bet.profit = 0
  await bankrollService.syncBetSettlementForBet(userId, bet, models)

  assert.equal(models.transactions.length, 0)
})

test('settlement synchronization ignores settled bets before the bankroll start date', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = createMemoryModels({
    profiles: [createProfile(userId)],
  })

  await bankrollService.syncBetSettlementForBet(
    userId,
    createBet(userId, {
      analyzedAt: new Date('2025-12-31T00:00:00.000Z'),
      profit: 10,
      result: 'win',
    }),
    models,
  )

  assert.equal(models.transactions.length, 0)
})

test('season summary filters transactions through NHL season metadata', async () => {
  const userId = new mongoose.Types.ObjectId()
  const seasonMetadata = {
    currentSeasonId: '20252026',
    seasons: [
      {
        endDate: '2026-04-16',
        id: '20252026',
        isCurrent: true,
        label: '2025-26',
        startDate: '2025-10-07',
      },
    ],
  }
  const models = createMemoryModels({
    profiles: [createProfile(userId)],
    transactions: [
      createTransaction(userId, {
        amountCents: 10000,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        type: 'STARTING_BALANCE',
      }),
      createTransaction(userId, {
        amountCents: 750,
        occurredAt: new Date('2026-03-01T00:00:00.000Z'),
        type: 'BET_SETTLEMENT',
      }),
      createTransaction(userId, {
        amountCents: 500,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
        type: 'BET_SETTLEMENT',
      }),
    ],
  })

  const summary = await bankrollService.getBankrollSummary(
    userId,
    {
      period: 'season',
      season: '20252026',
    },
    {
      ...models,
      seasonMetadata,
    },
  )

  assert.equal(summary.bettingProfit, 7.5)
  assert.equal(summary.currentBankroll, 112.5)
  assert.equal(summary.period.season.id, '20252026')
})

test('transactions include running balances for paginated ledger rows', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = createMemoryModels({
    transactions: [
      createTransaction(userId, {
        amountCents: 10000,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        type: 'STARTING_BALANCE',
      }),
      createTransaction(userId, {
        amountCents: 2500,
        occurredAt: new Date('2026-01-02T00:00:00.000Z'),
        type: 'DEPOSIT',
      }),
      createTransaction(userId, {
        amountCents: -300,
        occurredAt: new Date('2026-01-03T00:00:00.000Z'),
        type: 'BET_SETTLEMENT',
      }),
    ],
  })

  const result = await bankrollService.getBankrollTransactions(
    userId,
    {
      limit: 2,
      page: 1,
    },
    models,
  )

  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].amount, -3)
  assert.equal(result.items[0].runningBalance, 122)
  assert.equal(result.items[1].amount, 25)
  assert.equal(result.items[1].runningBalance, 125)
  assert.equal(result.pagination.hasNextPage, true)
})

test('backfill can dry-run and then write user-scoped settled bet transactions', async () => {
  const userId = new mongoose.Types.ObjectId()
  const otherUserId = new mongoose.Types.ObjectId()
  const models = createMemoryModels({
    bets: [
      createBet(userId, {
        profit: 9,
        result: 'win',
      }),
      createBet(userId, {
        analyzedAt: new Date('2025-12-31T00:00:00.000Z'),
        profit: 11,
        result: 'win',
      }),
      createBet(otherUserId, {
        profit: 99,
        result: 'win',
      }),
    ],
    profiles: [createProfile(userId), createProfile(otherUserId)],
  })

  const dryRun = await bankrollService.backfillBankrollSettlements({
    ...models,
    userId: userId.toString(),
  })

  assert.equal(dryRun.matchedBets, 1)
  assert.equal(dryRun.settlementsWritten, 0)
  assert.equal(models.transactions.length, 0)

  const confirmed = await bankrollService.backfillBankrollSettlements({
    ...models,
    confirm: true,
    userId: userId.toString(),
  })

  assert.equal(confirmed.matchedBets, 1)
  assert.equal(confirmed.settlementsWritten, 1)
  assert.equal(models.transactions.length, 1)
  assert.equal(models.transactions[0].amountCents, 900)
})

test('money parser rejects precision beyond cents', () => {
  assert.throws(
    () => bankrollService.parseMoneyToCents('1.234', 'amount'),
    (error) =>
      error.statusCode === 400 &&
      error.message ===
        'amount must be a money amount with no more than two decimals.',
  )
})
