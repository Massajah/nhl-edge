process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  RESULT_TYPES,
  WINNERS,
  calculateLogisticProbability,
  calculatePregameProbability,
  calculateRatingUpdate,
  classifyCompletedGameResult,
} = require('../services/powerRatingEngine')
const { fixtureGames } = require('./fixtures/powerRatingReplayFixtures')

const assertAlmostEqual = (actual, expected, tolerance = 1e-12) => {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${actual} was not within ${tolerance} of ${expected}`,
  )
}

test('pregame probability outputs sum to 1', () => {
  const probability = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 2.5,
    homeRating: 50,
  })

  assertAlmostEqual(probability.homeProbability + probability.awayProbability, 1)
  assert.equal(probability.homeProbability > 0, true)
  assert.equal(probability.homeProbability < 1, true)
})

test('higher rating increases expected probability', () => {
  const lowerRatedHome = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 0,
    homeRating: 50,
  })
  const higherRatedHome = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 0,
    homeRating: 53,
  })

  assert.equal(
    higherRatedHome.homeProbability > lowerRatedHome.homeProbability,
    true,
  )
})

test('home advantage increases home probability', () => {
  const neutralHome = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 0,
    homeRating: 50,
  })
  const advantagedHome = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 2.5,
    homeRating: 50,
  })

  assert.equal(advantagedHome.homeProbability > neutralHome.homeProbability, true)
})

test('production probability scale defaults to the calibrated value and accepts explicit overrides', () => {
  const defaultProbability = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 0,
    homeRating: 56,
  })
  const widerScaleProbability = calculatePregameProbability({
    awayRating: 50,
    homeAdvantage: 0,
    homeRating: 56,
    probabilityScale: 30,
  })

  assert.equal(defaultProbability.probabilityScale, 20)
  assert.equal(widerScaleProbability.probabilityScale, 30)
  assert.equal(
    widerScaleProbability.homeProbability < defaultProbability.homeProbability,
    true,
  )
  assertAlmostEqual(calculateLogisticProbability(0, 12), 0.5)
  assert.throws(
    () => calculateLogisticProbability(1, 0),
    /probabilityScale must be greater than 0/,
  )
})

test('50/50 regulation winner gets +0.65 with calibrated K', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.5,
    homeExpectedProbability: 0.5,
    resultType: RESULT_TYPES.REGULATION,
    winner: WINNERS.HOME,
  })

  assertAlmostEqual(update.homeDelta, 0.65)
  assertAlmostEqual(update.awayDelta, -0.65)
})

test('30% underdog regulation winner gets +0.91 with calibrated K', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.7,
    homeExpectedProbability: 0.3,
    resultType: RESULT_TYPES.REGULATION,
    winner: WINNERS.HOME,
  })

  assertAlmostEqual(update.homeDelta, 0.91)
})

test('90% favorite regulation winner gets +0.13 with calibrated K', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.1,
    homeExpectedProbability: 0.9,
    resultType: RESULT_TYPES.REGULATION,
    winner: WINNERS.HOME,
  })

  assertAlmostEqual(update.homeDelta, 0.13)
})

test('calibrated overtime multiplier produces +0.364 for a 30% underdog', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.7,
    homeExpectedProbability: 0.3,
    resultType: RESULT_TYPES.OVERTIME,
    winner: WINNERS.HOME,
  })

  assertAlmostEqual(update.homeDelta, 0.364)
})

test('calibrated shootout multiplier produces +0.091 for a 30% underdog', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.7,
    homeExpectedProbability: 0.3,
    resultType: RESULT_TYPES.SHOOTOUT,
    winner: WINNERS.HOME,
  })

  assertAlmostEqual(update.homeDelta, 0.091)
})

test('rating deltas are equal and opposite', () => {
  const update = calculateRatingUpdate({
    awayExpectedProbability: 0.41,
    homeExpectedProbability: 0.59,
    resultType: RESULT_TYPES.OVERTIME,
    winner: WINNERS.AWAY,
  })

  assertAlmostEqual(update.homeDelta + update.awayDelta, 0)
})

test('regulation result detection uses NHL gameOutcome.lastPeriodType', () => {
  const classification = classifyCompletedGameResult(fixtureGames[0])

  assert.equal(classification.isResolved, true)
  assert.equal(classification.resultType, RESULT_TYPES.REGULATION)
  assert.equal(classification.winner, WINNERS.HOME)
})

test('overtime result detection uses NHL gameOutcome.lastPeriodType', () => {
  const classification = classifyCompletedGameResult(fixtureGames[1])

  assert.equal(classification.isResolved, true)
  assert.equal(classification.resultType, RESULT_TYPES.OVERTIME)
  assert.equal(classification.winner, WINNERS.AWAY)
})

test('shootout result detection uses NHL gameOutcome.lastPeriodType', () => {
  const classification = classifyCompletedGameResult(fixtureGames[2])

  assert.equal(classification.isResolved, true)
  assert.equal(classification.resultType, RESULT_TYPES.SHOOTOUT)
  assert.equal(classification.winner, WINNERS.HOME)
})

test('malformed completed games are marked unresolved', () => {
  const classification = classifyCompletedGameResult(fixtureGames[23])

  assert.equal(classification.isResolved, false)
  assert.equal(classification.resultType, RESULT_TYPES.UNRESOLVED)
  assert.equal(classification.warning.code, 'UNRESOLVED_RESULT_TYPE')
})
