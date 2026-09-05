process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const OddsQuotaLedger = require('../models/OddsQuotaLedger')
const {
  AUTOMATIC_CREDIT_HARD_CEILING,
  AUTOMATIC_CREDIT_TARGET,
  AUTOMATIC_DAILY_SUCCESS_LIMIT,
  createOddsQuotaLedgerService,
  getUtcBillingWindow,
} = require('../services/oddsQuotaLedgerService')

const NOW = new Date('2026-10-08T12:00:00.000Z')

const clone = (value) => (value ? structuredClone(value) : value)

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === 'object' && '$lte' in expected) {
    return new Date(actual).getTime() <= new Date(expected.$lte).getTime()
  }

  if (expected && typeof expected === 'object' && '$exists' in expected) {
    return (actual !== undefined) === expected.$exists
  }

  return actual === expected
}

const matches = (document, filter) =>
  Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some((branch) => matches(document, branch))
    }

    return matchesValue(document?.[key], expected)
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

const createMemoryLedgerModel = () => {
  let document = null

  return {
    get document() {
      return document
    },
    async findOne(filter) {
      return matches(document, filter) ? clone(document) : null
    },
    async findOneAndUpdate(filter, update, options = {}) {
      if (!document && options.upsert) {
        document = {}
        applyUpdate(document, update, { inserting: true })
        return clone(document)
      }

      if (!matches(document, filter)) {
        return null
      }

      applyUpdate(document, update)
      return clone(document)
    },
    async updateOne(filter, update) {
      if (!matches(document, filter)) {
        return { matchedCount: 0, modifiedCount: 0 }
      }

      applyUpdate(document, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
}

const setQuota = (model, values) => Object.assign(model.document, values)

test('quota ledger is global, singleton-keyed and contains no secret fields', async () => {
  const window = getUtcBillingWindow(NOW)
  const document = new OddsQuotaLedger({
    billingWindowEndsAt: window.endsAt,
    billingWindowKey: window.key,
    billingWindowStartedAt: window.startedAt,
    dailyKey: '2026-10-08',
    provider: 'the-odds-api-v4',
    schemaVersion: 1,
    updatedAt: NOW,
  })

  await document.validate()
  assert.equal(OddsQuotaLedger.schema.paths.userId, undefined)
  assert.equal(OddsQuotaLedger.schema.paths.apiKey, undefined)
  assert.equal(OddsQuotaLedger.schema.paths.requestUrl, undefined)
  assert.equal(OddsQuotaLedger.schema.paths.rawResponse, undefined)
  assert.equal(OddsQuotaLedger.schema.paths.provider.options.unique, true)
})

test('manual and automatic actual requests share one ledger without charging cache hits', async () => {
  const model = createMemoryLedgerModel()
  const service = createOddsQuotaLedgerService({ ledgerModel: model, now: () => NOW })

  await service.recordProviderRequest({
    observedAt: NOW,
    quota: { lastCost: 1, remaining: 299, used: 1 },
    source: 'MANUAL',
    successful: true,
  })
  assert.equal(model.document.remaining, 299)
  assert.equal(model.document.source, 'MANUAL')
  assert.equal(model.document.automaticRequestCount, 0)

  await service.recordProviderRequest({
    observedAt: new Date(NOW.getTime() + 1000),
    quota: { lastCost: 1, remaining: 298, used: 2 },
    source: 'AUTOMATIC',
    successful: true,
  })
  await service.recordProviderRequest({
    observedAt: new Date(NOW.getTime() + 2000),
    quota: null,
    source: 'AUTOMATIC',
    successful: false,
  })

  assert.equal(model.document.automaticRequestCount, 2)
  assert.equal(model.document.automaticSuccessfulRequestCount, 1)
  assert.equal(model.document.dailyAutomaticSuccessfulRequestCount, 1)
  assert.equal(model.document.automaticCreditSpend, 2)
  assert.equal(model.document.remaining, null)
  assert.equal(model.document.lastRequestCost, null)
  assert.equal(model.document.lastRequestStatus, 'FAILED')
})

test('automatic policy enforces quota modes, target, ceiling, floor and daily cap', async () => {
  const model = createMemoryLedgerModel()
  const service = createOddsQuotaLedgerService({ ledgerModel: model, now: () => NOW })
  await service.ensureCurrentPeriods()

  setQuota(model, { remaining: 201 })
  assert.equal((await service.getAutomaticPolicy()).mode, 'FULL')

  setQuota(model, { remaining: 200 })
  const intermediate = await service.getAutomaticPolicy({
    checkpoints: [{ snapshotType: 'T2' }],
  })
  const final = await service.getAutomaticPolicy({
    checkpoints: [{ snapshotType: 'FINAL' }],
  })
  assert.equal(intermediate.allowed, false)
  assert.equal(intermediate.mode, 'FINAL_ONLY')
  assert.equal(final.allowed, true)

  setQuota(model, { remaining: 100 })
  assert.equal((await service.getAutomaticPolicy()).reason, 'automatic_remaining_floor')

  setQuota(model, {
    automaticCreditSpend: AUTOMATIC_CREDIT_TARGET,
    remaining: 500,
  })
  assert.equal((await service.getAutomaticPolicy()).mode, 'FINAL_ONLY')

  setQuota(model, {
    automaticCreditSpend: AUTOMATIC_CREDIT_HARD_CEILING,
    remaining: 500,
  })
  assert.equal((await service.getAutomaticPolicy()).reason, 'automatic_credit_ceiling')

  setQuota(model, {
    automaticCreditSpend: 0,
    dailyAutomaticSuccessfulRequestCount: AUTOMATIC_DAILY_SUCCESS_LIMIT,
  })
  assert.equal((await service.getAutomaticPolicy()).reason, 'automatic_daily_limit')
})

test('unknown quota allows one persistent controlled probe per UTC billing window', async () => {
  const model = createMemoryLedgerModel()
  const firstService = createOddsQuotaLedgerService({ ledgerModel: model, now: () => NOW })

  const first = await firstService.getAutomaticPolicy()
  assert.equal(first.allowed, true)
  assert.equal(first.mode, 'CONTROLLED_PROBE')
  assert.equal(first.requestSource, 'CONTROLLED_PROBE')

  await firstService.recordProviderRequest({
    observedAt: NOW,
    quota: null,
    source: 'CONTROLLED_PROBE',
    successful: false,
  })
  const restartedService = createOddsQuotaLedgerService({
    ledgerModel: model,
    now: () => NOW,
  })
  const blocked = await restartedService.getAutomaticPolicy()

  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'unknown_quota_probe_used')
})

test('UTC day and calendar-month rollover reset only their owned counters', async () => {
  const model = createMemoryLedgerModel()
  const service = createOddsQuotaLedgerService({ ledgerModel: model, now: () => NOW })
  await service.ensureCurrentPeriods()
  setQuota(model, {
    automaticCreditSpend: 12,
    automaticRequestCount: 12,
    controlledProbeRequestCount: 1,
    dailyAutomaticSuccessfulRequestCount: 6,
    remaining: 250,
  })

  await service.ensureCurrentPeriods('2026-10-09T00:00:00.000Z')
  assert.equal(model.document.automaticCreditSpend, 12)
  assert.equal(model.document.dailyAutomaticSuccessfulRequestCount, 0)

  await service.ensureCurrentPeriods('2026-11-01T00:00:00.000Z')
  assert.equal(model.document.billingWindowKey, '2026-11')
  assert.equal(model.document.automaticCreditSpend, 0)
  assert.equal(model.document.automaticRequestCount, 0)
  assert.equal(model.document.controlledProbeRequestCount, 0)
  assert.equal(model.document.remaining, null)
})
