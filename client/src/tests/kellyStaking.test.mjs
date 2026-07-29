import assert from 'node:assert/strict'
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
    /minimum is 2\.00 percentage points/,
  )
  assert.match(
    kellyStaking.getKellyRecommendationReasonMessage(noBankroll),
    /Set up your bankroll/,
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
  const stakeRecommendation = kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 1000,
      currency: 'EUR',
      currentBankroll: 1000,
      initialized: true,
    },
    decimalOdds: 2.1,
    modelProbability: 0.55,
    settings: {
      bankrollBasis: 'AVAILABLE',
      customKellyFraction: 0.25,
      kellyMode: 'QUARTER',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    },
  })
  const html = renderResultCard({
    stakeRecommendation,
  })

  assert.match(html, /Stake Recommendation/)
  assert.match(html, /Use Recommended Stake/)
  assert.match(html, /Edit Betting Settings/)
  assert.match(html, /id="save-bet-stake"[^>]+value="1"/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('ResultCard shows no-bankroll action and no fabricated zero amount', () => {
  const stakeRecommendation = kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 0,
      currency: 'EUR',
      currentBankroll: 0,
      initialized: false,
    },
    decimalOdds: 2.1,
    modelProbability: 0.55,
    settings: {
      bankrollBasis: 'AVAILABLE',
      customKellyFraction: 0.25,
      kellyMode: 'QUARTER',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    },
  })
  const html = renderResultCard({
    isBetReviewOpen: false,
    stakeRecommendation,
  })

  assert.match(html, /Bankroll required/)
  assert.match(html, /Set Up Bankroll/)
  assert.match(html, /3\.00 % of available bankroll/)
  assert.doesNotMatch(html, /0\.00/)
  assert.doesNotMatch(html, /NaN|Infinity|undefined/)
})

test('bet payload keeps actual stake separate from Kelly snapshot', () => {
  const result = calculateGameUtils.calculateGame(baseInputs.home, baseInputs.away)
  const stakeRecommendation = kellyStaking.createKellyStakeRecommendation({
    bankrollSummary: {
      availableBankroll: 1000,
      currency: 'EUR',
      currentBankroll: 1000,
      initialized: true,
    },
    decimalOdds: 2.1,
    modelProbability: result.homeWinProbability,
    settings: {
      bankrollBasis: 'AVAILABLE',
      customKellyFraction: 0.25,
      kellyMode: 'QUARTER',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    },
  })
  const snapshot =
    kellyStaking.createKellyRecommendationSnapshot(stakeRecommendation)
  const payload = savedAnalyses.createBetPayloadFromGameAnalysis({
    awayTeam,
    homeTeam,
    inputs: baseInputs,
    kellyRecommendation: snapshot,
    result,
    selectedSide: 'home',
    stake: 5,
  })

  assert.equal(payload.stake, 5)
  assert.equal(payload.kellyRecommendation.recommendedStakeAmount, 30)
  assert.equal(payload.kellyRecommendation.recommendedStakePercent, 3)
})
