process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const AuthSession = require('../models/AuthSession')
const User = require('../models/User')
const { ACCOUNT_TYPES } = require('../config/accountTypes')
const googleAuthService = require('../services/googleAuthService')
const authService = require('../services/authService')
const authSessionService = require('../services/authSessionService')
const powerRatingsService = require('../services/powerRatingsService')

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, options)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('Google endpoint creates a hashed session cookie and returns no bearer token', async (t) => {
  const userId = new mongoose.Types.ObjectId()
  const originalAuthenticate = authService.authenticateGoogleUser
  const originalCreate = AuthSession.create
  let storedSession = null

  t.after(() => {
    authService.authenticateGoogleUser = originalAuthenticate
    AuthSession.create = originalCreate
  })
  authService.authenticateGoogleUser = async () => ({
    user: {
      authProvider: 'google',
      email: 'owner@example.com',
      id: String(userId),
      name: 'Owner',
      profileImage: '',
      role: 'user',
    },
    userId,
  })
  AuthSession.create = async (payload) => {
    storedSession = payload
    return { _id: new mongoose.Types.ObjectId(), ...payload }
  }

  const response = await request('/api/auth/google', {
    body: JSON.stringify({ credential: 'temporary-google-id-token' }),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    method: 'POST',
  })
  const body = await response.json()
  const setCookie = response.headers.get('set-cookie')
  const rawSessionToken = /^nhl_edge_session=([^;]+)/.exec(setCookie)?.[1]

  assert.equal(response.status, 200)
  assert.equal(body.user.id, String(userId))
  assert.equal(Object.hasOwn(body, 'token'), false)
  assert.match(setCookie, /^nhl_edge_session=/)
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Lax/i)
  assert.equal(storedSession.tokenHash.length, 64)
  assert.equal(typeof rawSessionToken, 'string')
  assert.equal(JSON.stringify(storedSession).includes(rawSessionToken), false)
  assert.equal(JSON.stringify(storedSession).includes('temporary-google-id-token'), false)
  assert.equal(setCookie.includes(storedSession.tokenHash), false)
})

test('historical raw User without accountType completes Google login, session restoration and later saves', async (t) => {
  const userId = new mongoose.Types.ObjectId()
  const rawUsers = new Map()
  let storedSession = null
  let userUpdateCount = 0

  t.mock.method(User.collection, 'insertOne', async (document) => {
    rawUsers.set(String(document._id), { ...document })
    return { acknowledged: true, insertedId: document._id }
  })
  t.mock.method(User.collection, 'updateOne', async (filter, update) => {
    const key = String(filter._id)
    const stored = rawUsers.get(key)

    if (!stored) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }

    Object.assign(stored, update.$set ?? {})
    Object.keys(update.$unset ?? {}).forEach((path) => delete stored[path])
    userUpdateCount += 1
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
  })
  t.mock.method(User, 'findOne', async (filter) => {
    const stored = [...rawUsers.values()].find((candidate) => {
      if (filter.googleId && candidate.googleId !== filter.googleId) return false
      if (filter._id && String(candidate._id) !== String(filter._id)) return false
      return candidate.status !== 'disabled'
    })

    return stored ? User.hydrate({ ...stored }) : null
  })
  t.mock.method(googleAuthService, 'verifyGoogleIdToken', async () => ({
    email: 'historical@example.com',
    googleId: 'historical-google-subject',
    name: 'Historical User',
    profileImage: '',
  }))
  t.mock.method(
    powerRatingsService,
    'initializeDefaultPowerRatings',
    async () => ({ insertedCount: 0, totalTeams: 32 }),
  )
  t.mock.method(AuthSession, 'create', async (payload) => {
    storedSession = {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
      revokedAt: null,
    }
    return storedSession
  })
  t.mock.method(AuthSession, 'findOne', async (filter) =>
    storedSession?.tokenHash === filter.tokenHash ? storedSession : null,
  )

  // Raw collection insertion deliberately bypasses the current schema default
  // and represents a User persisted before accountType existed.
  await User.collection.insertOne({
    _id: userId,
    authProvider: 'google',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    email: 'historical@example.com',
    googleId: 'historical-google-subject',
    name: 'Historical User',
    profileImage: '',
    role: 'user',
    status: 'active',
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  })
  assert.equal(
    Object.hasOwn(rawUsers.get(String(userId)), 'accountType'),
    false,
  )

  const loginResponse = await request('/api/auth/google', {
    body: JSON.stringify({ credential: 'verified-google-id-token' }),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    method: 'POST',
  })
  const loginBody = await loginResponse.json()
  const cookie = loginResponse.headers.get('set-cookie')
  const sessionToken = /^nhl_edge_session=([^;]+)/.exec(cookie)?.[1]
  const storedUser = rawUsers.get(String(userId))

  assert.equal(loginResponse.status, 200)
  assert.equal(loginBody.user.id, String(userId))
  assert.equal(loginBody.user.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(storedUser.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(userUpdateCount, 1)
  assert.ok(storedUser.lastLoginAt instanceof Date)
  assert.equal(storedSession.userId.toString(), String(userId))
  assert.equal(storedSession.tokenHash.length, 64)
  assert.ok(
    storedSession.expiresAt.getTime() - storedSession.lastSeenAt.getTime() >
      29 * 24 * 60 * 60 * 1000,
  )

  const meResponse = await request('/api/auth/me', {
    headers: { Cookie: `nhl_edge_session=${sessionToken}` },
  })
  const meBody = await meResponse.json()

  assert.equal(meResponse.status, 200)
  assert.equal(meBody.user.id, String(userId))
  assert.equal(meBody.user.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(Object.hasOwn(meBody.user, 'expiresAt'), false)

  const reloadedUser = await User.findOne({ _id: userId })
  reloadedUser.name = 'Updated Historical User'
  await reloadedUser.save()

  assert.equal(userUpdateCount, 2)
  assert.equal(storedUser.accountType, ACCOUNT_TYPES.NORMAL)
  assert.equal(storedUser.name, 'Updated Historical User')
})

test('/me restores the current User from a valid cookie session', async () => {
  const userId = new mongoose.Types.ObjectId()
  const token = authSessionService.createTestAuthSession(userId, {
    user: {
      _id: userId,
      authProvider: 'google',
      email: 'owner@example.com',
      name: 'Owner',
      profileImage: '',
      role: 'user',
      status: 'active',
    },
  })
  const response = await request('/api/auth/me', {
    headers: { Cookie: `nhl_edge_session=${token}` },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.user.id, String(userId))
  assert.equal(body.user.email, 'owner@example.com')
})

test('logout revokes the current session hash and clears matching cookie attributes', async (t) => {
  const rawToken = 'l'.repeat(43)
  const originalUpdate = AuthSession.updateOne
  let updateFilter = null

  t.after(() => { AuthSession.updateOne = originalUpdate })
  AuthSession.updateOne = async (filter) => {
    updateFilter = filter
    return { modifiedCount: 1 }
  }

  const response = await request('/api/auth/logout', {
    headers: {
      Cookie: `nhl_edge_session=${rawToken}`,
      Origin: 'http://localhost:5173',
    },
    method: 'POST',
  })
  const body = await response.json()
  const setCookie = response.headers.get('set-cookie')

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(updateFilter.tokenHash, authSessionService.hashSessionToken(rawToken))
  assert.match(setCookie, /^nhl_edge_session=;/)
  assert.match(setCookie, /Path=\/api/i)
  assert.match(setCookie, /HttpOnly/i)
})

test('logout makes a replay of the same session cookie unauthorized', async () => {
  const userId = new mongoose.Types.ObjectId()
  const token = authSessionService.createTestAuthSession(userId)
  const cookie = `nhl_edge_session=${token}`
  const logoutResponse = await request('/api/auth/logout', {
    headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
    method: 'POST',
  })
  const replayResponse = await request('/api/auth/me', {
    headers: { Cookie: cookie },
  })

  assert.equal(logoutResponse.status, 200)
  assert.equal(replayResponse.status, 401)
})
