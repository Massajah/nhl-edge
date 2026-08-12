import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let RatingLab
let ScheduleContextCalibration
let vite

const rules = [
  { id: 'well_rested', label: 'Well Rested', productionValue: 0.25, presetValues: [0, 0.1, 0.25, 0.5, 0.75], definition: 'Two or more rest days.' },
  { id: '3_games_in_4_days', label: '3 Games in 4 Days', productionValue: -0.5, presetValues: [0, -0.25, -0.5, -0.75, -1], definition: 'Third game in the four-day window.' },
  { id: 'back_to_back', label: 'Back-to-Back', productionValue: -0.75, presetValues: [0, -0.25, -0.5, -0.75, -1, -1.25], definition: 'Consecutive-day same-location games.' },
  { id: 'back_to_back_travel', label: 'Back-to-Back + Travel', productionValue: -1.25, presetValues: [0, -0.5, -1, -1.5, -2, -2.5, -3, -3.5, -4, -4.5, -5], definition: 'Consecutive-day travel transition.' },
]

const primaryRules = rules.filter((rule) => rule.id !== 'well_rested')
const optionalRules = rules.filter((rule) => rule.id === 'well_rested')
const options = {
  baseline: { name: 'Base Model v1 (Team Home Advantage disabled)' },
  defaultSeasonIds: ['20232024', '20242025', '20252026'],
  maxCustomAdjustment: 3,
  maxAbsoluteCustomAdjustment: 3,
  maxCustomQuickRematchAdjustment: 1,
  maxCustomQuickRematchWindow: 30,
  minCustomAdjustment: -6,
  optionalRules,
  primaryRules,
  quickRematch: {
    adjustmentOptions: [0, 0.1, 0.25, 0.5],
    definition: 'Most recent earlier head-to-head inside Max Days times 24 hours; previous loser only.',
    productionReference: {
      enabled: true,
      loserAdjustment: 0.25,
      maximumDays: 5,
      usingDefaults: true,
    },
    windowOptions: [3, 5, 7, 10, 14],
  },
  rules,
  seasons: ['20232024', '20242025', '20252026'].map((id) => ({
    historicalDataset: { status: 'ready' },
    id,
    label: id,
  })),
}

const makeComparison = ({
  adjustment = 0,
  best = false,
  disabled = false,
  occurrences = 10,
  windowDays = null,
} = {}) => ({
  adjustment,
  averageSeasonBrier: 0.24,
  best,
  delta: { brierScore: adjustment === 0 ? 0 : -0.001, logLoss: adjustment === 0 ? 0 : -0.002 },
  disabled,
  gamesAffected: occurrences === 0 ? 0 : 9,
  gamesAffectedPercentage: occurrences === 0 ? 0 : 0.3,
  metrics: { accuracy: 0.56, brierScore: 0.24, expectedCalibrationError: 0.03, logLoss: 0.67 },
  occurrenceRate: occurrences / 40,
  occurrences,
  seasonResults: [{ delta: { brierScore: 0 }, games: 10, gamesAffected: occurrences === 0 ? 0 : 3, metrics: { brierScore: 0.24, logLoss: 0.67 }, occurrences, priorityCounts: {}, seasonId: '20232024' }],
  seasonsBeatingBaseline: adjustment === 0 ? 0 : 1,
  stability: { level: 'stable' },
  windowDays,
  worstSeason: { brierScore: 0.24, seasonId: '20232024' },
})

const noAdjustments = {
  ...makeComparison({ occurrences: 0 }),
  gamesAffectedPercentage: 0,
}
const selected = {
  ...makeComparison({ adjustment: -0.5, best: true }),
  delta: { brierScore: -0.001, logLoss: -0.002 },
}
const combinedRestFatigueResult = {
  appliedCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, normal: 11, well_rested: 0 },
  configurationSnapshot: {
    adjustments: { '3_games_in_4_days': -0.5, back_to_back: -0.25, back_to_back_travel: -4, well_rested: 0 },
    includeWellRested: false,
  },
  matchedCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, normal: 10, well_rested: 1 },
  noAdjustments,
  priorityCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, normal: 11, well_rested: 0 },
  selected,
  teamGameCount: 20,
}
const quickBaseline = makeComparison({ disabled: true, occurrences: 0 })
const quickCandidate = makeComparison({ adjustment: 0.25, best: true, occurrences: 4, windowDays: 5 })
const result = {
  combinedRestFatigueResult,
  combinedResult: combinedRestFatigueResult,
  combinedScheduleContextResult: {
    appliedRestFatigueCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, normal: 11, well_rested: 0 },
    matchedRestFatigueCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, normal: 10, well_rested: 1 },
    noAdjustments,
    occurrenceCounts: { '3_games_in_4_days': 3, back_to_back: 4, back_to_back_travel: 2, no_context_adjustment: 10, normal: 11, quick_rematch: 4, well_rested: 0 },
    selected,
    teamGameCount: 20,
  },
  diagnostics: { precedence: ['back_to_back_travel', 'back_to_back', '3_games_in_4_days', 'well_rested'], wellRestedIncludedInCombined: false },
  individualResults: Object.fromEntries(rules.map((rule) => [rule.id, { comparisons: [makeComparison({ occurrences: 0 }), makeComparison({ adjustment: rule.productionValue, best: true })], ruleId: rule.id }])),
  quickRematchResult: {
    bestTestedResult: {
      adjustment: 0.25,
      disabled: false,
      negligibleImprovement: true,
      occurrences: 4,
      seasonsBeatingBaseline: 1,
      smallSample: true,
      windowDays: 5,
    },
    comparisons: [quickBaseline, quickCandidate],
    testedCombinationCount: 20,
  },
  selectedCombinedConfiguration: { '3_games_in_4_days': -0.5, back_to_back: -0.25, back_to_back_travel: -4, well_rested: 0 },
}

before(async () => {
  vite = await createServer({ appType: 'custom', logLevel: 'silent', root: process.cwd(), server: { middlewareMode: true } })
  RatingLab = (await vite.ssrLoadModule('/src/components/RatingLab.jsx')).default
  ScheduleContextCalibration = (await vite.ssrLoadModule('/src/components/ScheduleContextCalibration.jsx')).default
})

after(async () => { await vite?.close() })

test('Rating Lab exposes the production-isolated Schedule & Context workflow', () => {
  const html = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'schedule-context',
    initialScheduleContextOptions: options,
  }))

  assert.match(html, /Schedule &amp; Context/)
  assert.match(html, /Phase 3A/)
  assert.match(html, /Rest &amp; Fatigue/)
  assert.match(html, /Phase 3B/)
  assert.match(html, /Quick Rematch/)
  assert.match(html, /Combined Schedule &amp; Context/)
  assert.match(html, /Base Model v1 \(Team Home Advantage disabled\)/)
  assert.doesNotMatch(html, /Apply to production|Production Apply/)
})

test('Phase 3A keeps the three primary rules separate from optional Well Rested', () => {
  const html = renderToStaticMarkup(React.createElement(ScheduleContextCalibration, { initialOptions: options }))
  const phase3A = html.slice(html.indexOf('Phase 3A'), html.indexOf('Phase 3B'))
  const primarySection = phase3A.slice(0, phase3A.indexOf('Optional Experiments'))

  primaryRules.forEach((rule) => assert.match(primarySection, new RegExp(rule.label.replace('+', '\\+'))))
  assert.doesNotMatch(primarySection, /Well Rested/)
  assert.match(phase3A, /Optional Experiments/)
  assert.match(phase3A, /Well Rested is currently disabled by default in production/)
  assert.match(phase3A, /Include optional Well Rested experiment/)
  assert.equal((phase3A.match(/<select/g) ?? []).length, 3)
  assert.match(phase3A, /Back-to-Back \+ Travel &gt; Back-to-Back &gt; 3 Games in 4 Days &gt; Well Rested/)
  assert.match(
    phase3A,
    /0\.00 · -0\.50 · -1\.00 · -1\.50 · -2\.00 · -2\.50 · -3\.00 · -3\.50 · -4\.00 · -4\.50 · -5\.00/,
  )
  assert.match(phase3A, /type="number" min="-6" max="3"/)
  assert.match(
    phase3A,
    /Extended experimental range because the current historical optimum is below -3\.0\./,
  )
})

test('Phase 3B renders the standard grid, custom values and actual production reference', () => {
  const html = renderToStaticMarkup(React.createElement(ScheduleContextCalibration, { initialOptions: options }))
  const phase3B = html.slice(html.indexOf('Phase 3B'), html.indexOf('Final comparison'))

  assert.match(phase3B, /5 × 4 standard grid/)
  assert.match(phase3B, /<strong>Windows<\/strong> 3, 5, 7, 10, 14 days/)
  assert.match(phase3B, /<strong>Adjustments<\/strong> 0.00, \+0.10, \+0.25, \+0.50/)
  assert.match(phase3B, /<strong>Max Days<\/strong> 5/)
  assert.match(phase3B, /<strong>Previous Loser Adjustment<\/strong> \+0.25/)
  assert.match(phase3B, /canonical defaults/)
  assert.match(phase3B, /Optional custom window/)
  assert.match(phase3B, /Optional custom adjustment/)
  assert.match(phase3B, /Run Quick Rematch grid &amp; Phase 3 comparisons/)
  assert.match(phase3B, /Production definition/)
})

test('results show occurrence diagnostics, per-season details and both combined comparisons', () => {
  const html = renderToStaticMarkup(React.createElement(ScheduleContextCalibration, { initialOptions: options, initialResult: result }))

  assert.match(html, /Primary Rest &amp; Fatigue sweeps/)
  assert.match(html, /Optional Experiments — Well Rested results/)
  assert.match(html, /Combined Rest &amp; Fatigue comparison/)
  assert.match(html, /Quick Rematch grid/)
  assert.match(html, /20 combinations/)
  assert.match(html, /Occurrence rate/)
  assert.match(html, /Best tested result/)
  assert.match(html, /Interpret cautiously/)
  assert.match(html, /Per-season diagnostics/)
  assert.match(html, /Combined Schedule &amp; Context results/)
  assert.match(html, /Fatigue exclusive/)
  assert.match(html, /Quick Rematch additive/)
  assert.match(html, /No context adjustment/)
  assert.match(html, /Configuration used for this run/)
  assert.match(html, /3 Games in 4 Days:[\s\S]*-0\.50/)
  assert.match(html, /Back-to-Back:[\s\S]*-0\.25/)
  assert.match(html, /Back-to-Back \+ Travel:[\s\S]*-4\.00/)
  assert.match(html, /Well Rested:[\s\S]*Disabled/)
  assert.match(html, /Well Rested applied:[\s\S]*0/)
  assert.match(html, /Well Rested detected:[\s\S]*1/)
  assert.match(html, /Applied sum:[\s\S]*20<\/strong> team-games/)
})

test('combined configuration explains additive behavior and never offers production apply', () => {
  const html = renderToStaticMarkup(React.createElement(ScheduleContextCalibration, { initialOptions: options }))

  assert.match(html, /Individual sweep winners are never substituted automatically/)
  assert.match(html, /Quick Rematch is additive to the selected Rest &amp; Fatigue adjustment/)
  assert.match(html, /Well Rested:[\s\S]*Disabled/)
  assert.doesNotMatch(html, /Apply to production|Production Apply/)
})

test('Schedule & Context has explicit loading and error states', () => {
  const loading = renderToStaticMarkup(React.createElement(ScheduleContextCalibration))
  const error = renderToStaticMarkup(React.createElement(ScheduleContextCalibration, { initialErrorMessage: 'Unavailable' }))

  assert.match(loading, /Loading Schedule &amp; Context calibration/)
  assert.match(error, /Schedule &amp; Context calibration is unavailable/)
  assert.match(error, /Unavailable/)
})

test('schedule calibration APIs are authenticated request wrappers for options, run and prepare', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../services/powerRatingSimulationsApi.js', import.meta.url), 'utf8'))
  const componentSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../components/ScheduleContextCalibration.jsx', import.meta.url), 'utf8'))
  assert.match(source, /schedule-context\/options/)
  assert.match(source, /schedule-context\/run/)
  assert.match(source, /schedule-context\/historical-seasons/)
  assert.match(
    componentSource,
    /setRunStatus\('loading'\)\s+setResult\(null\)/,
  )
})
