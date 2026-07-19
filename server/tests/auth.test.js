process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const app = require('../app')
const Bet = require('../models/Bet')
const User = require('../models/User')
const PowerRating = require('../models/PowerRating')
const googleAuthService = require('../services/googleAuthService')
const authService = require('../services/authService')
const betsService = require('../services/betsService')
const powerRatingsService = require('../services/powerRatingsService')
const { hashPassword } = require('../utils/password')

const queryOf = (value) => ({
  select() {
    return this
  },
  sort(criteria) {
    if (Array.isArray(value) && criteria?.teamName === 1) {
      return queryOf(
        [...value].sort((itemA, itemB) =>
          String(itemA.teamName).localeCompare(String(itemB.teamName)),
        ),
      )
    }

    return this
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
  catch(reject) {
    return Promise.resolve(value).catch(reject)
  },
})

const withPatches = async (patches, callback) => {
  const originals = patches.map(([target, property, replacement]) => {
    const original = target[property]
    target[property] = replacement

    return [target, property, original]
  })

  try {
    return await callback()
  } finally {
    originals.reverse().forEach(([target, property, original]) => {
      target[property] = original
    })
  }
}

const makeUser = (overrides = {}) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    authProvider: 'local',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    email: 'user@example.com',
    googleId: 'google-id',
    name: 'Test User',
    passwordHash: '',
    profileImage: '',
    ...overrides,
  }

  user.toJSON = () => ({
    authProvider: user.authProvider,
    createdAt: user.createdAt,
    email: user.email,
    id: user._id.toString(),
    name: user.name,
    profileImage: user.profileImage,
  })

  return user
}

const createBetPayload = (overrides = {}) => ({
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    teamId: 'TOR',
  },
  homeTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
    teamId: 'BOS',
  },
  marketOdds: 2.1,
  modelProbability: 0.55,
  selectedSide: {
    abbreviation: 'BOS',
    homeAway: 'home',
    name: 'Boston Bruins',
    teamId: 'BOS',
  },
  selectedTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
    teamId: 'BOS',
  },
  ...overrides,
})

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const text = await response.text()

    return {
      body: text ? JSON.parse(text) : null,
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve)
    })
  }
}

test('local registration succeeds, hashes password and initializes ratings', async () => {
  const userId = new mongoose.Types.ObjectId()
  let createdUser = null
  let initializedUserId = null

  await withPatches(
    [
      [User, 'findOne', () => queryOf(null)],
      [
        User,
        'create',
        async (payload) => {
          createdUser = makeUser({
            ...payload,
            _id: userId,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          })

          return createdUser
        },
      ],
      [
        powerRatingsService,
        'initializeDefaultPowerRatings',
        async (id) => {
          initializedUserId = id

          return {
            insertedCount: 32,
            totalTeams: 32,
          }
        },
      ],
    ],
    async () => {
      const result = await authService.registerLocalUser({
        email: ' TEST@Example.COM ',
        name: ' Test User ',
        password: 'password123',
      })

      assert.equal(result.user.email, 'test@example.com')
      assert.equal(result.user.id, userId.toString())
      assert.equal(typeof result.token, 'string')
      assert.equal(initializedUserId, userId)
      assert.notEqual(createdUser.passwordHash, 'password123')
      assert.equal(await bcrypt.compare('password123', createdUser.passwordHash), true)
      assert.equal(Object.hasOwn(result.user, 'passwordHash'), false)
      assert.equal(Object.hasOwn(result.user, 'googleId'), false)
    },
  )
})

test('duplicate registration email is rejected with 409', async () => {
  await withPatches(
    [[User, 'findOne', () => queryOf(makeUser())]],
    async () => {
      await assert.rejects(
        () =>
          authService.registerLocalUser({
            email: 'test@example.com',
            password: 'password123',
          }),
        (error) =>
          error.statusCode === 409 &&
          error.message === 'A user with that email already exists.',
      )
    },
  )
})

test('password hashing never stores the plain-text password', async () => {
  const passwordHash = await hashPassword('password123')

  assert.notEqual(passwordHash, 'password123')
  assert.equal(await bcrypt.compare('password123', passwordHash), true)
})

test('login succeeds with correct credentials', async () => {
  const passwordHash = await bcrypt.hash('password123', 12)

  await withPatches(
    [
      [
        User,
        'findOne',
        () =>
          queryOf(
            makeUser({
              email: 'test@example.com',
              passwordHash,
            }),
          ),
      ],
      [
        powerRatingsService,
        'initializeDefaultPowerRatings',
        async () => ({
          insertedCount: 0,
          totalTeams: 32,
        }),
      ],
    ],
    async () => {
      const result = await authService.loginLocalUser({
        email: 'TEST@example.com',
        password: 'password123',
      })

      assert.equal(result.user.email, 'test@example.com')
      assert.equal(typeof result.token, 'string')
    },
  )
})

test('login fails generically with incorrect credentials', async () => {
  const passwordHash = await bcrypt.hash('password123', 12)

  await withPatches(
    [
      [
        User,
        'findOne',
        () =>
          queryOf(
            makeUser({
              email: 'test@example.com',
              passwordHash,
            }),
          ),
      ],
    ],
    async () => {
      await assert.rejects(
        () =>
          authService.loginLocalUser({
            email: 'test@example.com',
            password: 'wrong-password',
          }),
        (error) =>
          error.statusCode === 401 &&
          error.message === 'Invalid email or password.',
      )
    },
  )
})

test('login fails generically when email is unknown', async () => {
  await withPatches(
    [[User, 'findOne', () => queryOf(null)]],
    async () => {
      await assert.rejects(
        () =>
          authService.loginLocalUser({
            email: 'missing@example.com',
            password: 'password123',
          }),
        (error) =>
          error.statusCode === 401 &&
          error.message === 'Invalid email or password.',
      )
    },
  )
})

test('protected route rejects missing token', async () => {
  const response = await request('/api/bets')

  assert.equal(response.status, 401)
  assert.equal(response.body.message, 'Authentication required.')
})

test('protected route accepts valid token', async () => {
  const token = authService.signAuthToken(new mongoose.Types.ObjectId())

  await withPatches(
    [[Bet, 'find', () => queryOf([])]],
    async () => {
      const response = await request('/api/bets', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      assert.equal(response.status, 200)
      assert.deepEqual(response.body.bets, [])
    },
  )
})

test('/api/auth/me returns safe current-user data', async () => {
  const user = makeUser({
    passwordHash: 'secret-hash',
  })
  const token = authService.signAuthToken(user._id)

  await withPatches(
    [[User, 'findById', () => queryOf(user)]],
    async () => {
      const response = await request('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      assert.equal(response.status, 200)
      assert.equal(response.body.user.id, user._id.toString())
      assert.equal(response.body.user.email, user.email)
      assert.equal(Object.hasOwn(response.body.user, 'passwordHash'), false)
      assert.equal(Object.hasOwn(response.body.user, 'googleId'), false)
    },
  )
})

test('new user receives 32 idempotent Power Ratings', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const ratingsByKey = new Map()

  await withPatches(
    [
      [
        PowerRating,
        'bulkWrite',
        async (operations) => {
          let upsertedCount = 0
          let matchedCount = 0

          operations.forEach((operation) => {
            const { filter, update } = operation.updateOne
            const key = `${filter.userId}:${filter.teamId}`

            if (ratingsByKey.has(key)) {
              matchedCount += 1
              return
            }

            const document = {
              ...update.$setOnInsert,
              _id: new mongoose.Types.ObjectId(),
            }

            document.toJSON = () => ({
              ...document,
              id: document._id.toString(),
              userId: document.userId.toString(),
            })

            ratingsByKey.set(key, document)
            upsertedCount += 1
          })

          return {
            matchedCount,
            modifiedCount: 0,
            upsertedCount,
          }
        },
      ],
      [
        PowerRating,
        'find',
        (filter) =>
          queryOf(
            [...ratingsByKey.values()].filter(
              (rating) => rating.userId.toString() === filter.userId.toString(),
            ),
          ),
      ],
    ],
    async () => {
      const firstInitialization =
        await powerRatingsService.initializeDefaultPowerRatings(userId)
      const secondInitialization =
        await powerRatingsService.initializeDefaultPowerRatings(userId)
      const ratings = await powerRatingsService.getPowerRatings(userId)

      assert.equal(firstInitialization.insertedCount, 32)
      assert.equal(secondInitialization.insertedCount, 0)
      assert.equal(ratings.length, 32)
      assert.equal(ratingsByKey.size, 32)
    },
  )
})

test('one user cannot read another user bet', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const bets = [
    {
      _id: new mongoose.Types.ObjectId(),
      analyzedAt: new Date('2026-01-01T00:00:00.000Z'),
      userId: userA,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      analyzedAt: new Date('2026-01-02T00:00:00.000Z'),
      userId: userB,
    },
  ]

  await withPatches(
    [
      [
        Bet,
        'find',
        (filter) =>
          queryOf(
            bets.filter((bet) => bet.userId.toString() === filter.userId.toString()),
          ),
      ],
    ],
    async () => {
      const userABets = await betsService.getBets(userA)

      assert.equal(userABets.length, 1)
      assert.equal(userABets[0].userId, userA)
    },
  )
})

test('one user cannot update another user bet', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const betId = new mongoose.Types.ObjectId().toString()
  const otherUserBet = {
    _id: betId,
    marketOdds: 2,
    result: 'pending',
    save: async () => otherUserBet,
    stake: 1,
    userId: userB,
  }

  await withPatches(
    [
      [
        Bet,
        'findOne',
        (filter) =>
          queryOf(
            filter._id.toString() === betId &&
              filter.userId.toString() === otherUserBet.userId
              ? otherUserBet
              : null,
          ),
      ],
    ],
    async () => {
      await assert.rejects(
        () => betsService.updateBet(userA, betId, { result: 'win' }),
        (error) => error.statusCode === 404 && error.message === 'Bet was not found.',
      )
      assert.equal(otherUserBet.result, 'pending')
    },
  )
})

test('one user cannot delete another user bet', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const betId = new mongoose.Types.ObjectId().toString()
  let deleted = false

  await withPatches(
    [
      [
        Bet,
        'findOneAndDelete',
        (filter) => {
          const matchesOwner =
            filter._id.toString() === betId && filter.userId.toString() === userB

          if (matchesOwner) {
            deleted = true
          }

          return queryOf(matchesOwner ? { _id: betId, userId: userB } : null)
        },
      ],
    ],
    async () => {
      await assert.rejects(
        () => betsService.deleteBet(userA, betId),
        (error) => error.statusCode === 404 && error.message === 'Bet was not found.',
      )
      assert.equal(deleted, false)
    },
  )
})

test('client-supplied userId is ignored during bet creation', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  let savedBet = null

  await withPatches(
    [
      [
        Bet.prototype,
        'save',
        async function save() {
          savedBet = this

          return this
        },
      ],
    ],
    async () => {
      const bet = await betsService.createBet(userA, {
        ...createBetPayload(),
        userId: userB,
      })

      assert.equal(savedBet.userId.toString(), userA)
      assert.equal(bet.userId, userA)
    },
  )
})

test('Google token verification failure is rejected cleanly', async () => {
  await withPatches(
    [
      [
        googleAuthService,
        'verifyGoogleIdToken',
        async () => {
          throw new googleAuthService.GoogleAuthError(
            'Google authentication failed.',
            401,
          )
        },
      ],
    ],
    async () => {
      await assert.rejects(
        () => authService.authenticateGoogleUser({ credential: 'bad-token' }),
        (error) =>
          error.statusCode === 401 &&
          error.message === 'Google authentication failed.',
      )
    },
  )
})
