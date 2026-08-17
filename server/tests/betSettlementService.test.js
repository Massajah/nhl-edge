process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const bankrollService = require('../services/bankrollService')
const betSettlementService = require('../services/betSettlementService')

const stringifyId = (value) => value?.toString?.() ?? String(value)

const matches = (record, filter = {}) =>
  Object.entries(filter).every(([field, expected]) => {
    const actual = record[field]

    if (actual instanceof mongoose.Types.ObjectId || expected instanceof mongoose.Types.ObjectId) {
      return stringifyId(actual) === stringifyId(expected)
    }

    return actual === expected
  })

const queryOf = (value) => ({
  lean() {
    return this
  },
  session() {
    return this
  },
  sort(criteria = {}) {
    if (Array.isArray(value)) {
      value.sort((left, right) => {
        for (const [field, direction] of Object.entries(criteria)) {
          const leftValue = left[field] instanceof Date
            ? left[field].getTime()
            : left[field]
          const rightValue = right[field] instanceof Date
            ? right[field].getTime()
            : right[field]

          if (leftValue !== rightValue) {
            return leftValue < rightValue ? -direction : direction
          }
        }

        return 0
      })
    }

    return this
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
})

const createMemoryModels = ({ bets = [], profiles = [], transactions = [] } = {}) => {
  const now = new Date('2026-03-01T12:00:00.000Z')

  class BetModel {
    static find(filter) {
      return queryOf(bets.filter((bet) => matches(bet, filter)))
    }

    static findOne(filter) {
      return queryOf(bets.find((bet) => matches(bet, filter)) ?? null)
    }

    static findOneAndUpdate(filter, update) {
      const bet = bets.find((candidate) => matches(candidate, filter))

      if (!bet) {
        return queryOf(null)
      }

      Object.assign(bet, update.$set ?? {})

      for (const [field, amount] of Object.entries(update.$inc ?? {})) {
        bet[field] = (Number(bet[field]) || 0) + amount
      }

      for (const [field, item] of Object.entries(update.$push ?? {})) {
        bet[field] = [...(bet[field] ?? []), item]
      }

      return queryOf(bet)
    }

    static updateOne(filter, update) {
      const bet = bets.find((candidate) => matches(candidate, filter))

      if (bet) {
        Object.assign(bet, update.$set ?? {})
      }

      return Promise.resolve({ modifiedCount: bet ? 1 : 0 })
    }
  }

  class TransactionModel {
    constructor(payload) {
      Object.assign(this, payload, {
        _id: new mongoose.Types.ObjectId(),
        createdAt: now,
        updatedAt: now,
      })
    }

    async save() {
      if (
        transactions.some(
          (transaction) =>
            transaction.actionKey === this.actionKey &&
            stringifyId(transaction.userId) === stringifyId(this.userId),
        )
      ) {
        const error = new Error('duplicate action key')
        error.code = 11000
        throw error
      }

      transactions.push(this)
      return this
    }

    static find(filter) {
      return queryOf(
        transactions.filter((transaction) => matches(transaction, filter)),
      )
    }

    static findOne(filter) {
      return queryOf(
        transactions.find((transaction) => matches(transaction, filter)) ?? null,
      )
    }
  }

  class ProfileModel {
    static findOne(filter) {
      return queryOf(
        profiles.find((profile) => matches(profile, filter)) ?? null,
      )
    }
  }

  return {
    betModel: BetModel,
    bets,
    nowProvider: () => new Date(now),
    profileModel: ProfileModel,
    profiles,
    transactionModel: TransactionModel,
    transactions,
    useTransactions: false,
  }
}

const createBet = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  analyzedAt: new Date('2026-03-01T00:00:00.000Z'),
  awayTeam: {
    abbreviation: 'TOR',
    teamId: 'TOR',
  },
  bankrollAccounting: 'transactional',
  betType: 'moneyline',
  finalAwayScore: null,
  finalHomeScore: null,
  gameId: '2025020999',
  homeTeam: {
    abbreviation: 'BOS',
    teamId: 'BOS',
  },
  marketOdds: 1.8,
  profit: 0,
  result: 'pending',
  selectedSide: {
    homeAway: 'home',
    teamId: 'BOS',
  },
  selectedTeam: {
    teamId: 'BOS',
  },
  settlementCorrections: [],
  settlementVersion: 0,
  stake: 10,
  userId: new mongoose.Types.ObjectId(),
  ...overrides,
})

const createGame = (overrides = {}) => ({
  awayTeam: {
    abbreviation: 'TOR',
    score: 2,
  },
  gameId: '2025020999',
  gameOutcome: {
    lastPeriodType: 'REG',
  },
  gameState: 'FINAL',
  homeTeam: {
    abbreviation: 'BOS',
    score: 4,
  },
  ...overrides,
})

const createStartingTransactions = (userId) => [
  {
    _id: new mongoose.Types.ObjectId(),
    amountCents: 10000,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    occurredAt: new Date('2026-03-01T00:00:00.000Z'),
    type: 'STARTING_BALANCE',
    userId,
  },
  {
    _id: new mongoose.Types.ObjectId(),
    actionKey: 'placed-stake',
    amountCents: -1000,
    createdAt: new Date('2026-03-01T01:00:00.000Z'),
    metadata: {
      realizedProfitDeltaCents: 0,
    },
    occurredAt: new Date('2026-03-01T01:00:00.000Z'),
    type: 'BET_STAKE',
    userId,
  },
]

test('moneyline settlement treats regulation, overtime and shootout wins identically', () => {
  const bet = createBet()

  for (const lastPeriodType of ['REG', 'OT', 'SO']) {
    const decision = betSettlementService.determineMoneylineResult(
      bet,
      createGame({
        gameOutcome: {
          lastPeriodType,
        },
      }),
    )

    assert.equal(decision.result, 'win')
    assert.equal(decision.reason, null)
  }
})

test('home and away moneylines settle from the selected team and final score', () => {
  const homeLoss = betSettlementService.determineMoneylineResult(
    createBet(),
    createGame({
      awayTeam: { abbreviation: 'TOR', score: 3 },
      homeTeam: { abbreviation: 'BOS', score: 2 },
    }),
  )
  const awayWin = betSettlementService.determineMoneylineResult(
    createBet({
      selectedSide: { homeAway: 'away', teamId: 'TOR' },
      selectedTeam: { teamId: 'TOR' },
    }),
    createGame({
      awayTeam: { abbreviation: 'TOR', score: 3 },
      homeTeam: { abbreviation: 'BOS', score: 2 },
    }),
  )
  const awayLoss = betSettlementService.determineMoneylineResult(
    createBet({
      selectedSide: { homeAway: 'away', teamId: 'TOR' },
      selectedTeam: { teamId: 'TOR' },
    }),
    createGame(),
  )

  assert.equal(homeLoss.result, 'loss')
  assert.equal(awayWin.result, 'win')
  assert.equal(awayLoss.result, 'loss')
})

test('live, scheduled, unsupported and corrupt links never auto-settle', () => {
  assert.equal(
    betSettlementService.determineMoneylineResult(
      createBet(),
      createGame({ gameState: 'LIVE' }),
    ).reason,
    'game_not_final',
  )
  assert.equal(
    betSettlementService.determineMoneylineResult(
      createBet(),
      createGame({ gameState: 'FUT' }),
    ).reason,
    'game_not_final',
  )
  assert.equal(
    betSettlementService.determineMoneylineResult(
      createBet({ betType: '' }),
      createGame(),
    ).reason,
    'unsupported_bet_type',
  )
  assert.equal(
    betSettlementService.determineMoneylineResult(
      createBet({
        selectedSide: { homeAway: 'home', teamId: 'EDM' },
        selectedTeam: { teamId: 'EDM' },
      }),
      createGame(),
    ).reason,
    'selected_team_not_in_game',
  )
  assert.equal(
    betSettlementService.determineMoneylineResult(
      createBet({
        selectedSide: { homeAway: 'home', teamId: '' },
        selectedTeam: { teamId: '' },
      }),
      createGame(),
    ).reason,
    'selected_team_not_linked',
  )
})

test('transactional WIN, LOSS and VOID flows produce exact available balances and profit', async () => {
  const scenarios = [
    { balanceCents: 10800, profit: 8, result: 'win', source: 'automatic' },
    { balanceCents: 9000, profit: -10, result: 'loss', source: 'automatic' },
    { balanceCents: 10000, profit: 0, result: 'void', source: 'manual' },
  ]

  for (const scenario of scenarios) {
    const bet = createBet()
    const transactions = createStartingTransactions(bet.userId)
    const models = createMemoryModels({ bets: [bet], transactions })

    const settlement = await betSettlementService.applySettlement(
      bet.userId,
      bet._id,
      scenario.result,
      {
        ...models,
        source: scenario.source,
      },
    )

    assert.equal(settlement.status, 'settled')
    assert.equal(bet.profit, scenario.profit)
    assert.equal(
      await bankrollService.calculateCurrentBankrollCents(bet.userId, models),
      scenario.balanceCents,
    )
  }
})

test('placing a transactional bet debits available bankroll and exposes stake once', async () => {
  const bet = createBet({ stakeVersion: 1 })
  const models = createMemoryModels({
    bets: [bet],
    profiles: [
      {
        initializedAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true,
        userId: bet.userId,
      },
    ],
    transactions: createStartingTransactions(bet.userId).slice(0, 1),
  })

  const placement = await bankrollService.recordBetStakeForBet(
    bet.userId,
    bet,
    models,
  )
  const retry = await bankrollService.recordBetStakeForBet(
    bet.userId,
    bet,
    models,
  )
  const summary = await bankrollService.getBankrollSummary(
    bet.userId,
    { period: 'all-time' },
    models,
  )

  assert.equal(placement.status, 'recorded')
  assert.equal(retry.status, 'already-recorded')
  assert.equal(summary.currentBankroll, 100)
  assert.equal(summary.availableBankroll, 90)
  assert.equal(summary.pendingStake, 10)
  assert.equal(summary.bettingProfit, 0)
})

test('automatic settlement is retry-safe and concurrent attempts credit once', async () => {
  const bet = createBet()
  const transactions = createStartingTransactions(bet.userId)
  const models = createMemoryModels({ bets: [bet], transactions })
  const attempts = await Promise.all([
    betSettlementService.applySettlement(bet.userId, bet._id, 'win', {
      ...models,
      source: 'automatic',
    }),
    betSettlementService.applySettlement(bet.userId, bet._id, 'win', {
      ...models,
      source: 'automatic',
    }),
  ])
  const retry = await betSettlementService.applySettlement(
    bet.userId,
    bet._id,
    'win',
    {
      ...models,
      source: 'automatic',
    },
  )

  assert.equal(attempts.filter((attempt) => attempt.status === 'settled').length, 1)
  assert.equal(retry.status, 'already-settled')
  assert.equal(
    transactions.filter((transaction) => transaction.type === 'BET_WIN_RETURN')
      .length,
    1,
  )
  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(bet.userId, models),
    10800,
  )

  const lossBet = createBet()
  const lossTransactions = createStartingTransactions(lossBet.userId)
  const lossModels = createMemoryModels({
    bets: [lossBet],
    transactions: lossTransactions,
  })

  await betSettlementService.applySettlement(
    lossBet.userId,
    lossBet._id,
    'loss',
    { ...lossModels, source: 'automatic' },
  )
  await betSettlementService.applySettlement(
    lossBet.userId,
    lossBet._id,
    'loss',
    { ...lossModels, source: 'automatic' },
  )

  assert.equal(
    lossTransactions.filter(
      (transaction) => transaction.type === 'BET_SETTLEMENT',
    ).length,
    1,
  )
  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(
      lossBet.userId,
      lossModels,
    ),
    9000,
  )
})

test('manual corrections reverse old money before applying the new result', async () => {
  const bet = createBet()
  const transactions = createStartingTransactions(bet.userId)
  const models = createMemoryModels({
    bets: [bet],
    profiles: [
      {
        initializedAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true,
        userId: bet.userId,
      },
    ],
    transactions,
  })

  await betSettlementService.applySettlement(bet.userId, bet._id, 'win', {
    ...models,
    source: 'automatic',
  })
  await betSettlementService.applySettlement(bet.userId, bet._id, 'loss', {
    ...models,
    source: 'manual',
  })

  assert.equal(bet.result, 'loss')
  assert.equal(bet.profit, -10)
  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(bet.userId, models),
    9000,
  )
  assert.equal(
    transactions.some(
      (transaction) =>
        transaction.type === 'SETTLEMENT_REVERSAL' &&
        transaction.amountCents === -1800,
    ),
    true,
  )
  assert.equal(bet.settlementCorrections.length, 1)
  assert.equal(
    (
      await bankrollService.getBankrollSummary(
        bet.userId,
        { period: 'all-time' },
        models,
      )
    ).bettingProfit,
    -10,
  )

  await betSettlementService.applySettlement(bet.userId, bet._id, 'void', {
    ...models,
    source: 'manual',
  })

  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(bet.userId, models),
    10000,
  )
  assert.equal(bet.profit, 0)
  assert.equal(
    (
      await bankrollService.getBankrollSummary(
        bet.userId,
        { period: 'all-time' },
        models,
      )
    ).bettingProfit,
    0,
  )

  const secondBet = createBet()
  const secondModels = createMemoryModels({
    bets: [secondBet],
    transactions: createStartingTransactions(secondBet.userId),
  })

  await betSettlementService.applySettlement(
    secondBet.userId,
    secondBet._id,
    'loss',
    { ...secondModels, source: 'automatic' },
  )
  await betSettlementService.applySettlement(
    secondBet.userId,
    secondBet._id,
    'win',
    { ...secondModels, source: 'manual' },
  )

  assert.equal(secondBet.result, 'win')
  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(
      secondBet.userId,
      secondModels,
    ),
    10800,
  )

  await betSettlementService.applySettlement(
    secondBet.userId,
    secondBet._id,
    'void',
    { ...secondModels, source: 'manual' },
  )
  await betSettlementService.applySettlement(
    secondBet.userId,
    secondBet._id,
    'win',
    { ...secondModels, source: 'manual' },
  )

  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(
      secondBet.userId,
      secondModels,
    ),
    10800,
  )
})

test('pending cancellation refund uses one deterministic audit action', async () => {
  const bet = createBet()
  const transactions = createStartingTransactions(bet.userId)
  const models = createMemoryModels({ bets: [bet], transactions })

  const first = await bankrollService.recordPendingBetCancellation(
    bet.userId,
    bet,
    models,
  )
  const retry = await bankrollService.recordPendingBetCancellation(
    bet.userId,
    bet,
    models,
  )

  assert.equal(first.status, 'recorded')
  assert.equal(retry.status, 'already-recorded')
  assert.equal(
    await bankrollService.calculateCurrentBankrollCents(bet.userId, models),
    10000,
  )
})

test('batch settlement caches one NHL result and leaves legacy/provider failures pending', async () => {
  const userId = new mongoose.Types.ObjectId()
  const linkedA = createBet({ userId })
  const linkedB = createBet({
    _id: new mongoose.Types.ObjectId(),
    selectedSide: { homeAway: 'away', teamId: 'TOR' },
    selectedTeam: { teamId: 'TOR' },
    userId,
  })
  const legacy = createBet({
    _id: new mongoose.Types.ObjectId(),
    betType: '',
    gameId: '',
    userId,
  })
  const otherUserBet = createBet({
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
  })
  let calls = 0
  const models = createMemoryModels({
    bets: [linkedA, linkedB, legacy, otherUserBet],
  })
  const summary = await betSettlementService.settlePendingMoneylineBets(userId, {
    ...models,
    applySettlementProvider: async (_scopedUserId, betId, result) => {
      const bet = models.bets.find(
        (candidate) => stringifyId(candidate._id) === stringifyId(betId),
      )
      bet.result = result
      return { status: 'settled' }
    },
    gameProvider: async () => {
      calls += 1
      return createGame()
    },
  })

  assert.equal(calls, 1)
  assert.equal(summary.settled, 2)
  assert.equal(summary.wins, 1)
  assert.equal(summary.losses, 1)
  assert.equal(summary.stillPending, 1)
  assert.equal(legacy.result, 'pending')
  assert.equal(otherUserBet.result, 'pending')
  assert.match(legacy.settlementIssue, /game not linked/i)

  const providerBet = createBet({ userId })
  const failedModels = createMemoryModels({ bets: [providerBet] })
  const failed = await betSettlementService.settlePendingMoneylineBets(userId, {
    ...failedModels,
    gameProvider: async () => {
      throw new Error('provider unavailable')
    },
  })

  assert.equal(failed.errors, 1)
  assert.equal(providerBet.result, 'pending')
  assert.equal(providerBet.profit, 0)
  assert.match(providerBet.settlementIssue, /retrieve/i)

  const missingGameBet = createBet({ userId })
  const missingModels = createMemoryModels({ bets: [missingGameBet] })
  const missing = await betSettlementService.settlePendingMoneylineBets(userId, {
    ...missingModels,
    gameProvider: async () => null,
  })

  assert.equal(missing.settled, 0)
  assert.equal(missingGameBet.result, 'pending')
  assert.match(missingGameBet.settlementIssue, /unavailable/i)
})
