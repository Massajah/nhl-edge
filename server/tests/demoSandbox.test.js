process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const AuthSession = require('../models/AuthSession')
const Bet = require('../models/Bet')
const User = require('../models/User')
const { ACCOUNT_TYPES } = require('../config/accountTypes')
const { getDemoSandboxTtlMs } = require('../config/demoSandbox')
const authSessionService = require('../services/authSessionService')
const betsService = require('../services/betsService')
const bookmakerPreferencesService = require('../services/bookmakerPreferencesService')
const {
  DEMO_OWNED_DATA_MODELS,
  buildExpiredDemoFilter,
  createDemoSandboxCleanupService,
} = require('../services/demoSandboxCleanupService')
const demoSandboxService = require('../services/demoSandboxService')
const { marketOddsService } = require('../services/marketOddsService')
const { PRIVATE_DATA_MODELS } = require('../services/privateDataModels')

const NOW = new Date('2026-09-14T10:00:00.000Z')

const queryOf = (initialValue) => {
  let value = initialValue

  return {
    lean() {
      return Promise.resolve(value)
    },
    limit(limit) {
      if (Array.isArray(value)) value = value.slice(0, limit)
      return this
    },
    session() {
      return this
    },
    sort(criteria) {
      if (Array.isArray(value) && criteria?.analyzedAt === -1) {
        value = [...value].sort(
          (left, right) =>
            new Date(right.analyzedAt).getTime() -
            new Date(left.analyzedAt).getTime(),
        )
      }
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject)
    },
  }
}

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const body = await response.json()
    return { body, headers: response.headers, status: response.status }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('User account classification defaults historical accounts to NORMAL', async () => {
  const historicalUser = new User({
    authProvider: 'google',
    email: 'historical@example.com',
    googleId: 'historical-google-subject',
  })

  await historicalUser.validate()
  assert.equal(historicalUser.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(historicalUser.expiresAt, null)

  await assert.rejects(
    () =>
      new User({
        accountType: ACCOUNT_TYPES.NORMAL,
        authProvider: 'google',
        email: 'normal@example.com',
        expiresAt: new Date(NOW.getTime() + 1000),
        googleId: 'normal-google-subject',
      }).validate(),
    /Only demo sandbox accounts may have an expiration/,
  )

  await assert.rejects(
    () =>
      new User({
        accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
        authProvider: 'demo',
      }).validate(),
    /Only demo sandbox accounts may have an expiration/,
  )
})

test('concurrent demo creation produces isolated owners with fixed four-hour expiry', async () => {
  const createdPayloads = []
  const initializedOwners = []
  const seededOwners = []
  const ratingsByOwner = new Map()
  const transactionSession = { id: 'demo-create-transaction' }
  const options = {
    environment: {},
    initializePowerRatings: async (userId, { session }) => {
      assert.equal(session, transactionSession)
      initializedOwners.push(String(userId))
      ratingsByOwner.set(String(userId), 46)
    },
    logger: { info() {} },
    now: () => NOW,
    runInTransaction: (work) => work(transactionSession),
    seedDemoSandbox: async (userId, { session }) => {
      assert.equal(session, transactionSession)
      seededOwners.push(String(userId))
    },
    userModel: {
      async create(rows, { session }) {
        assert.equal(session, transactionSession)
        createdPayloads.push(rows[0])
        return [{ ...rows[0], _id: new mongoose.Types.ObjectId() }]
      },
    },
  }

  const [demoA, demoB] = await Promise.all([
    demoSandboxService.createDemoSandbox(options),
    demoSandboxService.createDemoSandbox(options),
  ])

  assert.notEqual(String(demoA.userId), String(demoB.userId))
  assert.equal(createdPayloads.length, 2)
  assert.equal(
    demoA.expiresAt.getTime(),
    NOW.getTime() + getDemoSandboxTtlMs({}),
  )
  assert.equal(demoB.expiresAt.getTime(), demoA.expiresAt.getTime())
  assert.deepEqual(
    createdPayloads.map(({ accountType, authProvider, role, status }) => ({
      accountType,
      authProvider,
      role,
      status,
    })),
    [
      {
        accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
        authProvider: 'demo',
        role: 'user',
        status: 'active',
      },
      {
        accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
        authProvider: 'demo',
        role: 'user',
        status: 'active',
      },
    ],
  )
  assert.equal(createdPayloads.every((payload) => !payload.email), true)
  assert.equal(createdPayloads.every((payload) => !payload.passwordHash), true)
  assert.deepEqual(initializedOwners.sort(), [...ratingsByOwner.keys()].sort())
  assert.deepEqual(seededOwners.sort(), [...ratingsByOwner.keys()].sort())

  ratingsByOwner.set(String(demoA.userId), 51)
  assert.equal(ratingsByOwner.get(String(demoA.userId)), 51)
  assert.equal(ratingsByOwner.get(String(demoB.userId)), 46)
})

test('demo endpoint establishes a capped HttpOnly session without accepting identity fields', async (t) => {
  const userId = new mongoose.Types.ObjectId()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000)
  let storedSession = null

  t.mock.method(demoSandboxService, 'createDemoSandbox', async () => ({
    expiresAt,
    user: {
      _id: userId,
      accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
      authProvider: 'demo',
      createdAt,
      expiresAt,
      lastLoginAt: createdAt,
      name: 'Demo Sandbox',
      role: 'user',
    },
    userId,
  }))
  t.mock.method(AuthSession, 'create', async (payload) => {
    storedSession = payload
    return { _id: new mongoose.Types.ObjectId(), ...payload }
  })

  const response = await request('/api/auth/demo', {
    body: JSON.stringify({
      accountType: ACCOUNT_TYPES.NORMAL,
      userId: new mongoose.Types.ObjectId().toString(),
    }),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    method: 'POST',
  })
  const cookie = response.headers.get('set-cookie')

  assert.equal(response.status, 201)
  assert.equal(response.body.user.id, String(userId))
  assert.equal(response.body.user.accountType, ACCOUNT_TYPES.DEMO_SANDBOX)
  assert.equal(response.body.user.authProvider, 'demo')
  assert.equal(Object.hasOwn(response.body, 'token'), false)
  assert.equal(storedSession.userId, userId)
  assert.equal(storedSession.expiresAt.getTime(), expiresAt.getTime())
  assert.match(cookie, /^nhl_edge_session=/)
  assert.match(cookie, /HttpOnly/i)
})

test('demo market-odds route enforces cache-only mode server-side', async (t) => {
  const userId = new mongoose.Types.ObjectId()
  const token = authSessionService.createTestAuthSession(userId, {
    user: {
      _id: userId,
      accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      role: 'user',
      status: 'active',
    },
  })
  let received = null

  t.mock.method(marketOddsService, 'getNhlMarketOdds', async (options) => {
    received = options
    return {
      availableBookmakers: [],
      date: options.date,
      games: [],
      status: 'not_checked',
    }
  })
  t.mock.method(
    bookmakerPreferencesService,
    'getBookmakerPreferences',
    async () => ({
      preferences: {
        captureParticipation: 'unconfigured',
        enabledBookmakerKeys: [],
        fallbackApplied: false,
        participatesInCapture: false,
        warning: null,
      },
    }),
  )

  const response = await request(
    '/api/market-odds/nhl?date=2026-09-14&refresh=true',
    { headers: { Cookie: `nhl_edge_session=${token}` } },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(received, {
    allowProviderRequest: false,
    date: '2026-09-14',
    refresh: true,
  })
})

test('market-odds provider eligibility treats historical as normal and invalid as closed', async (t) => {
  const received = []
  const historicalToken = authSessionService.createTestAuthSession(
    new mongoose.Types.ObjectId(),
    {
      user: {
        _id: new mongoose.Types.ObjectId(),
        role: 'user',
        status: 'active',
      },
    },
  )
  const invalidToken = authSessionService.createTestAuthSession(
    new mongoose.Types.ObjectId(),
    {
      user: {
        _id: new mongoose.Types.ObjectId(),
        accountType: 'UNEXPECTED',
        role: 'user',
        status: 'active',
      },
    },
  )

  t.mock.method(marketOddsService, 'getNhlMarketOdds', async (options) => {
    received.push(options)
    return {
      availableBookmakers: [],
      date: options.date,
      games: [],
      status: 'not_checked',
    }
  })
  t.mock.method(
    bookmakerPreferencesService,
    'getBookmakerPreferences',
    async () => ({
      preferences: {
        captureParticipation: 'unconfigured',
        enabledBookmakerKeys: [],
        fallbackApplied: false,
        participatesInCapture: false,
        warning: null,
      },
    }),
  )

  const historicalResponse = await request('/api/market-odds/nhl?date=2026-09-14', {
    headers: { Cookie: `nhl_edge_session=${historicalToken}` },
  })
  const invalidResponse = await request('/api/market-odds/nhl?date=2026-09-14', {
    headers: { Cookie: `nhl_edge_session=${invalidToken}` },
  })

  assert.equal(historicalResponse.status, 200)
  assert.equal(invalidResponse.status, 200)
  assert.equal(received[0].allowProviderRequest, true)
  assert.equal(received[1].allowProviderRequest, false)
})

test('demo session lifetime is capped and expiry equality is unauthenticated', async () => {
  const userId = new mongoose.Types.ObjectId()
  let createdSession = null
  const sessionModel = {
    async create(payload) {
      createdSession = { _id: new mongoose.Types.ObjectId(), ...payload }
      return createdSession
    },
  }
  const maxExpiresAt = new Date(NOW.getTime() + 4 * 60 * 60 * 1000)
  const { token } = await authSessionService.createAuthSession(userId, {
    environment: { SESSION_TTL_MS: String(30 * 24 * 60 * 60 * 1000) },
    maxExpiresAt,
    now: NOW,
    sessionModel,
  })
  const storedSession = {
    ...createdSession,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    lastSeenAt: NOW,
    revokedAt: null,
  }

  assert.equal(createdSession.expiresAt.getTime(), maxExpiresAt.getTime())

  const resolveForUser = (user) =>
    authSessionService.resolveAuthSession(token, {
      now: NOW,
      sessionModel: {
        async findOne() {
          return storedSession
        },
      },
      userModel: {
        async findOne() {
          return user
        },
      },
    })

  assert.equal(
    await resolveForUser({
      _id: userId,
      accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
      expiresAt: NOW,
      status: 'active',
    }),
    null,
  )
  assert.equal(
    await resolveForUser({
      _id: userId,
      accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
      expiresAt: new Date(NOW.getTime() - 1),
      status: 'active',
    }),
    null,
  )
  assert.ok(
    await resolveForUser({
      _id: userId,
      accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
      expiresAt: new Date(NOW.getTime() + 1),
      status: 'active',
    }),
  )
  assert.ok(await resolveForUser({ _id: userId, status: 'active' }))
  assert.ok(
    await resolveForUser({
      _id: userId,
      accountType: ACCOUNT_TYPES.NORMAL,
      status: 'active',
    }),
  )
  assert.equal(
    await resolveForUser({
      _id: userId,
      accountType: 'UNRECOGNIZED',
      status: 'active',
    }),
    null,
  )
})

test('cleanup inventory exactly covers every persistent private data model', () => {
  assert.deepEqual(
    Object.values(DEMO_OWNED_DATA_MODELS)
      .map(({ modelName }) => modelName)
      .sort(),
    PRIVATE_DATA_MODELS.map(({ modelName }) => modelName).sort(),
  )
})

test('cleanup removes only an expired demo owner and is idempotent', async () => {
  const historicalId = new mongoose.Types.ObjectId()
  const normalId = new mongoose.Types.ObjectId()
  const invalidId = new mongoose.Types.ObjectId()
  const expiredDemoId = new mongoose.Types.ObjectId()
  const activeDemoId = new mongoose.Types.ObjectId()
  const users = new Map([
    [
      String(historicalId),
      {
        _id: historicalId,
        expiresAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
    ],
    [
      String(normalId),
      {
        _id: normalId,
        accountType: ACCOUNT_TYPES.NORMAL,
        expiresAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
    ],
    [
      String(invalidId),
      {
        _id: invalidId,
        accountType: 'UNEXPECTED',
        expiresAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
    ],
    [
      String(expiredDemoId),
      {
        _id: expiredDemoId,
        accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
        expiresAt: NOW,
      },
    ],
    [
      String(activeDemoId),
      {
        _id: activeDemoId,
        accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
        expiresAt: new Date(NOW.getTime() + 1),
      },
    ],
  ])
  const findFilters = []
  const userDeleteFilters = []
  const matchesExpiredDemo = (user, filter) =>
    user?.accountType === filter.accountType &&
    user.expiresAt.getTime() <= filter.expiresAt.$lte.getTime()
  const userModel = {
    deleteOne(filter) {
      userDeleteFilters.push(filter)
      const user = users.get(String(filter._id))

      if (!matchesExpiredDemo(user, filter)) return { deletedCount: 0 }
      users.delete(String(filter._id))
      return { deletedCount: 1 }
    },
    find(filter) {
      findFilters.push(filter)
      return queryOf(
        [...users.values()].filter((user) => matchesExpiredDemo(user, filter)),
      )
    },
    findOne(filter) {
      const user = users.get(String(filter._id))
      return queryOf(matchesExpiredDemo(user, filter) ? user : null)
    },
  }
  const createOwnedModel = () => {
    const records = [
      { userId: historicalId },
      { userId: normalId },
      { userId: invalidId },
      { userId: expiredDemoId },
      { userId: activeDemoId },
    ]
    const deleteFilters = []

    return {
      deleteFilters,
      model: {
        deleteMany(filter) {
          deleteFilters.push(filter)
          const before = records.length

          for (let index = records.length - 1; index >= 0; index -= 1) {
            if (String(records[index].userId) === String(filter.userId)) {
              records.splice(index, 1)
            }
          }

          return { deletedCount: before - records.length }
        },
      },
      records,
    }
  }
  const bets = createOwnedModel()
  const ratings = createOwnedModel()
  const sessions = createOwnedModel()
  const service = createDemoSandboxCleanupService({
    authSessionModel: sessions.model,
    environment: {},
    logger: { info() {}, warn() {} },
    now: () => NOW,
    ownedDataModels: {
      bets: bets.model,
      powerRatings: ratings.model,
    },
    runInTransaction: (work) => work({ id: 'cleanup-transaction' }),
    userModel,
  })

  const first = await service.cleanupExpiredDemoSandboxes()
  const second = await service.cleanupExpiredDemoSandboxes()

  assert.deepEqual(first, { expiredAccounts: 1, failures: 0, removed: 1 })
  assert.deepEqual(second, { expiredAccounts: 0, failures: 0, removed: 0 })
  assert.equal(users.has(String(expiredDemoId)), false)
  assert.equal(users.has(String(activeDemoId)), true)
  assert.equal(users.has(String(historicalId)), true)
  assert.equal(users.has(String(normalId)), true)
  assert.equal(users.has(String(invalidId)), true)

  for (const store of [bets, ratings, sessions]) {
    assert.deepEqual(
      store.records.map(({ userId }) => String(userId)).sort(),
      [
        String(activeDemoId),
        String(historicalId),
        String(invalidId),
        String(normalId),
      ].sort(),
    )
    assert.deepEqual(store.deleteFilters, [{ userId: expiredDemoId }])
  }

  assert.deepEqual(findFilters[0], buildExpiredDemoFilter(NOW))
  assert.equal(userDeleteFilters.length, 1)
  assert.equal(
    userDeleteFilters[0].accountType,
    ACCOUNT_TYPES.DEMO_SANDBOX,
  )
  assert.equal(
    userDeleteFilters[0].expiresAt.$lte.getTime(),
    NOW.getTime(),
  )
})

test('normal user, demo A and demo B retain strict bet isolation', async (t) => {
  const normalId = new mongoose.Types.ObjectId()
  const demoAId = new mongoose.Types.ObjectId()
  const demoBId = new mongoose.Types.ObjectId()
  const makeBet = (userId, analyzedAt) => {
    const bet = {
      _id: new mongoose.Types.ObjectId(),
      analyzedAt,
      marketOdds: 2,
      notes: '',
      result: 'pending',
      stake: 1,
      userId,
    }
    bet.save = async () => bet
    return bet
  }
  const records = [
    makeBet(normalId, '2026-09-14T08:00:00.000Z'),
    makeBet(demoAId, '2026-09-14T09:00:00.000Z'),
    makeBet(demoBId, '2026-09-14T10:00:00.000Z'),
  ]

  t.mock.method(Bet, 'find', ({ userId }) =>
    queryOf(
      records.filter((record) => String(record.userId) === String(userId)),
    ),
  )
  t.mock.method(Bet, 'findOne', ({ _id, userId }) =>
    queryOf(
      records.find(
        (record) =>
          String(record._id) === String(_id) &&
          String(record.userId) === String(userId),
      ) ?? null,
    ),
  )

  const demoABets = await betsService.getBets(demoAId)
  const demoBBets = await betsService.getBets(demoBId)
  const normalBets = await betsService.getBets(normalId)

  assert.deepEqual(demoABets.map(({ userId }) => String(userId)), [String(demoAId)])
  assert.deepEqual(demoBBets.map(({ userId }) => String(userId)), [String(demoBId)])
  assert.deepEqual(normalBets.map(({ userId }) => String(userId)), [String(normalId)])
  await assert.rejects(
    () => betsService.updateBet(demoAId, records[2]._id, { notes: 'blocked' }),
    /Bet was not found/,
  )
  await assert.rejects(
    () => betsService.updateBet(demoAId, records[0]._id, { notes: 'blocked' }),
    /Bet was not found/,
  )
  await betsService.updateBet(demoAId, records[1]._id, { notes: 'demo A only' })

  assert.equal(records[0].notes, '')
  assert.equal(records[1].notes, 'demo A only')
  assert.equal(records[2].notes, '')
})
