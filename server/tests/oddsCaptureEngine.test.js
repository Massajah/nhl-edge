process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const OddsSnapshot = require('../models/OddsSnapshot')
const {
  createOddsCaptureEngine,
  normalizeQuotaForRun,
} = require('../services/oddsCaptureEngine')
const {
  createOddsCaptureRunService,
} = require('../services/oddsCaptureRunService')
const {
  createOddsSnapshotRepository,
  getSnapshotIdentity,
  prepareMongooseSnapshot,
} = require('../services/oddsSnapshotRepository')
const { createOddsCheckpoint } = require('../services/oddsSnapshotContracts')
const {
  buildClosingWorkKey,
} = require('../services/oddsClosingMarketContracts')
const {
  makeBookmakers,
} = require('./fixtures/oddsSnapshotFixtures')

const START = '2026-10-08T19:00:00.000Z'
const T2_CAPTURED_AT = '2026-10-08T17:00:00.000Z'
const FINAL_CAPTURED_AT = '2026-10-08T18:50:00.000Z'

const makeCheckpoint = (overrides = {}) => {
  const scheduledStart = overrides.scheduledStart ?? START
  const snapshotType = overrides.snapshotType ?? 'T2'

  return {
    awayTeamId: 'MTL',
    gameId: '2026020001',
    gameType: 2,
    homeTeamId: 'TOR',
    scheduledStart,
    seasonId: '20262027',
    snapshotType,
    ...createOddsCheckpoint({ scheduledStart, snapshotType }),
    ...overrides,
  }
}

const makeClosingGame = (overrides = {}) => {
  const scheduledStart = overrides.scheduledStart ?? START
  const gameId = overrides.gameId ?? '2026020001'

  return {
    awayTeamId: 'MTL',
    checkpointKey: buildClosingWorkKey({ gameId, scheduledStart }),
    gameId,
    gameType: 2,
    homeTeamId: 'TOR',
    scheduledStart,
    seasonId: '20262027',
    selectedBookmakerKeys: ['coolbet', 'pinnacle'],
    snapshotType: 'CLOSING',
    targetAt: new Date(Date.parse(scheduledStart) - 10 * 60 * 1000),
    ...overrides,
  }
}

const makeGame = ({
  awayTeamId = 'MTL',
  gameId = '2026020001',
  gameState = 'PRE',
  homeTeamId = 'TOR',
  scheduledStart = START,
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

const makeSafeBookmakers = (capturedAt, count = 9) =>
  makeBookmakers()
    .slice(0, count)
    .map((bookmaker, index) => ({
      ...bookmaker,
      lastUpdate: new Date(Date.parse(capturedAt) - (index + 1) * 60 * 1000),
    }))

const makeEvent = ({
  awayTeamId = 'MTL',
  bookmakers,
  capturedAt = T2_CAPTURED_AT,
  commenceTime = START,
  homeTeamId = 'TOR',
  providerEventId = 'provider-event-1',
} = {}) => ({
  awayTeamIdentity: awayTeamId,
  awayTeamName: awayTeamId,
  bookmakers: bookmakers ?? makeSafeBookmakers(capturedAt),
  commenceTime,
  homeTeamIdentity: homeTeamId,
  homeTeamName: homeTeamId,
  providerEventId,
  providerFetchedAt: capturedAt,
  sportKey: 'icehockey_nhl',
})

const makeProviderData = ({
  capturedAt = T2_CAPTURED_AT,
  events = [makeEvent({ capturedAt })],
  hasUsableData = true,
  requestAttempted = true,
  requestQuota,
  source = 'provider',
  status = 'ready',
} = {}) => ({
  events,
  hasUsableData,
  providerFetchedAt: capturedAt,
  quota: {
    lastCost: 1,
    observedAt: capturedAt,
    remaining: 98,
    used: 2,
  },
  requestAttempted,
  requestQuota:
    requestQuota === undefined
      ? requestAttempted
        ? { lastCost: 1, observedAt: capturedAt, remaining: 98, used: 2 }
        : null
      : requestQuota,
  source,
  status,
})

const createMemorySnapshotModel = () => {
  const documents = new Map()

  return {
    documents,
    find(query) {
      return {
        async lean() {
          const identities = new Set(
            query.$or.map((filter) =>
              [filter.gameId, filter.provider, filter.checkpointKey].join('|'),
            ),
          )

          return [...documents.entries()]
            .filter(([identity]) => identities.has(identity))
            .map(([, document]) => ({
              checkpointKey: document.checkpointKey,
              gameId: document.gameId,
              provider: document.provider,
            }))
        },
      }
    },
    async bulkWrite(operations, options) {
      assert.deepEqual(options, { ordered: false })
      let matchedCount = 0
      let upsertedCount = 0
      const upsertedIds = {}

      operations.forEach((operation, index) => {
        const { filter, update } = operation.updateOne
        const identity = [
          filter.gameId,
          filter.provider,
          filter.checkpointKey,
        ].join('|')

        if (documents.has(identity)) {
          matchedCount += 1
          return
        }

        documents.set(identity, structuredClone(update.$setOnInsert))
        upsertedCount += 1
        upsertedIds[index] = `snapshot-${index}`
      })

      return { matchedCount, modifiedCount: 0, upsertedCount, upsertedIds }
    },
  }
}

const createMemoryCaptureRunModel = () => {
  const documents = new Map()

  return {
    documents,
    async create(values) {
      if (documents.has(values.runKey)) {
        const error = new Error('duplicate runKey')
        error.code = 11000
        throw error
      }

      const document = structuredClone(values)
      documents.set(values.runKey, document)
      return structuredClone(document)
    },
    async findOne(filter) {
      const document = documents.get(filter.runKey)
      return document ? structuredClone(document) : null
    },
    async findOneAndUpdate(filter, update) {
      const document = documents.get(filter.runKey)

      if (!document || document.status !== filter.status) {
        return null
      }

      Object.assign(document, structuredClone(update.$set))
      return structuredClone(document)
    },
  }
}

const createClock = (values) => {
  const instants = (Array.isArray(values) ? values : [values]).map(
    (value) => new Date(value),
  )
  let index = 0

  return () => {
    const value = instants[Math.min(index, instants.length - 1)]
    index += 1
    return new Date(value)
  }
}

const createHarness = ({
  canSpendCredit = async () => ({ allowed: true }),
  closingRepository,
  games = [makeGame()],
  now = T2_CAPTURED_AT,
  providerData = makeProviderData(),
  recheckedGames,
} = {}) => {
  const snapshotModel = createMemorySnapshotModel()
  const captureRunModel = createMemoryCaptureRunModel()
  const snapshotRepository = createOddsSnapshotRepository({
    prepareCandidate: async (candidate) =>
      prepareMongooseSnapshot(OddsSnapshot, candidate),
    snapshotModel,
  })
  const captureRunService = createOddsCaptureRunService({
    captureRunModel,
    now: createClock(Array.isArray(now) ? now[now.length - 1] : now),
  })
  const calls = { provider: 0, schedule: 0, scheduleRecheck: 0 }
  const closingRecords = []
  const effectiveClosingRepository = closingRepository ?? {
    async finalizeClosingMarket() {
      return { status: 'NO_OBSERVATIONS' }
    },
    async recordObservation(candidate) {
      closingRecords.push(structuredClone(candidate))
      return { observationStored: true, status: 'CREATED' }
    },
  }
  const engine = createOddsCaptureEngine({
    canSpendCredit,
    captureRunService,
    closingRepository: effectiveClosingRepository,
    fetchOdds: async (request) => {
      calls.provider += 1
      calls.providerRequest = request
      return typeof providerData === 'function'
        ? providerData(request)
        : structuredClone(providerData)
    },
    getProviderStatus: () => ({
      quota: {
        lastCost: 1,
        observedAt: T2_CAPTURED_AT,
        remaining: 99,
        used: 1,
      },
    }),
    loadSchedule: async () => {
      calls.schedule += 1
      return { games: structuredClone(games) }
    },
    now: createClock(now),
    recheckFinalSchedule: async (gameIds) => {
      calls.scheduleRecheck += 1
      const source = recheckedGames ?? games
      return {
        games: structuredClone(
          source.filter((game) => gameIds.includes(String(game.gameId))),
        ),
      }
    },
    snapshotRepository,
  })

  return {
    calls,
    closingRecords,
    captureRunModel,
    engine,
    snapshotModel,
    snapshotRepository,
  }
}

const execute = (harness, checkpoints, intendedAt = T2_CAPTURED_AT) =>
  harness.engine.executeOddsCapture({
    checkpoints,
    intendedAt,
    triggerSource: 'TEST',
  })

test('happy path captures multiple checkpoints with one shared provider request', async () => {
  const secondCheckpoint = makeCheckpoint({
    awayTeamId: 'BUF',
    gameId: '2026020002',
    homeTeamId: 'BOS',
  })
  const games = [
    makeGame(),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
    }),
  ]
  const events = [
    makeEvent(),
    makeEvent({
      awayTeamId: 'BUF',
      homeTeamId: 'BOS',
      providerEventId: 'provider-event-2',
    }),
  ]
  const harness = createHarness({
    games,
    providerData: makeProviderData({ events }),
  })
  const result = await execute(harness, [makeCheckpoint(), secondCheckpoint])
  const snapshots = [...harness.snapshotModel.documents.values()]
  const run = [...harness.captureRunModel.documents.values()][0]

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.insertedCount, 2)
  assert.equal(result.providerRequestCount, 1)
  assert.equal(result.actualCreditCost, 1)
  assert.equal(harness.calls.provider, 1)
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots.every(({ schemaVersion }) => schemaVersion === 2), true)
  assert.equal(
    snapshots.every(({ selectedBookmakerKeys }) => selectedBookmakerKeys.length === 9),
    true,
  )
  assert.equal(snapshots.every(({ bookmakers }) => bookmakers.length === 9), true)
  assert.equal(
    snapshots.every(
      ({ capturedAt }) => capturedAt.toISOString() === T2_CAPTURED_AT,
    ),
    true,
  )
  assert.equal(
    new Set(snapshots.map(({ captureRunId }) => captureRunId)).size,
    1,
  )
  assert.equal(run.status, 'COMPLETED')
  assert.equal(run.providerRequestCount, 1)
  assert.equal(run.actualCreditCost, 1)
  assert.equal(run.eventsReceived, 2)
  assert.equal(run.gamesConsidered, 2)
  assert.equal(run.gamesMatched, 2)
  assert.equal(run.snapshotsStored, 2)
  assert.equal(run.gamesSkipped, 0)
  assert.equal(run.quotaBefore.remaining, 99)
  assert.equal(run.quotaAfter.remaining, 98)
})

test('one provider response satisfies compatible FINAL and later intermediate work', async () => {
  const capturedAt = '2026-10-08T18:40:00.000Z'
  const laterStart = '2026-10-08T19:55:00.000Z'
  const finalCheckpoint = makeCheckpoint({ snapshotType: 'FINAL' })
  const intermediateCheckpoint = makeCheckpoint({
    awayTeamId: 'BUF',
    gameId: '2026020002',
    homeTeamId: 'BOS',
    scheduledStart: laterStart,
    ...createOddsCheckpoint({
      scheduledStart: laterStart,
      snapshotType: 'T2',
    }),
  })
  const games = [
    makeGame(),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
      scheduledStart: laterStart,
    }),
  ]
  const harness = createHarness({
    games,
    now: capturedAt,
    providerData: makeProviderData({
      capturedAt,
      events: [
        makeEvent({ capturedAt }),
        makeEvent({
          awayTeamId: 'BUF',
          capturedAt,
          commenceTime: laterStart,
          homeTeamId: 'BOS',
          providerEventId: 'provider-event-2',
        }),
      ],
    }),
  })
  const result = await execute(
    harness,
    [finalCheckpoint, intermediateCheckpoint],
    capturedAt,
  )

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.insertedCount, 2)
  assert.equal(result.providerRequestCount, 1)
  assert.equal(harness.calls.scheduleRecheck, 1)
})

test('cached odds retain their original timestamp and stale cached odds are rejected', async () => {
  const cachedAt = '2026-10-08T18:40:00.000Z'
  const finalCheckpoint = makeCheckpoint({ snapshotType: 'FINAL' })
  const usable = createHarness({
    now: '2026-10-08T18:48:00.000Z',
    providerData: makeProviderData({
      capturedAt: cachedAt,
      events: [makeEvent({ capturedAt: cachedAt })],
      requestAttempted: false,
      source: 'cache',
      status: 'cached',
    }),
  })
  const usableResult = await execute(
    usable,
    [finalCheckpoint],
    '2026-10-08T18:48:00.000Z',
  )
  const stored = [...usable.snapshotModel.documents.values()][0]

  assert.equal(usableResult.insertedCount, 1)
  assert.equal(usableResult.providerRequestCount, 0)
  assert.equal(stored.capturedAt.toISOString(), cachedAt)

  const stale = createHarness({
    now: '2026-10-08T18:51:00.000Z',
    providerData: makeProviderData({
      capturedAt: cachedAt,
      events: [makeEvent({ capturedAt: cachedAt })],
      requestAttempted: false,
      source: 'cache',
      status: 'cached',
    }),
  })
  const staleResult = await execute(
    stale,
    [finalCheckpoint],
    '2026-10-08T18:51:00.000Z',
  )

  assert.equal(staleResult.insertedCount, 0)
  assert.equal(staleResult.reasonCounts.stale_provider_response, 1)
  assert.equal(stale.snapshotModel.documents.size, 0)
})

test('a successful response that consumes the last credit still persists its odds', async () => {
  const providerData = makeProviderData({ status: 'quota_exhausted' })
  providerData.quota.remaining = 0
  providerData.requestQuota.remaining = 0
  const harness = createHarness({ providerData })
  const result = await execute(harness, [makeCheckpoint()])

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.insertedCount, 1)
  assert.equal(result.actualCreditCost, 1)
  assert.equal(harness.snapshotModel.documents.size, 1)
})

test('structurally invalid work fails before schedule, provider or snapshot writes', async () => {
  const harness = createHarness()
  const result = await execute(harness, [
    makeCheckpoint(),
    makeCheckpoint({ gameId: 'invalid' }),
  ])

  assert.equal(result.status, 'FAILED')
  assert.equal(result.providerRequestCount, 0)
  assert.equal(harness.calls.schedule, 0)
  assert.equal(harness.calls.provider, 0)
  assert.equal(harness.snapshotModel.documents.size, 0)
  assert.equal(result.reasonCounts.invalid_game_id, 1)
})

test('no eligible work completes honestly without a provider request', async () => {
  const existing = makeCheckpoint()
  const outside = makeCheckpoint({
    awayTeamId: 'BUF',
    gameId: '2026020002',
    homeTeamId: 'BOS',
    scheduledStart: '2026-10-08T22:00:00.000Z',
    ...createOddsCheckpoint({
      scheduledStart: '2026-10-08T22:00:00.000Z',
      snapshotType: 'T2',
    }),
  })
  const started = makeCheckpoint({
    awayTeamId: 'CGY',
    gameId: '2026020003',
    homeTeamId: 'EDM',
  })
  const postponed = makeCheckpoint({
    awayTeamId: 'ANA',
    gameId: '2026020004',
    homeTeamId: 'LAK',
  })
  const harness = createHarness({
    games: [
      makeGame(),
      makeGame({
        awayTeamId: 'CGY',
        gameId: '2026020003',
        gameState: 'LIVE',
        homeTeamId: 'EDM',
        status: 'Live',
      }),
      makeGame({
        awayTeamId: 'ANA',
        gameId: '2026020004',
        homeTeamId: 'LAK',
        status: 'Postponed',
      }),
    ],
  })
  const existingSnapshot = {
    ...structuredClone(existing),
    provider: 'the-odds-api-v4',
  }
  harness.snapshotModel.documents.set(
    getSnapshotIdentity(existingSnapshot),
    existingSnapshot,
  )
  const result = await execute(harness, [
    existing,
    outside,
    started,
    postponed,
  ])

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.existingCount, 1)
  assert.equal(result.providerRequestCount, 0)
  assert.equal(harness.calls.provider, 0)
  assert.deepEqual(
    result.checkpointResults.map(({ reason, status }) => ({ reason, status })),
    [
      { reason: '', status: 'EXISTING' },
      { reason: 'outside_acceptance_window', status: 'SKIPPED' },
      { reason: 'game_started', status: 'SKIPPED' },
      { reason: 'postponed', status: 'SKIPPED' },
    ],
  )
})

test('strict matcher failures stay isolated while one valid game persists', async () => {
  const definitions = [
    ['2026020011', 'TOR', 'MTL'],
    ['2026020012', 'BOS', 'BUF'],
    ['2026020013', 'EDM', 'CGY'],
    ['2026020014', 'NYR', 'NYI'],
    ['2026020015', 'LAK', 'ANA'],
    ['2026020016', 'FLA', 'TBL'],
    ['2026020017', 'COL', 'DAL'],
  ]
  const checkpoints = definitions.map(([gameId, homeTeamId, awayTeamId]) =>
    makeCheckpoint({ awayTeamId, gameId, homeTeamId }),
  )
  const games = definitions.map(([gameId, homeTeamId, awayTeamId], index) =>
    makeGame({
      awayTeamId: index === 1 ? 'XXX' : awayTeamId,
      gameId,
      homeTeamId,
    }),
  )
  const events = [
    makeEvent({ providerEventId: 'valid' }),
    makeEvent({
      awayTeamId: 'CGY',
      commenceTime: new Date(Date.parse(START) + 60 * 60 * 1000 + 1).toISOString(),
      homeTeamId: 'EDM',
      providerEventId: 'late',
    }),
    makeEvent({ awayTeamId: 'NYI', homeTeamId: 'NYR', providerEventId: 'amb-a' }),
    makeEvent({ awayTeamId: 'NYI', homeTeamId: 'NYR', providerEventId: 'amb-b' }),
    makeEvent({ awayTeamId: 'LAK', homeTeamId: 'ANA', providerEventId: 'reversed' }),
    makeEvent({ awayTeamId: 'TBL', homeTeamId: 'FLA', providerEventId: 'duplicate' }),
    makeEvent({ awayTeamId: 'TBL', homeTeamId: 'FLA', providerEventId: 'duplicate' }),
  ]
  const harness = createHarness({
    games,
    providerData: makeProviderData({ events }),
  })
  const result = await execute(harness, checkpoints)
  const reasonsByGame = Object.fromEntries(
    result.checkpointResults.map(({ gameId, reason }) => [gameId, reason]),
  )

  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.insertedCount, 1)
  assert.equal(harness.calls.provider, 1)
  assert.equal(reasonsByGame['2026020012'], 'unknown_team')
  assert.equal(reasonsByGame['2026020013'], 'time_mismatch')
  assert.equal(reasonsByGame['2026020014'], 'ambiguous_match')
  assert.equal(reasonsByGame['2026020015'], 'reversed_teams')
  assert.equal(reasonsByGame['2026020016'], 'duplicate_provider_event')
  assert.equal(reasonsByGame['2026020017'], 'no_match')
})

test('FINAL boundaries are inclusive through exactly T-5m and reject later observations', async (t) => {
  for (const [capturedAt, expectedInserted] of [
    ['2026-10-08T18:30:00.000Z', 1],
    ['2026-10-08T18:50:00.000Z', 1],
    ['2026-10-08T18:55:00.000Z', 1],
    ['2026-10-08T18:55:01.000Z', 0],
    ['2026-10-08T19:00:00.000Z', 0],
  ]) {
    await t.test(capturedAt, async () => {
      const startedAt =
        capturedAt === '2026-10-08T18:55:01.000Z'
          ? '2026-10-08T18:55:00.000Z'
          : capturedAt
      const harness = createHarness({
        now: [startedAt, capturedAt, capturedAt],
        providerData: makeProviderData({
          capturedAt,
          events: [makeEvent({ capturedAt })],
        }),
      })
      const result = await execute(
        harness,
        [makeCheckpoint({ snapshotType: 'FINAL' })],
        startedAt,
      )

      assert.equal(result.insertedCount, expectedInserted)
      assert.equal(harness.snapshotModel.documents.size, expectedInserted)

      if (capturedAt === '2026-10-08T18:55:00.000Z') {
        assert.equal(result.status, 'COMPLETED')
      }

      if (capturedAt === '2026-10-08T18:55:01.000Z') {
        assert.equal(result.reasonCounts.outside_acceptance_window, 1)
      }

      if (capturedAt === '2026-10-08T19:00:00.000Z') {
        assert.equal(harness.calls.provider, 0)
      }
    })
  }
})

test('FINAL uses the earlier provider commence cutoff', async () => {
  const capturedAt = '2026-10-08T18:54:00.000Z'
  const harness = createHarness({
    now: capturedAt,
    providerData: makeProviderData({
      capturedAt,
      events: [
        makeEvent({
          capturedAt,
          commenceTime: '2026-10-08T18:58:00.000Z',
        }),
      ],
    }),
  })
  const result = await execute(
    harness,
    [makeCheckpoint({ snapshotType: 'FINAL' })],
    capturedAt,
  )

  assert.equal(result.insertedCount, 0)
  assert.equal(result.reasonCounts.final_leakage_cutoff, 1)
})

test('FINAL post-fetch state recheck skips an early start without blocking another game', async () => {
  const second = makeCheckpoint({
    awayTeamId: 'BUF',
    gameId: '2026020002',
    homeTeamId: 'BOS',
    snapshotType: 'FINAL',
  })
  const games = [
    makeGame(),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
    }),
  ]
  const recheckedGames = [
    makeGame({ gameState: 'LIVE', status: 'Live' }),
    games[1],
  ]
  const events = [
    makeEvent({ capturedAt: FINAL_CAPTURED_AT }),
    makeEvent({
      awayTeamId: 'BUF',
      capturedAt: FINAL_CAPTURED_AT,
      homeTeamId: 'BOS',
      providerEventId: 'provider-event-2',
    }),
  ]
  const harness = createHarness({
    games,
    now: FINAL_CAPTURED_AT,
    providerData: makeProviderData({
      capturedAt: FINAL_CAPTURED_AT,
      events,
    }),
    recheckedGames,
  })
  const result = await execute(
    harness,
    [makeCheckpoint({ snapshotType: 'FINAL' }), second],
    FINAL_CAPTURED_AT,
  )

  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.insertedCount, 1)
  assert.equal(result.reasonCounts.game_started, 1)
  assert.equal(harness.calls.scheduleRecheck, 1)
})

test('FINAL filters invalid bookmaker timestamps row by row and retains null timestamps', async () => {
  const rows = makeSafeBookmakers(FINAL_CAPTURED_AT, 4)
  rows[0].lastUpdate = new Date('2026-10-08T18:49:00.000Z')
  rows[1].lastUpdate = new Date('2026-10-08T18:51:00.000Z')
  rows[2].lastUpdate = new Date('2026-10-08T18:56:00.000Z')
  rows[3].lastUpdate = null
  const harness = createHarness({
    now: FINAL_CAPTURED_AT,
    providerData: makeProviderData({
      capturedAt: FINAL_CAPTURED_AT,
      events: [
        makeEvent({
          bookmakers: rows,
          capturedAt: FINAL_CAPTURED_AT,
        }),
      ],
    }),
  })
  const result = await execute(
    harness,
    [makeCheckpoint({ snapshotType: 'FINAL' })],
    FINAL_CAPTURED_AT,
  )
  const snapshot = [...harness.snapshotModel.documents.values()][0]

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.reasonCounts.bookmaker_rows_filtered, 1)
  assert.equal(snapshot.bookmakers.length, 2)
  assert.equal(snapshot.bookmakers[1].lastUpdate, null)
})

test('one mixed FINAL batch records stored, no-match, leakage and bookmaker filtering outcomes', async () => {
  const filteredRows = makeSafeBookmakers(FINAL_CAPTURED_AT, 2)
  filteredRows[1].lastUpdate = new Date('2026-10-08T18:51:00.000Z')
  const checkpoints = [
    makeCheckpoint({ snapshotType: 'FINAL' }),
    makeCheckpoint({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
      snapshotType: 'FINAL',
    }),
    makeCheckpoint({
      awayTeamId: 'CGY',
      gameId: '2026020003',
      homeTeamId: 'EDM',
      snapshotType: 'FINAL',
    }),
  ]
  const games = [
    makeGame(),
    makeGame({
      awayTeamId: 'BUF',
      gameId: '2026020002',
      homeTeamId: 'BOS',
    }),
    makeGame({
      awayTeamId: 'CGY',
      gameId: '2026020003',
      homeTeamId: 'EDM',
    }),
  ]
  const events = [
    makeEvent({
      bookmakers: filteredRows,
      capturedAt: FINAL_CAPTURED_AT,
    }),
    makeEvent({
      awayTeamId: 'CGY',
      capturedAt: FINAL_CAPTURED_AT,
      commenceTime: '2026-10-08T18:54:00.000Z',
      homeTeamId: 'EDM',
      providerEventId: 'provider-event-3',
    }),
  ]
  const harness = createHarness({
    games,
    now: FINAL_CAPTURED_AT,
    providerData: makeProviderData({
      capturedAt: FINAL_CAPTURED_AT,
      events,
    }),
  })
  const result = await execute(
    harness,
    checkpoints,
    FINAL_CAPTURED_AT,
  )

  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.insertedCount, 1)
  assert.equal(result.reasonCounts.bookmaker_rows_filtered, 1)
  assert.equal(result.reasonCounts.no_match, 1)
  assert.equal(result.reasonCounts.final_leakage_cutoff, 1)
  assert.equal(result.checkpointResults.length, 3)
})

test('non-FINAL snapshots reject future bookmaker updates without applying FINAL cutoff', async () => {
  const rows = makeSafeBookmakers(T2_CAPTURED_AT, 2)
  rows[0].lastUpdate = new Date('2026-10-08T17:00:01.000Z')
  rows[1].lastUpdate = new Date('2026-10-08T16:59:00.000Z')
  const harness = createHarness({
    providerData: makeProviderData({
      events: [makeEvent({ bookmakers: rows })],
    }),
  })
  const result = await execute(harness, [makeCheckpoint()])
  const snapshot = [...harness.snapshotModel.documents.values()][0]

  assert.equal(result.insertedCount, 1)
  assert.equal(snapshot.bookmakers.length, 1)
})

test('snapshot preserves allowed NHL/provider commence drift without normalization', async () => {
  const providerCommenceTime = '2026-10-08T19:30:00.000Z'
  const harness = createHarness({
    providerData: makeProviderData({
      events: [makeEvent({ commenceTime: providerCommenceTime })],
    }),
  })
  const result = await execute(harness, [makeCheckpoint()])
  const snapshot = [...harness.snapshotModel.documents.values()][0]

  assert.equal(result.insertedCount, 1)
  assert.equal(snapshot.scheduledStartAtCapture.toISOString(), START)
  assert.equal(snapshot.providerCommenceTime.toISOString(), providerCommenceTime)
})

test('checkpoint is skipped when every bookmaker row is unusable', async () => {
  const rows = makeSafeBookmakers(T2_CAPTURED_AT, 2).map((row) => ({
    ...row,
    lastUpdate: new Date('2026-10-08T17:00:01.000Z'),
  }))
  const harness = createHarness({
    providerData: makeProviderData({
      events: [makeEvent({ bookmakers: rows })],
    }),
  })
  const result = await execute(harness, [makeCheckpoint()])

  assert.equal(result.insertedCount, 0)
  assert.equal(result.reasonCounts.no_usable_bookmakers, 1)
  assert.equal(harness.snapshotModel.documents.size, 0)
})

test('rescheduled checkpoint work is skipped before the provider fetch', async () => {
  const harness = createHarness({
    games: [makeGame({ scheduledStart: '2026-10-08T21:00:00.000Z' })],
  })
  const result = await execute(harness, [makeCheckpoint()])

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.reasonCounts.rescheduled, 1)
  assert.equal(harness.calls.provider, 0)
  assert.equal(harness.snapshotModel.documents.size, 0)
})

test('idempotent retries distinguish inserted, existing and exact reused runs', async () => {
  const harness = createHarness()
  const checkpoint = makeCheckpoint()
  const first = await execute(harness, [checkpoint], T2_CAPTURED_AT)
  const retry = await execute(
    harness,
    [checkpoint],
    '2026-10-08T17:01:00.000Z',
  )
  const exactRetry = await execute(
    harness,
    [checkpoint],
    '2026-10-08T17:01:00.000Z',
  )
  const normalizedExactRetry = await execute(
    harness,
    [
      {
        ...checkpoint,
        awayTeamId: 'mtl',
        homeTeamId: 'tor',
        scheduledStart: new Date(checkpoint.scheduledStart),
        targetAt: new Date(checkpoint.targetAt),
      },
    ],
    T2_CAPTURED_AT,
  )

  assert.equal(first.insertedCount, 1)
  assert.equal(retry.insertedCount, 0)
  assert.equal(retry.existingCount, 1)
  assert.notEqual(first.runKey, retry.runKey)
  assert.equal(exactRetry.reusedRun, true)
  assert.equal(exactRetry.runKey, retry.runKey)
  assert.equal(normalizedExactRetry.reusedRun, true)
  assert.equal(normalizedExactRetry.runKey, first.runKey)
  assert.equal(harness.snapshotModel.documents.size, 1)
  assert.equal(harness.captureRunModel.documents.size, 2)
  assert.equal(harness.calls.provider, 1)
})

test('normalized provider failures never fabricate snapshots or leak details', async (t) => {
  const failures = [
    ['not configured', 'not_configured', false, 'FAILED'],
    ['authentication', 'authentication_failed', true, 'FAILED'],
    ['quota', 'quota_exhausted', true, 'QUOTA_BLOCKED'],
    ['rate limit', 'rate_limited', true, 'FAILED'],
    ['timeout', 'unavailable', true, 'FAILED'],
    ['5xx', 'unavailable', true, 'FAILED'],
    ['malformed', 'invalid_response', true, 'FAILED'],
    ['empty events', 'no_events', true, 'FAILED'],
  ]

  for (const [name, status, requestAttempted, expectedStatus] of failures) {
    await t.test(name, async () => {
      const harness = createHarness({
        providerData: makeProviderData({
          events: [],
          hasUsableData: false,
          requestAttempted,
          requestQuota: null,
          status,
        }),
      })
      const result = await execute(harness, [makeCheckpoint()])

      assert.equal(result.status, expectedStatus)
      assert.equal(result.providerRequestCount, requestAttempted ? 1 : 0)
      assert.equal(result.actualCreditCost, requestAttempted ? null : 0)
      assert.equal(result.insertedCount, 0)
      assert.equal(harness.snapshotModel.documents.size, 0)
      assert.equal(JSON.stringify(result).includes('test-key'), false)
    })
  }
})

test('injected quota block records zero requests, cost and snapshots', async () => {
  const harness = createHarness({
    canSpendCredit: async () => ({
      allowed: false,
      reason: 'quota_blocked',
    }),
  })
  const result = await execute(harness, [makeCheckpoint()])

  assert.equal(result.status, 'QUOTA_BLOCKED')
  assert.equal(result.providerRequestCount, 0)
  assert.equal(result.actualCreditCost, 0)
  assert.equal(result.insertedCount, 0)
  assert.equal(result.reasonCounts.quota_blocked, 1)
  assert.equal(harness.calls.provider, 0)
})

test('quota normalization never fabricates zero values or epoch timestamps', () => {
  assert.equal(
    normalizeQuotaForRun({
      lastCost: null,
      observedAt: null,
      remaining: null,
      used: null,
    }),
    null,
  )
})

test('CLOSING work records safe selected-bookmaker observations instead of legacy FINAL snapshots', async () => {
  const rows = makeSafeBookmakers(FINAL_CAPTURED_AT).filter(({ key }) =>
    ['coolbet', 'pinnacle'].includes(key),
  )
  rows.find(({ key }) => key === 'coolbet').lastUpdate = null
  const harness = createHarness({
    now: FINAL_CAPTURED_AT,
    providerData: makeProviderData({
      capturedAt: FINAL_CAPTURED_AT,
      events: [
        makeEvent({
          bookmakers: rows,
          capturedAt: FINAL_CAPTURED_AT,
        }),
      ],
    }),
  })
  const result = await harness.engine.executeOddsCapture({
    checkpoints: [],
    closingGames: [makeClosingGame()],
    intendedAt: FINAL_CAPTURED_AT,
    triggerSource: 'TEST',
  })

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.insertedCount, 1)
  assert.equal(harness.snapshotModel.documents.size, 0)
  assert.equal(harness.closingRecords.length, 1)
  assert.deepEqual(
    harness.closingRecords[0].bookmakers.map(({ key }) => key).sort(),
    ['coolbet', 'pinnacle'],
  )
  assert.equal(
    harness.calls.providerRequest.bookmakerKeys.includes('veikkaus_fi'),
    false,
  )
})

test('CLOSING work is rejected when the NHL post-fetch recheck reports LIVE', async () => {
  const harness = createHarness({
    now: FINAL_CAPTURED_AT,
    providerData: makeProviderData({
      capturedAt: FINAL_CAPTURED_AT,
      events: [makeEvent({ capturedAt: FINAL_CAPTURED_AT })],
    }),
    recheckedGames: [makeGame({ gameState: 'LIVE', status: 'Live' })],
  })
  const result = await harness.engine.executeOddsCapture({
    closingGames: [makeClosingGame()],
    intendedAt: FINAL_CAPTURED_AT,
    triggerSource: 'TEST',
  })

  assert.equal(result.insertedCount, 0)
  assert.equal(result.reasonCounts.game_started, 1)
  assert.equal(harness.closingRecords.length, 0)
})

test('CLOSING provider commence cutoff prevents live-leakage candidates', async () => {
  const harness = createHarness({
    now: '2026-10-08T18:54:00.000Z',
    providerData: makeProviderData({
      capturedAt: '2026-10-08T18:54:00.000Z',
      events: [
        makeEvent({
          capturedAt: '2026-10-08T18:54:00.000Z',
          commenceTime: '2026-10-08T18:58:00.000Z',
        }),
      ],
    }),
  })
  const result = await harness.engine.executeOddsCapture({
    closingGames: [makeClosingGame()],
    intendedAt: '2026-10-08T18:54:00.000Z',
    triggerSource: 'TEST',
  })

  assert.equal(result.insertedCount, 0)
  assert.equal(result.reasonCounts.final_leakage_cutoff, 1)
  assert.equal(harness.closingRecords.length, 0)
})

test('one closing finalization failure does not block other games', async () => {
  const calls = []
  const harness = createHarness({
    closingRepository: {
      async finalizeClosingMarket({ gameId }) {
        calls.push(gameId)
        if (gameId === '2026020001') throw new Error('isolated write failure')
        return { status: 'FINALIZED' }
      },
      async recordObservation() {
        throw new Error('not used')
      },
    },
  })
  const result = await harness.engine.finalizeClosingMarkets({
    games: [
      {
        finalizationReason: 'CLOSING_WINDOW_ENDED',
        gameId: '2026020001',
        scheduledStart: START,
      },
      {
        finalizationReason: 'CLOSING_WINDOW_ENDED',
        gameId: '2026020002',
        scheduledStart: START,
      },
    ],
    observedAt: FINAL_CAPTURED_AT,
    selectedBookmakerKeys: ['coolbet'],
  })

  assert.deepEqual(calls, ['2026020001', '2026020002'])
  assert.equal(result.failedCount, 1)
  assert.equal(result.finalizedCount, 1)
})
