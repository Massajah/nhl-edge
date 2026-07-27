require('dotenv').config()

const mongoose = require('mongoose')
const {
  migrateLegacyDefaultHomeAdjustments,
} = require('../services/homeAdjustmentMigrationService')

const shouldConfirm = process.argv.includes('--confirm')

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to run the migration.')
  }

  await mongoose.connect(process.env.MONGODB_URI)

  const result = await migrateLegacyDefaultHomeAdjustments({
    confirm: shouldConfirm,
  })

  console.log(
    `PowerRating.${result.field} documents exactly equal to ` +
      `${result.oldDefaultHomeAdvantage}: ${result.matchedCount}`,
  )

  if (!shouldConfirm) {
    console.log('')
    console.log('Dry run only. Re-run with --confirm to migrate them to 0.')
    await mongoose.disconnect()
    return
  }

  console.log(
    `Updated ${result.modifiedCount} documents to ` +
      `${result.newDefaultHomeAdjustment}.`,
  )
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('Home Adjustment migration failed:', error.message)
  await mongoose.disconnect()
  process.exit(1)
})
