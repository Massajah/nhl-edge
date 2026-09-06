import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let Standings
let apiClient
let standingsApi
let standingsUtils
let playoffUtils
let vite

const seasons = [
  ['20252026', '2025–26', true],
  ['20242025', '2024–25', false],
  ['20232024', '2023–24', false],
  ['20222023', '2022–23', false],
  ['20212022', '2021–22', false],
  ['20202021', '2020–21', false],
].map(([id, label, isCurrent]) => ({
  endDate: `${id.slice(4)}-04-30`,
  id,
  isCurrent,
  label,
  startDate: `${id.slice(0, 4)}-10-01`,
}))

const makeTeam = ({
  abbreviation,
  conference,
  conferenceRank,
  division,
  divisionRank,
  name,
  officialRank,
  points,
}) => ({
  clinchIndicator: officialRank === 1 ? 'x' : '',
  conference,
  conferenceRank,
  division,
  divisionRank,
  gamesPlayed: 82,
  goalDifferential: officialRank === 1 ? 25 : -14,
  goalsAgainst: 220,
  goalsFor: officialRank === 1 ? 245 : 206,
  last10Record: '7-2-1',
  losses: 24,
  officialRank,
  overtimeLosses: 8,
  pointPercentage: points / 164,
  points,
  regulationPlusOvertimeWins: 46,
  regulationWins: 40,
  streak: 'W3',
  teamAbbreviation: abbreviation,
  teamId: abbreviation,
  teamLogo: `https://assets.nhle.com/${abbreviation}.svg`,
  teamName: name,
  wildcardRank: 0,
  wins: 50,
})

const teams = [
  makeTeam({
    abbreviation: 'BOS',
    conference: 'Eastern',
    conferenceRank: 1,
    division: 'Atlantic',
    divisionRank: 1,
    name: 'Boston Bruins',
    officialRank: 1,
    points: 106,
  }),
  makeTeam({
    abbreviation: 'NYR',
    conference: 'Eastern',
    conferenceRank: 2,
    division: 'Metropolitan',
    divisionRank: 1,
    name: 'New York Rangers',
    officialRank: 2,
    points: 104,
  }),
  makeTeam({
    abbreviation: 'COL',
    conference: 'Western',
    conferenceRank: 1,
    division: 'Central',
    divisionRank: 1,
    name: 'Colorado Avalanche',
    officialRank: 3,
    points: 102,
  }),
  makeTeam({
    abbreviation: 'VAN',
    conference: 'Western',
    conferenceRank: 2,
    division: 'Pacific',
    divisionRank: 1,
    name: 'Vancouver Canucks',
    officialRank: 4,
    points: 100,
  }),
]

const standingsResult = (overrides = {}) => ({
  clinchIndicators: [
    ['x', 'Clinched playoff berth'],
    ['y', 'Clinched division title'],
    ['z', 'Clinched conference title'],
    ['p', "Clinched Presidents' Trophy"],
    ['e', 'Eliminated from playoff contention'],
  ].map(([code, label]) => ({ code, label })),
  currentSeasonId: '20252026',
  error: null,
  provider: {
    name: 'NHL Web API',
    source: 'cache',
    stale: false,
  },
  season: seasons[0],
  seasons,
  selectedSeasonId: '20252026',
  standings: teams,
  status: 'ready',
  ...overrides,
})

const makePlayoffTeam = ({
  abbreviation,
  isWinner = false,
  name,
  seed = 'D1',
  wins = null,
}) => ({
  abbreviation,
  isWinner,
  logo: `https://assets.nhle.com/${abbreviation}.svg`,
  name,
  providerTeamId: null,
  seed,
  teamId: abbreviation,
  wins,
})

const makeSeries = ({
  bottom = makePlayoffTeam({
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    seed: 'D3',
    wins: 2,
  }),
  conference = 'eastern',
  id = 'series-a',
  round = 1,
  status = 'complete',
  top = makePlayoffTeam({
    abbreviation: 'FLA',
    isWinner: true,
    name: 'Florida Panthers',
    wins: 4,
  }),
} = {}) => ({
  bestOf: 7,
  conference,
  higherSeedTeam: top,
  id,
  lowerSeedTeam: bottom,
  providerSeriesId: id.toUpperCase(),
  round,
  roundName: round === 3 ? 'Conference Final' : `Round ${round}`,
  status,
  winner: status === 'complete' ? top : null,
  winnerTeamId: status === 'complete' ? top?.teamId : null,
})

const makeSeededSeries = ({
  bottomSeed = 'D3',
  conference,
  id,
  round = 1,
  topSeed = 'D1',
}) => {
  const series = makeSeries({ conference, id, round })

  return {
    ...series,
    higherSeedTeam: { ...series.higherSeedTeam, seed: topSeed },
    lowerSeedTeam: { ...series.lowerSeedTeam, seed: bottomSeed },
  }
}

const makeConference = (id, name) => ({
  id,
  name,
  rounds: [
    {
      id: 'round1',
      label: 'Round 1',
      number: 1,
      series: [
        ['D1', 'WC2'],
        ['D1', 'WC1'],
        ['D2', 'D3'],
        ['D2', 'D3'],
      ].map(([topSeed, bottomSeed], index) =>
        makeSeededSeries({
          bottomSeed,
          conference: id,
          id: `${id}-round1-${index + 1}`,
          topSeed,
        }),
      ),
    },
    {
      id: 'round2',
      label: 'Round 2',
      number: 2,
      series: Array.from({ length: 2 }, (_, index) =>
        makeSeededSeries({
          id: `${id}-round2-${index + 1}`,
          conference: id,
          round: 2,
        }),
      ),
    },
    { id: 'conferenceFinal', label: 'Conference Final', number: 3, series: [makeSeries({ id: `${id}-m`, conference: id, round: 3 })] },
  ],
})

const playoffResult = (overrides = {}) => {
  const final = makeSeries({
    bottom: makePlayoffTeam({
      abbreviation: 'EDM',
      name: 'Edmonton Oilers',
      seed: 'D2',
      wins: 3,
    }),
    conference: '',
    id: 'series-o',
    round: 4,
  })

  return {
    champion: final.winner,
    conferences: {
      eastern: makeConference('eastern', 'Eastern'),
      western: makeConference('western', 'Western'),
    },
    currentSeasonId: '20252026',
    error: null,
    mode: 'actual',
    provider: {
      endpoint: '/playoff-bracket/2025',
      name: 'NHL Web API',
      source: 'cache',
      stale: false,
    },
    season: seasons[1],
    selectedSeasonId: seasons[1].id,
    stanleyCupFinal: final,
    status: 'ready',
    ...overrides,
  }
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  Standings = (await vite.ssrLoadModule('/src/components/Standings.jsx')).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  standingsApi = await vite.ssrLoadModule('/src/services/standingsApi.js')
  standingsUtils = await vite.ssrLoadModule('/src/utils/standings.js')
  playoffUtils = await vite.ssrLoadModule('/src/utils/playoffs.js')
})

after(async () => {
  await vite?.close()
})

const renderStandings = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(Standings, {
      initialResult: standingsResult(),
      ...props,
    }),
  )

test('Standings navigation item is placed directly after Teams', async () => {
  const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8')
  const teamsIndex = appSource.indexOf('label: "Teams"')
  const standingsIndex = appSource.indexOf('label: "Standings"')
  const ratingsIndex = appSource.indexOf('label: "Power Ratings"')

  assert.ok(teamsIndex >= 0)
  assert.ok(teamsIndex < standingsIndex)
  assert.ok(standingsIndex < ratingsIndex)
  assert.match(appSource, /path: "\/standings"/)
  assert.match(appSource, /activePage === "standings"[\s\S]*<Standings/)
})

test('Standings page renders current season, selector and core columns', () => {
  const html = renderStandings()

  assert.match(html, /NHL Standings/)
  assert.match(html, /Current and historical regular-season standings\./)
  assert.match(html, /id="standings-season"/)
  assert.match(html, /2025–26 · Current/)
  assert.equal((html.match(/<option/g) ?? []).length, 6)
  assert.match(html, />GP<\/th>/)
  assert.match(html, />W<\/th>/)
  assert.match(html, />L<\/th>/)
  assert.match(html, />OT<\/th>/)
  assert.match(html, />PTS<\/th>/)
  assert.match(html, />P%<\/th>/)
  assert.match(html, />GF<\/th>/)
  assert.match(html, />GA<\/th>/)
  assert.match(html, />DIFF<\/th>/)
})

test('Conference view is the hockey-focused default with both sections', () => {
  const html = renderStandings()

  assert.match(html, /aria-selected="true"[^>]*>Conference<\/button>/)
  assert.match(html, /Eastern Conference/)
  assert.match(html, /Western Conference/)
  assert.match(html, /Boston Bruins/)
  assert.match(html, /Colorado Avalanche/)
})

test('League and Division views retain official group ordering', () => {
  const leagueHtml = renderStandings({ initialView: 'league' })
  const divisionHtml = renderStandings({ initialView: 'division' })

  assert.match(leagueHtml, /class="standings-sections view-league"/)
  assert.ok(leagueHtml.indexOf('Boston Bruins') < leagueHtml.indexOf('Vancouver Canucks'))
  assert.match(divisionHtml, /Atlantic/)
  assert.match(divisionHtml, /Metropolitan/)
  assert.match(divisionHtml, /Central/)
  assert.match(divisionHtml, /Pacific/)
  assert.ok(divisionHtml.indexOf('Atlantic') < divisionHtml.indexOf('Pacific'))
})

test('team rows show provider logos, records, percentages, goals, L10 and streak', () => {
  const html = renderStandings({ initialView: 'league' })

  assert.match(html, /https:\/\/assets\.nhle\.com\/BOS\.svg/)
  assert.match(html, /<strong>BOS<\/strong>/)
  assert.match(html, />106<\/td>/)
  assert.match(html, />\.646<\/td>/)
  assert.match(html, />\+25<\/td>/)
  assert.match(html, />7-2-1<\/td>/)
  assert.match(html, />W3<\/td>/)
  assert.match(html, /title="Clinched playoff berth"/)
  assert.match(html, /aria-label="Clinched playoff berth"/)
})

test('clinch legend explains every official NHL indicator compactly', () => {
  const html = renderStandings()

  assert.match(html, /aria-label="Clinch indicator legend"/)
  assert.match(html, /Clinched playoff berth/)
  assert.match(html, /Clinched division title/)
  assert.match(html, /Clinched conference title/)
  assert.match(html, /Clinched Presidents&#x27; Trophy/)
  assert.match(html, /Eliminated from playoff contention/)
})

test('combined and unsupported provider indicators retain accessible semantics', () => {
  const badges = standingsUtils.getClinchIndicatorBadges('xq')
  const unsupportedTeams = teams.map((team, index) => ({
    ...team,
    clinchIndicator: index === 0 ? 'q' : '',
  }))
  const html = renderStandings({
    initialResult: standingsResult({ standings: unsupportedTeams }),
    initialView: 'league',
  })

  assert.equal(badges[0].label, 'Clinched playoff berth')
  assert.equal(badges[1].supported, false)
  assert.equal(badges[1].label, 'Official NHL status indicator “q”')
  assert.match(html, /Official NHL status indicator “q”/)
  assert.match(html, /is-unsupported/)
})

test('Playoffs is separated from the grouped standings selectors and activates exclusively', async () => {
  const defaultHtml = renderStandings()
  const playoffHtml = renderStandings({
    initialPlayoffResult: playoffResult(),
    initialView: 'playoffs',
  })
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(defaultHtml, /class="standings-layout-view-group"/)
  assert.match(defaultHtml, /standings-playoffs-view-button/)
  assert.match(css, /\.standings-view-selector[\s\S]*gap: 16px/)
  assert.match(playoffHtml, /aria-selected="true"[^>]*>Playoffs<\/button>/)
  assert.doesNotMatch(playoffHtml, /class="standings-sections/)
  assert.match(playoffHtml, /class="playoffs-view mode-actual"/)

  const restoredHtml = renderStandings({ initialView: 'conference' })
  assert.match(restoredHtml, /Eastern Conference/)
  assert.doesNotMatch(restoredHtml, /class="playoffs-view/)
})

test('Playoffs uses the same season selector and renders actual historical results', () => {
  const historicalStandings = standingsResult({
    season: seasons[1],
    selectedSeasonId: seasons[1].id,
  })
  const html = renderStandings({
    initialPlayoffResult: playoffResult(),
    initialResult: historicalStandings,
    initialView: 'playoffs',
  })

  assert.equal((html.match(/id="standings-season"/g) ?? []).length, 1)
  assert.match(html, /Official bracket/)
  assert.match(html, /2024–25 Stanley Cup Playoffs/)
  assert.match(html, /Actual series and results/)
  assert.match(html, /Round 1/)
  assert.match(html, /Round 2/)
  assert.match(html, /Conference Final/)
  assert.match(html, /Stanley Cup Final/)
  assert.match(html, /FLA wins 4–2/)
  assert.match(html, /Stanley Cup Champion/)
  assert.match(html, /Florida Panthers/)
  assert.match(html, />Winner</)
})

test('playoff bracket keeps the completed Final in a right-side championship column', async () => {
  const html = renderStandings({
    initialPlayoffResult: playoffResult(),
    initialView: 'playoffs',
  })
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')
  const easternIndex = html.indexOf('Eastern Conference')
  const westernIndex = html.indexOf('Western Conference')
  const championshipColumnIndex = html.indexOf('class="playoff-championship-column"')
  const championIndex = html.indexOf('Stanley Cup Champion')
  const finalIndex = html.indexOf('id="cup-final-title"')

  assert.match(html, /class="playoff-bracket-layout"/)
  assert.ok(easternIndex >= 0)
  assert.ok(easternIndex < westernIndex)
  assert.ok(westernIndex < championshipColumnIndex)
  assert.ok(championshipColumnIndex < championIndex)
  assert.ok(championIndex < finalIndex)
  assert.equal((html.match(/Stanley Cup Champion/g) ?? []).length, 1)
  assert.match(html, /FLA wins 4–2/)
  assert.match(html, />Winner</)
  assert.match(
    css,
    /\.playoff-bracket-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 3fr\) minmax\(210px, 1fr\)/,
  )
  assert.match(
    css,
    /\.playoff-championship-column\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
  )
  assert.match(
    css,
    /\.stanley-cup-final\s*\{[\s\S]*?grid-row: 2/,
  )
})

test('compact seed legend explains every unchanged playoff seed abbreviation', () => {
  const html = renderStandings({
    initialPlayoffResult: playoffResult(),
    initialView: 'playoffs',
  })

  assert.match(html, /aria-label="Playoff seed abbreviations"/)
  assert.match(html, /D1–D3/)
  assert.match(html, /Division seed/)
  assert.match(html, /WC1–WC2/)
  assert.match(html, /Wild Card/)
  for (const seed of ['D1', 'D2', 'D3', 'WC1', 'WC2']) {
    assert.match(
      html,
      new RegExp(`class="playoff-team-seed">${seed}</span>`),
    )
  }
})

test('conference brackets preserve reusable 4-2-1 midpoint progression', async () => {
  const html = renderStandings({
    initialPlayoffResult: playoffResult(),
    initialView: 'playoffs',
  })
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')
  const getRoundSeriesCounts = (roundNumber) =>
    [
      ...html.matchAll(
        new RegExp(
          `<section class="playoff-round round-${roundNumber}">([\\s\\S]*?)</section>`,
          'g',
        ),
      ),
    ].map(
      (match) =>
        (match[1].match(/class="playoff-series-card/g) ?? []).length,
    )

  assert.deepEqual(getRoundSeriesCounts(1), [4, 4])
  assert.deepEqual(getRoundSeriesCounts(2), [2, 2])
  assert.deepEqual(getRoundSeriesCounts(3), [1, 1])
  assert.match(
    css,
    /\.playoff-round\s*\{[\s\S]*?grid-template-rows: auto 1fr/,
  )
  assert.match(
    css,
    /\.playoff-series-list\s*\{[\s\S]*?display: flex[\s\S]*?justify-content: space-around/,
  )
})

test('championship column preserves the pending Final when one team is unknown', () => {
  const pendingFinal = makeSeries({
    bottom: null,
    conference: '',
    id: 'series-o',
    round: 4,
    status: 'pending',
    top: makePlayoffTeam({
      abbreviation: 'FLA',
      name: 'Florida Panthers',
      wins: null,
    }),
  })
  const html = renderStandings({
    initialPlayoffResult: playoffResult({
      champion: null,
      stanleyCupFinal: pendingFinal,
    }),
    initialView: 'playoffs',
  })

  assert.match(html, /class="stanley-cup-final"/)
  assert.match(html, /class="playoff-championship-column"/)
  assert.match(html, /Championship/)
  assert.match(html, /Stanley Cup Final/)
  assert.match(html, /Florida Panthers/)
  assert.match(html, />TBD</)
  assert.match(html, /Matchup TBD/)
  assert.doesNotMatch(html, /Stanley Cup Champion/)
})

test('projected playoff view is explicitly a standings snapshot with TBD future rounds', () => {
  const projectedSeries = makeSeries({
    id: 'projected-a',
    status: 'projected',
    top: makePlayoffTeam({
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      wins: null,
    }),
    bottom: makePlayoffTeam({
      abbreviation: 'OTT',
      name: 'Ottawa Senators',
      seed: 'WC2',
      wins: null,
    }),
  })
  const pendingSeries = makeSeries({
    bottom: null,
    id: 'pending-i',
    round: 2,
    status: 'pending',
    top: null,
  })
  const projectedConference = (id, name) => ({
    id,
    name,
    rounds: [
      { id: 'round1', label: 'Round 1', number: 1, series: [projectedSeries] },
      { id: 'round2', label: 'Round 2', number: 2, series: [pendingSeries] },
      { id: 'conferenceFinal', label: 'Conference Final', number: 3, series: [pendingSeries] },
    ],
  })
  const projected = playoffResult({
    champion: null,
    conferences: {
      eastern: projectedConference('eastern', 'Eastern'),
      western: projectedConference('western', 'Western'),
    },
    mode: 'projected',
    season: seasons[0],
    selectedSeasonId: seasons[0].id,
    stanleyCupFinal: pendingSeries,
  })
  const html = renderStandings({
    initialPlayoffResult: projected,
    initialView: 'playoffs',
  })

  assert.match(html, /Projected Playoff Matchups/)
  assert.match(html, /If playoffs started today/)
  assert.match(html, /Projected from current standings/)
  assert.match(html, /not model predictions/)
  assert.match(html, /Projected matchup/)
  assert.match(html, />TBD</)
  assert.doesNotMatch(html, /Stanley Cup Champion/)
})

test('playoff loading, unavailable and projected-unavailable states stay clean', () => {
  const loadingHtml = renderStandings({
    initialPlayoffStatus: 'loading',
    initialView: 'playoffs',
  })
  const unavailableHtml = renderStandings({
    initialPlayoffResult: playoffResult({
      champion: null,
      conferences: null,
      error: { code: 'unavailable', message: 'Unavailable.' },
      stanleyCupFinal: null,
      status: 'unavailable',
    }),
    initialView: 'playoffs',
  })
  const projectedUnavailableHtml = renderStandings({
    initialPlayoffResult: playoffResult({
      champion: null,
      conferences: null,
      error: {
        code: 'projected_unavailable',
        message: 'Projected matchups are unavailable until current standings are available.',
      },
      mode: 'projected',
      stanleyCupFinal: null,
      status: 'projected_unavailable',
    }),
    initialView: 'playoffs',
  })

  assert.match(loadingHtml, /Loading playoff bracket/)
  assert.match(unavailableHtml, /Playoff bracket is not available for this season/)
  assert.match(projectedUnavailableHtml, /Projected matchups are unavailable/)
  assert.doesNotMatch(unavailableHtml, /playoff-conferences/)
})

test('loading, preseason, historical unavailable and provider error states are clear', () => {
  const loadingHtml = renderToStaticMarkup(
    React.createElement(Standings, { initialStatus: 'loading' }),
  )
  const preseasonHtml = renderStandings({
    initialResult: standingsResult({ standings: [], status: 'no_standings' }),
  })
  const unavailableHtml = renderStandings({
    initialResult: standingsResult({
      error: { code: 'unavailable', message: 'Unavailable.' },
      standings: [],
      status: 'unavailable',
    }),
  })
  const providerErrorHtml = renderStandings({
    initialResult: standingsResult({
      error: {
        code: 'provider_error',
        message: 'NHL standings are temporarily unavailable.',
      },
      standings: [],
      status: 'provider_error',
    }),
  })

  assert.match(loadingHtml, /Loading standings/)
  assert.match(preseasonHtml, /Regular-season standings are not available yet\./)
  assert.match(unavailableHtml, /Standings are unavailable for the selected season\./)
  assert.match(providerErrorHtml, /NHL standings are temporarily unavailable\./)
})

test('season API requests update the selected standings query without user identity', async () => {
  const originalFetch = globalThis.fetch
  const requests = []

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ headers: options.headers, url })

    return new Response(JSON.stringify(standingsResult()), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await standingsApi.fetchStandings()
    await standingsApi.fetchStandings('20242025')
    await standingsApi.fetchPlayoffs('20242025')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      '/api/standings',
      '/api/standings?season=20242025',
      '/api/standings/playoffs?season=20242025',
    ],
  )
  assert.equal(
    requests[1].headers.get('Authorization'),
    null,
  )
  assert.equal(requests[1].url.includes('userId'), false)
  assert.equal(requests[2].url.includes('userId'), false)
})

test('standings grouping and formatting are deterministic and safe', () => {
  const divisionSections = standingsUtils.getStandingsSections(
    teams,
    standingsUtils.STANDINGS_VIEWS.DIVISION,
  )

  assert.deepEqual(
    divisionSections.map((section) => section.title),
    ['Atlantic', 'Metropolitan', 'Central', 'Pacific'],
  )
  assert.equal(standingsUtils.formatPointPercentage(0.642), '.642')
  assert.equal(standingsUtils.formatPointPercentage(null), '—')
  assert.equal(standingsUtils.formatGoalDifferential(25), '+25')
  assert.equal(standingsUtils.formatGoalDifferential(-14), '-14')
  assert.equal(standingsUtils.formatGoalDifferential(0), '0')
  assert.equal(
    playoffUtils.getSeriesSummary(makeSeries()),
    'FLA wins 4–2',
  )
  assert.equal(
    playoffUtils.getSeriesSummary(
      makeSeries({
        bottom: makePlayoffTeam({
          abbreviation: 'TOR',
          name: 'Toronto Maple Leafs',
          wins: 2,
        }),
        status: 'active',
        top: makePlayoffTeam({
          abbreviation: 'FLA',
          name: 'Florida Panthers',
          wins: 3,
        }),
      }),
    ),
    'FLA leads 3–2',
  )
})

test('playoff bracket moves the Final below conferences and stacks rounds on narrow screens', async () => {
  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(
    css,
    /@media \(max-width: 1080px\)[\s\S]*?\.playoff-bracket-layout[\s\S]*?grid-template-columns: 1fr[\s\S]*?\.playoff-championship-column[\s\S]*?grid-template-rows: auto[\s\S]*?width: min\(430px, 100%\)[\s\S]*?\.stanley-cup-final[\s\S]*?grid-row: auto/,
  )
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*?\.playoff-rounds[\s\S]*?grid-template-columns: 1fr[\s\S]*?\.playoff-series-list[\s\S]*?display: grid/,
  )
})

test('Standings remains informational and imports no model calculation pipeline', async () => {
  const source = await readFile(
    new URL('../components/Standings.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /Informational only/)
  assert.doesNotMatch(
    source,
    /calculateGame|powerRatingsApi|ratingEngineSettings|Motivation|Kelly/i,
  )
})
