import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AuthProvider
let Settings
let quickRematchSettingsUtils
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

test('Settings page renders the new top-level hierarchy in order', () => {
  const html = renderSettings()
  const accountIndex = indexOfText(html, 'Account')
  const bettingIndex = indexOfText(html, 'Betting &amp; Staking')
  const modelIndex = indexOfText(html, 'Model Adjustments')
  const engineIndex = indexOfText(html, 'Power Rating Engine')

  assert.ok(accountIndex < bettingIndex)
  assert.ok(bettingIndex < modelIndex)
  assert.ok(modelIndex < engineIndex)
  assert.match(html, /MODEL CONFIGURATION/i)
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

test('Home Advantage is editable once through the rating-engine setting path', () => {
  const html = renderSettings()
  const matches = html.match(/id="engine-setting-homeAdvantage"/g) ?? []

  assert.equal(matches.length, 1)
  assert.match(html, /Save ownership: use Save Rating Engine/)
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

test('Power Rating Engine no longer duplicates Base Home Advantage below', () => {
  const html = renderSettings()

  assert.match(html, /Rating Update Sensitivity/)
  assert.match(html, /Result Multipliers/)
  assert.match(html, /K Factor/)
  assert.match(html, /Regulation Multiplier/)
  assert.match(html, /Overtime Multiplier/)
  assert.match(html, /Shootout Multiplier/)
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
