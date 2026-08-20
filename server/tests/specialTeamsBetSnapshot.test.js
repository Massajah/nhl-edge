const assert = require('node:assert/strict')
const test = require('node:test')
const {
  normalizeCreatePayload,
} = require('../services/betsService')

const team = (teamId, name) => ({
  abbreviation: teamId,
  name,
  teamId,
})

const specialTeamsSnapshot = () => ({
  adjustment: 0.5,
  mode: 'automatic',
  opponentPkRank: 29,
  ppRank: 3,
  signal: 'strong_pp_vs_weak_pk',
  status: 'positive',
  threshold: 6,
})

const payload = () => ({
  adjustments: {
    awaySpecialTeamsAdjustment: 0.5,
    awaySpecialTeamsSnapshot: specialTeamsSnapshot(),
    homeSpecialTeamsAdjustment: 0,
    homeSpecialTeamsSnapshot: {
      adjustment: 0,
      mode: 'automatic',
      opponentPkRank: 16,
      ppRank: 16,
      signal: null,
      status: 'neutral',
      threshold: 6,
    },
  },
  awayTeam: team('TOR', 'Toronto Maple Leafs'),
  betType: 'moneyline',
  homeTeam: team('BOS', 'Boston Bruins'),
  marketOdds: 2.1,
  modelProbability: 0.52,
  result: 'pending',
  selectedSide: {
    ...team('TOR', 'Toronto Maple Leafs'),
    homeAway: 'away',
  },
  specialTeamsAdjustment: 0.5,
  specialTeamsSnapshot: specialTeamsSnapshot(),
  stake: 1,
})

test('saved bet normalization preserves the Special Teams audit snapshot', () => {
  const source = payload()
  const normalized = normalizeCreatePayload(source)

  assert.equal(normalized.specialTeamsAdjustment, 0.5)
  assert.deepEqual(normalized.specialTeamsSnapshot, specialTeamsSnapshot())
  assert.equal(normalized.adjustments.awaySpecialTeamsAdjustment, 0.5)
  assert.deepEqual(
    normalized.adjustments.awaySpecialTeamsSnapshot,
    specialTeamsSnapshot(),
  )

  source.specialTeamsSnapshot.adjustment = 0.75
  source.adjustments.awaySpecialTeamsSnapshot.mode = 'alert_only'
  assert.equal(normalized.specialTeamsSnapshot.adjustment, 0.5)
  assert.equal(
    normalized.adjustments.awaySpecialTeamsSnapshot.mode,
    'automatic',
  )
})

test('saved bet normalization rejects invalid Special Teams snapshot enums', () => {
  const source = payload()

  source.specialTeamsSnapshot.signal = 'pp_bonus'

  assert.throws(
    () => normalizeCreatePayload(source),
    (error) =>
      error.statusCode === 400 &&
      error.details.field === 'specialTeamsSnapshot.signal',
  )
})
