process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const authService = require('../services/authService')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  getRatingEngineSettings,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
} = require('../services/ratingEngineSettingsService')

const queryOf = (value) => ({
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
  catch(reject) {
    return Promise.resolve(value).catch(reject)
  },
})

const sameUser = (left, right) => String(left) === String(right)

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

const makeSettingsStore = () => {
  const settingsByUser = new Map()

  return {
    model: {
      findOne(filter) {
        return queryOf(settingsByUser.get(String(filter.userId)) ?? null)
      },
      async findOneAndUpdate(filter, update) {
        const userKey = String(filter.userId)
        const document = {
          ...(settingsByUser.get(userKey) ?? {}),
          ...update.$set,
          userId: filter.userId,
        }

        settingsByUser.set(userKey, document)

        return document
      },
      async deleteOne(filter) {
        settingsByUser.delete(String(filter.userId))

        return {
          deletedCount: 1,
        }
      },
    },
    settingsByUser,
  }
}

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    const text = await response.text()

    return {
      body: text ? JSON.parse(text) : null,
      status: response.status,
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve)
    })
  }
}

const makeSettingsPayload = (overrides = {}) => ({
  kFactor: 1.15,
  homeAdvantage: 4.25,
  regulationMultiplier: 1,
  overtimeMultiplier: 0.7,
  shootoutMultiplier: 0.5,
  ...overrides,
})

test('rating engine settings return defaults without a persisted document', async () => {
  const store = makeSettingsStore()
  const result = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(result.usingDefaults, true)
  assert.deepEqual(result.settings, DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS)
})

test('rating engine settings are saved per user', async () => {
  const store = makeSettingsStore()
  const userASettings = makeSettingsPayload({
    homeAdvantage: 3.5,
    kFactor: 1.05,
  })
  const userBSettings = makeSettingsPayload({
    homeAdvantage: 5,
    kFactor: 1.4,
  })

  await updateRatingEngineSettings('user-a', userASettings, {
    settingsModel: store.model,
  })
  await updateRatingEngineSettings('user-b', userBSettings, {
    settingsModel: store.model,
  })

  const userA = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })
  const userB = await getRatingEngineSettings('user-b', {
    settingsModel: store.model,
  })

  assert.deepEqual(userA.settings, userASettings)
  assert.deepEqual(userB.settings, userBSettings)
})

test('one user cannot read or overwrite another user settings', async () => {
  const store = makeSettingsStore()
  const userASettings = makeSettingsPayload({ homeAdvantage: 4.75 })
  const userBSettings = makeSettingsPayload({ homeAdvantage: 2.25 })

  await updateRatingEngineSettings('user-a', userASettings, {
    settingsModel: store.model,
  })
  await updateRatingEngineSettings('user-b', userBSettings, {
    settingsModel: store.model,
  })
  await updateRatingEngineSettings(
    'user-a',
    makeSettingsPayload({ homeAdvantage: 6 }),
    {
      settingsModel: store.model,
    },
  )

  const userB = await getRatingEngineSettings('user-b', {
    settingsModel: store.model,
  })

  assert.deepEqual(userB.settings, userBSettings)
})

test('partial and malformed settings payloads are rejected', async () => {
  const store = makeSettingsStore()

  await assert.rejects(
    () =>
      updateRatingEngineSettings(
        'user-a',
        {
          kFactor: 1.2,
        },
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.missingFields.includes('homeAdvantage'),
  )

  await assert.rejects(
    () => updateRatingEngineSettings('user-a', null, { settingsModel: store.model }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'Request body must be an object.',
  )
})

test('out-of-range settings values are rejected', async () => {
  const store = makeSettingsStore()

  await assert.rejects(
    () =>
      updateRatingEngineSettings(
        'user-a',
        makeSettingsPayload({ homeAdvantage: 16 }),
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.homeAdvantage.includes('no more than 15'),
  )
})

test('null and non-numeric settings values are rejected', async () => {
  const store = makeSettingsStore()

  await assert.rejects(
    () =>
      updateRatingEngineSettings(
        'user-a',
        makeSettingsPayload({
          overtimeMultiplier: 'abc',
          shootoutMultiplier: null,
        }),
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.overtimeMultiplier.includes('finite number') &&
      error.details.fieldErrors.shootoutMultiplier.includes('finite number'),
  )
})

test('reset returns defaults and removes user-specific settings', async () => {
  const store = makeSettingsStore()

  await updateRatingEngineSettings('user-a', makeSettingsPayload({ kFactor: 1.5 }), {
    settingsModel: store.model,
  })

  const reset = await resetRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })
  const loaded = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(reset.success, true)
  assert.equal(reset.usingDefaults, true)
  assert.deepEqual(reset.settings, DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS)
  assert.equal(loaded.usingDefaults, true)
})

test('settings endpoint saves and reads only the authenticated user settings', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const tokenA = authService.signAuthToken(userA)
  const tokenB = authService.signAuthToken(userB)
  const settings = []

  await withPatches(
    [
      [
        RatingEngineSettings,
        'findOne',
        (filter) =>
          queryOf(
            settings.find((setting) => sameUser(setting.userId, filter.userId)) ??
              null,
          ),
      ],
      [
        RatingEngineSettings,
        'findOneAndUpdate',
        async (filter, update) => {
          const existing = settings.find((setting) =>
            sameUser(setting.userId, filter.userId),
          )

          if (existing) {
            Object.assign(existing, update.$set)
            return existing
          }

          const document = {
            ...update.$set,
            userId: filter.userId,
          }

          settings.push(document)

          return document
        },
      ],
      [
        RatingEngineSettings,
        'deleteOne',
        async (filter) => {
          const index = settings.findIndex((setting) =>
            sameUser(setting.userId, filter.userId),
          )

          if (index >= 0) {
            settings.splice(index, 1)
          }
        },
      ],
    ],
    async () => {
      const payloadA = makeSettingsPayload({ homeAdvantage: 5.5 })
      const payloadB = makeSettingsPayload({ homeAdvantage: 3.25 })

      const saveA = await request('/api/settings/rating-engine', {
        body: JSON.stringify(payloadA),
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })
      const saveB = await request('/api/settings/rating-engine', {
        body: JSON.stringify(payloadB),
        headers: {
          Authorization: `Bearer ${tokenB}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })
      const readA = await request('/api/settings/rating-engine', {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      })

      assert.equal(saveA.status, 200)
      assert.equal(saveB.status, 200)
      assert.deepEqual(readA.body.settings, payloadA)
    },
  )
})
