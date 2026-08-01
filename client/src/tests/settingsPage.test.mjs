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

const renderSettings = () =>
  renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(Settings, null),
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
