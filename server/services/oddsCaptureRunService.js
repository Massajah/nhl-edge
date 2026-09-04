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

  return { completeRun, getRunByKey, startRun }
}

const oddsCaptureRunService = createOddsCaptureRunService()

module.exports = {
  COMPLETION_COUNT_FIELDS,
  OddsCaptureRunPersistenceError,
  createOddsCaptureRunService,
  oddsCaptureRunService,
}
