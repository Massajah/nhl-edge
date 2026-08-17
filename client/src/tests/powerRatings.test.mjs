import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createInputsForTeams } from '../utils/modelAnalysis.js'
import {
  DEFAULT_POWER_RATING_VALUES,
  formatPowerRatingDisplayValue,
  formatSignedHomeAdjustment,
  formatSignedPowerRatingDisplayValue,
  getEffectiveHomeAdvantage,
  normalizePowerRatings,
  parsePowerRatingDraftValue,
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

test('Power Rating display formatting uses two decimals without changing raw precision', () => {
  const rawValue = '59.342440054997'

  assert.equal(formatPowerRatingDisplayValue(rawValue), '59.34')
  assert.equal(parsePowerRatingDraftValue(rawValue), 59.342440054997)
  assert.equal(formatPowerRatingDisplayValue(52), '52.00')
  assert.equal(formatPowerRatingDisplayValue(47.5), '47.50')
  assert.equal(formatPowerRatingDisplayValue(0), '0.00')
})

test('Power Rating numeric presentation fails safely for malformed values', () => {
  assert.equal(formatPowerRatingDisplayValue('', { fallback: '' }), '')
  assert.equal(formatPowerRatingDisplayValue(undefined, { fallback: '--' }), '--')
  assert.equal(formatPowerRatingDisplayValue('not-a-number', { fallback: '' }), '')
  assert.equal(parsePowerRatingDraftValue('not-a-number'), null)
})

test('signed Power Rating display formatting includes sign and two decimals', () => {
  assert.equal(formatSignedPowerRatingDisplayValue(0.7), '+0.70')
  assert.equal(formatSignedPowerRatingDisplayValue(-0.7), '-0.70')
  assert.equal(formatSignedPowerRatingDisplayValue(0), '0.00')
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

test('Power Ratings page explains calibrated starting scale and live-rating freedom', async () => {
  const source = (
    await Promise.all([
      readFile(
        new URL('../components/PowerRatings.jsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../utils/startingRatingScale.js', import.meta.url),
        'utf8',
      ),
    ])
  ).join('\n')

  assert.match(source, /Starting Rating Scale/)
  assert.match(source, /42–50 · Calibrated default/)
  assert.match(source, /42–48/)
  assert.match(source, /40–50/)
  assert.match(source, /40–52/)
  assert.match(source, /Live ratings may move outside this range/)
  assert.match(source, /Starting scale cannot be changed after live rating updates begin/)
  assert.match(source, /Minimum starting rating/)
  assert.match(source, /Maximum starting rating/)
  assert.match(source, /Current live range/)
  assert.match(source, /Non-default starting ranges have not been calibrated/)
  assert.doesNotMatch(source, /<dt>Center<\/dt>/)
  assert.doesNotMatch(source, /<dt>Total spread<\/dt>/)
})
