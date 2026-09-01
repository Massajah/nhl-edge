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
  assert.match(html, /Calibrated Base Model v1/)
  assert.match(html, /K 1\.30/)
  assert.match(html, /Reg[^<]*1\.00/)
  assert.match(html, /OT[^<]*0\.40/)
  assert.match(html, /SO[^<]*0\.10/)
  assert.match(html, /Advanced Model Settings/)
  assert.match(html, /id="engine-setting-probabilityScale"[^>]*value="20"/)
  assert.match(
    html,
    /id="engine-setting-maximumGoaliePenalty"[^>]*value="-4\.00"/,
  )
  assert.match(
    html,
    /id="engine-setting-maximumPlayerInjuryPenalty"[^>]*value="-2\.50"/,
  )
  assert.match(html, /largest allowed downgrade from the team&#x27;s normal starter/)
  assert.match(html, /normal #1 goalie/)
  assert.doesNotMatch(html, /<details class="settings-advanced-model" open/)
  assert.match(html, /Loading engine settings/)
  assert.match(html, /Rating Lab remains/)
})

test('rating engine settings utility validates numeric ranges', () => {
  const validDraft = settingsUtils.createRatingEngineSettingsDraft({
    homeAdvantage: 4.25,
    kFactor: 1.15,
    maximumGoaliePenalty: -3.25,
    maximumPlayerInjuryPenalty: -1.5,
    overtimeMultiplier: 0.7,
    probabilityScale: 22,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  })
  const validResult = settingsUtils.parseRatingEngineSettingsDraft(validDraft)
  const invalidResult = settingsUtils.parseRatingEngineSettingsDraft({
    ...validDraft,
    homeAdvantage: '16',
    kFactor: '0',
    probabilityScale: 'Infinity',
    maximumGoaliePenalty: '0.25',
    maximumPlayerInjuryPenalty: '-1.75',
  })
  const outOfRangeScale = settingsUtils.parseRatingEngineSettingsDraft({
    ...validDraft,
    probabilityScale: '0.5',
  })

  assert.equal(validResult.isValid, true)
  assert.equal(validResult.settings.homeAdvantage, 4.25)
  assert.equal(validResult.settings.maximumGoaliePenalty, -3.25)
  assert.equal(validResult.settings.maximumPlayerInjuryPenalty, -1.5)
  assert.equal(validResult.settings.probabilityScale, 22)
  assert.equal(invalidResult.isValid, false)
  assert.match(invalidResult.fieldErrors.homeAdvantage, /between 0 and 15/)
  assert.match(invalidResult.fieldErrors.kFactor, /greater than 0/)
  assert.match(
    invalidResult.fieldErrors.maximumGoaliePenalty,
    /between -5 and 0/,
  )
  assert.match(invalidResult.fieldErrors.probabilityScale, /must be a number/)
  assert.match(
    invalidResult.fieldErrors.maximumPlayerInjuryPenalty,
    /0\.50-point increments/,
  )
  assert.equal(outOfRangeScale.isValid, false)
  assert.match(
    outOfRangeScale.fieldErrors.probabilityScale,
    /between 1 and 50/,
  )
  assert.deepEqual(settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS, {
    homeAdvantage: 3.5,
    kFactor: 1.3,
    maximumGoaliePenalty: -4,
    maximumPlayerInjuryPenalty: -2.5,
    overtimeMultiplier: 0.4,
    probabilityScale: 20,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
    specialTeamsAdjustment: 0.5,
    specialTeamsAlertsEnabled: true,
    specialTeamsMode: 'alert_only',
    specialTeamsRankThreshold: 6,
  })
})

test('Special Teams settings normalize defaults and validate modes, magnitudes, and thresholds', () => {
  const defaults = settingsUtils.createRatingEngineSettingsDraft({})
  const legacyDisabled = settingsUtils.normalizeRatingEngineSettings({
    specialTeamsAlertsEnabled: false,
    specialTeamsRankThreshold: 8,
  })
  const minimum = settingsUtils.parseRatingEngineSettingsDraft({
    ...defaults,
    specialTeamsMode: 'off',
    specialTeamsRankThreshold: '3',
  })
  const maximum = settingsUtils.parseRatingEngineSettingsDraft({
    ...defaults,
    specialTeamsAdjustment: '1',
    specialTeamsMode: 'automatic',
    specialTeamsRankThreshold: '12',
  })

  assert.equal(defaults.specialTeamsAdjustment, '0.5')
  assert.equal(defaults.specialTeamsAlertsEnabled, true)
  assert.equal(defaults.specialTeamsMode, 'alert_only')
  assert.equal(defaults.specialTeamsRankThreshold, '6')
  assert.equal(legacyDisabled.specialTeamsMode, 'off')
  assert.equal(legacyDisabled.specialTeamsRankThreshold, 8)
  assert.equal(legacyDisabled.specialTeamsAdjustment, 0.5)
  assert.equal(minimum.isValid, true)
  assert.equal(minimum.settings.specialTeamsAlertsEnabled, false)
  assert.equal(minimum.settings.specialTeamsMode, 'off')
  assert.equal(minimum.settings.specialTeamsRankThreshold, 3)
  assert.equal(maximum.isValid, true)
  assert.equal(maximum.settings.specialTeamsAdjustment, 1)
  assert.equal(maximum.settings.specialTeamsMode, 'automatic')
  assert.equal(maximum.settings.specialTeamsRankThreshold, 12)

  for (const value of ['2', '13', '6.5', 'invalid']) {
    const result = settingsUtils.parseRatingEngineSettingsDraft({
      ...defaults,
      specialTeamsRankThreshold: value,
    })

    assert.equal(result.isValid, false)
    assert.ok(result.fieldErrors.specialTeamsRankThreshold)
  }

  const invalidMode = settingsUtils.parseRatingEngineSettingsDraft({
    ...defaults,
    specialTeamsMode: 'boost',
  })
  const invalidAdjustment = settingsUtils.parseRatingEngineSettingsDraft({
    ...defaults,
    specialTeamsAdjustment: '0.6',
  })

  assert.equal(invalidMode.isValid, false)
  assert.ok(invalidMode.fieldErrors.specialTeamsMode)
  assert.equal(invalidAdjustment.isValid, false)
  assert.ok(invalidAdjustment.fieldErrors.specialTeamsAdjustment)
})

test('dirty ownership assigns model guardrails to Model Adjustments', () => {
  const saved = settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS
  const clean = settingsUtils.createRatingEngineSettingsDraft(saved)
  const homeDirty = { ...clean, homeAdvantage: '4.00' }
  const engineDirty = { ...clean, kFactor: '1.50' }
  const goaliePenaltyDirty = { ...clean, maximumGoaliePenalty: '-3.50' }
  const injuryPenaltyDirty = {
    ...clean,
    maximumPlayerInjuryPenalty: '-1.50',
  }
  const modeDirty = { ...clean, specialTeamsMode: 'automatic' }
  const adjustmentDirty = { ...clean, specialTeamsAdjustment: '0.75' }
  const thresholdDirty = { ...clean, specialTeamsRankThreshold: '8' }

  assert.deepEqual(settingsUtils.getRatingEngineDirtyOwnership(clean, saved), {
    modelAdjustments: false,
    ratingEngine: false,
  })
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(homeDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(engineDirty, saved),
    { modelAdjustments: false, ratingEngine: true },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(goaliePenaltyDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(injuryPenaltyDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(modeDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(adjustmentDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
  assert.deepEqual(
    settingsUtils.getRatingEngineDirtyOwnership(thresholdDirty, saved),
    { modelAdjustments: true, ratingEngine: false },
  )
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
    await settingsApi.updateRatingEngineModelAdjustments({
      homeAdvantage: 4,
      maximumGoaliePenalty: -3.5,
      maximumPlayerInjuryPenalty: -1.5,
    })
    await settingsApi.updateRatingEngineParameters({
      kFactor: 1.3,
      overtimeMultiplier: 0.4,
      probabilityScale: 20,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.1,
    })
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
      '/api/settings/rating-engine/model-adjustments',
      '/api/settings/rating-engine/engine',
      '/api/settings/rating-engine/reset',
    ],
  )
  assert.deepEqual(
    capturedRequests.map((request) => request.method),
    ['GET', 'PUT', 'PUT', 'PUT', 'POST'],
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer settings-token',
  )
  assert.deepEqual(
    capturedRequests[1].body,
    settingsUtils.DEFAULT_RATING_ENGINE_SETTINGS,
  )
  assert.deepEqual(capturedRequests[2].body, {
    homeAdvantage: 4,
    maximumGoaliePenalty: -3.5,
    maximumPlayerInjuryPenalty: -1.5,
  })
  assert.equal(Object.hasOwn(capturedRequests[3].body, 'homeAdvantage'), false)
  assert.equal(
    Object.hasOwn(capturedRequests[3].body, 'maximumGoaliePenalty'),
    false,
  )
  assert.equal(
    Object.hasOwn(capturedRequests[3].body, 'maximumPlayerInjuryPenalty'),
    false,
  )
  assert.deepEqual(capturedRequests[4].body, { scope: 'all' })
})
