process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const OddsCaptureRun = require('../models/OddsCaptureRun')
const {
  MAX_CHECKPOINT_RESULTS,
  MAX_REASON_COUNTS,
  MAX_REASON_KEY_LENGTH,
} = require('../models/OddsCaptureRun')
const {
  OddsCaptureRunPersistenceError,
  createOddsCaptureRunService,
} = require('../services/oddsCaptureRunService')
const {
  makeOddsSnapshot,
} = require('./fixtures/oddsSnapshotFixtures')

const makeRun = (overrides = {}) => ({
  intendedAt: new Date('2026-10-08T21:00:00.000Z'),
  runId: 'run-2026-10-08-t2',
  runKey: 'T2:2026-10-08T21:00:00.000Z',
  startedAt: new Date('2026-10-08T21:00:01.000Z'),
  status: 'STARTED',
  triggerSource: 'TEST',
  ...overrides,
})

const makeCheckpointResult = (overrides = {}) => {
  const snapshot = makeOddsSnapshot()

  return {
    checkpointKey: snapshot.checkpointKey,
    gameId: snapshot.gameId,
    reason: '',
    snapshotType: snapshot.snapshotType,
    status: 'STORED',
    ...overrides,
  }
}

test('OddsCaptureRun is global, compact and uniquely keyed by runKey', async () => {
  const document = new OddsCaptureRun(makeRun())
  await document.validate()

  const indexes = OddsCaptureRun.schema.indexes()
  assert.equal(OddsCaptureRun.schema.paths.userId, undefined)
  assert.equal(document.actualCreditCost, null)
  assert.deepEqual(indexes, [
    [{ runKey: 1 }, { unique: true }],
    [{ completedAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }],
  ])
})

test('OddsCaptureRun bounds checkpoint results and reason counts', async () => {
  const tooManyResults = Array.from(
    { length: MAX_CHECKPOINT_RESULTS + 1 },
    () => makeCheckpointResult(),
  )
  await assert.rejects(
    new OddsCaptureRun(makeRun({ checkpointResults: tooManyResults })).validate(),
    (error) => Boolean(error.errors.checkpointResults),
  )

  const tooManyReasons = Object.fromEntries(
    Array.from({ length: MAX_REASON_COUNTS + 1 }, (_, index) => [
      `reason_${index}`,
      1,
    ]),
  )
  await assert.rejects(
    new OddsCaptureRun(makeRun({ reasonCounts: tooManyReasons })).validate(),
    (error) => Boolean(error.errors.reasonCounts),
  )

  await assert.rejects(
    new OddsCaptureRun(makeRun({ reasonCounts: { invalid: -1 } })).validate(),
  )
  await assert.rejects(
    new OddsCaptureRun(
      makeRun({ reasonCounts: { ['x'.repeat(MAX_REASON_KEY_LENGTH + 1)]: 1 } }),
    ).validate(),
  )
})

test('OddsCaptureRun rejects raw payloads, URLs, secrets and oversized diagnostics', () => {
  for (const field of [
    'rawProviderResponse',
    'requestUrl',
    'apiKey',
    'stackTrace',
  ]) {
    assert.throws(() => new OddsCaptureRun(makeRun({ [field]: 'secret' })), field)
  }
})

const createMemoryCaptureRunModel = () => {
  const documents = new Map()

  return {
    documents,
    async create(values) {
      if (documents.has(values.runKey)) {
        const error = new Error('duplicate runKey')
        error.code = 11000
        throw error
      }

      const document = structuredClone(values)
      documents.set(values.runKey, document)
      return document
    },
    async findOneAndUpdate(filter, update, options) {
      assert.deepEqual(options, { new: true, runValidators: true })
      const document = documents.get(filter.runKey)

      if (!document || document.status !== filter.status) {
        return null
      }

      Object.assign(document, structuredClone(update.$set))
      return document
    },
    async updateMany(filter, update, options) {
      assert.deepEqual(options, { runValidators: true })
      let modifiedCount = 0

      documents.forEach((document) => {
        if (
          document.status === filter.status &&
          new Date(document.startedAt).getTime() <=
            filter.startedAt.$lte.getTime()
        ) {
          Object.assign(document, structuredClone(update.$set))
          modifiedCount += 1
        }
      })

      return { modifiedCount }
    },
  }
}

test('capture-run helper starts and completes a bounded run', async () => {
  const model = createMemoryCaptureRunModel()
  const completedAt = new Date('2026-10-08T21:00:10.000Z')
  const service = createOddsCaptureRunService({
    captureRunModel: model,
    now: () => completedAt,
  })
  const started = await service.startRun(makeRun())

  assert.equal(started.status, 'STARTED')

  const completed = await service.completeRun(started.runKey, {
    actualCreditCost: 0,
    checkpointResults: [makeCheckpointResult()],
    eventsReceived: 1,
    gamesConsidered: 1,
    gamesMatched: 1,
    gamesSkipped: 0,
    providerRequestCount: 0,
    reasonCounts: {},
    snapshotsStored: 1,
    status: 'COMPLETED',
  })

  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.snapshotsStored, 1)
  assert.equal(completed.completedAt.toISOString(), completedAt.toISOString())
  assert.equal(completed.actualCreditCost, 0)
})

test('capture-run helper enforces unique run keys and one-way completion', async () => {
  const model = createMemoryCaptureRunModel()
  const service = createOddsCaptureRunService({ captureRunModel: model })
  const run = makeRun()

  await service.startRun(run)
  await assert.rejects(() => service.startRun(run), (error) => error.code === 11000)
  await service.completeRun(run.runKey, { status: 'FAILED' })
  await assert.rejects(
    () => service.completeRun(run.runKey, { status: 'COMPLETED' }),
    (error) =>
      error instanceof OddsCaptureRunPersistenceError &&
      error.statusCode === 409,
  )
})

test('capture-run helper rejects invalid status transitions', async () => {
  const service = createOddsCaptureRunService({
    captureRunModel: createMemoryCaptureRunModel(),
  })

  await assert.rejects(
    () => service.completeRun('run-key', { status: 'STARTED' }),
    (error) => error.statusCode === 400,
  )
  await assert.rejects(
    () => service.completeRun('', { status: 'COMPLETED' }),
    (error) => error.statusCode === 400,
  )
})

test('stale STARTED recovery is terminal, threshold-bounded and idempotent', async () => {
  const model = createMemoryCaptureRunModel()
  const recoveredAt = new Date('2026-10-08T22:00:00.000Z')
  const service = createOddsCaptureRunService({
    captureRunModel: model,
    now: () => recoveredAt,
  })
  const stale = makeRun({
    runId: 'stale',
    runKey: 'stale',
    startedAt: new Date('2026-10-08T21:30:00.000Z'),
  })
  const fresh = makeRun({
    runId: 'fresh',
    runKey: 'fresh',
    startedAt: new Date('2026-10-08T21:30:00.001Z'),
  })
  const completed = makeRun({
    completedAt: new Date('2026-10-08T21:00:00.000Z'),
    runId: 'completed',
    runKey: 'completed',
    startedAt: new Date('2026-10-08T20:00:00.000Z'),
    status: 'COMPLETED',
  })

  model.documents.set(stale.runKey, structuredClone(stale))
  model.documents.set(fresh.runKey, structuredClone(fresh))
  model.documents.set(completed.runKey, structuredClone(completed))

  assert.equal(await service.recoverStaleStartedRuns(), 1)
  assert.equal(model.documents.get('stale').status, 'RECOVERED_FAILED')
  assert.equal(
    model.documents.get('stale').recoveryReason,
    'stale_started_recovered',
  )
  assert.equal(model.documents.get('fresh').status, 'STARTED')
  assert.equal(model.documents.get('completed').status, 'COMPLETED')
  assert.equal(await service.recoverStaleStartedRuns(), 0)
})
