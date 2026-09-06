process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const AuthSession = require('../models/AuthSession')
const authService = require('../services/authService')
const authSessionService = require('../services/authSessionService')

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
