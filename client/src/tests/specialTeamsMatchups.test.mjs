import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let matchupUtils
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  matchupUtils = await vite.ssrLoadModule(
    '/src/utils/specialTeamsMatchups.js',
  )
})

after(async () => {
  await vite?.close()
})

const stats = (powerPlayLeagueRank, penaltyKillLeagueRank) => ({
  penaltyKillLeagueRank,
  powerPlayLeagueRank,
})

const calculate = ({
  away = stats(16, 16),
  home = stats(16, 16),
  leagueTeamCount = 32,
  threshold = 6,
} = {}) =>
  matchupUtils.calculateSpecialTeamsMatchup({
    awayTeamSpecialTeams: away,
    homeTeamSpecialTeams: home,
    leagueTeamCount,
    threshold,
  })

const leagueSpecialTeams = (away, home) => ({
  leagueTeamCount: 32,
  teams: [
    { ...away, teamAbbreviation: 'AAA' },
    { ...home, teamAbbreviation: 'BBB' },
  ],
})

const getContext = ({ adjustment = 0.5, away, home, mode = 'automatic' }) =>
  matchupUtils.getSpecialTeamsContextForTeams({
    adjustment,
    awayTeam: 'AAA',
    homeTeam: 'BBB',
    mode,
    specialTeams: leagueSpecialTeams(away, home),
    threshold: 6,
  })

test('Top 6 PP versus Bottom 6 PK is positive', () => {
  const result = calculate({
    away: stats(6, 16),
    home: stats(16, 27),
  })

  assert.equal(result.away.status, 'positive')
  assert.equal(result.away.ppRank, 6)
  assert.equal(result.away.opponentPkRank, 27)
})

test('Bottom 6 PP versus Top 6 PK is negative', () => {
  const result = calculate({
    away: stats(27, 16),
    home: stats(16, 6),
  })

  assert.equal(result.away.status, 'negative')
})

test('Top 6 PP versus rank 26 PK is neutral', () => {
  const result = calculate({
    away: stats(6, 16),
    home: stats(16, 26),
  })

  assert.equal(result.away.status, 'neutral')
})

test('rank 7 PP versus Bottom 6 PK is neutral', () => {
  const result = calculate({
    away: stats(7, 16),
    home: stats(16, 27),
  })

  assert.equal(result.away.status, 'neutral')
})

test('both teams are evaluated independently', () => {
  const result = calculate({
    away: stats(5, 4),
    home: stats(29, 28),
  })

  assert.equal(result.away.status, 'positive')
  assert.equal(result.home.status, 'negative')
})

test('threshold 4 uses Top and Bottom 4 boundaries', () => {
  const positive = calculate({
    away: stats(4, 16),
    home: stats(16, 29),
    threshold: 4,
  })
  const neutral = calculate({
    away: stats(5, 16),
    home: stats(16, 29),
    threshold: 4,
  })

  assert.equal(positive.away.status, 'positive')
  assert.equal(neutral.away.status, 'neutral')
})

test('threshold 10 uses Top and Bottom 10 boundaries', () => {
  const result = calculate({
    away: stats(10, 16),
    home: stats(16, 23),
    threshold: 10,
  })

  assert.equal(result.away.status, 'positive')
  assert.equal(result.away.bottomRankStart, 23)
})

test('bottom boundary follows a dynamic league size', () => {
  const positive = calculate({
    away: stats(6, 15),
    home: stats(15, 25),
    leagueTeamCount: 30,
  })
  const neutral = calculate({
    away: stats(6, 15),
    home: stats(15, 24),
    leagueTeamCount: 30,
  })

  assert.equal(positive.away.status, 'positive')
  assert.equal(positive.away.bottomRankStart, 25)
  assert.equal(neutral.away.status, 'neutral')
})

test('missing PP rank returns unavailable without a false alert', () => {
  const result = calculate({
    away: stats(null, 16),
    home: stats(16, 30),
  })

  assert.equal(result.away.status, 'unavailable')
})

test('missing opponent PK rank returns unavailable without a false alert', () => {
  const result = calculate({
    away: stats(3, 16),
    home: stats(16, null),
  })

  assert.equal(result.away.status, 'unavailable')
})

test('invalid ranks return unavailable', () => {
  const result = calculate({
    away: stats(0, 16),
    home: stats(16, 33),
  })

  assert.equal(result.away.status, 'unavailable')
})

test('matchup output is deterministic and contains no rating adjustment', () => {
  const input = {
    away: stats(2, 5),
    home: stats(31, 32),
  }
  const first = calculate(input)
  const second = calculate(input)

  assert.deepEqual(second, first)
  assert.equal(first.away.rankGap, 30)
  assert.equal(Object.hasOwn(first.away, 'adjustment'), false)
  assert.equal(Object.hasOwn(first.home, 'adjustment'), false)
})

test('production context applies symmetric positive and negative adjustments only in Automatic mode', () => {
  const automatic = getContext({
    away: stats(3, 16),
    home: stats(16, 29),
  })
  const alertOnly = getContext({
    away: stats(3, 16),
    home: stats(16, 29),
    mode: 'alert_only',
  })
  const off = getContext({
    away: stats(3, 16),
    home: stats(16, 29),
    mode: 'off',
  })
  const negative = getContext({
    away: stats(30, 16),
    home: stats(16, 2),
  })

  assert.equal(automatic.away.signal, 'strong_pp_vs_weak_pk')
  assert.equal(automatic.away.adjustment, 0.5)
  assert.equal(alertOnly.away.signal, 'strong_pp_vs_weak_pk')
  assert.equal(alertOnly.away.adjustment, 0)
  assert.equal(off.away.signal, null)
  assert.equal(off.away.adjustment, 0)
  assert.equal(negative.away.signal, 'weak_pp_vs_strong_pk')
  assert.equal(negative.away.adjustment, -0.5)
})

test('production context keeps both team signals independent', () => {
  const context = getContext({
    adjustment: 0.75,
    away: stats(6, 29),
    home: stats(6, 27),
  })

  assert.equal(context.away.adjustment, 0.75)
  assert.equal(context.home.adjustment, 0.75)
  assert.equal(context.away.ppRank, 6)
  assert.equal(context.home.opponentPkRank, 29)
})

test('neutral and unavailable production contexts never fabricate an adjustment', () => {
  const neutral = getContext({
    away: stats(15, 16),
    home: stats(16, 16),
  })
  const unavailable = matchupUtils.getSpecialTeamsContextForTeams({
    adjustment: 1,
    awayTeam: 'AAA',
    homeTeam: 'BBB',
    mode: 'automatic',
    specialTeams: null,
    threshold: 6,
  })

  assert.equal(neutral.away.signal, null)
  assert.equal(neutral.away.adjustment, 0)
  assert.equal(unavailable.away.status, 'unavailable')
  assert.equal(unavailable.away.ppRank, null)
  assert.equal(unavailable.away.opponentPkRank, null)
  assert.equal(unavailable.away.adjustment, 0)
})

test('applying the same Special Teams context replaces its field without accumulating', () => {
  const context = getContext({
    away: stats(3, 16),
    home: stats(16, 29),
  })
  const inputs = {
    away: { baseRating: 50, specialTeamsAdjustment: 8 },
    home: { baseRating: 50, specialTeamsAdjustment: 8 },
  }
  const first = matchupUtils.applySpecialTeamsContextToInputs(inputs, context)
  const second = matchupUtils.applySpecialTeamsContextToInputs(first, context)

  assert.equal(first.away.specialTeamsAdjustment, 0.5)
  assert.equal(second.away.specialTeamsAdjustment, 0.5)
  assert.deepEqual(second.away.specialTeamsContext, context.away)
})
