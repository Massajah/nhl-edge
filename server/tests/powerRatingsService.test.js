process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const PowerRating = require('../models/PowerRating')
const powerRatingsService = require('../services/powerRatingsService')

const queryOf = (value) => ({
  sort() {
    return this
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
  catch(reject) {
    return Promise.resolve(value).catch(reject)
  },
})

const withPatches = async (patches, callback) => {
  const originals = patches.map(([target, property, replacement]) => {
    const original = target[property]
    target[property] = replacement

    return [target, property, original]
  })

  try {
    return await callback()
  } finally {
    originals.reverse().forEach(([target, property, original]) => {
      target[property] = original
    })
  }
}

test('default team Home Adjustment is zero', async () => {
  const userId = new mongoose.Types.ObjectId()
  const ratingsByKey = new Map()

  await withPatches(
    [
      [
        PowerRating,
        'bulkWrite',
        async (operations) => {
          let matchedCount = 0
          let upsertedCount = 0

          operations.forEach((operation) => {
            const { filter, update } = operation.updateOne
            const key = `${filter.userId}-${filter.teamId}`

            if (ratingsByKey.has(key)) {
              matchedCount += 1
              return
            }

            const document = {
              ...update.$setOnInsert,
              _id: new mongoose.Types.ObjectId(),
            }

            document.toJSON = () => ({
              ...document,
              id: document._id.toString(),
              userId: document.userId.toString(),
            })

            ratingsByKey.set(key, document)
            upsertedCount += 1
          })

          return {
            matchedCount,
            modifiedCount: 0,
            upsertedCount,
          }
        },
      ],
      [
        PowerRating,
        'find',
        (filter) =>
          queryOf(
            [...ratingsByKey.values()].filter(
              (rating) => rating.userId.toString() === filter.userId.toString(),
            ),
          ),
      ],
    ],
    async () => {
      const result =
        await powerRatingsService.initializeDefaultPowerRatings(userId)
      const ratings = await powerRatingsService.getPowerRatings(userId)

      assert.equal(result.insertedCount, 32)
      assert.equal(
        [...ratingsByKey.values()].every(
          (rating) => rating.homeAdvantage === 0,
        ),
        true,
      )
      assert.equal(ratings.length, 32)
      assert.equal(
        ratings.every((rating) => rating.homeAdjustment === 0),
        true,
      )
      assert.equal(
        ratings.every((rating) => !Object.hasOwn(rating, 'homeAdvantage')),
        true,
      )
    },
  )
})

test('Power Ratings update API accepts homeAdjustment and stores compatibility field', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const document = {
    _id: new mongoose.Types.ObjectId(),
    abbreviation: 'BOS',
    baseRating: 50,
    homeAdvantage: 0,
    lastRatingChange: 0,
    manualAdjustment: 0,
    save: async () => {},
    teamId: 'BOS',
    teamName: 'Boston Bruins',
    toJSON() {
      return {
        ...this,
        id: this._id.toString(),
        userId,
      }
    },
    userId,
  }

  await withPatches(
    [[PowerRating, 'findOne', async () => document]],
    async () => {
      const rating = await powerRatingsService.updatePowerRating(userId, 'BOS', {
        homeAdjustment: -1.2,
      })

      assert.equal(document.homeAdvantage, -1.2)
      assert.equal(rating.homeAdjustment, -1.2)
      assert.equal(Object.hasOwn(rating, 'homeAdvantage'), false)
    },
  )
})

test('invalid Home Adjustment values are rejected', async () => {
  await assert.rejects(
    () =>
      powerRatingsService.updatePowerRating('user-1', 'BOS', {
        homeAdjustment: 5.1,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'homeAdjustment must be between -5 and 5.',
  )
})
