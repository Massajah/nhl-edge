import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_STARTING_RATING_SCALE,
  STANDARD_STARTING_RATING_SCALES,
  createStartingRatingScaleDraft,
  deriveStartingRatingCenterAndSpread,
  deriveStartingRatingRange,
  isStartingRatingScaleDirty,
  isStartingRatingWithinScale,
  normalizeStartingRatingScale,
  parseStartingRatingScaleDraft,
} from '../utils/startingRatingScale.js'

test('standard Starting Rating Scales derive the supported range-first presets', () => {
  const expected = new Map([
    [6, { center: 45, max: 48, min: 42 }],
    [8, { center: 46, max: 50, min: 42 }],
    [10, { center: 45, max: 50, min: 40 }],
    [12, { center: 46, max: 52, min: 40 }],
  ])

  STANDARD_STARTING_RATING_SCALES.forEach((option) => {
    const scale = normalizeStartingRatingScale({
      center: option.center,
      mode: 'standard',
      spread: option.spread,
    })

    assert.equal(scale.center, expected.get(option.spread).center)
    assert.equal(scale.spread, option.spread)
    assert.deepEqual(
      { center: scale.center, max: scale.max, min: scale.min },
      expected.get(option.spread),
    )
    assert.equal(scale.calibratedDefault, option.spread === 8)
  })

  assert.deepEqual(
    STANDARD_STARTING_RATING_SCALES.map((option) => option.label),
    ['42–48', '42–50 · Calibrated default', '40–50', '40–52'],
  )
})

test('missing or malformed saved scale normalizes to calibrated 42–50 default', () => {
  assert.deepEqual(normalizeStartingRatingScale({}), {
    calibratedDefault: true,
    center: 46,
    max: 50,
    min: 42,
    mode: 'standard',
    spread: 8,
  })
  assert.deepEqual(
    createStartingRatingScaleDraft(DEFAULT_STARTING_RATING_SCALE),
    { max: '50', min: '42', mode: 'standard', preset: '42-50' },
  )
})

test('valid Custom min and max derive center and spread', () => {
  const result = parseStartingRatingScaleDraft({
    max: '52',
    min: '43',
    mode: 'custom',
    preset: 'custom',
  })

  assert.equal(result.isValid, true)
  assert.deepEqual(result.scale, {
    calibratedDefault: false,
    center: 47.5,
    max: 52,
    min: 43,
    mode: 'custom',
    spread: 9,
  })
  assert.deepEqual(deriveStartingRatingRange(result.scale), {
    max: 52,
    min: 43,
  })
  assert.deepEqual(
    deriveStartingRatingCenterAndSpread({ max: 52, min: 43 }),
    { center: 47.5, spread: 9 },
  )
})

test('Custom scale rejects inverted, malformed and unsupported ranges', () => {
  const inverted = parseStartingRatingScaleDraft({
    max: '42',
    min: '42',
    mode: 'custom',
    preset: 'custom',
  })
  const malformed = parseStartingRatingScaleDraft({
    max: '50',
    min: 'abc',
    mode: 'custom',
    preset: 'custom',
  })
  const unsupportedRange = parseStartingRatingScaleDraft({
    max: '104',
    min: '96',
    mode: 'custom',
    preset: 'custom',
  })

  assert.equal(inverted.isValid, false)
  assert.match(inverted.fieldErrors.max, /greater than the minimum/)
  assert.equal(malformed.isValid, false)
  assert.match(malformed.fieldErrors.min, /must be a number/)
  assert.equal(unsupportedRange.isValid, false)
  assert.match(unsupportedRange.fieldErrors.max, /stay between 0 and 100/)
})

test('starting assignment boundary validation is inclusive', () => {
  assert.equal(isStartingRatingWithinScale(42, DEFAULT_STARTING_RATING_SCALE), true)
  assert.equal(isStartingRatingWithinScale(46, DEFAULT_STARTING_RATING_SCALE), true)
  assert.equal(isStartingRatingWithinScale(50, DEFAULT_STARTING_RATING_SCALE), true)
  assert.equal(isStartingRatingWithinScale(41.99, DEFAULT_STARTING_RATING_SCALE), false)
  assert.equal(isStartingRatingWithinScale(50.01, DEFAULT_STARTING_RATING_SCALE), false)
})

test('switching standard scales is dirty without mutating saved configuration', () => {
  const saved = { ...DEFAULT_STARTING_RATING_SCALE }
  const draft = {
    max: '52',
    min: '40',
    mode: 'standard',
    preset: '40-52',
  }

  assert.equal(isStartingRatingScaleDirty(draft, saved), true)
  assert.equal(saved.spread, 8)
  assert.equal(saved.min, 42)
  assert.equal(saved.max, 50)
})
