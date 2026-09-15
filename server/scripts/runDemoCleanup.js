require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const {
  demoSandboxCleanupService,
} = require('../services/demoSandboxCleanupService')

const runDemoCleanup = async ({
  cleanupService = demoSandboxCleanupService,
  closeDatabase = () => mongoose.disconnect(),
  connectDatabase = connectDB,
  environment = process.env,
} = {}) => {
  if (!String(environment.MONGODB_URI ?? '').trim()) {
    throw new Error('MONGODB_URI is required for demo sandbox cleanup.')
  }

  let connectionAttempted = false

  try {
    connectionAttempted = true
    await connectDatabase()
    return cleanupService.cleanupExpiredDemoSandboxes()
  } finally {
    if (connectionAttempted) await closeDatabase()
  }
}

if (require.main === module) {
  runDemoCleanup().catch((error) => {
    console.error('Demo sandbox cleanup failed.', {
      name: error.name,
      summary: error.summary,
    })
    process.exitCode = 1
  })
}

module.exports = { runDemoCleanup }
