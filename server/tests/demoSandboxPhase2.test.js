process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const Injury = require('../models/Injury')
const betsService = require('../services/betsService')
const injuriesService = require('../services/injuriesService')
const {
  BET_BLUEPRINTS,
  DEMO_SEEDED_AVAILABLE_BALANCE,
  DEMO_SEEDED_CURRENT_BALANCE,
  DEMO_SEEDED_STARTING_BALANCE,
  DEMO_SEED_PREFIX,
  DEMO_SEED_VERSION,
  INJURY_BLUEPRINTS,
  buildBetPayload,
  buildInjuryPayload,
  seedDemoSandbox,
} = require('../services/demoSandboxSeedService')

const queryOf = (value) => ({
  session() {
    return this
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
})

const profitCents = ([result, odds, stake]) => {
  if (result === 'win') return Math.round((odds - 1) * stake * 100)
  if (result === 'loss') return -stake * 100
  return 0
}

const createSeedHarness = () => {
  const owners = new Map()
  const getOwner = (userId) => {
    const key = String(userId)
    if (!owners.has(key)) {
      owners.set(key, {
        bets: new Map(),
        injuries: new Map(),
        preferences: null,
        profile: null,
        transactions: new Map(),
      })
    }
    return owners.get(key)
  }
  const options = {
    bookmakerPreferencesModel: {
      findOneAndUpdate({ userId }, update) {
        const owner = getOwner(userId)
        if (!owner.preferences) {
          owner.preferences = { ...update.$setOnInsert }
        }
        return queryOf(owner.preferences)
      },
    },
    createBet: async (userId, payload) => {
      const owner = getOwner(userId)
      if (owner.bets.has(payload.placementId)) {
        return owner.bets.get(payload.placementId)
      }
      const bet = { ...payload, id: `bet-${owner.bets.size + 1}` }
      owner.bets.set(payload.placementId, bet)
      const index = Number(payload.placementId.slice(-2)) - 1
      if (payload.result === 'pending') {
        owner.transactions.set(`stake:${payload.placementId}`, -payload.stake * 100)
      } else {
        owner.transactions.set(
          `settlement:${payload.placementId}`,
          profitCents(BET_BLUEPRINTS[index]),
        )
      }
      return bet
    },
    createInjury: async (userId, payload, createOptions) => {
      const owner = getOwner(userId)
      owner.injuries.set(createOptions.demoSeedKey, {
        ...payload,
        demoSeedKey: createOptions.demoSeedKey,
      })
    },
    initializeBankroll: async (userId, payload) => {
      const owner = getOwner(userId)
      owner.profile = { ...payload, userId }
      owner.transactions.set('starting-balance', Number(payload.startingBalance) * 100)
    },
    injuryModel: {
      findOne({ demoSeedKey, userId }) {
        return queryOf(getOwner(userId).injuries.get(demoSeedKey) ?? null)
      },
    },
    profileModel: {
      findOne({ userId }) {
        return queryOf(getOwner(userId).profile)
      },
    },
    session: { id: 'outer-demo-create-transaction' },
  }

  return { getOwner, options, owners }
}

test('curated Phase 2 seed is deterministic, realistic, and uses safe identities', () => {
  const resultCounts = BET_BLUEPRINTS.reduce((counts, [result]) => {
    counts[result] = (counts[result] ?? 0) + 1
    return counts
  }, {})

  assert.equal(DEMO_SEED_VERSION, 1)
  assert.equal(BET_BLUEPRINTS.length, 24)
  assert.deepEqual(resultCounts, {
    loss: 10,
    pending: 2,
    push: 1,
    void: 1,
    win: 10,
  })
  assert.equal(
    BET_BLUEPRINTS.reduce((total, bet) => total + profitCents(bet), 0),
    -600,
  )
  assert.equal(INJURY_BLUEPRINTS.length, 10)
  assert.equal(INJURY_BLUEPRINTS.every((row) => row[2] !== 'G'), true)
  assert.equal(
    INJURY_BLUEPRINTS.every((row) => Number.isInteger(row[4] * 2)),
    true,
  )
  assert.equal(
    INJURY_BLUEPRINTS.every((row) => row[4] >= -2.5 && row[4] <= 0),
    true,
  )
})

test('every curated bet and injury satisfies the production domain contracts', async () => {
  const userId = new mongoose.Types.ObjectId()

  for (const [index, blueprint] of BET_BLUEPRINTS.entries()) {
    const payload = buildBetPayload(blueprint, index)
    const normalized = betsService.normalizeCreatePayload(payload)
    const bet = new Bet({ ...normalized, userId })

    await bet.validate()
    assert.equal(payload.gameId, '')
    assert.match(payload.placementId, /^demo-seed-v1-bet-\d{2}$/)
    assert.equal(payload.marketOddsSource, 'manual')
  }

  for (const [index, blueprint] of INJURY_BLUEPRINTS.entries()) {
    const payload = buildInjuryPayload(blueprint, index)
    const normalized = await injuriesService.normalizeCreatePayload(payload, {
      maximumPlayerInjuryPenalty: -2.5,
    })
    const injury = new Injury({ ...normalized, userId })

    await injury.validate()
    assert.equal(injury.isGoalie, false)
    assert.notEqual(injury.position, 'G')
  }
})

test('seed is owner-scoped and idempotent with a coherent bankroll ledger', async () => {
  const { getOwner, options, owners } = createSeedHarness()

  await seedDemoSandbox('demo-a', options)
  await seedDemoSandbox('demo-a', options)
  await seedDemoSandbox('demo-b', options)

  assert.equal(owners.has('normal-n'), false)
  for (const userId of ['demo-a', 'demo-b']) {
    const owner = getOwner(userId)
    assert.equal(owner.bets.size, 24)
    assert.equal(owner.injuries.size, 10)
    assert.equal(owner.transactions.size, 25)
    assert.ok(owner.preferences)

    const ledgerBalanceCents = [...owner.transactions.values()].reduce(
      (sum, value) => sum + value,
      0,
    )
    const pendingStakeCents = [...owner.bets.values()]
      .filter(({ result }) => result === 'pending')
      .reduce((sum, { stake }) => sum + stake * 100, 0)

    assert.equal(DEMO_SEEDED_STARTING_BALANCE, 1000)
    assert.equal(ledgerBalanceCents, DEMO_SEEDED_AVAILABLE_BALANCE * 100)
    assert.equal(
      ledgerBalanceCents + pendingStakeCents,
      DEMO_SEEDED_CURRENT_BALANCE * 100,
    )
  }

  getOwner('demo-a').bets.delete(`${DEMO_SEED_PREFIX}-bet-01`)
  getOwner('demo-a').injuries.get(`${DEMO_SEED_PREFIX}-injury-01`).impact = -2.5

  assert.equal(getOwner('demo-b').bets.size, 24)
  assert.equal(
    getOwner('demo-b').injuries.get(`${DEMO_SEED_PREFIX}-injury-01`).impact,
    -1.5,
  )
})
