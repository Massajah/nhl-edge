require('../instrument')

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const { getMarketOddsConfig } = require('../config/marketOdds')
const {
  scheduledOddsCaptureService,
} = require('../services/scheduledOddsCaptureService')
const { scheduledForwardPredictionService } = require('../services/scheduledForwardPredictionService')
const { scheduledBetSettlementService } = require('../services/scheduledBetSettlementService')
const {
  demoSandboxCleanupService,
} = require('../services/demoSandboxCleanupService')
const { captureExceptionAndFlush } = require('../monitoring/sentry')

const runOddsCaptureCron = async ({
  closeDatabase = () => mongoose.disconnect(),
  connectDatabase = connectDB,
  environment = process.env,
  service = scheduledOddsCaptureService,
  predictionService = scheduledForwardPredictionService,
  settlementService = scheduledBetSettlementService,
  cleanupService = demoSandboxCleanupService,
} = {}) => {
  if (!String(environment.MONGODB_URI ?? '').trim()) {
    throw new Error('MONGODB_URI is required for scheduled odds capture.')
  }

  let connectionAttempted = false

  try {
    connectionAttempted = true
    await connectDatabase()
    // Defer each invocation so synchronous and asynchronous failures remain
    // isolated from the other jobs in this cron tick.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => predictionService.runScheduledCapture()),
      getMarketOddsConfig(environment).apiKey
        ? Promise.resolve().then(() => service.runScheduledCapture())
        : Promise.resolve({ outcome: 'ODDS_NOT_CONFIGURED' }),
      Promise.resolve().then(() => settlementService.runScheduledSettlement()),
      Promise.resolve().then(() => cleanupService.cleanupExpiredDemoSandboxes()),
    ])
    const failures = results.filter(({ status }) => status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason), 'Scheduled cron failed.')
    return {
      ...results[1].value,
      betSettlement: results[2].value,
      demoCleanup: results[3].value,
      forwardPredictions: results[0].value,
    }
  } finally {
    if (connectionAttempted) {
      await closeDatabase()
    }
  }
}

const handleOddsCaptureCronFailure = async (
  error,
  { captureAndFlush = captureExceptionAndFlush } = {},
) => {
  console.error('Scheduled cron failed.', {
    name: error.name,
  })
  try {
    await captureAndFlush(error)
  } finally {
    process.exitCode = 1
  }
}

if (require.main === module) {
  runOddsCaptureCron().catch(handleOddsCaptureCronFailure)
}

module.exports = { handleOddsCaptureCronFailure, runOddsCaptureCron }
