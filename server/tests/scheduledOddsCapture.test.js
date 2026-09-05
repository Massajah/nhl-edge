process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const ScheduledJobLease = require('../models/ScheduledJobLease')
const {
  buildScheduledJobSlotKey,
  createScheduledJobLeaseService,
  getCronSlot,
} = require('../services/scheduledJobLeaseService')
const {
  createScheduledOddsCaptureService,
} = require('../services/scheduledOddsCaptureService')
const { runOddsCaptureCron } = require('../scripts/runOddsCaptureCron')

const NOW = new Date('2026-10-08T18:42:31.000Z')
const SLOT = new Date('2026-10-08T18:40:00.000Z')

const clone = (value) => (value ? structuredClone(value) : value)

const matches = (document, filter) =>
  Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some((branch) => matches(document, branch))
    }

    if (expected && typeof expected === 'object' && '$lte' in expected) {
      return new Date(document[key]).getTime() <= new Date(expected.$lte).getTime()
    }

    return document[key] === expected
  })

const applyUpdate = (document, update, { inserting = false } = {}) => {
  if (inserting) {
    Object.assign(document, clone(update.$setOnInsert ?? {}))
  }

  Object.assign(document, clone(update.$set ?? {}))
  Object.entries(update.$inc ?? {}).forEach(([key, amount]) => {
    document[key] = (Number(document[key]) || 0) + amount
  })
}

const createMemoryLeaseModel = () => {
  const documents = new Map()

  return {
    documents,
    async findOne(filter) {
      const document = documents.get(filter.slotKey)
      return document && matches(document, filter) ? clone(document) : null
    },
    async findOneAndUpdate(filter, update, options = {}) {
      const document = documents.get(filter.slotKey)

      if (document && matches(document, filter)) {
        applyUpdate(document, update)
        return clone(document)
      }

      if (options.upsert) {
        if (document) {
          const error = new Error('duplicate slot')
          error.code = 11000
          throw error
        }

        const inserted = {}
        applyUpdate(inserted, update, { inserting: true })
        documents.set(inserted.slotKey, inserted)
        return clone(inserted)
      }

      return null
    },
  }
}

test('scheduled lease schema is global, unique and bounded by retention', async () => {
  const document = new ScheduledJobLease({
    acquiredAt: NOW,
    attemptCount: 1,
    expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    intendedAt: SLOT,
    jobName: 'nhl-edge-odds-capture',
    leaseToken: 'token-1',
    slotKey: buildScheduledJobSlotKey('nhl-edge-odds-capture', SLOT),
    status: 'RUNNING',
  })

  await document.validate()
  assert.equal(ScheduledJobLease.schema.paths.userId, undefined)
  assert.equal(ScheduledJobLease.schema.paths.slotKey.options.unique, true)
  assert.equal(
    ScheduledJobLease.schema.indexes().some(
      ([fields, options]) =>
        fields.expiresAt === 1 &&
        options.expireAfterSeconds === 35 * 24 * 60 * 60,
    ),
    true,
  )
})

test('cron slot identity is deterministic on inclusive five-minute boundaries', () => {
  assert.equal(getCronSlot(NOW).toISOString(), SLOT.toISOString())
  assert.equal(
    getCronSlot('2026-10-08T18:45:00.000Z').toISOString(),
    '2026-10-08T18:45:00.000Z',
  )
})

test('atomic lease acquisition admits one owner and completed slots never rerun', async () => {
  const model = createMemoryLeaseModel()
  let token = 0
  const service = createScheduledJobLeaseService({
    leaseModel: model,
    now: () => NOW,
    tokenFactory: () => `token-${++token}`,
  })
  const attempts = await Promise.all([
    service.acquireLease({ intendedAt: SLOT, jobName: 'job' }),
    service.acquireLease({ intendedAt: SLOT, jobName: 'job' }),
  ])

  assert.equal(attempts.filter(({ acquired }) => acquired).length, 1)
  const owned = attempts.find(({ acquired }) => acquired).lease
  await service.finishLease(owned.slotKey, owned.leaseToken, {
    outcome: 'NO_DUE_WORK',
  })
  const replay = await service.acquireLease({ intendedAt: SLOT, jobName: 'job' })

  assert.equal(replay.acquired, false)
  assert.equal(replay.lease.status, 'COMPLETED')
})

test('an expired lease is recovered with fencing and a fresh token', async () => {
  const model = createMemoryLeaseModel()
  let current = new Date('2026-10-08T18:40:00.000Z')
  let token = 0
  const service = createScheduledJobLeaseService({
    leaseDurationMs: 60 * 1000,
    leaseModel: model,
    now: () => current,
    tokenFactory: () => `token-${++token}`,
  })
  const first = await service.acquireLease({ intendedAt: SLOT, jobName: 'job' })
  current = new Date('2026-10-08T18:41:01.000Z')
  const recovered = await service.acquireLease({ intendedAt: SLOT, jobName: 'job' })

  assert.equal(recovered.acquired, true)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.lease.attemptCount, 2)
  assert.notEqual(recovered.lease.leaseToken, first.lease.leaseToken)
  await assert.rejects(
    () => service.finishLease(first.lease.slotKey, first.lease.leaseToken),
    /no longer owned/,
  )
  await service.finishLease(recovered.lease.slotKey, recovered.lease.leaseToken)
})

const makeLeaseService = () => {
  const calls = { acquire: 0, finish: [] }

  return {
    calls,
    async acquireLease() {
      calls.acquire += 1
      return {
        acquired: true,
        lease: { leaseToken: 'token', slotKey: 'slot' },
        recovered: false,
      }
    },
    async finishLease(slotKey, leaseToken, completion) {
      calls.finish.push({ completion, leaseToken, slotKey })
      return { ...completion, leaseToken, slotKey }
    },
  }
}

test('one-shot orchestration exits honestly when no checkpoint work is due', async () => {
  const leaseService = makeLeaseService()
  let providerExecutions = 0
  const service = createScheduledOddsCaptureService({
    captureEngine: {
      async executeOddsCapture() {
        providerExecutions += 1
      },
    },
    captureRunService: { async recoverStaleStartedRuns() { return 2 } },
    leaseService,
    logger: { info() {} },
    now: () => NOW,
    planner: {
      async planDueCheckpoints() {
        return {
          dueCheckpointCount: 0,
          groups: [],
          policy: { mode: 'FULL' },
          reasonCounts: { no_games: 1 },
          scheduleFailureCount: 0,
          status: 'NO_DUE_WORK',
        }
      },
    },
  })
  const result = await service.runScheduledCapture()

  assert.equal(result.outcome, 'NO_DUE_WORK')
  assert.equal(result.recoveredRunCount, 2)
  assert.equal(providerExecutions, 0)
  assert.equal(leaseService.calls.finish[0].completion.status, 'COMPLETED')
})

test('quota-blocked capture is handled and stops lower-priority groups', async () => {
  const leaseService = makeLeaseService()
  let executions = 0
  const service = createScheduledOddsCaptureService({
    captureEngine: {
      async executeOddsCapture() {
        executions += 1
        return {
          insertedCount: 0,
          providerRequestCount: 0,
          status: 'QUOTA_BLOCKED',
        }
      },
    },
    captureRunService: { async recoverStaleStartedRuns() { return 0 } },
    leaseService,
    logger: { info() {} },
    now: () => NOW,
    planner: {
      async planDueCheckpoints() {
        return {
          dueCheckpointCount: 2,
          groups: [[{ gameId: '1' }], [{ gameId: '2' }]],
          policy: { mode: 'FULL' },
          reasonCounts: {},
          scheduleFailureCount: 0,
          status: 'READY',
        }
      },
    },
  })
  const result = await service.runScheduledCapture()

  assert.equal(result.outcome, 'QUOTA_BLOCKED')
  assert.equal(executions, 1)
  assert.equal(leaseService.calls.finish[0].completion.status, 'COMPLETED')
})

test('cron entrypoint connects, runs once, closes MongoDB and propagates fatal errors', async () => {
  const calls = []
  const environment = { MONGODB_URI: 'mongodb://example', THE_ODDS_API_KEY: 'test' }
  const result = await runOddsCaptureCron({
    closeDatabase: async () => calls.push('close'),
    connectDatabase: async () => calls.push('connect'),
    environment,
    service: {
      async runScheduledCapture() {
        calls.push('run')
        return { outcome: 'NO_DUE_WORK' }
      },
    },
  })

  assert.equal(result.outcome, 'NO_DUE_WORK')
  assert.deepEqual(calls, ['connect', 'run', 'close'])

  await assert.rejects(
    () =>
      runOddsCaptureCron({
        closeDatabase: async () => calls.push('close-after-error'),
        connectDatabase: async () => {},
        environment,
        service: { async runScheduledCapture() { throw new Error('fatal') } },
      }),
    /fatal/,
  )
  assert.equal(calls.at(-1), 'close-after-error')
})

test('cron entrypoint fails closed before connecting when required server variables are absent', async () => {
  let connected = false

  await assert.rejects(
    () =>
      runOddsCaptureCron({
        connectDatabase: async () => { connected = true },
        environment: {},
      }),
    /MONGODB_URI/,
  )
  assert.equal(connected, false)
})
