import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AuthProvider
let Settings
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
  assert.match(contextHtml, /Special Teams Matchup Alerts/)
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
  assert.match(html, /Shared NHL history and provider caches stay intact/)
})

test('destructive reset confirmations enforce their intended safeguards', () => {
  const settingsHtml = renderSettings({ initialResetDialog: 'settings' })
  const seasonHtml = renderSettings({ initialResetDialog: 'new-season' })
  const wrongFactoryHtml = renderSettings({
    initialFactoryConfirmation: 'reset',
    initialResetDialog: 'factory',
  })
  const exactFactoryHtml = renderSettings({
    initialFactoryConfirmation: 'RESET',
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
  assert.match(wrongFactoryHtml, /Type <strong>RESET<\/strong> to continue/)
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
    await userDataResetApi.factoryResetUserData('RESET')
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
  assert.deepEqual(capturedRequests[2].body, { confirmation: 'RESET' })
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

test('Model Adjustments exposes current global automatic model point adjustments', () => {
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

test('Home Advantage is editable once and owned by Rating Model', () => {
  const html = renderSettings()
  const matches = html.match(/id="engine-setting-homeAdvantage"/g) ?? []

  assert.equal(matches.length, 1)
  assert.match(html, /Save ownership: Base Home Advantage is saved with Model/)
  assert.match(
    html,
    /id="engine-setting-homeAdvantage"[^>]*form="settings-model-adjustments-form"/,
  )
  assert.match(html, /Save Rating Model/)
  assert.match(html, /Team Home Adjustment remains on the/)
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
  assert.match(
    html,
    /id="model-adjustment-wellRestedAdjustment"[^>]*disabled/,
  )
})

test('Model Adjustments exposes informational Special Teams alert controls', () => {
  const html = renderSettings()

  assert.match(html, /Special Teams Matchup Alerts/)
  assert.match(html, /Enable Special Teams Matchup Alerts/)
  assert.match(
    html,
    /id="special-teams-rank-threshold"[^>]*min="3"[^>]*max="12"[^>]*value="6"/,
  )
  assert.match(html, /Top\/Bottom 6 means ranks 1–6 and 27–32/)
  assert.match(html, /top-ranked 3-season power play/)
  assert.match(html, /Alerts do not change Power Ratings, model probability/)
  assert.doesNotMatch(html, /Special Teams Rating Adjustment/)
})

test('Maximum Goalie Penalty is a dedicated Model Adjustments card', () => {
  const html = renderSettings()
  const modelIndex = indexOfText(html, 'Model Adjustments')
  const goalieIndex = indexOfText(html, '>Goalie</h3>')
  const engineIndex = indexOfText(html, 'Power Rating Engine')

  assert.ok(modelIndex < goalieIndex)
  assert.ok(goalieIndex < engineIndex)
  assert.match(html, /Global safety limit for goalie downgrades/)
  assert.match(html, /Save ownership: Maximum Goalie Penalty is saved with Model/)
  assert.match(
    html,
    /id="engine-setting-maximumGoaliePenalty"[^>]*form="settings-model-adjustments-form"[^>]*min="-5"[^>]*max="0"[^>]*value="-4\.00"/,
  )
  assert.match(html, /0\.00 is the team baseline/)
  assert.match(html, /Power Rating is assumed to already reflect its normal #1 goalie/)
})

test('Maximum Player Injury Penalty is a dedicated Model Adjustments card', () => {
  const html = renderSettings()
  const modelIndex = indexOfText(html, 'Model Adjustments')
  const injuryIndex = indexOfText(html, '>Injury</h3>')
  const engineIndex = indexOfText(html, 'Power Rating Engine')

  assert.ok(modelIndex < injuryIndex)
  assert.ok(injuryIndex < engineIndex)
  assert.match(html, /Individual skater injury guardrail/)
  assert.match(
    html,
    /id="engine-setting-maximumPlayerInjuryPenalty"[^>]*form="settings-model-adjustments-form"[^>]*min="-5"[^>]*max="0"[^>]*step="0.5"[^>]*value="-2.50"/,
  )
  assert.match(html, /downgrade caused by the player/)
  assert.match(html, /Use 0\.00 when the player is adequately replaceable/)
  assert.match(html, /Multiple active injuries may sum beyond this value/)
  assert.match(
    html,
    /Save ownership: Maximum Player Injury Penalty is saved with/,
  )
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
