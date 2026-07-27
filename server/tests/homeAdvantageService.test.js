process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  calculateEffectiveHomeAdvantage,
} = require('../services/homeAdvantageService')

test('effective home advantage combines base with zero adjustment', () => {
  assert.deepEqual(
    calculateEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: 0,
    }),
    {
      baseHomeAdvantage: 4,
      effectiveHomeAdvantage: 4,
      homeTeamAdjustment: 0,
    },
  )
})

test('effective home advantage combines base with positive adjustment', () => {
  assert.deepEqual(
    calculateEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: 0.5,
    }),
    {
      baseHomeAdvantage: 4,
      effectiveHomeAdvantage: 4.5,
      homeTeamAdjustment: 0.5,
    },
  )
})

test('effective home advantage combines base with negative adjustment', () => {
  assert.deepEqual(
    calculateEffectiveHomeAdvantage({
      baseHomeAdvantage: 4,
      homeAdjustment: -1.2,
    }),
    {
      baseHomeAdvantage: 4,
      effectiveHomeAdvantage: 2.8,
      homeTeamAdjustment: -1.2,
    },
  )
})
