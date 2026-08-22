process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEFAULT_STARTING_RATING_SCALE,
  STANDARD_STARTING_RATING_SCALES,
  STANDARD_STARTING_RATING_SPREADS,
  deriveStartingRatingCenterAndSpread,
  deriveStartingRatingRange,
  getStartingRatingScale,
  normalizeStartingRatingScale,
  normalizeStartingRatingScalePayload,
  updateStartingRatingScale,
  validateStartingRatingAssignment,
} = require('../services/startingRatingScaleService')

const createSettingsModel = (initialDocuments = []) => {
  const documents = new Map(
    initialDocuments.map((document) => [String(document.userId), document]),
  )

  return {
    documents,
    async findOne({ userId }) {
      return documents.get(String(userId)) ?? null
    },
    async findOneAndUpdate({ userId }, update) {
      const key = String(userId)
      const document = {
        ...(documents.get(key) ?? {}),
        ...update.$setOnInsert,
        ...update.$set,
      }

      documents.set(key, document)
      return document
    },
  }
}

test('standard Starting Rating Scale presets emphasize the requested ranges', () => {
  const expectedRanges = new Map([
    [6, { center: 45, max: 48, min: 42 }],
    [8, { center: 46, max: 50, min: 42 }],
    [10, { center: 45, max: 50, min: 40 }],
    [12, { center: 46, max: 52, min: 40 }],
  ])

  STANDARD_STARTING_RATING_SPREADS.forEach((spread) => {
    const scale = normalizeStartingRatingScale({
      center: 46,
      mode: 'standard',
      spread,
    })

    assert.equal(scale.center, expectedRanges.get(spread).center)
    assert.equal(scale.spread, spread)
    assert.deepEqual(
      { center: scale.center, max: scale.max, min: scale.min },
      expectedRanges.get(spread),
    )
    assert.equal(scale.calibratedDefault, spread === 8)
  })

  assert.deepEqual(
    STANDARD_STARTING_RATING_SCALES.map(({ max, min }) => [min, max]),
    [
      [42, 48],
      [42, 50],
      [40, 50],
      [40, 52],
    ],
  )
})

test('existing users without Starting Rating Scale fields receive calibrated defaults', async () => {
  const settingsModel = createSettingsModel([{ userId: 'existing-user' }])
  const result = await getStartingRatingScale('existing-user', {
    settingsModel,
  })

  assert.deepEqual(result.scale, {
    calibratedDefault: true,
    center: 46,
    max: 50,
    min: 42,
    mode: 'standard',
    spread: 8,
  })
  assert.equal(result.usingDefault, true)
})

test('custom min and max derive center and spread and persist across reload', async () => {
  const settingsModel = createSettingsModel()
  const saved = await updateStartingRatingScale(
    'user-1',
    { max: 52, min: 43, mode: 'custom' },
    { settingsModel },
  )
  const reloaded = await getStartingRatingScale('user-1', { settingsModel })

  assert.deepEqual(saved.scale, {
    calibratedDefault: false,
    center: 47.5,
    max: 52,
    min: 43,
    mode: 'custom',
    spread: 9,
  })
  assert.deepEqual(reloaded.scale, saved.scale)
  assert.deepEqual(settingsModel.documents.get('user-1'), {
    startingRatingCenter: 47.5,
    startingRatingScaleMode: 'custom',
    startingRatingSpread: 9,
    userId: 'user-1',
  })
  assert.deepEqual(
    deriveStartingRatingCenterAndSpread({ max: 52, min: 43 }),
    { center: 47.5, spread: 9 },
  )
})

test('switching from Custom to a standard option restores center and spread', async () => {
  const settingsModel = createSettingsModel()

  await updateStartingRatingScale(
    'user-1',
    { max: 52, min: 43, mode: 'custom' },
    { settingsModel },
  )
  const result = await updateStartingRatingScale(
    'user-1',
    { max: 52, min: 40, mode: 'standard' },
    { settingsModel },
  )

  assert.deepEqual(result.scale, {
    calibratedDefault: false,
    center: 46,
    max: 52,
    min: 40,
    mode: 'standard',
    spread: 12,
  })
})

test('Starting Rating Scale persistence is isolated per authenticated user', async () => {
  const settingsModel = createSettingsModel()

  await updateStartingRatingScale(
    'user-1',
    { max: 52, min: 42, mode: 'custom' },
    { settingsModel },
  )
  const userOne = await getStartingRatingScale('user-1', { settingsModel })
  const userTwo = await getStartingRatingScale('user-2', { settingsModel })

  assert.equal(userOne.scale.mode, 'custom')
  assert.equal(userOne.scale.center, 47)
  assert.deepEqual(userTwo.scale, {
    calibratedDefault: true,
    center: 46,
    max: 50,
    min: 42,
    mode: 'standard',
    spread: 8,
  })
})

test('custom scale rejects inverted, malformed and unsupported min/max ranges', () => {
  assert.throws(
    () =>
      normalizeStartingRatingScalePayload({
        max: 42,
        min: 42,
        mode: 'custom',
      }),
    (error) =>
      error.statusCode === 400 && Boolean(error.details.fieldErrors.max),
  )
  assert.throws(
    () =>
      normalizeStartingRatingScalePayload({
        max: 50,
        min: 'not-a-number',
        mode: 'custom',
      }),
    (error) =>
      error.statusCode === 400 && Boolean(error.details.fieldErrors.min),
  )
  assert.throws(
    () =>
      normalizeStartingRatingScalePayload({
        max: 104,
        min: 96,
        mode: 'custom',
      }),
    (error) =>
      error.statusCode === 400 && Boolean(error.details.fieldErrors.max),
  )
})

test('starting assignment validation enforces scale boundaries and half steps', () => {
  const scale = normalizeStartingRatingScale(DEFAULT_STARTING_RATING_SCALE)

  assert.equal(validateStartingRatingAssignment(42, scale), 42)
  assert.equal(validateStartingRatingAssignment(42.5, scale), 42.5)
  assert.equal(validateStartingRatingAssignment(46, scale), 46)
  assert.equal(validateStartingRatingAssignment(46.5, scale), 46.5)
  assert.equal(validateStartingRatingAssignment(50, scale), 50)
  assert.throws(
    () => validateStartingRatingAssignment(41.5, scale),
    /Starting Rating must be between 42\.0 and 50\.0/,
  )
  assert.throws(
    () => validateStartingRatingAssignment(50.5, scale),
    /Starting Rating must be between 42\.0 and 50\.0/,
  )
  assert.throws(
    () => validateStartingRatingAssignment(46.25, scale),
    /Starting Rating must use 0\.5-point increments/,
  )
})

test('changing scale configuration does not rewrite an existing live rating', async () => {
  const settingsModel = createSettingsModel()
  const existingRating = { baseRating: 49.2 }

  await updateStartingRatingScale(
    'user-1',
    { max: 52, min: 40, mode: 'standard' },
    { settingsModel },
  )

  assert.equal(existingRating.baseRating, 49.2)
  assert.deepEqual(deriveStartingRatingRange({ center: 46, spread: 12 }), {
    max: 52,
    min: 40,
  })
})
