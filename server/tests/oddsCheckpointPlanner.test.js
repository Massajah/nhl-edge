process.env.NODE_ENV = 'test'
const assert = require('node:assert/strict')
const test = require('node:test')
const { buildClosingWork, createOddsCheckpointPlanner, getPlanningScheduleDates } = require('../services/oddsCheckpointPlanner')
const { CLOSING_SAFETY_REASON } = require('../services/oddsClosingMarketContracts')

const START = '2026-10-08T19:00:00.000Z'
const GAME_ID = '2026020001'
const makeGame = (overrides = {}) => ({
  awayTeam: { abbreviation: 'MTL' }, gameId: GAME_ID, gameState: 'PRE',
  gameType: 2, homeTeam: { abbreviation: 'TOR' }, season: 20262027,
  startTimeUTC: START, status: 'Scheduled', ...overrides,
})
const requirement = (bookmakerKey = 'coolbet', betCreatedAt = Date.parse('2026-10-08T18:00:00Z')) => ({
  bookmakerKey, providerMarketKey: bookmakerKey === 'coolbet' ? 'h2h_ot' : 'h2h', betCreatedAt,
})
const safeClosing = (rows = []) => ({
  gameId: GAME_ID, homeTeamId: 'TOR', awayTeamId: 'MTL', scheduledStartAtCapture: new Date(START),
  latestSafeBookmakers: rows.map(({ bookmakerKey, providerMarketKey, observedAt }) => ({
    key: bookmakerKey, providerMarketKey,
    observedAt: new Date(observedAt ?? '2026-10-08T18:45:00Z'),
    providerCommenceTime: new Date(START), homeOdds: 2.05, awayOdds: 1.85,
    safetyReason: CLOSING_SAFETY_REASON,
  })),
})
const makePlanner = ({ games = [makeGame()], requirements = [requirement()], closing = null,
  policy = { allowed: true, mode: 'FULL', dailyAutomaticSuccessfulRequestCount: 0 } } = {}) => {
  const calls = []
  const planner = createOddsCheckpointPlanner({
    getAutomaticPolicy: async () => policy,
    getGamesForDate: async (date) => { calls.push(date); return { date, games } },
    requirementService: { async findForGames(candidateGames) {
      return new Map(candidateGames.map((game) => [game.gameId, requirements]))
    } },
    closingRepository: { async getByKey() { return closing } },
  })
  return { calls, planner }
}

test('planner reads adjacent schedule days but never schedules T24, T6 or T2 market work', async () => {
  for (const observedAt of ['2026-10-07T19:00:00Z', '2026-10-08T13:00:00Z', '2026-10-08T17:00:00Z']) {
    const harness = makePlanner()
    const plan = await harness.planner.planDueCheckpoints({ observedAt: new Date(observedAt) })
    assert.deepEqual(harness.calls, getPlanningScheduleDates(new Date(observedAt)))
    assert.equal(plan.groups.length, 0, observedAt)
  }
})

test('closing without an eligible bet schedules no provider work', async () => {
  const plan = await makePlanner({ requirements: [] }).planner.planDueCheckpoints({
    observedAt: new Date('2026-10-08T18:50:00Z'),
  })
  assert.equal(plan.groups.length, 0)
  assert.equal(plan.reasonCounts.no_eligible_bet, 1)
})

test('one saved Coolbet bet creates one primary at the first of two safe slots', async () => {
  for (const time of ['18:30', '18:35', '18:40']) {
    const plan = await makePlanner().planner.planDueCheckpoints({
      observedAt: new Date(`2026-10-08T${time}:00Z`),
    })
    assert.equal(plan.groups.length, 0, time)
  }
  const plan = await makePlanner().planner.planDueCheckpoints({
    observedAt: new Date('2026-10-08T18:45:01Z'),
  })
  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0][0].captureReason, 'CLOSING_PRIMARY')
  assert.deepEqual(plan.groups[0][0].selectedBookmakerKeys, ['coolbet'])
})

test('last safe-slot fallback occurs only for a missing compatible closing row', async () => {
  const observedAt = new Date('2026-10-08T18:50:00Z')
  const missing = await makePlanner().planner.planDueCheckpoints({ observedAt })
  assert.equal(missing.groups[0][0].captureReason, 'CLOSING_RETRY')
  const complete = await makePlanner({ closing: safeClosing([requirement()]) })
    .planner.planDueCheckpoints({ observedAt })
  assert.equal(complete.groups.length, 0)
  assert.equal(complete.reasonCounts.already_complete, 1)
})

test('a bet saved after primary needs fallback; other bookmakers and wrong markets do not satisfy it', async () => {
  const lateBet = requirement('coolbet', Date.parse('2026-10-08T18:47:00Z'))
  const observedAt = new Date('2026-10-08T18:50:00Z')
  const late = await makePlanner({ requirements: [lateBet], closing: safeClosing([requirement()]) })
    .planner.planDueCheckpoints({ observedAt })
  assert.equal(late.groups[0][0].captureReason, 'CLOSING_RETRY')
  const veikkaus = requirement('veikkaus_fi')
  const partial = await makePlanner({ requirements: [requirement(), veikkaus], closing: safeClosing([veikkaus]) })
    .planner.planDueCheckpoints({ observedAt })
  assert.deepEqual(partial.groups[0][0].selectedBookmakerKeys, ['coolbet'])
  const wrongMarket = await makePlanner({ requirements: [requirement()],
    closing: safeClosing([{ ...requirement(), providerMarketKey: 'h2h' }]) })
    .planner.planDueCheckpoints({ observedAt })
  assert.equal(wrongMarket.groups.length, 1)
})

test('no request after the safe cutoff or puck drop; finalization is separate', async () => {
  const late = await makePlanner().planner.planDueCheckpoints({ observedAt: new Date('2026-10-08T18:55:01Z') })
  assert.equal(late.groups.length, 0)
  assert.equal(late.finalizations.length, 1)
  const started = await makePlanner({ games: [makeGame({ gameState: 'LIVE' })] })
    .planner.planDueCheckpoints({ observedAt: new Date('2026-10-08T19:00:00Z') })
  assert.equal(started.groups.length, 0)
  assert.equal(started.finalizations.length, 1)
})

test('closing helper requires a bet and limits work to primary or fallback slots', () => {
  const game = makeGame()
  const requirements = new Map([[GAME_ID, [requirement()]]])
  assert.equal(buildClosingWork([game], new Date('2026-10-08T18:45:00Z')).checkpoints.length, 0)
  for (const time of ['18:45', '18:50']) {
    assert.equal(buildClosingWork([game], new Date(`2026-10-08T${time}:00Z`), requirements).checkpoints.length, 1)
  }
  for (const time of ['18:40', '18:55']) {
    assert.equal(buildClosingWork([game], new Date(`2026-10-08T${time}:00Z`), requirements).checkpoints.length, 0)
  }
})

test('unaligned starts use the two latest safe cron slots', () => {
  const game = makeGame({ startTimeUTC: '2026-10-08T19:03:00Z' })
  const requirements = new Map([[GAME_ID, [requirement()]]])
  const primary = buildClosingWork([game], new Date('2026-10-08T18:50:01Z'), requirements)
  const retry = buildClosingWork([game], new Date('2026-10-08T18:55:01Z'), requirements)
  assert.equal(primary.checkpoints[0].captureReason, 'CLOSING_PRIMARY')
  assert.equal(retry.checkpoints[0].captureReason, 'CLOSING_RETRY')
})
