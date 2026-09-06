const crypto = require('node:crypto')
const AuthSession = require('../models/AuthSession')
const User = require('../models/User')
const { getSessionCookieConfig } = require('../config/auth')

const SESSION_TOKEN_BYTES = 32
const testSessions = new Map()
const revokedTestSessions = new Set()

const hashSessionToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex')

const createRawSessionToken = () =>
  crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url')

const parseCookies = (header = '') => {
  const cookies = new Map()

  String(header)
    .split(';')
    .forEach((part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex <= 0) return

      const name = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()
      if (!cookies.has(name)) cookies.set(name, value)
    })

  return cookies
}

const getSessionTokenFromRequest = (request, environment = process.env) => {
  const { name } = getSessionCookieConfig(environment)
  const encoded = parseCookies(request.get('cookie') ?? '').get(name)

  if (!encoded) return ''

  try {
    return decodeURIComponent(encoded)
  } catch {
    return ''
  }
}

const createAuthSession = async (
  userId,
  { environment = process.env, now = new Date(), sessionModel = AuthSession } = {},
) => {
  const { ttlMs } = getSessionCookieConfig(environment)
  const createdAt = new Date(now)
  const expiresAt = new Date(createdAt.getTime() + ttlMs)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = createRawSessionToken()

    try {
      const session = await sessionModel.create({
        expiresAt,
        lastSeenAt: createdAt,
        tokenHash: hashSessionToken(token),
        userId,
      })

      return { expiresAt, session, token }
    } catch (error) {
      if (error?.code !== 11000 || attempt === 1) throw error
    }
  }

  throw new Error('Unable to create authentication session.')
}

const resolveAuthSession = async (
  token,
  {
    now = new Date(),
    sessionModel = AuthSession,
    userModel = User,
  } = {},
) => {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return null
  }

  if (process.env.NODE_ENV === 'test') {
    if (revokedTestSessions.has(token)) return null
    if (testSessions.has(token)) return testSessions.get(token)
  }

  const current = new Date(now)
  const session = await sessionModel.findOne({
    expiresAt: { $gt: current },
    revokedAt: null,
    tokenHash: hashSessionToken(token),
  })

  if (!session) return null

  const user = await userModel.findOne({
    _id: session.userId,
    status: { $ne: 'disabled' },
  })

  if (!user) return null

  const lastSeenAt = new Date(session.lastSeenAt ?? 0)
  if (current.getTime() - lastSeenAt.getTime() >= 15 * 60 * 1000) {
    await sessionModel.updateOne(
      { _id: session._id, revokedAt: null },
      { $set: { lastSeenAt: current } },
    )
    session.lastSeenAt = current
  }

  return { session, user }
}

const createTestAuthSession = (userId, { role = 'user', user = null } = {}) => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test authentication sessions are unavailable outside tests.')
  }

  const token = createRawSessionToken()
  revokedTestSessions.delete(token)
  testSessions.set(token, {
    session: { _id: `test-session-${token.slice(0, 8)}`, userId },
    user: user ?? { _id: userId, role, status: 'active' },
  })
  return token
}

const revokeAuthSession = async (
  token,
  { now = new Date(), sessionModel = AuthSession } = {},
) => {
  if (typeof token !== 'string' || !token) return false

  if (process.env.NODE_ENV === 'test' && testSessions.delete(token)) {
    revokedTestSessions.add(token)
    return true
  }

  const result = await sessionModel.updateOne(
    {
      revokedAt: null,
      tokenHash: hashSessionToken(token),
    },
    { $set: { revokedAt: new Date(now) } },
  )

  return Number(result?.modifiedCount) > 0
}

const setSessionCookie = (
  response,
  token,
  { environment = process.env, expiresAt } = {},
) => {
  const { name, options } = getSessionCookieConfig(environment)
  response.cookie(name, token, { ...options, expires: expiresAt })
}

const clearSessionCookie = (response, environment = process.env) => {
  const { name, options } = getSessionCookieConfig(environment)
  response.clearCookie(name, options)
}

module.exports = {
  SESSION_TOKEN_BYTES,
  clearSessionCookie,
  createAuthSession,
  createRawSessionToken,
  createTestAuthSession,
  getSessionTokenFromRequest,
  hashSessionToken,
  parseCookies,
  resolveAuthSession,
  revokeAuthSession,
  setSessionCookie,
}
