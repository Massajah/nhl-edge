require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const {
  runProductionCalibrationRobustnessValidation,
} = require('../diagnostics/calibrationParityVerifier')

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is required for production robustness verification.',
    )
  }

  await mongoose.connect(process.env.MONGODB_URI)

  try {
    const report = await runProductionCalibrationRobustnessValidation({
      progress: (stage) => process.stderr.write(`[robustness] ${stage}\n`),
    })

    process.stdout.write(`${JSON.stringify(report)}\n`)
  } finally {
    await mongoose.disconnect()
  }
}

run().catch(async (error) => {
  process.stderr.write(`${error.stack ?? `${error.name}: ${error.message}`}\n`)
  try {
    await mongoose.disconnect()
  } catch {
    // Preserve the original verification error.
  }
  process.exitCode = 1
})
