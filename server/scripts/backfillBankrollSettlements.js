require('dotenv').config()

const mongoose = require('mongoose')
const {
  backfillBankrollSettlements,
} = require('../services/bankrollService')

const getArgValue = (name) => {
  const prefix = `${name}=`
  const matchingArg = process.argv.find((arg) => arg.startsWith(prefix))

  return matchingArg ? matchingArg.slice(prefix.length) : ''
}

const shouldConfirm = process.argv.includes('--confirm')
const shouldBackfillAllUsers = process.argv.includes('--all')
const userId = getArgValue('--userId')

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to run the bankroll backfill.')
  }

  await mongoose.connect(process.env.MONGODB_URI)

  const result = await backfillBankrollSettlements({
    allUsers: shouldBackfillAllUsers,
    confirm: shouldConfirm,
    userId,
  })

  console.log('Bankroll settlement backfill:')
  console.log(`- profiles processed: ${result.profilesProcessed}`)
  console.log(`- eligible settled bets: ${result.matchedBets}`)
  console.log(`- settlement transactions written: ${result.settlementsWritten}`)

  if (!shouldConfirm) {
    console.log('')
    console.log(
      'Dry run only. Re-run with --confirm and the same --userId or --all scope to write transactions.',
    )
  }

  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('Bankroll backfill failed:', error.message)
  await mongoose.disconnect()
  process.exit(1)
})
