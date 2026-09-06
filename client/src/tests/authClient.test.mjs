import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let apiClient
let authApi
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  authApi = await vite.ssrLoadModule('/src/services/authApi.js')
})

after(async () => {
  await vite?.close()
})

test('browser API requests include cookies and never inject bearer authentication', async () => {
  const originalFetch = globalThis.fetch
  let captured = null
  globalThis.fetch = async (url, options) => {
    captured = { options, url }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await apiClient.apiRequest('/api/example')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(captured.url, '/api/example')
  assert.equal(captured.options.credentials, 'include')
  assert.equal(captured.options.headers.get('Authorization'), null)
})

test('401 responses notify the authentication state boundary', async () => {
  const originalFetch = globalThis.fetch
  let notifications = 0
  const unsubscribe = apiClient.subscribeToUnauthorized(() => {
    notifications += 1
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'Authentication required.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    })

  try {
    await assert.rejects(
      () => apiClient.apiRequest('/api/protected'),
      (error) => error.status === 401,
    )
  } finally {
    unsubscribe()
    globalThis.fetch = originalFetch
  }

  assert.equal(notifications, 1)
})

test('session restore uses /me and logout posts to the backend', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ method: options.method ?? 'GET', url })
    return new Response(
      JSON.stringify(
        url.endsWith('/me')
          ? { user: { email: 'owner@example.com', id: 'owner' } }
          : { success: true },
      ),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  }

  try {
    const user = await authApi.fetchCurrentUser()
    await authApi.logoutUser()
    assert.equal(user.id, 'owner')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/auth/me' },
    { method: 'POST', url: '/api/auth/logout' },
  ])
})

test('authentication sources contain no JavaScript token persistence', async () => {
  const [apiClientSource, authContextSource] = await Promise.all([
    readFile(new URL('../services/apiClient.js', import.meta.url), 'utf8'),
    readFile(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8'),
  ])
  const combined = `${apiClientSource}\n${authContextSource}`

  assert.equal(combined.includes('localStorage'), false)
  assert.equal(combined.includes('Bearer '), false)
  assert.equal(combined.includes('setAuthToken'), false)
})
