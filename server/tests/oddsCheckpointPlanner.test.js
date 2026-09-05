process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  buildDueCheckpoints,
  createOddsCheckpointPlanner,
  getPlanningScheduleDates,
} = require('../services/oddsCheckpointPlanner')
const { getCheckpointIdentity } = require('../services/oddsCaptureContracts')
const { createOddsCheckpoint } = require('../services/oddsSnapshotContracts')

const NOW = new Date('2026-10-08T18:40:00.000Z')

const makeGame = ({
  awayTeamId = 'MTL',
  gameId = '2026020001',
  gameState = 'PRE',
  homeTeamId = 'TOR',
  scheduledStart = '2026-10-08T20:40:00.000Z',
  status = 'Scheduled',
} = {}) => ({
  awayTeam: { abbreviation: awayTeamId, name: awayTeamId },
  gameId,
  gameState,
  gameType: 2,
  homeTeam: { abbreviation: homeTeamId, name: homeTeamId },
  season: 20262027,
  startTimeUTC: scheduledStart,
  status,
})

const makePolicy = (overrides = {}) => ({
  allowed: true,
  dailyAutomaticSuccessfulRequestCount: 0,
  mode: 'FULL',
  reason: '',
  requestSource: 'AUTOMATIC',
  ...overrides,
})

const makePlanner = ({
  existing = new Set(),
  games = [],
  policy = makePolicy(),
  scheduleProvider,
} = {}) => {
  const calls = []
  const planner = createOddsCheckpointPlanner({
    getAutomaticPolicy: async () => policy,
    getGamesForDate: async (date) => {
      calls.push(date)

      return scheduleProvider
        ? scheduleProvider(date)
        : { date, games: structuredClone(games) }
    },
    snapshotRepository: {
      async findExistingCheckpoints(checkpoints) {
        return new Set(
          checkpoints
            .map(getCheckpointIdentity)
            .filter((identity) => existing.has(identity)),
        )
      },
    },
  })

  return { calls, planner }
}

test('planner loads the UTC day plus adjacent dates and makes no provider request for no games', async () => {
  const harness = makePlanner()
  const plan = await harness.planner.planDueCheckpoints({ observedAt: NOW })

  assert.deepEqual(harness.calls, [
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
  ])
  assert.deepEqual(harness.calls, getPlanningScheduleDates(NOW))
  assert.equal(plan.status, 'NO_DUE_WORK')
  assert.equal(plan.groups.length, 0)
  assert.equal(plan.reasonCounts.no_games, 1)
})

test('every checkpoint planning window is inclusive at its exact boundaries', () => {
  const start = new Date('2026-10-10T20:00:00.000Z')
  const game = makeGame({ scheduledStart: start.toISOString() })

  for (const [snapshotType, window] of Object.entries(
    CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  )) {
    for (const distance of [
      window.maximumBeforeStartMs,
      window.minimumBeforeStartMs,
    ]) {
      const observedAt = new Date(start.getTime() - distance)
      const due = buildDueCheckpoints([game], observedAt).checkpoints

      assert.equal(
        due.some((checkpoint) => checkpoint.snapshotType === snapshotType),
        true,
        `${snapshotType} at ${observedAt.toISOString()}`,
      )
    }
  }
})

test('already persisted work is skipped while a rescheduled start creates a new key', async () => {
  const oldStart = '2026-10-08T20:30:00.000Z'
  const newStart = '2026-10-08T20:40:00.000Z'
  const oldCheckpoint = {
    gameId: '2026020001',
    provider: 'the-odds-api-v4',
    ...createOddsCheckpoint({ scheduledStart: oldStart, snapshotType: 'T2' }),
  }
  const existing = new Set([getCheckpointIdentity(oldCheckpoint)])
  const harness = makePlanner({ existing, games: [makeGame({ scheduledStart: newStart })] })
  const plan = await harness.planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.dueCheckpointCount, 1)
  assert.equal(plan.groups[0][0].checkpointKey, `T2:${Date.parse(newStart)}`)

  existing.add(getCheckpointIdentity(plan.groups[0][0]))
  const retry = await harness.planner.planDueCheckpoints({ observedAt: NOW })
  assert.equal(retry.groups.length, 0)
  assert.equal(retry.reasonCounts.already_persisted, 1)
})

test('live, final, postponed and missed checkpoints are never backfilled', async () => {
  const games = [
    makeGame({ gameId: '2026020001', gameState: 'LIVE', status: 'Live' }),
    makeGame({ gameId: '2026020002', gameState: 'FINAL', status: 'Final' }),
    makeGame({ gameId: '2026020003', gameState: 'PPD', status: 'Postponed' }),
    makeGame({ gameId: '2026020005', gameState: 'UNKNOWN' }),
    makeGame({
      gameId: '2026020004',
      scheduledStart: '2026-10-08T21:40:00.000Z',
    }),
  ]
  const plan = await makePlanner({ games }).planner.planDueCheckpoints({
    observedAt: NOW,
  })

  assert.equal(plan.groups.length, 0)
  assert.equal(plan.reasonCounts.game_started, 2)
  assert.equal(plan.reasonCounts.postponed, 1)
  assert.equal(plan.reasonCounts.invalid_game_state, 1)
  assert.equal(plan.reasonCounts.no_due_checkpoints, 1)
})

test('FINAL clusters lead, include compatible intermediate work and minimize calls', async () => {
  const games = [
    makeGame({ gameId: '2026020001', scheduledStart: '2026-10-08T19:00:00.000Z' }),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
      scheduledStart: '2026-10-08T19:10:00.000Z',
    }),
    makeGame({
      awayTeamId: 'CGY',
      gameId: '2026020003',
      homeTeamId: 'EDM',
      scheduledStart: '2026-10-08T19:55:00.000Z',
    }),
    makeGame({
      awayTeamId: 'DAL',
      gameId: '2026020004',
      homeTeamId: 'COL',
      scheduledStart: '2026-10-09T00:40:00.000Z',
    }),
  ]
  const plan = await makePlanner({ games }).planner.planDueCheckpoints({
    observedAt: NOW,
  })

  assert.equal(plan.groups.length, 2)
  assert.deepEqual(
    plan.groups[0].map(({ snapshotType }) => snapshotType),
    ['FINAL', 'FINAL', 'T2'],
  )
  assert.deepEqual(
    plan.groups[1].map(({ snapshotType }) => snapshotType),
    ['T6'],
  )
})

test('remaining-credit and soft-target policy suppress intermediate checkpoints', async () => {
  const games = [
    makeGame({ gameId: '2026020001', scheduledStart: '2026-10-08T19:00:00.000Z' }),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
      scheduledStart: '2026-10-08T20:40:00.000Z',
    }),
  ]
  const plan = await makePlanner({
    games,
    policy: makePolicy({ mode: 'FINAL_ONLY' }),
  }).planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.dueCheckpointCount, 1)
  assert.equal(plan.groups[0][0].snapshotType, 'FINAL')
  assert.equal(plan.reasonCounts.policy_intermediate_suppressed, 1)
})

test('unknown quota allows only the highest-priority due request group', async () => {
  const games = [
    makeGame({ gameId: '2026020001', scheduledStart: '2026-10-08T19:00:00.000Z' }),
    makeGame({
      awayTeamId: 'DAL',
      gameId: '2026020004',
      homeTeamId: 'COL',
      scheduledStart: '2026-10-09T00:40:00.000Z',
    }),
  ]
  const plan = await makePlanner({
    games,
    policy: makePolicy({ mode: 'CONTROLLED_PROBE', requestSource: 'CONTROLLED_PROBE' }),
  }).planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0][0].snapshotType, 'FINAL')
  assert.equal(plan.reasonCounts.deferred_by_request_budget, 1)
})

test('a fully disabled quota policy avoids even schedule discovery', async () => {
  const harness = makePlanner({
    policy: makePolicy({
      allowed: false,
      mode: 'DISABLED',
      reason: 'automatic_remaining_floor',
    }),
  })
  const plan = await harness.planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.status, 'BLOCKED')
  assert.equal(harness.calls.length, 0)
  assert.equal(plan.reasonCounts.automatic_remaining_floor, 1)
})
