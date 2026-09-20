const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateAutomaticPrediction, settingsFingerprint, getPredictionSettings } = require('../services/automaticPredictionService')
const { AUTOMATIC_PREDICTION_MODEL_VERSION } = require('../services/forwardPredictionContracts')
const { getSpecialTeamsContextForTeams } = require('../../shared/specialTeamsMatchups')
const { inputs, parityScenarios, scenarioInputs } = require('./fixtures/forwardPredictionFixtures')

for (const scenario of parityScenarios) {
  test(`automatic and interactive calculation contracts remain explicit: ${scenario.name}`, async () => {
    const { calculatePreliminaryAnalysis } = await import('../../client/src/utils/modelAnalysis.js')
    const { calculateGame } = await import('../../client/src/utils/calculateGame.js')
    const value = scenarioInputs(scenario)
    const result = calculateAutomaticPrediction(value)
    const dashboard = calculatePreliminaryAnalysis({ homeTeamId: 'BOS', awayTeamId: 'TOR',
      powerRatings: value.ratings, baseHomeAdvantage: value.settings.homeAdvantage,
      probabilityScale: 20, injurySummaries: value.injurySummaries, gameContext: value.gameContext,
      specialTeamsContext: getSpecialTeamsContextForTeams({ homeTeam: 'BOS', awayTeam: 'TOR',
        mode: value.settings.specialTeamsMode, specialTeams: value.specialTeams }) })
    const analyzer = calculateGame(dashboard.inputs.home, dashboard.inputs.away, 20)
    assert.equal(result.available, true)
    assert.ok(Math.abs(analyzer.homeWinProbability - scenario.expected) < 1e-14)
    assert.equal(dashboard.homeMarket.modelProbability, analyzer.homeWinProbability)
    if (scenario.goalie === undefined) {
      assert.equal(result.homeWinProbability, dashboard.homeMarket.modelProbability)
      assert.equal(result.modelState.home.effectiveRating, dashboard.homeFinalRating)
    } else {
      const neutralContext = { ...value.gameContext, goalieSelections: {} }
      const neutral = calculateAutomaticPrediction({ ...value, gameContext: neutralContext })
      assert.deepEqual(result, neutral)
      assert.notEqual(result.homeWinProbability, analyzer.homeWinProbability)
    }
    assert.equal(result.homeWinProbability + result.awayWinProbability, 1)
    assert.equal(result.homeFairOdds, 1 / result.homeWinProbability)
    assert.equal(result.awayFairOdds, 1 / result.awayWinProbability)
  })
}

test('stored team rating adjustment is preserved, game-specific overrides are excluded', () => {
  const value = scenarioInputs(parityScenarios.at(-1))
  value.ratings[0].manualAdjustment = 2
  const baseline = calculateAutomaticPrediction(value)
  Object.assign(value.gameContext.homeContext, { restFatigueOverrideEnabled: true,
    manualRestFatigueAdjustment: 3, effectiveRestFatigueAdjustment: 3,
    quickRematchOverrideEnabled: true, manualQuickRematchAdjustment: 3, effectiveQuickRematchAdjustment: 3 })
  Object.assign(value.gameContext.goalieSelections.home, { overrideEnabled: true, manualAdjustment: -4, effectiveAdjustment: -4 })
  value.motivation = 20
  value.manualAdjustment = 20
  assert.deepEqual(calculateAutomaticPrediction(value), baseline)
  assert.equal(baseline.adjustments.home.ratingAdjustment, 2)
  assert.equal(baseline.adjustments.home.goalie, 0)
})

test('missing required ratings reject, optional missing inputs remain visibly neutral', () => {
  assert.equal(calculateAutomaticPrediction(inputs({ ratings: [] })).reason, 'RATINGS_UNAVAILABLE')
  const value = inputs({ gameContext: null, injurySummaries: null,
    settings: { specialTeamsMode: 'automatic' } })
  const result = calculateAutomaticPrediction(value)
  assert.equal(result.available, true)
  assert.equal(result.completeness.goalies.home, 'unknown')
  assert.equal(result.completeness.schedule.home, 'unavailable')
  assert.equal(result.completeness.injuries.home, 'unavailable')
  assert.equal(result.completeness.specialTeams.home, 'unavailable')
  assert.equal(result.adjustments.home.goalie, 0)
  assert.equal(result.modelState.home.goalieNhlPlayerId, null)
  for (const invalid of [null, '', NaN, Infinity]) {
    const bad = inputs(); bad.ratings[0].baseRating = invalid
    assert.equal(calculateAutomaticPrediction(bad).available, false)
  }
})

test('manual home and away goalie identity or status never affects Official T2', () => {
  const baseline = calculateAutomaticPrediction(inputs())

  for (const side of ['home', 'away']) {
    for (const confirmationStatus of ['selected', 'expected', 'confirmed']) {
      const value = inputs({
        gameContext: {
          ...inputs().gameContext,
          goalieSelections: {
            [side]: {
              confirmationStatus,
              effectiveAdjustment: -4,
              nhlPlayerId: side === 'home' ? 1 : 2,
              selectionType: 'provider_goalie',
              teamDefaultAdjustment: -2,
              teamId: side === 'home' ? 'BOS' : 'TOR',
            },
          },
        },
      })
      assert.deepEqual(calculateAutomaticPrediction(value), baseline)
    }
  }
})

test('changing GameContext goalie selection cannot change automatic output', () => {
  const value = inputs()
  const baseline = calculateAutomaticPrediction(value)
  value.gameContext.goalieSelections = {
    home: {
      confirmationStatus: 'confirmed',
      effectiveAdjustment: -3,
      nhlPlayerId: 8480001,
      selectionType: 'provider_goalie',
      teamDefaultAdjustment: -3,
      teamId: 'BOS',
    },
  }
  const firstManualState = calculateAutomaticPrediction(value)
  value.gameContext.goalieSelections.home = {
    ...value.gameContext.goalieSelections.home,
    nhlPlayerId: 8480002,
    teamDefaultAdjustment: -1,
  }

  assert.deepEqual(firstManualState, baseline)
  assert.deepEqual(calculateAutomaticPrediction(value), baseline)
  assert.equal(baseline.completeness.goalies.home, 'unknown')
  assert.equal(baseline.modelState.home.goalieNhlPlayerId, null)
  assert.equal(baseline.modelVersion, AUTOMATIC_PREDICTION_MODEL_VERSION)
})

test('persistent team adjustment and legacy home-adjustment storage match Dashboard normalization', async () => {
  const { calculatePreliminaryAnalysis } = await import('../../client/src/utils/modelAnalysis.js')
  const value = inputs()
  value.ratings[0].manualAdjustment = 2
  value.ratings[0].homeAdvantage = 0.5
  const automatic = calculateAutomaticPrediction(value)
  const live = calculatePreliminaryAnalysis({ homeTeamId: 'BOS', awayTeamId: 'TOR',
    powerRatings: value.ratings, baseHomeAdvantage: 3.5, probabilityScale: 20,
    gameContext: value.gameContext, injurySummaries: value.injurySummaries })
  assert.equal(automatic.homeWinProbability, live.homeMarket.modelProbability)
  assert.equal(automatic.adjustments.home.homeAdvantage, 4)
  assert.equal(automatic.modelState.home.baseRating, 46)
  assert.equal(automatic.modelState.home.effectiveRating, 52)
})

test('fingerprint is canonical, effective-only, and independent of identity/UI/market/rating-update settings', () => {
  assert.equal(settingsFingerprint({ probabilityScale: 20, homeAdvantage: 3.5 }, {}),
    settingsFingerprint({ homeAdvantage: 3.5, probabilityScale: 20 }, {}))
  const base = settingsFingerprint({}, {})
  for (const change of [{ kFactor: 4 }, { userId: 'private', theme: 'dark', bankroll: 50 },
    { maximumGoaliePenalty: -3 }, { maximumPlayerInjuryPenalty: -2 }, { specialTeamsMode: 'off' }]) {
    assert.equal(settingsFingerprint(change, {}), base)
  }
  for (const change of [{ homeAdvantage: 4 }, { probabilityScale: 25 }, { specialTeamsMode: 'automatic' }]) {
    assert.notEqual(settingsFingerprint(change, {}), base)
  }
  assert.notEqual(settingsFingerprint({}, { backToBackAdjustment: -1 }), base)
  assert.notEqual(settingsFingerprint({}, { quickRematchMaximumDays: 7 }), base)
  assert.equal(settingsFingerprint({}, { wellRestedEnabled: false, wellRestedAdjustment: 0.5 }), base)
  assert.equal(settingsFingerprint({}, { restFatigueEnabled: false, backToBackAdjustment: -1 }),
    settingsFingerprint({}, { restFatigueEnabled: false, backToBackAdjustment: -2 }))
  assert.equal(settingsFingerprint({}, { enabled: false }), settingsFingerprint({}, { quickRematchEnabled: false }))
  assert.equal(getPredictionSettings({}, {}).probabilityScale, 20)
})
