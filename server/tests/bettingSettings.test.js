process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const BettingSettings = require('../models/BettingSettings')
const authService = require('../services/authService')
const bettingSettingsService = require('../services/bettingSettingsService')

const queryOf = (value) => ({
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
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

const sameUser = (left, right) => left?.toString?.() === right?.toString?.()

const createSettingsStore = () => {
  const settingsByUser = new Map()
  const model = {
    deleteOne: async (filter) => {
      settingsByUser.delete(String(filter.userId))

      return {
        deletedCount: 1,
      }
    },
    findOne: (filter) => queryOf(settingsByUser.get(String(filter.userId)) ?? null),
    findOneAndUpdate: (filter, update) => {
      const userKey = String(filter.userId)
      const document = {
        ...(settingsByUser.get(userKey) ?? {}),
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {}),
        userId: filter.userId,
      }

      settingsByUser.set(userKey, document)

      return queryOf(document)
    },
  }

  return {
    model,
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

const validSettings = Object.freeze({
  bankrollBasis: 'AVAILABLE',
  customKellyFraction: 0.25,
  kellyMode: 'QUARTER',
  maximumStakePercent: 3,
  minimumEdgePercent: 2,
  stakeRoundingIncrement: 0.5,
})

test('betting settings return defaults without a persisted document', async () => {
  const store = createSettingsStore()
  const result = await bettingSettingsService.getBettingSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(result.usingDefaults, true)
  assert.deepEqual(result.settings, bettingSettingsService.DEFAULT_BETTING_SETTINGS)
})

test('betting settings are saved per user', async () => {
  const store = createSettingsStore()
  const userASettings = {
    ...validSettings,
    kellyMode: 'HALF',
  }
  const userBSettings = {
    ...validSettings,
    bankrollBasis: 'CURRENT',
    kellyMode: 'FULL',
    maximumStakePercent: 5,
  }

  await bettingSettingsService.updateBettingSettings('user-a', userASettings, {
    settingsModel: store.model,
  })
  await bettingSettingsService.updateBettingSettings('user-b', userBSettings, {
    settingsModel: store.model,
  })

  const userA = await bettingSettingsService.getBettingSettings('user-a', {
    settingsModel: store.model,
  })
  const userB = await bettingSettingsService.getBettingSettings('user-b', {
    settingsModel: store.model,
  })

  assert.deepEqual(userA.settings, userASettings)
  assert.deepEqual(userB.settings, userBSettings)
})

test('one user cannot overwrite another user betting settings', async () => {
  const store = createSettingsStore()
  const userBSettings = {
    ...validSettings,
    kellyMode: 'FULL',
  }

  await bettingSettingsService.updateBettingSettings('user-b', userBSettings, {
    settingsModel: store.model,
  })
  await bettingSettingsService.updateBettingSettings(
    'user-a',
    {
      ...validSettings,
      kellyMode: 'HALF',
    },
    { settingsModel: store.model },
  )

  const userB = await bettingSettingsService.getBettingSettings('user-b', {
    settingsModel: store.model,
  })

  assert.deepEqual(userB.settings, userBSettings)
})

test('all valid Kelly modes are accepted', () => {
  const modes = ['FULL', 'HALF', 'QUARTER', 'CUSTOM']

  modes.forEach((kellyMode) => {
    const result = bettingSettingsService.normalizeSettingsPayload({
      ...validSettings,
      kellyMode,
    })

    assert.equal(result.kellyMode, kellyMode)
  })
})

test('invalid Kelly mode is rejected with a field-specific error', () => {
  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        kellyMode: 'DOUBLE',
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.kellyMode.includes('FULL, HALF, QUARTER'),
  )
})

test('custom fraction is required and validated for CUSTOM mode', () => {
  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        customKellyFraction: '',
        kellyMode: 'CUSTOM',
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.customKellyFraction.includes('finite number'),
  )

  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        customKellyFraction: 1.01,
        kellyMode: 'CUSTOM',
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.customKellyFraction.includes('no more than 1'),
  )
})

test('maximum stake validation rejects non-positive and excessive values', () => {
  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        maximumStakePercent: 0,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.maximumStakePercent.includes('greater than 0'),
  )

  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        maximumStakePercent: 100.1,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.maximumStakePercent.includes('no more than 100'),
  )
})

test('minimum edge validation rejects values outside 0 to 100', () => {
  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        minimumEdgePercent: -0.1,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.minimumEdgePercent.includes('at least 0'),
  )
})

test('rounding option validation accepts only supported increments', () => {
  assert.equal(
    bettingSettingsService.normalizeSettingsPayload({
      ...validSettings,
      stakeRoundingIncrement: 1,
    }).stakeRoundingIncrement,
    1,
  )

  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        stakeRoundingIncrement: 0.2,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.stakeRoundingIncrement.includes('0.01'),
  )
})

test('bankroll basis validation accepts available/current only', () => {
  assert.equal(
    bettingSettingsService.normalizeSettingsPayload({
      ...validSettings,
      bankrollBasis: 'current',
    }).bankrollBasis,
    'CURRENT',
  )

  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        bankrollBasis: 'STARTING_BALANCE',
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.bankrollBasis.includes('AVAILABLE, CURRENT'),
  )
})

test('reset returns defaults and removes user-specific settings', async () => {
  const store = createSettingsStore()

  await bettingSettingsService.updateBettingSettings(
    'user-a',
    {
      ...validSettings,
      kellyMode: 'FULL',
    },
    { settingsModel: store.model },
  )

  const reset = await bettingSettingsService.resetBettingSettings('user-a', {
    settingsModel: store.model,
  })
  const afterReset = await bettingSettingsService.getBettingSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(reset.usingDefaults, true)
  assert.deepEqual(reset.settings, bettingSettingsService.DEFAULT_BETTING_SETTINGS)
  assert.deepEqual(
    afterReset.settings,
    bettingSettingsService.DEFAULT_BETTING_SETTINGS,
  )
})

test('BettingSettings does not duplicate bankroll balances or currency', () => {
  assert.equal(BettingSettings.schema.path('currency'), undefined)
  assert.equal(BettingSettings.schema.path('currentBankroll'), undefined)
  assert.equal(BettingSettings.schema.path('availableBankroll'), undefined)

  assert.throws(
    () =>
      bettingSettingsService.normalizeSettingsPayload({
        ...validSettings,
        currency: 'EUR',
        currentBankroll: 100,
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.unsupportedFields.includes('currency') &&
      error.details.unsupportedFields.includes('currentBankroll'),
  )
})

test('betting settings endpoint saves and reads only authenticated user settings', async () => {
  const userA = new mongoose.Types.ObjectId()
  const userB = new mongoose.Types.ObjectId()
  const tokenA = authService.signAuthToken(userA)
  const tokenB = authService.signAuthToken(userB)
  const settings = []

  await withPatches(
    [
      [
        BettingSettings,
        'findOne',
        (filter) =>
          queryOf(
            settings.find((setting) => sameUser(setting.userId, filter.userId)) ??
              null,
          ),
      ],
      [
        BettingSettings,
        'findOneAndUpdate',
        (filter, update) => {
          const existing = settings.find((setting) =>
            sameUser(setting.userId, filter.userId),
          )
          const document = {
            ...(existing ?? {}),
            ...(update.$setOnInsert ?? {}),
            ...(update.$set ?? {}),
            userId: filter.userId,
          }

          if (existing) {
            Object.assign(existing, document)
          } else {
            settings.push(document)
          }

          return queryOf(document)
        },
      ],
      [
        BettingSettings,
        'deleteOne',
        async (filter) => {
          const index = settings.findIndex((setting) =>
            sameUser(setting.userId, filter.userId),
          )

          if (index !== -1) {
            settings.splice(index, 1)
          }

          return { deletedCount: index === -1 ? 0 : 1 }
        },
      ],
    ],
    async () => {
      const payloadA = {
        ...validSettings,
        kellyMode: 'HALF',
      }
      const payloadB = {
        ...validSettings,
        bankrollBasis: 'CURRENT',
        maximumStakePercent: 8,
      }
      const saveA = await request('/api/settings/betting', {
        body: JSON.stringify({
          ...payloadA,
          userId: userB.toString(),
        }),
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })
      const retrySaveA = await request('/api/settings/betting', {
        body: JSON.stringify(payloadA),
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })
      const saveB = await request('/api/settings/betting', {
        body: JSON.stringify(payloadB),
        headers: {
          Authorization: `Bearer ${tokenB}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })
      const readA = await request('/api/settings/betting', {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      })

      assert.equal(saveA.status, 400)
      assert.equal(retrySaveA.status, 200)
      assert.equal(saveB.status, 200)
      assert.deepEqual(readA.body.settings, payloadA)
      assert.notDeepEqual(readA.body.settings, payloadB)
      assert.equal(settings.length, 2)
    },
  )
})
