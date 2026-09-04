process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  OddsSnapshotPersistenceError,
  createOddsSnapshotRepository,
} = require('../services/oddsSnapshotRepository')
const { createOddsCheckpoint } = require('../services/oddsSnapshotContracts')
const {
  makeOddsSnapshot,
} = require('./fixtures/oddsSnapshotFixtures')

const identityFromFilter = (filter) =>
  `${filter.gameId}|${filter.provider}|${filter.checkpointKey}`

const createMemorySnapshotModel = ({ failAfterFirstInsert = false } = {}) => {
  const documents = new Map()
  let calls = 0

  return {
    calls: () => calls,
    documents,
    async bulkWrite(operations, options) {
      calls += 1
      assert.deepEqual(options, { ordered: false })
      let matchedCount = 0
      let upsertedCount = 0

      for (const [index, operation] of operations.entries()) {
        const { filter, update, upsert } = operation.updateOne
        const identity = identityFromFilter(filter)

        assert.equal(upsert, true)
        assert.deepEqual(Object.keys(update), ['$setOnInsert'])

        if (documents.has(identity)) {
          matchedCount += 1
        } else {
          documents.set(identity, structuredClone(update.$setOnInsert))
          upsertedCount += 1
        }

        if (failAfterFirstInsert && calls === 1 && index === 0) {
          const error = new Error('simulated unordered partial failure')
          error.result = { matchedCount, upsertedCount }
          throw error
        }
      }

      return { matchedCount, modifiedCount: 0, upsertedCount }
    },
  }
}

const createRepository = (model) =>
  createOddsSnapshotRepository({
    prepareCandidate: async (candidate) => structuredClone(candidate),
    snapshotModel: model,
  })

test('snapshot repository inserts different checkpoints for one game', async () => {
  const model = createMemorySnapshotModel()
  const repository = createRepository(model)
  const t2 = makeOddsSnapshot()
  const t6Checkpoint = createOddsCheckpoint({
    scheduledStart: t2.scheduledStartAtCapture,
    snapshotType: 'T6',
  })
  const result = await repository.insertSnapshots([
    t2,
    makeOddsSnapshot(t6Checkpoint),
  ])

  assert.deepEqual(result, {
    attemptedCount: 2,
    existingCount: 0,
    insertedCount: 2,
  })
  assert.equal(model.documents.size, 2)
})

test('snapshot repository retry never overwrites original odds', async () => {
  const model = createMemorySnapshotModel()
  const repository = createRepository(model)
  const original = makeOddsSnapshot()

  await repository.insertSnapshots([original])
  const changed = makeOddsSnapshot({
    bookmakers: original.bookmakers.map((bookmaker) => ({
      ...bookmaker,
      awayOdds: bookmaker.awayOdds + 0.5,
      homeOdds: bookmaker.homeOdds + 0.5,
    })),
    capturedAt: new Date('2026-10-08T21:05:00.000Z'),
  })
  const result = await repository.insertSnapshots([changed])
  const stored = [...model.documents.values()][0]

  assert.deepEqual(result, {
    attemptedCount: 1,
    existingCount: 1,
    insertedCount: 0,
  })
  assert.equal(stored.capturedAt.toISOString(), original.capturedAt.toISOString())
  assert.equal(stored.bookmakers[0].homeOdds, original.bookmakers[0].homeOdds)
})

test('snapshot repository accepts a rescheduled checkpoint without replacing old history', async () => {
  const model = createMemorySnapshotModel()
  const repository = createRepository(model)
  const original = makeOddsSnapshot()
  const newStart = new Date('2026-10-09T01:00:00.000Z')
  const rescheduled = makeOddsSnapshot({
    ...createOddsCheckpoint({ scheduledStart: newStart, snapshotType: 'T2' }),
    providerCommenceTime: newStart,
    scheduledStartAtCapture: newStart,
  })

  await repository.insertSnapshots([original])
  const result = await repository.insertSnapshots([rescheduled])

  assert.equal(result.insertedCount, 1)
  assert.equal(model.documents.size, 2)
})

test('snapshot repository rejects duplicate candidates before any write', async () => {
  const model = createMemorySnapshotModel()
  const repository = createRepository(model)
  const snapshot = makeOddsSnapshot()

  await assert.rejects(
    () => repository.insertSnapshots([snapshot, structuredClone(snapshot)]),
    (error) =>
      error instanceof OddsSnapshotPersistenceError &&
      error.details.duplicateIdentities.length === 1,
  )
  assert.equal(model.calls(), 0)
  assert.equal(model.documents.size, 0)
})

test('unordered partial bulk retry inserts only missing snapshots', async () => {
  const model = createMemorySnapshotModel({ failAfterFirstInsert: true })
  const repository = createRepository(model)
  const t2 = makeOddsSnapshot()
  const t6 = makeOddsSnapshot({
    ...createOddsCheckpoint({
      scheduledStart: t2.scheduledStartAtCapture,
      snapshotType: 'T6',
    }),
  })

  await assert.rejects(
    () => repository.insertSnapshots([t2, t6]),
    (error) => {
      assert.deepEqual(error.snapshotWriteSummary, {
        attemptedCount: 2,
        existingCount: 0,
        insertedCount: 1,
        unresolvedCount: 1,
      })
      return true
    },
  )
  const retry = await repository.insertSnapshots([t2, t6])

  assert.deepEqual(retry, {
    attemptedCount: 2,
    existingCount: 1,
    insertedCount: 1,
  })
  assert.equal(model.documents.size, 2)
})

test('empty snapshot batches are observable no-op writes', async () => {
  const model = createMemorySnapshotModel()
  const result = await createRepository(model).insertSnapshots([])

  assert.deepEqual(result, {
    attemptedCount: 0,
    existingCount: 0,
    insertedCount: 0,
  })
  assert.equal(model.calls(), 0)
})
