require('dotenv').config()

const mongoose = require('mongoose')
const {
  applySeasonStartingRatingRepair,
  previewSeasonStartingRatingRepair,
} = require('../services/startingRatingRecoveryService')

const getArgValue = (name) => {
  const prefix = `${name}=`
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required for Starting Rating recovery.')
  }
  const userId = getArgValue('--userId')
  const seasonId = getArgValue('--seasonId')
  const confirm = process.argv.includes('--confirm')
  if (!userId || !seasonId) {
    throw new Error('--userId and --seasonId are required.')
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    autoCreate: false,
    autoIndex: false,
  })
  try {
    const result = confirm
      ? await applySeasonStartingRatingRepair({ userId, seasonId, confirm })
      : await previewSeasonStartingRatingRepair({ userId, seasonId })
    console.log(`Season ${result.seasonId}: ${result.reviewedRatings} ratings reviewed; ${result.candidates.length} recoverable differences; ${result.withoutHistory} teams without a processed game; ${result.outsideTargetSeason} ratings belonging to another season.`)
    for (const row of result.candidates) {
      console.log(`${row.teamId}: ${row.storedRating ?? 'missing'} -> ${row.recoveredRating} from game ${row.firstGameId}`)
    }
    console.log(confirm
      ? `${result.repairedCount} Starting Ratings repaired.`
      : 'Preview only. Add --confirm with the same owner and season to repair these values.')
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Starting Rating recovery failed:', error.message)
    process.exitCode = 1
  })
}

module.exports = { main }
