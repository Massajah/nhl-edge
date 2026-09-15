import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let apiClient
let authApi
let AuthPage
let AuthProvider
let AppLayout
let Sidebar
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
  ;({ default: AuthPage } = await vite.ssrLoadModule(
    '/src/components/auth/AuthPage.jsx',
  ))
  ;({ AuthProvider } = await vite.ssrLoadModule('/src/context/AuthContext.jsx'))
  ;({ default: Sidebar } = await vite.ssrLoadModule(
    '/src/components/layout/Sidebar.jsx',
  ))
  ;({ default: AppLayout } = await vite.ssrLoadModule(
    '/src/components/layout/AppLayout.jsx',
  ))
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

test('Explore Demo starts a cookie-authenticated sandbox session', async () => {
  const originalFetch = globalThis.fetch
  let captured = null
  globalThis.fetch = async (url, options = {}) => {
    captured = { method: options.method, url }
    return new Response(
      JSON.stringify({
        user: {
          accountType: 'DEMO_SANDBOX',
          authProvider: 'demo',
          id: 'demo-owner',
        },
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 201 },
    )
  }

  try {
    const result = await authApi.startDemoSandbox()

    assert.equal(result.user.accountType, 'DEMO_SANDBOX')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(captured, {
    method: 'POST',
    url: '/api/auth/demo',
  })
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

test('login renders centered branding while preserving the authentication path', async () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(AuthPage, {
        mode: 'login',
        onModeChange: () => {},
        onSuccess: () => {},
      }),
    ),
  )
  const [authPageSource, css] = await Promise.all([
    readFile(new URL('../components/auth/AuthPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../App.css', import.meta.url), 'utf8'),
  ])
  const authPageCss = css.match(/\.auth-page\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(markup, /class="auth-page"/)
  assert.match(markup, /class="auth-login-logo"/)
  assert.match(markup, /src="\/compact_logo\.png"/)
  assert.match(markup, /alt="NHL Edge"/)
  assert.match(markup, /<h1 id="auth-heading">Sign in<\/h1>/)
  assert.match(markup, /<h2>Data-driven NHL analysis\.<\/h2>/)
  assert.match(
    markup,
    /Model game probabilities, compare fair odds with the market, identify value and measure performance over time\./,
  )
  assert.match(markup, /PREDICT · COMPARE · MEASURE/)
  assert.match(markup, /class="google-auth-shell/)
  assert.doesNotMatch(authPageSource, /auth-hero/)
  assert.match(authPageCss, /place-items: center;/)
  assert.match(authPageCss, /url\('\/login_hero\.png'\)/)
  assert.doesNotMatch(authPageCss, /grid-template-columns/)
  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{\s*\.auth-product-copy\s*\{\s*display: none;/,
  )
  assert.match(authPageSource, /<GoogleSignInButton/)
  assert.match(authPageSource, /<form className="auth-form" onSubmit=\{handleSubmit\}>/)
  assert.match(authPageSource, /id="auth-email"/)
  assert.match(authPageSource, /id="auth-password"/)
  assert.match(authPageSource, /await login\(values\)/)
  assert.match(authPageSource, /await register\(values\)/)
  assert.match(authPageSource, /await googleLogin\(credential\)/)
  assert.match(markup, />Explore Demo</)
  assert.match(markup, /No account required · Temporary sandbox/)
  assert.match(authPageSource, /await exploreDemo\(\)/)
  assert.match(authPageSource, /onSuccess\(\)/)
})

test('demo indicators render only for DEMO_SANDBOX users', () => {
  const baseProps = {
    activePage: 'dashboard',
    children: React.createElement('section', null, 'Dashboard content'),
    currentPage: { title: 'Dashboard' },
    onLogout: () => {},
    onNavigate: () => {},
    primaryItems: [],
    utilityItems: [],
  }
  const demoMarkup = renderToStaticMarkup(
    React.createElement(AppLayout, {
      ...baseProps,
      authUser: {
        accountType: 'DEMO_SANDBOX',
        authProvider: 'demo',
        name: 'Demo Sandbox',
      },
    }),
  )
  const normalMarkup = renderToStaticMarkup(
    React.createElement(AppLayout, {
      ...baseProps,
      authUser: {
        accountType: 'NORMAL',
        email: 'owner@example.com',
        name: 'Owner',
      },
    }),
  )

  assert.match(demoMarkup, /class="demo-sandbox-badge">Demo Sandbox/)
  assert.match(demoMarkup, /class="demo-sandbox-banner"/)
  assert.match(demoMarkup, /Changes are temporary and automatically removed/)
  assert.doesNotMatch(normalMarkup, /demo-sandbox-badge/)
  assert.doesNotMatch(normalMarkup, /demo-sandbox-banner/)
})

test('brand assets resolve and shell branding adapts without changing sidebar behavior', async () => {
  const assetNames = [
    'app_icon.png',
    'compact_logo.png',
    'login_hero.png',
    'master_logo.png',
    'primary_logo.png',
  ]

  for (const assetName of assetNames) {
    const assetUrl = new URL(`../../public/${assetName}`, import.meta.url)
    await access(assetUrl)
    assert.ok((await stat(assetUrl)).size > 0)
  }

  const sidebarProps = {
    activePage: 'dashboard',
    authUser: { email: 'owner@example.com', name: 'Owner' },
    onCloseMobile: () => {},
    onLogout: () => {},
    onNavigate: () => {},
    onToggleCollapse: () => {},
    primaryItems: [],
  }
  const expandedMarkup = renderToStaticMarkup(
    React.createElement(Sidebar, { ...sidebarProps, isCollapsed: false }),
  )
  const collapsedMarkup = renderToStaticMarkup(
    React.createElement(Sidebar, { ...sidebarProps, isCollapsed: true }),
  )
  const [css, indexHtml] = await Promise.all([
    readFile(new URL('../App.css', import.meta.url), 'utf8'),
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  ])

  assert.match(expandedMarkup, /src="\/compact_logo\.png"/)
  assert.match(collapsedMarkup, /src="\/app_icon\.png\?v=2"/)
  assert.match(expandedMarkup, /media="\(max-width: 860px\)"/)
  assert.match(css, /url\('\/login_hero\.png'\)/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.auth-page \{[^}]*background-position: 72% bottom;/)
  assert.match(indexHtml, /type="image\/png" href="\/app_icon\.png\?v=2"/)
})
