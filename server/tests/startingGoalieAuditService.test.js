process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  GOALIE_MATCH_STATUS,
  MAX_AUDIT_BET_IDS,
  buildBetStartingGoalieAudit,
  compareStartingGoalie,
  getBetsStartingGoalieAudits,
  parseAuditBetIds,
  resolveGameActualStartingGoalies,
} = require('../services/startingGoalieAuditService')

const USER_ID = '507f1f77bcf86cd799439011'
const OTHER_USER_ID = '507f191e810c19729de860ea'
const START = '2026-01-15T00:00:00.000Z'
const GAME_ID = '2025020001'
const betId = (suffix) => `507f1f77bcf86cd7994390${String(suffix).padStart(2, '0')}`
const selection = (id, side) => ({
  displayName: `${side} selected`,
  nhlPlayerId: id,
  selectionType: 'provider_goalie',
  sourceType: 'MANUAL',
  teamId: side === 'away' ? 'COL' : 'BOS',
})
const makeBet = (suffix, overrides = {}) => ({
  _id: betId(suffix),
  awayTeam: { abbreviation: 'COL', teamId: 'COL' },
  gameId: GAME_ID,
  homeTeam: { abbreviation: 'BOS', teamId: 'BOS' },
  scheduledStart: new Date(START),
  startingGoaliesAtBet: { away: selection(2, 'away'), home: selection(3, 'home') },
  userId: USER_ID,
  ...overrides,
})
const makeGame = (overrides = {}) => ({
  actualStartingGoalies: {
    away: { name: 'Away actual', playerId: 2, teamId: 'COL' },
    home: { name: 'Home actual', playerId: 4, teamId: 'BOS' },
  },
  awayTeam: { abbreviation: 'COL' },
  gameId: GAME_ID,
  gameState: 'FINAL',
  gameType: 2,
  homeTeam: { abbreviation: 'BOS' },
  season: '20252026',
  startTimeUTC: START,
  status: 'Final',
  ...overrides,
})
const makeModel = (bets, calls = []) => ({
  async find(query) {
    calls.push(query)
    return bets.filter((bet) =>
      query._id.$in.includes(String(bet._id)) && bet.userId === query.userId)
  },
})
const runBatch = (bets, options = {}) => getBetsStartingGoalieAudits(
  USER_ID,
  bets.map((bet) => String(bet._id)).join(','),
  { betModel: makeModel(bets), scheduleProvider: async () => ({ games: [makeGame()] }),
    gameProvider: async () => makeGame(), ...options },
)

test('canonical IDs compare only reliable provider selections', () => {
  assert.equal(compareStartingGoalie({ nhlPlayerId: '2' }, { playerId: 2 }), GOALIE_MATCH_STATUS.MATCH)
  assert.equal(compareStartingGoalie({ nhlPlayerId: 2 }, { playerId: 3 }), GOALIE_MATCH_STATUS.MISMATCH)
  for (const [selected, actual] of [
    [{}, { playerId: 2 }],
    [{ nhlPlayerId: 2 }, null],
    [{ nhlPlayerId: 'not an ID' }, { playerId: 2 }],
    [{ nhlPlayerId: 2, selectionType: 'custom' }, { playerId: 3 }],
  ]) {
    assert.equal(compareStartingGoalie(selected, actual), GOALIE_MATCH_STATUS.UNAVAILABLE)
  }
})

test('resolver accepts final exact identity, and fails closed for wrong teams or identity', async () => {
  const expectedIdentity = {
    awayTeamId: 'COL', gameId: GAME_ID, homeTeamId: 'BOS',
    scheduledStartAtCapture: new Date(START),
  }
  const resolve = (game) => resolveGameActualStartingGoalies({
    expectedIdentity, gameProvider: async () => game,
  })
  assert.equal((await resolve(makeGame())).home.playerId, 4)
  assert.equal((await resolve(makeGame({ gameType: 1 }))).home.playerId, 4)
  assert.equal((await resolve(makeGame({
    actualStartingGoalies: { away: null, home: null },
  }))).home, null)
  assert.equal((await resolve(makeGame({
    actualStartingGoalies: { away: null, home: null },
  }))).away, null)
  assert.equal((await resolve(makeGame({
    actualStartingGoalies: { away: { playerId: 2, teamId: 'BOS' }, home: null },
  }))).away, null)
  for (const game of [
    makeGame({ gameId: '2025020002' }),
    makeGame({ startTimeUTC: '2026-01-16T00:00:00.000Z' }),
    makeGame({ gameState: 'LIVE' }),
    makeGame({ gameScheduleState: 'PPD' }),
  ]) {
    const actual = await resolve(game)
    assert.equal(actual.verifiedGameIdentity, null)
    if (game.gameState === 'LIVE') {
      const audit = buildBetStartingGoalieAudit(makeBet(1), actual)
      assert.equal(audit.away.status, 'UNAVAILABLE')
      assert.equal(audit.home.status, 'UNAVAILABLE')
      assert.equal(audit.hasMismatch, false)
    }
  }
})

test('bet audit checks its frozen start and both team identities', async () => {
  const actual = await resolveGameActualStartingGoalies({
    expectedIdentity: {
      awayTeamId: 'COL', gameId: GAME_ID, homeTeamId: 'BOS',
      scheduledStartAtCapture: new Date(START),
    },
    gameProvider: async () => makeGame(),
  })
  const audit = buildBetStartingGoalieAudit(makeBet(1), actual)
  assert.equal(audit.away.status, 'MATCH')
  assert.equal(audit.home.status, 'MISMATCH')
  assert.equal(audit.hasMismatch, true)
  const rescheduled = buildBetStartingGoalieAudit(makeBet(1, {
    scheduledStart: '2026-01-14T00:00:00.000Z',
  }), actual)
  assert.equal(rescheduled.away.status, 'UNAVAILABLE')
  assert.equal(rescheduled.home.status, 'UNAVAILABLE')
  assert.equal(rescheduled.hasMismatch, false)
  assert.equal(buildBetStartingGoalieAudit(makeBet(1, {
    homeTeam: { teamId: 'NYR' },
  }), actual).away.status, 'UNAVAILABLE')
  assert.equal(buildBetStartingGoalieAudit(makeBet(1, {
    startingGoaliesAtBet: { away: { displayName: 'Other', selectionType: 'custom' } },
  }), actual).away.status, 'UNAVAILABLE')
})

test('batch is owner scoped, bounded, grouped by game, and isolates failures', async () => {
  const ownedA = makeBet(1)
  const ownedB = makeBet(2, { startingGoaliesAtBet: {
    away: selection(2, 'away'), home: selection(4, 'home'),
  } })
  const foreign = makeBet(3, { userId: OTHER_USER_ID })
  const otherGame = makeBet(4, { gameId: '2025020002' })
  const queryCalls = []
  const providerCalls = []
  const result = await getBetsStartingGoalieAudits(
    USER_ID,
    [ownedA, ownedB, foreign, otherGame].map((bet) => bet._id).join(','),
    {
      betModel: makeModel([ownedA, ownedB, foreign, otherGame], queryCalls),
      scheduleProvider: async () => ({ games: [makeGame(), makeGame({ gameId: '2025020002' })] }),
      gameProvider: async (gameId) => {
        providerCalls.push(gameId)
        if (gameId === '2025020002') throw new Error('NHL offline for one game')
        return makeGame()
      },
    },
  )
  assert.equal(queryCalls[0].userId, USER_ID)
  assert.equal(result.audits[foreign._id], null)
  assert.equal(result.audits[ownedA._id].hasMismatch, true)
  assert.equal(result.audits[ownedB._id].hasMismatch, false)
  assert.equal(result.audits[otherGame._id].hasMismatch, false)
  assert.equal(result.audits[otherGame._id].home.status, 'UNAVAILABLE')
  assert.deepEqual(providerCalls.sort(), [GAME_ID, '2025020002'].sort())
  assert.equal(parseAuditBetIds(`${ownedA._id},${ownedA._id}`).length, 1)
  assert.throws(() => parseAuditBetIds(Array.from({ length: MAX_AUDIT_BET_IDS + 1 },
    (_, index) => String(index)).join(',')), { statusCode: 400 })
  assert.throws(() => parseAuditBetIds(Array(MAX_AUDIT_BET_IDS + 1)
    .fill(ownedA._id).join(',')), { statusCode: 400 })
})

test('legacy, custom, nonfinal and demo bets never request a boxscore', async () => {
  const bets = [
    makeBet(1, { startingGoaliesAtBet: null, goalieSelectionSnapshot: { nhlPlayerId: 3 } }),
    makeBet(2, { startingGoaliesAtBet: { away: { selectionType: 'custom' } } }),
    makeBet(3),
  ]
  let providerCalls = 0
  const options = {
    gameProvider: async () => { providerCalls += 1; return makeGame() },
    scheduleProvider: async () => ({ games: [makeGame({ gameState: 'LIVE' })] }),
  }
  const result = await runBatch(bets, options)
  assert.equal(providerCalls, 0)
  assert.equal(result.audits[bets[0]._id], null)
  assert.equal(result.audits[bets[1]._id].hasMismatch, false)
  assert.equal(result.audits[bets[2]._id].home.status, 'UNAVAILABLE')
  let databaseCalls = 0
  const demo = await getBetsStartingGoalieAudits(USER_ID, bets[2]._id, {
    demo: true,
    betModel: { find: async () => { databaseCalls += 1; return bets } },
    gameProvider: options.gameProvider,
  })
  assert.equal(demo.audits[bets[2]._id], null)
  assert.equal(databaseCalls, 0)
  assert.equal(providerCalls, 0)
})
