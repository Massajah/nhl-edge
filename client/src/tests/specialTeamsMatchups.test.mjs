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
