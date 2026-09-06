require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const connectDB = require('../config/db')
const User = require('../models/User')
const {
  resolveIntendedOwner,
} = require('../services/legacyOwnerMigrationService')

const getArgument = (name) => {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length).trim() : ''
}

const main = async () => {
  const email = getArgument('email')
  const googleSubject = getArgument('google-subject')
  const role = getArgument('role') || 'admin'
  const confirm = process.argv.includes('--confirm')

  if (!['user', 'admin'].includes(role)) throw new Error('role must be user or admin.')
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.')

  await connectDB()

  try {
    const owner = await resolveIntendedOwner({ email, googleSubject })
    const summary = {
      confirm,
      email: owner.email,
      googleSubject: owner.googleSubject,
      nextRole: role,
      previousRole: owner.user.role ?? 'user',
      userId: String(owner.user._id),
    }

    console.log(JSON.stringify(summary, null, 2))
    if (!confirm) {
      console.log('Dry run only. Add --confirm to update this exact User.')
      return
    }

    await User.updateOne({ _id: owner.user._id }, { $set: { role } })
    console.log('User role updated.')
  } finally {
    await mongoose.disconnect()
  }
}

main().catch(async (error) => {
  console.error('User role update failed:', error.message)
  await mongoose.disconnect()
  process.exitCode = 1
})
