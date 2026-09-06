process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const { calculateObjectSize } = require('bson')
const OddsCaptureRun = require('../models/OddsCaptureRun')
const OddsSnapshot = require('../models/OddsSnapshot')
const {
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  ODDS_SNAPSHOT_TYPE_VALUES,
} = require('../services/oddsSnapshotContracts')
const {
  makeBookmakers,
  makeOddsSnapshot,
} = require('./fixtures/oddsSnapshotFixtures')

const assertSnapshotFieldError = async (snapshot, field) => {
  await assert.rejects(new OddsSnapshot(snapshot).validate(), (error) => {
    assert.ok(error.errors[field], `Expected validation error for ${field}`)
    return true
  })
}

test('OddsSnapshot stores a valid global normalized nine-bookmaker observation', async () => {
  const document = new OddsSnapshot(makeOddsSnapshot())

  await document.validate()

  assert.equal(OddsSnapshot.schema.paths.userId, undefined)
  assert.equal(document.gameId, '2026020001')
  assert.equal(document.provider, ODDS_SNAPSHOT_PROVIDER)
  assert.equal(document.market, ODDS_SNAPSHOT_MARKET)
  assert.equal(document.bookmakers.length, 9)
  assert.equal(document.bookmakers.every((row) => row._id === undefined), true)
})

test('v1 legacy FINAL remains distinguishable from v2 target checkpoints', async () => {
  const legacy = new OddsSnapshot(makeOddsSnapshot({ snapshotType: 'FINAL' }))
  const v2 = new OddsSnapshot(
    makeOddsSnapshot({
      schemaVersion: 2,
      selectedBookmakerKeys: makeBookmakers().map(({ key }) => key),
    }),
  )

  await legacy.validate()
  await v2.validate()
  assert.equal(legacy.schemaVersion, 1)
  assert.equal(legacy.selectedBookmakerKeys, undefined)
  assert.equal(v2.schemaVersion, 2)
  assert.equal(v2.selectedBookmakerKeys.length, 9)
})

test('v2 snapshots require a non-empty unique selected-bookmaker set', async () => {
  await assertSnapshotFieldError(
    makeOddsSnapshot({ schemaVersion: 2, selectedBookmakerKeys: [] }),
    'selectedBookmakerKeys',
  )
  await assertSnapshotFieldError(
    makeOddsSnapshot({
      schemaVersion: 2,
      selectedBookmakerKeys: ['coolbet', 'coolbet'],
    }),
    'selectedBookmakerKeys',
  )
})

test('OddsSnapshot declares only the approved unique and analysis indexes', () => {
  const indexes = OddsSnapshot.schema.indexes()

  assert.equal(indexes.length, 2)
  assert.deepEqual(indexes[0], [
    { gameId: 1, provider: 1, checkpointKey: 1 },
    { unique: true },
  ])
  assert.deepEqual(indexes[1], [
    { seasonId: 1, snapshotType: 1, capturedAt: -1, gameId: 1 },
    {},
  ])
  assert.equal(
    indexes.some(([fields]) => fields['bookmakers.key'] || fields.providerEventId),
    false,
  )
})

test('OddsSnapshot rejects invalid game identity and same-team games', async () => {
  await assertSnapshotFieldError(
    makeOddsSnapshot({ gameId: 'not-a-game' }),
    'gameId',
  )
  await assertSnapshotFieldError(
    makeOddsSnapshot({ awayTeamId: 'TOR', homeTeamId: 'TOR' }),
    'awayTeamId',
  )
  await assertSnapshotFieldError(
    makeOddsSnapshot({ homeTeamId: 'UNKNOWN' }),
    'homeTeamId',
  )
})

test('OddsSnapshot rejects unsupported provider, market and snapshot types', async () => {
  await assertSnapshotFieldError(
    makeOddsSnapshot({ provider: 'another-provider' }),
    'provider',
  )
  await assertSnapshotFieldError(
    makeOddsSnapshot({ market: 'totals' }),
    'market',
  )
  await assertSnapshotFieldError(
    { ...makeOddsSnapshot(), snapshotType: 'FIRST' },
    'snapshotType',
  )
  assert.deepEqual(ODDS_SNAPSHOT_TYPE_VALUES, ['T24', 'T6', 'T2', 'FINAL'])
})

test('OddsSnapshot requires at least one bookmaker and unique supported keys', async () => {
  await assertSnapshotFieldError(makeOddsSnapshot({ bookmakers: [] }), 'bookmakers')

  const bookmakers = makeBookmakers()
  bookmakers[1].key = bookmakers[0].key
  await assertSnapshotFieldError(
    makeOddsSnapshot({ bookmakers }),
    'bookmakers',
  )

  const unsupported = makeBookmakers()
  unsupported[0].key = 'unsupported_book'
  await assertSnapshotFieldError(
    makeOddsSnapshot({ bookmakers: unsupported }),
    'bookmakers.0.key',
  )
})

test('OddsSnapshot rejects non-finite and non-positive decimal prices', async () => {
  for (const [field, value] of [
    ['homeOdds', 1],
    ['awayOdds', 0.99],
    ['homeOdds', Number.NaN],
    ['awayOdds', Number.POSITIVE_INFINITY],
  ]) {
    const bookmakers = makeBookmakers()
    bookmakers[0][field] = value
    await assertSnapshotFieldError(
      makeOddsSnapshot({ bookmakers }),
      `bookmakers.0.${field}`,
    )
  }
})

test('OddsSnapshot accepts null bookmaker lastUpdate and rejects invalid dates', async () => {
  const bookmakers = makeBookmakers()
  bookmakers[0].lastUpdate = null
  await new OddsSnapshot(makeOddsSnapshot({ bookmakers })).validate()

  const invalidBookmakers = makeBookmakers()
  invalidBookmakers[0].lastUpdate = 'invalid-date'
  await assertSnapshotFieldError(
    makeOddsSnapshot({ bookmakers: invalidBookmakers }),
    'bookmakers.0.lastUpdate',
  )

  for (const field of [
    'targetAt',
    'capturedAt',
    'scheduledStartAtCapture',
    'providerCommenceTime',
  ]) {
    await assertSnapshotFieldError(
      { ...makeOddsSnapshot(), [field]: 'invalid-date' },
      field,
    )
  }
})

test('OddsSnapshot requires every checkpoint identity field', async () => {
  for (const field of [
    'checkpointKey',
    'snapshotType',
    'targetAt',
    'captureRunId',
    'providerEventId',
  ]) {
    await assertSnapshotFieldError(
      makeOddsSnapshot({ [field]: undefined }),
      field,
    )
  }
})

test('OddsSnapshot rejects raw or display-only provider fields', async () => {
  for (const field of [
    'awayTeamName',
    'eventTitle',
    'homeTeamName',
    'logo',
    'providerHeaders',
    'rawProviderResponse',
  ]) {
    assert.throws(
      () => new OddsSnapshot({ ...makeOddsSnapshot(), [field]: {} }),
      new RegExp(field),
    )
  }
  await assert.rejects(
    new OddsSnapshot({
      ...makeOddsSnapshot(),
      bookmakers: [
        {
          ...makeBookmakers()[0],
          title: 'Display title must not be persisted',
        },
      ],
    }).validate(),
    (error) => Boolean(error.errors.bookmakers),
  )
})

test('representative final OddsSnapshot BSON remains within the 1.5 KiB plan', async () => {
  const document = new OddsSnapshot(makeOddsSnapshot()).toObject({
    versionKey: false,
  })
  const bsonBytes = calculateObjectSize(document)

  assert.equal(bsonBytes > 1000, true)
  assert.equal(bsonBytes <= 1536, true)
})

test('new odds collections are global and expose no user ownership field', () => {
  assert.equal(OddsSnapshot.schema.paths.userId, undefined)
  assert.equal(OddsCaptureRun.schema.paths.userId, undefined)
})
