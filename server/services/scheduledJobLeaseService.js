const crypto = require('node:crypto')
const ScheduledJobLease = require('../models/ScheduledJobLease')

const CRON_SLOT_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_LEASE_DURATION_MS = 15 * 60 * 1000

const normalizeDate = (value, field) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const normalizeIdentity = (value, field) => {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    throw new TypeError(`${field} is required.`)
  }

  return normalized
}

const toPlainObject = (document) => {
  if (!document) {
    return null
  }

  return typeof document.toObject === 'function'
    ? document.toObject({ versionKey: false })
    : document
}

const getCronSlot = (value, intervalMs = CRON_SLOT_INTERVAL_MS) => {
  const date = normalizeDate(value, 'observedAt')
  const normalizedIntervalMs = Number(intervalMs)

  if (!Number.isFinite(normalizedIntervalMs) || normalizedIntervalMs <= 0) {
    throw new TypeError('Cron slot interval must be positive.')
  }

  return new Date(
    Math.floor(date.getTime() / normalizedIntervalMs) * normalizedIntervalMs,
  )
}

const buildScheduledJobSlotKey = (jobName, intendedAt) =>
  `${normalizeIdentity(jobName, 'jobName')}:${normalizeDate(
    intendedAt,
    'intendedAt',
  ).toISOString()}`

const createScheduledJobLeaseService = ({
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
  leaseModel = ScheduledJobLease,
  now = () => new Date(),
  tokenFactory = () => crypto.randomUUID(),
} = {}) => {
  const acquireLease = async ({ jobName, intendedAt, observedAt = now() }) => {
    const normalizedJobName = normalizeIdentity(jobName, 'jobName')
    const normalizedIntendedAt = normalizeDate(intendedAt, 'intendedAt')
    const acquiredAt = normalizeDate(observedAt, 'observedAt')
    const normalizedLeaseDurationMs = Number(leaseDurationMs)

    if (
      !Number.isFinite(normalizedLeaseDurationMs) ||
      normalizedLeaseDurationMs <= 0
    ) {
      throw new TypeError('Lease duration must be positive.')
    }

    const slotKey = buildScheduledJobSlotKey(
      normalizedJobName,
      normalizedIntendedAt,
    )
    const leaseToken = normalizeIdentity(tokenFactory(), 'leaseToken')
    const runningValues = {
      acquiredAt,
      completedAt: null,
      expiresAt: new Date(acquiredAt.getTime() + normalizedLeaseDurationMs),
      leaseToken,
      outcome: '',
      status: 'RUNNING',
    }
    const initial = {
      ...runningValues,
      attemptCount: 1,
      intendedAt: normalizedIntendedAt,
      jobName: normalizedJobName,
      slotKey,
    }
    let document

    try {
      document = toPlainObject(
        await leaseModel.findOneAndUpdate(
          { slotKey },
          { $setOnInsert: initial },
          { new: true, setDefaultsOnInsert: true, upsert: true },
        ),
      )
    } catch (error) {
      if (Number(error?.code) !== 11000) {
        throw error
      }

      document = toPlainObject(await leaseModel.findOne({ slotKey }))
    }

    if (document?.leaseToken === leaseToken) {
      return { acquired: true, lease: document, recovered: false }
    }

    const recovered = toPlainObject(
      await leaseModel.findOneAndUpdate(
        {
          slotKey,
          $or: [
            { status: 'FAILED' },
            { expiresAt: { $lte: acquiredAt }, status: 'RUNNING' },
          ],
        },
        {
          $inc: { attemptCount: 1 },
          $set: runningValues,
        },
        { new: true, runValidators: true },
      ),
    )

    return recovered
      ? { acquired: true, lease: recovered, recovered: true }
      : { acquired: false, lease: document, recovered: false }
  }

  const finishLease = async (
    slotKey,
    leaseToken,
    { completedAt = now(), outcome = '', status = 'COMPLETED' } = {},
  ) => {
    const normalizedStatus = String(status ?? '').trim().toUpperCase()

    if (!['COMPLETED', 'FAILED'].includes(normalizedStatus)) {
      throw new TypeError('Lease completion status must be terminal.')
    }

    const completed = toPlainObject(
      await leaseModel.findOneAndUpdate(
        {
          leaseToken: normalizeIdentity(leaseToken, 'leaseToken'),
          slotKey: normalizeIdentity(slotKey, 'slotKey'),
          status: 'RUNNING',
        },
        {
          $set: {
            completedAt: normalizeDate(completedAt, 'completedAt'),
            outcome: String(outcome ?? '').trim().slice(0, 100),
            status: normalizedStatus,
          },
        },
        { new: true, runValidators: true },
      ),
    )

    if (!completed) {
      throw new Error('Lease is no longer owned by this execution.')
    }

    return completed
  }

  return { acquireLease, finishLease }
}

const scheduledJobLeaseService = createScheduledJobLeaseService()

module.exports = {
  CRON_SLOT_INTERVAL_MS,
  DEFAULT_LEASE_DURATION_MS,
  buildScheduledJobSlotKey,
  createScheduledJobLeaseService,
  getCronSlot,
  scheduledJobLeaseService,
}
