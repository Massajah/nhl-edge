process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  LONG_TERM_RETRY_INTERVALS_MS,
  LONG_TERM_SNAPSHOT_TYPES,
  buildClosingWork,
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
  selectedBookmakerKeys = ['coolbet', 'pinnacle'],
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
    getSelectedBookmakerKeys: async () => selectedBookmakerKeys,
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

test('empty participating bookmaker union schedules no provider capture', async () => {
  const plan = await makePlanner({
    games: [makeGame()],
    selectedBookmakerKeys: [],
  }).planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.status, 'NO_DUE_WORK')
  assert.equal(plan.groups.length, 0)
  assert.equal(plan.dueCheckpointCount, 0)
  assert.equal(plan.reasonCounts.no_participating_bookmakers, 1)
})

test('every checkpoint planning window is inclusive at its exact boundaries', () => {
  const start = new Date('2026-10-10T20:00:00.000Z')
  const game = makeGame({ scheduledStart: start.toISOString() })

  for (const snapshotType of LONG_TERM_SNAPSHOT_TYPES) {
    const window = CHECKPOINT_ACCEPTANCE_WINDOWS_MS[snapshotType]
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

test('CLOSING work leads, includes compatible intermediate work and minimizes calls', async () => {
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
    ['CLOSING', 'CLOSING', 'T2'],
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
  assert.equal(plan.groups[0][0].snapshotType, 'CLOSING')
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
  assert.equal(plan.groups[0][0].snapshotType, 'CLOSING')
  assert.equal(plan.reasonCounts.deferred_by_request_budget, 1)
})

test('a fully disabled quota policy still discovers schedule for quota-free finalization', async () => {
  const harness = makePlanner({
    policy: makePolicy({
      allowed: false,
      mode: 'DISABLED',
      reason: 'automatic_remaining_floor',
    }),
  })
  const plan = await harness.planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.status, 'BLOCKED')
  assert.equal(harness.calls.length, 4)
  assert.equal(plan.reasonCounts.automatic_remaining_floor, 1)
})

test('long-term checkpoints begin at their nominal targets and retain late retry tolerance', () => {
  const start = new Date('2026-10-10T20:00:00.000Z')
  const game = makeGame({ scheduledStart: start.toISOString() })
  const offsets = { T24: 24 * 60, T6: 6 * 60, T2: 2 * 60 }

  Object.entries(offsets).forEach(([snapshotType, minutes]) => {
    const beforeTarget = new Date(start.getTime() - (minutes + 5) * 60 * 1000)
    const atTarget = new Date(start.getTime() - minutes * 60 * 1000)
    const retry = new Date(
      start.getTime() -
        minutes * 60 * 1000 +
        LONG_TERM_RETRY_INTERVALS_MS[snapshotType],
    )
    const nonRetryTick = new Date(
      start.getTime() - (minutes - 5) * 60 * 1000,
    )

    assert.equal(
      buildDueCheckpoints([game], beforeTarget).checkpoints.some(
        (work) => work.snapshotType === snapshotType,
      ),
      false,
    )
    assert.equal(
      buildDueCheckpoints([game], atTarget).checkpoints.some(
        (work) => work.snapshotType === snapshotType,
      ),
      true,
    )
    assert.equal(
      buildDueCheckpoints([game], retry).checkpoints.some(
        (work) => work.snapshotType === snapshotType,
      ),
      true,
    )
    assert.equal(
      buildDueCheckpoints([game], nonRetryTick).checkpoints.some(
        (work) => work.snapshotType === snapshotType,
      ),
      false,
    )
  })
})

test('closing observations are due on every eligible cron and finalization is quota-free', async () => {
  const game = makeGame({ scheduledStart: '2026-10-08T19:00:00.000Z' })

  for (const observedAt of [
    '2026-10-08T18:30:00.000Z',
    '2026-10-08T18:35:00.000Z',
    '2026-10-08T18:50:00.000Z',
  ]) {
    assert.equal(buildClosingWork([game], observedAt, ['coolbet']).checkpoints.length, 1)
  }
  assert.equal(
    buildClosingWork([game], '2026-10-08T19:00:00.000Z', ['coolbet'])
      .checkpoints.length,
    0,
  )

  const finalTick = await makePlanner({ games: [game] }).planner.planDueCheckpoints({
    observedAt: new Date('2026-10-08T18:55:01.000Z'),
  })

  assert.equal(finalTick.groups.length, 0)
  assert.equal(finalTick.finalizations.length, 1)
  assert.equal(finalTick.status, 'FINALIZE_ONLY')
})

test('an early NHL LIVE state blocks closing fetch work but schedules durable finalization', async () => {
  const game = makeGame({
    gameState: 'LIVE',
    scheduledStart: '2026-10-08T19:00:00.000Z',
    status: 'Live',
  })
  const plan = await makePlanner({ games: [game] }).planner.planDueCheckpoints({
    observedAt: new Date('2026-10-08T18:40:00.000Z'),
  })

  assert.equal(plan.groups.length, 0)
  assert.equal(plan.finalizations.length, 1)
  assert.equal(plan.finalizations[0].finalizationReason, 'GAME_STARTED')
})

test('closing finalization retries expire after the durable grace window', async () => {
  const game = makeGame({
    gameState: 'FINAL',
    scheduledStart: '2026-10-07T05:00:00.000Z',
    status: 'Final',
  })
  const plan = await makePlanner({ games: [game] }).planner.planDueCheckpoints({
    observedAt: NOW,
  })

  assert.equal(plan.finalizations.length, 0)
})

test('invalid pregame NHL state cannot trigger closing finalization', async () => {
  const game = makeGame({
    gameState: 'UNKNOWN',
    scheduledStart: '2026-10-08T18:45:00.000Z',
  })
  const plan = await makePlanner({ games: [game] }).planner.planDueCheckpoints({
    observedAt: NOW,
  })

  assert.equal(plan.finalizations.length, 0)
})

test('daily full-cadence limit preserves closing work for later games', async () => {
  const game = makeGame({ scheduledStart: '2026-10-08T19:00:00.000Z' })
  const plan = await makePlanner({
    games: [game],
    policy: makePolicy({
      dailyAutomaticSuccessfulRequestCount: 24,
      mode: 'FINAL_ONLY',
    }),
  }).planner.planDueCheckpoints({ observedAt: NOW })

  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0][0].snapshotType, 'CLOSING')
})
