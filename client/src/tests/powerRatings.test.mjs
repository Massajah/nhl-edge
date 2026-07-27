import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInputsForTeams } from '../utils/modelAnalysis.js'
import {
  DEFAULT_POWER_RATING_VALUES,
  formatSignedHomeAdjustment,
  getEffectiveHomeAdvantage,
  normalizePowerRatings,
} from '../utils/powerRatings.js'

test('Power Rating utilities default team Home Adjustment to zero', () => {
  const ratings = normalizePowerRatings([])

  assert.equal(DEFAULT_POWER_RATING_VALUES.homeAdjustment, 0)
  assert.equal(ratings.BOS.homeAdjustment, 0)
  assert.equal(formatSignedHomeAdjustment(ratings.BOS.homeAdjustment), '0.00')
})

test('Power Rating utilities calculate effective home advantage', () => {
  assert.equal(
    getEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: 0,
    }),
    4,
  )
  assert.equal(
    getEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: 0.5,
    }),
    4.5,
  )
  assert.equal(
    getEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: -1.2,
    }),
    2.8,
  )
})

test('production analysis inputs use base plus team Home Adjustment', () => {
  const ratings = normalizePowerRatings([
    {
      abbreviation: 'BOS',
      baseRating: 50,
      homeAdjustment: 0.5,
      manualAdjustment: 0,
      teamId: 'BOS',
      teamName: 'Boston Bruins',
    },
    {
      abbreviation: 'TOR',
      baseRating: 50,
      homeAdjustment: -1.2,
      manualAdjustment: 0,
      teamId: 'TOR',
      teamName: 'Toronto Maple Leafs',
    },
  ])
  const inputs = createInputsForTeams(
    ratings,
    {
      away: 'TOR',
      home: 'BOS',
    },
    {},
    {},
    4,
  )

  assert.equal(inputs.home.homeAdvantage, 4.5)
})
