process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  OddsCaptureInputError,
  buildOddsCaptureRunIdentity,
  getFinalSafeCutoff,
  isCheckpointWithinAcceptanceWindow,
  isProviderFreshForCheckpoint,
  validateCheckpointBatch,
} = require('../services/oddsCaptureContracts')
const { createOddsCheckpoint } = require('../services/oddsSnapshotContracts')

const START = new Date('2026-10-08T19:00:00.000Z')

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

test('capture checkpoint contract normalizes complete deterministic work', () => {
  const [checkpoint] = validateCheckpointBatch([makeCheckpoint()])

  assert.equal(checkpoint.gameId, '2026020001')
  assert.equal(checkpoint.provider, 'the-odds-api-v4')
  assert.equal(checkpoint.scheduledStart.toISOString(), START.toISOString())
  assert.equal(checkpoint.targetAt.toISOString(), '2026-10-08T17:00:00.000Z')
})

test('capture checkpoint contract rejects malformed, inconsistent and duplicate work', () => {
  for (const checkpoint of [
    makeCheckpoint({ gameId: 'bad' }),
    makeCheckpoint({ homeTeamId: 'MTL' }),
    makeCheckpoint({ checkpointKey: 'T2:wrong' }),
    makeCheckpoint({ targetAt: new Date('2026-10-08T16:59:59.999Z') }),
    { ...makeCheckpoint(), scheduledStart: 'not-a-date' },
  ]) {
    assert.throws(
      () => validateCheckpointBatch([checkpoint]),
      OddsCaptureInputError,
    )
  }

  const checkpoint = makeCheckpoint()
  assert.throws(
    () => validateCheckpointBatch([checkpoint, structuredClone(checkpoint)]),
    (error) =>
      error instanceof OddsCaptureInputError &&
      error.details.errors.every(({ code }) => code === 'duplicate_checkpoint'),
  )
})

test('all checkpoint acceptance windows are inclusive at both boundaries', () => {
  for (const [snapshotType, window] of Object.entries(
    CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  )) {
    const checkpoint = validateCheckpointBatch([
      makeCheckpoint({ snapshotType }),
    ])[0]
    const lowerBoundary = new Date(
      START.getTime() - window.maximumBeforeStartMs,
    )
    const upperBoundary = new Date(
      START.getTime() - window.minimumBeforeStartMs,
    )

    assert.equal(
      isCheckpointWithinAcceptanceWindow(checkpoint, lowerBoundary),
      true,
    )
    assert.equal(
      isCheckpointWithinAcceptanceWindow(checkpoint, upperBoundary),
      true,
    )
    assert.equal(
      isCheckpointWithinAcceptanceWindow(
        checkpoint,
        new Date(lowerBoundary.getTime() - 1),
      ),
      false,
    )
    assert.equal(
      isCheckpointWithinAcceptanceWindow(
        checkpoint,
        new Date(upperBoundary.getTime() + 1),
      ),
      false,
    )
  }
})

test('provider freshness thresholds are inclusive and type-specific', () => {
  const limitsInMinutes = { FINAL: 10, T2: 20, T6: 30, T24: 60 }
  const referenceAt = new Date('2026-10-08T18:00:00.000Z')

  for (const [snapshotType, minutes] of Object.entries(limitsInMinutes)) {
    const checkpoint = validateCheckpointBatch([
      makeCheckpoint({ snapshotType }),
    ])[0]
    const boundary = new Date(referenceAt.getTime() - minutes * 60 * 1000)

    assert.equal(
      isProviderFreshForCheckpoint(checkpoint, boundary, referenceAt),
      true,
    )
    assert.equal(
      isProviderFreshForCheckpoint(
        checkpoint,
        new Date(boundary.getTime() - 1),
        referenceAt,
      ),
      false,
    )
  }
})

test('FINAL safe cutoff uses the earlier official or provider commence time', () => {
  assert.equal(
    getFinalSafeCutoff(
      '2026-10-08T19:00:00.000Z',
      '2026-10-08T18:58:00.000Z',
    ).toISOString(),
    '2026-10-08T18:53:00.000Z',
  )
})

test('capture run identity is deterministic, work-order independent and slot-specific', () => {
  const first = makeCheckpoint({ gameId: '2026020001' })
  const second = makeCheckpoint({
    awayTeamId: 'BUF',
    gameId: '2026020002',
    homeTeamId: 'BOS',
  })
  const values = {
    checkpoints: [first, second],
    intendedAt: '2026-10-08T17:00:00.000Z',
    triggerSource: 'TEST',
  }
  const identity = buildOddsCaptureRunIdentity(values)
  const reordered = buildOddsCaptureRunIdentity({
    ...values,
    checkpoints: [second, first],
  })
  const nextSlot = buildOddsCaptureRunIdentity({
    ...values,
    intendedAt: '2026-10-08T17:01:00.000Z',
  })

  assert.deepEqual(identity, reordered)
  assert.notEqual(identity.runKey, nextSlot.runKey)
  assert.match(identity.runKey, /^ODDS_CAPTURE:TEST:/)
})
