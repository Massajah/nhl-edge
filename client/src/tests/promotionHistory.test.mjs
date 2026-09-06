import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let PromotionHistory
let RatingLab
let apiClient
let simulationsApi
let vite

const summary = {
  affectedFeatureFamilies: ['QUICK_REMATCH'],
  appliedAt: '2026-08-31T12:00:00.000Z',
  candidate: {
    candidateId: 'quick-rematch-7-0-5',
    label: 'Quick Rematch · 7 days · +0.50',
    type: 'QUICK_REMATCH',
  },
  changeCount: 2,
  promotionId: 'promotion-1',
  robustnessAvailable: true,
  runId: 'run-1',
  status: 'APPLIED',
}

const detail = {
  ...summary,
  afterConfiguration: {
    QUICK_REMATCH: {
      quickRematchEnabled: true,
      quickRematchLoserAdjustment: 0.5,
      quickRematchMaximumDays: 7,
    },
  },
  baseline: {
    identity: 'CURRENT_PRODUCTION',
    signature: 'baseline-signature',
  },
  beforeConfiguration: {
    QUICK_REMATCH: {
      quickRematchEnabled: true,
      quickRematchLoserAdjustment: 0.25,
      quickRematchMaximumDays: 5,
    },
  },
  candidate: {
    ...summary.candidate,
    configurationSignature: 'candidate-configuration-signature',
  },
  diff: [{
    family: 'QUICK_REMATCH',
    fields: [
      {
        after: true,
        before: true,
        changed: false,
        label: 'Enabled',
        path: 'quickRematchEnabled',
      },
      {
        after: 0.5,
        before: 0.25,
        changed: true,
        label: 'Previous-loser Adjustment',
        path: 'quickRematchLoserAdjustment',
      },
      {
        after: 7,
        before: 5,
        changed: true,
        label: 'Maximum Days',
        path: 'quickRematchMaximumDays',
      },
    ],
    label: 'Quick Rematch',
  }],
  identities: {
    datasetSignature: 'dataset-signature',
    gameIdSignature: 'game-id-signature',
    productionSnapshotId: 'snapshot-1',
    productionStateIdentityAfter: 'production-after',
    productionStateIdentityBefore: 'production-before',
    startingStateSignature: 'starting-signature',
  },
  modelVersion: 'rating-engine-v1',
  robustnessSummary: {
    analysisId: 'analysis-1',
    available: true,
    bootstrap: {
      deltaBrier: {
        intervalCrossesZero: true,
        lower: -0.0031,
        proportionBetter: 0.928,
        proportionEqual: 0,
        proportionWorse: 0.072,
        upper: 0.00006,
      },
    },
    method: { intervalLevel: 0.95, replicates: 2500 },
    observed: { deltaBrier: -0.0019 },
    seasonSensitivity: {
      resultSensitiveToSeasonRemoval: true,
      seasonsEqual: 0,
      seasonsImproved: 2,
      seasonsWorse: 1,
    },
  },
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  PromotionHistory = (
    await vite.ssrLoadModule('/src/components/PromotionHistory.jsx')
  ).default
  RatingLab = (
    await vite.ssrLoadModule('/src/components/RatingLab.jsx')
  ).default
  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  simulationsApi = await vite.ssrLoadModule(
    '/src/services/powerRatingSimulationsApi.js',
  )
})

after(async () => {
  await vite?.close()
})

const renderHistory = (props = {}) => renderToStaticMarkup(
  React.createElement(PromotionHistory, props),
)

test('Rating Lab navigation places Promotion History between calibration and Advanced Labs', () => {
  const replayHtml = renderToStaticMarkup(React.createElement(RatingLab))
  const historyHtml = renderToStaticMarkup(React.createElement(RatingLab, {
    initialMode: 'promotion-history',
    initialPromotionHistoryPromotions: [],
  }))
  const replayIndex = replayHtml.indexOf('Historical Replay')
  const calibrationIndex = replayHtml.indexOf('Model Calibration')
  const historyIndex = replayHtml.indexOf('Promotion History')
  const advancedIndex = replayHtml.indexOf('Advanced Labs')

  assert.ok(replayIndex >= 0)
  assert.ok(calibrationIndex > replayIndex)
  assert.ok(historyIndex > calibrationIndex)
  assert.ok(advancedIndex > historyIndex)
  assert.match(historyHtml, /Read-only audit trail/)
  assert.match(historyHtml, /No production changes have been promoted/)
})

test('Promotion History has independent loading, empty and error states', () => {
  const loading = renderHistory({ initialStatus: 'loading' })
  const empty = renderHistory({ initialPromotions: [] })
  const error = renderHistory({
    initialErrorMessage: 'Audit fixture unavailable.',
    initialStatus: 'error',
  })

  assert.match(loading, /Loading Promotion History/)
  assert.match(loading, /Reading durable audit records/)
  assert.match(empty, /No production changes have been promoted from Rating Lab yet/)
  assert.match(empty, /Successful controlled promotions will appear here/)
  assert.match(error, /Promotion History is unavailable/)
  assert.match(error, /Audit fixture unavailable/)
  assert.match(error, /Try Again/)
})

test('populated history is compact, accessible, paginated and contains no write controls', () => {
  const html = renderHistory({
    initialPagination: {
      hasMore: true,
      limit: 20,
      nextCursor: 'cursor-2',
    },
    initialPromotions: [summary],
  })

  assert.match(html, /Promotion History is an audit trail/)
  assert.match(html, /Current production settings may differ/)
  assert.match(html, /Quick Rematch · 7 days · \+0\.50/)
  assert.match(html, /2/)
  assert.match(html, /Recorded/)
  assert.match(html, /APPLIED/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /View Details/)
  assert.match(html, /Load More/)
  assert.doesNotMatch(
    html,
    />\s*(?:Apply|Reapply|Restore|Undo|Rollback|Edit|Delete)\s*</i,
  )
})

test('expanded history detail shows historical diff, robustness and technical identities', () => {
  const html = renderHistory({
    initialDetails: { [summary.promotionId]: detail },
    initialExpandedPromotionIds: [summary.promotionId],
    initialPromotions: [summary],
  })

  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /Historical production diff/)
  assert.match(html, /Previous-loser Adjustment/)
  assert.match(html, /\+0\.25/)
  assert.match(html, /\+0\.50/)
  assert.match(html, /5 days/)
  assert.match(html, /7 days/)
  assert.match(html, /Observed Δ Brier/)
  assert.match(html, /-0\.001900/)
  assert.match(html, /95% bootstrap interval/)
  assert.match(html, /92\.8%/)
  assert.match(html, /Includes zero/)
  assert.match(html, /2 improved · 0 equal · 1 worse/)
  assert.match(html, /Direction changes when a season is removed/)
  assert.match(html, /Technical details/)
  assert.match(html, /candidate-configuration-signature/)
  assert.match(html, /dataset-signature/)
  assert.match(html, /production-before/)
  assert.match(html, /production-after/)
  assert.doesNotMatch(html, /statistically significant|approved|production safe/i)
})

test('history detail treats absent robustness as descriptive missing data', () => {
  const noRobustnessSummary = {
    ...summary,
    promotionId: 'promotion-no-robustness',
    robustnessAvailable: false,
  }
  const noRobustnessDetail = {
    ...detail,
    ...noRobustnessSummary,
    robustnessSummary: null,
  }
  const html = renderHistory({
    initialDetails: {
      [noRobustnessSummary.promotionId]: noRobustnessDetail,
    },
    initialExpandedPromotionIds: [noRobustnessSummary.promotionId],
    initialPromotions: [noRobustnessSummary],
  })

  assert.match(
    html,
    /Robustness analysis was not recorded for this promotion/,
  )
  assert.doesNotMatch(html, /Promotion unavailable|error/i)
})

test('history client API uses authenticated bounded list and encoded detail routes', async () => {
  const originalFetch = globalThis.fetch
  const captured = []

  globalThis.fetch = async (url, requestOptions) => {
    captured.push({
      headers: requestOptions.headers,
      method: requestOptions.method,
      url,
    })
    return new Response(JSON.stringify({ promotions: [] }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    await simulationsApi.getModelCalibrationPromotions({
      cursor: 'cursor/value',
      limit: 20,
    })
    await simulationsApi.getModelCalibrationPromotion('promotion/id')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(captured.map(({ method, url }) => [method, url]), [
    [
      'GET',
      '/api/power-rating-simulations/model-calibration/promotions?limit=20&cursor=cursor%2Fvalue',
    ],
    [
      'GET',
      '/api/power-rating-simulations/model-calibration/promotions/promotion%2Fid',
    ],
  ])
  assert.equal(captured[0].headers.get('Authorization'), null)
  assert.equal(captured[1].headers.get('Authorization'), null)
})

test('Model Calibration exposes the concise seven-stage workflow and baseline distinction', async () => {
  const ModelCalibration = (
    await vite.ssrLoadModule('/src/components/ModelCalibration.jsx')
  ).default
  const html = renderToStaticMarkup(React.createElement(ModelCalibration, {
    initialOptions: {
      baselineModes: [],
      candidateDefinitions: {
        quickRematch: { adjustmentOptions: [], windowOptions: [] },
        restFatigue: { rules: [] },
        specialTeams: { adjustmentOptions: [], thresholdOptions: [] },
        teamHomeAdvantage: { adjustmentOptions: [] },
      },
      defaultBaselineMode: '',
      defaultSeasonIds: [],
      seasons: [],
      startingState: { description: '', label: '' },
    },
  }))

  for (const label of [
    'Configure Calibration',
    'Run Calibration',
    'Review Results',
    'Shortlist Candidates',
    'Compare Shortlist',
    'Run Robustness Analysis',
    'Review for Production',
  ]) assert.match(html, new RegExp(label))
  assert.match(
    html,
    /Current Production and the Canonical Base Model are distinct baselines/,
  )
})
