process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const User = require('../models/User')
const {
  ACCOUNT_TYPES,
  getAccountType,
  getProductionAccountFilter,
  isDemoSandboxAccount,
  isProductionAccount,
} = require('../config/accountTypes')
const {
  buildExpiredDemoFilter,
} = require('../services/demoSandboxCleanupService')
const authService = require('../services/authService')

const NOW = new Date('2026-09-15T06:00:00.000Z')

test('account classification covers historical, normal, demo and invalid states', () => {
  const matrix = [
    {
      account: {},
      demo: false,
      production: true,
      resolved: ACCOUNT_TYPES.NORMAL,
    },
    {
      account: { accountType: ACCOUNT_TYPES.NORMAL },
      demo: false,
      production: true,
      resolved: ACCOUNT_TYPES.NORMAL,
    },
    {
      account: { accountType: ACCOUNT_TYPES.DEMO_SANDBOX },
      demo: true,
      production: false,
      resolved: ACCOUNT_TYPES.DEMO_SANDBOX,
    },
    {
      account: { accountType: 'UNEXPECTED' },
      demo: false,
      production: false,
      resolved: null,
    },
  ]

  matrix.forEach(({ account, demo, production, resolved }) => {
    assert.equal(getAccountType(account), resolved)
    assert.equal(isDemoSandboxAccount(account), demo)
    assert.equal(isProductionAccount(account), production)
  })
})

test('new normal users default to NORMAL and new demos remain explicit', async () => {
  const normal = new User({
    authProvider: 'google',
    email: 'new-normal@example.com',
    googleId: 'new-normal-subject',
  })
  const demo = new User({
    accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
    authProvider: 'demo',
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
  })

  await Promise.all([normal.validate(), demo.validate()])

  assert.equal(normal.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(demo.accountType, ACCOUNT_TYPES.DEMO_SANDBOX)
})

test('historical User save materializes NORMAL without weakening immutability', async (t) => {
  const userId = new mongoose.Types.ObjectId()
  let update = null

  t.mock.method(User.collection, 'updateOne', async (_filter, nextUpdate) => {
    update = nextUpdate
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
  })

  const historical = User.hydrate({
    _id: userId,
    authProvider: 'google',
    email: 'historical-save@example.com',
    googleId: 'historical-save-subject',
    role: 'user',
    status: 'active',
  })

  assert.equal(historical.accountType, undefined)
  historical.lastLoginAt = NOW
  await historical.save()

  assert.equal(historical.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(update.$set.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(new Date(update.$set.lastLoginAt).getTime(), NOW.getTime())

  historical.accountType = ACCOUNT_TYPES.DEMO_SANDBOX
  assert.equal(historical.accountType, ACCOUNT_TYPES.NORMAL)
})

test('projected-out accountType is not synthesized and invalid values fail closed', async () => {
  const projected = User.hydrate(
    {
      _id: new mongoose.Types.ObjectId(),
      authProvider: 'google',
      email: 'projected@example.com',
      googleId: 'projected-subject',
    },
    { accountType: 0 },
  )
  const invalid = User.hydrate({
    _id: new mongoose.Types.ObjectId(),
    accountType: 'UNEXPECTED',
    authProvider: 'google',
    email: 'invalid@example.com',
    googleId: 'invalid-subject',
  })

  await projected.validate()
  assert.equal(projected.accountType, undefined)
  await assert.rejects(() => invalid.validate(), /not a valid enum value/)
  assert.equal(isProductionAccount(invalid), false)
  assert.equal(isDemoSandboxAccount(invalid), false)
  assert.throws(
    () => authService.serializeUser(invalid),
    (error) => error.statusCode === 401 && error.message === 'Authentication required.',
  )
})

test('production and cleanup database filters preserve opposite safety defaults', () => {
  const productionFilter = getProductionAccountFilter()
  const cleanupFilter = buildExpiredDemoFilter(NOW)

  assert.deepEqual(productionFilter, {
    $or: [
      { accountType: ACCOUNT_TYPES.NORMAL },
      { accountType: { $exists: false } },
      { accountType: null },
      { accountType: '' },
    ],
  })
  assert.deepEqual(cleanupFilter, {
    accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
    expiresAt: { $lte: NOW },
  })
})

test('direct updates preserve historical documents and upserts default to NORMAL', async (t) => {
  const updates = []
  const findOneAndUpdates = []

  t.mock.method(User.collection, 'updateOne', async (_filter, update) => {
    updates.push(update)
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
  })
  t.mock.method(
    User.collection,
    'findOneAndUpdate',
    async (_filter, update) => {
      findOneAndUpdates.push(update)
      return null
    },
  )

  await User.updateOne(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { lastLoginAt: NOW } },
    { runValidators: true },
  )
  await User.updateOne(
    { googleId: 'upserted-normal-subject' },
    {
      $set: {
        authProvider: 'google',
        email: 'upserted-normal@example.com',
      },
    },
    { runValidators: true, upsert: true },
  )
  await User.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { lastLoginAt: NOW } },
    { runValidators: true },
  )

  assert.equal(Object.hasOwn(updates[0].$set, 'accountType'), false)
  assert.equal(
    updates[1].$setOnInsert.accountType,
    ACCOUNT_TYPES.NORMAL,
  )
  assert.equal(
    Object.hasOwn(findOneAndUpdates[0].$set, 'accountType'),
    false,
  )
})
