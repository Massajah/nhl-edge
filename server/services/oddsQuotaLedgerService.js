const OddsQuotaLedger = require('../models/OddsQuotaLedger')
const {
  QUOTA_LEDGER_SOURCES,
} = require('../models/OddsQuotaLedger')
const {
  ODDS_SNAPSHOT_PROVIDER,
} = require('./oddsSnapshotContracts')

const AUTOMATIC_CREDIT_TARGET = 150
const AUTOMATIC_CREDIT_HARD_CEILING = 180
const AUTOMATIC_REMAINING_FLOOR = 100
const AUTOMATIC_DAILY_SUCCESS_LIMIT = 6
const UNKNOWN_QUOTA_PROBE_LIMIT = 1

const AUTOMATIC_POLICY_MODES = Object.freeze({
  CONTROLLED_PROBE: 'CONTROLLED_PROBE',
  DISABLED: 'DISABLED',
  FINAL_ONLY: 'FINAL_ONLY',
  FULL: 'FULL',
})

const normalizeDate = (value, field = 'date') => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const toNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : null
}

const toPlainObject = (document) => {
  if (!document) {
    return null
  }

  return typeof document.toObject === 'function'
    ? document.toObject({ versionKey: false })
    : document
}

const getUtcBillingWindow = (value) => {
  const date = normalizeDate(value)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const startedAt = new Date(Date.UTC(year, month, 1))
  const endsAt = new Date(Date.UTC(year, month + 1, 1))

  return {
    endsAt,
    key: startedAt.toISOString().slice(0, 7),
    startedAt,
  }
}

const getUtcDayKey = (value) => normalizeDate(value).toISOString().slice(0, 10)

const isDuplicateKeyError = (error) => Number(error?.code) === 11000

const createOddsQuotaLedgerService = ({
  ledgerModel = OddsQuotaLedger,
  now = () => new Date(),
} = {}) => {
  const readProviderLedger = async () =>
    toPlainObject(await ledgerModel.findOne({ provider: ODDS_SNAPSHOT_PROVIDER }))

  const ensureCurrentPeriods = async (observedAt = now()) => {
    const current = normalizeDate(observedAt, 'observedAt')
    const billingWindow = getUtcBillingWindow(current)
    const dailyKey = getUtcDayKey(current)
    const initial = {
      automaticCreditSpend: 0,
      automaticRequestCount: 0,
      automaticSuccessfulRequestCount: 0,
      billingWindowEndsAt: billingWindow.endsAt,
      billingWindowKey: billingWindow.key,
      billingWindowStartedAt: billingWindow.startedAt,
      controlledProbeRequestCount: 0,
      dailyAutomaticSuccessfulRequestCount: 0,
      dailyKey,
      provider: ODDS_SNAPSHOT_PROVIDER,
      schemaVersion: 1,
      updatedAt: current,
    }
    let document

    try {
      document = toPlainObject(
        await ledgerModel.findOneAndUpdate(
          { provider: ODDS_SNAPSHOT_PROVIDER },
          { $setOnInsert: initial },
          { new: true, setDefaultsOnInsert: true, upsert: true },
        ),
      )
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }

      document = await readProviderLedger()
    }

    if (document?.billingWindowKey !== billingWindow.key) {
      document = toPlainObject(
        await ledgerModel.findOneAndUpdate(
          {
            billingWindowKey: document.billingWindowKey,
            provider: ODDS_SNAPSHOT_PROVIDER,
          },
          {
            $set: {
              automaticCreditSpend: 0,
              automaticRequestCount: 0,
              automaticSuccessfulRequestCount: 0,
              billingWindowEndsAt: billingWindow.endsAt,
              billingWindowKey: billingWindow.key,
              billingWindowStartedAt: billingWindow.startedAt,
              controlledProbeRequestCount: 0,
              dailyAutomaticSuccessfulRequestCount: 0,
              dailyKey,
              lastRequestCost: null,
              observedAt: null,
              remaining: null,
              source: null,
              updatedAt: current,
              used: null,
            },
          },
          { new: true, runValidators: true },
        ),
      )

      if (!document) {
        document = await readProviderLedger()
      }
    }

    if (document?.dailyKey !== dailyKey) {
      document = toPlainObject(
        await ledgerModel.findOneAndUpdate(
          {
            dailyKey: document.dailyKey,
            provider: ODDS_SNAPSHOT_PROVIDER,
          },
          {
            $set: {
              dailyAutomaticSuccessfulRequestCount: 0,
              dailyKey,
              updatedAt: current,
            },
          },
          { new: true, runValidators: true },
        ),
      )

      if (!document) {
        document = await readProviderLedger()
      }
    }

    return document
  }

  const recordProviderRequest = async ({
    observedAt = now(),
    quota = null,
    source,
    successful,
  } = {}) => {
    const normalizedSource = String(source ?? '').trim().toUpperCase()

    if (!QUOTA_LEDGER_SOURCES.includes(normalizedSource)) {
      throw new TypeError('A supported provider request source is required.')
    }

    const requestAt = normalizeDate(observedAt, 'observedAt')
    const ledger = await ensureCurrentPeriods(requestAt)
    const quotaObservedAt = quota?.observedAt
      ? normalizeDate(quota.observedAt, 'quota.observedAt')
      : requestAt
    const lastRequestCost = toNonNegativeNumber(quota?.lastCost)
    const budgetDebit = lastRequestCost ?? 1
    const isAutomatic = normalizedSource !== 'MANUAL'
    const increments = {}

    if (isAutomatic) {
      increments.automaticCreditSpend = budgetDebit
      increments.automaticRequestCount = 1

      if (successful) {
        increments.automaticSuccessfulRequestCount = 1
        increments.dailyAutomaticSuccessfulRequestCount = 1
      }
    }

    if (normalizedSource === 'CONTROLLED_PROBE') {
      increments.controlledProbeRequestCount = 1
    }

    if (Object.keys(increments).length > 0) {
      await ledgerModel.updateOne(
        {
          billingWindowKey: ledger.billingWindowKey,
          dailyKey: ledger.dailyKey,
          provider: ODDS_SNAPSHOT_PROVIDER,
        },
        {
          $inc: increments,
          $max: { updatedAt: requestAt },
        },
        { runValidators: true },
      )
    }

    await ledgerModel.updateOne(
      {
        provider: ODDS_SNAPSHOT_PROVIDER,
        $or: [
          { observedAt: null },
          { observedAt: { $exists: false } },
          { observedAt: { $lte: quotaObservedAt } },
        ],
      },
      {
        $set: {
          lastRequestAt: requestAt,
          lastRequestCost,
          lastRequestStatus: successful ? 'SUCCESS' : 'FAILED',
          observedAt: quotaObservedAt,
          remaining: toNonNegativeNumber(quota?.remaining),
          source: normalizedSource,
          updatedAt: requestAt,
          used: toNonNegativeNumber(quota?.used),
        },
      },
      { runValidators: true },
    )

    return ensureCurrentPeriods(requestAt)
  }

  const getAutomaticPolicy = async ({
    checkpoints = [],
    expectedCreditCost = 1,
    observedAt = now(),
  } = {}) => {
    const ledger = await ensureCurrentPeriods(observedAt)
    const expectedCost = Math.max(0, Number(expectedCreditCost) || 0)
    const automaticCreditSpend = Number(ledger.automaticCreditSpend) || 0
    const dailySuccessCount =
      Number(ledger.dailyAutomaticSuccessfulRequestCount) || 0
    const remaining = toNonNegativeNumber(ledger.remaining)
    const checkpointTypes = (Array.isArray(checkpoints) ? checkpoints : [])
      .map(({ snapshotType }) => String(snapshotType ?? '').toUpperCase())
    const hasNonFinal = checkpointTypes.some((type) => type !== 'FINAL')
    const base = {
      automaticCreditSpend,
      dailyAutomaticSuccessfulRequestCount: dailySuccessCount,
      provider: ODDS_SNAPSHOT_PROVIDER,
      quota: {
        lastCost: toNonNegativeNumber(ledger.lastRequestCost),
        observedAt: ledger.observedAt ?? null,
        remaining,
        used: toNonNegativeNumber(ledger.used),
      },
    }

    if (
      automaticCreditSpend + expectedCost >
      AUTOMATIC_CREDIT_HARD_CEILING
    ) {
      return {
        ...base,
        allowed: false,
        mode: AUTOMATIC_POLICY_MODES.DISABLED,
        reason: 'automatic_credit_ceiling',
      }
    }

    if (dailySuccessCount >= AUTOMATIC_DAILY_SUCCESS_LIMIT) {
      return {
        ...base,
        allowed: false,
        mode: AUTOMATIC_POLICY_MODES.DISABLED,
        reason: 'automatic_daily_limit',
      }
    }

    if (remaining === null) {
      const probeCount = Number(ledger.controlledProbeRequestCount) || 0

      return {
        ...base,
        allowed: probeCount < UNKNOWN_QUOTA_PROBE_LIMIT,
        mode: AUTOMATIC_POLICY_MODES.CONTROLLED_PROBE,
        reason:
          probeCount < UNKNOWN_QUOTA_PROBE_LIMIT
            ? ''
            : 'unknown_quota_probe_used',
        requestSource: 'CONTROLLED_PROBE',
      }
    }

    if (
      remaining <= AUTOMATIC_REMAINING_FLOOR ||
      remaining - expectedCost < AUTOMATIC_REMAINING_FLOOR
    ) {
      return {
        ...base,
        allowed: false,
        mode: AUTOMATIC_POLICY_MODES.DISABLED,
        reason: 'automatic_remaining_floor',
      }
    }

    const finalOnly =
      remaining <= 200 || automaticCreditSpend >= AUTOMATIC_CREDIT_TARGET

    if (finalOnly && hasNonFinal) {
      return {
        ...base,
        allowed: false,
        mode: AUTOMATIC_POLICY_MODES.FINAL_ONLY,
        reason: 'automatic_final_only',
      }
    }

    return {
      ...base,
      allowed: true,
      mode: finalOnly
        ? AUTOMATIC_POLICY_MODES.FINAL_ONLY
        : AUTOMATIC_POLICY_MODES.FULL,
      reason: '',
      requestSource: 'AUTOMATIC',
    }
  }

  return {
    ensureCurrentPeriods,
    getAutomaticPolicy,
    readProviderLedger,
    recordProviderRequest,
  }
}

const oddsQuotaLedgerService = createOddsQuotaLedgerService()

module.exports = {
  AUTOMATIC_CREDIT_HARD_CEILING,
  AUTOMATIC_CREDIT_TARGET,
  AUTOMATIC_DAILY_SUCCESS_LIMIT,
  AUTOMATIC_POLICY_MODES,
  AUTOMATIC_REMAINING_FLOOR,
  UNKNOWN_QUOTA_PROBE_LIMIT,
  createOddsQuotaLedgerService,
  getUtcBillingWindow,
  getUtcDayKey,
  oddsQuotaLedgerService,
  toNonNegativeNumber,
}
