import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let calculateGame
let components
let teamDirectory
let teamsComponents
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
  teamDirectory = await vite.ssrLoadModule('/src/utils/teamDirectory.js')
  teamsComponents = await vite.ssrLoadModule('/src/components/Teams.jsx')
  teamsApi = await vite.ssrLoadModule('/src/services/teamsApi.js')
  utils = await vite.ssrLoadModule('/src/utils/teamModelValues.js')
  calculateGame = (
    await vite.ssrLoadModule('/src/utils/calculateGame.js')
  ).calculateGame
})

after(async () => {
  await vite?.close()
})

test('Lineup & Notes card is placed after Special Teams and before provider rosters', async () => {
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
        { cachedDisplayName: 'Goalie One', nhlPlayerId: 301, ratingAdjustment: -1.25 },
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

  assert.match(markup, /User-maintained Lineup &amp; Notes/i)
  assert.match(markup, />Lineup &amp; Notes</)
  assert.match(
    markup,
    /Personal lineup and team notes for analysis context\. These do not automatically change model calculations\./,
  )
  assert.match(markup, /3 configured/)
  assert.match(markup, /Goalie One/)
  assert.match(markup, /-1\.25/)
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
  assert.equal((markup.match(/Manage Lineup/g) ?? []).length, 1)
  assert.doesNotMatch(markup, />Model Values</)
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
  assert.match(markup, /Team Notes<\/strong><p[^>]*>No team notes\./)
  assert.match(markup, /model-values-notes-panel/)
  assert.match(markup, /0 configured/)
})

test('saved snapshot names render while the provider roster is unavailable', () => {
  const modelValues = utils.normalizeTeamModelValues({
    forwardLines: [
      {
        centerDisplayNameSnapshot: 'Saved Center',
        centerPlayerId: 999001,
        lineNumber: 1,
      },
    ],
  }, 'DAL')
  const markup = renderToStaticMarkup(
    React.createElement(components.ModelValuesCard, {
      goalieAdjustments: [],
      goalieAdjustmentStatus: 'success',
      loadStatus: 'success',
      modelValues,
      onManageModelValues() {},
      onRetry() {},
      roster: null,
      rosterStatus: 'error',
    }),
  )

  assert.match(markup, /Saved Center/)
  assert.match(
    markup,
    /Current roster unavailable\. Showing saved lineup names\./,
  )
  assert.doesNotMatch(markup, /Unavailable player|Failed/)
  assert.doesNotMatch(markup, /model-values-manage-button" disabled/)
})

test('editor preserves saved players and keeps notes editable during outage', () => {
  const modelValues = utils.normalizeTeamModelValues({
    forwardLines: [
      {
        centerDisplayNameSnapshot: 'Saved Center',
        centerPlayerId: 999001,
        lineNumber: 1,
      },
    ],
    lineupNote: 'Editable note',
  }, 'DAL')
  const markup = renderToStaticMarkup(
    React.createElement(components.LineupEditorModal, {
      actionStatus: 'idle',
      initialValues: modelValues,
      onCancel() {},
      onClear() {},
      onSave() {},
      roster: null,
      rosterStatus: 'error',
      teamName: 'Dallas Stars',
    }),
  )

  assert.match(markup, /Saved Center/)
  assert.match(markup, /player replacement is disabled/)
  assert.match(markup, /<select[^>]*disabled=""[^>]*>/)
  assert.match(markup, /<textarea[^>]*>Editable note<\/textarea>/)
  assert.doesNotMatch(markup, /<textarea[^>]*disabled/)
  assert.doesNotMatch(markup, /type="submit" disabled/)
})

test('Teams stages Special Teams and lazy-loads the shared roster once', async () => {
  const source = await readFile(
    new URL('../components/Teams.jsx', import.meta.url),
    'utf8',
  )
  const selectTeamSource = source.slice(
    source.indexOf('const handleSelectTeam'),
    source.indexOf('const handleBackToTeams'),
  )

  assert.match(selectTeamSource, /setSelectedTeam\(team\)/)
  assert.doesNotMatch(selectTeamSource, /loadRoster|loadTeamStats|loadGoalie/)
  assert.match(source, /new IntersectionObserver/)
  assert.match(source, /rootMargin: '500px 0px'/)
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*onLoadStats\(team\)/s)
  assert.match(source, /rosterGroups\.map/)
  assert.match(source, /roster\[group\.key\]/)
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
          ratingAdjustment: -0.5,
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
  assert.match(markup, /Manage Lineup &amp; Notes — Boston Bruins/)
  assert.match(markup, /maxLength="1500"/)
  assert.match(markup, /Save Lineup/)
  assert.match(markup, /Clear Lineup/)
  assert.match(markup, /forward-line-grid/)
  assert.match(markup, /defense-pair-grid/)
  assert.match(markup, /Goalie Adjustments/)
  assert.match(markup, /Configured Goalie/)
  assert.match(markup, /Manage Goalie Adjustments/)
  assert.match(
    markup,
    /class="save-ratings-button" type="submit">Save Lineup<\/button>/,
  )
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

test('saving state disables Save Lineup without changing save eligibility rules', () => {
  const markup = renderToStaticMarkup(
    React.createElement(components.LineupEditorModal, {
      actionStatus: 'saving',
      initialValues: utils.normalizeTeamModelValues({}, 'BOS'),
      onCancel() {},
      onClear() {},
      onSave() {},
      roster,
      teamName: 'Boston Bruins',
    }),
  )

  assert.match(
    markup,
    /class="save-ratings-button" disabled="" type="submit">Saving\.\.\.<\/button>/,
  )
})

test('Teams directory keeps Search, Conference, and Division aligned responsively', async () => {
  const markup = renderToStaticMarkup(
    React.createElement(teamsComponents.default, {
      injurySummaries: {},
      injurySummaryStatus: 'success',
      powerRatings: {},
      powerRatingsStatus: 'success',
    }),
  )
  const css = await readFile(new URL('../../src/App.css', import.meta.url), 'utf8')
  const mobileRules = css.slice(css.indexOf('@media (max-width: 680px)'))

  assert.equal((markup.match(/class="team-card"/g) ?? []).length, 32)
  assert.match(markup, /Search teams/)
  assert.match(markup, /Conference/)
  assert.match(markup, /Division/)
  assert.doesNotMatch(markup, />Refresh<\/button>/)
  assert.doesNotMatch(markup, />Retry<\/button>/)
  assert.match(
    css,
    /\.teams-toolbar\s*\{[^}]*grid-template-columns:[^}]*minmax\(220px, 300px\)[^}]*repeat\(2, minmax\(160px, 220px\)\)[^}]*justify-content:\s*start/s,
  )
  assert.doesNotMatch(css, /\.teams-search-field\s*\{[^}]*display:\s*none/s)
  assert.match(
    mobileRules,
    /\.teams-toolbar\s*\{[^}]*grid-template-columns:\s*1fr/s,
  )
})

test('Teams directory exposes Retry only in its contextual error state', async () => {
  const successMarkup = renderToStaticMarkup(
    React.createElement(teamsComponents.default, {
      injurySummaries: {},
      injurySummaryStatus: 'success',
      powerRatings: {},
      powerRatingsStatus: 'success',
    }),
  )
  const errorMarkup = renderToStaticMarkup(
    React.createElement(teamsComponents.TeamsDirectoryError, {
      errorMessage: 'Provider unavailable.',
      onRetry() {},
    }),
  )
  const source = await readFile(
    new URL('../components/Teams.jsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(successMarkup, />Retry<\/button>/)
  assert.match(errorMarkup, /role="alert"/)
  assert.match(errorMarkup, /Teams unavailable/)
  assert.match(errorMarkup, /Provider unavailable\./)
  assert.match(errorMarkup, />Retry<\/button>/)
  assert.match(source, /catch \(error\)[\s\S]*setStatus\('error'\)/)
})

test('Team Details header renders canonical current-season standings context', () => {
  const standing = {
    conference: 'Western',
    conferenceRank: 10,
    division: 'Pacific',
    divisionRank: 3,
    gamesPlayed: 82,
    last10Record: '6-3-1',
    losses: 33,
    overtimeLosses: 6,
    points: 92,
    teamAbbreviation: 'ANA',
    teamId: 'ANA',
    wins: 43,
  }
  const markup = renderToStaticMarkup(
    React.createElement(teamsComponents.TeamDetailsHeader, {
      injurySummary: { activeInjuries: 0, totalImpact: 0 },
      injurySummaryStatus: 'success',
      logo: '',
      powerRatingBreakdown: {
        currentRating: 46.5,
        manualAdjustment: 0.5,
        modelMovement: 1.5,
        modelRating: 46,
        startingRating: 44.5,
      },
      powerRatingRank: 12,
      standing,
      team: {
        abbreviation: 'ANA',
        conference: 'Western',
        division: 'Pacific',
        id: 'ANA',
        name: 'Anaheim Ducks',
      },
    }),
  )

  assert.match(markup, />ANA<\/span>/)
  assert.match(markup, />Western #10<\/span>/)
  assert.match(markup, />Pacific #3<\/span>/)
  assert.match(markup, /<dt>PTS<\/dt><dd>92<\/dd>/)
  assert.match(markup, /<dt>Record<\/dt><dd>43–33–6<\/dd>/)
  assert.match(markup, /<dt>L10<\/dt><dd>6–3–1<\/dd>/)
  assert.match(markup, /Power Rating<\/span><div class="power-rating-value-row"><strong>46\.50<\/strong><small>#12<\/small><\/div>/)
  assert.match(markup, /Start <b>44\.50<\/b>/)
  assert.match(markup, /Change <b>\+1\.50<\/b>/)
  assert.match(markup, /Manual <b>\+0\.50<\/b>/)
  assert.doesNotMatch(markup, /Model <b>|League <b>/)
  assert.match(markup, /Active injury impact<\/span><strong>0\.0<\/strong><small>0 active<\/small>/)
  assert.doesNotMatch(markup, /MongoDB current/)
})

test('Team Details standings context degrades field-by-field without misleading zero ranks', async () => {
  const team = {
    abbreviation: 'ANA',
    conference: 'Western',
    division: 'Pacific',
    id: 'ANA',
    name: 'Anaheim Ducks',
  }
  const renderHeader = (standing) =>
    renderToStaticMarkup(
      React.createElement(teamsComponents.TeamDetailsHeader, {
        injurySummary: { activeInjuries: 0, totalImpact: 0 },
        injurySummaryStatus: 'success',
        logo: '',
        standing,
        team,
      }),
    )
  const missingMarkup = renderHeader(null)
  const partialMarkup = renderHeader({
    conference: 'Western',
    conferenceRank: 0,
    division: 'Pacific',
    divisionRank: 0,
    gamesPlayed: 82,
    last10Record: '',
    losses: 33,
    overtimeLosses: 6,
    points: 92,
    wins: 43,
  })
  const css = await readFile(new URL('../../src/App.css', import.meta.url), 'utf8')

  assert.match(missingMarkup, />Western<\/span>/)
  assert.match(missingMarkup, />Pacific<\/span>/)
  assert.equal((missingMarkup.match(/<dd>—<\/dd>/g) ?? []).length, 3)
  assert.doesNotMatch(missingMarkup, /#0|NaN|undefined|0–0–0/)
  assert.match(partialMarkup, /<dt>PTS<\/dt><dd>92<\/dd>/)
  assert.match(partialMarkup, /<dt>Record<\/dt><dd>43–33–6<\/dd>/)
  assert.match(partialMarkup, /<dt>L10<\/dt><dd>—<\/dd>/)
  assert.doesNotMatch(partialMarkup, /#0/)
  assert.match(css, /\.team-standings-context\s*\{[^}]*flex-wrap:\s*wrap/s)
  assert.match(css, /\.team-standings-context dd\s*\{[^}]*white-space:\s*nowrap/s)
  assert.match(css, /\.team-context-row\s*\{[^}]*flex-wrap:\s*wrap/s)
})

test('Team Details Power Rating breakdown displays compact zero values and inline rank clearly', async () => {
  const markup = renderToStaticMarkup(
    React.createElement(teamsComponents.PowerRatingBreakdownCard, {
      breakdown: {
        currentRating: 46,
        manualAdjustment: 0,
        modelMovement: 0,
        modelRating: 46,
        startingRating: 46,
      },
      leagueRank: null,
    }),
  )

  const css = await readFile(new URL('../../src/App.css', import.meta.url), 'utf8')

  assert.match(markup, /Power Rating<\/span><div class="power-rating-value-row"><strong>46\.00<\/strong><small>#TBD<\/small><\/div>/)
  assert.match(markup, /Start <b>46\.00<\/b>/)
  assert.match(markup, /Change <b>0\.00<\/b>/)
  assert.match(markup, /Manual <b>0\.00<\/b>/)
  assert.doesNotMatch(markup, /Model <b>|League <b>/)
  assert.match(css, /\.team-detail-metrics\s*\{[^}]*align-items:\s*start/s)
  assert.match(css, /\.power-rating-breakdown-card\s*\{[^}]*align-content:\s*start/s)
})

test('Team Details Power Rating breakdown keeps negative Change separate from Manual Adjustment', () => {
  const markup = renderToStaticMarkup(
    React.createElement(teamsComponents.PowerRatingBreakdownCard, {
      breakdown: {
        currentRating: 46.25,
        manualAdjustment: -0.25,
        modelMovement: -1.5,
        modelRating: 46.5,
        startingRating: 48,
      },
      leagueRank: 12,
    }),
  )

  assert.match(markup, /<strong>46\.25<\/strong><small>#12<\/small>/)
  assert.match(markup, /Start <b>48\.00<\/b>/)
  assert.match(markup, /Change <b>-1\.50<\/b>/)
  assert.match(markup, /Manual <b>-0\.25<\/b>/)
})

test('Team Details Power Rating breakdown uses placeholders for a missing baseline', () => {
  const markup = renderToStaticMarkup(
    React.createElement(teamsComponents.PowerRatingBreakdownCard, {
      breakdown: {
        currentRating: 46.5,
        manualAdjustment: 0.5,
        modelMovement: null,
        modelRating: 46,
        startingRating: null,
      },
      leagueRank: 1,
    }),
  )

  assert.match(markup, /<strong>46\.50<\/strong><small>#1<\/small>/)
  assert.match(markup, /Start <b>—<\/b>/)
  assert.match(markup, /Change <b>—<\/b>/)
  assert.match(markup, /Manual <b>\+0\.50<\/b>/)
  assert.doesNotMatch(markup, /NaN|undefined/)
})

test('Team Details standings lookup uses canonical IDs instead of display names', () => {
  const matchingStanding = {
    teamAbbreviation: 'ANA',
    teamId: 'ANA',
    teamName: 'Provider Display Name',
  }
  const result = teamDirectory.getTeamStanding(
    [
      { teamAbbreviation: 'BOS', teamId: 'BOS', teamName: 'Anaheim Ducks' },
      matchingStanding,
    ],
    { abbreviation: 'ANA', id: 'ANA', name: 'Different Display Name' },
  )

  assert.equal(result, matchingStanding)
})

test('mobile search and directory filters share the existing matching pipeline', () => {
  const teams = [
    {
      abbreviation: 'ANA',
      conference: 'Western',
      division: 'Pacific',
      name: 'Anaheim Ducks',
    },
    {
      abbreviation: 'BOS',
      conference: 'Eastern',
      division: 'Atlantic',
      name: 'Boston Bruins',
    },
    {
      abbreviation: 'NYR',
      conference: 'Eastern',
      division: 'Metropolitan',
      name: 'New York Rangers',
    },
  ]

  assert.deepEqual(
    teamDirectory.filterTeams(teams, { searchTerm: 'bos' }).map(
      (team) => team.abbreviation,
    ),
    ['BOS'],
  )
  assert.deepEqual(
    teamDirectory.filterTeams(teams, { searchTerm: 'eastern' }).map(
      (team) => team.abbreviation,
    ),
    ['BOS', 'NYR'],
  )
  assert.deepEqual(
    teamDirectory.filterTeams(teams, {
      conferenceFilter: 'Eastern',
      divisionFilter: 'Metropolitan',
    }).map((team) => team.abbreviation),
    ['NYR'],
  )
})

test('roster sections expose counts and preserve mounted content while collapsed', async () => {
  const player = {
    fullName: 'Forward One',
    id: 101,
    position: 'C',
    sweaterNumber: '12',
  }
  const collapsedMarkup = renderToStaticMarkup(
    React.createElement(teamsComponents.RosterSection, {
      groupKey: 'forwards',
      isExpanded: false,
      label: 'Forwards',
      onToggleSection() {},
      players: [player],
    }),
  )
  const expandedMarkup = renderToStaticMarkup(
    React.createElement(teamsComponents.RosterSection, {
      groupKey: 'forwards',
      isExpanded: true,
      label: 'Forwards',
      onToggleSection() {},
      players: [player],
    }),
  )
  const source = await readFile(
    new URL('../components/Teams.jsx', import.meta.url),
    'utf8',
  )

  assert.match(collapsedMarkup, /aria-expanded="false"/)
  assert.match(collapsedMarkup, /aria-controls="team-forwards-roster"/)
  assert.match(collapsedMarkup, /roster-section-count">1</)
  assert.match(collapsedMarkup, /hidden="" id="team-forwards-roster"/)
  assert.match(collapsedMarkup, /Forward One/)
  assert.match(expandedMarkup, /aria-expanded="true"/)
  assert.doesNotMatch(expandedMarkup, /hidden=""/)
  assert.match(
    source,
    /defensemen:\s*false,\s*forwards:\s*false,\s*goalies:\s*true/s,
  )
  assert.match(source, /setExpandedRosterSections[\s\S]*goalies:\s*true/)
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
  assert.match(
    css,
    /\.lineup-modal-actions \.save-ratings-button:not\(:disabled\):hover\s*\{[^}]*background:\s*#38e3c6/s,
  )
  assert.match(
    css,
    /\.lineup-modal-actions \.save-ratings-button:disabled\s*\{[^}]*color:\s*var\(--text-muted\)/s,
  )
})
