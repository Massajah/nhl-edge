const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeCreatePayload } = require('../services/betsService')

const team = (teamId, name) => ({
  abbreviation: teamId,
  name,
  teamId,
})

const createPayload = () => ({
  awayTeam: team('TOR', 'Toronto Maple Leafs'),
  betType: 'moneyline',
  expectedValue: 5.1,
  homeTeam: team('BOS', 'Boston Bruins'),
  kellyRecommendation: {
    bettingSettingsSnapshot: {
      bankrollBasis: 'AVAILABLE',
      customKellyFraction: 0.25,
      kellyMode: 'QUARTER',
      maximumStakePercent: 3,
      minimumEdgePercent: 2,
      stakeRoundingIncrement: 0.5,
    },
    eligible: false,
    minimumEdgePercent: 2,
    reason: 'BELOW_MINIMUM_EDGE',
    recommendationState: 'POSITIVE_VALUE_BELOW_THRESHOLD',
  },
  marketOdds: 2.62,
  modelProbability: 0.401,
  probabilityEdge: 0.0196,
  recommendationState: 'POSITIVE_VALUE_BELOW_THRESHOLD',
  result: 'pending',
  selectedSide: {
    ...team('BOS', 'Boston Bruins'),
    homeAway: 'home',
  },
  stake: 5,
})

test('saved below-threshold recommendation keeps its audit snapshot', () => {
  const source = createPayload()
  const normalized = normalizeCreatePayload(source)

  assert.equal(normalized.expectedValue, 5.1)
  assert.equal(normalized.probabilityEdge, 0.0196)
  assert.equal(normalized.modelStatus, 'Positive Value · Below Threshold')
  assert.equal(
    normalized.recommendationState,
    'POSITIVE_VALUE_BELOW_THRESHOLD',
  )
  assert.equal(normalized.kellyRecommendation.minimumEdgePercent, 2)
  assert.equal(
    normalized.kellyRecommendation.recommendationState,
    'POSITIVE_VALUE_BELOW_THRESHOLD',
  )

  source.kellyRecommendation.minimumEdgePercent = 5
  source.kellyRecommendation.bettingSettingsSnapshot.minimumEdgePercent = 5

  assert.equal(normalized.kellyRecommendation.minimumEdgePercent, 2)
  assert.equal(
    normalized.kellyRecommendation.bettingSettingsSnapshot.minimumEdgePercent,
    2,
  )
})

test('legacy status values remain accepted without a recommendation state', () => {
  const normalized = normalizeCreatePayload({
    ...createPayload(),
    kellyRecommendation: undefined,
    modelStatus: 'Positive Value',
    recommendationState: undefined,
  })

  assert.equal(normalized.modelStatus, 'Positive Value')
  assert.equal(normalized.recommendationState, '')
})
