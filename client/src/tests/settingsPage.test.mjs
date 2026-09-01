import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AuthProvider
let Settings
let databaseStorageApi
let databaseStorageUtils
let quickRematchSettingsUtils
let apiClient
let userDataResetApi
let userDataResetUtils
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
  databaseStorageApi = await vite.ssrLoadModule(
    '/src/services/databaseStorageApi.js',
  )
  databaseStorageUtils = await vite.ssrLoadModule(
    '/src/utils/databaseStorage.js',
  )
  quickRematchSettingsUtils = await vite.ssrLoadModule(
    '/src/utils/quickRematchSettings.js',
  )
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  userDataResetApi = await vite.ssrLoadModule(
    '/src/services/userDataResetApi.js',
  )
  userDataResetUtils = await vite.ssrLoadModule(
    '/src/utils/userDataReset.js',
  )
})

after(async () => {
  await vite?.close()
})

const renderSettings = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(Settings, props),
    ),
  )

const indexOfText = (html, text) => {
  const index = html.indexOf(text)

  assert.notEqual(index, -1, `${text} should render`)

  return index
}

test('Settings page renders the five accessible tabs in order', () => {
  const html = renderSettings()
  const generalIndex = indexOfText(html, '>General</button>')
  const ratingModelIndex = indexOfText(html, '>Rating Model</button>')
  const gameContextIndex = indexOfText(html, '>Game Context</button>')
  const bettingIndex = indexOfText(html, '>Betting</button>')
  const dataResetIndex = indexOfText(html, '>Data &amp; Reset</button>')

  assert.ok(generalIndex < ratingModelIndex)
  assert.ok(ratingModelIndex < gameContextIndex)
  assert.ok(gameContextIndex < bettingIndex)
  assert.ok(bettingIndex < dataResetIndex)
  assert.match(html, /role="tablist"/)
  assert.match(html, /aria-selected="true"[^>]*data-settings-tab="general"/)
})

test('each Settings tab exposes its owned content without duplicating controls', () => {
  const generalHtml = renderSettings({ initialTab: 'general' })
  const ratingHtml = renderSettings({ initialTab: 'rating-model' })
  const contextHtml = renderSettings({ initialTab: 'game-context' })
  const bettingHtml = renderSettings({ initialTab: 'betting' })
  const resetHtml = renderSettings({ initialTab: 'data-reset' })

  assert.match(generalHtml, /id="settings-tab-panel-general" role="tabpanel"/)
  assert.match(ratingHtml, /data-active-settings-tab="rating-model"/)
  assert.match(
    ratingHtml,
    /data-setting-group="rating-model"[\s\S]*Base Home Advantage/,
  )
  assert.match(ratingHtml, /Maximum Goalie Penalty/)
  assert.match(ratingHtml, /Maximum Player Injury Penalty/)
  assert.match(ratingHtml, /Rating Model engine settings/)
  assert.match(contextHtml, /data-active-settings-tab="game-context"/)
  assert.match(contextHtml, /data-setting-group="game-context"/)
  assert.match(contextHtml, /Rest &amp; Fatigue/)
  assert.match(contextHtml, /Quick Rematch \/ Revenge/)
  assert.match(contextHtml, /Special Teams Matchup Mode/)
  assert.match(
    bettingHtml,
    /id="betting-staking-settings"[^>]*aria-labelledby="settings-tab-betting"/,
  )
  assert.match(resetHtml, /id="settings-tab-panel-data-reset" role="tabpanel"/)
  assert.equal(
    (ratingHtml.match(/id="engine-setting-homeAdvantage"/g) ?? []).length,
    1,
  )
  assert.equal(
    (contextHtml.match(/id="special-teams-rank-threshold"/g) ?? []).length,
    1,
  )
})

test('tab views retain one shared settings draft and explicit save ownership', async () => {
  const ratingHtml = renderSettings({ initialTab: 'rating-model' })
  const contextHtml = renderSettings({ initialTab: 'game-context' })
  const ratingValue = ratingHtml.match(
    /id="engine-setting-homeAdvantage"[^>]*value="([^"]+)"/,
  )?.[1]
  const contextValue = contextHtml.match(
    /id="engine-setting-homeAdvantage"[^>]*value="([^"]+)"/,
  )?.[1]
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../components/Settings.jsx', import.meta.url), 'utf8'),
  )

  assert.equal(ratingValue, '3.50')
  assert.equal(contextValue, ratingValue)
  assert.match(ratingHtml, /Save Rating Model/)
  assert.match(contextHtml, /Save Game Context/)
  assert.match(source, /ownedRatingFields\.includes\(field\)/)
  assert.match(source, /savedSettings\[field\]/)
})

test('Data & Reset renders three increasing reset levels and scope guidance', () => {
  const html = renderSettings({ initialTab: 'data-reset' })

  assert.match(html, /Reset Settings to Defaults/)
  assert.match(html, /Reset for New Season/)
  assert.match(html, /Factory Reset \/ Delete All Data/)
  assert.match(html, /Starting Rating Scale returns to 42–50/)
  assert.match(html, /current scale is preserved and unlocked/)
  assert.match(html, /Shared historical datasets and provider caches stay intact/)
})

test('Database Storage renders an accessible initial loading state', () => {
  const html = renderSettings({ initialTab: 'data-reset' })

  assert.match(html, /<h3 id="database-storage-heading">Database Storage<\/h3>/)
  assert.match(html, /role="status"[^>]*>[\s\S]*Checking Atlas storage usage/)
  assert.match(html, /class="database-storage-refresh" disabled=""/)
})

test('Database Storage renders formatted quota usage and progress metadata', () => {
  const mebibyte = 1024 ** 2
  const html = renderSettings({
    initialDatabaseStorage: {
      available: true,
      cached: false,
      checkedAt: '2026-09-01T06:42:00.000Z',
      dataBytes: 60.4 * mebibyte,
      indexBytes: 22 * mebibyte,
      limitBytes: 512 * mebibyte,
      percentUsed: 16.1,
      remainingBytes: 429.6 * mebibyte,
      usedBytes: 82.4 * mebibyte,
    },
    initialTab: 'data-reset',
  })

  assert.match(html, /<strong>82\.4 MB<\/strong><span> \/ 512 MB<\/span>/)
  assert.match(html, /16\.1% used/)
  assert.match(html, /<dt>Available<\/dt><dd>429\.6 MB<\/dd>/)
  assert.match(html, /<dt>Data<\/dt><dd>60\.4 MB<\/dd>/)
  assert.match(html, /<dt>Indexes<\/dt><dd>22 MB<\/dd>/)
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-label="Database storage used"/)
  assert.match(html, /aria-valuenow="16\.1"/)
  assert.match(html, /aria-valuetext="16\.1% used"/)
  assert.match(html, /Capacity healthy/)
  assert.match(html, /monitoring does not delete or change data/)
})

test('Database Storage warning thresholds include readable non-color labels', () => {
  assert.deepEqual(databaseStorageUtils.getStorageUsageState(69.99), {
    label: 'Capacity healthy',
    tone: 'normal',
  })
  assert.deepEqual(databaseStorageUtils.getStorageUsageState(70), {
    label: 'Storage usage warning',
    tone: 'warning',
  })
  assert.deepEqual(databaseStorageUtils.getStorageUsageState(85), {
    label: 'Storage usage high',
    tone: 'high',
  })
  assert.deepEqual(databaseStorageUtils.getStorageUsageState(95), {
    label: 'Storage usage critical',
    tone: 'critical',
  })

  const html = renderSettings({
    initialDatabaseStorage: {
      available: true,
      checkedAt: '2026-09-01T06:42:00.000Z',
      dataBytes: null,
      indexBytes: null,
      limitBytes: 1000,
      percentUsed: 85,
      remainingBytes: 150,
      usedBytes: 850,
    },
    initialTab: 'data-reset',
  })

  assert.match(html, /database-storage-card-high/)
  assert.match(html, /Storage usage high/)
})

test('Database Storage renders unsupported and request-error states honestly', () => {
  const unavailableHtml = renderSettings({
    initialDatabaseStorage: {
      available: false,
      checkedAt: '2026-09-01T06:42:00.000Z',
      limitBytes: 512 * 1024 ** 2,
      message:
        'MongoDB Atlas does not expose a reliable quota-usage value through the current database connection.',
      percentUsed: null,
      remainingBytes: null,
      usedBytes: null,
    },
    initialTab: 'data-reset',
  })
  const errorHtml = renderSettings({
    initialDatabaseStorageError: 'Network error. Check your connection and try again.',
    initialTab: 'data-reset',
  })

  assert.match(unavailableHtml, /Database storage usage unavailable/)
  assert.match(unavailableHtml, /does not expose a reliable quota-usage value/)
  assert.match(unavailableHtml, /Configured capacity: 512 MB/)
  assert.doesNotMatch(unavailableHtml, /role="progressbar"/)
  assert.match(errorHtml, /role="alert"/)
  assert.match(errorHtml, /Unable to check database storage/)
  assert.match(errorHtml, /Network error/)
})

test('Database Storage API uses authenticated GETs and refresh bypass explicitly', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('storage-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body,
      headers: options.headers,
      method: options.method,
      url,
    })

    return new Response(
      JSON.stringify({
        available: true,
        checkedAt: '2026-09-01T06:42:00.000Z',
        limitBytes: 512,
        percentUsed: 1,
        remainingBytes: 500,
        usedBytes: 12,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }

  try {
    await databaseStorageApi.getDatabaseStorage()
    await databaseStorageApi.getDatabaseStorage({ refresh: true })
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    capturedRequests.map(({ url }) => url),
    ['/api/settings/storage', '/api/settings/storage?refresh=true'],
  )
  assert.equal(
    capturedRequests.every(
      ({ headers }) => headers.get('Authorization') === 'Bearer storage-token',
    ),
    true,
  )
  assert.equal(
    capturedRequests.every(({ body, method }) => body === undefined && !method),
    true,
  )
})

test('destructive reset confirmations enforce their intended safeguards', () => {
  const settingsHtml = renderSettings({ initialResetDialog: 'settings' })
  const seasonHtml = renderSettings({ initialResetDialog: 'new-season' })
  const wrongFactoryHtml = renderSettings({
    initialFactoryConfirmation: 'reset',
    initialResetDialog: 'factory',
  })
  const exactFactoryHtml = renderSettings({
    initialFactoryConfirmation: 'DELETE',
    initialResetDialog: 'factory',
  })
  const findDeleteButton = (html) =>
    [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
      .map(([button]) => button)
      .find((button) => button.includes('Delete all user data'))
  const wrongDeleteButton = findDeleteButton(wrongFactoryHtml)
  const exactDeleteButton = findDeleteButton(exactFactoryHtml)

  assert.match(settingsHtml, /Reset settings to defaults\?/)
  assert.match(settingsHtml, /will not be deleted/)
  assert.match(seasonHtml, /Prepare NHL Edge for a new season\?/)
  assert.match(seasonHtml, /will be preserved/)
  assert.match(wrongFactoryHtml, /Type <strong>DELETE<\/strong> to continue/)
  assert.ok(wrongDeleteButton)
  assert.match(wrongDeleteButton, /disabled/)
  assert.ok(exactDeleteButton)
  assert.doesNotMatch(exactDeleteButton, /disabled/)
  assert.match(exactFactoryHtml, />Cancel<\/button>/)
})

test('reset API calls are authenticated and never accept a client userId', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('reset-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method,
      url,
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await userDataResetApi.resetSettingsToDefaults()
    await userDataResetApi.resetForNewSeason()
    await userDataResetApi.factoryResetUserData('DELETE')
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    capturedRequests.map(({ url }) => url),
    [
      '/api/settings/reset/settings',
      '/api/settings/reset/new-season',
      '/api/settings/reset/factory',
    ],
  )
  assert.equal(capturedRequests.every(({ method }) => method === 'POST'), true)
  assert.equal(
    capturedRequests.every(
      ({ headers }) => headers.get('Authorization') === 'Bearer reset-token',
    ),
    true,
  )
  assert.deepEqual(capturedRequests[2].body, { confirmation: 'DELETE' })
  assert.equal(
    capturedRequests.some(({ body }) => Object.hasOwn(body ?? {}, 'userId')),
    false,
  )
})

test('season reset clears only documented browser-local operational state', () => {
  const originalWindow = globalThis.window
  const values = new Map([
    ['nhl-edge-auth-token', 'keep-authenticated'],
    ['nhl-edge-dashboard-market-odds', '{}'],
    ['nhl-edge-power-ratings', '{}'],
    ['nhl-edge-saved-analyses', '[]'],
    ['nhl-edge-sidebar-collapsed', 'true'],
  ])

  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    },
  }

  try {
    assert.equal(userDataResetUtils.clearSeasonOperationalStorage(), 3)
  } finally {
    globalThis.window = originalWindow
  }

  assert.equal(values.has('nhl-edge-dashboard-market-odds'), false)
  assert.equal(values.has('nhl-edge-power-ratings'), false)
  assert.equal(values.has('nhl-edge-saved-analyses'), false)
  assert.equal(values.get('nhl-edge-auth-token'), 'keep-authenticated')
  assert.equal(values.get('nhl-edge-sidebar-collapsed'), 'true')
})

test('Model Adjustments exposes the current automatic adjustment controls', () => {
  const html = renderSettings()

  ;[
    'Home Advantage',
    'Base Home Advantage',
    'Well Rested',
    '3 Games in 4 Days',
    'Back-to-Back',
    'Back-to-Back \\+ Travel',
    'Quick Rematch',
    'Previous Loser Adjustment',
  ].forEach((label) => {
    assert.match(html, new RegExp(label))
  })

  assert.doesNotMatch(html, /4 Games in 6 Days/)
  assert.doesNotMatch(html, /Back-to-Back Home/)
  assert.doesNotMatch(html, /Back-to-Back Away/)
  assert.doesNotMatch(html, /Revenge Game/)
  assert.doesNotMatch(html, /individual goalie/i)
  assert.doesNotMatch(html, /manual X-factor/i)
})

test('Home Advantage keeps one concise explanation and its effective formula', () => {
  const html = renderSettings()
  const matches = html.match(/id="engine-setting-homeAdvantage"/g) ?? []

  assert.equal(matches.length, 1)
  assert.match(
    html,
    /id="engine-setting-homeAdvantage"[^>]*form="settings-model-adjustments-form"/,
  )
  assert.match(html, /Save Rating Model/)
  assert.match(
    html,
    /Global home advantage applied before the team-specific Home Adjustment/,
  )
  assert.match(
    html,
    /Effective Home Advantage<\/strong><span>= Base Home Advantage \+ Team Home Adjustment/,
  )
  assert.doesNotMatch(html, /Save ownership: Base Home Advantage/)
  assert.doesNotMatch(html, /Team Home Adjustment remains on the/)
})

test('Rest and Quick Rematch explanatory behavior renders compactly', () => {
  const html = renderSettings()

  assert.match(html, /Enable Rest &amp; Fatigue Adjustments/)
  assert.match(
    html,
    /Back-to-Back \+ Travel &gt; Back-to-Back &gt; 3 Games in 4 Days &gt; Well Rested/,
  )
  assert.match(html, /Zero or one rest\/fatigue rule is applied/)
  assert.match(html, /Independent and additive/)
  assert.match(html, /Regulation, overtime, and shootout losses are treated equally/)
  assert.match(html, /Total context adjustment/)
  assert.equal(
    (
      html.match(
        /Consecutive-day games where both games are home games, or both games are away against the same home team/g,
      ) ?? []
    ).length,
    1,
  )
  assert.equal(
    (
      html.match(
        /All other known consecutive-day transitions, including home to away, away to home, and away to away against different home teams/g,
      ) ?? []
    ).length,
    1,
  )
  assert.doesNotMatch(html, /Back-to-Back meanings/)
  assert.match(
    html,
    /id="model-adjustment-wellRestedAdjustment"[^>]*disabled/,
  )
  assert.match(
    html,
    /class="settings-quick-fields"[\s\S]*id="quick-rematch-maximum-days"[\s\S]*id="quick-rematch-loser-adjustment"/,
  )
  assert.match(
    html,
    /id="quick-rematch-maximum-days"[^>]*type="number"[^>]*min="1"[^>]*max="14"[^>]*step="1"[^>]*value="5"/,
  )
})

test('Game Context exposes persisted Special Teams mode and adjustment controls', () => {
  const html = renderSettings()

  assert.match(html, /Special Teams Matchup Mode/)
  assert.match(html, /<option value="off">Off<\/option>/)
  assert.match(html, /<option value="alert_only" selected="">Alert only<\/option>/)
  assert.match(html, /<option value="automatic">Automatic adjustment<\/option>/)
  assert.match(
    html,
    /id="special-teams-rank-threshold"[^>]*min="3"[^>]*max="12"[^>]*value="6"/,
  )
  assert.match(html, /Top\/Bottom 6 means ranks 1–6 and 27–32/)
  assert.match(html, /id="special-teams-adjustment"/)
  assert.match(html, /0\.50 rating points/)
  assert.match(html, /Alert only shows the matchup without changing ratings/)
  assert.match(html, /Historical calibration showed only a small improvement/)
})

test('Maximum Goalie Penalty is a dedicated Model Adjustments card', () => {
  const html = renderSettings()
  const modelIndex = indexOfText(
    html,
    '<h2 id="settings-model-adjustments-heading">Rating Model</h2>',
  )
  const goalieIndex = indexOfText(html, '>Goalie</h3>')
  const engineIndex = indexOfText(html, '>Power Rating Engine</h2>')

  assert.ok(modelIndex < goalieIndex)
  assert.ok(goalieIndex < engineIndex)
  assert.match(html, /Global safety limit for goalie downgrades/)
  assert.match(
    html,
    /id="engine-setting-maximumGoaliePenalty"[^>]*form="settings-model-adjustments-form"[^>]*type="number"[^>]*min="-5"[^>]*max="0"[^>]*step="any"[^>]*value="-4\.00"/,
  )
  assert.match(html, /0\.00 is the baseline/)
  assert.match(html, /positive goalie adjustments are not used/)
  assert.match(html, /<summary>How this works<\/summary>/)
  assert.match(html, /Power Rating already reflects its normal #1 goalie/)
  assert.doesNotMatch(html, /Save ownership: Maximum Goalie Penalty/)
})

test('Maximum Player Injury Penalty is a dedicated Model Adjustments card', () => {
  const html = renderSettings()
  const modelIndex = indexOfText(
    html,
    '<h2 id="settings-model-adjustments-heading">Rating Model</h2>',
  )
  const injuryIndex = indexOfText(html, '>Injury</h3>')
  const engineIndex = indexOfText(html, '>Power Rating Engine</h2>')

  assert.ok(modelIndex < injuryIndex)
  assert.ok(injuryIndex < engineIndex)
  assert.match(html, /Individual skater injury guardrail/)
  assert.match(
    html,
    /id="engine-setting-maximumPlayerInjuryPenalty"[^>]*form="settings-model-adjustments-form"[^>]*type="number"[^>]*min="-5"[^>]*max="0"[^>]*step="0.5"[^>]*value="-2.50"/,
  )
  assert.match(html, /largest downgrade for one absent skater/)
  assert.match(html, /0\.00 means the player is adequately replaceable/)
  assert.match(html, /Multiple active injuries may sum beyond the one-player maximum/)
  assert.doesNotMatch(html, /Save ownership: Maximum Player Injury Penalty/)
})

test('General presents account identity once in one read-only Account section', () => {
  const html = renderSettings({ initialTab: 'general' })

  assert.match(html, /<h2>Account<\/h2>/)
  assert.match(html, /<span>Read-only<\/span>/)
  assert.equal((html.match(/class="profile-summary"/g) ?? []).length, 1)
  assert.equal((html.match(/class="profile-account-details"/g) ?? []).length, 1)
  assert.match(html, /<dt>[\s\S]*Name<\/dt>/)
  assert.match(html, /<dt>[\s\S]*Email<\/dt>/)
  assert.match(html, /Authentication provider/)
  assert.doesNotMatch(html, /class="profile-grid"/)
})

test('numeric Settings controls expose server-aligned browser constraints', () => {
  const html = renderSettings()

  ;[
    'engine-setting-homeAdvantage',
    'engine-setting-maximumGoaliePenalty',
    'engine-setting-maximumPlayerInjuryPenalty',
    'engine-setting-kFactor',
    'engine-setting-regulationMultiplier',
    'engine-setting-overtimeMultiplier',
    'engine-setting-shootoutMultiplier',
    'model-adjustment-wellRestedAdjustment',
    'model-adjustment-threeInFourAdjustment',
    'model-adjustment-backToBackAdjustment',
    'model-adjustment-backToBackTravelAdjustment',
    'quick-rematch-maximum-days',
    'quick-rematch-loser-adjustment',
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="number"`))
  })

  assert.match(
    html,
    /id="engine-setting-homeAdvantage"[^>]*min="0"[^>]*max="15"[^>]*step="any"[^>]*value="3\.50"/,
  )
  assert.match(
    html,
    /id="special-teams-rank-threshold"[^>]*type="number"[^>]*min="3"[^>]*max="12"[^>]*step="1"[^>]*value="6"/,
  )
})

test('Bankroll Basis owns sizing help while Bankroll Reference stays read-only', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../components/Settings.jsx', import.meta.url), 'utf8'),
  )
  const basisIndex = source.indexOf('<span>Bankroll Basis</span>')
  const helperIndex = source.indexOf(
    'Choose which bankroll balance future stake sizing uses.',
  )
  const referenceIndex = source.indexOf('<h3>Bankroll Reference</h3>')

  assert.notEqual(basisIndex, -1)
  assert.notEqual(helperIndex, -1)
  assert.notEqual(referenceIndex, -1)
  assert.ok(basisIndex < helperIndex)
  assert.ok(helperIndex < referenceIndex)
  assert.doesNotMatch(source, /Choose which bankroll balance future stake sizing references/)
})

test('Power Rating Engine keeps only Probability Scale in Advanced Model Settings', () => {
  const html = renderSettings()
  const advancedMarkup = html.match(
    /<details class="settings-advanced-model">[\s\S]*?<\/details>/,
  )?.[0]

  assert.match(html, /Rating Update Sensitivity/)
  assert.match(html, /Result Multipliers/)
  assert.match(html, /K Factor/)
  assert.match(html, /Regulation Multiplier/)
  assert.match(html, /Overtime Multiplier/)
  assert.match(html, /Shootout Multiplier/)
  assert.match(html, /id="engine-setting-homeAdvantage"[^>]*value="3\.50"/)
  assert.match(html, /id="engine-setting-kFactor"[^>]*value="1\.30"/)
  assert.match(html, /id="engine-setting-regulationMultiplier"[^>]*value="1\.00"/)
  assert.match(html, /id="engine-setting-overtimeMultiplier"[^>]*value="0\.40"/)
  assert.match(html, /id="engine-setting-shootoutMultiplier"[^>]*value="0\.10"/)
  assert.match(html, /Calibrated Base Model v1/)
  assert.match(html, /Defaults were calibrated using multi-season historical Rating/)
  assert.match(html, /<details class="settings-advanced-model">/)
  assert.match(html, /Advanced Model Settings/)
  assert.ok(advancedMarkup)
  assert.match(advancedMarkup, /Probability Scale/)
  assert.doesNotMatch(advancedMarkup, /Maximum Goalie Penalty/)
  assert.doesNotMatch(advancedMarkup, /Maximum Player Injury Penalty/)
  assert.match(html, /value="20"/)
  assert.doesNotMatch(html, /<details class="settings-advanced-model" open/)
})

test('Settings source keeps Model Adjustments and engine save ownership separate', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../components/Settings.jsx', import.meta.url), 'utf8'),
  )

  assert.match(source, /updateRatingEngineModelAdjustments/)
  assert.match(source, /updateRatingEngineParameters/)
  assert.match(source, /hasUnsavedRatingModelAdjustments/)
  assert.match(source, /hasUnsavedGameContextEngineChanges/)
  assert.match(source, /hasUnsavedModelAdjustmentChanges/)
  assert.match(source, /RATING_MODEL_ADJUSTMENT_KEYS = Object\.freeze/)
  assert.match(source, /'maximumGoaliePenalty'/)
  assert.match(source, /'maximumPlayerInjuryPenalty'/)
  assert.match(source, /GAME_CONTEXT_ENGINE_SETTING_KEYS = Object\.freeze/)
  assert.match(source, /ownedRatingFields\.includes\(field\)/)
  assert.doesNotMatch(source, /updateRatingEngineSettings\(parsedDraft\.settings\)/)
})

test('schedule adjustment draft validation rejects unsafe numeric values', () => {
  const draft =
    quickRematchSettingsUtils.createQuickRematchSettingsDraft(
      quickRematchSettingsUtils.DEFAULT_QUICK_REMATCH_SETTINGS,
    )
  const invalid =
    quickRematchSettingsUtils.parseQuickRematchSettingsDraft({
      ...draft,
      backToBackAdjustment: '',
      quickRematchLoserAdjustment: 'Infinity',
      quickRematchMaximumDays: '2.5',
    })
  const comma =
    quickRematchSettingsUtils.parseQuickRematchSettingsDraft({
      ...draft,
      quickRematchLoserAdjustment: '0,30',
      quickRematchMaximumDays: '7',
    })

  assert.equal(invalid.isValid, false)
  assert.match(invalid.fieldErrors.backToBackAdjustment, /required/)
  assert.match(
    invalid.fieldErrors.quickRematchLoserAdjustment,
    /finite number/,
  )
  assert.match(invalid.fieldErrors.quickRematchMaximumDays, /integer/)
  assert.equal(comma.isValid, true)
  assert.equal(comma.settings.quickRematchLoserAdjustment, 0.3)
  assert.equal(JSON.stringify(comma).includes('NaN'), false)
  assert.equal(JSON.stringify(invalid).includes('Infinity'), false)
})

test('Market Odds status card renders safe provider and quota metadata', () => {
  const html = renderSettings({
    initialMarketOddsStatus: {
      configuration: {
        cacheTtlMs: 600000,
        configured: true,
        market: 'Moneyline',
        provider: 'The Odds API',
        region: 'EU',
        sport: 'NHL',
      },
      lastSuccessfulFetch: '2026-08-03T12:00:00.000Z',
      quota: { lastCost: 1, remaining: 80, used: 20 },
      status: 'ready',
    },
  })

  assert.match(html, /External data/)
  assert.match(html, /Market Odds/)
  assert.match(html, /Provider<\/dt><dd>The Odds API/)
  assert.match(html, /Configuration<\/dt><dd>Connected/)
  assert.match(html, /Sport<\/dt><dd>NHL/)
  assert.match(html, /Region<\/dt><dd>EU/)
  assert.match(html, /Market<\/dt><dd>Moneyline/)
  assert.match(html, /Cache TTL<\/dt><dd>10 min/)
  assert.match(html, /Credits Used<\/dt><dd>20/)
  assert.match(html, /Credits Remaining<\/dt><dd>80/)
  assert.match(html, /Last Request Cost<\/dt><dd>1/)
  assert.doesNotMatch(html, /THE_ODDS_API_KEY|secret|api key/i)
})

test('Market Odds status card renders not-configured state without quota noise', () => {
  const html = renderSettings({
    initialMarketOddsStatus: {
      configuration: {
        cacheTtlMs: 600000,
        configured: false,
        market: 'Moneyline',
        provider: 'The Odds API',
        region: 'EU',
        sport: 'NHL',
      },
      lastSuccessfulFetch: null,
      quota: null,
      status: 'not_configured',
    },
  })

  assert.match(html, /Configuration<\/dt><dd>Not configured/)
  assert.match(html, /Credits Used<\/dt><dd>--/)
  assert.match(html, /Current Status<\/dt><dd>Provider unavailable/)
})

test('Preferred Bookmakers renders every available bookmaker enabled by default', () => {
  const html = renderSettings({
    initialBookmakerPreferences: {
      availableBookmakers: [
        { bookmakerKey: 'book-a', bookmakerTitle: 'Book A' },
        { bookmakerKey: 'book-b', bookmakerTitle: 'Book B' },
      ],
      disabledBookmakerKeys: [],
      enabledBookmakerKeys: ['book-a', 'book-b'],
      fallbackApplied: false,
      warning: null,
    },
  })

  assert.match(html, /Preferred Bookmakers/)
  assert.match(html, /Book A/)
  assert.match(html, /Book B/)
  assert.equal((html.match(/type="checkbox" checked=""/g) ?? []).length >= 2, true)
  assert.match(html, /Save Preferred Bookmakers/)
})

test('Preferred Bookmakers shows empty and all-disabled fallback states', () => {
  const emptyHtml = renderSettings({
    initialBookmakerPreferences: {
      availableBookmakers: [],
      disabledBookmakerKeys: [],
      enabledBookmakerKeys: [],
      fallbackApplied: false,
      warning: null,
    },
  })
  const warning =
    'At least one bookmaker must be enabled. All bookmakers have been enabled automatically.'
  const fallbackHtml = renderSettings({
    initialBookmakerPreferences: {
      availableBookmakers: [
        { bookmakerKey: 'book-a', bookmakerTitle: 'Book A' },
      ],
      disabledBookmakerKeys: [],
      enabledBookmakerKeys: ['book-a'],
      fallbackApplied: true,
      warning,
    },
  })

  assert.match(
    emptyHtml,
    /Bookmakers will appear after market odds have been loaded\./,
  )
  assert.match(fallbackHtml, new RegExp(warning.replaceAll('.', '\\.')))
})
