const mongoose = require('mongoose')
const User = require('../models/User')
const { ACCOUNT_TYPES } = require('../config/accountTypes')
const { getDemoSandboxTtlMs } = require('../config/demoSandbox')
const powerRatingsService = require('./powerRatingsService')
const demoSandboxSeedService = require('./demoSandboxSeedService')

const normalizeDate = (value, field) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const runWithTransaction = async (work, options = {}) => {
  if (options.runInTransaction) return options.runInTransaction(work)
  return mongoose.connection.transaction((session) => work(session))
}

const createDemoSandbox = async (options = {}) => {
  const environment = options.environment ?? process.env
  const userModel = options.userModel ?? User
  const initializePowerRatings =
    options.initializePowerRatings ??
    powerRatingsService.initializeDefaultPowerRatings
  const seedDemoSandbox =
    options.seedDemoSandbox ?? demoSandboxSeedService.seedDemoSandbox
  const logger = options.logger ?? console
  const createdAt = normalizeDate(
    (options.now ?? (() => new Date()))(),
    'clock',
  )
  const expiresAt = new Date(
    createdAt.getTime() + getDemoSandboxTtlMs(environment),
  )

  const result = await runWithTransaction(async (session) => {
    const created = await userModel.create(
      [
        {
          accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
          authProvider: 'demo',
          expiresAt,
          lastLoginAt: createdAt,
          name: 'Demo Sandbox',
          role: 'user',
          status: 'active',
        },
      ],
      { session },
    )
    const user = Array.isArray(created) ? created[0] : created

    if (!user?._id) {
      throw new Error('Unable to create a demo sandbox identity.')
    }

    await initializePowerRatings(user._id, { session })
    await seedDemoSandbox(user._id, { session })

    return { user, userId: user._id }
  }, options)

  logger.info?.('Demo sandbox created.', {
    expiresAt: expiresAt.toISOString(),
  })

  return { ...result, expiresAt }
}

module.exports = { createDemoSandbox }
