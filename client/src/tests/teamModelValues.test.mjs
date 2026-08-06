import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let calculateGame
let components
let teamsApi
let utils
let vite

const roster = {
  defensemen: [
    { fullName: 'Defense One', id: 201, position: 'D', sweaterNumber: '4' },
    { fullName: 'Defense Two', id: 202, position: 'D', sweaterNumber: '6' },
    { fullName: 'Defense Three', id: 203, position: 'D', sweaterNumber: '8' },
  ],
  forwards: [
    { fullName: 'Forward One', id: 101, position: 'C', sweaterNumber: '12' },
    { fullName: 'Forward Two', id: 102, position: 'L', sweaterNumber: '18' },
    { fullName: 'Forward Three', id: 103, position: 'R', sweaterNumber: '88' },
    { fullName: 'Forward Four', id: 104, position: 'C', sweaterNumber: '19' },
    { fullName: 'Forward Five', id: 105, position: 'L', sweaterNumber: '21' },
  ],
  goalies: [
    { fullName: 'Goalie Must Not Appear', id: 301, position: 'G' },
  ],
}

const configuredModelValues = {
  defensePairs: [
    { leftDefensePlayerId: 201, pairNumber: 1, rightDefensePlayerId: 202 },
    { leftDefensePlayerId: 203, pairNumber: 2, rightDefensePlayerId: null },
    { leftDefensePlayerId: 202, pairNumber: 3, rightDefensePlayerId: 201 },
  ],
  forwardLines: [
    {
      centerPlayerId: 101,
      leftWingPlayerId: 102,
      lineNumber: 1,
      rightWingPlayerId: 103,
    },
    {
      centerPlayerId: 104,
      leftWingPlayerId: 105,
      lineNumber: 2,
      rightWingPlayerId: null,
    },
    {
      centerPlayerId: null,
      leftWingPlayerId: 103,
      lineNumber: 3,
      rightWingPlayerId: null,
    },
    { centerPlayerId: null, leftWingPlayerId: null, lineNumber: 4, rightWingPlayerId: null },
  ],
  lineupNote: 'Top six likely to change',
  teamId: 'BOS',
  updatedAt: '2026-08-05T10:00:00.000Z',
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  components = await vite.ssrLoadModule('/src/components/TeamModelValues.jsx')
  teamsApi = await vite.ssrLoadModule('/src/services/teamsApi.js')
  utils = await vite.ssrLoadModule('/src/utils/teamModelValues.js')
  calculateGame = (
    await vite.ssrLoadModule('/src/utils/calculateGame.js')
  ).calculateGame
})

after(async () => {
  await vite?.close()
})

test('Model Values card is placed after Special Teams and before provider rosters', async () => {
  const source = await readFile(
    new URL('../components/Teams.jsx', import.meta.url),
    'utf8',
  )
  const detailsSource = source.slice(source.indexOf('function TeamDetails'))
  const specialTeamsIndex = detailsSource.indexOf('<SpecialTeamsSection')
  const modelValuesIndex = detailsSource.indexOf('<TeamModelValues')
  const rosterIndex = detailsSource.indexOf("{rosterStatus === 'loading'")

  assert.ok(specialTeamsIndex >= 0)
  assert.ok(modelValuesIndex > specialTeamsIndex)
  assert.ok(rosterIndex > modelValuesIndex)
})

test('read-only summary has one shared action and renders all saved values', () => {
  const markup = renderToStaticMarkup(
    React.createElement(components.ModelValuesCard, {
      feedbackMessage: 'Lines saved.',
      goalieAdjustments: [
        { cachedDisplayName: 'Goalie One', nhlPlayerId: 301, ratingAdjustment: 1.25 },
        { cachedDisplayName: 'Goalie Two', nhlPlayerId: 302, ratingAdjustment: -0.5 },
        { cachedDisplayName: 'Goalie Three', nhlPlayerId: 303, ratingAdjustment: 0 },
      ],
      goalieAdjustmentStatus: 'success',
      modelValues: configuredModelValues,
      onManageModelValues() {},
      onRetry() {},
      roster,
    }),
  )

  assert.match(markup, /User-maintained Model Values/i)
  assert.match(markup, /Optional personal lineup notes\. Does not affect model calculations\./)
  assert.match(markup, /3 configured/)
  assert.match(markup, /Goalie One/)
  assert.match(markup, /\+1\.25/)
  assert.match(markup, /L1/)
  assert.match(markup, /Forward One/)
  assert.match(markup, /L2/)
  assert.match(markup, /L3/)
  assert.match(markup, /L4/)
  assert.match(markup, /Forward Five[^<]*–[^<]*Forward Four[^<]*–[^<]*—/)
  assert.match(markup, /D1/)
  assert.match(markup, /D2/)
  assert.match(markup, /D3/)
  assert.match(markup, /Team Notes/)
  assert.match(markup, /Top six likely to change/)
  assert.equal((markup.match(/<button/g) ?? []).length, 1)
  assert.equal((markup.match(/Manage Model Values/g) ?? []).length, 1)
  assert.doesNotMatch(markup, /Edit Lines|Edit Notes|>Manage<\/button>/)
  assert.match(markup, /model-values-lineup-grid/)
  assert.match(markup, /model-values-forward-column/)
  assert.match(markup, /model-values-defense-column/)

  const goalieIndex = markup.indexOf('Goalie Adjustments')
  const lineupGridIndex = markup.indexOf('model-values-lineup-grid')
  const forwardIndex = markup.indexOf('model-values-forward-column')
  const defenseIndex = markup.indexOf('model-values-defense-column')
  const notesIndex = markup.indexOf('Team Notes')

  assert.ok(goalieIndex < lineupGridIndex)
  assert.ok(lineupGridIndex < forwardIndex)
  assert.ok(forwardIndex < defenseIndex)
  assert.ok(defenseIndex < notesIndex)
})

test('empty summary reports optional lineup sections as not configured', () => {
  const markup = renderToStaticMarkup(
    React.createElement(components.ModelValuesCard, {
      goalieAdjustments: [],
      goalieAdjustmentStatus: 'success',
      modelValues: utils.normalizeTeamModelValues({}, 'LAK'),
      onManageModelValues() {},
      onRetry() {},
      roster,
    }),
  )

  assert.equal((markup.match(/Not configured/g) ?? []).length, 7)
  assert.match(markup, /Team Notes<\/strong><p[^>]*>No notes/)
  assert.match(markup, /0 configured/)
})

test('the shared card action is wired to the existing modal', async () => {
  const source = await readFile(
    new URL('../components/TeamModelValues.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /onManageModelValues=\{openEditor\}/)
  assert.match(source, /\{isEditorOpen \? \(\s*<LineupEditorModal/)
})

test('shared editor renders four forward lines, three defense pairs, provider selectors, and one note', () => {
  const markup = renderToStaticMarkup(
    React.createElement(components.LineupEditorModal, {
      actionStatus: 'idle',
      goalieAdjustments: [
        {
          cachedDisplayName: 'Configured Goalie',
          nhlPlayerId: 301,
          ratingAdjustment: 0.5,
        },
      ],
      goalieAdjustmentStatus: 'success',
      initialValues: utils.normalizeTeamModelValues({}, 'BOS'),
      onCancel() {},
      onClear() {},
      onManageGoalies() {},
      onSave() {},
      roster,
      teamName: 'Boston Bruins',
    }),
  )

  assert.equal((markup.match(/<legend>Line [1-4]<\/legend>/g) ?? []).length, 4)
  assert.equal((markup.match(/<legend>Pair [1-3]<\/legend>/g) ?? []).length, 3)
  assert.equal(
    (markup.match(/<option value=""[^>]*>Empty<\/option>/g) ?? []).length,
    18,
  )
  assert.match(markup, /Forward One · C · #12/)
  assert.match(markup, /Defense One · D · #4/)
  assert.doesNotMatch(markup, /Goalie Must Not Appear/)
  assert.match(markup, /aria-modal="true"/)
  assert.match(markup, /aria-labelledby="lineup-editor-title"/)
  assert.match(markup, /Manage Model Values - Boston Bruins/)
  assert.match(markup, /maxLength="1500"/)
  assert.match(markup, /Save Lines/)
  assert.match(markup, /Clear Lineup/)
  assert.match(markup, /forward-line-grid/)
  assert.match(markup, /defense-pair-grid/)
  assert.match(markup, /Goalie Adjustments/)
  assert.match(markup, /Configured Goalie/)
  assert.match(markup, /Manage Goalie Adjustments/)
  assert.ok(markup.indexOf('Forward Lines') < markup.indexOf('Defense Pairs'))
  assert.ok(markup.indexOf('Defense Pairs') < markup.indexOf('Team Notes'))
  assert.ok(markup.indexOf('Team Notes') < markup.indexOf('Goalie Adjustments'))
})

test('duplicates warn without blocking and missing saved players remain visible', () => {
  const modelValues = utils.normalizeTeamModelValues({
    defensePairs: [
      { leftDefensePlayerId: 999999, pairNumber: 1 },
    ],
    forwardLines: [
      {
        centerPlayerId: 101,
        leftWingPlayerId: 101,
        lineNumber: 1,
      },
    ],
  }, 'BOS')
  const markup = renderToStaticMarkup(
    React.createElement(components.LineupEditorModal, {
      actionStatus: 'idle',
      initialValues: modelValues,
      onCancel() {},
      onClear() {},
      onSave() {},
      roster,
      teamName: 'Boston Bruins',
    }),
  )

  assert.match(markup, /Duplicate forward selection: Forward One/)
  assert.match(markup, /Saving is allowed/)
  assert.match(markup, /aria-invalid="true"/)
  assert.match(markup, /Unavailable player · ID 999999/)
  assert.doesNotMatch(markup, /disabled="" type="submit"/)
})

test('lineup utilities preserve incomplete rows and identify duplicate IDs', () => {
  const normalized = utils.normalizeTeamModelValues({
    forwardLines: [
      { centerPlayerId: 101, lineNumber: 1 },
      { leftWingPlayerId: 101, lineNumber: 4 },
    ],
  }, 'BOS')
  const payload = utils.getTeamModelValuesPayload(normalized)

  assert.equal(payload.forwardLines.length, 4)
  assert.equal(payload.forwardLines[0].centerPlayerId, 101)
  assert.equal(payload.forwardLines[0].leftWingPlayerId, null)
  assert.equal(payload.defensePairs.length, 3)
  assert.deepEqual(
    utils.getDuplicatePlayerIds(payload.forwardLines, utils.FORWARD_SLOT_FIELDS),
    [101],
  )
})

test('model-values API uses canonical team routes and never sends userId', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ options, url: String(url) })
    return new Response(JSON.stringify({
      modelValues: utils.normalizeTeamModelValues({}, 'LAK'),
      success: true,
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })
  }

  try {
    await teamsApi.fetchTeamModelValues('LAK')
    await teamsApi.saveTeamLines('LAK', {
      defensePairs: [],
      forwardLines: [],
      lineupNote: 'Personal note',
    })
    await teamsApi.clearTeamLines('LAK')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.match(calls[0].url, /\/api\/teams\/LAK\/model-values$/)
  assert.match(calls[1].url, /\/api\/teams\/LAK\/model-values\/lines$/)
  assert.equal(calls[1].options.method, 'PUT')
  assert.equal(Object.hasOwn(JSON.parse(calls[1].options.body), 'userId'), false)
  assert.equal(calls[2].options.method, 'DELETE')
})

test('personal lineup values have no effect on shared game calculations', () => {
  const home = {
    baseRating: 52,
    goalieAdjustment: 1,
    homeAdvantage: 4,
    injuries: -0.5,
    marketOdds: 1.9,
  }
  const away = {
    baseRating: 50,
    goalieAdjustment: 0,
    injuries: 0,
    marketOdds: 2.1,
  }
  const baseline = calculateGame(home, away)
  const withPersonalNotes = calculateGame(
    { ...home, teamModelValues: configuredModelValues },
    { ...away, teamModelValues: utils.normalizeTeamModelValues({}, 'TOR') },
  )

  assert.deepEqual(withPersonalNotes, baseline)
})

test('lineup summary uses a responsive two-column grid without horizontal overflow', async () => {
  const css = await readFile(new URL('../../src/App.css', import.meta.url), 'utf8')
  const mobileRules = css.slice(css.indexOf('@media (max-width: 760px)'))

  assert.match(
    css,
    /\.model-values-lineup-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.35fr\) minmax\(0, 1fr\)/s,
  )
  assert.match(
    css,
    /\.model-values-lineup-grid \.model-values-preview-list li span\s*\{[^}]*overflow-wrap:\s*anywhere/s,
  )
  assert.match(mobileRules, /\.model-values-heading/)
  assert.match(mobileRules, /flex-direction: column/)
  assert.match(mobileRules, /\.model-values-lineup-grid/)
  assert.match(mobileRules, /\.forward-line-grid/)
  assert.match(mobileRules, /\.defense-pair-grid/)
  assert.match(mobileRules, /grid-template-columns: 1fr/)
  assert.match(mobileRules, /\.lineup-modal-backdrop/)
})
