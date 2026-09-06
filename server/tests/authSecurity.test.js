process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'
process.env.CLIENT_ORIGIN =
  'http://localhost:5173,https://nhl-edge-rouge.vercel.app'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const { isLocalAuthEnabled } = require('../config/auth')
const { parseAllowedOrigins } = require('../config/cors')
const googleAuthService = require('../services/googleAuthService')
const authService = require('../services/authService')
const authSessionService = require('../services/authSessionService')
const { createRateLimiter } = require('../middleware/rateLimit')

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const text = await response.text()
    return {
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const validPayload = (overrides = {}) => ({
  aud: 'google-client-id',
  email: 'owner@example.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 300,
  iss: 'https://accounts.google.com',
  name: 'Owner',
  picture: 'https://example.com/avatar.png',
  sub: 'google-subject',
  ...overrides,
})

const verifyPayload = (payload) =>
  googleAuthService.verifyGoogleIdToken('signed-google-token', {
    clientId: 'google-client-id',
    verifyIdToken: async () => ({ getPayload: () => payload }),
  })

test('valid Google credential returns only minimal verified claims', async () => {
  const claims = await verifyPayload(validPayload())

  assert.deepEqual(claims, {
    email: 'owner@example.com',
    googleId: 'google-subject',
    name: 'Owner',
    profileImage: 'https://example.com/avatar.png',
  })
})

test('Google verification rejects signature, audience, issuer, expiry and unverified email', async () => {
  await assert.rejects(
    () => googleAuthService.verifyGoogleIdToken('forged', {
      clientId: 'google-client-id',
      verifyIdToken: async () => { throw new Error('bad signature') },
    }),
    (error) => error.statusCode === 401,
  )

  for (const payload of [
    validPayload({ aud: 'other-client' }),
    validPayload({ iss: 'https://attacker.example' }),
    validPayload({ exp: 1 }),
    validPayload({ email_verified: false }),
  ]) {
    await assert.rejects(() => verifyPayload(payload), (error) => error.statusCode === 401)
  }
})

test('local auth is disabled by default and requires explicit configuration', () => {
  assert.equal(isLocalAuthEnabled({ NODE_ENV: 'production' }), false)
  assert.equal(
    isLocalAuthEnabled({ LOCAL_AUTH_ENABLED: 'true', NODE_ENV: 'development' }),
    true,
  )
})

test('production CORS defaults to only the deployed frontend origin', () => {
  assert.deepEqual(parseAllowedOrigins({ NODE_ENV: 'production' }), [
    'https://nhl-edge-rouge.vercel.app',
  ])
  assert.deepEqual(parseAllowedOrigins({ NODE_ENV: 'development' }), [
    'http://localhost:5173',
  ])
})

test('disabled local auth rejects before processing public credentials', async () => {
  await assert.rejects(
    () => authService.registerLocalUser({}, {
      environment: { LOCAL_AUTH_ENABLED: 'false', NODE_ENV: 'production' },
    }),
    (error) => error.statusCode === 404,
  )
})

test('credentialed CORS accepts exact development and production origins', async () => {
  for (const origin of [
    'http://localhost:5173',
    'https://nhl-edge-rouge.vercel.app',
  ]) {
    const response = await request('/api', { headers: { Origin: origin } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  }
})

test('credentialed preflight remains available for an approved mutation', async () => {
  const origin = 'https://nhl-edge-rouge.vercel.app'
  const response = await request('/api/auth/logout', {
    headers: {
      'Access-Control-Request-Method': 'POST',
      Origin: origin,
    },
    method: 'OPTIONS',
  })

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
})

test('unexpected origins and invalid-origin mutations are rejected', async () => {
  const read = await request('/api', {
    headers: { Origin: 'https://attacker.example' },
  })
  const mutation = await request('/api/auth/logout', {
    headers: { Origin: 'https://attacker.example' },
    method: 'POST',
  })

  assert.equal(read.status, 403)
  assert.equal(mutation.status, 403)
})

test('cookie-authenticated mutation without Origin fails closed', async () => {
  const response = await request('/api/auth/logout', {
    headers: { Cookie: `nhl_edge_session=${'x'.repeat(43)}` },
    method: 'POST',
  })

  assert.equal(response.status, 403)
  assert.equal(response.body.message, 'Request origin is required.')
})

test('ordinary users cannot trigger shared historical preparation', async () => {
  const token = authSessionService.createTestAuthSession('ordinary-user')
  const response = await request(
    '/api/power-rating-simulations/calibration/historical-seasons/20242025/prepare',
    {
      body: JSON.stringify({ role: 'admin', userId: 'administrator' }),
      headers: {
        Cookie: `nhl_edge_session=${token}`,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      method: 'POST',
    },
  )

  assert.equal(response.status, 403)
  assert.match(response.body.message, /permission/i)
})

test('API security headers fail closed without exposing browser-readable cookies', async () => {
  const response = await request('/api')

  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-powered-by'), null)
})

test('auth rate limiter rejects attempts above its allowance', () => {
  const limiter = createRateLimiter({ limit: 2, now: () => 1000, windowMs: 5000 })
  const statuses = []
  const response = {
    json() {},
    set() {},
    status(value) { statuses.push(value); return this },
  }
  const requestObject = { ip: '127.0.0.1' }
  let allowed = 0

  limiter(requestObject, response, () => { allowed += 1 })
  limiter(requestObject, response, () => { allowed += 1 })
  limiter(requestObject, response, () => { allowed += 1 })

  assert.equal(allowed, 2)
  assert.deepEqual(statuses, [429])
})
