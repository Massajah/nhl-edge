const OddsCaptureRun = require('../models/OddsCaptureRun')
const {
  CAPTURE_RUN_FINAL_STATUSES,
} = require('../models/OddsCaptureRun')

class OddsCaptureRunPersistenceError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'OddsCaptureRunPersistenceError'
    this.statusCode = statusCode
    this.details = details
  }
}

const COMPLETION_COUNT_FIELDS = Object.freeze([
  'providerRequestCount',
  'eventsReceived',
  'gamesConsidered',
  'gamesMatched',
  'snapshotsStored',
  'gamesSkipped',
])
const STALE_STARTED_RUN_THRESHOLD_MS = 30 * 60 * 1000

const createOddsCaptureRunService = ({
  captureRunModel = OddsCaptureRun,
  now = () => new Date(),
} = {}) => {
  const startRun = async ({
    intendedAt,
    runId,
    runKey,
    startedAt = now(),
    triggerSource,
  }) =>
    captureRunModel.create({
      intendedAt,
      runId,
      runKey,
      startedAt,
      status: 'STARTED',
      triggerSource,
    })

  const getRunByKey = async (runKey) => {
    const normalizedRunKey = String(runKey ?? '').trim()

    if (!normalizedRunKey) {
      throw new OddsCaptureRunPersistenceError('runKey is required.', 400)
    }

    return captureRunModel.findOne({ runKey: normalizedRunKey })
  }

  const completeRun = async (runKey, summary = {}) => {
    const normalizedRunKey = String(runKey ?? '').trim()
    const status = String(summary.status ?? '').trim().toUpperCase()

    if (!normalizedRunKey) {
      throw new OddsCaptureRunPersistenceError('runKey is required.', 400)
    }

    if (!CAPTURE_RUN_FINAL_STATUSES.includes(status)) {
      throw new OddsCaptureRunPersistenceError(
        'Run completion requires a supported final status.',
        400,
        { supportedValues: CAPTURE_RUN_FINAL_STATUSES },
      )
    }

    const values = {
      actualCreditCost:
        summary.actualCreditCost === undefined
          ? null
          : summary.actualCreditCost,
      checkpointResults: summary.checkpointResults ?? [],
      completedAt: summary.completedAt ?? now(),
      quotaAfter: summary.quotaAfter ?? null,
      quotaBefore: summary.quotaBefore ?? null,
      reasonCounts: summary.reasonCounts ?? {},
      status,
    }

    COMPLETION_COUNT_FIELDS.forEach((field) => {
      values[field] = summary[field] ?? 0
    })

    const completedRun = await captureRunModel.findOneAndUpdate(
      { runKey: normalizedRunKey, status: 'STARTED' },
      { $set: values },
      { new: true, runValidators: true },
    )

    if (!completedRun) {
      throw new OddsCaptureRunPersistenceError(
        'Capture run was not found or is already complete.',
        409,
        { runKey: normalizedRunKey },
      )
    }

    return completedRun
  }

  const recoverStaleStartedRuns = async ({
    observedAt = now(),
    thresholdMs = STALE_STARTED_RUN_THRESHOLD_MS,
  } = {}) => {
    const recoveryTime = new Date(observedAt)
    const normalizedThresholdMs = Number(thresholdMs)

    if (
      !Number.isFinite(recoveryTime.getTime()) ||
      !Number.isFinite(normalizedThresholdMs) ||
      normalizedThresholdMs < 0
    ) {
      throw new OddsCaptureRunPersistenceError(
        'Stale-run recovery requires a valid time and threshold.',
        400,
      )
    }

    const result = await captureRunModel.updateMany(
      {
        startedAt: {
          $lte: new Date(recoveryTime.getTime() - normalizedThresholdMs),
        },
        status: 'STARTED',
      },
      {
        $set: {
          completedAt: recoveryTime,
          reasonCounts: { stale_started_recovered: 1 },
          recoveredAt: recoveryTime,
          recoveryReason: 'stale_started_recovered',
          status: 'RECOVERED_FAILED',
        },
      },
      { runValidators: true },
    )

    return Number(result?.modifiedCount) || 0
  }

  return {
    completeRun,
    getRunByKey,
    recoverStaleStartedRuns,
    startRun,
  }
}

const oddsCaptureRunService = createOddsCaptureRunService()

module.exports = {
  COMPLETION_COUNT_FIELDS,
  OddsCaptureRunPersistenceError,
  STALE_STARTED_RUN_THRESHOLD_MS,
  createOddsCaptureRunService,
  oddsCaptureRunService,
}
