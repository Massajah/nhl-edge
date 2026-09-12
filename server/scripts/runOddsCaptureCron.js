require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const { getMarketOddsConfig } = require('../config/marketOdds')
const {
  scheduledOddsCaptureService,
} = require('../services/scheduledOddsCaptureService')
const { scheduledForwardPredictionService } = require('../services/scheduledForwardPredictionService')

const runOddsCaptureCron = async ({
  closeDatabase = () => mongoose.disconnect(),
  connectDatabase = connectDB,
  environment = process.env,
  service = scheduledOddsCaptureService,
  predictionService = scheduledForwardPredictionService,
} = {}) => {
  if (!String(environment.MONGODB_URI ?? '').trim()) {
    throw new Error('MONGODB_URI is required for scheduled odds capture.')
  }

  let connectionAttempted = false

  try {
    connectionAttempted = true
    await connectDatabase()
    // Independent one-shot jobs: neither quota nor an odds-provider failure can suppress predictions.
    const results = await Promise.allSettled([
      predictionService.runScheduledCapture(),
      getMarketOddsConfig(environment).apiKey
        ? service.runScheduledCapture()
        : Promise.resolve({ outcome: 'ODDS_NOT_CONFIGURED' }),
    ])
    const failures = results.filter(({ status }) => status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason), 'Scheduled capture failed.')
    return { ...results[1].value, forwardPredictions: results[0].value }
  } finally {
    if (connectionAttempted) {
      await closeDatabase()
    }
  }
}

if (require.main === module) {
  runOddsCaptureCron().catch((error) => {
    console.error('Odds capture cron failed.', {
      name: error.name,
    })
    process.exitCode = 1
  })
}

module.exports = { runOddsCaptureCron }
