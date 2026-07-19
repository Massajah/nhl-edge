require('dotenv').config()

const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const Injury = require('../models/Injury')
const PowerRating = require('../models/PowerRating')

const shouldConfirm = process.argv.includes('--confirm')
const preAuthFilter = {
  $or: [{ userId: { $exists: false } }, { userId: null }],
}

const collections = [
  {
    label: 'bets',
    model: Bet,
  },
  {
    label: 'injuries',
    model: Injury,
  },
  {
    label: 'powerratings',
    model: PowerRating,
  },
]

const isExactKey = (actualKey, expectedKey) => {
  const actualEntries = Object.entries(actualKey ?? {})
  const expectedEntries = Object.entries(expectedKey)

  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([field, order]) => actualKey[field] === order)
  )
}

const findLegacyPowerRatingIndexes = async () => {
  const indexes = await PowerRating.collection.indexes()

  return indexes.filter(
    (index) =>
      index.unique &&
      (isExactKey(index.key, { teamId: 1 }) ||
        isExactKey(index.key, { abbreviation: 1 })),
  )
}

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to run cleanup.')
  }

  await mongoose.connect(process.env.MONGODB_URI)

  const counts = await Promise.all(
    collections.map(async (collection) => ({
      ...collection,
      count: await collection.model.countDocuments(preAuthFilter),
    })),
  )
  const legacyIndexes = await findLegacyPowerRatingIndexes()

  console.log('Pre-auth user-specific documents that would be removed:')
  counts.forEach((collection) => {
    console.log(`- ${collection.label}: ${collection.count}`)
  })

  if (legacyIndexes.length > 0) {
    console.log('Legacy global PowerRating unique indexes that would be removed:')
    legacyIndexes.forEach((index) => {
      console.log(`- ${index.name}`)
    })
  }

  if (!shouldConfirm) {
    console.log('')
    console.log('Dry run only. Re-run with --confirm to delete these documents.')
    await mongoose.disconnect()
    return
  }

  for (const collection of counts) {
    const result = await collection.model.deleteMany(preAuthFilter)
    console.log(`Deleted ${result.deletedCount} from ${collection.label}.`)
  }

  for (const index of legacyIndexes) {
    await PowerRating.collection.dropIndex(index.name)
    console.log(`Dropped legacy PowerRating index ${index.name}.`)
  }

  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('Cleanup failed:', error.message)
  await mongoose.disconnect()
  process.exit(1)
})
