import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AuthProvider
let Settings
let apiClient
let bettingSettingsApi
let bettingSettingsUtils
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
  bettingSettingsApi = await vite.ssrLoadModule(
    '/src/services/bettingSettingsApi.js',
  )
  bettingSettingsUtils = await vite.ssrLoadModule(
    '/src/utils/bettingSettings.js',
  )
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

test('Settings page renders Betting & Staking section', () => {
  const html = renderSettings()

  assert.match(html, /Betting &amp; Staking/)
  assert.match(html, /Loading betting settings/)
  assert.match(html, /will not place bets automatically/)
})

test('betting settings defaults normalize safely without NaN', () => {
  const settings = bettingSettingsUtils.normalizeBettingSettings({
    bankrollBasis: 'CURRENT',
    customKellyFraction: 'not-a-number',
    kellyMode: 'custom',
    maximumStakePercent: Number.NaN,
    minimumEdgePercent: null,
    stakeRoundingIncrement: 99,
  })

  assert.equal(settings.kellyMode, 'CUSTOM')
  assert.equal(settings.bankrollBasis, 'CURRENT')
  assert.equal(settings.customKellyFraction, 0.25)
  assert.equal(settings.maximumStakePercent, 3)
  assert.equal(settings.minimumEdgePercent, 2)
  assert.equal(settings.stakeRoundingIncrement, 0.5)
  assert.equal(JSON.stringify(settings).includes('NaN'), false)
})

test('Kelly mode mapping returns configured fractional multiplier', () => {
  assert.equal(
    bettingSettingsUtils.getKellyModeFraction({
      ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
      kellyMode: 'FULL',
    }),
    1,
  )
  assert.equal(
    bettingSettingsUtils.getKellyModeFraction({
      ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
      kellyMode: 'HALF',
    }),
    0.5,
  )
  assert.equal(
    bettingSettingsUtils.getKellyModeFraction({
      ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
      customKellyFraction: 0.1,
      kellyMode: 'CUSTOM',
    }),
    0.1,
  )
})

test('Custom Kelly input visibility and draft mode changes preserve custom value', () => {
  const draft = bettingSettingsUtils.createBettingSettingsDraft({
    ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
    customKellyFraction: 0.1,
    kellyMode: 'CUSTOM',
  })
  const halfDraft = bettingSettingsUtils.applyKellyModeSelection(draft, 'HALF')
  const customDraft = bettingSettingsUtils.applyKellyModeSelection(
    halfDraft,
    'CUSTOM',
  )

  assert.equal(
    bettingSettingsUtils.shouldShowCustomKellyFraction(draft.kellyMode),
    true,
  )
  assert.equal(
    bettingSettingsUtils.shouldShowCustomKellyFraction(halfDraft.kellyMode),
    false,
  )
  assert.equal(customDraft.customKellyFraction, '0.1')
})

test('hidden Custom Kelly draft values cannot block non-custom mode saves', () => {
  const draft = bettingSettingsUtils.createBettingSettingsDraft({
    ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
    customKellyFraction: 0.1,
    kellyMode: 'CUSTOM',
  })

  const quarterDraft = bettingSettingsUtils.applyKellyModeSelection(
    {
      ...draft,
      customKellyFraction: '',
    },
    'QUARTER',
  )
  const quarterResult =
    bettingSettingsUtils.parseBettingSettingsDraft(quarterDraft)
  const customResult = bettingSettingsUtils.parseBettingSettingsDraft({
    ...quarterDraft,
    kellyMode: 'CUSTOM',
  })

  assert.equal(quarterResult.isValid, true)
  assert.equal(
    quarterResult.settings.customKellyFraction,
    bettingSettingsUtils.DEFAULT_BETTING_SETTINGS.customKellyFraction,
  )
  assert.equal(customResult.isValid, false)
  assert.match(customResult.fieldErrors.customKellyFraction, /required/)
})

test('betting settings percent validation rejects invalid ranges', () => {
  const draft = bettingSettingsUtils.createBettingSettingsDraft()
  const result = bettingSettingsUtils.parseBettingSettingsDraft({
    ...draft,
    maximumStakePercent: '0',
    minimumEdgePercent: '101',
  })

  assert.equal(result.isValid, false)
  assert.match(result.fieldErrors.maximumStakePercent, /greater than 0/)
  assert.match(result.fieldErrors.minimumEdgePercent, /between 0 and 100/)
})

test('stake rounding and bankroll-basis labels are stable', () => {
  const label = bettingSettingsUtils.formatStakeRoundingLabel(0.5, 'EUR')

  assert.match(label, /€/)
  assert.match(label, /0[,.]50/)
  assert.equal(
    bettingSettingsUtils.getBankrollBasisLabel('AVAILABLE'),
    'Available bankroll',
  )
  assert.equal(
    bettingSettingsUtils.getBankrollBasisLabel('CURRENT'),
    'Current bankroll',
  )
})

test('betting settings API formats get, update, and reset requests', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('betting-settings-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(
      JSON.stringify({
        settings: bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
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
    await bettingSettingsApi.getBettingSettings()
    await bettingSettingsApi.updateBettingSettings({
      ...bettingSettingsUtils.DEFAULT_BETTING_SETTINGS,
      kellyMode: 'HALF',
    })
    await bettingSettingsApi.resetBettingSettings()
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    capturedRequests.map((request) => request.url),
    [
      '/api/settings/betting',
      '/api/settings/betting',
      '/api/settings/betting/reset',
    ],
  )
  assert.deepEqual(
    capturedRequests.map((request) => request.method),
    ['GET', 'PUT', 'POST'],
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer betting-settings-token',
  )
  assert.equal(capturedRequests[1].body.kellyMode, 'HALF')
})
