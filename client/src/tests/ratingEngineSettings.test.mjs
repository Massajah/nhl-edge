import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AuthProvider
let Settings
let apiClient
let settingsApi
let settingsUtils
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  AuthProvider = (await vite.ssrLoadModule('/src/context/AuthContext.jsx'))
    .AuthProvider
  Settings = (await vite.ssrLoadModule('/src/components/Settings.jsx')).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  settingsApi = await vite.ssrLoadModule(
    '/src/services/ratingEngineSettingsApi.js',
  )
  settingsUtils = await vite.ssrLoadModule('/src/utils/ratingEngineSettings.js')
})

after(async () => {
  await vite?.close()
})

const renderSettings = () =>
  renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(Settings, null),
    ),
  )

test('Settings page renders Power Rating Engine section', () => {
  const html = renderSettings()

  assert.match(html, /Power Rating Engine/)
  assert.match(html, /Loading engine settings/)
  assert.match(html, /Rating Lab remains/)
})

test('rating engine settings utility validates numeric ranges', () => {
  const validDraft = settingsUtils.createRatingEngineSettingsDraft({
    homeAdvantage: 4.25,
    kFactor: 1.15,
    overtimeMultiplier: 0.7,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  })
  const validResult = settingsUtils.parseRatingEngineSettingsDraft(validDraft)
  const invalidResult = settingsUtils.parseRatingEngineSettingsDraft({
    ...validDraft,
    homeAdvantage: '16',
    kFactor: '0',
  })

  assert.equal(validResult.isValid, true)
  assert.equal(validResult.settings.homeAdvantage, 4.25)
  assert.equal(invalidResult.isValid, false)
  assert.match(invalidResult.fieldErrors.homeAdvantage, /between 0 and 15/)
  assert.match(invalidResult.fieldErrors.kFactor, /greater than 0/)
})

test('rating engine settings API uses centralized authenticated requests', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('settings-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(
      JSON.stringify({
        settings: settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS,
        success: true,
        usingDefaults: true,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      },
    )
  }

  try {
    await settingsApi.getRatingEngineSettings()
    await settingsApi.updateRatingEngineSettings(
      settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS,
    )
    await settingsApi.resetRatingEngineSettings()
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    capturedRequests.map((request) => request.url),
    [
      '/api/settings/rating-engine',
      '/api/settings/rating-engine',
      '/api/settings/rating-engine/reset',
    ],
  )
  assert.deepEqual(
    capturedRequests.map((request) => request.method),
    ['GET', 'PUT', 'POST'],
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer settings-token',
  )
  assert.deepEqual(
    capturedRequests[1].body,
    settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS,
  )
})
