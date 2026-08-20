import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createInputsForTeams } from '../utils/modelAnalysis.js'
import { calculateGame } from '../utils/calculateGame.js'
import {
  DEFAULT_POWER_RATING_VALUES,
  formatPowerRatingDisplayValue,
  formatSignedHomeAdjustment,
  formatSignedPowerRatingDisplayValue,
  getEffectiveHomeAdvantage,
  getPowerRatingBreakdown,
  getPowerRatingLeagueRank,
  getPowerRatingLeagueRanks,
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

test('Power Rating breakdown separates start, automatic Change, Manual Adjustment, and final Power Rating', () => {
  const breakdown = getPowerRatingBreakdown(
    {
      baseRating: 46,
      homeAdjustment: 0.75,
      manualAdjustment: 0.5,
      seasonStartingRating: 44.5,
      seasonStartingRatingSeasonId: '20262027',
    },
    { seasonId: '20262027' },
  )

  assert.deepEqual(breakdown, {
    currentRating: 46.5,
    manualAdjustment: 0.5,
    modelMovement: 1.5,
    modelRating: 46,
    startingRating: 44.5,
  })
  assert.equal(
    getPowerRatingBreakdown(
      {
        baseRating: 46,
        manualAdjustment: 0,
        seasonStartingRating: 44.5,
        seasonStartingRatingSeasonId: '20252026',
      },
      { seasonId: '20262027' },
    ).startingRating,
    null,
  )
})

test('Power Rating breakdown formats negative automatic movement independently from Manual Adjustment', () => {
  const breakdown = getPowerRatingBreakdown(
    {
      baseRating: 46.5,
      manualAdjustment: -0.25,
      seasonStartingRating: 48,
      seasonStartingRatingSeasonId: '20262027',
    },
    { seasonId: '20262027' },
  )

  assert.equal(breakdown.modelMovement, -1.5)
  assert.equal(breakdown.manualAdjustment, -0.25)
  assert.equal(breakdown.currentRating, 46.25)
  assert.equal(formatSignedPowerRatingDisplayValue(breakdown.modelMovement), '-1.50')
  assert.equal(formatSignedPowerRatingDisplayValue(breakdown.manualAdjustment), '-0.25')
})

test('manual-only movement changes Power Rating without changing the automatic Change value', () => {
  const breakdown = getPowerRatingBreakdown(
    {
      baseRating: 46,
      manualAdjustment: 1,
      seasonStartingRating: 46,
      seasonStartingRatingSeasonId: '20262027',
    },
    { seasonId: '20262027' },
  )

  assert.equal(breakdown.modelMovement, 0)
  assert.equal(breakdown.currentRating, 47)
  assert.equal(formatSignedPowerRatingDisplayValue(breakdown.modelMovement), '0.00')
  assert.equal(formatSignedPowerRatingDisplayValue(breakdown.manualAdjustment), '+1.00')
})

test('missing season baseline preserves current Power Rating and Manual Adjustment without fabricating Change', () => {
  const breakdown = getPowerRatingBreakdown(
    {
      baseRating: 46,
      manualAdjustment: 0.5,
      seasonStartingRating: null,
      seasonStartingRatingSeasonId: null,
    },
    { seasonId: '20262027' },
  )

  assert.equal(breakdown.startingRating, null)
  assert.equal(breakdown.modelMovement, null)
  assert.equal(breakdown.manualAdjustment, 0.5)
  assert.equal(breakdown.currentRating, 46.5)
})

test('league Power Rating rank uses effective values with competition ties', () => {
  const ratings = {
    ANA: { baseRating: 46, manualAdjustment: 0.5, teamId: 'ANA' },
    BOS: { baseRating: 46.5, manualAdjustment: 0, teamId: 'BOS' },
    TOR: { baseRating: 46.4, manualAdjustment: 0, teamId: 'TOR' },
  }
  const tiedRanks = getPowerRatingLeagueRanks(ratings)

  assert.deepEqual(tiedRanks, { ANA: 1, BOS: 1, TOR: 3 })
  assert.equal(getPowerRatingLeagueRank(ratings, 'ANA'), 1)

  ratings.ANA.manualAdjustment = -0.5

  assert.equal(getPowerRatingLeagueRank(ratings, 'ANA'), 3)
  assert.equal(getPowerRatingLeagueRank(ratings, 'BOS'), 1)
})

test('stored manual adjustment reaches Game Analyzer exactly once', () => {
  const ratings = normalizePowerRatings([
    {
      abbreviation: 'BOS',
      baseRating: 46,
      manualAdjustment: 0.5,
      teamId: 'BOS',
      teamName: 'Boston Bruins',
    },
    {
      abbreviation: 'TOR',
      baseRating: 46,
      manualAdjustment: 0,
      teamId: 'TOR',
      teamName: 'Toronto Maple Leafs',
    },
  ])
  const inputs = createInputsForTeams(
    ratings,
    { away: 'TOR', home: 'BOS' },
    {},
    {},
    0,
  )
  const result = calculateGame(inputs.home, inputs.away)

  assert.equal(inputs.home.baseRating, 46.5)
  assert.equal(inputs.home.manualAdjustment, 0)
  assert.equal(result.homeFinalRating, 46.5)
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
  assert.match(source, /label: 'Starting Rating'/)
  assert.match(source, /label: 'Home Adjustment'/)
  assert.match(source, /label: 'Manual Adjustment'/)
  assert.match(source, /<span>Power Rating<\/span>/)
  assert.match(source, /formatRating\(team\.startingRating\)/)
  assert.match(source, /formatSignedPowerRatingDisplayValue/)
  assert.match(source, /className="rating-input-formatted"/)
  assert.match(source, /canEditStartingRatings/)
  assert.doesNotMatch(source, /label: 'Model Rating'/)
  assert.doesNotMatch(source, /<span>Current<\/span>/)
  assert.doesNotMatch(source, /League \{team\.leagueRank/)
  assert.match(source, /Non-default starting ranges have not been calibrated/)
  assert.doesNotMatch(source, /<dt>Center<\/dt>/)
  assert.doesNotMatch(source, /<dt>Total spread<\/dt>/)
})
