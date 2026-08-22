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
        await powerRatingsService.initializeDefaultPowerRatings(userId, {
          startingRatingScale: { center: 46, mode: 'standard', spread: 8 },
        })
      const ratings = await powerRatingsService.getPowerRatings(userId, {
        startingRatingScale: { center: 46, mode: 'standard', spread: 8 },
      })

      assert.equal(result.insertedCount, 32)
      assert.equal(
        [...ratingsByKey.values()].every(
          (rating) => rating.homeAdvantage === 0,
        ),
        true,
      )
      assert.equal(ratings.length, 32)
      assert.equal(ratings.every((rating) => rating.baseRating === 46), true)
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

test('Power Ratings update API preserves 0.1 Home Adjustment inputs', async () => {
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
      for (const homeAdjustment of [-0.2, 0.3, 0.5]) {
        const rating = await powerRatingsService.updatePowerRating(
          userId,
          'BOS',
          { homeAdjustment },
        )

        assert.equal(document.homeAdvantage, homeAdjustment)
        assert.equal(rating.homeAdjustment, homeAdjustment)
        assert.equal(Object.hasOwn(rating, 'homeAdvantage'), false)
      }
    },
  )
})

test('new Manual Adjustment edits require 0.5-point increments', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const document = {
    _id: new mongoose.Types.ObjectId(),
    abbreviation: 'BOS',
    baseRating: 49.173,
    homeAdvantage: 0.3,
    lastRatingChange: 0.173,
    manualAdjustment: 0,
    save: async () => {},
    teamId: 'BOS',
    teamName: 'Boston Bruins',
    toJSON() {
      return { ...this, id: this._id.toString(), userId }
    },
    userId,
  }

  await withPatches(
    [[PowerRating, 'findOne', async () => document]],
    async () => {
      for (const manualAdjustment of [0, 0.5, -0.5, 1]) {
        await powerRatingsService.updatePowerRating(userId, 'BOS', {
          manualAdjustment,
        })
        assert.equal(document.manualAdjustment, manualAdjustment)
        assert.equal(document.baseRating, 49.173)
      }

      await assert.rejects(
        () =>
          powerRatingsService.updatePowerRating(userId, 'BOS', {
            manualAdjustment: 0.25,
          }),
        /Manual Adjustment must use 0\.5-point increments/,
      )

      document.manualAdjustment = 0.25
      await powerRatingsService.updatePowerRating(userId, 'BOS', {
        homeAdjustment: 0.4,
      })
      assert.equal(document.manualAdjustment, 0.25)
      assert.equal(document.baseRating, 49.173)
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

test('season starting rating is read-only through ordinary rating updates', async () => {
  await assert.rejects(
    () =>
      powerRatingsService.updatePowerRating('user-1', 'BOS', {
        seasonStartingRating: 44.5,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message ===
        'Request body contains unsupported power rating fields.',
  )
})

test('manual Starting Rating edits use the selected scale, half steps, and lifecycle lock', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const document = {
    _id: new mongoose.Types.ObjectId(),
    abbreviation: 'BOS',
    baseRating: 46,
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
  const startingRatingScale = {
    center: 46,
    mode: 'standard',
    spread: 8,
  }
  const unlockedLifecycle = {
    locked: false,
    seasonId: '20262027',
    status: 'preseason',
  }

  await withPatches(
    [[PowerRating, 'findOne', async () => document]],
    async () => {
      for (const baseRating of [42, 42.5, 46, 50]) {
        const rating = await powerRatingsService.updateStartingPowerRating(
          userId,
          'BOS',
          { baseRating },
          { startingRatingLifecycle: unlockedLifecycle, startingRatingScale },
        )

        assert.equal(rating.baseRating, baseRating)
      }

      await assert.rejects(
        () =>
          powerRatingsService.updateStartingPowerRating(
            userId,
            'BOS',
            { baseRating: 41.5 },
            { startingRatingLifecycle: unlockedLifecycle, startingRatingScale },
          ),
        /Starting Rating must be between 42\.0 and 50\.0/,
      )
      await assert.rejects(
        () =>
          powerRatingsService.updateStartingPowerRating(
            userId,
            'BOS',
            { baseRating: 50.5 },
            { startingRatingLifecycle: unlockedLifecycle, startingRatingScale },
          ),
        /Starting Rating must be between 42\.0 and 50\.0/,
      )
      await assert.rejects(
        () =>
          powerRatingsService.updateStartingPowerRating(
            userId,
            'BOS',
            { baseRating: 46.25 },
            { startingRatingLifecycle: unlockedLifecycle, startingRatingScale },
          ),
        /Starting Rating must use 0\.5-point increments/,
      )

      await assert.rejects(
        () =>
          powerRatingsService.updatePowerRating(
            userId,
            'BOS',
            { baseRating: 48.5 },
            {
              startingRatingLifecycle: {
                locked: true,
                seasonId: '20262027',
                status: 'locked',
              },
              startingRatingScale,
            },
          ),
        (error) =>
          error.statusCode === 409 &&
          /Starting Rating cannot be changed/.test(error.message),
      )

      const unchangedLiveRating =
        await powerRatingsService.updateStartingPowerRating(
          userId,
          'BOS',
          { homeAdjustment: 0.5 },
          { startingRatingLifecycle: unlockedLifecycle, startingRatingScale },
        )

      assert.equal(unchangedLiveRating.baseRating, 50)
      assert.equal(unchangedLiveRating.homeAdjustment, 0.5)
    },
  )
})

test('Starting Rating Scale locks only after a current-season game is processed', async () => {
  const queryOfValue = (value) => ({
    lean() {
      return this
    },
    select() {
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject)
    },
  })
  const seasonMetadataProvider = async () => ({
    currentSeasonId: '20262027',
    seasons: [
      {
        endDate: '2027-04-30',
        id: '20262027',
        isCurrent: true,
        startDate: '2026-10-01',
      },
    ],
  })
  const createProcessedRatingGameModel = (gameDates) => ({
    findOne(filter) {
      const processedGame = gameDates.find((gameDate) => {
        const timestamp = new Date(gameDate).getTime()

        return (
          timestamp >= filter.gameDate.$gte.getTime() &&
          timestamp <= filter.gameDate.$lte.getTime()
        )
      })

      return queryOfValue(
        processedGame ? { _id: 'processed-game', gameDate: processedGame } : null,
      )
    },
  })

  assert.deepEqual(
    await powerRatingsService.getStartingRatingScaleLifecycle('user-1', {
      processedRatingGameModel: createProcessedRatingGameModel([]),
      seasonMetadataProvider,
    }),
    { locked: false, seasonId: '20262027', status: 'preseason' },
  )
  assert.deepEqual(
    await powerRatingsService.getStartingRatingScaleLifecycle('user-1', {
      processedRatingGameModel: createProcessedRatingGameModel([
        '2026-03-01T00:00:00.000Z',
      ]),
      seasonMetadataProvider,
    }),
    { locked: false, seasonId: '20262027', status: 'preseason' },
  )
  assert.deepEqual(
    await powerRatingsService.getStartingRatingScaleLifecycle('user-1', {
      processedRatingGameModel: createProcessedRatingGameModel([
        '2026-10-10T00:00:00.000Z',
      ]),
      seasonMetadataProvider,
    }),
    { locked: true, seasonId: '20262027', status: 'locked' },
  )
})

test('season starting ratings capture at the existing lock and remain immutable', async () => {
  const userId = new mongoose.Types.ObjectId().toString()
  const ratings = [
    {
      _id: new mongoose.Types.ObjectId(),
      abbreviation: 'BOS',
      baseRating: 44.5,
      homeAdvantage: 0,
      lastRatingChange: 0,
      manualAdjustment: 0,
      save: async () => {},
      seasonStartingRating: null,
      seasonStartingRatingSeasonId: null,
      teamId: 'BOS',
      teamName: 'Boston Bruins',
      userId,
    },
    {
      abbreviation: 'TOR',
      baseRating: 47,
      seasonStartingRating: null,
      seasonStartingRatingSeasonId: null,
      teamId: 'TOR',
      teamName: 'Toronto Maple Leafs',
      userId,
    },
  ]
  ratings[0].toJSON = function toJSON() {
    return { ...this, id: this._id.toString(), userId }
  }
  let processedGame = null
  let baselineWrites = 0
  const lifecycleQuery = (value) => ({
    lean() {
      return this
    },
    select() {
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject)
    },
  })
  const powerRatingModel = {
    async bulkWrite(operations) {
      baselineWrites += operations.length
      operations.forEach(({ updateOne }) => {
        const rating = ratings.find(
          (candidate) => candidate.teamId === updateOne.filter.teamId,
        )

        Object.assign(rating, updateOne.update.$set)
      })
    },
    find: () => queryOf(ratings),
  }
  const options = {
    powerRatingModel,
    processedRatingGameModel: {
      findOne: () => lifecycleQuery(processedGame),
    },
    seasonMetadataProvider: async () => ({
      currentSeasonId: '20262027',
      seasons: [
        {
          endDate: '2027-04-30',
          id: '20262027',
          isCurrent: true,
          startDate: '2026-10-01',
        },
      ],
    }),
  }

  const captured = await powerRatingsService.captureSeasonStartingRatings(
    userId,
    options,
  )

  assert.equal(captured.captured, true)
  assert.equal(captured.capturedCount, 2)
  assert.equal(ratings[0].seasonStartingRating, 44.5)
  assert.equal(ratings[1].seasonStartingRating, 47)
  assert.equal(ratings[0].seasonStartingRatingSeasonId, '20262027')

  ratings[0].baseRating = 46
  processedGame = { _id: 'first-current-season-game' }
  const lockedCapture = await powerRatingsService.captureSeasonStartingRatings(
    userId,
    options,
  )

  assert.equal(lockedCapture.captured, false)
  assert.equal(baselineWrites, 2)
  assert.equal(ratings[0].seasonStartingRating, 44.5)

  await withPatches(
    [[PowerRating, 'findOne', async () => ratings[0]]],
    async () => {
      await powerRatingsService.updatePowerRating(userId, 'BOS', {
        manualAdjustment: 0.5,
      })
    },
  )

  assert.equal(ratings[0].manualAdjustment, 0.5)
  assert.equal(ratings[0].seasonStartingRating, 44.5)
})

test('locked development data without a baseline is not silently backfilled', async () => {
  let writeAttempted = false
  const lifecycleQuery = (value) => ({
    lean() {
      return this
    },
    select() {
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject)
    },
  })
  const result = await powerRatingsService.captureSeasonStartingRatings(
    'user-1',
    {
      powerRatingModel: {
        async bulkWrite() {
          writeAttempted = true
        },
        find: () => queryOf([{ baseRating: 51, teamId: 'BOS' }]),
      },
      processedRatingGameModel: {
        findOne: () => lifecycleQuery({ _id: 'existing-live-game' }),
      },
      seasonMetadataProvider: async () => ({
        currentSeasonId: '20262027',
        seasons: [
          {
            endDate: '2027-04-30',
            id: '20262027',
            isCurrent: true,
            startDate: '2026-10-01',
          },
        ],
      }),
    },
  )

  assert.equal(result.locked, true)
  assert.equal(result.captured, false)
  assert.equal(writeAttempted, false)
})

test('preseason scale is editable and locked scale cannot be changed', async () => {
  const seasonMetadataProvider = async () => ({
    currentSeasonId: '20262027',
    seasons: [
      {
        endDate: '2027-04-30',
        id: '20262027',
        isCurrent: true,
        startDate: '2026-10-01',
      },
    ],
  })
  const queryOfProcessedGame = (value) => ({
    lean() {
      return this
    },
    select() {
      return this
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject)
    },
  })
  const settings = new Map()
  const settingsModel = {
    async findOneAndUpdate({ userId }, update) {
      const document = { ...update.$set, userId }

      settings.set(String(userId), document)
      return document
    },
  }
  const unlocked = await powerRatingsService.updateStartingRatingScaleConfiguration(
    'user-1',
    { max: 48, min: 42, mode: 'standard' },
    {
      processedRatingGameModel: {
        findOne: () => queryOfProcessedGame(null),
      },
      seasonMetadataProvider,
      settingsModel,
    },
  )

  assert.equal(unlocked.locked, false)
  assert.equal(unlocked.scale.min, 42)
  assert.equal(unlocked.scale.max, 48)

  await assert.rejects(
    () =>
      powerRatingsService.updateStartingRatingScaleConfiguration(
        'user-1',
        { max: 50, min: 40, mode: 'standard' },
        {
          processedRatingGameModel: {
            findOne: () =>
              queryOfProcessedGame({ _id: 'current-season-game' }),
          },
          seasonMetadataProvider,
          settingsModel,
        },
      ),
    (error) =>
      error.statusCode === 409 &&
      error.message ===
        'Starting scale cannot be changed after live rating updates begin.',
  )
  assert.equal(settings.get('user-1').startingRatingSpread, 6)
})

test('explicit reset applies the selected center without distributing teams', async () => {
  const userId = new mongoose.Types.ObjectId()
  const ratingsByKey = new Map()

  await withPatches(
    [
      [
        PowerRating,
        'bulkWrite',
        async (operations) => {
          operations.forEach(({ updateOne }) => {
            const key = `${updateOne.filter.userId}-${updateOne.filter.teamId}`
            const values = updateOne.update.$set
            const document = {
              ...(ratingsByKey.get(key) ?? {}),
              ...values,
              _id:
                ratingsByKey.get(key)?._id ?? new mongoose.Types.ObjectId(),
            }

            document.toJSON = () => ({
              ...document,
              id: document._id.toString(),
              userId: document.userId.toString(),
            })
            ratingsByKey.set(key, document)
          })

          return { matchedCount: 0, modifiedCount: 32, upsertedCount: 32 }
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
      const result = await powerRatingsService.resetPowerRatings(userId, {
        startingRatingLifecycle: {
          locked: false,
          seasonId: '20262027',
          status: 'preseason',
        },
        startingRatingScale: {
          center: 47.5,
          max: 52,
          min: 43,
          mode: 'custom',
          spread: 9,
        },
      })

      assert.equal(result.ratings.length, 32)
      assert.equal(
        result.ratings.every((rating) => rating.baseRating === 47.5),
        true,
      )
      assert.equal(
        result.ratings.every(
          (rating) =>
            rating.homeAdjustment === 0 && rating.manualAdjustment === 0,
        ),
        true,
      )
      assert.equal(
        result.ratings.every(
          (rating) => !Object.hasOwn(rating, 'seasonStartingRating'),
        ),
        true,
      )
    },
  )
})

test('new-season rating reset clears the prior baseline explicitly', async () => {
  let operations = []
  const powerRatingModel = {
    async bulkWrite(nextOperations) {
      operations = nextOperations
    },
    find: () => queryOf([]),
  }

  await powerRatingsService.resetPowerRatings('user-1', {
    clearSeasonStartingRating: true,
    powerRatingModel,
    startingRatingScale: {
      center: 46,
      max: 50,
      min: 42,
      mode: 'standard',
      spread: 8,
    },
  })

  assert.equal(operations.length, 32)
  assert.equal(
    operations.every(
      ({ updateOne }) =>
        updateOne.update.$set.seasonStartingRating === null &&
        updateOne.update.$set.seasonStartingRatingSeasonId === null,
    ),
    true,
  )
})

test('unlocked ordinary reset does not rewrite a captured season baseline', async () => {
  let operations = []
  const powerRatingModel = {
    async bulkWrite(nextOperations) {
      operations = nextOperations
    },
    find: () => queryOf([]),
  }

  await powerRatingsService.resetPowerRatings('user-1', {
    powerRatingModel,
    startingRatingLifecycle: {
      locked: false,
      seasonId: '20262027',
      status: 'preseason',
    },
    startingRatingScale: {
      center: 46,
      max: 50,
      min: 42,
      mode: 'standard',
      spread: 8,
    },
  })

  assert.equal(
    operations.every(
      ({ updateOne }) =>
        !Object.hasOwn(updateOne.update.$set, 'seasonStartingRating') &&
        !Object.hasOwn(
          updateOne.update.$set,
          'seasonStartingRatingSeasonId',
        ),
    ),
    true,
  )
})

test('ordinary reset is rejected after Starting Ratings lock', async () => {
  let writeAttempted = false

  await assert.rejects(
    () =>
      powerRatingsService.resetPowerRatings('user-1', {
        powerRatingModel: {
          async bulkWrite() {
            writeAttempted = true
          },
        },
        startingRatingLifecycle: {
          locked: true,
          seasonId: '20262027',
          status: 'locked',
        },
        startingRatingScale: {
          center: 46,
          max: 50,
          min: 42,
          mode: 'standard',
          spread: 8,
        },
      }),
    (error) =>
      error.statusCode === 409 &&
      error.message ===
        'Power Ratings cannot be reset after Starting Ratings are locked.',
  )
  assert.equal(writeAttempted, false)
})
