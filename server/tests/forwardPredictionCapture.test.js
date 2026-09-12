const test = require('node:test')
const assert = require('node:assert/strict')
const Snapshot = require('../models/ForwardPredictionSnapshot')
const { createForwardPredictionRepository } = require('../services/forwardPredictionRepository')
const { createScheduledForwardPredictionService } = require('../services/scheduledForwardPredictionService')
const { calculateAutomaticPrediction } = require('../services/automaticPredictionService')
const { getT2Eligibility, getGameIdentity, resolveForwardPredictionResult, PREDICTION_DEFINITION } =
  require('../services/forwardPredictionContracts')
const { NOW, START, USER_ID, OTHER_USER_ID, game, inputs } = require('./fixtures/forwardPredictionFixtures')

const key = (value) => [String(value.userId), value.gameId, +new Date(value.scheduledStartAtCapture), value.predictionDefinition].join('/')
const snapshot = () => {
  const { available: _available, ...calculation } = calculateAutomaticPrediction(inputs())
  return { ...getGameIdentity(game()), ...calculation, userId: USER_ID,
    predictionDefinition: PREDICTION_DEFINITION, targetAt: new Date(+START - 120 * 60000), generatedAt: NOW }
}
const harness = (options = {}) => {
  const documents = new Map()
  let clock = new Date(NOW)
  let currentGame = game()
  let active = true
  let loads = 0
  let scheduleCalls = 0
  const filters = []
  const model = {
    async exists(filter) { filters.push(filter); return documents.has(key(filter)) },
    async updateOne(filter, update, queryOptions) {
      assert.deepEqual(Object.keys(update), ['$setOnInsert'])
      assert.equal(queryOptions.upsert, true)
      if (documents.has(key(filter))) return { upsertedCount: 0 }
      documents.set(key(filter), update.$setOnInsert)
      return { upsertedCount: 1 }
    },
  }
  const repository = createForwardPredictionRepository({ model })
  repository.ensureReady = async () => {}
  const userModel = {
    find(filter) {
      assert.deepEqual(filter, { $or: [{ status: 'active' }, { status: { $exists: false } }] })
      return { lean: () => ({ cursor: async function * () {
        for (const id of options.users ?? [USER_ID]) if (active) yield { _id: id }
      } }) }
    },
    async exists(filter) { assert.ok(filter._id); return active },
  }
  const provider = { async getScheduleForDate() {
    scheduleCalls += 1
    return { fetchedAt: clock.toISOString(), stale: false, data: { gameWeek: [{ games: [currentGame] }] } }
  } }
  const leaseService = {
    async acquireLease() { return { acquired: true, lease: { slotKey: 'slot', leaseToken: 'token' } } },
    async finishLease() {},
  }
  const service = createScheduledForwardPredictionService({ repository, userModel, provider, leaseService,
    now: () => new Date(clock), logger: { info() {}, warn() {} },
    createInputs: () => ({ async loadUserInputs(userId) {
      loads += 1
      const value = inputs()
      await options.onLoad?.({ userId, value, setClock: (time) => { clock = time },
        setGame: (next) => { currentGame = next }, disable: () => { active = false } })
      return { ...value, contexts: new Map([[String(currentGame.id), value.gameContext]]) }
    } }),
  })
  return { documents, filters, repository, service, provider, model,
    get loads() { return loads }, get scheduleCalls() { return scheduleCalls },
    setClock(time) { clock = time }, setGame(next) { currentGame = next } }
}

for (const [minutes, expected] of [[121, 'BEFORE_T2_WINDOW'], [120, null], [100, null],
  [75, null], [74, 'AFTER_T2_WINDOW'], [0, 'GAME_STARTED'], [-1, 'GAME_STARTED']]) {
  test(`T2 boundary ${minutes} minutes before start: ${expected ?? 'eligible'}`, async () => {
    const time = new Date(+START - minutes * 60000)
    assert.equal(getT2Eligibility(game(), time), expected)
    const h = harness(); h.setClock(time)
    const result = await h.service.runScheduledCapture()
    assert.equal(result.captured, expected ? 0 : 1)
    assert.equal(h.loads, expected ? 0 : 1)
  })
}

test('repeat and concurrent cron calls preserve first successful immutable snapshot', async () => {
  const h = harness()
  await h.service.runScheduledCapture()
  const first = JSON.stringify([...h.documents.values()][0])
  h.setClock(new Date(+NOW + 5 * 60000))
  const result = await h.service.runScheduledCapture()
  assert.equal(result.reasonCounts.ALREADY_CAPTURED, 1)
  assert.equal(h.loads, 1)
  assert.equal(h.documents.size, 1)
  assert.equal(JSON.stringify([...h.documents.values()][0]), first)
  const changed = snapshot(); changed.homeWinProbability = 0.6; changed.awayWinProbability = 0.4
  changed.homeFairOdds = 1 / 0.6; changed.awayFairOdds = 1 / 0.4
  await Promise.all([h.repository.insertOnce(changed), h.repository.insertOnce(changed)])
  assert.equal(JSON.stringify([...h.documents.values()][0]), first)
})

test('required input failure retries successfully during window', async () => {
  let attempts = 0
  const h = harness({ onLoad: ({ value }) => { if (!attempts++) value.ratings = [] } })
  const first = await h.service.runScheduledCapture()
  assert.equal(first.reasonCounts.RATINGS_UNAVAILABLE, 1)
  assert.equal(first.captured, 0)
  assert.equal((await h.service.runScheduledCapture()).captured, 1)
})

test('overlapping successful runs admit one first writer', async () => {
  const h = harness()
  const results = await Promise.all([h.service.runScheduledCapture(), h.service.runScheduledCapture()])
  assert.equal(results.reduce((sum, result) => sum + result.captured, 0), 1)
  assert.equal(h.documents.size, 1)
})

test('new start identity can capture; old observation never changes', async () => {
  const h = harness(); await h.service.runScheduledCapture()
  const old = JSON.stringify([...h.documents.values()][0])
  const next = game(); next.startTimeUTC = new Date(+START + 86400000).toISOString()
  h.setGame(next); h.setClock(new Date(+NOW + 86400000))
  assert.equal((await h.service.runScheduledCapture()).captured, 1)
  assert.equal(h.documents.size, 2)
  assert.equal(JSON.stringify([...h.documents.values()][0]), old)
})

test('late completion, changed start, started game or disabled account aborts capture', async () => {
  for (const onLoad of [
    ({ setClock }) => setClock(new Date(+START - 74 * 60000)),
    ({ setGame }) => setGame({ ...game(), startTimeUTC: new Date(+START + 3600000).toISOString() }),
    ({ setGame }) => setGame({ ...game(), gameState: 'LIVE' }),
    ({ disable }) => disable(),
  ]) {
    const h = harness({ onLoad }); await h.service.runScheduledCapture()
    assert.equal(h.documents.size, 0)
  }
})

test('owners receive independent snapshots with no market/bookmaker dependencies', async () => {
  const h = harness({ users: [USER_ID, OTHER_USER_ID], onLoad: ({ userId, value }) => {
    if (userId === OTHER_USER_ID) value.ratings[0].baseRating = 50
  } })
  const result = await h.service.runScheduledCapture()
  assert.equal(result.captured, 2)
  assert.equal(h.documents.size, 2)
  const rows = [...h.documents.values()]
  assert.notEqual(rows[0].homeWinProbability, rows[1].homeWinProbability)
  assert.deepEqual(rows.map((row) => String(row.userId)), [USER_ID, OTHER_USER_ID])
  assert.ok(h.filters.every((filter) => [USER_ID, OTHER_USER_ID].includes(filter.userId)))
  await assert.rejects(() => h.repository.exists({ gameId: '2026020001' }), /owner/)
  await assert.rejects(() => h.repository.insertOnce({ ...snapshot(), userId: null }), /owner/)
})

test('stale schedule and unavailable/pregame-invalid games cannot capture', async () => {
  const h = harness()
  h.provider.getScheduleForDate = async () => ({ stale: true })
  assert.equal((await h.service.runScheduledCapture()).captured, 0)
  for (const patch of [{ gameScheduleState: 'PPD' }, { status: 'Cancelled' },
    { gameState: 'OFF' }, { gameType: 1 }, { status: 'Abandoned' }]) {
    const value = harness(); value.setGame({ ...game(), ...patch })
    assert.equal((await value.service.runScheduledCapture()).captured, 0)
  }
})

test('unique index includes owner/start/definition and model rejects invalid time and probability', async () => {
  const indexes = Snapshot.schema.indexes()
  assert.deepEqual(indexes.find(([, options]) => options.unique)[0], {
    userId: 1, gameId: 1, scheduledStartAtCapture: 1, predictionDefinition: 1,
  })
  await new Snapshot(snapshot()).validate()
  await assert.rejects(() => new Snapshot({ ...snapshot(), generatedAt: START }).validate(), /T2 window/)
  await assert.rejects(() => new Snapshot({ ...snapshot(), homeFairOdds: 9 }).validate(), /contract mismatch/)
  await assert.rejects(() => Snapshot.updateOne({}, { $set: { homeFairOdds: 9 } }), /insert-once/)
  await assert.rejects(() => Snapshot.replaceOne({}, snapshot()), /insert-once/)
  const existing = new Snapshot(snapshot()); existing.isNew = false
  await assert.rejects(() => existing.save(), /immutable/)
})

test('duplicate-key race returns already captured, unrelated database errors propagate', async () => {
  const repository = createForwardPredictionRepository({ model: {
    async updateOne() { throw Object.assign(new Error('race'), { code: 11000 }) },
    async exists() { return true },
  } })
  assert.deepEqual(await repository.insertOnce(snapshot()), { inserted: false })
  const broken = createForwardPredictionRepository({ model: { async updateOne() { throw new Error('offline') } } })
  await assert.rejects(() => broken.insertOnce(snapshot()), /offline/)
})

test('result linkage handles regulation/OT/SO, postponements, invalid scores and rescheduling', () => {
  const saved = snapshot()
  const final = { ...game(), gameState: 'OFF', homeTeam: { abbrev: 'BOS', score: 3 }, awayTeam: { abbrev: 'TOR', score: 2 } }
  for (const lastPeriodType of ['REG', 'OT', 'SO']) {
    assert.equal(resolveForwardPredictionResult(saved, { ...final, gameOutcome: { lastPeriodType } }).homeWon, true)
  }
  assert.equal(resolveForwardPredictionResult(saved, { ...final, homeTeam: { abbrev: 'BOS', score: 1 } }).homeWon, false)
  assert.equal(resolveForwardPredictionResult(saved, game()).status, 'RESULT_PENDING')
  assert.equal(resolveForwardPredictionResult(saved, { ...final, startTimeUTC: new Date(+START + 3600000).toISOString() }).status, 'RESCHEDULED')
  assert.equal(resolveForwardPredictionResult(saved, { ...final, gameScheduleState: 'PPD' }).status, 'GAME_UNAVAILABLE')
  for (const score of [null, '', -1, 2, 2.5]) {
    assert.equal(resolveForwardPredictionResult(saved, { ...final, homeTeam: { abbrev: 'BOS', score } }).status, 'INVALID_FINAL_RESULT')
  }
})

test('actual Mongoose insert-once query retains every immutable field without a database', async (t) => {
  let written
  t.mock.method(Snapshot.collection, 'updateOne', async (filter, update) => {
    written = { filter, update }
    return { upsertedCount: 1 }
  })
  const repo = createForwardPredictionRepository()
  assert.deepEqual(await repo.insertOnce(snapshot()), { inserted: true })
  assert.equal(String(written.filter.userId), USER_ID)
  assert.deepEqual(Object.keys(written.update), ['$setOnInsert'])
  assert.equal(written.update.$setOnInsert.homeWinProbability, snapshot().homeWinProbability)
  assert.equal(written.update.$setOnInsert.completeness.goalies.home, 'unknown')
  assert.ok(written.update.$setOnInsert.effectiveSettings)
})
