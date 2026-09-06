import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let RatingLab
let apiClient
let calibrationUtils
let simulationsApi
let vite

const options = {
  defaults: {
    configuration: {
      kFactor: 1.2,
      overtimeMultiplier: 0.7,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
    dateFrom: '2024-10-04',
    dateTo: '2025-04-17',
    homeAdvantage: 4,
    probabilityScale: 6,
    seasonId: '20242025',
    startingRatings: {
      center: 46,
      mode: 'current',
      spread: 18,
    },
  },
  modelVersion: 'power-rating-v1',
  seasonMetadataSource: 'fallback',
  startingStatePolicies: {
    multiSeason: {
      label: 'Fixed 42–50 · Alphabetical ordering',
      policy: 'FIXED_SPREAD_ALPHABETICAL',
    },
    singleSeasonScenarios: {
      currentProductionAvailable: true,
    },
  },
  seasons: [
    {
      endDate: '2025-04-17',
      historicalDataset: {
        completedGames: 1307,
        expectedApproximateGames: 1312,
        importedGames: 1307,
        status: 'ready',
      },
      id: '20242025',
      isCurrent: false,
      label: '2024–25',
      startDate: '2024-10-04',
    },
    {
      endDate: '2024-04-18',
      historicalDataset: {
        completedGames: 640,
        expectedApproximateGames: 1312,
        importedGames: 640,
        status: 'partial',
      },
      id: '20232024',
      isCurrent: false,
      label: '2023–24',
      startDate: '2023-10-10',
    },
  ],
  warning: 'Season dates loaded from tested fallback metadata.',
}

const makeRun = ({ brierScore, ece = 0.021, label }) => ({
  aggregate: {
    averageSeasonBrier: brierScore,
    bestSeason: { brierScore, label: '2024–25', seasonId: '20242025' },
    brierRange: 0,
    brierStandardDeviation: 0,
    completedSeasons: 1,
    incomplete: false,
    requestedSeasons: 1,
    worstSeason: { brierScore, label: '2024–25', seasonId: '20242025' },
  },
  baselineComparison: {
    constant50: brierScore < 0.25 ? 'better' : 'worse',
    historicalHomeRate: brierScore < 0.24 ? 'better' : 'worse',
  },
  calibrationBuckets: [
    {
      actualRate: 0.54,
      averageProbability: 0.52,
      count: 600,
      gap: 0.02,
      label: '50–55%',
    },
  ],
  confidenceBuckets: [
    {
      actualRate: 0.57,
      averageProbability: 0.55,
      count: 420,
      gap: 0.02,
      label: '50–55%',
    },
  ],
  coverage: {
    completedSeasonIds: ['20242025'],
    completedSeasons: 1,
    failedSeasonIds: [],
    failedSeasons: 0,
    incomplete: false,
    requestedSeasonIds: ['20242025'],
    seasons: [
      {
        boundaries: {
          metadataSource: 'tested-explicit',
          resolvedEndDate: '2025-04-17',
          resolvedStartDate: '2024-10-04',
        },
        dataSource: 'MongoDB historical dataset',
        errorCode: null,
        expectedGames: { approximate: 1312, minimum: 1250 },
        gamesFound: 1320,
        gamesIncluded: 1312,
        gamesSkipped: 8,
        label: options.seasons[0].label,
        metrics: { brierScore },
        seasonId: '20242025',
        status: 'completed',
        userMessage: null,
      },
    ],
    selectedSeasons: 1,
  },
  dataset: {
    gamesFound: 1320,
    gamesIncluded: 1312,
    gamesSkipped: 8,
    skipReasons: { NOT_COMPLETED: 8 },
    source: 'MongoDB historical dataset',
  },
  displayLabel: `2024–25 · ${label} · Scale 6`,
  diagnostics: {
    centerInvariance: { passed: true },
    formula: '1 / (1 + exp(-difference / scale))',
    metricDefinitions: {
      brierScore: 'Mean squared error. Lower is better.',
    },
    productionWrites: false,
  },
  experimental: true,
  filters: {
    dateFrom: '2024-10-04',
    dateTo: '2025-04-17',
    seasonId: '20242025',
  },
  finalRatingSummary: {
    average: 46,
    bottomTeams: [],
    highest: { abbreviation: 'BOS', rating: 54 },
    lowest: { abbreviation: 'TOR', rating: 38 },
    spread: 16,
    topTeams: [],
  },
  label,
  metrics: {
    accuracy: { rate: 0.584 },
    brierScore,
    expectedCalibrationError: ece,
    logLoss: 0.6812,
    predictionDistribution: {
      favoriteConfidenceAbove60Rate: 0.43,
      favoriteConfidenceAbove65Rate: 0.25,
      favoriteConfidenceAbove70Rate: 0.12,
      favoriteConfidenceAbove75Rate: 0.04,
      maximum: 0.82,
      median: 0.542,
      minimum: 0.24,
    },
  },
  parameters: {
    configuration: {
      kFactor: 1.2,
      overtimeMultiplier: 0.7,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
    homeAdvantage: 4,
    probabilityScale: 6,
    startingRatings: {
      comparableToUnifiedMultiSeason: label !== 'Current',
      center: label === 'Current' ? 46 : 46,
      label:
        label === 'Current'
          ? 'Current production ratings · Scenario only (non-comparable)'
          : 'Fixed 37–55 · Alphabetical ordering',
      mode: label === 'Current' ? 'current' : 'fixed_spread',
      orderingSource: 'current production baseRating descending',
      policy:
        label === 'Current'
          ? 'CURRENT_PRODUCTION_ORDER'
          : 'FIXED_SPREAD_ALPHABETICAL',
      spread: 18,
      startingStateSignature: 'sha256:starting-state-signature',
    },
  },
  sanityBaselines: {
    constant50: {
      brierScore: 0.25,
      logLoss: 0.69314718,
      probability: 0.5,
    },
    historicalHomeRate: {
      brierScore: 0.24,
      logLoss: 0.6721,
      probability: 0.58,
    },
  },
  seasonFailures: [],
  seasonResults: [
    {
      dataset: { gamesIncluded: 1312 },
      filters: {
        dateFrom: '2024-10-04',
        dateTo: '2025-04-17',
      },
      finalRatingSummary: { spread: 16 },
      label: '2024–25',
      metrics: {
        accuracy: { rate: 0.584 },
        brierScore,
        expectedCalibrationError: ece,
        logLoss: 0.6812,
      },
      sanityBaselines: {
        constant50: { brierScore: 0.25 },
        historicalHomeRate: { brierScore: 0.24 },
      },
      seasonId: '20242025',
    },
  ],
  stability: {
    brierRange: null,
    brierStandardDeviation: null,
    level: 'not_assessed',
    seasonsBeatingConstant50: Number(brierScore < 0.25),
    seasonsBeatingHomeRate: Number(brierScore < 0.24),
    seasonsEvaluated: 1,
    seasonsSelected: 1,
    partial: false,
  },
  teamResults: [
    {
      abbreviation: 'BOS',
      finalRating: 54,
      netChange: 1,
      startingRating: 53,
      teamId: 'BOS',
    },
    {
      abbreviation: 'TOR',
      finalRating: 38,
      netChange: -1,
      startingRating: 39,
      teamId: 'TOR',
    },
  ],
  warnings: [
    {
      code: 'LOW_SAMPLE_SIZE',
      message: 'Compare metrics cautiously.',
    },
    ...(brierScore >= 0.24
      ? [
          {
            code: 'WORSE_THAN_HOME_RATE_BASELINE',
            message:
              'This configuration does not outperform a constant home-win-rate prediction on this dataset.',
          },
        ]
      : []),
    ...(ece > 0.1
      ? [
          {
            code: 'LARGE_CALIBRATION_ERROR',
            message:
              'Large calibration error: predicted probabilities differ substantially from observed outcomes.',
          },
        ]
      : []),
  ],
})

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  RatingLab = (await vite.ssrLoadModule('/src/components/RatingLab.jsx')).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  simulationsApi = await vite.ssrLoadModule(
    '/src/services/powerRatingSimulationsApi.js',
  )
  calibrationUtils = await vite.ssrLoadModule(
    '/src/utils/baseModelCalibration.js',
  )
})

after(async () => {
  await vite?.close()
})

test('Base Model Calibration mode exposes isolation, controls and live formula reference', () => {
  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialMode: 'calibration',
    }),
  )

  assert.match(html, /Base Model Calibration/)
  assert.match(
    html,
    /Compare alternative starting-rating states and core probability\/rating-update parameters/,
  )
  assert.match(html, /Experimental/)
  assert.match(html, /Production-isolated calibration/)
  assert.match(html, /Historical season/)
  assert.match(html, /Select all/)
  assert.match(html, /Clear/)
  assert.match(html, /Ready .*1\s307 games/)
  assert.match(html, /Partial .*640\/~1\s312 games/)
  assert.match(html, /Refresh dataset/)
  assert.match(html, /Resume/)
  assert.match(html, /2 historical seasons|2023/)
  assert.match(html, /Season dates loaded from tested fallback metadata/)
  assert.match(html, /Centered fixed spread/)
  assert.match(html, /Current production \(scenario\)/)
  assert.match(html, /scenario exploration/)
  assert.match(html, /37–55/)
  assert.match(html, /Select at least two starting-rating presets/)
  assert.match(html, /Center and Total spread define only the Custom ±X preset/)
  assert.match(html, /rating differences become win probabilities/)
  assert.match(html, /Live probability reference/)
  assert.match(html, /Goalie, injury/)
  assert.match(html, /Run comparison \(2\)/)
  assert.match(
    html,
    /id="calibration-probabilityScale"[^>]*min="0\.01"[^>]*step="0\.01"[^>]*value="6\.00"/,
  )
  assert.match(
    html,
    /id="calibration-kFactor"[^>]*min="0\.01"[^>]*step="0\.01"[^>]*value="1\.20"/,
  )
  assert.match(
    html,
    /id="calibration-spread"[^>]*min="0\.01"[^>]*max="100"[^>]*step="0\.01"[^>]*value="18"/,
  )
  assert.match(
    html,
    /<details class="calibration-control-section calibration-dataset-section" open="">/,
  )
  assert.match(
    html,
    /<details class="calibration-control-section calibration-starting-section" open="">/,
  )
  assert.match(
    html,
    /<details class="calibration-control-section calibration-runs-section" open="">/,
  )
  assert.match(
    html,
    /<details class="calibration-control-section calibration-parameters-section" open="">/,
  )
  assert.match(
    html,
    /<details class="calibration-control-section calibration-method-section">/,
  )
})

test('calibration utilities enforce comparisons and construct auditable payloads', () => {
  const form = calibrationUtils.createCalibrationForm(options)
  const preset = calibrationUtils.CALIBRATION_STARTING_PRESETS[1]
  const payload = calibrationUtils.createCalibrationPayload(form, preset)

  assert.equal(
    calibrationUtils.validateCalibrationForm(form, ['current']),
    'Select at least two runs for comparison.',
  )
  assert.equal(
    calibrationUtils.validateCalibrationForm(form, ['current', '37-55']),
    '',
  )
  assert.deepEqual(form.configuration, {
    kFactor: '1.20',
    overtimeMultiplier: '0.70',
    regulationMultiplier: '1.00',
    shootoutMultiplier: '0.50',
  })
  assert.equal(form.probabilityScale, '6.00')
  assert.equal(form.homeAdvantage, '4.00')
  assert.deepEqual(payload, {
    configuration: {
      kFactor: 1.2,
      overtimeMultiplier: 0.7,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
    homeAdvantage: 4,
    label: '37–55',
    probabilityScale: 6,
    seasonIds: ['20242025'],
    startingRatings: {
      center: 46,
      mode: 'fixed_spread',
      spread: 18,
    },
    useCustomDateRange: false,
  })

  const probabilityRows = calibrationUtils.buildProbabilityReferenceRows(form)

  assert.equal(probabilityRows.length, 7)
  assert.equal(probabilityRows[0].neutralHomeProbability, 0.5)
  assert.equal(probabilityRows[0].appliedHomeProbability > 0.5, true)
})

test('Rating Lab fallback inputs use calibrated references independent of production Settings', () => {
  const form = calibrationUtils.createCalibrationForm()

  assert.deepEqual(form.configuration, {
    kFactor: '1.30',
    overtimeMultiplier: '0.40',
    regulationMultiplier: '1.00',
    shootoutMultiplier: '0.10',
  })
  assert.equal(form.homeAdvantage, '3.50')
  assert.equal(form.probabilityScale, '20.00')
  assert.deepEqual(form.startingRatings, {
    center: '46',
    mode: 'current',
    spread: '8',
  })
  assert.deepEqual(
    calibrationUtils.DEFAULT_SELECTED_CALIBRATION_PRESETS,
    ['current', '42-50'],
  )
})

test('season selection supports single, multi, select all, clear and custom-range rules', () => {
  const allSeasonIds = calibrationUtils.selectAllCalibrationSeasons(
    options.seasons,
  )
  assert.deepEqual(allSeasonIds, ['20242025', '20232024'])
  assert.deepEqual(
    calibrationUtils.toggleCalibrationSeason(['20242025'], '20232024'),
    ['20242025', '20232024'],
  )
  assert.deepEqual(
    calibrationUtils.toggleCalibrationSeason(
      ['20242025', '20232024'],
      '20242025',
    ),
    ['20232024'],
  )
  assert.deepEqual(calibrationUtils.clearCalibrationSeasons(), [])
  assert.equal(calibrationUtils.estimateCalibrationGames(allSeasonIds), 2624)

  const form = calibrationUtils.createCalibrationForm(options)
  form.seasonIds = allSeasonIds
  form.startingRatings.mode = 'fixed_spread'
  assert.equal(
    calibrationUtils.validateCalibrationForm(form, ['37-55', '40-52']),
    '',
  )
  assert.match(
    calibrationUtils.validateCalibrationForm(form, ['current', '37-55']),
    /Current production ratings cannot be used across multiple seasons/,
  )

  form.useCustomDateRange = true
  assert.match(
    calibrationUtils.validateCalibrationForm(form, ['37-55', '40-52']),
    /custom date range can only be used with one historical season/,
  )

  form.seasonIds = ['20242025']
  const customPayload = calibrationUtils.createCalibrationPayload(
    form,
    calibrationUtils.CALIBRATION_STARTING_PRESETS[1],
  )
  assert.equal(customPayload.dateFrom, '2024-10-04')
  assert.equal(customPayload.dateTo, '2025-04-17')
})

test('older single-season current starts render the historical-bias warning', () => {
  const olderOptions = {
    ...options,
    defaults: {
      ...options.defaults,
      dateFrom: '2023-10-10',
      dateTo: '2024-04-18',
      seasonId: '20232024',
    },
  }
  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: olderOptions,
      initialMode: 'calibration',
    }),
  )

  assert.match(
    html,
    /Current production ratings are an experimental, potentially biased starting source/,
  )
})

test('frontend numeric validation agrees with backend ranges without step artifacts', () => {
  const form = calibrationUtils.createCalibrationForm(options)
  const selectedRuns = ['current', '37-55']
  const probabilityScaleField = calibrationUtils.CALIBRATION_NUMBER_FIELDS.find(
    (field) => field.key === 'probabilityScale',
  )
  const kFactorField = calibrationUtils.CALIBRATION_NUMBER_FIELDS.find(
    (field) => field.key === 'kFactor',
  )

  assert.equal(probabilityScaleField.min, 0.01)
  assert.equal(probabilityScaleField.step, 0.01)
  assert.equal(kFactorField.min, 0.01)
  assert.equal(kFactorField.step, 0.01)
  assert.equal(
    calibrationUtils.CALIBRATION_NUMBER_FIELDS.every(
      (field) => field.step === 0.01,
    ),
    true,
  )

  ;['6', '6.0', '6.01', '8', '10'].forEach((probabilityScale) => {
    form.probabilityScale = probabilityScale
    assert.equal(
      calibrationUtils.validateCalibrationForm(form, selectedRuns),
      '',
      `Probability Scale ${probabilityScale} should be valid`,
    )
  })

  form.probabilityScale = '6.00'
  ;['1', '1.2', '1.20', '1.21', '1.5'].forEach((kFactor) => {
    form.configuration.kFactor = kFactor
    assert.equal(
      calibrationUtils.validateCalibrationForm(form, selectedRuns),
      '',
      `K Factor ${kFactor} should be valid`,
    )
  })

  form.configuration.kFactor = '1.20'
  form.startingRatings.mode = 'fixed_spread'
  ;['7.99', '8', '8.0', '8.00', '8.01'].forEach((spread) => {
    form.startingRatings.spread = spread
    assert.equal(
      calibrationUtils.validateCalibrationForm(form, selectedRuns),
      '',
      `Total Spread ${spread} should be valid`,
    )
  })

  form.startingRatings.spread = '8.00'
  form.homeAdvantage = '4.25'
  form.configuration.regulationMultiplier = '1'
  form.configuration.overtimeMultiplier = '0.75'
  form.configuration.shootoutMultiplier = '0.55'
  assert.equal(
    calibrationUtils.validateCalibrationForm(form, selectedRuns),
    '',
  )

  const customPayload = calibrationUtils.createCalibrationPayload(form, {
    center: Number(form.startingRatings.center),
    key: 'custom',
    label: 'Custom ±4.0',
    mode: 'fixed_spread',
    spread: Number(form.startingRatings.spread),
  })

  assert.equal(customPayload.startingRatings.spread, 8)
  assert.equal(typeof customPayload.startingRatings.spread, 'number')

  ;['0', '-0.01', ''].forEach((probabilityScale) => {
    form.probabilityScale = probabilityScale
    assert.match(
      calibrationUtils.validateCalibrationForm(form, selectedRuns),
      /Probability scale must be between 0\.01 and 50/,
    )
  })
})

test('configured decimal defaults submit numerically without modification', () => {
  const form = calibrationUtils.createCalibrationForm(options)
  const payload = calibrationUtils.createCalibrationPayload(
    form,
    calibrationUtils.CALIBRATION_STARTING_PRESETS[0],
  )

  assert.deepEqual(
    {
      homeAdvantage: payload.homeAdvantage,
      kFactor: payload.configuration.kFactor,
      overtimeMultiplier: payload.configuration.overtimeMultiplier,
      probabilityScale: payload.probabilityScale,
      regulationMultiplier: payload.configuration.regulationMultiplier,
      shootoutMultiplier: payload.configuration.shootoutMultiplier,
    },
    {
      homeAdvantage: 4,
      kFactor: 1.2,
      overtimeMultiplier: 0.7,
      probabilityScale: 6,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
  )
})

test('calibration comparison sorts by Brier and renders metrics and diagnostics', () => {
  const runs = [
    makeRun({ brierScore: 0.244, label: 'Current' }),
    makeRun({ brierScore: 0.238, label: '37–55' }),
  ]
  const ranked = calibrationUtils.sortCalibrationRuns(runs)
  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialCalibrationRuns: runs,
      initialMode: 'calibration',
    }),
  )

  assert.equal(ranked[0].label, '37–55')
  assert.equal(
    calibrationUtils.sortCalibrationRuns(runs, 'worstSeasonBrier')[0].label,
    '37–55',
  )
  assert.match(html, /Best pooled Brier/)
  assert.match(html, /Sanity baselines/)
  assert.match(html, /50% baseline/)
  assert.match(html, /Historical home-rate baseline/)
  assert.match(html, /Per-season breakdown/)
  assert.match(html, /Stability: not assessed/)
  assert.match(html, /Season Coverage/)
  assert.match(html, /1\/1 completed/)
  assert.match(html, /Best season/)
  assert.match(html, /Worst season/)
  assert.match(html, /Better than home-rate baseline/)
  assert.match(html, /Worse than home-rate baseline/)
  assert.match(html, /0\.2380/)
  assert.match(html, /1(?:,| )312/)
  assert.match(html, /Home-win calibration buckets/)
  assert.match(html, /Prediction confidence distribution/)
  assert.match(html, /Final temporary ratings/)
  assert.match(html, /MongoDB historical dataset/)
  assert.match(html, /Favorite ≥75%/)
  assert.match(html, /Mean squared error/)
  assert.match(html, /Compare metrics cautiously/)
  assert.match(
    html,
    /This configuration does not outperform a constant home-win-rate prediction/,
  )
  assert.match(html, /Center invariant/)
  assert.match(html, /Starting-state policy FIXED_SPREAD_ALPHABETICAL/)
  assert.match(html, /sha256:starting-state-signature/)
  assert.match(html, /has the lowest pooled Brier score/)
  assert.doesNotMatch(html, /\b(?:undefined|NaN|Infinity)\b/)
})

test('incomplete multi-season coverage renders safe season-specific failure details', () => {
  const run = makeRun({ brierScore: 0.238, label: '37–55' })
  run.aggregate = {
    ...run.aggregate,
    completedSeasons: 1,
    incomplete: true,
    requestedSeasons: 2,
  }
  run.coverage = {
    ...run.coverage,
    failedSeasonIds: ['20232024'],
    failedSeasons: 1,
    incomplete: true,
    requestedSeasonIds: ['20242025', '20232024'],
    selectedSeasons: 2,
    seasons: [
      ...run.coverage.seasons,
      {
        boundaries: {
          metadataSource: 'tested-explicit',
          resolvedEndDate: '2024-04-18',
          resolvedStartDate: '2023-10-10',
        },
        dataSource: 'MongoDB historical dataset',
        errorCode: 'rate_limited',
        expectedGames: { approximate: 1312, minimum: 1250 },
        gamesFound: 0,
        gamesIncluded: 0,
        gamesSkipped: 0,
        label: options.seasons[1].label,
        metrics: null,
        seasonId: '20232024',
        status: 'rate_limited',
        userMessage:
          'Historical season preparation paused because the NHL service is rate limiting requests. Saved progress will be reused when you resume.',
      },
    ],
  }
  run.stability = {
    ...run.stability,
    partial: true,
    seasonsSelected: 2,
  }
  run.displayLabel = 'Aggregate · 2 seasons · 37–55 · Scale 6'
  run.seasonFailures = [
    {
      message: 'Season data could not be loaded or calibrated.',
      seasonId: '20232024',
      seasonLabel: '2023–24',
    },
  ]
  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialCalibrationRuns: [run],
      initialMode: 'calibration',
    }),
  )

  assert.match(html, /Incomplete season coverage/)
  assert.match(html, /Partial result/)
  assert.match(html, /1\/2 completed/)
  assert.match(html, /Failed — provider rate limited/)
  assert.match(html, /Best pooled Brier \(partial\)/)
  assert.match(html, /2023–24: Season data could not be loaded or calibrated/)
  assert.doesNotMatch(html, /upstream|stack|undefined|NaN|Infinity/)
})

test('complete and partial runs are not ranked as comparable coverage', () => {
  const complete = makeRun({ brierScore: 0.24, label: 'Complete' })
  const partial = makeRun({ brierScore: 0.2, label: 'Partial' })

  partial.coverage = {
    ...partial.coverage,
    completedSeasonIds: ['20242025'],
    failedSeasonIds: ['20232024'],
    incomplete: true,
    requestedSeasonIds: ['20242025', '20232024'],
  }

  const ranking = calibrationUtils.buildCalibrationRanking([partial, complete])

  assert.deepEqual(ranking.eligibleRuns.map((run) => run.label), ['Complete'])
  assert.deepEqual(ranking.excludedRuns.map((run) => run.label), ['Partial'])
})

test('three completed seasons render complete coverage and cross-season stability', () => {
  const run = makeRun({ brierScore: 0.238, label: 'Three seasons' })
  const seasonIds = ['20252026', '20242025', '20232024']

  run.aggregate = {
    ...run.aggregate,
    completedSeasons: 3,
    requestedSeasons: 3,
  }
  run.coverage = {
    ...run.coverage,
    completedSeasonIds: seasonIds,
    requestedSeasonIds: seasonIds,
    selectedSeasons: 3,
    completedSeasons: 3,
    seasons: seasonIds.map((seasonId, index) => ({
      ...run.coverage.seasons[0],
      label: `Season ${index + 1}`,
      seasonId,
    })),
  }
  run.dataset.gamesIncluded = 3936
  run.stability = {
    ...run.stability,
    brierRange: 0.008,
    brierStandardDeviation: 0.003,
    level: 'stable',
    seasonsEvaluated: 3,
    seasonsSelected: 3,
  }

  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialCalibrationRuns: [run],
      initialMode: 'calibration',
    }),
  )

  assert.match(html, /3\/3 completed/)
  assert.match(html, /3.936/)
  assert.match(html, /Stability: stable/)
  ;['Season 1', 'Season 2', 'Season 3'].forEach((label) =>
    assert.match(html, new RegExp(label)),
  )
})

test('only the newest calibration request may replace displayed results', () => {
  assert.equal(calibrationUtils.isLatestCalibrationRequest(2, 2), true)
  assert.equal(calibrationUtils.isLatestCalibrationRequest(1, 2), false)
})

test('high ECE diagnostic warning renders without non-finite artifacts', () => {
  const html = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialCalibrationRuns: [
        makeRun({ brierScore: 0.238, ece: 0.11, label: 'High ECE' }),
      ],
      initialMode: 'calibration',
    }),
  )

  assert.match(
    html,
    /Large calibration error: predicted probabilities differ substantially from observed outcomes/,
  )
  assert.doesNotMatch(html, /\b(?:undefined|NaN|Infinity)\b/)
})

test('calibration loading and validation errors render without raw failures', () => {
  const loadingHtml = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationOptions: options,
      initialCalibrationStatus: 'loading',
      initialMode: 'calibration',
    }),
  )
  const errorHtml = renderToStaticMarkup(
    React.createElement(RatingLab, {
      initialCalibrationErrorMessage: 'Select at least two runs for comparison.',
      initialCalibrationOptions: options,
      initialCalibrationStatus: 'error',
      initialMode: 'calibration',
    }),
  )

  assert.match(loadingHtml, /Replaying selected runs/)
  assert.match(loadingHtml, /disabled/)
  assert.match(errorHtml, /Select at least two runs for comparison/)
  assert.doesNotMatch(errorHtml, /\b(?:undefined|NaN|Infinity)\b/)
})

test('calibration APIs use protected options, preparation and run endpoints', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

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
    await simulationsApi.getBaseModelCalibrationOptions()
    await simulationsApi.prepareHistoricalCalibrationSeason('20242025')
    await simulationsApi.runBaseModelCalibration({ seasonId: '20242025' })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(
    capturedRequests[0].url,
    '/api/power-rating-simulations/calibration/options',
  )
  assert.equal(capturedRequests[0].method, 'GET')
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    null,
  )
  assert.equal(
    capturedRequests[1].url,
    '/api/power-rating-simulations/calibration/historical-seasons/20242025/prepare',
  )
  assert.equal(capturedRequests[1].method, 'POST')
  assert.deepEqual(capturedRequests[1].body, { refresh: false })
  assert.equal(
    capturedRequests[2].url,
    '/api/power-rating-simulations/calibration/run',
  )
  assert.equal(capturedRequests[2].method, 'POST')
  assert.deepEqual(capturedRequests[2].body, { seasonId: '20242025' })
})
