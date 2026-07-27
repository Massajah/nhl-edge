process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  migrateLegacyDefaultHomeAdjustments,
} = require('../services/homeAdjustmentMigrationService')

const createMemoryPowerRatingModel = (documents) => ({
  async countDocuments(filter) {
    return documents.filter(
      (document) => document.homeAdvantage === filter.homeAdvantage,
    ).length
  },
  async updateMany(filter, update) {
    let modifiedCount = 0

    documents.forEach((document) => {
      if (document.homeAdvantage !== filter.homeAdvantage) {
        return
      }

      document.homeAdvantage = update.$set.homeAdvantage
      modifiedCount += 1
    })

    return { modifiedCount }
  },
})

test('legacy exact 2.5 team defaults migrate to zero adjustment', async () => {
  const documents = [
    { homeAdvantage: 2.5, teamId: 'BOS' },
    { homeAdvantage: 2.5, teamId: 'TOR' },
    { homeAdvantage: 1.5, teamId: 'COL' },
  ]
  const result = await migrateLegacyDefaultHomeAdjustments({
    confirm: true,
    powerRatingModel: createMemoryPowerRatingModel(documents),
  })

  assert.equal(result.matchedCount, 2)
  assert.equal(result.modifiedCount, 2)
  assert.deepEqual(
    documents.map((document) => document.homeAdvantage),
    [0, 0, 1.5],
  )
})

test('legacy default home adjustment migration is idempotent', async () => {
  const documents = [{ homeAdvantage: 2.5, teamId: 'BOS' }]
  const powerRatingModel = createMemoryPowerRatingModel(documents)
  const firstResult = await migrateLegacyDefaultHomeAdjustments({
    confirm: true,
    powerRatingModel,
  })
  const secondResult = await migrateLegacyDefaultHomeAdjustments({
    confirm: true,
    powerRatingModel,
  })

  assert.equal(firstResult.modifiedCount, 1)
  assert.equal(secondResult.matchedCount, 0)
  assert.equal(secondResult.modifiedCount, 0)
  assert.equal(documents[0].homeAdvantage, 0)
})

test('legacy default home adjustment migration dry run does not write', async () => {
  const documents = [{ homeAdvantage: 2.5, teamId: 'BOS' }]
  const result = await migrateLegacyDefaultHomeAdjustments({
    powerRatingModel: createMemoryPowerRatingModel(documents),
  })

  assert.equal(result.confirmed, false)
  assert.equal(result.matchedCount, 1)
  assert.equal(result.modifiedCount, 0)
  assert.equal(documents[0].homeAdvantage, 2.5)
})
