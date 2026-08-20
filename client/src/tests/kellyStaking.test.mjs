import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let ResultCard
let calculateGameUtils
let kellyStaking
let savedAnalyses
let vite

const assertApprox = (actual, expected, tolerance = 0.000001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

const homeTeam = {
  abbreviation: 'BOS',
  id: 'BOS',
  name: 'Boston Bruins',
}
const awayTeam = {
  abbreviation: 'TOR',
  id: 'TOR',
  name: 'Toronto Maple Leafs',
}

const baseInputs = {
  away: {
    baseRating: 50,
    goalieAdjustment: 0,
    homeAdvantage: 0,
    injuries: 0,
    manualAdjustment: 0,
    marketOdds: '',
    motivation: 0,
    restFatigue: 0,
    selectedGoalieId: '',
    selectedGoalieName: '',
    storedInjuryImpact: 0,
  },
  home: {
    baseRating: 52,
    goalieAdjustment: 0,
    homeAdvantage: 0,
    injuries: 0,
    manualAdjustment: 0,
    marketOdds: 2.1,
    motivation: 0,
    restFatigue: 0,
    selectedGoalieId: '',
    selectedGoalieName: '',
    storedInjuryImpact: 0,
  },
}

const renderResultCard = (props = {}) => {
  const result =
    props.result ?? calculateGameUtils.calculateGame(baseInputs.home, baseInputs.away)

  return renderToStaticMarkup(
    React.createElement(ResultCard, {
      awayTeam,
      bankrollStatus: 'success',
      bettingSettingsStatus: 'success',
      homeTeam,
      inputs: baseInputs,
      isBetReviewOpen: true,
      result,
      reviewDisabled: false,
      saveDisabled: false,
      saveStatus: 'idle',
      selectedSide: 'home',
      stake: '1',
      validSaveSides: [
        {
          market: {
            marketOdds: 2.1,
          },
          side: 'home',
          team: homeTeam,
        },
      ],
      ...props,
    }),
  )
}

const baseBankrollSummary = {
  availableBankroll: 1000,
  currency: 'EUR',
  currentBankroll: 1000,
  initialized: true,
}

const baseBettingSettings = {
  bankrollBasis: 'AVAILABLE',
  customKellyFraction: 0.25,
  kellyMode: 'QUARTER',
  maximumStakePercent: 3,
  minimumEdgePercent: 2,
  stakeRoundingIncrement: 0.5,
}

const createStakeRecommendation = (overrides = {}) =>
  kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: overrides.bankrollSummary ?? baseBankrollSummary,
    decimalOdds: overrides.decimalOdds ?? 2.1,
    modelProbability: overrides.modelProbability ?? 0.55,
    settings: overrides.settings ?? baseBettingSettings,
  })

const createAnalyzerScenario = ({
  edgePercentagePoints,
  modelProbability = 0.401,
}) => {
  const decimalOdds = 1 / (modelProbability - edgePercentagePoints / 100)
  const comparison = calculateGameUtils.calculateMarketComparison({
    marketOdds: decimalOdds,
    modelProbability,
  })
  const stakeRecommendation = createStakeRecommendation({
    decimalOdds,
    modelProbability,
  })
  const inputs = {
    away: { ...baseInputs.away, marketOdds: '' },
    home: { ...baseInputs.home, marketOdds: decimalOdds },
  }
  const result = {
    ...calculateGameUtils.calculateGame(inputs.home, inputs.away),
    homeEdge: comparison.probabilityEdge,
    homeExpectedValue: comparison.expectedValue,
    homeFairOdds: comparison.fairOdds,
    homeImpliedProbability: comparison.impliedProbability,
    homeModelStatus: comparison.modelStatus,
    homeOddsDifference: comparison.oddsDifference,
    homeRecommendation: comparison.recommendation,
    homeWinProbability: modelProbability,
  }

  return {
    comparison,
    decimalOdds,
    html: renderResultCard({
      inputs,
      result,
      stake: '5',
      stakeRecommendation,
      stakeRecommendations: { home: stakeRecommendation },
    }),
    inputs,
    result,
    stakeRecommendation,
  }
}

const currencyPattern = (amountText) =>
  new RegExp(`${amountText}(?:&nbsp;|\\s)*(?:\\u20ac|EUR)`)

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  ResultCard = (await vite.ssrLoadModule('/src/components/ResultCard.jsx'))
    .default
  calculateGameUtils = await vite.ssrLoadModule('/src/utils/calculateGame.js')
  kellyStaking = await vite.ssrLoadModule('/src/utils/kellyStaking.js')
  savedAnalyses = await vite.ssrLoadModule('/src/utils/savedAnalyses.js')
})

after(async () => {
  await vite?.close()
})

test('Kelly formula returns positive value recommendation details', () => {
  const result = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    maximumStakePercent: 3,
    minimumEdgePercent: 2,
    modelProbability: 0.55,
    roundingIncrement: 0.5,
  })

  assert.equal(result.eligible, true)
  assert.equal(result.reason, null)
  assertApprox(result.impliedProbability, 0.4761904762)
  assertApprox(result.edgeDecimal, 0.0738095238)
  assertApprox(result.edgePercentagePoints, 7.380952381)
  assertApprox(result.fullKellyFraction, 0.1409090909)
  assertApprox(result.fullKellyPercent, 14.09090909)
  assertApprox(result.fractionalKellyFraction, 0.0352272727)
  assertApprox(result.fractionalKellyPercent, 3.522727273)
  assert.equal(result.cappedStakePercent, 3)
  assert.equal(result.capApplied, true)
  assert.equal(result.unroundedStakeAmount, 30)
  assert.equal(result.recommendedStakeAmount, 30)
})

test('Kelly reasons cover no edge, exact zero edge, below minimum and negative Kelly', () => {
  const reasons = kellyStaking.KELLY_RECOMMENDATION_REASONS

  assert.equal(
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction: 1,
      modelProbability: 0.45,
    }).reason,
    reasons.NO_POSITIVE_EDGE,
  )
  assert.equal(
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction: 1,
      modelProbability: 0.5,
    }).reason,
    reasons.NO_POSITIVE_EDGE,
  )
  assert.equal(
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction: 1,
      minimumEdgePercent: 2,
      modelProbability: 0.51,
    }).reason,
    reasons.BELOW_MINIMUM_EDGE,
  )
  assert.equal(
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction: 0,
      minimumEdgePercent: 0,
      modelProbability: 0.55,
    }).reason,
    reasons.NON_POSITIVE_KELLY,
  )
})

test('Analyzer recommendation states distinguish below-threshold value, candidates, and no value', () => {
  const states = kellyStaking.ANALYZER_RECOMMENDATION_STATES
  const belowThreshold = createAnalyzerScenario({
    edgePercentagePoints: 1.96,
  })
  const candidate = createAnalyzerScenario({ edgePercentagePoints: 2.9 })
  const noValue = createAnalyzerScenario({ edgePercentagePoints: -1 })

  assert.ok(belowThreshold.comparison.expectedValue > 0)
  assert.equal(belowThreshold.stakeRecommendation.reason, 'BELOW_MINIMUM_EDGE')
  assert.equal(
    kellyStaking.getAnalyzerRecommendationState({
      expectedValue: belowThreshold.comparison.expectedValue,
      recommendation: belowThreshold.stakeRecommendation,
    }),
    states.POSITIVE_VALUE_BELOW_THRESHOLD,
  )
  assert.match(
    belowThreshold.html,
    /market-side positive-value-below-threshold/,
  )
  assert.match(
    belowThreshold.html,
    /market-side positive-value-below-threshold[\s\S]*?recommendation-badge positive-value-below-threshold">Positive Value · Below Threshold/,
  )
  assert.match(
    belowThreshold.html,
    /stake-recommendation-panel positive-value-below-threshold[\s\S]*?recommendation-badge positive-value-below-threshold">Below Threshold/,
  )
  assert.match(
    belowThreshold.html,
    /Edge \+1\.96 pp is below your \+2\.00 pp minimum\. No stake recommended\./,
  )
  assert.match(belowThreshold.html, /No stake recommended/)
  assert.match(belowThreshold.html, /Below 2\.00 pp betting threshold/)
  assert.match(
    belowThreshold.html,
    /NHL Edge does not recommend a stake under the current betting rules/,
  )
  assert.match(
    belowThreshold.html,
    /id="stake-recommendation-your-stake"[^>]+value="5"/,
  )

  assert.equal(candidate.stakeRecommendation.eligible, true)
  assert.equal(
    kellyStaking.getAnalyzerRecommendationState({
      expectedValue: candidate.comparison.expectedValue,
      recommendation: candidate.stakeRecommendation,
    }),
    states.BET_CANDIDATE,
  )
  assert.match(candidate.html, /market-side bet-candidate/)
  assert.match(candidate.html, /Bet Candidate/)
  assert.match(candidate.html, /Kelly stake recommended/)

  assert.ok(noValue.comparison.expectedValue <= 0)
  assert.equal(
    kellyStaking.getAnalyzerRecommendationState({
      expectedValue: noValue.comparison.expectedValue,
      recommendation: noValue.stakeRecommendation,
    }),
    states.NO_VALUE,
  )
  assert.match(noValue.html, /market-side no-value/)
  assert.match(noValue.html, /No Value/)
  assert.doesNotMatch(noValue.html, /Bet Candidate/)
})

test('exact minimum edge passes while displayed rounding never drives eligibility', () => {
  const states = kellyStaking.ANALYZER_RECOMMENDATION_STATES
  const exactThreshold = createAnalyzerScenario({ edgePercentagePoints: 2 })
  const roundedUpBelowThreshold = createAnalyzerScenario({
    edgePercentagePoints: 1.996,
  })

  assert.equal(exactThreshold.stakeRecommendation.eligible, true)
  assert.equal(
    kellyStaking.getAnalyzerRecommendationState({
      expectedValue: exactThreshold.comparison.expectedValue,
      recommendation: exactThreshold.stakeRecommendation,
    }),
    states.BET_CANDIDATE,
  )
  assert.equal(
    roundedUpBelowThreshold.stakeRecommendation.reason,
    'BELOW_MINIMUM_EDGE',
  )
  assert.match(roundedUpBelowThreshold.html, /Edge <strong>\+2\.00 pp/)
  assert.match(
    roundedUpBelowThreshold.html,
    /Positive Value · Below Threshold/,
  )
})

test('Full, Half, Quarter and Custom Kelly fractions are applied', () => {
  const fractions = [
    [1, 10],
    [0.5, 5],
    [0.25, 2.5],
    [0.15, 1.5],
  ]

  fractions.forEach(([kellyFraction, expectedPercent]) => {
    const result = kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction,
      maximumStakePercent: 100,
      minimumEdgePercent: 0,
      modelProbability: 0.55,
      roundingIncrement: 0.01,
    })

    assertApprox(result.fractionalKellyPercent, expectedPercent)
  })
})

test('maximum stake cap can apply or stay inactive', () => {
  const capped = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    maximumStakePercent: 3,
    minimumEdgePercent: 2,
    modelProbability: 0.55,
    roundingIncrement: 0.5,
  })
  const uncapped = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2,
    kellyFraction: 0.25,
    maximumStakePercent: 3,
    minimumEdgePercent: 0,
    modelProbability: 0.55,
    roundingIncrement: 0.5,
  })

  assert.equal(capped.capApplied, true)
  assert.equal(capped.cappedStakePercent, 3)
  assert.equal(uncapped.capApplied, false)
  assert.equal(uncapped.cappedStakePercent, 2.5)
})

test('bankroll basis uses current or available amount', () => {
  const summary = {
    availableBankroll: 800,
    currency: 'EUR',
    currentBankroll: 1000,
    initialized: true,
  }
  const current = kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: summary,
    decimalOdds: 2.1,
    modelProbability: 0.55,
    settings: {
      bankrollBasis: 'CURRENT',
      customKellyFraction: 0.25,
      kellyMode: 'QUARTER',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    },
  })
  const available = kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: summary,
    decimalOdds: 2.1,
    modelProbability: 0.55,
    settings: {
      ...current.bettingSettingsSnapshot,
      bankrollBasis: 'AVAILABLE',
    },
  })

  assert.equal(current.bankrollAmount, 1000)
  assert.equal(current.recommendedStakeAmount, 30)
  assert.equal(available.bankrollAmount, 800)
  assert.equal(available.recommendedStakeAmount, 24)
})

test('zero and uninitialized bankroll states do not fabricate an amount', () => {
  const reasons = kellyStaking.KELLY_RECOMMENDATION_REASONS
  const zeroBankroll = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 0,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    modelProbability: 0.55,
  })
  const noBankroll = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 0,
    bankrollInitialized: false,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    modelProbability: 0.55,
  })

  assert.equal(zeroBankroll.reason, reasons.NO_AVAILABLE_BANKROLL)
  assert.equal(zeroBankroll.recommendedStakeAmount, 0)
  assert.equal(noBankroll.reason, reasons.BANKROLL_NOT_INITIALIZED)
  assert.equal(noBankroll.hasStakePercent, true)
  assert.equal(noBankroll.recommendedStakeAmount, 0)
})

test('invalid odds and probabilities are rejected', () => {
  const reasons = kellyStaking.KELLY_RECOMMENDATION_REASONS
  const invalidOdds = [1, 0.99, Number.NaN]
  const invalidProbabilities = [-0.1, 1.1, Number.NaN]

  invalidOdds.forEach((decimalOdds) => {
    assert.equal(
      kellyStaking.calculateKellyStakeRecommendation({
        decimalOdds,
        modelProbability: 0.55,
      }).reason,
      reasons.INVALID_ODDS,
    )
  })
  invalidProbabilities.forEach((modelProbability) => {
    assert.equal(
      kellyStaking.calculateKellyStakeRecommendation({
        decimalOdds: 2,
        modelProbability,
      }).reason,
      reasons.INVALID_PROBABILITY,
    )
  })
})

test('stake rounding always rounds down to the nearest increment', () => {
  assert.equal(kellyStaking.roundStakeAmountDown(10.49, 0.5), 10)
  assert.equal(kellyStaking.roundStakeAmountDown(10.5, 0.5), 10.5)
  assert.equal(kellyStaking.roundStakeAmountDown(10.99, 1), 10)
})

test('recommendations never exceed bankroll or configured maximum stake', () => {
  const result = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 10,
    decimalOdds: 100,
    kellyFraction: 1,
    maximumStakePercent: 100,
    minimumEdgePercent: 0,
    modelProbability: 0.99,
    roundingIncrement: 0.01,
  })
  const capped = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2.1,
    kellyFraction: 1,
    maximumStakePercent: 3,
    minimumEdgePercent: 0,
    modelProbability: 0.55,
    roundingIncrement: 0.01,
  })
  const negativeKelly = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 1.5,
    kellyFraction: 1,
    maximumStakePercent: 100,
    minimumEdgePercent: 0,
    modelProbability: 0.4,
    roundingIncrement: 0.01,
  })

  assert.ok(result.recommendedStakeAmount <= result.bankrollAmount)
  assert.ok(capped.cappedStakePercent <= capped.maximumStakePercent)
  assert.equal(negativeKelly.recommendedStakeAmount, 0)
})

test('formatting avoids floating point artifacts and maps custom mode labels', () => {
  const formatted = kellyStaking.formatKellyCurrency(0.1 + 0.2, 'EUR')

  assert.doesNotMatch(formatted, /0\.300000/)
  assert.match(formatted, /\u20ac|EUR/)
  assert.equal(
    kellyStaking.getKellyModeRecommendationLabel({
      bankrollBasis: 'AVAILABLE',
      customKellyFraction: 0.15,
      kellyMode: 'CUSTOM',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    }),
    'Custom Kelly - 0.15x Full Kelly',
  )
})

test('reason messages explain below-minimum edge and no-bankroll states', () => {
  const belowMinimum = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2,
    kellyFraction: 1,
    minimumEdgePercent: 2,
    modelProbability: 0.514,
  })
  const noBankroll = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 0,
    bankrollInitialized: false,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    modelProbability: 0.55,
  })

  assert.match(
    kellyStaking.getKellyRecommendationReasonMessage(belowMinimum),
    /below your \+2\.00 pp minimum/,
  )
  assert.match(
    kellyStaking.getKellyRecommendationReasonMessage(noBankroll),
    /calculate a currency amount/,
  )
})

test('recommendation updates when selected odds change', () => {
  const shortOdds = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2,
    kellyFraction: 0.25,
    maximumStakePercent: 3,
    minimumEdgePercent: 0,
    modelProbability: 0.55,
    roundingIncrement: 0.5,
  })
  const longerOdds = kellyStaking.calculateKellyStakeRecommendation({
    bankrollAmount: 1000,
    decimalOdds: 2.1,
    kellyFraction: 0.25,
    maximumStakePercent: 3,
    minimumEdgePercent: 0,
    modelProbability: 0.55,
    roundingIncrement: 0.5,
  })

  assert.equal(shortOdds.recommendedStakeAmount, 25)
  assert.equal(longerOdds.recommendedStakeAmount, 30)
})

test('ResultCard renders recommendation actions without overwriting actual stake', () => {
  const stakeRecommendation = createStakeRecommendation()
  const html = renderResultCard({
    stake: '1',
    stakeRecommendation,
  })

  assert.match(html, /Stake Recommendation/)
  assert.match(html, /Recommended stake/)
  assert.match(html, /Your Stake/)
  assert.match(html, /Use Recommended Stake/)
  assert.match(html, /Edit Betting Settings/)
  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value="1"/)
  assert.match(html, /id="save-bet-stake"[^>]+value="1"/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('market odds update the same compact cards without mounting duplicate result sections', () => {
  const noOddsInputs = {
    away: { ...baseInputs.away, marketOdds: '' },
    home: { ...baseInputs.home, marketOdds: '' },
  }
  const noOddsResult = calculateGameUtils.calculateGame(
    noOddsInputs.home,
    noOddsInputs.away,
  )
  const beforeHtml = renderResultCard({
    inputs: noOddsInputs,
    isBetReviewOpen: false,
    result: noOddsResult,
  })
  const afterHtml = renderResultCard({ isBetReviewOpen: false })

  for (const html of [beforeHtml, afterHtml]) {
    assert.equal((html.match(/class="market-side /g) ?? []).length, 2)
    assert.equal((html.match(/class="market-outcome-row /g) ?? []).length, 2)
    assert.equal((html.match(/stake-recommendation-panel/g) ?? []).length, 1)
    assert.match(html, /id="projection-away-marketOdds"/)
    assert.match(html, /id="projection-home-marketOdds"/)
    assert.match(html, /id="stake-recommendation-your-stake"/)
    assert.doesNotMatch(html, /market-value-grid/)
  }

  assert.match(beforeHtml, /Enter market odds to calculate value/)
  assert.match(
    afterHtml,
    /data-testid="home-market-outcome"[\s\S]*?Edge[\s\S]*?EV/,
  )
})

test('positive and no-value odds use the same compact market outcome row', () => {
  const noValueInputs = {
    away: { ...baseInputs.away, marketOdds: '' },
    home: { ...baseInputs.home, marketOdds: 1.5 },
  }
  const noValueHtml = renderResultCard({
    inputs: noValueInputs,
    isBetReviewOpen: false,
    result: calculateGameUtils.calculateGame(
      noValueInputs.home,
      noValueInputs.away,
    ),
  })
  const positiveHtml = renderResultCard({ isBetReviewOpen: false })

  assert.match(
    noValueHtml,
    /class="market-outcome-row no-value"[\s\S]*?Edge[\s\S]*?EV/,
  )
  assert.match(
    positiveHtml,
    /class="market-outcome-row positive-value"[\s\S]*?Edge[\s\S]*?EV/,
  )
  assert.equal((noValueHtml.match(/market-outcome-row/g) ?? []).length, 2)
  assert.equal((positiveHtml.match(/market-outcome-row/g) ?? []).length, 2)
})

test('Kelly diagnostics and analysis snapshot are collapsed behind accessible controls', () => {
  const html = renderResultCard({
    notes: 'Confirm the starter.',
    stake: '10',
    stakeRecommendation: createStakeRecommendation(),
  })
  const reviewPanel = html.match(
    /<section class="save-bet-panel"[\s\S]*?<\/section><\/article>$/,
  )?.[0] ?? ''
  const visibleReview = reviewPanel.split('<div class="analysis-snapshot">')[0]

  assert.match(
    html,
    /aria-expanded="false"[^>]*>View betting details<\/button>/,
  )
  assert.match(
    html,
    /class="betting-details-panel" hidden=""[\s\S]*?Full Kelly[\s\S]*?Maximum Stake Applied/,
  )
  assert.match(reviewPanel, /Boston Bruins ML @ 2\.10/)
  assert.match(reviewPanel, /<span>Edge<\/span>[\s\S]*?<span>EV<\/span>/)
  assert.match(reviewPanel, /id="save-bet-stake"[^>]+value="10"/)
  assert.match(reviewPanel, /id="save-bet-notes"[^>]*>Confirm the starter\./)
  assert.match(
    reviewPanel,
    /aria-expanded="false"[^>]*>View analysis snapshot<\/button>/,
  )
  assert.match(
    reviewPanel,
    /class="analysis-snapshot-panel" hidden=""[\s\S]*?Configured maximum[\s\S]*?Adjustments/,
  )
  assert.doesNotMatch(
    visibleReview,
    /Fair odds|Model probability|Kelly recommendation|Configured maximum|Adjustments/,
  )
  assert.match(
    reviewPanel,
    /<button class="secondary-save-button"[^>]*>Cancel<\/button><button class="save-analysis-button"[^>]*>Save Bet<\/button>/,
  )
})

test('ResultCard shows no-bankroll action and no fabricated zero amount', () => {
  const stakeRecommendation = createStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
    },
  })
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '5',
    stakeRecommendation,
  })

  assert.match(html, /Bankroll required/)
  assert.match(html, /Bankroll required/)
  assert.match(html, /Set Up Bankroll/)
  assert.match(html, /Fractional Kelly/)
  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value="5"/)
  assert.match(html, /Use Recommended Stake/)
  assert.match(html, /<button[^>]+disabled=""[^>]*>Use Recommended Stake/)
  assert.doesNotMatch(html, /0\.00/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('eligible Kelly recommendation shows actionable percent and currency amount', () => {
  const stakeRecommendation = createStakeRecommendation()
  const presentation =
    kellyStaking.getKellyRecommendationPresentation(stakeRecommendation)
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '',
    stakeRecommendation,
  })

  assert.equal(presentation.statusLabel, 'Bet Candidate')
  assert.equal(presentation.canUseRecommendedStake, true)
  assert.equal(presentation.recommendedPercentText, '3.00 %')
  assert.match(presentation.recommendedAmountText, /30,00|\u20ac|EUR/)
  assert.match(html, /Kelly stake recommended/)
  assert.match(html, /Recommended Stake %/)
  assert.match(html, /3\.00 %/)
  assert.match(html, currencyPattern('30,00'))
  assert.doesNotMatch(
    html,
    /id="stake-recommendation-your-stake"[^>]+value="30"/,
  )
})

test('Your Stake layout uses shrinkable container rules for narrow sidebars', () => {
  const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(
    css,
    /\.stake-summary-grid\s*{[^}]+grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/s,
  )
  assert.match(css, /\.stake-summary-grid\s*{[^}]+min-width:\s*0/s)
  assert.match(css, /\.actual-stake-card\s*{[^}]+min-width:\s*0/s)
  assert.match(css, /\.stake-input-row\s*{[^}]+grid-template-columns:\s*minmax\(0, 1fr\) auto/s)
  assert.match(css, /\.stake-input-row\s*{[^}]+width:\s*100%/s)
  assert.match(css, /\.stake-input-row\s*{[^}]+max-width:\s*100%/s)
  assert.match(
    css,
    /\.stake-input-row input,\s*\.stake-field input\s*{[^}]+max-width:\s*100%/s,
  )
  assert.doesNotMatch(css, /\.stake-input-row\s*{[^}]+position:\s*absolute/s)
  assert.doesNotMatch(css, /\.currency-label\s*{[^}]+position:\s*absolute/s)
})

test('warning is outside the Your Stake card and spans the summary grid', () => {
  const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8')
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '40',
    stakeRecommendation: createStakeRecommendation(),
  })

  assert.match(html, /<div class="stake-summary-grid">/)
  assert.match(html, /<section class="recommended-amount-card">/)
  assert.match(html, /<section class="actual-stake-card[^"]*"/)
  assert.match(
    html,
    /<section class="actual-stake-card[^"]*"[\s\S]*?<\/section><div class="manual-stake-warning/,
  )
  assert.doesNotMatch(
    html.match(/<section class="actual-stake-card[^"]*"[\s\S]*?<\/section>/)?.[0] ?? '',
    /manual-stake-warning/,
  )
  assert.match(css, /\.manual-stake-warning\s*{[^}]+grid-column:\s*1 \/ -1/s)
})

test('Maximum Stake Applied is always rendered with user-friendly Yes and No values', () => {
  const cappedRecommendation = createStakeRecommendation()
  const uncappedRecommendation = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.55,
  })
  const cappedHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '',
    stakeRecommendation: cappedRecommendation,
  })
  const uncappedHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '',
    stakeRecommendation: uncappedRecommendation,
  })

  assert.equal(cappedRecommendation.capApplied, true)
  assert.equal(uncappedRecommendation.capApplied, false)
  assert.match(cappedHtml, /Maximum Stake Applied/)
  assert.match(cappedHtml, /Maximum Stake Applied<\/span><strong>Yes<\/strong>/)
  assert.match(uncappedHtml, /Maximum Stake Applied/)
  assert.match(uncappedHtml, /Maximum Stake Applied<\/span><strong>No<\/strong>/)
  assert.match(cappedHtml, /amount was limited by Maximum Stake/)
  assert.doesNotMatch(cappedHtml, /Cap Applied/)
  assert.doesNotMatch(uncappedHtml, /Cap Applied/)
})

test('maximum stake comparison covers equality, one-cent breach and unavailable bankroll', () => {
  const stakeRecommendation = createStakeRecommendation()
  const below = kellyStaking.getMaximumStakeComparison({
    actualStakeAmount: 29.99,
    recommendation: stakeRecommendation,
  })
  const equal = kellyStaking.getMaximumStakeComparison({
    actualStakeAmount: 30,
    recommendation: stakeRecommendation,
  })
  const above = kellyStaking.getMaximumStakeComparison({
    actualStakeAmount: 30.01,
    recommendation: stakeRecommendation,
  })
  const unavailable = kellyStaking.getMaximumStakeComparison({
    actualStakeAmount: 40,
    recommendation: createStakeRecommendation({
      bankrollSummary: {
        availableBankroll: 0,
        currency: 'EUR',
        currentBankroll: 0,
        initialized: false,
      },
    }),
  })

  assert.equal(below.maximumStakeAmount, 30)
  assert.equal(below.exceedsMaximumStake, false)
  assert.equal(equal.exceedsMaximumStake, false)
  assert.equal(above.exceedsMaximumStake, true)
  assert.equal(unavailable.maximumStakeAmount, null)
  assert.equal(unavailable.exceedsMaximumStake, false)
  const comparisons = [below, equal, above, unavailable]

  comparisons.forEach((comparison) => {
    assert.doesNotMatch(JSON.stringify(comparison), /NaN|Infinity|undefined/)
  })
})

test('manual stake maximum warning appears only above configured maximum', () => {
  const stakeRecommendation = createStakeRecommendation()
  const belowHtml = renderResultCard({
    isBetReviewOpen: false,
    reviewDisabled: false,
    stake: '29.99',
    stakeRecommendation,
  })
  const equalHtml = renderResultCard({
    isBetReviewOpen: false,
    reviewDisabled: false,
    stake: '30',
    stakeRecommendation,
  })
  const aboveHtml = renderResultCard({
    isBetReviewOpen: false,
    reviewDisabled: false,
    saveDisabled: false,
    stake: '40',
    stakeRecommendation,
  })

  assert.doesNotMatch(belowHtml, /Your stake exceeds your configured Maximum Stake/)
  assert.doesNotMatch(equalHtml, /Your stake exceeds your configured Maximum Stake/)
  assert.match(aboveHtml, /Your stake exceeds your configured Maximum Stake/)
  assert.match(aboveHtml, /Maximum based on available bankroll/)
  assert.match(aboveHtml, currencyPattern('30,00'))
  assert.match(aboveHtml, currencyPattern('40,00'))
  assert.match(
    aboveHtml,
    /aria-describedby="stake-recommendation-your-stake-help stake-recommendation-currency stake-recommendation-maximum-warning"/,
  )
  assert.doesNotMatch(
    aboveHtml,
    /<button[^>]+disabled=""[^>]*>Review &amp; Save Bet/,
  )
})

test('manual maximum warning is hidden for empty and invalid stake input', () => {
  const stakeRecommendation = createStakeRecommendation()
  const emptyHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '',
    stakeRecommendation,
  })
  const invalidHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '-1',
    stakeRecommendation,
  })

  assert.doesNotMatch(
    emptyHtml,
    /Your stake exceeds your configured Maximum Stake/,
  )
  assert.doesNotMatch(
    invalidHtml,
    /Your stake exceeds your configured Maximum Stake/,
  )
  assert.match(invalidHtml, /Enter a stake greater than 0 with up to two decimals/)
})

test('manual warning is independent from whether recommendation was capped', () => {
  const uncappedRecommendation = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.55,
  })
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '40',
    stakeRecommendation: uncappedRecommendation,
  })

  assert.equal(uncappedRecommendation.capApplied, false)
  assert.match(html, /Maximum Stake Applied<\/span><strong>No<\/strong>/)
  assert.match(html, /Your stake exceeds your configured Maximum Stake/)
})

test('Review shows configured maximum and mirrors manual over-maximum warning', () => {
  const stakeRecommendation = createStakeRecommendation()
  const aboveHtml = renderResultCard({
    saveDisabled: false,
    stake: '40',
    stakeRecommendation,
  })
  const reducedHtml = renderResultCard({
    saveDisabled: false,
    stake: '30',
    stakeRecommendation,
  })

  assert.match(aboveHtml, /Configured maximum/)
  assert.match(aboveHtml, /Manual stake exceeds your configured Maximum Stake/)
  assert.match(
    aboveHtml,
    /aria-describedby="save-bet-stake-help save-bet-stake-currency save-bet-maximum-warning"/,
  )
  assert.match(aboveHtml, /<button class="save-analysis-button" type="button">Save Bet/)
  assert.doesNotMatch(reducedHtml, /save-bet-maximum-warning/)
  assert.doesNotMatch(
    reducedHtml,
    /Your stake exceeds your configured Maximum Stake/,
  )
})

test('Use Recommended Stake remains based on capped Kelly recommendation', () => {
  const stakeRecommendation = createStakeRecommendation()
  const snapshot =
    kellyStaking.createKellyRecommendationSnapshot(stakeRecommendation)

  assert.equal(stakeRecommendation.capApplied, true)
  assert.equal(stakeRecommendation.fractionalKellyPercent > 3, true)
  assert.equal(stakeRecommendation.cappedStakePercent, 3)
  assert.equal(stakeRecommendation.recommendedStakeAmount, 30)
  assert.equal(snapshot.recommendedStakePercent, 3)
  assert.equal(snapshot.recommendedStakeAmount, 30)
})

test('bankroll unavailable avoids fabricated maximum stake amount', () => {
  const stakeRecommendation = createStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
    },
  })
  const html = renderResultCard({
    stake: '40',
    stakeRecommendation,
  })

  assert.match(html, /Configured maximum/)
  assert.match(html, /Not available/)
  assert.doesNotMatch(html, /Maximum based on available bankroll/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('below minimum edge shows no Kelly stake while preserving Fractional Kelly and manual stake', () => {
  const stakeRecommendation = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.514,
  })
  const html = renderResultCard({
    stake: '5',
    stakeRecommendation,
  })
  const presentation =
    kellyStaking.getKellyRecommendationPresentation(stakeRecommendation)

  assert.equal(stakeRecommendation.reason, 'BELOW_MINIMUM_EDGE')
  assert.equal(presentation.statusLabel, 'Positive Value · Below Threshold')
  assert.equal(presentation.recommendedPercentText, 'No Kelly recommendation')
  assert.equal(presentation.recommendedAmountText, 'No stake recommended')
  assert.match(html, /Positive Value · Below Threshold/)
  assert.match(
    html,
    /Edge \+1\.40 pp is below your \+2\.00 pp minimum\. No stake recommended\./,
  )
  assert.match(html, /Fractional Kelly/)
  assert.match(html, /0\.70 %/)
  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value="5"/)
  assert.match(html, /id="save-bet-stake"[^>]+value="5"/)
  assert.match(html, /<button[^>]+disabled=""[^>]*>Use Recommended Stake/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('no positive edge and bankroll-not-initialized states allow manual stake entry', () => {
  const noPositiveEdge = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.45,
  })
  const bankrollMissing = createStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
    },
  })
  const noEdgeHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '6.25',
    stakeRecommendation: noPositiveEdge,
  })
  const noBankrollHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '7.50',
    stakeRecommendation: bankrollMissing,
  })

  assert.match(noEdgeHtml, /No stake recommended/)
  assert.match(noEdgeHtml, /does not show a positive edge/)
  assert.match(
    noEdgeHtml,
    /id="stake-recommendation-your-stake"[^>]+value="6.25"/,
  )
  assert.match(noBankrollHtml, /Bankroll required/)
  assert.match(noBankrollHtml, /Set up your bankroll in Bet Tracker/)
  assert.match(noBankrollHtml, /Fractional Kelly/)
  assert.match(
    noBankrollHtml,
    /id="stake-recommendation-your-stake"[^>]+value="7.50"/,
  )
  assert.doesNotMatch(`${noEdgeHtml}${noBankrollHtml}`, /NaN|Infinity|undefined/)
})

test('Use Recommended Stake availability never clears an existing manual stake', () => {
  const eligible = createStakeRecommendation()
  const belowMinimum = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.514,
  })
  const eligibleHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '11',
    stakeRecommendation: eligible,
  })
  const ineligibleHtml = renderResultCard({
    isBetReviewOpen: false,
    stake: '11',
    stakeRecommendation: belowMinimum,
  })

  assert.doesNotMatch(
    eligibleHtml,
    /<button[^>]+disabled=""[^>]*>Use Recommended Stake/,
  )
  assert.match(
    ineligibleHtml,
    /<button[^>]+disabled=""[^>]*>Use Recommended Stake/,
  )
  assert.match(
    ineligibleHtml,
    /id="stake-recommendation-your-stake"[^>]+value="11"/,
  )
})

test('main Analyzer stake carries into Review and remains editable', () => {
  const stakeRecommendation = createStakeRecommendation()
  const html = renderResultCard({
    notes: 'Wait for goalie confirmation.',
    stake: '10',
    stakeRecommendation,
  })

  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value="10"/)
  assert.match(html, /id="save-bet-stake"[^>]+value="10"/)
  assert.match(html, /Kelly recommendation/)
  assert.match(html, /Your stake/)
  assert.match(html, currencyPattern('10,00'))
  assert.match(html, /id="save-bet-notes"[^>]*>Wait for goalie confirmation\./)
  assert.doesNotMatch(
    html,
    /id="stake-recommendation-your-stake"[^>]+disabled=/,
  )
  assert.doesNotMatch(html, /id="save-bet-stake"[^>]+disabled=/)
})

test('returning from Review preserves manual stake in the main workflow', () => {
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '8.75',
    stakeRecommendation: createStakeRecommendation(),
  })

  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value="8.75"/)
  assert.doesNotMatch(html, /id="save-bet-stake"/)
})

test('actual stake is blank until the user or Use Recommended Stake sets it', () => {
  const html = renderResultCard({
    isBetReviewOpen: false,
    stake: '',
    stakeRecommendation: createStakeRecommendation(),
  })

  assert.match(html, /id="stake-recommendation-your-stake"[^>]+value=""/)
  assert.doesNotMatch(
    html,
    /id="stake-recommendation-your-stake"[^>]+value="30"/,
  )
})

test('reason presentation mapping never renders invalid numeric artifacts', () => {
  const reasons = kellyStaking.KELLY_RECOMMENDATION_REASONS
  const scenarios = [
    kellyStaking.calculateKellyStakeRecommendation({
      decimalOdds: 2,
      modelProbability: Number.NaN,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      decimalOdds: 1,
      modelProbability: 0.55,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      modelProbability: 0.45,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      minimumEdgePercent: 2,
      modelProbability: 0.514,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      decimalOdds: 2,
      kellyFraction: 0,
      minimumEdgePercent: 0,
      modelProbability: 0.55,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1000,
      bankrollInitialized: false,
      decimalOdds: 2.1,
      modelProbability: 0.55,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 0,
      decimalOdds: 2.1,
      modelProbability: 0.55,
    }),
    kellyStaking.calculateKellyStakeRecommendation({
      bankrollAmount: 1,
      decimalOdds: 2.1,
      minimumEdgePercent: 0,
      modelProbability: 0.55,
      roundingIncrement: 100,
    }),
  ]

  assert.deepEqual(
    scenarios.map((scenario) => scenario.reason),
    [
      reasons.INVALID_PROBABILITY,
      reasons.INVALID_ODDS,
      reasons.NO_POSITIVE_EDGE,
      reasons.BELOW_MINIMUM_EDGE,
      reasons.NON_POSITIVE_KELLY,
      reasons.BANKROLL_NOT_INITIALIZED,
      reasons.NO_AVAILABLE_BANKROLL,
      reasons.STAKE_BELOW_ROUNDING_INCREMENT,
    ],
  )

  scenarios.forEach((scenario) => {
    const presentation =
      kellyStaking.getKellyRecommendationPresentation(scenario)

    assert.ok(presentation.statusLabel)
    assert.ok(presentation.recommendedPercentText)
    assert.ok(presentation.recommendedAmountText)
    assert.ok(presentation.supportingMessage)
    assert.doesNotMatch(
      Object.values(presentation).join(' '),
      /NaN|Infinity|undefined/,
    )
  })
})

test('bet payload keeps actual stake separate from Kelly snapshot', () => {
  const result = calculateGameUtils.calculateGame(baseInputs.home, baseInputs.away)
  const stakeRecommendation = createStakeRecommendation({
    decimalOdds: 2.1,
    modelProbability: result.homeWinProbability,
  })
  const snapshot =
    kellyStaking.createKellyRecommendationSnapshot(stakeRecommendation)
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    awayTeam,
    homeTeam,
    inputs: baseInputs,
    kellyRecommendation: snapshot,
    notes: 'Manual stake under Kelly.',
    result,
    selectedSide: 'home',
    stake: 5,
  })

  assert.equal(payload.stake, 5)
  assert.equal(payload.notes, 'Manual stake under Kelly.')
  assert.equal(
    payload.kellyRecommendation.recommendedStakeAmount,
    snapshot.recommendedStakeAmount,
  )
  assert.equal(
    payload.kellyRecommendation.recommendedStakePercent,
    snapshot.recommendedStakePercent,
  )
})

test('manual stake can be saved when Kelly recommendation is absent', () => {
  const result = calculateGameUtils.calculateGame(baseInputs.home, baseInputs.away)
  const stakeRecommendation = createStakeRecommendation({
    decimalOdds: 2,
    modelProbability: 0.514,
  })
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    awayTeam,
    homeTeam,
    inputs: baseInputs,
    kellyRecommendation:
      kellyStaking.createKellyRecommendationSnapshot(stakeRecommendation),
    result,
    selectedSide: 'home',
    stake: 5,
  })

  assert.equal(stakeRecommendation.eligible, false)
  assert.equal(stakeRecommendation.reason, 'BELOW_MINIMUM_EDGE')
  assert.equal(payload.stake, 5)
  assert.equal(
    payload.recommendationState,
    'POSITIVE_VALUE_BELOW_THRESHOLD',
  )
  assert.equal(payload.modelStatus, 'Positive Value · Below Threshold')
  assert.equal(payload.kellyRecommendation.eligible, false)
  assert.equal(payload.kellyRecommendation.reason, 'BELOW_MINIMUM_EDGE')
  assert.equal(payload.kellyRecommendation.minimumEdgePercent, 2)
  assert.equal(
    payload.kellyRecommendation.recommendationState,
    'POSITIVE_VALUE_BELOW_THRESHOLD',
  )
  assert.equal(payload.kellyRecommendation.recommendedStakeAmount, null)

  const reloaded = savedAnalyses.normalizeBet(payload)

  assert.equal(reloaded.expectedValue, payload.expectedValue)
  assert.equal(reloaded.probabilityEdge, payload.probabilityEdge)
  assert.equal(reloaded.kellyRecommendation.minimumEdgePercent, 2)
  assert.equal(
    reloaded.recommendationState,
    'POSITIVE_VALUE_BELOW_THRESHOLD',
  )
})

test('manual over-maximum stake can still be saved unchanged', () => {
  const result = calculateGameUtils.calculateGame(baseInputs.home, baseInputs.away)
  const stakeRecommendation = createStakeRecommendation()
  const comparison = kellyStaking.getMaximumStakeComparison({
    actualStakeAmount: 40,
    recommendation: stakeRecommendation,
  })
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    awayTeam,
    homeTeam,
    inputs: baseInputs,
    kellyRecommendation:
      kellyStaking.createKellyRecommendationSnapshot(stakeRecommendation),
    result,
    selectedSide: 'home',
    stake: 40,
  })

  assert.equal(comparison.exceedsMaximumStake, true)
  assert.equal(payload.stake, 40)
  assert.equal(payload.kellyRecommendation.recommendedStakeAmount, 30)
})
