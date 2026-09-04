process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CHECKPOINT_OFFSETS_MS,
  ODDS_SNAPSHOT_TYPES,
  OddsSnapshotContractError,
  buildOddsCheckpointKey,
  createOddsCheckpoint,
} = require('../services/oddsSnapshotContracts')

const START = '2026-10-08T23:00:00.000Z'

test('checkpoint keys and target times are deterministic for every approved type', () => {
  Object.values(ODDS_SNAPSHOT_TYPES).forEach((snapshotType) => {
    const first = createOddsCheckpoint({ scheduledStart: START, snapshotType })
    const second = createOddsCheckpoint({
      scheduledStart: new Date(START),
      snapshotType: snapshotType.toLowerCase(),
    })

    assert.deepEqual(first, second)
    assert.equal(first.checkpointKey, `${snapshotType}:${Date.parse(START)}`)
    assert.equal(
      first.targetAt.getTime(),
      Date.parse(START) - CHECKPOINT_OFFSETS_MS[snapshotType],
    )
  })
})

test('rescheduled starts produce different keys without changing game identity', () => {
  const oldStart = '2026-10-08T23:00:00.000Z'
  const newStart = '2026-10-09T01:00:00.000Z'
  const oldKey = buildOddsCheckpointKey('T2', oldStart)
  const newKey = buildOddsCheckpointKey('T2', newStart)

  assert.equal(oldKey, `T2:${Date.parse(oldStart)}`)
  assert.equal(newKey, `T2:${Date.parse(newStart)}`)
  assert.notEqual(oldKey, newKey)
})

test('checkpoint construction rejects arbitrary types and invalid starts', () => {
  assert.throws(
    () => buildOddsCheckpointKey('FIRST', START),
    OddsSnapshotContractError,
  )
  assert.throws(
    () => buildOddsCheckpointKey('T2', 'not-a-date'),
    OddsSnapshotContractError,
  )
  assert.throws(
    () => buildOddsCheckpointKey('T2', null),
    OddsSnapshotContractError,
  )
})
