import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AdjustmentComparisonModule
let TeamsModule
let calculateGame
let goalieUtils
let modelAnalysis
let savedAnalyses
let teamsApi
let vite

const powerRatings = {
  BOS: { baseRating: 52, teamId: 'BOS' },
  TOR: { baseRating: 50, teamId: 'TOR' },
}

const teams = { away: 'TOR', home: 'BOS' }

const providerGoalie = {
  activeOverride: null,
  adjustmentSource: 'saved',
  displayName: 'Jeremy Swayman',
  fullName: 'Jeremy Swayman',
  hasSavedAdjustment: true,
  id: 8480280,
  nhlPlayerId: 8480280,
  note: 'User adjustment',
  position: 'G',
  ratingAdjustment: 1.25,
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  AdjustmentComparisonModule = await vite.ssrLoadModule(
    '/src/components/AdjustmentComparison.jsx',
  )
  TeamsModule = await vite.ssrLoadModule('/src/components/Teams.jsx')
  calculateGame = (
    await vite.ssrLoadModule('/src/utils/calculateGame.js')
  ).calculateGame
  goalieUtils = await vite.ssrLoadModule('/src/utils/goalies.js')
  modelAnalysis = await vite.ssrLoadModule('/src/utils/modelAnalysis.js')
  savedAnalyses = await vite.ssrLoadModule('/src/utils/savedAnalyses.js')
  teamsApi = await vite.ssrLoadModule('/src/services/teamsApi.js')
})

after(async () => {
  await vite?.close()
})

test('Analyzer goalie inputs default to explicit unknown with zero adjustment', () => {
  const inputs = modelAnalysis.createInputsForTeams(powerRatings, teams)

  assert.equal(inputs.away.goalieSelectionType, 'unknown')
  assert.equal(inputs.home.goalieSelectionType, 'unknown')
  assert.equal(inputs.away.goalieAdjustment, 0)
  assert.equal(inputs.home.goalieConfirmationStatus, 'unknown')
  assert.equal(inputs.home.selectedGoalieId, '')
})

test('provider goalies merge user mappings while missing mappings stay implicit zero', () => {
  const providerGoalies = [
    { fullName: 'Goalie One', id: 1, position: 'G' },
    { fullName: 'Goalie Two', id: 2, position: 'G' },
  ]
  const merged = goalieUtils.mergeProviderGoaliesWithAdjustments(
    providerGoalies,
    [{ nhlPlayerId: 2, note: 'Tracked', ratingAdjustment: -0.75 }],
  )

  assert.deepEqual(
    merged.map(({ hasSavedAdjustment, nhlPlayerId, ratingAdjustment }) => ({
      hasSavedAdjustment,
      nhlPlayerId,
      ratingAdjustment,
    })),
    [
      { hasSavedAdjustment: false, nhlPlayerId: 1, ratingAdjustment: 0 },
      { hasSavedAdjustment: true, nhlPlayerId: 2, ratingAdjustment: -0.75 },
    ],
  )
})

test('provider default and game override resolve to one effective adjustment', () => {
  let values = {
    ...modelAnalysis.defaultGameInputs.home,
    goalieTeamId: 'BOS',
  }
  values = goalieUtils.updateGoalieInputs(
    values,
    'selection',
    'provider:8480280',
    [providerGoalie],
  )

  assert.equal(values.goalieAdjustment, 1.25)
  assert.equal(values.goalieTeamDefaultAdjustment, 1.25)
  assert.equal(values.goalieOverrideEnabled, false)
  assert.equal(values.goalieSelectionType, 'provider_goalie')

  values = goalieUtils.updateGoalieInputs(
    values,
    'manualAdjustment',
    '-0.40',
    [providerGoalie],
  )

  assert.equal(values.goalieAdjustment, -0.4)
  assert.equal(values.goalieOverrideEnabled, true)
  assert.equal(goalieUtils.validateGoalieSelectionInputs(values), '')

  const calculated = calculateGame(
    { baseRating: 50, goalieAdjustment: values.goalieAdjustment },
    { baseRating: 50 },
  )

  assert.equal(calculated.homeFinalRating, 49.6)

  values = goalieUtils.updateGoalieInputs(
    values,
    'resetToTeamDefault',
    true,
    [providerGoalie],
  )
  assert.equal(values.goalieAdjustment, 1.25)
  assert.equal(values.goalieOverrideEnabled, false)
})

test('custom goalie requires one valid adjustment while name stays optional', () => {
  let values = {
    ...modelAnalysis.defaultGameInputs.away,
    goalieTeamId: 'TOR',
  }
  values = goalieUtils.updateGoalieInputs(values, 'selection', 'custom')

  assert.equal(
    goalieUtils.validateGoalieSelectionInputs(values),
    'Game-specific goalie adjustment is required.',
  )

  values = goalieUtils.updateGoalieInputs(values, 'manualAdjustment', '0.03')
  assert.match(goalieUtils.validateGoalieSelectionInputs(values), /0\.05 increments/)

  values = goalieUtils.updateGoalieInputs(values, 'manualAdjustment', '-1.50')
  const payload = goalieUtils.createGoalieSelectionPayload(values, 'TOR')

  assert.equal(goalieUtils.validateGoalieSelectionInputs(values), '')
  assert.equal(payload.displayName, '')
  assert.equal(payload.customNote, '')
  assert.equal(payload.effectiveAdjustment, -1.5)
  assert.equal(payload.selectionType, 'custom')
})

test('persisted provider selection drives inputs without auto-selecting another goalie', () => {
  const gameContext = {
    awayTeam: { abbreviation: 'TOR', teamId: 'TOR' },
    goalieSelections: {
      away: goalieUtils.createUnknownGoalieSelection('TOR'),
      home: goalieUtils.createProviderGoalieSelection(providerGoalie, 'BOS'),
    },
    homeTeam: { abbreviation: 'BOS', teamId: 'BOS' },
  }
  const inputs = modelAnalysis.createInputsForTeams(
    powerRatings,
    teams,
    {},
    {},
    0,
    gameContext,
  )

  assert.equal(inputs.home.goalieNhlPlayerId, 8480280)
  assert.equal(inputs.home.goalieAdjustment, 1.25)
  assert.equal(inputs.away.goalieSelectionType, 'unknown')

  const edited = {
    ...inputs,
    home: goalieUtils.updateGoalieInputs(
      inputs.home,
      'manualAdjustment',
      '-0.25',
    ),
  }
  const refreshed = modelAnalysis.applyTeamRatingsToInputs(
    { ...powerRatings, BOS: { baseRating: 55, teamId: 'BOS' } },
    teams,
    edited,
    {},
    0,
    gameContext,
  )

  assert.equal(refreshed.home.baseRating, 55)
  assert.equal(refreshed.home.goalieAdjustment, -0.25)
  assert.equal(refreshed.home.goalieNhlPlayerId, 8480280)
})

test('saved bet normalization preserves provider provenance and legacy snapshots', () => {
  const snapshot = goalieUtils.createGoalieSelectionPayload(
    goalieUtils.goalieSelectionToInputFields(
      goalieUtils.createProviderGoalieSelection(providerGoalie, 'BOS'),
    ),
    'BOS',
  )
  const normalized = savedAnalyses.normalizeBet({
    adjustments: { homeGoalie: 1.25, homeGoalieName: 'Legacy Name' },
    goalieSelectionSnapshot: snapshot,
    marketOdds: 2,
    selectedSide: { homeAway: 'home', teamId: 'BOS' },
    stake: 1,
  })
  const legacyProvider = savedAnalyses.normalizeBet({
    goalieSelectionSnapshot: {
      effectiveAdjustment: -0.5,
      goalieName: 'Historical Goalie',
      nhlPlayerId: 8470001,
      selectionType: 'team_goalie',
      teamId: 'TOR',
    },
    marketOdds: 2,
    selectedSide: { homeAway: 'away', teamId: 'TOR' },
    stake: 1,
  })
  const legacyCustom = savedAnalyses.normalizeBet({
    adjustments: { awayGoalie: -0.75, awayGoalieName: 'Legacy Custom' },
    marketOdds: 2,
    selectedSide: { homeAway: 'away', teamId: 'TOR' },
    stake: 1,
  })

  assert.equal(normalized.goalieSelectionSnapshot.selectionType, 'provider_goalie')
  assert.equal(normalized.goalieSelectionSnapshot.source, 'provider_goalie')
  assert.equal(normalized.goalieSelectionSnapshot.displayName, 'Jeremy Swayman')
  assert.equal(normalized.goalieSelectionSnapshot.effectiveAdjustment, 1.25)
  assert.equal(legacyProvider.goalieSelectionSnapshot.selectionType, 'provider_goalie')
  assert.equal(legacyProvider.goalieSelectionSnapshot.nhlPlayerId, 8470001)
  assert.equal(legacyCustom.goalieSelectionSnapshot.selectionType, 'custom')
  assert.equal(legacyCustom.goalieSelectionSnapshot.effectiveAdjustment, -0.75)
})

test('Teams renders provider goalie rows with one compact adjustment editor', () => {
  const rowMarkup = renderToStaticMarkup(
    React.createElement(TeamsModule.GoalieRow, {
      adjustmentErrorMessage: '',
      adjustmentStatus: 'success',
      errorMessage: '',
      isExpanded: false,
      onDeleteAdjustment: () => {},
      onLoadGoalieStats: () => {},
      onSaveAdjustment: () => {},
      onToggle: () => {},
      player: providerGoalie,
      stats: null,
      summaryErrorMessage: '',
      summaryStatus: 'success',
      status: 'success',
    }),
  )
  const editorMarkup = renderToStaticMarkup(
    React.createElement(TeamsModule.GoalieAdjustmentEditor, {
      draft: { note: '', ratingAdjustment: '0.00' },
      errorMessage: '',
      goalieName: 'Jeremy Swayman',
      isSaving: false,
      onCancel: () => {},
      onChange: () => {},
      onSubmit: () => {},
    }),
  )
  const implicitMarkup = renderToStaticMarkup(
    React.createElement(TeamsModule.GoalieRow, {
      adjustmentErrorMessage: '',
      adjustmentStatus: 'success',
      errorMessage: '',
      isExpanded: false,
      onDeleteAdjustment: () => {},
      onLoadGoalieStats: () => {},
      onSaveAdjustment: () => {},
      onToggle: () => {},
      player: {
        ...providerGoalie,
        displayName: 'Unsigned Goalie',
        fullName: 'Unsigned Goalie',
        hasSavedAdjustment: false,
        id: 8489999,
        nhlPlayerId: 8489999,
        note: '',
        ratingAdjustment: 0,
      },
      stats: null,
      summaryErrorMessage: '',
      summaryStatus: 'success',
      status: 'success',
    }),
  )

  assert.match(rowMarkup, /Jeremy Swayman/)
  assert.match(rowMarkup, /Adjustment/)
  assert.match(rowMarkup, /\+1\.25/)
  assert.match(rowMarkup, />Edit</)
  assert.doesNotMatch(rowMarkup, /Add goalie|Mark inactive|Remove/)
  assert.match(editorMarkup, /Goalie adjustment/)
  assert.match(editorMarkup, /Optional note/)
  assert.match(editorMarkup, />Cancel</)
  assert.match(editorMarkup, />Save</)
  assert.match(implicitMarkup, /Unsigned Goalie/)
  assert.match(implicitMarkup, />0\.00</)
  assert.doesNotMatch(`${rowMarkup}${editorMarkup}`, /NHL player ID|NaN|undefined/)
})

test('provider, custom, and unknown snapshot labels retain their source', () => {
  const provider = goalieUtils.createProviderGoalieSelection(
    providerGoalie,
    'BOS',
  )
  const custom = {
    ...goalieUtils.createCustomGoalieSelection('BOS'),
    displayName: 'AHL recall',
    effectiveAdjustment: -2,
    manualAdjustment: -2,
  }
  const unknown = goalieUtils.createUnknownGoalieSelection('BOS')
  const savedProvider = structuredClone(provider)
  const changedProvider = goalieUtils.createProviderGoalieSelection(
    { ...providerGoalie, ratingAdjustment: -3 },
    'BOS',
  )

  assert.match(
    goalieUtils.formatGoalieSelectionSnapshot(savedProvider),
    /Jeremy Swayman.*Provider goalie.*Selected/,
  )
  assert.match(
    goalieUtils.formatGoalieSelectionSnapshot(custom),
    /AHL recall.*Custom goalie.*Selected/,
  )
  assert.match(
    goalieUtils.formatGoalieSelectionSnapshot(unknown),
    /Unknown starter.*No goalie selected.*Unconfirmed/,
  )
  assert.equal(savedProvider.effectiveAdjustment, 1.25)
  assert.equal(changedProvider.effectiveAdjustment, -3)
})

test('Analyzer lists every provider goalie plus custom and unknown with simplified controls', () => {
  const homeValues = {
    ...modelAnalysis.defaultGameInputs.home,
    goalieTeamId: 'BOS',
  }
  const awayValues = {
    ...modelAnalysis.defaultGameInputs.away,
    goalieTeamId: 'TOR',
  }
  const markup = renderToStaticMarkup(
    React.createElement(AdjustmentComparisonModule.GoalieSelectionPanel, {
      awayTeam: { name: 'Toronto Maple Leafs' },
      canPersist: true,
      errorMessages: { away: '', home: '' },
      goalieErrors: { away: '', home: '' },
      goalieSaveMessage: '',
      goalieSaveStatus: 'idle',
      goalieStatsByPlayerId: {},
      goalieStatuses: { away: 'success', home: 'success' },
      goalies: { away: [], home: [providerGoalie] },
      hasUnsavedChanges: false,
      homeTeam: { name: 'Boston Bruins' },
      inputs: { away: awayValues, home: homeValues },
      onChange: () => {},
      onRetry: { away: () => {}, home: () => {} },
      onSave: () => {},
    }),
  )

  assert.match(markup, /Unknown starter/)
  assert.match(markup, /Jeremy Swayman \(1\.25\)/)
  assert.match(markup, /Other \/ Unlisted goalie/)
  assert.match(markup, /Save Goalie Selections/)
  assert.doesNotMatch(markup, /Confirmation status|Additional note/)
  assert.doesNotMatch(markup, /Effective goalie adjustment/)
})

test('goalie adjustment API uses canonical LAK route and never sends userId', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ options, url: String(url) })
    return new Response(JSON.stringify({
      adjustment: {
        nhlPlayerId: 8475311,
        ratingAdjustment: 0.5,
        teamId: 'LAK',
      },
      goalies: [],
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })
  }

  try {
    await teamsApi.fetchGoalieAdjustments('LAK')
    await teamsApi.saveGoalieAdjustment('LAK', 8475311, {
      activeOverride: null,
      note: '',
      ratingAdjustment: 0.5,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.match(calls[0].url, /\/api\/teams\/LAK\/goalie-adjustments$/)
  assert.match(
    calls[1].url,
    /\/api\/teams\/LAK\/goalie-adjustments\/8475311$/,
  )
  assert.equal(calls[1].options.method, 'PUT')
  assert.equal(Object.hasOwn(JSON.parse(calls[1].options.body), 'userId'), false)
})
