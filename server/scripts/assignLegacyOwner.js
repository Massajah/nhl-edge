require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const {
  runLegacyOwnerMigration,
} = require('../services/legacyOwnerMigrationService')

const getArgument = (name) => {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length).trim() : ''
}

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.')

  const confirm = process.argv.includes('--confirm')
  const email = getArgument('email') || process.env.LEGACY_OWNER_EMAIL
  const googleSubject =
    getArgument('google-subject') || process.env.LEGACY_OWNER_GOOGLE_SUBJECT

  await connectDB()

  try {
    const result = await runLegacyOwnerMigration({
      confirm,
      email,
      googleSubject,
    })

    console.log(JSON.stringify(result, null, 2))
    if (!confirm) {
      console.log('Dry run only. Re-run with the same identities and --confirm after review.')
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch(async (error) => {
  console.error('Legacy owner migration failed:', error.message)
  await mongoose.disconnect()
  process.exitCode = 1
})
