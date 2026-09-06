process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const AuthSession = require('../models/AuthSession')
const { getSessionTtlMs } = require('../config/auth')
const {
  clearSessionCookie,
  createAuthSession,
  getSessionTokenFromRequest,
  hashSessionToken,
  resolveAuthSession,
  revokeAuthSession,
  setSessionCookie,
} = require('../services/authSessionService')

const USER_ID = new mongoose.Types.ObjectId()
const NOW = new Date('2026-09-06T12:00:00.000Z')

test('AuthSession stores a unique hash and has an absolute TTL index', () => {
  const indexes = AuthSession.schema.indexes()

  assert.equal(AuthSession.schema.path('tokenHash').options.select, false)
  assert.equal(AuthSession.schema.path('tokenHash').options.unique, true)
  assert.equal(AuthSession.schema.path('userId').options.ref, 'User')
  assert.equal(
    indexes.some(
      ([key, options]) => key.expiresAt === 1 && options.expireAfterSeconds === 0,
    ),
    true,
  )
})

test('session creation stores only a hash and defaults to 30 days', async () => {
  let stored = null
  const result = await createAuthSession(USER_ID, {
    environment: { NODE_ENV: 'test' },
    now: NOW,
    sessionModel: {
      async create(payload) {
        stored = payload
        return { _id: 'session-id', ...payload }
      },
    },
  })

  assert.equal(result.token.length >= 43, true)
  assert.equal(stored.tokenHash, hashSessionToken(result.token))
  assert.equal(JSON.stringify(stored).includes(result.token), false)
  assert.equal(result.expiresAt.toISOString(), '2026-10-06T12:00:00.000Z')
})

test('invalid configured session lifetimes fail closed', () => {
  assert.throws(
    () => getSessionTtlMs({ SESSION_TTL_MS: 'not-a-number' }),
    /positive number/,
  )
  assert.equal(getSessionTtlMs({}), 30 * 24 * 60 * 60 * 1000)
})

test('active session resolves its active User and refreshes bounded last-seen state', async () => {
  const updates = []
  const session = {
    _id: 'session-id',
    lastSeenAt: new Date('2026-09-06T11:00:00.000Z'),
    userId: USER_ID,
  }
  const user = { _id: USER_ID, role: 'user', status: 'active' }
  const result = await resolveAuthSession('x'.repeat(43), {
    now: NOW,
    sessionModel: {
      async findOne(filter) {
        assert.equal(filter.revokedAt, null)
        assert.equal(filter.expiresAt.$gt.toISOString(), NOW.toISOString())
        return session
      },
      async updateOne(filter, update) {
        updates.push({ filter, update })
        return { modifiedCount: 1 }
      },
    },
    userModel: {
      async findOne(filter) {
        assert.equal(String(filter._id), String(USER_ID))
        assert.deepEqual(filter.status, { $ne: 'disabled' })
        return user
      },
    },
  })

  assert.equal(result.user, user)
  assert.equal(updates.length, 1)
})

test('expired, revoked or unknown sessions cannot resolve', async () => {
  let userLookupCount = 0
  const result = await resolveAuthSession('y'.repeat(43), {
    now: NOW,
    sessionModel: { async findOne() { return null } },
    userModel: { async findOne() { userLookupCount += 1 } },
  })

  assert.equal(result, null)
  assert.equal(userLookupCount, 0)
})

test('a session whose User was deleted or disabled cannot resolve', async () => {
  const result = await resolveAuthSession('z'.repeat(43), {
    now: NOW,
    sessionModel: {
      async findOne() {
        return { _id: 'session-id', lastSeenAt: NOW, userId: USER_ID }
      },
    },
    userModel: { async findOne() { return null } },
  })

  assert.equal(result, null)
})

test('logout revokes the matching hash', async () => {
  const rawToken = 'r'.repeat(43)
  let revoked = false
  const sessionModel = {
    async updateOne(filter) {
      assert.equal(filter.tokenHash, hashSessionToken(rawToken))
      revoked = true
      return { modifiedCount: 1 }
    },
  }

  assert.equal(await revokeAuthSession(rawToken, { now: NOW, sessionModel }), true)
  assert.equal(revoked, true)
})

test('a copied cookie stops resolving immediately after revocation', async () => {
  const rawToken = 'c'.repeat(43)
  const record = {
    _id: 'session-id',
    expiresAt: new Date('2026-10-06T12:00:00.000Z'),
    lastSeenAt: NOW,
    revokedAt: null,
    tokenHash: hashSessionToken(rawToken),
    userId: USER_ID,
  }
  const sessionModel = {
    async findOne(filter) {
      return record.tokenHash === filter.tokenHash &&
        record.revokedAt === null &&
        record.expiresAt > filter.expiresAt.$gt
        ? record
        : null
    },
    async updateOne(filter, update) {
      if (record.tokenHash !== filter.tokenHash || record.revokedAt !== null) {
        return { modifiedCount: 0 }
      }
      record.revokedAt = update.$set.revokedAt
      return { modifiedCount: 1 }
    },
  }
  const userModel = { async findOne() { return { _id: USER_ID, status: 'active' } } }

  assert.ok(await resolveAuthSession(rawToken, { now: NOW, sessionModel, userModel }))
  assert.equal(await revokeAuthSession(rawToken, { now: NOW, sessionModel }), true)
  assert.equal(
    await resolveAuthSession(rawToken, { now: NOW, sessionModel, userModel }),
    null,
  )
})

test('multiple simultaneous sessions receive independent random tokens', async () => {
  const stored = []
  const sessionModel = {
    async create(payload) {
      stored.push(payload)
      return payload
    },
  }
  const first = await createAuthSession(USER_ID, { now: NOW, sessionModel })
  const second = await createAuthSession(USER_ID, { now: NOW, sessionModel })

  assert.notEqual(first.token, second.token)
  assert.notEqual(stored[0].tokenHash, stored[1].tokenHash)
})

test('production cookie is HttpOnly, Secure, SameSite=None and has no Domain', () => {
  let cookie = null
  setSessionCookie(
    { cookie(name, value, options) { cookie = { name, options, value } } },
    'raw-session-token',
    {
      environment: {
        NODE_ENV: 'production',
        SESSION_COOKIE_SAME_SITE: 'none',
        SESSION_COOKIE_SECURE: 'true',
      },
      expiresAt: new Date('2026-10-06T12:00:00.000Z'),
    },
  )

  assert.equal(cookie.name, 'nhl_edge_session')
  assert.equal(cookie.options.httpOnly, true)
  assert.equal(cookie.options.secure, true)
  assert.equal(cookie.options.sameSite, 'none')
  assert.equal(cookie.options.path, '/api')
  assert.equal(Object.hasOwn(cookie.options, 'domain'), false)
})

test('cookie clearing reuses the security attributes and API path', () => {
  let cleared = null
  clearSessionCookie(
    {
      clearCookie(name, options) {
        cleared = { name, options }
      },
    },
    {
      NODE_ENV: 'production',
      SESSION_COOKIE_SAME_SITE: 'none',
      SESSION_COOKIE_SECURE: 'true',
    },
  )

  assert.equal(cleared.name, 'nhl_edge_session')
  assert.deepEqual(cleared.options, {
    httpOnly: true,
    path: '/api',
    sameSite: 'none',
    secure: true,
  })
})

test('cookie parser returns only the configured session cookie', () => {
  const request = {
    get(name) {
      return name === 'cookie' ? 'other=value; nhl_edge_session=abc%20123' : ''
    },
  }

  assert.equal(getSessionTokenFromRequest(request), 'abc 123')
})
