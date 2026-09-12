process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CAPTURE_HEALTH_STATUSES,
  calculateCaptureHealth,
  loadCaptureHealth,
  normalizeScheduleCohort,
  scheduleQueryBounds,
} = require('../services/modelPerformanceCaptureHealthService')

const SEASON_ID = '20262027'
const START = new Date('2026-10-08T19:00:00.000Z')
const normalized = {
  endExclusive: new Date('2026-11-01T00:00:00.000Z'),
  season: { id: SEASON_ID },
  start: new Date('2026-10-01T00:00:00.000Z'),
}
const game = (overrides = {}) => ({
  awayTeam: { abbreviation: 'COL' },
  gameId: '2026020001',
  gameState: 'FUT',
  gameType: 2,
  homeTeam: { abbreviation: 'BOS' },
  season: SEASON_ID,
  startTimeUTC: START,
  status: 'Scheduled',
  ...overrides,
})
const identity = (overrides = {}) => ({
  awayTeamId: 'COL',
  gameId: '2026020001',
  gameType: 2,
  homeTeamId: 'BOS',
  scheduledStartAtCapture: START,
  seasonId: SEASON_ID,
  ...overrides,
})
const prediction = (overrides = {}) => ({
  ...identity(),
  generatedAt: new Date(START.getTime() - 90 * 60 * 1000),
  ...overrides,
})
const snapshot = (snapshotType, minutesBeforeStart, overrides = {}) => ({
  ...identity(),
  capturedAt: new Date(START.getTime() - minutesBeforeStart * 60 * 1000),
  snapshotType,
  ...overrides,
})
const closing = (overrides = {}) => ({
  ...identity(),
  finalBookmakers: [{ awayOdds: 1.9, homeOdds: 2.1, key: 'pinnacle' }],
  finalizedAt: new Date(START.getTime() - 4 * 60 * 1000),
  ...overrides,
})
const calculate = (overrides = {}) =>
  calculateCaptureHealth({
    closingMarkets: [],
    normalized,
    observedAt: new Date(START.getTime() - 74 * 60 * 1000),
    predictions: [],
    scheduleGames: [game()],
    snapshots: [],
    ...overrides,
  })

test('future Official T2 window is not expected or missed', () => {
  const result = calculate({
    observedAt: new Date(START.getTime() - 121 * 60 * 1000),
  })

  assert.equal(result.officialT2.expectedOfficialT2, 0)
  assert.equal(result.officialT2.missedOfficialT2, 0)
  assert.equal(result.officialT2.officialT2CoveragePercent, null)
  assert.equal(result.officialT2.status, CAPTURE_HEALTH_STATUSES.NOT_DUE)
})

test('Official T2 is captured only by an exact accepted prediction', () => {
  const result = calculate({ predictions: [prediction()] })

  assert.equal(result.officialT2.expectedOfficialT2, 1)
  assert.equal(result.officialT2.capturedOfficialT2, 1)
  assert.equal(result.officialT2.missedOfficialT2, 0)
  assert.equal(result.officialT2.officialT2CoveragePercent, 100)
  assert.equal(result.officialT2.status, CAPTURE_HEALTH_STATUSES.CAPTURED)
})

test('elapsed Official T2 window without a prediction is missed', () => {
  const result = calculate()

  assert.equal(result.officialT2.expectedOfficialT2, 1)
  assert.equal(result.officialT2.capturedOfficialT2, 0)
  assert.equal(result.officialT2.missedOfficialT2, 1)
  assert.equal(result.officialT2.status, CAPTURE_HEALTH_STATUSES.MISSED)
  assert.equal(result.missingGames.officialT2[0].reason, 'OFFICIAL_T2_CAPTURE_MISSED')
})

test('inclusive Official T2 close boundary is not missed until it has passed', () => {
  const atClose = calculate({
    observedAt: new Date(START.getTime() - 75 * 60 * 1000),
  })
  const afterClose = calculate({
    observedAt: new Date(START.getTime() - 75 * 60 * 1000 + 1),
  })
  const capturedAtClose = calculate({
    observedAt: new Date(START.getTime() - 75 * 60 * 1000 + 1),
    predictions: [
      prediction({
        generatedAt: new Date(START.getTime() - 75 * 60 * 1000),
      }),
    ],
  })

  assert.equal(atClose.officialT2.status, CAPTURE_HEALTH_STATUSES.NOT_DUE)
  assert.equal(afterClose.officialT2.status, CAPTURE_HEALTH_STATUSES.MISSED)
  assert.equal(capturedAtClose.officialT2.status, CAPTURE_HEALTH_STATUSES.CAPTURED)
})

test('rescheduled identity does not credit the old Official T2 capture', () => {
  const newStart = new Date(START.getTime() + 60 * 60 * 1000)
  const result = calculate({
    observedAt: new Date(newStart.getTime() - 74 * 60 * 1000),
    predictions: [prediction()],
    scheduleGames: [game({ startTimeUTC: newStart })],
  })

  assert.equal(result.officialT2.expectedOfficialT2, 1)
  assert.equal(result.officialT2.capturedOfficialT2, 0)
  assert.equal(
    result.missingGames.officialT2[0].reason,
    'SCHEDULE_IDENTITY_MISMATCH',
  )
  assert.equal(
    result.missingGames.officialT2[0].scheduledStart.getTime(),
    newStart.getTime(),
  )
})

test('postponed, cancelled and unusable schedule games are excluded', () => {
  const result = calculate({
    scheduleGames: [
      game({ gameId: '2026020001', status: 'Postponed' }),
      game({ gameId: '2026020002', status: 'Cancelled' }),
      game({ gameId: '2026020003', gameState: 'UNKNOWN' }),
    ],
  })

  assert.equal(result.officialT2.expectedOfficialT2, 0)
  assert.equal(result.marketCheckpoints.T2.expectedCount, 0)
})

test('schedule cohort enforces exact season and date isolation', () => {
  const cohort = normalizeScheduleCohort(
    [
      game(),
      game({ gameId: '2025020001', season: '20252026' }),
      game({ gameId: '2026020002', startTimeUTC: '2026-12-01T19:00:00.000Z' }),
    ],
    normalized,
  )

  assert.equal(cohort.length, 1)
  assert.equal(cohort[0].gameId, '2026020001')
})

test('schedule queries pad both bounds before exact scheduled-start filtering', () => {
  assert.deepEqual(scheduleQueryBounds(normalized), {
    from: '2026-09-30',
    to: '2026-11-02',
  })
})

for (const [snapshotType, minutesBeforeStart, closeMinutes] of [
  ['T24', 23 * 60, 18 * 60],
  ['T6', 5 * 60, 4 * 60],
  ['T2', 90, 75],
]) {
  test(`${snapshotType} coverage distinguishes not due, captured and missing`, () => {
    const atClose = calculate({
      observedAt: new Date(START.getTime() - closeMinutes * 60 * 1000),
    })
    const captured = calculate({
      observedAt: new Date(START.getTime() - closeMinutes * 60 * 1000 + 1),
      snapshots: [snapshot(snapshotType, minutesBeforeStart)],
    })
    const missing = calculate({
      observedAt: new Date(START.getTime() - closeMinutes * 60 * 1000 + 1),
    })

    assert.equal(
      atClose.marketCheckpoints[snapshotType].status,
      CAPTURE_HEALTH_STATUSES.NOT_DUE,
    )
    assert.equal(captured.marketCheckpoints[snapshotType].capturedCount, 1)
    assert.equal(captured.marketCheckpoints[snapshotType].coveragePercent, 100)
    assert.equal(
      missing.marketCheckpoints[snapshotType].status,
      CAPTURE_HEALTH_STATUSES.MISSED,
    )
    assert.equal(missing.marketCheckpoints[snapshotType].missingCount, 1)
  })
}

test('FINAL is not due at its inclusive close and uses a valid finalized market', () => {
  const atClose = calculate({
    observedAt: new Date(START.getTime() - 5 * 60 * 1000),
  })
  const captured = calculate({
    closingMarkets: [closing()],
    observedAt: new Date(START.getTime() - 5 * 60 * 1000 + 1),
  })

  assert.equal(atClose.marketCheckpoints.FINAL.status, CAPTURE_HEALTH_STATUSES.NOT_DUE)
  assert.equal(captured.marketCheckpoints.FINAL.capturedCount, 1)
  assert.equal(captured.marketCheckpoints.FINAL.coveragePercent, 100)
})

test('duplicate snapshots do not inflate captured checkpoint count', () => {
  const t2 = snapshot('T2', 90)
  const result = calculate({ snapshots: [t2, { ...t2 }] })

  assert.equal(result.marketCheckpoints.T2.expectedCount, 1)
  assert.equal(result.marketCheckpoints.T2.capturedCount, 1)
})

test('wrong scheduled-start snapshots remain missing rather than merging', () => {
  const result = calculate({
    snapshots: [
      snapshot('T2', 90, {
        scheduledStartAtCapture: new Date(START.getTime() + 60 * 60 * 1000),
      }),
    ],
  })

  assert.equal(result.marketCheckpoints.T2.capturedCount, 0)
  assert.equal(result.marketCheckpoints.T2.missingCount, 1)
  assert.equal(result.marketCheckpoints.T2.coveragePercent, 0)
  assert.equal(result.missingGames.T2[0].captureStatus, 'MISSED')
  assert.equal(result.missingGames.T2[0].reason, 'SCHEDULE_IDENTITY_MISMATCH')
})

test('schedule provider failure returns unavailable null counts without repository reads', async () => {
  let repositoryReads = 0
  const result = await loadCaptureHealth({
    normalized,
    predictions: [],
    repository: {
      async findCaptureHealthClosingMarkets() { repositoryReads += 1 },
      async findCaptureHealthSnapshots() { repositoryReads += 1 },
    },
    scheduleProvider: async () => {
      throw new Error('fixture outage')
    },
  })

  assert.equal(result.status, CAPTURE_HEALTH_STATUSES.UNAVAILABLE)
  assert.equal(result.officialT2.expectedOfficialT2, null)
  assert.equal(result.marketCheckpoints.T24.expectedCount, null)
  assert.equal(repositoryReads, 0)
})

test('capture repository failure returns unavailable without breaking the aggregate', async () => {
  const result = await loadCaptureHealth({
    normalized,
    predictions: [],
    repository: {
      async findCaptureHealthClosingMarkets() { return [] },
      async findCaptureHealthSnapshots() {
        throw new Error('fixture database outage')
      },
    },
    scheduleProvider: async () => ({
      games: [game()],
      source: 'fixture',
      stale: false,
    }),
  })

  assert.equal(result.status, CAPTURE_HEALTH_STATUSES.UNAVAILABLE)
  assert.equal(result.reason, 'CAPTURE_DATA_UNAVAILABLE')
  assert.equal(result.officialT2.expectedOfficialT2, null)
  assert.equal(result.marketCheckpoints.FINAL.expectedCount, null)
})
