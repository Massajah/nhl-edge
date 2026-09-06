process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  getRatingEngineSettings,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
  updateRatingEngineModelAdjustments,
  updateRatingEngineParameters,
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
  maximumGoaliePenalty: -3.5,
  maximumPlayerInjuryPenalty: -2.5,
  probabilityScale: 18,
  regulationMultiplier: 1,
  specialTeamsAdjustment: 0.5,
  specialTeamsAlertsEnabled: true,
  specialTeamsMode: 'alert_only',
  specialTeamsRankThreshold: 6,
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
  assert.deepEqual(BASE_MODEL_V1.startingRatings, {
    center: 46,
    max: 50,
    min: 42,
    spread: 8,
  })
  assert.deepEqual(result.settings, {
    homeAdvantage: 3.5,
    kFactor: 1.3,
    maximumGoaliePenalty: -4,
    maximumPlayerInjuryPenalty: -2.5,
    overtimeMultiplier: 0.4,
    probabilityScale: 20,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.1,
    specialTeamsAdjustment: 0.5,
    specialTeamsAlertsEnabled: true,
    specialTeamsMode: 'alert_only',
    specialTeamsRankThreshold: 6,
  })
})

test('new Mongoose settings documents receive calibrated field defaults', () => {
  const document = new RatingEngineSettings({
    userId: new mongoose.Types.ObjectId(),
  })

  assert.equal(document.kFactor, 1.3)
  assert.equal(document.homeAdvantage, 3.5)
  assert.equal(document.maximumGoaliePenalty, -4)
  assert.equal(document.maximumPlayerInjuryPenalty, -2.5)
  assert.equal(document.probabilityScale, 20)
  assert.equal(document.regulationMultiplier, 1)
  assert.equal(document.overtimeMultiplier, 0.4)
  assert.equal(document.shootoutMultiplier, 0.1)
  assert.equal(document.specialTeamsAdjustment, 0.5)
  assert.equal(document.specialTeamsAlertsEnabled, true)
  assert.equal(document.specialTeamsMode, 'alert_only')
  assert.equal(document.specialTeamsRankThreshold, 6)
})

test('older partial settings documents receive only missing calibrated defaults', async () => {
  const store = makeSettingsStore()

  store.settingsByUser.set('user-a', {
    homeAdvantage: 5.25,
    kFactor: 0.95,
    userId: 'user-a',
  })

  const result = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(result.usingDefaults, false)
  assert.equal(result.settings.homeAdvantage, 5.25)
  assert.equal(result.settings.kFactor, 0.95)
  assert.equal(result.settings.maximumGoaliePenalty, -4)
  assert.equal(result.settings.maximumPlayerInjuryPenalty, -2.5)
  assert.equal(result.settings.probabilityScale, 20)
  assert.equal(result.settings.overtimeMultiplier, 0.4)
  assert.equal(result.settings.shootoutMultiplier, 0.1)
  assert.equal(result.settings.specialTeamsAdjustment, 0.5)
  assert.equal(result.settings.specialTeamsAlertsEnabled, true)
  assert.equal(result.settings.specialTeamsMode, 'alert_only')
  assert.equal(result.settings.specialTeamsRankThreshold, 6)
})

test('legacy Special Teams enabled state maps to a canonical mode', async () => {
  const store = makeSettingsStore()

  store.settingsByUser.set('disabled-user', {
    specialTeamsAlertsEnabled: false,
    specialTeamsRankThreshold: 8,
    userId: 'disabled-user',
  })

  const disabled = await getRatingEngineSettings('disabled-user', {
    settingsModel: store.model,
  })
  const missing = await getRatingEngineSettings('missing-user', {
    settingsModel: store.model,
  })

  assert.equal(disabled.settings.specialTeamsMode, 'off')
  assert.equal(disabled.settings.specialTeamsAlertsEnabled, false)
  assert.equal(disabled.settings.specialTeamsRankThreshold, 8)
  assert.equal(disabled.settings.specialTeamsAdjustment, 0.5)
  assert.equal(missing.settings.specialTeamsMode, 'alert_only')
})

test('Mongoose schema defaults do not mask a legacy disabled state', async () => {
  const legacyDocument = new RatingEngineSettings({
    specialTeamsAlertsEnabled: false,
    userId: new mongoose.Types.ObjectId(),
  })
  const result = await getRatingEngineSettings(legacyDocument.userId, {
    settingsModel: {
      findOne() {
        return queryOf(legacyDocument)
      },
    },
  })

  assert.equal(legacyDocument.$isDefault('specialTeamsMode'), true)
  assert.equal(result.settings.specialTeamsMode, 'off')
  assert.equal(result.settings.specialTeamsAlertsEnabled, false)
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

test('legacy updates that omit Probability Scale preserve its saved custom value', async () => {
  const store = makeSettingsStore()

  await updateRatingEngineSettings(
    'user-a',
    makeSettingsPayload({ probabilityScale: 13 }),
    { settingsModel: store.model },
  )

  const legacyPayload = makeSettingsPayload({ kFactor: 1.8 })
  delete legacyPayload.probabilityScale

  const result = await updateRatingEngineSettings('user-a', legacyPayload, {
    settingsModel: store.model,
  })

  assert.equal(result.settings.kFactor, 1.8)
  assert.equal(result.settings.probabilityScale, 13)
})

test('legacy updates missing Maximum Goalie Penalty receive or preserve its value', async () => {
  const store = makeSettingsStore()
  const initialPayload = makeSettingsPayload({ maximumGoaliePenalty: -3.25 })

  await updateRatingEngineSettings('user-a', initialPayload, {
    settingsModel: store.model,
  })

  const legacyPayload = makeSettingsPayload({ kFactor: 1.8 })
  delete legacyPayload.maximumGoaliePenalty

  const saved = await updateRatingEngineSettings('user-a', legacyPayload, {
    settingsModel: store.model,
  })
  const missingDocument = await getRatingEngineSettings('user-b', {
    settingsModel: store.model,
  })

  assert.equal(saved.settings.maximumGoaliePenalty, -3.25)
  assert.equal(missingDocument.settings.maximumGoaliePenalty, -4)
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

  await assert.rejects(
    () =>
      updateRatingEngineSettings(
        'user-a',
        makeSettingsPayload({ probabilityScale: 51 }),
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.probabilityScale.includes('no more than 50'),
  )

  for (const maximumGoaliePenalty of [0.05, -5.05]) {
    await assert.rejects(
      () =>
        updateRatingEngineSettings(
          'user-a',
          makeSettingsPayload({ maximumGoaliePenalty }),
          { settingsModel: store.model },
        ),
      (error) =>
        error.statusCode === 400 &&
        Boolean(error.details.fieldErrors.maximumGoaliePenalty),
    )
  }

  for (const maximumPlayerInjuryPenalty of [0.5, -5.5, -2.25]) {
    await assert.rejects(
      () =>
        updateRatingEngineSettings(
          'user-a',
          makeSettingsPayload({ maximumPlayerInjuryPenalty }),
          { settingsModel: store.model },
        ),
      (error) =>
        error.statusCode === 400 &&
        Boolean(error.details.fieldErrors.maximumPlayerInjuryPenalty),
    )
  }
})

test('valid configurable negative Maximum Goalie Penalty persists per user', async () => {
  const store = makeSettingsStore()

  await updateRatingEngineSettings(
    'user-a',
    makeSettingsPayload({ maximumGoaliePenalty: -2.75 }),
    { settingsModel: store.model },
  )
  await updateRatingEngineSettings(
    'user-b',
    makeSettingsPayload({ maximumGoaliePenalty: -4.5 }),
    { settingsModel: store.model },
  )

  const userA = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })
  const userB = await getRatingEngineSettings('user-b', {
    settingsModel: store.model,
  })

  assert.equal(userA.settings.maximumGoaliePenalty, -2.75)
  assert.equal(userB.settings.maximumGoaliePenalty, -4.5)
})

test('Maximum Player Injury Penalty defaults and persists per user through Model Adjustments', async () => {
  const store = makeSettingsStore()

  const userA = await updateRatingEngineModelAdjustments(
    'user-a',
    {
      homeAdvantage: 3.5,
      maximumPlayerInjuryPenalty: -1.5,
    },
    { settingsModel: store.model },
  )
  const userB = await getRatingEngineSettings('user-b', {
    settingsModel: store.model,
  })

  assert.equal(userA.settings.maximumPlayerInjuryPenalty, -1.5)
  assert.equal(userB.settings.maximumPlayerInjuryPenalty, -2.5)
  assert.equal(store.settingsByUser.size, 1)
})

test('null and non-numeric settings values are rejected', async () => {
  const store = makeSettingsStore()

  await assert.rejects(
    () =>
      updateRatingEngineSettings(
        'user-a',
        makeSettingsPayload({
          overtimeMultiplier: 'abc',
          probabilityScale: Number.POSITIVE_INFINITY,
          shootoutMultiplier: null,
        }),
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.overtimeMultiplier.includes('finite number') &&
      error.details.fieldErrors.probabilityScale.includes('finite number') &&
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

test('scoped resets keep unrelated Settings values unchanged', async () => {
  const store = makeSettingsStore()
  const customSettings = makeSettingsPayload({
    homeAdvantage: 6.25,
    kFactor: 2.1,
    maximumPlayerInjuryPenalty: -1.5,
    probabilityScale: 14,
    specialTeamsAdjustment: 0.75,
    specialTeamsAlertsEnabled: false,
    specialTeamsMode: 'off',
    specialTeamsRankThreshold: 10,
  })

  await updateRatingEngineSettings('user-a', customSettings, {
    settingsModel: store.model,
  })

  const engineReset = await resetRatingEngineSettings('user-a', {
    scope: 'engine',
    settingsModel: store.model,
  })

  assert.equal(engineReset.settings.homeAdvantage, 6.25)
  assert.equal(engineReset.settings.kFactor, 1.3)
  assert.equal(engineReset.settings.maximumGoaliePenalty, -3.5)
  assert.equal(engineReset.settings.maximumPlayerInjuryPenalty, -1.5)
  assert.equal(engineReset.settings.probabilityScale, 20)
  assert.equal(engineReset.settings.specialTeamsAdjustment, 0.75)
  assert.equal(engineReset.settings.specialTeamsAlertsEnabled, false)
  assert.equal(engineReset.settings.specialTeamsMode, 'off')
  assert.equal(engineReset.settings.specialTeamsRankThreshold, 10)
  assert.equal(engineReset.settings.regulationMultiplier, 1)
  assert.equal(engineReset.settings.overtimeMultiplier, 0.4)
  assert.equal(engineReset.settings.shootoutMultiplier, 0.1)

  const modelReset = await resetRatingEngineSettings('user-a', {
    scope: 'model-adjustments',
    settingsModel: store.model,
  })

  assert.equal(modelReset.settings.homeAdvantage, 3.5)
  assert.equal(modelReset.settings.maximumGoaliePenalty, -4)
  assert.equal(modelReset.settings.maximumPlayerInjuryPenalty, -2.5)
  assert.equal(modelReset.settings.probabilityScale, 20)
  assert.equal(modelReset.settings.specialTeamsAdjustment, 0.5)
  assert.equal(modelReset.settings.specialTeamsAlertsEnabled, true)
  assert.equal(modelReset.settings.specialTeamsMode, 'alert_only')
  assert.equal(modelReset.settings.specialTeamsRankThreshold, 6)
})

test('Model Adjustment guardrails save without changing engine parameters', async () => {
  const store = makeSettingsStore()
  const original = makeSettingsPayload({
    homeAdvantage: 3.5,
    kFactor: 2.2,
    probabilityScale: 14,
  })
  await updateRatingEngineSettings('user-a', original, {
    settingsModel: store.model,
  })

  const result = await updateRatingEngineModelAdjustments(
    'user-a',
    {
      homeAdvantage: 4.25,
      maximumGoaliePenalty: -2.75,
      maximumPlayerInjuryPenalty: -1.5,
    },
    { settingsModel: store.model },
  )

  assert.equal(result.settings.homeAdvantage, 4.25)
  assert.equal(result.settings.maximumGoaliePenalty, -2.75)
  assert.equal(result.settings.maximumPlayerInjuryPenalty, -1.5)
  assert.equal(result.settings.kFactor, 2.2)
  assert.equal(result.settings.probabilityScale, 14)
  assert.equal(store.settingsByUser.size, 1)
})

test('Special Teams settings persist mode, threshold, and magnitude', async () => {
  const store = makeSettingsStore()

  const result = await updateRatingEngineModelAdjustments(
    'user-a',
    {
      homeAdvantage: 3.5,
      specialTeamsAdjustment: 0.75,
      specialTeamsMode: 'automatic',
      specialTeamsRankThreshold: 10,
    },
    { settingsModel: store.model },
  )
  const loaded = await getRatingEngineSettings('user-a', {
    settingsModel: store.model,
  })

  assert.equal(result.settings.specialTeamsAdjustment, 0.75)
  assert.equal(result.settings.specialTeamsAlertsEnabled, true)
  assert.equal(result.settings.specialTeamsMode, 'automatic')
  assert.equal(result.settings.specialTeamsRankThreshold, 10)
  assert.equal(loaded.settings.specialTeamsAdjustment, 0.75)
  assert.equal(loaded.settings.specialTeamsAlertsEnabled, true)
  assert.equal(loaded.settings.specialTeamsMode, 'automatic')
  assert.equal(loaded.settings.specialTeamsRankThreshold, 10)
})

test('Special Teams alert threshold accepts 3 through 12 and rejects invalid values', async () => {
  const store = makeSettingsStore()

  for (const threshold of [3, 12]) {
    const result = await updateRatingEngineModelAdjustments(
      'user-a',
      {
        homeAdvantage: 3.5,
        specialTeamsAlertsEnabled: true,
        specialTeamsRankThreshold: threshold,
      },
      { settingsModel: store.model },
    )

    assert.equal(result.settings.specialTeamsRankThreshold, threshold)
  }

  for (const threshold of [2, 13, 6.5, 'not-a-rank']) {
    await assert.rejects(
      () =>
        updateRatingEngineModelAdjustments(
          'user-a',
          {
            homeAdvantage: 3.5,
            specialTeamsAlertsEnabled: true,
            specialTeamsRankThreshold: threshold,
          },
          { settingsModel: store.model },
        ),
      (error) =>
        error.statusCode === 400 &&
        Boolean(error.details.fieldErrors.specialTeamsRankThreshold),
    )
  }

  await assert.rejects(
    () =>
      updateRatingEngineModelAdjustments(
        'user-a',
        {
          homeAdvantage: 3.5,
          specialTeamsAlertsEnabled: 'false',
          specialTeamsRankThreshold: 6,
        },
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.specialTeamsAlertsEnabled.includes('boolean'),
  )
})

test('legacy Model Adjustments saves preserve explicit Special Teams values', async () => {
  const store = makeSettingsStore()
  const legacySettings = makeSettingsPayload({
    specialTeamsAlertsEnabled: false,
    specialTeamsRankThreshold: 8,
  })

  delete legacySettings.specialTeamsAdjustment
  delete legacySettings.specialTeamsMode

  await updateRatingEngineSettings(
    'user-a',
    legacySettings,
    { settingsModel: store.model },
  )
  const result = await updateRatingEngineModelAdjustments(
    'user-a',
    { homeAdvantage: 4.25 },
    { settingsModel: store.model },
  )

  assert.equal(result.settings.homeAdvantage, 4.25)
  assert.equal(result.settings.maximumGoaliePenalty, -3.5)
  assert.equal(result.settings.maximumPlayerInjuryPenalty, -2.5)
  assert.equal(result.settings.specialTeamsAdjustment, 0.5)
  assert.equal(result.settings.specialTeamsAlertsEnabled, false)
  assert.equal(result.settings.specialTeamsMode, 'off')
  assert.equal(result.settings.specialTeamsRankThreshold, 8)
})

test('Power Rating Engine scoped save cannot own Base Home Advantage', async () => {
  const store = makeSettingsStore()
  await updateRatingEngineSettings('user-a', makeSettingsPayload(), {
    settingsModel: store.model,
  })

  await assert.rejects(
    () => updateRatingEngineParameters(
      'user-a',
      {
        homeAdvantage: 9,
        kFactor: 1.4,
        overtimeMultiplier: 0.4,
        probabilityScale: 20,
        regulationMultiplier: 1,
        shootoutMultiplier: 0.1,
      },
      { settingsModel: store.model },
    ),
    (error) => error.statusCode === 400 &&
      error.details.unsupportedFields.includes('homeAdvantage'),
  )
})

test('Power Rating Engine scoped save cannot own Maximum Goalie Penalty', async () => {
  const store = makeSettingsStore()
  await updateRatingEngineSettings('user-a', makeSettingsPayload(), {
    settingsModel: store.model,
  })

  await assert.rejects(
    () =>
      updateRatingEngineParameters(
        'user-a',
        {
          kFactor: 1.4,
          maximumGoaliePenalty: -2.5,
          overtimeMultiplier: 0.4,
          probabilityScale: 20,
          regulationMultiplier: 1,
          shootoutMultiplier: 0.1,
        },
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.unsupportedFields.includes('maximumGoaliePenalty'),
  )
})

test('Power Rating Engine scoped save cannot own Maximum Player Injury Penalty', async () => {
  const store = makeSettingsStore()
  await updateRatingEngineSettings('user-a', makeSettingsPayload(), {
    settingsModel: store.model,
  })

  await assert.rejects(
    () =>
      updateRatingEngineParameters(
        'user-a',
        {
          kFactor: 1.4,
          maximumPlayerInjuryPenalty: -1.5,
          overtimeMultiplier: 0.4,
          probabilityScale: 20,
          regulationMultiplier: 1,
          shootoutMultiplier: 0.1,
        },
        { settingsModel: store.model },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.details.unsupportedFields.includes(
        'maximumPlayerInjuryPenalty',
      ),
  )
})

test('settings endpoint saves and reads only the authenticated user settings', async () => {
  const userA = new mongoose.Types.ObjectId().toString()
  const userB = new mongoose.Types.ObjectId().toString()
  const tokenA = authSessionService.createTestAuthSession(userA)
  const tokenB = authSessionService.createTestAuthSession(userB)
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
          Cookie: `nhl_edge_session=${tokenA}`,
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        method: 'PUT',
      })
      const saveB = await request('/api/settings/rating-engine', {
        body: JSON.stringify(payloadB),
        headers: {
          Cookie: `nhl_edge_session=${tokenB}`,
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        method: 'PUT',
      })
      const readA = await request('/api/settings/rating-engine', {
        headers: {
          Cookie: `nhl_edge_session=${tokenA}`,
        },
      })
      const modelAdjustmentsSave = await request(
        '/api/settings/rating-engine/model-adjustments',
        {
          body: JSON.stringify({ homeAdvantage: 4.75 }),
          headers: {
            Cookie: `nhl_edge_session=${tokenA}`,
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          method: 'PUT',
        },
      )
      const readAfterModelSave = await request('/api/settings/rating-engine', {
        headers: {
          Cookie: `nhl_edge_session=${tokenA}`,
        },
      })

      assert.equal(saveA.status, 200)
      assert.equal(saveB.status, 200)
      assert.deepEqual(readA.body.settings, payloadA)
      assert.equal(modelAdjustmentsSave.status, 200)
      assert.equal(readAfterModelSave.body.settings.homeAdvantage, 4.75)
      assert.equal(readAfterModelSave.body.settings.kFactor, payloadA.kFactor)
      assert.equal(
        readAfterModelSave.body.settings.probabilityScale,
        payloadA.probabilityScale,
      )
      assert.equal(settings.length, 2)
    },
  )
})
