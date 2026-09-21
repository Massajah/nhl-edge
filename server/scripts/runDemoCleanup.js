require('../instrument')

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const {
  demoSandboxCleanupService,
} = require('../services/demoSandboxCleanupService')
const { captureExceptionAndFlush } = require('../monitoring/sentry')

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

const handleDemoCleanupFailure = async (
  error,
  { captureAndFlush = captureExceptionAndFlush } = {},
) => {
  console.error('Demo sandbox cleanup failed.', {
    name: error.name,
    summary: error.summary,
  })
  try {
    await captureAndFlush(error)
  } finally {
    process.exitCode = 1
  }
}

if (require.main === module) {
  runDemoCleanup().catch(handleDemoCleanupFailure)
}

module.exports = { handleDemoCleanupFailure, runDemoCleanup }
