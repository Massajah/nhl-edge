import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let RatingLab
let SpecialTeamsCalibration
let vite

const targetIds = ['20232024', '20242025', '20252026']
const referenceIds = ['20202021', '20212022', '20222023', '20232024', '20242025']
const options = {
  adjustmentOptions: [0, 0.25, 0.5, 0.75, 1],
  baseline: {
    baseHomeAdvantage: 3.5,
    kFactor: 1.3,
    modelVersion: 'power-rating-v1',
    name: 'Base Model v1 only',
    overtimeMultiplier: 0.4,
    probabilityScale: 20,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
    startingRatings: { center: 46, max: 50, min: 42, spread: 8 },
  },
  customThresholdLimits: { max: 12, min: 2 },
  defaultSeasonIds: targetIds,
  referenceSeasons: referenceIds.map((id) => ({
    id,
    label: id,
    specialTeamsDataset: { status: 'ready', teamCount: id === '20202021' ? 31 : 32 },
  })),
  seasons: targetIds.map((id, index) => ({
    eligibleForMainComparison: true,
    historicalDataset: { status: 'ready' },
    id,
    label: id,
    specialTeamsReference: {
      complete: true,
      missingSeasonIds: [],
      sourceSeasonIds: referenceIds.slice(index, index + 3),
    },
  })),
  standardCombinationCount: 20,
  thresholdOptions: [4, 6, 8, 10],
}

const comparison = {
  adjustment: 0.5,
  averageSeasonBrier: 0.241,
  best: true,
  delta: { brierScore: -0.001, logLoss: -0.002 },
  gamesAffectedPercentage: 0.25,
  metrics: {
    accuracy: 0.56,
    brierScore: 0.241,
    expectedCalibrationError: 0.03,
    logLoss: 0.67,
  },
  occurrences: {
    bothTeamsSignal: 27,
    gamesAffected: 198,
    negativeOccurrences: 105,
    positiveOccurrences: 120,
  },
  seasonResults: targetIds.map((seasonId) => ({
    delta: { brierScore: -0.001, logLoss: -0.002 },
    metrics: { brierScore: 0.241, logLoss: 0.67 },
    occurrences: {
      bothTeamsSignal: 9,
      gamesAffected: 66,
      negativeOccurrences: 35,
      positiveOccurrences: 40,
    },
    seasonId,
  })),
  seasonsBeatingBaseline: 2,
  stability: { level: 'stable' },
  threshold: 6,
  worstSeason: { brierScore: 0.245, seasonId: '20242025' },
}

const result = {
  bestTestedResult: {
    adjustment: 0.5,
    brierDelta: -0.001,
    pooledBrier: 0.241,
    seasonsBeatingBaseline: 2,
    threshold: 6,
  },
  comparisons: [comparison],
  rankingAudit: [{
    leagueTeamCount: 32,
    sourceSeasonIds: ['20222023', '20232024', '20242025'],
    targetSeasonId: '20252026',
    teams: [{
      averagePenaltyKillPercentage: 0.82,
      averagePowerPlayPercentage: 0.24,
      penaltyKillLeagueRank: 3,
      powerPlayLeagueRank: 1,
      seasonValues: [
        { sourceTeamAbbreviation: 'ARI' },
        { sourceTeamAbbreviation: 'ARI' },
        { sourceTeamAbbreviation: 'UTA' },
      ],
      teamAbbreviation: 'UTA',
    }],
  }],
  thresholdSummary: [{
    bestPooledBrier: 0.241,
    bestTestedAdjustment: 0.5,
    gamesAffectedPercentage: 0.25,
    occurrences: comparison.occurrences,
    seasonsBeatingBaseline: 2,
    signalDiagnostics: {
      negative: {
        actualWinRate: 0.47,
        averageBaselineExpectedWinProbability: 0.51,
        averageBrierContribution: 0.26,
        occurrences: 105,
        rankExtremity: { averageRankGap: 25 },
      },
      positive: {
        actualWinRate: 0.58,
        averageBaselineExpectedWinProbability: 0.53,
        averageBrierContribution: 0.24,
        occurrences: 120,
        rankExtremity: { averageRankGap: 26 },
      },
    },
    threshold: 6,
    totalSignalOccurrences: 225,
  }],
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  RatingLab = (await vite.ssrLoadModule('/src/components/RatingLab.jsx')).default
  SpecialTeamsCalibration = (
    await vite.ssrLoadModule('/src/components/SpecialTeamsCalibration.jsx')
  ).default
})

after(async () => {
  await vite?.close()
})

test('Rating Lab exposes the production-isolated Phase 4 Special Teams tab', () => {
  const html = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'special-teams',
    initialSpecialTeamsOptions: options,
  }))

  assert.match(html, /Special Teams/)
  assert.match(html, /Phase 4 — Special Teams Matchup Calibration/)
  assert.match(html, /strong PP vs weak PK and weak PP vs strong PK/)
  assert.match(html, /Base Model v1 only/)
  assert.doesNotMatch(html, /Apply to Production|Apply to production/)
})

test('Phase 4 renders readiness, standard thresholds, custom N and one-run grid', () => {
  const html = renderToStaticMarkup(
    React.createElement(SpecialTeamsCalibration, { initialOptions: options }),
  )

  assert.match(html, /Historical data readiness/)
  assert.match(html, /Frozen S−3 through S−1/)
  assert.match(html, /4 · 6 · 8 · 10/)
  assert.match(html, /0\.00 · \+0\.25 · \+0\.50 · \+0\.75 · \+1\.00/)
  assert.match(html, /Optional custom N/)
  assert.match(html, /type="number" min="2" max="12"/)
  assert.match(html, /Run 20-combination grid/)
  assert.match(html, /Positive signals add \+X; negative signals add −X/)
})

test('Phase 4 results show occurrence, threshold, season and frozen-ranking diagnostics', () => {
  const html = renderToStaticMarkup(
    React.createElement(SpecialTeamsCalibration, {
      initialOptions: options,
      initialResult: result,
    }),
  )

  assert.match(html, /Best tested result/)
  assert.match(html, /Not automatically recommended/)
  assert.match(html, /Threshold-only diagnostic/)
  assert.match(html, /Both teams signal/)
  assert.match(html, /Positive vs negative signal diagnostics/)
  assert.match(html, /Positive signal only/)
  assert.match(html, /Negative signal only/)
  assert.match(html, /Special Teams comparison grid/)
  assert.match(html, /Games affected/)
  assert.match(html, /Per-season diagnostics/)
  assert.match(html, /Frozen historical Special Teams rankings/)
  assert.match(html, /20252026 Special Teams reference/)
  assert.match(html, /ARI · ARI · UTA/)
  assert.match(html, /Production remains informational alert-only/)
})

test('missing historical inputs are explicit and keep the run disabled', () => {
  const missingOptions = {
    ...options,
    seasons: options.seasons.map((season, index) => index === 0 ? {
      ...season,
      eligibleForMainComparison: false,
      specialTeamsReference: {
        ...season.specialTeamsReference,
        complete: false,
        missingSeasonIds: ['20202021'],
      },
    } : season),
  }
  const html = renderToStaticMarkup(
    React.createElement(SpecialTeamsCalibration, {
      initialOptions: missingOptions,
    }),
  )

  assert.match(html, /Historical data is not ready/)
  assert.match(html, /Required: 20202021/)
  assert.match(html, /Partial ranking windows are excluded/)
  assert.match(html, /Run 20-combination grid/)
  assert.match(html, /disabled/)
})

test('Phase 4 API wrappers expose options, two preparation paths and one run', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(
      new URL('../services/powerRatingSimulationsApi.js', import.meta.url),
      'utf8',
    ),
  )

  assert.match(source, /special-teams\/options/)
  assert.match(source, /special-teams\/historical-seasons/)
  assert.match(source, /special-teams\/reference-seasons/)
  assert.match(source, /special-teams\/run/)
})
