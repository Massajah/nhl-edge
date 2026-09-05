process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const {
  factoryResetUserData,
  resetForNewSeason,
  resetSettingsToDefaults,
} = require('../services/userDataResetService')

const USER_ID = 'authenticated-user'

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)

    return response.status
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const createDeleteModel = (name, calls, deletedCount = 1) => ({
  async deleteMany(filter, options) {
    calls.push({ filter, method: 'deleteMany', name, options })
    return { deletedCount }
  },
  async deleteOne(filter, options) {
    calls.push({ filter, method: 'deleteOne', name, options })
    return { deletedCount }
  },
})

const createModels = (calls, deletedCount = 1) => {
  const names = [
    'BankrollProfile',
    'BankrollTransaction',
    'Bet',
    'BettingSettings',
    'BookmakerPreferences',
    'GameContext',
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
  ]
  const models = Object.fromEntries(
    names.map((name) => [name, createDeleteModel(name, calls, deletedCount)]),
  )

  // Global market-history collections are intentionally outside every
  // authenticated user reset scope.
  models.OddsSnapshot = createDeleteModel('OddsSnapshot', calls, deletedCount)
  models.OddsCaptureRun = createDeleteModel(
    'OddsCaptureRun',
    calls,
    deletedCount,
  )
  models.OddsQuotaLedger = createDeleteModel(
    'OddsQuotaLedger',
    calls,
    deletedCount,
  )
  models.ScheduledJobLease = createDeleteModel(
    'ScheduledJobLease',
    calls,
    deletedCount,
  )

  models.PowerRatingSettings.findOne = async (filter, _projection, options) => {
    calls.push({ filter, method: 'findOne', name: 'PowerRatingSettings', options })
    return {
      startingRatingCenter: 47,
      startingRatingScaleMode: 'custom',
      startingRatingSpread: 10,
    }
  }

  return models
}

const createOptions = (models, overrides = {}) => ({
  logger: { info() {} },
  models,
  runInTransaction: (work) => work('test-session'),
  ...overrides,
})

test('all reset lifecycle endpoints require authentication', async () => {
  const paths = [
    '/api/settings/reset/settings',
    '/api/settings/reset/new-season',
    '/api/settings/reset/factory',
  ]
  const statuses = await Promise.all(
    paths.map((path) =>
      request(path, {
        body: JSON.stringify({ confirmation: 'DELETE' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    ),
  )

  assert.deepEqual(statuses, [401, 401, 401])
})

test('settings reset deletes only canonical user settings documents', async () => {
  const calls = []
  const result = await resetSettingsToDefaults(
    USER_ID,
    createOptions(createModels(calls)),
  )

  assert.equal(result.success, true)
  assert.equal(result.defaults.startingRatingScale.min, 42)
  assert.equal(result.defaults.startingRatingScale.max, 50)
  assert.deepEqual(
    calls.map(({ name }) => name).sort(),
    [
      'BettingSettings',
      'BookmakerPreferences',
      'PowerRatingSettings',
      'QuickRematchSettings',
      'RatingEngineSettings',
    ],
  )
  assert.equal(
    calls.every(({ filter, options }) =>
      filter.userId === USER_ID && options.session === 'test-session'
    ),
    true,
  )
  assert.equal(result.preserved.includes('bets'), true)
  assert.equal(result.preserved.includes('historicalDatasets'), true)
})

test('new season reset preserves settings and betting data while clearing season state', async () => {
  const calls = []
  let ratingReset = null
  const models = createModels(calls)
  const result = await resetForNewSeason(
    USER_ID,
    createOptions(models, {
      resetPowerRatings: async (userId, options) => {
        ratingReset = { options, userId }
        return { totalTeams: 32 }
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
    }),
  )

  assert.equal(result.success, true)
  assert.equal(result.seasonId, '20262027')
  assert.equal(result.startingRatingScale.min, 42)
  assert.equal(result.startingRatingScale.max, 52)
  assert.equal(ratingReset.userId, USER_ID)
  assert.equal(ratingReset.options.startingRatingScale.center, 47)
  assert.equal(ratingReset.options.clearSeasonStartingRating, true)
  assert.equal(ratingReset.options.session, 'test-session')
  assert.deepEqual(
    calls.map(({ name, method }) => `${name}.${method}`),
    [
      'PowerRatingSettings.findOne',
      'GameContext.deleteMany',
      'Injury.deleteMany',
      'ProcessedRatingGame.deleteMany',
    ],
  )
  const historyCall = calls.find(
    ({ name }) => name === 'ProcessedRatingGame',
  )

  assert.equal(historyCall.filter.userId, USER_ID)
  assert.equal(
    historyCall.filter.gameDate.$gte.toISOString(),
    '2026-10-01T00:00:00.000Z',
  )
  assert.equal(
    historyCall.filter.gameDate.$lte.toISOString(),
    '2027-04-30T23:59:59.999Z',
  )
  assert.equal(result.preserved.includes('settings'), true)
  assert.equal(result.preserved.includes('bets'), true)
  assert.equal(result.preserved.includes('bankroll'), true)
})

test('factory reset requires exact typed confirmation before deleting anything', async () => {
  const calls = []
  const options = createOptions(createModels(calls))

  await assert.rejects(
    () => factoryResetUserData(USER_ID, { confirmation: 'reset' }, options),
    (error) => error.statusCode === 400,
  )
  assert.equal(calls.length, 0)
})

test('factory reset deletes every user-owned store without touching shared history', async () => {
  const calls = []
  const result = await factoryResetUserData(
    USER_ID,
    { confirmation: 'DELETE', userId: 'another-user' },
    createOptions(createModels(calls)),
  )

  assert.equal(result.success, true)
  assert.equal(result.defaults.startingRatingScale.min, 42)
  assert.equal(result.defaults.startingRatingScale.max, 50)
  assert.equal(calls.length, 16)
  assert.equal(
    calls.some(({ name }) => name === 'RatingLabPromotionAudit'),
    true,
  )
  assert.equal(
    calls.every(
      ({ filter, options }) =>
        filter.userId === USER_ID &&
        options.session === 'test-session' &&
        filter.userId !== 'another-user',
    ),
    true,
  )
  assert.deepEqual(result.preserved, [
    'account',
    'historicalNhlGames',
    'historicalSeasonDatasets',
    'historicalSpecialTeamsSeasons',
    'providerCaches',
  ])
  assert.equal(
    calls.some(({ name }) => name.startsWith('Historical')),
    false,
  )
  assert.equal(calls.some(({ name }) => name === 'OddsSnapshot'), false)
  assert.equal(calls.some(({ name }) => name === 'OddsCaptureRun'), false)
  assert.equal(calls.some(({ name }) => name === 'OddsQuotaLedger'), false)
  assert.equal(calls.some(({ name }) => name === 'ScheduledJobLease'), false)
})

test('factory reset is idempotent when the user is already fresh', async () => {
  const calls = []
  const result = await factoryResetUserData(
    USER_ID,
    { confirmation: 'DELETE' },
    createOptions(createModels(calls, 0)),
  )

  assert.equal(result.success, true)
  assert.equal(Object.values(result.counts).every((count) => count === 0), true)
})
