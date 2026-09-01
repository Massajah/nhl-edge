require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const {
  createConciseBaseParityReport,
  createConciseParityReport,
  runBaseProductionCalibrationParity,
  runCombinedProductionCalibrationValidation,
  runProductionCalibrationParity,
} = require('../diagnostics/calibrationParityVerifier')

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required for production parity verification.')
  }

  await mongoose.connect(process.env.MONGODB_URI)

  try {
    const baseOnly = process.argv.includes('--base-only')
    const combinedOnly = process.argv.includes('--combined-only')
    const report = await (combinedOnly
      ? runCombinedProductionCalibrationValidation
      : baseOnly
        ? runBaseProductionCalibrationParity
        : runProductionCalibrationParity)({
      progress: (stage) => process.stderr.write(`[parity] ${stage}\n`),
    })
    process.stdout.write(
      `${JSON.stringify(
        combinedOnly
          ? report
          : baseOnly
          ? createConciseBaseParityReport(report)
          : createConciseParityReport(report),
      )}\n`,
    )
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
