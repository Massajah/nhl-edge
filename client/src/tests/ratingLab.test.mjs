import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let RatingLab
let apiClient
let simulationsApi
let ratingLabUtils
let vite

const mockSimulation = {
  modelVersion: 'power-rating-v1',
  skipReasons: {
    UNSUPPORTED_GAME_TYPE: 58,
  },
  summary: {
    averageRating: 50.123456,
    gamesEligible: 1312,
    gamesFetched: 1312,
    gamesProcessed: 1312,
    gamesSkipped: 58,
    highestRatedTeam: {
      abbreviation: 'COL',
      rating: 56.2,
      teamId: 'COL',
    },
    lowestRatedTeam: {
      abbreviation: 'ANA',
      rating: 44,
      teamId: 'ANA',
    },
    medianRating: 49.991,
    ratingRange: 12.2,
    standardDeviation: 2.34567,
    teamsRanked: 6,
  },
  teamResults: [
    {
      abbreviation: 'BOS',
      finalRating: 52,
      gamesProcessed: 82,
      netChange: 2,
      startingRating: 50,
      teamId: 'BOS',
      teamName: 'Boston Bruins',
    },
    {
      abbreviation: 'COL',
      finalRating: 56.2,
      gamesProcessed: 82,
      netChange: 6.2,
      startingRating: 50,
      teamId: 'COL',
      teamName: 'Colorado Avalanche',
    },
    {
      abbreviation: 'ANA',
      finalRating: 44,
      gamesProcessed: 82,
      netChange: -6,
      startingRating: 50,
      teamId: 'ANA',
      teamName: 'Anaheim Ducks',
    },
    {
      abbreviation: 'DAL',
      finalRating: 51,
      gamesProcessed: 82,
      netChange: -1,
      startingRating: 52,
      teamId: 'DAL',
      teamName: 'Dallas Stars',
    },
    {
      abbreviation: 'EDM',
      finalRating: 54,
      gamesProcessed: 82,
      netChange: 6,
      startingRating: 48,
      teamId: 'EDM',
      teamName: 'Edmonton Oilers',
    },
    {
      abbreviation: 'TOR',
      finalRating: 50,
      gamesProcessed: 82,
      netChange: 0,
      startingRating: 50,
      teamId: 'TOR',
      teamName: 'Toronto Maple Leafs',
    },
  ],
  warnings: [],
}

const replayOptions = {
  seasons: [
    {
      endDate: '2026-04-16',
      historicalDataset: { status: 'ready' },
      id: '20252026',
      label: '2025–26',
      startDate: '2025-10-07',
    },
    {
      endDate: '2025-04-17',
      historicalDataset: { status: 'partial' },
      id: '20242025',
      label: '2024–25',
      startDate: '2024-10-04',
    },
    {
      endDate: '2024-04-18',
      historicalDataset: { status: 'ready' },
      id: '20232024',
      label: '2023–24',
      startDate: '2023-10-10',
    },
  ],
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

  RatingLab = (await vite.ssrLoadModule('/src/components/RatingLab.jsx')).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  simulationsApi = await vite.ssrLoadModule(
    '/src/services/powerRatingSimulationsApi.js',
  )
  ratingLabUtils = await vite.ssrLoadModule('/src/utils/ratingLab.js')
})

after(async () => {
  await vite?.close()
})

const renderRatingLab = (props = {}) =>
  renderToStaticMarkup(React.createElement(RatingLab, props))

test('Rating Lab renders controls', () => {
  const html = renderRatingLab()

  assert.match(html, /Season/)
  assert.match(html, /Custom date range/)
  assert.match(html, /Date From/)
  assert.match(html, /Date To/)
  assert.match(html, /Equal ratings \(50\.0\)/)
  assert.match(html, /neutral rating of 50\.0/)
  assert.match(html, /Current Power Ratings/)
  assert.match(html, /Scenario replay starting from current production ratings/)
  assert.match(html, /Regular season/)
  assert.doesNotMatch(html, />Preseason</)
  assert.match(html, /Run Replay/)
  assert.match(html, /Reset Defaults/)
})

test('prepared replay seasons populate dynamically and default to the newest ready season', () => {
  const seasons = ratingLabUtils.getPreparedReplaySeasons(replayOptions)
  const html = renderRatingLab({ initialReplayOptions: replayOptions })

  assert.deepEqual(
    seasons.map((season) => season.id),
    ['20252026', '20232024'],
  )
  assert.equal(
    ratingLabUtils.getDefaultReplaySeasonId(replayOptions),
    '20252026',
  )
  assert.match(html, /2025–26/)
  assert.match(html, /2023–24/)
  assert.doesNotMatch(html, /2024–25/)
  assert.match(html, /Authoritative regular-season range/)
  assert.match(html, /2025-10-07 to 2026-04-16/)
  assert.doesNotMatch(html, /id="rating-lab-date-from"/)
  assert.doesNotMatch(html, /id="rating-lab-date-to"/)
})

test('season presets and equivalent custom dates produce the identical replay request', () => {
  const seasons = ratingLabUtils.getPreparedReplaySeasons(replayOptions)
  const presetForm = ratingLabUtils.applyReplaySeasonPreset(
    ratingLabUtils.createRatingLabDefaultForm(),
    '20252026',
    seasons,
  )
  const customForm = ratingLabUtils.createRatingLabDefaultForm()

  customForm.dateFrom = '2025-10-07'
  customForm.dateTo = '2026-04-16'

  assert.equal(presetForm.dateFrom, '2025-10-07')
  assert.equal(presetForm.dateTo, '2026-04-16')
  assert.deepEqual(
    ratingLabUtils.createSimulationPreviewPayload(presetForm),
    ratingLabUtils.createSimulationPreviewPayload(customForm),
  )
})

test('Custom date range restores editable controls and preserves replay modes', () => {
  const form = ratingLabUtils.createRatingLabDefaultForm()

  form.dateFrom = '2025-09-20'
  form.dateTo = '2026-06-30'
  form.startingMode = 'current'
  form.gameTypes.playoffs = true
  const html = renderRatingLab({
    initialForm: form,
    initialReplayOptions: replayOptions,
    initialReplaySeasonId: ratingLabUtils.CUSTOM_REPLAY_SEASON_ID,
  })
  const payload = ratingLabUtils.createSimulationPreviewPayload(form)

  assert.match(html, /id="rating-lab-date-from"[^>]*value="2025-09-20"/)
  assert.match(html, /id="rating-lab-date-to"[^>]*value="2026-06-30"/)
  assert.equal(payload.startingMode, 'current')
  assert.deepEqual(payload.gameTypes, {
    playoffs: true,
    preseason: false,
    regularSeason: true,
  })
})

test('preview API sends the correct protected request payload', async () => {
  const originalFetch = globalThis.fetch
  const form = ratingLabUtils.createRatingLabDefaultForm()
  form.dateFrom = '2024-10-04'
  form.dateTo = '2025-04-17'
  const payload = ratingLabUtils.createSimulationPreviewPayload(form)
  let capturedRequest

  apiClient.setAuthToken('test-token')
  globalThis.fetch = async (url, options) => {
    capturedRequest = {
      body: JSON.parse(options.body),
      headers: options.headers,
      method: options.method,
      url,
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    await simulationsApi.previewPowerRatingSimulation(payload)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequest.url, '/api/power-rating-simulations/preview')
  assert.equal(capturedRequest.method, 'POST')
  assert.equal(capturedRequest.headers.get('Authorization'), 'Bearer test-token')
  assert.deepEqual(capturedRequest.body, {
    configuration: {
      kFactor: 1.3,
      overtimeMultiplier: 0.4,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.1,
    },
    dateFrom: '2024-10-04',
    dateTo: '2025-04-17',
    gameTypes: {
      playoffs: false,
      preseason: false,
      regularSeason: true,
    },
    includeGameResults: false,
    includeSkippedGames: false,
    startingMode: 'equal',
  })
})

test('Rating Lab renders loading state', () => {
  const html = renderRatingLab({ initialStatus: 'loading' })

  assert.match(html, /Running replay/)
  assert.match(html, /full-season replay may take a moment/)
  assert.match(html, /disabled/)
})

test('successful response renders summary data', () => {
  const html = renderRatingLab({ initialResult: mockSimulation })

  assert.match(html, /Games fetched/)
  assert.match(html, new RegExp(ratingLabUtils.formatRatingLabInteger(1312)))
  assert.match(html, /Average rating/)
  assert.match(html, /50.12/)
  assert.match(html, /Highest rated team/)
  assert.match(html, /COL/)
  assert.match(html, /Unsupported Game Type/)
  assert.match(html, /58/)
})

test('ranking is sorted by final rating descending by default', () => {
  const { tableTeams } = ratingLabUtils.deriveRatingLabResults(mockSimulation)

  assert.deepEqual(
    tableTeams.map((team) => team.abbreviation),
    ['COL', 'EDM', 'BOS', 'DAL', 'TOR', 'ANA'],
  )
})

test('biggest risers and fallers are derived from netChange', () => {
  const { fallers, risers } =
    ratingLabUtils.deriveRatingLabResults(mockSimulation)

  assert.deepEqual(
    risers.slice(0, 2).map((team) => team.abbreviation),
    ['COL', 'EDM'],
  )
  assert.deepEqual(
    fallers.slice(0, 2).map((team) => team.abbreviation),
    ['ANA', 'DAL'],
  )
})

test('validation and API errors are shown', () => {
  const form = ratingLabUtils.createRatingLabDefaultForm()
  const html = renderRatingLab({
    initialErrorMessage: 'dateFrom must use YYYY-MM-DD format. Field: dateFrom.',
    initialStatus: 'error',
  })

  assert.equal(
    ratingLabUtils.validateRatingLabForm(form),
    'Choose a start date and end date before running the replay.',
  )
  assert.match(html, /dateFrom must use YYYY-MM-DD format/)
})

test('reset defaults restore default values', () => {
  const form = ratingLabUtils.createRatingLabDefaultForm()

  form.dateFrom = '2024-10-04'
  form.dateTo = '2025-04-17'
  form.gameTypes.playoffs = true
  form.configuration.kFactor = '2'

  assert.deepEqual(
    ratingLabUtils.createRatingLabDefaultForm(),
    ratingLabUtils.RATING_LAB_DEFAULT_FORM,
  )
  assert.deepEqual(ratingLabUtils.createRatingLabDefaultForm(), {
    configuration: {
      kFactor: '1.3',
      overtimeMultiplier: '0.4',
      regulationMultiplier: '1',
      shootoutMultiplier: '0.1',
    },
    dateFrom: '',
    dateTo: '',
    gameTypes: {
      playoffs: false,
      preseason: false,
      regularSeason: true,
    },
    startingMode: 'equal',
  })
})
