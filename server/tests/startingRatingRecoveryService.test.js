process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const { getFirstSeasonRatingBeforeByTeam } = require('../services/powerRatingsService')
const {
  applySeasonStartingRatingRepair,
  previewSeasonStartingRatingRepair,
} = require('../services/startingRatingRecoveryService')

const makeModels = (userId) => {
  const ratings = [
    { _id: new mongoose.Types.ObjectId(), userId, teamId: 'TOR',
      seasonStartingRating: 46.33, seasonStartingRatingSeasonId: '20262027' },
    { _id: new mongoose.Types.ObjectId(), userId, teamId: 'BOS',
      seasonStartingRating: 48.2, seasonStartingRatingSeasonId: '20262027' },
    { _id: new mongoose.Types.ObjectId(), userId, teamId: 'MTL',
      seasonStartingRating: 47, seasonStartingRatingSeasonId: '20262027' },
  ]
  const games = [
    { gameDate: new Date('2026-09-30T00:00:00Z'), gameId: 2026020002,
      homeTeamId: 'TOR', homeRatingBefore: 46.33,
      awayTeamId: 'BOS', awayRatingBefore: 48.1 },
    { gameDate: new Date('2026-09-29T00:00:00Z'), gameId: 2026020001,
      homeTeamId: 'TOR', homeRatingBefore: 46.5,
      awayTeamId: 'BOS', awayRatingBefore: 48.2 },
    { gameDate: new Date('2025-10-07T00:00:00Z'), gameId: 2025020001,
      homeTeamId: 'TOR', homeRatingBefore: 46,
      awayTeamId: 'BOS', awayRatingBefore: 48 },
  ]
  const updates = []
  return {
    games,
    ratings,
    updates,
    powerRatingModel: {
      find(filter) {
        assert.equal(String(filter.userId), String(userId))
        return { select() { return this }, async lean() { return ratings } }
      },
      async updateOne(filter, update) {
        updates.push({ filter, update })
        const rating = ratings.find((row) =>
          String(row._id) === String(filter._id) &&
          String(row.userId) === String(filter.userId) &&
          row.seasonStartingRating === filter.seasonStartingRating &&
          row.seasonStartingRatingSeasonId === filter.seasonStartingRatingSeasonId)
        if (!rating) return { matchedCount: 0 }
        Object.assign(rating, update.$set)
        return { matchedCount: 1 }
      },
    },
    processedRatingGameModel: {
      find(filter) {
        assert.equal(String(filter.userId), String(userId))
        const selected = games.filter((game) =>
          game.gameDate >= filter.gameDate.$gte &&
          game.gameDate <= filter.gameDate.$lte)
        return {
          select() { return this },
          sort() {
            selected.sort((left, right) => left.gameDate - right.gameDate)
            return this
          },
          async lean() { return selected },
        }
      },
    },
  }
}

test('recovery preview uses each team first game before rating and leaves unmatched teams untouched', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = makeModels(userId)
  const preview = await previewSeasonStartingRatingRepair({
    userId, seasonId: '20262027', ...models,
  })
  assert.equal(preview.candidates.length, 1)
  assert.equal(preview.candidates[0].teamId, 'TOR')
  assert.equal(preview.candidates[0].storedRating, 46.33)
  assert.equal(preview.candidates[0].recoveredRating, 46.5)
  assert.equal(preview.candidates[0].firstGameId, 2026020001)
  assert.equal(preview.withoutHistory, 1)
  assert.equal(models.ratings[0].seasonStartingRating, 46.33)
  assert.equal(models.updates.length, 0)
})

test('explicit owner-season repair writes only verified snapshots and is repeatable', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = makeModels(userId)
  await assert.rejects(() => applySeasonStartingRatingRepair({
    userId, seasonId: '20262027', ...models,
  }), /Explicit confirmation/)
  assert.equal(models.updates.length, 0)

  const first = await applySeasonStartingRatingRepair({
    userId, seasonId: '20262027', confirm: true, ...models,
  })
  const second = await applySeasonStartingRatingRepair({
    userId, seasonId: '20262027', confirm: true, ...models,
  })
  assert.equal(first.repairedCount, 1)
  assert.equal(second.repairedCount, 0)
  assert.equal(models.updates.length, 1)
  assert.equal(models.ratings[0].seasonStartingRating, 46.5)
  assert.equal(models.games[0].homeRatingBefore, 46.33)
})

test('explicit repair can restore a missing snapshot only when a first game exists', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = makeModels(userId)
  models.ratings[0].seasonStartingRating = null
  models.ratings[0].seasonStartingRatingSeasonId = null
  const result = await applySeasonStartingRatingRepair({
    userId, seasonId: '20262027', confirm: true, ...models,
  })
  assert.equal(result.repairedCount, 1)
  assert.equal(models.ratings[0].seasonStartingRating, 46.5)
  assert.equal(models.ratings[0].seasonStartingRatingSeasonId, '20262027')
  assert.equal(models.ratings[2].seasonStartingRating, 47)
})

test('historical season preview reads its own first game without using later results', async () => {
  const userId = new mongoose.Types.ObjectId()
  const models = makeModels(userId)
  const preview = await previewSeasonStartingRatingRepair({
    userId, seasonId: '20252026', ...models,
  })
  const historical = await getFirstSeasonRatingBeforeByTeam(userId, '20252026', models)
  assert.equal(historical.get('TOR').rating, 46)
  assert.equal(historical.get('BOS').rating, 48)
  assert.equal(preview.candidates.length, 0)
  assert.equal(preview.outsideTargetSeason, 3)
  assert.equal(models.updates.length, 0)
})
