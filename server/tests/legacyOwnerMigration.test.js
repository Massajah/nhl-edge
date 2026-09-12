process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')
const {
  LegacyOwnerMigrationError,
  runLegacyOwnerMigration,
} = require('../services/legacyOwnerMigrationService')
const { PRIVATE_DATA_MODELS } = require('../services/privateDataModels')

const OWNER_ID = '507f1f77bcf86cd799439011'

const queryOf = (rows) => ({
  limit(count) { return queryOf(rows.slice(0, count)) },
  select() { return this },
  lean() { return Promise.resolve(rows) },
})

const isUnowned = (document) => document.userId === null || document.userId === undefined

const createPrivateModel = (modelName, documents, indexes = []) => {
  const droppedIndexes = []
  const model = {
    collection: {
      collectionName: modelName.toLowerCase(),
      async dropIndex(name) { droppedIndexes.push(name) },
      async indexes() { return indexes },
    },
    droppedIndexes,
    modelName,
    async countDocuments() { return documents.filter(isUnowned).length },
    async createIndexes() {},
    find() { return queryOf(documents.filter(isUnowned)) },
    async updateMany(_filter, update) {
      let modifiedCount = 0
      documents.forEach((document) => {
        if (!isUnowned(document)) return
        document.userId = update.$set.userId
        modifiedCount += 1
      })
      return { modifiedCount }
    },
  }

  return model
}

const createHarness = () => {
  const documents = {
    bets: [
      { _id: 'legacy-bet', userId: null },
      { _id: 'owned-bet', userId: 'another-user' },
    ],
    ratings: [{ _id: 'legacy-rating' }],
  }
  const betModel = createPrivateModel('Bet', documents.bets)
  const powerRatingModel = createPrivateModel(
    'PowerRating',
    documents.ratings,
    [
      { key: { _id: 1 }, name: '_id_', unique: true },
      { key: { teamId: 1 }, name: 'teamId_1', unique: true },
    ],
  )
  const markers = []
  const markerModel = {
    async create(rows) { markers.push(...rows); return rows },
  }
  markerModel.findOne = ({ version }) => ({
    lean: async () => markers.find((row) => row.version === version) ?? null,
  })
  const owner = { _id: OWNER_ID, email: 'owner@example.com', googleId: 'subject' }
  const userModel = {
    findOne(filter) {
      const matches = filter.email === owner.email || filter.googleId === owner.googleId
      return { lean: async () => (matches ? owner : null) }
    },
  }

  return {
    betModel,
    documents,
    markerModel,
    markers,
    models: [betModel, powerRatingModel],
    powerRatingModel,
    userModel,
  }
}

test('legacy owner dry run reports every collection and modifies nothing', async () => {
  const harness = createHarness()
  const before = structuredClone(harness.documents)
  const result = await runLegacyOwnerMigration(
    { email: 'OWNER@example.com', googleSubject: 'subject' },
    harness,
  )

  assert.equal(result.confirmed, false)
  assert.equal(result.totalRecords, 2)
  assert.equal(result.totalChanged, 0)
  assert.equal(result.collections.length, 2)
  assert.deepEqual(harness.documents, before)
  assert.equal(harness.markers.length, 0)
})

test('migration inventory contains every current user-owned data model', () => {
  assert.deepEqual(
    PRIVATE_DATA_MODELS.map(({ modelName }) => modelName).sort(),
    [
      'BankrollProfile',
      'BankrollTransaction',
      'Bet',
      'BettingSettings',
      'BookmakerPreferences',
      'GameContext',
      'ForwardPredictionSnapshot',
      'GoalieAdjustment',
      'Injury',
      'PowerRating',
      'PowerRatingSettings',
      'ProcessedRatingGame',
      'QuickRematchSettings',
      'RatingEngineSettings',
      'RatingLabPromotionAudit',
      'TeamGoalies',
      'TeamLineup',
    ].sort(),
  )
})

test('legacy migration skips immutable owned predictions and rejects ownerless predictions before mutation', async () => {
  for (const ownerless of [false, true]) {
    const harness = createHarness()
    const rows = [{ _id: 'prediction', userId: ownerless ? null : OWNER_ID }]
    const predictions = createPrivateModel('ForwardPredictionSnapshot', rows)
    predictions.legacyOwnerMigrationAllowed = false
    predictions.updateMany = async () => { assert.fail('Predictions cannot change owner') }
    harness.models.push(predictions)
    const run = () => runLegacyOwnerMigration({ confirm: true, email: 'owner@example.com', googleSubject: 'subject' },
      { ...harness, runTransaction: (work) => work('session') })
    if (ownerless) {
      await assert.rejects(run, /original owner/)
      assert.equal(harness.documents.bets[0].userId, null)
      assert.equal(harness.markers.length, 0)
    } else {
      const result = await run()
      assert.equal(result.totalChanged, 2)
      assert.equal(rows[0].userId, OWNER_ID)
    }
  }
})

test('confirmed migration assigns only missing owners, handles legacy index and records marker', async () => {
  const harness = createHarness()
  const result = await runLegacyOwnerMigration(
    {
      confirm: true,
      email: 'owner@example.com',
      googleSubject: 'subject',
    },
    {
      ...harness,
      runTransaction: async (work) => work('test-session'),
    },
  )

  assert.equal(result.totalChanged, 2)
  assert.equal(harness.documents.bets[0].userId, OWNER_ID)
  assert.equal(harness.documents.bets[1].userId, 'another-user')
  assert.equal(harness.documents.ratings[0].userId, OWNER_ID)
  assert.deepEqual(harness.powerRatingModel.droppedIndexes, ['teamId_1'])
  assert.equal(harness.markers.length, 1)

  const second = await runLegacyOwnerMigration(
    {
      confirm: true,
      email: 'owner@example.com',
      googleSubject: 'subject',
    },
    {
      ...harness,
      runTransaction: async (work) => work('test-session'),
    },
  )
  assert.equal(second.totalChanged, 0)
  assert.equal(second.migrationAlreadyRecorded, true)
})

test('owner email and Google subject mismatch aborts before collection access', async () => {
  const userModel = {
    findOne(filter) {
      return {
        lean: async () => ({
          _id: filter.email ? OWNER_ID : '507f191e810c19729de860ea',
        }),
      }
    },
  }

  await assert.rejects(
    () => runLegacyOwnerMigration(
      { email: 'owner@example.com', googleSubject: 'subject' },
      { models: [], userModel },
    ),
    (error) => error instanceof LegacyOwnerMigrationError,
  )
})

test('former destructive cleanup command cannot delete data', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, '../scripts/cleanupPreAuthData.js'), '--confirm'],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stderr, /permanently disabled/i)
})
