import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let InjuryManagerModule
let AdjustmentComparisonModule
let apiClient
let calculateGame
let injuriesApi
let injuryUtils
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  InjuryManagerModule = await vite.ssrLoadModule(
    '/src/components/InjuryManager.jsx',
  )
  AdjustmentComparisonModule = await vite.ssrLoadModule(
    '/src/components/AdjustmentComparison.jsx',
  )
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  injuriesApi = await vite.ssrLoadModule('/src/services/injuriesApi.js')
  calculateGame = (
    await vite.ssrLoadModule('/src/utils/calculateGame.js')
  ).calculateGame
  injuryUtils = await vite.ssrLoadModule('/src/utils/injuries.js')
})

after(async () => {
  await vite?.close()
})

const roster = {
  defensemen: [
    { fullName: 'Defense Player', id: 8470002, position: 'D', sweaterNumber: 7 },
  ],
  forwards: [
    { fullName: 'Center Player', id: 8470001, position: 'C', sweaterNumber: 64 },
    { fullName: 'Left Wing', id: 8470003, position: 'L', sweaterNumber: 19 },
  ],
  goalies: [
    { fullName: 'Goalie Player', id: 8470004, position: 'G', sweaterNumber: 30 },
  ],
}

const modalProps = {
  actionStatus: 'idle',
  initialRoster: roster,
  maximumPlayerInjuryPenalty: -2.5,
  mode: 'add',
  onClose() {},
  onDelete() {},
  onSave() {},
  team: { abbreviation: 'BOS', id: 'BOS', name: 'Boston Bruins' },
}

test('roster players normalize identity, position and jersey details for selection', () => {
  const players = injuryUtils.normalizeInjuryRosterPlayers(roster)

  assert.equal(players.length, 4)
  assert.deepEqual(
    players.find((player) => player.id === 8470003),
    {
      fullName: 'Left Wing',
      id: 8470003,
      position: 'LW',
      sweaterNumber: '19',
    },
  )
  assert.equal(
    injuryUtils.formatInjuryRosterPlayerOption(
      players.find((player) => player.id === 8470001),
    ),
    'Center Player · C · #64',
  )
})

test('injury player search matches name, canonical position and jersey number', () => {
  const players = injuryUtils.normalizeInjuryRosterPlayers(roster)

  assert.deepEqual(
    injuryUtils.filterInjuryRosterPlayers(players, 'goalie').map(
      (player) => player.id,
    ),
    [8470004],
  )
  assert.deepEqual(
    injuryUtils.filterInjuryRosterPlayers(players, '#64').map(
      (player) => player.id,
    ),
    [8470001],
  )
})

test('Add Injury renders roster selector details, search and Other / Unlisted', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.InjuryEditorModal, {
      ...modalProps,
      initialComboboxOpen: true,
    }),
  )

  assert.equal((markup.match(/role="combobox"/g) ?? []).length, 1)
  assert.match(markup, />Player<\/label>/)
  assert.match(markup, /placeholder="Search or select player\.\.\."/)
  assert.match(markup, /Search by player name, position, or jersey number/)
  assert.match(markup, /Center Player/)
  assert.match(markup, /C · #64/)
  assert.match(markup, /Goalie Player/)
  assert.match(markup, /G · #30/)
  assert.match(markup, /Other \/ Unlisted player/)
  assert.doesNotMatch(markup, /Search team roster/)
  assert.doesNotMatch(markup, /aria-label="Injured player"/)
  assert.doesNotMatch(markup, /Manual player name/)
  assert.match(markup, /Guidance only/)
  assert.match(markup, /replacement player and current team depth/)
  assert.match(markup, /Save creates this injury record for the selected team/)
  assert.doesNotMatch(markup, /Mark healthy removes active impact/)
  assert.doesNotMatch(markup, /Delete permanently removes the record/)
  assert.doesNotMatch(markup, /<details[^>]*open=""/)
})

test('player combobox keeps Other available during loading and empty roster states', () => {
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.InjuryEditorModal, {
      ...modalProps,
      initialComboboxOpen: true,
      initialRoster: null,
    }),
  )
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.InjuryEditorModal, {
      ...modalProps,
      initialComboboxOpen: true,
      initialRoster: {},
    }),
  )

  assert.match(loadingMarkup, /Loading current roster\.\.\./)
  assert.match(loadingMarkup, /Other \/ Unlisted player/)
  assert.match(emptyMarkup, /No roster players found/)
  assert.match(emptyMarkup, /Other \/ Unlisted player/)
})

test('player combobox exposes the expected ARIA and keyboard interaction hooks', async () => {
  const source = await readFile(
    new URL('../components/InjuryManager.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /aria-autocomplete="list"/)
  assert.match(source, /role="listbox"/)
  assert.match(source, /onClick=\{handleComboboxFocus\}/)
  assert.match(source, /event\.key === 'ArrowDown'/)
  assert.match(source, /event\.key === 'ArrowUp'/)
  assert.match(source, /event\.key === 'Enter'/)
  assert.match(source, /event\.key === 'Escape'/)
})

test('player combobox menu shows about nine roster rows while staying viewport responsive', async () => {
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(css, /max-height: min\(460px, 60vh\);/)
  assert.match(css, /max-height: min\(460px, 60dvh\);/)
})

test('manual legacy injury editing preserves name, arbitrary impact and unknown position', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.InjuryEditorModal, {
      ...modalProps,
      injury: {
        active: true,
        durationType: 'unknown',
        expectedReturn: '',
        impact: -1.65,
        injuryType: '',
        isGoalie: false,
        notes: '',
        playerName: 'Legacy Player',
        position: '',
        providerPlayerId: null,
        status: 'out',
      },
      mode: 'edit',
    }),
  )

  assert.match(markup, /Manual player name/)
  assert.match(markup, /Legacy Player/)
  assert.match(markup, /Unknown \/ not listed/)
  assert.match(markup, /-1\.65 · current saved legacy value/)
})

test('impact choices respect the configured individual maximum and half-point scale', () => {
  assert.deepEqual(injuryUtils.getInjuryImpactOptions(-2.5), [
    0,
    -0.5,
    -1,
    -1.5,
    -2,
    -2.5,
  ])
  assert.deepEqual(injuryUtils.getInjuryImpactOptions(-1.5), [
    0,
    -0.5,
    -1,
    -1.5,
  ])
  assert.equal(injuryUtils.isStandardInjuryImpact(-1.5, -1.5), true)
  assert.equal(injuryUtils.isStandardInjuryImpact(-2, -1.5), false)
  assert.equal(injuryUtils.isStandardInjuryImpact(-0.75, -2.5), false)
  assert.equal(injuryUtils.isStandardInjuryImpact(0.5, -2.5), false)
})

test('team accordion uses the full accessible row and compact state chevrons', async () => {
  const team = {
    abbreviation: 'BOS',
    activeInjuries: 1,
    division: 'Atlantic',
    id: 'BOS',
    injuries: [],
    name: 'Boston Bruins',
    totalImpact: -1.5,
  }
  const props = {
    onAdd() {},
    onClearHistory() {},
    onEdit() {},
    onMarkHealthy() {},
    team,
  }
  const collapsedMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, props),
  )
  const expandedMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, {
      ...props,
      initialExpanded: true,
    }),
  )
  const source = await readFile(
    new URL('../components/InjuryManager.jsx', import.meta.url),
    'utf8',
  )

  assert.match(
    collapsedMarkup,
    /<button[^>]*class="injury-team-header"[^>]*type="button"[^>]*aria-expanded="false"/,
  )
  assert.match(collapsedMarkup, /lucide-chevron-down/)
  assert.doesNotMatch(collapsedMarkup, /class="injury-team-body"/)
  assert.match(expandedMarkup, /aria-expanded="true"/)
  assert.match(expandedMarkup, /lucide-chevron-up/)
  assert.match(expandedMarkup, /class="injury-team-body"[^>]*id=/)
  assert.match(expandedMarkup, /<\/button><div class="injury-team-body"/)
  assert.match(source, /aria-controls=\{detailsId\}/)
  assert.match(source, /onClick=\{\(\) => setExpanded/)
})

test('healthy teams remain clickable, expandable, and able to add injuries', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, {
      initialExpanded: true,
      onAdd() {},
      onClearHistory() {},
      onEdit() {},
      onMarkHealthy() {},
      team: {
        abbreviation: 'ANA',
        activeInjuries: 0,
        division: 'Pacific',
        id: 'ANA',
        injuries: [],
        name: 'Anaheim Ducks',
        totalImpact: 0,
      },
    }),
  )

  assert.match(markup, /injury-team-card healthy expanded/)
  assert.match(markup, /class="injury-team-header"/)
  assert.match(markup, /Impact/)
  assert.match(markup, /Active/)
  assert.match(markup, />Add injured player<\/button>/)
})

test('injury guidance is natively collapsible without changing form values', () => {
  const injury = {
    active: true,
    durationType: 'long-term',
    expectedReturn: 'January',
    impact: -1.5,
    injuryType: 'Lower body',
    isGoalie: false,
    notes: 'Re-evaluate next week',
    playerName: 'Legacy Player',
    position: '',
    providerPlayerId: null,
    status: 'out',
  }
  const renderEditor = (initialGuidanceExpanded) =>
    renderToStaticMarkup(
      React.createElement(InjuryManagerModule.InjuryEditorModal, {
        ...modalProps,
        initialGuidanceExpanded,
        injury,
        mode: 'edit',
      }),
    )
  const collapsedMarkup = renderEditor(false)
  const expandedMarkup = renderEditor(true)

  assert.doesNotMatch(collapsedMarkup, /<details[^>]*open=""/)
  assert.match(expandedMarkup, /<details[^>]*open=""/)

  for (const markup of [collapsedMarkup, expandedMarkup]) {
    assert.match(markup, /<summary>[\s\S]*Injury adjustment guidance/)
    assert.match(markup, /value="-1.5" selected="">-1.50/)
    assert.match(markup, /Legacy Player/)
    assert.match(markup, /replacement player and current team depth/)
    assert.match(markup, /Game injury adjustment in Analyzer/)
    assert.match(markup, /Mark healthy removes active impact but keeps history/)
  }
})

test('summary normalization keeps zero-impact skaters visible and forces goalies to zero', () => {
  const summary = injuryUtils.normalizeInjurySummary([
    {
      activeInjuries: 3,
      activeSkaterInjuries: 2,
      goalieInjuries: 1,
      injuries: [
        { id: 'one', impact: -1, playerName: 'Impact C', position: 'C' },
        { id: 'two', impact: 0, playerName: 'Context D', position: 'D' },
        { id: 'three', impact: -4, playerName: 'Goalie G', position: 'G' },
      ],
      teamAbbreviation: 'BOS',
      teamId: 'BOS',
      teamName: 'Boston Bruins',
      totalImpact: -1,
    },
  ]).BOS

  assert.equal(summary.injuries.length, 3)
  assert.equal(summary.injuries[1].impact, 0)
  assert.equal(summary.injuries[2].isGoalie, true)
  assert.equal(summary.injuries[2].impact, 0)
  assert.equal(summary.totalImpact, -1)
})

test('Analyzer injuries stay compact and expand to zero-impact and goalie context', () => {
  const awaySummary = {
    injuries: [
      { id: '1', impact: -1, playerName: 'Away Center', position: 'C' },
      { id: '2', impact: 0, playerName: 'Away Context', position: 'D' },
      { id: '3', impact: -0.5, playerName: 'Away Wing', position: 'LW' },
      { id: '4', impact: -0.5, playerName: 'Away Extra', position: 'RW' },
      { id: '5', impact: 0, isGoalie: true, playerName: 'Away Goalie', position: 'G' },
    ],
    totalImpact: -2,
  }
  const homeSummary = {
    injuries: [
      { id: '6', impact: -1.5, playerName: 'Home Defender', position: 'D' },
    ],
    totalImpact: -1.5,
  }
  const collapsedMarkup = renderToStaticMarkup(
    React.createElement(AdjustmentComparisonModule.InjuryContextPanel, {
      awaySummary,
      awayTeam: { id: 'ANA', name: 'Anaheim Ducks' },
      homeSummary,
      homeTeam: { id: 'BOS', name: 'Boston Bruins' },
    }),
  )
  const expandedMarkup = renderToStaticMarkup(
    React.createElement(AdjustmentComparisonModule.InjuryContextCard, {
      initialExpanded: true,
      summary: awaySummary,
      team: { id: 'ANA', name: 'Anaheim Ducks' },
    }),
  )
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(AdjustmentComparisonModule.InjuryContextCard, {
      summary: { injuries: [], totalImpact: 0 },
      team: { id: 'NYR', name: 'New York Rangers' },
    }),
  )

  assert.match(collapsedMarkup, /Anaheim Ducks/)
  assert.match(collapsedMarkup, /Boston Bruins/)
  assert.match(collapsedMarkup, /5 active/)
  assert.match(collapsedMarkup, /Stored impact -2\.0/)
  assert.match(collapsedMarkup, /View injuries/)
  assert.doesNotMatch(collapsedMarkup, /Away Center/)
  assert.match(expandedMarkup, /Hide injuries/)
  assert.match(expandedMarkup, /Away Center · C/)
  assert.match(expandedMarkup, /Away Context · D/)
  assert.match(expandedMarkup, /zero-impact/)
  assert.match(expandedMarkup, /Away Extra · RW/)
  assert.match(expandedMarkup, /Goalie availability · excluded from injury impact/)
  assert.match(emptyMarkup, /0 active/)
  assert.match(emptyMarkup, /Stored impact 0\.0/)
  assert.doesNotMatch(emptyMarkup, /View injuries|Hide injuries/)
})

test('stored plus game injury behavior and helper remain unchanged', async () => {
  const base = {
    baseRating: 50,
    goalieAdjustment: 0,
    homeAdvantage: 0,
    injuries: 0,
    manualAdjustment: 0,
    marketOdds: 2,
    motivation: 0,
    restFatigue: 0,
    storedInjuryImpact: -1.5,
  }
  const control = calculateGame(base, base, 20)
  const adjusted = calculateGame(
    { ...base, injuries: -0.5 },
    base,
    20,
  )
  const source = await readFile(
    new URL('../components/AdjustmentComparison.jsx', import.meta.url),
    'utf8',
  )

  assert.equal(control.homeFinalRating, 48.5)
  assert.equal(adjusted.homeFinalRating, 48)
  assert.equal(adjusted.awayFinalRating, 48.5)
  assert.match(
    source,
    /cumulative or game-specific lineup effects not already included/,
  )
  assert.match(source, /Avoid double counting/)
})

test('team cards show Clear history only while that team history is visible', () => {
  const activeInjury = {
    active: true,
    durationType: 'unknown',
    expectedReturn: '',
    id: 'active',
    impact: -1.5,
    injuryType: '',
    isGoalie: false,
    notes: '',
    playerName: 'Active Center',
    position: 'C',
    status: 'out',
  }
  const team = {
    abbreviation: 'BOS',
    activeInjuries: 1,
    division: 'Atlantic',
    id: 'BOS',
    injuries: [activeInjury],
    name: 'Boston Bruins',
    totalImpact: -1.5,
  }
  const cardProps = {
    initialExpanded: true,
    onAdd() {},
    onClearHistory() {},
    onEdit() {},
    onMarkHealthy() {},
  }
  const activeOnlyMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, {
      ...cardProps,
      team,
    }),
  )
  const historyHiddenMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, {
      ...cardProps,
      team: {
        ...team,
        injuries: [
          activeInjury,
          {
            ...activeInjury,
            active: false,
            id: 'history',
            playerName: 'Recovered Wing',
            status: 'healthy',
          },
        ],
      },
    }),
  )
  const historyVisibleMarkup = renderToStaticMarkup(
    React.createElement(InjuryManagerModule.TeamInjuryCard, {
      ...cardProps,
      initialShowHistory: true,
      team: {
        ...team,
        injuries: [
          activeInjury,
          {
            ...activeInjury,
            active: false,
            id: 'history',
            playerName: 'Recovered Wing',
            status: 'healthy',
          },
        ],
      },
    }),
  )

  assert.doesNotMatch(activeOnlyMarkup, />Clear history<\/button>/)
  assert.doesNotMatch(historyHiddenMarkup, />Clear history<\/button>/)
  assert.match(historyHiddenMarkup, /Active Center/)
  assert.doesNotMatch(historyHiddenMarkup, /Recovered Wing/)
  assert.match(historyVisibleMarkup, /class="injury-history-controls"/)
  assert.match(historyVisibleMarkup, />Clear history<\/button>/)
  assert.match(historyVisibleMarkup, /Permanently delete 1 historical injury record/)
  assert.match(historyVisibleMarkup, /Active Center/)
  assert.match(historyVisibleMarkup, /Recovered Wing/)
})

test('clear-history confirmation names the team, count and active-record protection', () => {
  assert.equal(
    injuryUtils.buildClearHistoryConfirmation('Boston Bruins', 2),
    'Clear Boston Bruins injury history?\n\nThis will permanently delete 2 historical injury records. Active injuries will not be affected.',
  )
})

test('clearTeamInjuryHistory uses the authenticated API client and team route', async () => {
  const originalFetch = globalThis.fetch
  let request

  apiClient.setAuthToken('injury-test-token')
  globalThis.fetch = async (url, options) => {
    request = { options, url }
    return new Response(
      JSON.stringify({ deletedCount: 2, success: true, teamId: 'BOS' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  }

  try {
    const result = await injuriesApi.clearTeamInjuryHistory('BOS')

    assert.equal(request.url, '/api/injuries/team/BOS/history')
    assert.equal(request.options.method, 'DELETE')
    assert.equal(
      request.options.headers.get('Authorization'),
      'Bearer injury-test-token',
    )
    assert.equal(result.deletedCount, 2)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }
})

test('clear-history flow confirms first and refreshes shared injury state after success', async () => {
  const source = await readFile(
    new URL('../components/InjuryManager.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /if \(!confirmed\) \{\s*return\s*\}/)
  assert.match(source, /await clearTeamInjuryHistory\(team\.id\)/)
  assert.match(source, /await refreshAfterMutation\(\)/)
  assert.match(source, /Cleared \$\{result\.deletedCount\} historical injury/)
})

test('Injury Manager loads the selected team through the shared roster coordinator', async () => {
  const source = await readFile(
    new URL('../components/InjuryManager.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /teamsDataCoordinator\s*\.loadRoster\(team\.abbreviation\)/)
  assert.doesNotMatch(source, /Goalie availability record<\/span>/)
})
