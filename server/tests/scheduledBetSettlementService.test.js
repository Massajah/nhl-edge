process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const {
  createScheduledBetSettlementService,
  shouldCheckBet,
} = require('../services/scheduledBetSettlementService')

const NOW = new Date('2026-09-30T12:00:00.000Z')
const owner = () => new mongoose.Types.ObjectId()
const bet = (userId, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  gameId: '2026020001',
  result: 'pending',
  scheduledStart: new Date('2026-09-30T00:00:00.000Z'),
  userId,
  ...overrides,
})
const query = (value) => ({ lean: async () => value })

const makeService = ({ bets, users, settleOwner, leaseAcquired = true }) => {
  const calls = { leases: [], selected: [], owners: [] }
  const service = createScheduledBetSettlementService({
    betModel: { find(filter) {
      calls.selected.push(filter)
      return query(bets.filter((item) =>
        item.result === 'pending' &&
        item.scheduledStart >= filter.scheduledStart.$gte &&
        item.scheduledStart <= filter.scheduledStart.$lte))
    } },
    userModel: { find(filter) {
      calls.owners.push(filter)
      return query(users.filter((item) =>
        filter._id.$in.some((id) => String(id) === String(item._id)) &&
        item.status !== 'disabled' &&
        [undefined, null, '', 'NORMAL'].includes(item.accountType)))
    } },
    settleOwner,
    leaseService: {
      async acquireLease(payload) {
        calls.leases.push(payload)
        return { acquired: leaseAcquired,
          lease: { slotKey: 'test-slot', leaseToken: 'test-token' } }
      },
      async finishLease(...args) { calls.leases.push(args) },
    },
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  })
  return { calls, service }
}

test('pending started-bet discovery has a supporting index', () => {
  assert.ok(Bet.schema.indexes().some(([fields]) =>
    fields.result === 1 && fields.scheduledStart === 1))
})

test('scheduled settlement discovers production owners and checks only started valid pending bets', async () => {
  const production = owner()
  const demo = owner()
  const disabled = owner()
  const due = bet(production)
  const invalid = bet(production, { gameId: '' })
  const future = bet(production, { scheduledStart: new Date('2026-10-01T00:00:00Z') })
  const settled = bet(production, { result: 'win' })
  const demoBet = bet(demo)
  const disabledBet = bet(disabled)
  const calls = []
  const fixture = makeService({
    bets: [due, invalid, future, settled, demoBet, disabledBet],
    users: [
      { _id: production, accountType: 'NORMAL', status: 'active' },
      { _id: demo, accountType: 'DEMO_SANDBOX', status: 'active' },
      { _id: disabled, accountType: 'NORMAL', status: 'disabled' },
    ],
    settleOwner: async (id, options) => {
      calls.push({ id, options })
      return { wins: 1, losses: 0, errors: 0, results: [] }
    },
  })
  const summary = await fixture.service.runScheduledSettlement()
  assert.equal(summary.ownersConsidered, 1)
  assert.equal(summary.pendingCandidatesConsidered, 1)
  assert.equal(summary.skippedInvalidOrUnlinked, 1)
  assert.equal(summary.wins, 1)
  assert.equal(calls.length, 1)
  assert.equal(String(calls[0].id), String(production))
  assert.deepEqual(calls[0].options.pendingBetIds, [due._id])
  assert.ok(fixture.calls.owners[0].$and)
  assert.equal(fixture.calls.leases.at(-1)[2].status, 'COMPLETED')
})

test('scheduled settlement throttles checks, records pending and isolates owner failures', async () => {
  const a = owner()
  const b = owner()
  const recentlyChecked = bet(a, { lastSettlementCheckAt: new Date('2026-09-30T11:50:00Z') })
  const fixture = makeService({
    bets: [bet(a), bet(b), recentlyChecked],
    users: [{ _id: a, accountType: 'NORMAL' }, { _id: b, accountType: 'NORMAL' }],
    settleOwner: async (id) => {
      if (String(id) === String(a)) throw new Error('owner failed')
      return { wins: 0, losses: 0, errors: 0,
        results: [{ reason: 'game_not_final' }] }
    },
  })
  const summary = await fixture.service.runScheduledSettlement()
  assert.equal(summary.pendingCandidatesConsidered, 2)
  assert.equal(summary.failures, 1)
  assert.equal(summary.stillNotFinal, 1)
  assert.equal(summary.outcome, 'PARTIAL_FAILURE')
  assert.equal(fixture.calls.leases.at(-1)[2].status, 'COMPLETED')
})

test('scheduled settlement never checks future, stale or too recently checked games', () => {
  assert.equal(shouldCheckBet(bet(owner(), {
    scheduledStart: new Date('2026-10-01T00:00:00Z'),
  }), NOW), false)
  assert.equal(shouldCheckBet(bet(owner(), {
    scheduledStart: new Date('2026-07-01T00:00:00Z'),
  }), NOW), false)
  assert.equal(shouldCheckBet(bet(owner(), {
    lastSettlementCheckAt: new Date('2026-09-30T11:50:00Z'),
  }), NOW), false)
  assert.equal(shouldCheckBet(bet(owner(), {
    lastSettlementCheckAt: new Date('2026-09-30T11:40:00Z'),
  }), NOW), true)
})

test('unacquired settlement lease prevents duplicate owner work', async () => {
  const fixture = makeService({ bets: [bet(owner())], users: [],
    settleOwner: async () => { throw new Error('unexpected') },
    leaseAcquired: false })
  const result = await fixture.service.runScheduledSettlement()
  assert.equal(result.outcome, 'LEASE_NOT_ACQUIRED')
  assert.equal(fixture.calls.selected.length, 0)
})
