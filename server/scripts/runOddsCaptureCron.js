require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const { getMarketOddsConfig } = require('../config/marketOdds')
const {
  scheduledOddsCaptureService,
} = require('../services/scheduledOddsCaptureService')

const runOddsCaptureCron = async ({
  closeDatabase = () => mongoose.disconnect(),
  connectDatabase = connectDB,
  environment = process.env,
  service = scheduledOddsCaptureService,
} = {}) => {
  if (!String(environment.MONGODB_URI ?? '').trim()) {
    throw new Error('MONGODB_URI is required for scheduled odds capture.')
  }

  if (!getMarketOddsConfig(environment).apiKey) {
    throw new Error('THE_ODDS_API_KEY is required for scheduled odds capture.')
  }

  let connectionAttempted = false

  try {
    connectionAttempted = true
    await connectDatabase()
    return await service.runScheduledCapture()
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
