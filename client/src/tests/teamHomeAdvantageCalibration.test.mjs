import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let RatingLab
let apiClient
let simulationsApi
let utils
let vite

const seasonIds = [
  '20202021',
  '20212022',
  '20222023',
  '20232024',
  '20242025',
  '20252026',
]

const makeTeam = (index) => {
  const tier = index < 9 ? 'Strong' : index < 23 ? 'Normal' : 'Weak'
  const advantage = index < 9
    ? 0.1982 - index * 0.01
    : index < 13
      ? 0.1064 - (index - 9) * 0.0003
      : index < 23
        ? 0.095 - (index - 13) * 0.004
        : 0.04 - (index - 23) * 0.004

  return {
    abbreviation: `T${index}`,
    away: {
      gamesPlayed: 123,
      losses: 40,
      overtimeLosses: 8,
      points: 158,
      pointsPercentage: 0.54,
      winPercentage: 0.51,
      wins: 63,
    },
    home: {
      gamesPlayed: 123,
      losses: 35,
      overtimeLosses: 8,
      points: 168,
      pointsPercentage: 0.54 + advantage,
      winPercentage: 0.51 + advantage,
      wins: 68,
    },
    homePointsAdvantage: advantage,
    homeWinAdvantage: advantage,
    rank: index + 1,
    teamId: `T${index}`,
    teamName: `Team ${String(index + 1).padStart(2, '0')}`,
    tier,
  }
}

const teams = Array.from({ length: 32 }, (_item, index) => makeTeam(index))

const options = {
  backtestPlan: [
    {
      leakageSafe: true,
      missingSeasonIds: [],
      sourceSeasonIds: ['20202021', '20212022', '20222023'],
      targetSeasonId: '20232024',
      targetStatus: 'ready',
    },
    {
      leakageSafe: true,
      missingSeasonIds: [],
      sourceSeasonIds: ['20212022', '20222023', '20232024'],
      targetSeasonId: '20242025',
      targetStatus: 'ready',
    },
    {
      leakageSafe: true,
      missingSeasonIds: [],
      sourceSeasonIds: ['20222023', '20232024', '20242025'],
      targetSeasonId: '20252026',
      targetStatus: 'ready',
    },
  ],
  currentAnalysis: {
    aggregationMethod: 'Raw games are pooled across seasons before percentages are calculated.',
    gamesIncluded: 3936,
    league: {
      awayPointsPercentage: 0.54,
      awayWinPercentage: 0.48,
      homePointsPercentage: 0.59,
      homeWinPercentage: 0.55,
    },
    seasonIds: ['20232024', '20242025', '20252026'],
    teams,
    tierBoundaries: {
      effectiveTieTolerance: 0.001,
      method: 'local_gap_aware',
      minimumTierSize: 6,
      normalWeak: {
        boundaryAfterRank: 23,
        gap: 0.019,
        lower: { homePointsAdvantage: 0.04, rank: 24, teamId: 'T23', teamName: 'Team 24' },
        selection: 'largest_meaningful_local_gap',
        targetRank: 21,
        upper: { homePointsAdvantage: 0.059, rank: 23, teamId: 'T22', teamName: 'Team 23' },
      },
      searchRadius: 3,
      strongNormal: {
        boundaryAfterRank: 9,
        gap: 0.0118,
        lower: { homePointsAdvantage: 0.1064, rank: 10, teamId: 'T9', teamName: 'Team 10' },
        selection: 'largest_meaningful_local_gap',
        targetRank: 11,
        upper: { homePointsAdvantage: 0.1182, rank: 9, teamId: 'T8', teamName: 'Team 09' },
      },
      version: 'home-points-local-gap-v1',
    },
    tierSizes: { normal: 14, strong: 9, weak: 9 },
    tierSummary: [
      { averageHomePointsAdvantage: 0.15, medianHomePointsAdvantage: 0.15, teamCount: 9, tier: 'Strong' },
      { averageHomePointsAdvantage: 0.08, medianHomePointsAdvantage: 0.08, teamCount: 14, tier: 'Normal' },
      { averageHomePointsAdvantage: 0.02, medianHomePointsAdvantage: 0.02, teamCount: 9, tier: 'Weak' },
    ],
  },
  defaults: {
    adjustmentOptions: [0, 0.25, 0.5, 0.75, 1],
    baseHomeAdvantage: 3.5,
    currentRankingSeasonIds: ['20232024', '20242025', '20252026'],
    maxCustomAdjustment: 5,
    tierBoundaryConfig: {
      effectiveTieTolerance: 0.001,
      gapComparisonEpsilon: 1e-12,
      maximumMinimumTierSize: 6,
      method: 'local_gap_aware',
      searchRadius: 3,
      version: 'home-points-local-gap-v1',
    },
    modelParameters: {
      kFactor: 1.3,
      overtimeMultiplier: 0.4,
      probabilityScale: 20,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.1,
      startingRatings: { center: 46, max: 50, min: 42, spread: 8 },
    },
  },
  franchiseIdentity: {
    arizonaUtah: 'Arizona Coyotes records are explicitly normalized to Utah Mammoth.',
    method: 'centralized_nhl_team_identity',
  },
  isolation: {
    historicalSource: 'HistoricalNhlGame / HistoricalSeasonDataset',
    productionSettingsRead: false,
    productionWrites: false,
  },
  readiness: {
    backtestReady: true,
    currentRankingReady: true,
    missingBacktestSeasonIds: [],
    missingCurrentRankingSeasonIds: [],
    stabilityReady: true,
  },
  seasons: seasonIds.map((id) => ({
    historicalDataset: { completedGames: id === '20202021' ? 868 : 1312, status: 'ready' },
    id,
    label: id,
    purposes: id < '20232024' ? ['tier_history'] : ['current_ranking', 'backtest_target', 'tier_history'],
  })),
  stability: {
    previousWindowSeasonIds: ['20222023', '20232024', '20242025'],
    strongRetention: { eligible: 9, rate: 0.78, retained: 7 },
    teams: teams.map((team, index) => ({
      currentTier: team.tier,
      previousTier: index % 2 ? team.tier : 'Normal',
      status: index % 2 ? 'Stable' : 'Changed',
      teamId: team.teamId,
      teamName: team.teamName,
    })),
    weakRetention: { eligible: 9, rate: 0.67, retained: 6 },
  },
  tierBoundaries: null,
}

options.tierBoundaries = options.currentAnalysis.tierBoundaries

const result = {
  comparisons: [0, 0.25, 0.5, 0.75, 1].map((adjustment, index) => ({
    adjustment,
    averageSeasonBrier: 0.241 - index * 0.0001,
    best: adjustment === 0.5,
    delta: {
      brierScore: adjustment === 0 ? 0 : -0.0001 * index,
      logLoss: adjustment === 0 ? 0 : -0.0002 * index,
    },
    metrics: {
      accuracy: 0.57,
      brierScore: adjustment === 0.5 ? 0.2399 : 0.241 - index * 0.0001,
      expectedCalibrationError: 0.021,
      logLoss: 0.681 - index * 0.0002,
    },
    seasonResults: seasonIds.slice(-3).map((seasonId) => ({ seasonId })),
    seasonsBeatingBaseline: index,
    stability: { level: 'stable' },
    worstSeason: { brierScore: 0.244, seasonId: '20232024' },
  })),
  currentAnalysis: options.currentAnalysis,
  diagnostics: {
    baseHomeAdvantage: 3.5,
    classificationFrozenBeforeReplay: true,
    noFutureData: true,
    productionWrites: false,
    tierAlgorithmVersion: 'home-points-local-gap-v1',
  },
  snapshots: seasonIds.slice(-3).map((targetSeasonId, index) => ({
    targetSeasonId,
    tierSizes: index === 1
      ? { normal: 13, strong: 10, weak: 9 }
      : { normal: 14, strong: 9, weak: 9 },
  })),
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  RatingLab = (await vite.ssrLoadModule('/src/components/RatingLab.jsx')).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  simulationsApi = await vite.ssrLoadModule('/src/services/powerRatingSimulationsApi.js')
  utils = await vite.ssrLoadModule('/src/utils/teamHomeAdvantageCalibration.js')
})

after(async () => {
  await vite?.close()
})

const renderHomeAdvantage = (props = {}) =>
  renderToStaticMarkup(React.createElement(RatingLab, {
    initialHomeAdvantageOptions: options,
    initialMode: 'home-advantage',
    ...props,
  }))

test('Team Home Advantage tab renders isolated Phase 2 ranking and leakage explanation', () => {
  const html = renderHomeAdvantage()

  assert.match(html, /Team Home Advantage/)
  assert.match(html, /Production-isolated Phase 2/)
  assert.match(html, /never writes Team Home Adjustments/)
  assert.match(html, /Leakage-safe season readiness/)
  assert.match(html, /Target-season results never participate/)
  assert.match(html, /tiers are frozen before replay/)
  assert.match(html, /Current 3-Year Home Strength Ranking/)
  assert.match(html, /2023–24, 2024–25, and 2025–26 raw games are combined/)
  assert.match(html, /Home P% advantage/)
  assert.match(html, /Home W% advantage/)
  assert.match(html, /Team 01/)
})

test('ranking exposes all three tier counts, summaries, league rates and stability', () => {
  const html = renderHomeAdvantage()

  assert.match(html, /Strong: 9 · Normal: 14 · Weak: 9/)
  assert.match(html, /Strong[\s\S]*9 teams/)
  assert.match(html, /Normal[\s\S]*14 teams/)
  assert.match(html, /Weak[\s\S]*9 teams/)
  assert.match(html, /Tier boundaries follow local gaps/)
  assert.match(html, /Strong \/ Normal boundary[\s\S]*\+11\.82 pp → \+10\.64 pp · Gap: 1\.18 pp/)
  assert.match(html, /Normal \/ Weak boundary[\s\S]*\+5\.90 pp → \+4\.00 pp · Gap: 1\.90 pp/)
  assert.match(html, /League Home P%/)
  assert.match(html, /League Away W%/)
  assert.match(html, /Strong-tier retention/)
  assert.match(html, /Weak-tier retention/)
  assert.match(html, /Previous Normal \/ Latest Strong/)
  assert.match(html, /Stable/)
  assert.match(html, /Changed/)
})

test('ranking shows two-decimal Home Points Advantage and keeps the near-tied cluster Normal', () => {
  const html = renderHomeAdvantage()

  assert.match(html, /\+11\.82 pp/)
  assert.match(html, /Team 10[\s\S]*\+10\.64 pp[\s\S]*home-tier normal[\s\S]*Normal/)
  assert.match(html, /Team 11[\s\S]*\+10\.61 pp[\s\S]*home-tier normal[\s\S]*Normal/)
  assert.match(html, /Team 12[\s\S]*\+10\.58 pp[\s\S]*home-tier normal[\s\S]*Normal/)
})

test('tier test offers initial X options, custom X and read-only preview without Apply control', () => {
  const html = renderHomeAdvantage()

  assert.match(html, /No team adjustment/)
  assert.match(html, /±0\.25/)
  assert.match(html, /±0\.50/)
  assert.match(html, /±0\.75/)
  assert.match(html, /±1\.00/)
  assert.match(html, /Custom X/)
  assert.match(html, /Strong = Base HA \+ X/)
  assert.match(html, /Normal = Base HA/)
  assert.match(html, /Weak = Base HA − X/)
  assert.match(html, /42–50 \(center 46\)/)
  assert.match(html, /Reg \/ OT \/ SO/)
  assert.match(html, /Read-only recommendation preview/)
  assert.match(html, /Effective HA 3\.50/)
  assert.doesNotMatch(html, /Apply to Production/)
})

test('comparison results show deltas, pooled metrics and best-result highlight', () => {
  const html = renderHomeAdvantage({ initialHomeAdvantageResult: result })

  assert.match(html, /Backtest comparison/)
  assert.match(html, /Δ Brier/)
  assert.match(html, /Δ Log Loss/)
  assert.match(html, /Log loss/)
  assert.match(html, /ECE/)
  assert.match(html, /Worst season/)
  assert.match(html, /Seasons beating baseline/)
  assert.match(html, /Best Brier/)
  assert.match(html, /Tier sizes by target season/)
  assert.match(html, /2023–24[\s\S]*9 \/ 14 \/ 9/)
  assert.match(html, /2024–25[\s\S]*10 \/ 13 \/ 9/)
  assert.match(html, /No statistical-significance claim/)
})

test('comparison results from an old tier algorithm version are not displayed', () => {
  const staleResult = {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      tierAlgorithmVersion: 'ranked-terciles-v0',
    },
  }
  const html = renderHomeAdvantage({ initialHomeAdvantageResult: staleResult })

  assert.doesNotMatch(html, /Backtest comparison/)
})

test('ranking sorting is deterministic for every supported diagnostic', () => {
  const unordered = [teams[5], teams[1], teams[3]]

  for (const option of utils.HOME_ADVANTAGE_SORT_OPTIONS) {
    const sorted = utils.sortHomeAdvantageTeams(unordered, {
      direction: 'desc',
      key: option.key,
    })
    assert.equal(sorted.length, 3)
    assert.equal(sorted[0].teamId, 'T1')
  }

  const tied = [
    { ...teams[0], homePointsAdvantage: 0.1, teamName: 'Zulu' },
    { ...teams[1], homePointsAdvantage: 0.1, teamName: 'Alpha' },
  ]
  assert.equal(utils.sortHomeAdvantageTeams(tied)[0].teamName, 'Alpha')
})

test('custom X validation and payload construction reject unsafe values', () => {
  assert.equal(utils.validateCustomAdjustment('', 5), '')
  assert.equal(utils.validateCustomAdjustment('0.62', 5), '')
  assert.match(utils.validateCustomAdjustment('-0.1', 5), /between 0 and 5/)
  assert.deepEqual(utils.createHomeAdvantagePayload(''), {})
  assert.deepEqual(utils.createHomeAdvantagePayload('0.62'), { customAdjustment: 0.62 })
  assert.equal(utils.formatPercentagePoints(0.113), '+11.3 pp')
  assert.equal(utils.formatPercentagePoints(0.1058, 2), '+10.58 pp')
  assert.equal(utils.formatSeasonLabel('20232024'), '2023–24')
})

test('loading, error and partial historical data states remain explicit', () => {
  const loadingHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'home-advantage',
  }))
  const errorHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialHomeAdvantageErrorMessage: 'Historical datasets unavailable.',
    initialMode: 'home-advantage',
  }))
  const partialOptions = {
    ...options,
    currentAnalysis: null,
    readiness: {
      ...options.readiness,
      backtestReady: false,
      currentRankingReady: false,
      missingBacktestSeasonIds: ['20202021', '20252026'],
      missingCurrentRankingSeasonIds: ['20252026'],
    },
    seasons: options.seasons.map((season) => season.id === '20252026'
      ? { ...season, historicalDataset: { completedGames: 640, status: 'partial' } }
      : season),
  }
  const partialHtml = renderHomeAdvantage({
    initialHomeAdvantageOptions: partialOptions,
  })

  assert.match(loadingHtml, /Loading Team Home Advantage/)
  assert.match(errorHtml, /Team Home Advantage is unavailable/)
  assert.match(errorHtml, /Historical datasets unavailable/)
  assert.match(partialHtml, /More history required/)
  assert.match(partialHtml, /Partial · 640 games/)
  assert.match(partialHtml, /Current ranking inputs are incomplete/)
  assert.match(partialHtml, /Additional required seasons: 20202021, 20252026/)
})

test('Team Home Advantage APIs use authenticated isolated options, prepare and run endpoints', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('phase-2-token')
  globalThis.fetch = async (url, requestOptions) => {
    capturedRequests.push({
      body: requestOptions.body ? JSON.parse(requestOptions.body) : null,
      headers: requestOptions.headers,
      method: requestOptions.method,
      url,
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await simulationsApi.getHomeAdvantageCalibrationOptions()
    await simulationsApi.prepareHomeAdvantageHistoricalSeason('20202021')
    await simulationsApi.runHomeAdvantageCalibration({ customAdjustment: 0.6 })
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(
    capturedRequests[0].url,
    '/api/power-rating-simulations/home-advantage/options',
  )
  assert.equal(capturedRequests[0].method, 'GET')
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer phase-2-token',
  )
  assert.equal(
    capturedRequests[1].url,
    '/api/power-rating-simulations/home-advantage/historical-seasons/20202021/prepare',
  )
  assert.deepEqual(capturedRequests[1].body, { refresh: false })
  assert.equal(
    capturedRequests[2].url,
    '/api/power-rating-simulations/home-advantage/run',
  )
  assert.deepEqual(capturedRequests[2].body, { customAdjustment: 0.6 })
})
