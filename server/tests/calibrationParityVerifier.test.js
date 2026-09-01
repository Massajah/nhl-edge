const assert = require('node:assert/strict')
const test = require('node:test')
const {
  BASE_EXPERIMENTS,
  COMBINED_VALIDATION_EXPERIMENTS,
  TOLERANCE,
  buildBaseSpecialistPayload,
  compareGameSamples,
  compareMetrics,
  compareNumber,
} = require('../diagnostics/calibrationParityVerifier')
const { getRatingsForUser } = require('../services/powerRatingsService')

test('production calibration dependencies expose the user-scoped ratings reader', () => {
  assert.equal(typeof getRatingsForUser, 'function')
})

test('parity numbers distinguish exact equality from tolerance equality', () => {
  assert.deepEqual(compareNumber(0.25, 0.25), {
    absoluteDifference: 0,
    exact: true,
    legacy: 0.25,
    pass: true,
    unified: 0.25,
  })

  const withinTolerance = compareNumber(0.25 + TOLERANCE / 2, 0.25)
  assert.equal(withinTolerance.exact, false)
  assert.equal(withinTolerance.pass, true)

  const outsideTolerance = compareNumber(0.25 + TOLERANCE * 2, 0.25)
  assert.equal(outsideTolerance.exact, false)
  assert.equal(outsideTolerance.pass, false)
})

test('metric evidence reports each required metric independently', () => {
  const metrics = compareMetrics(
    {
      accuracy: { rate: 0.6 },
      brierScore: 0.2,
      expectedCalibrationError: 0.03,
      logLoss: 0.65,
    },
    {
      accuracy: 0.6,
      ece: 0.03,
      logLoss: 0.65,
      pooledBrier: 0.2,
    },
  )

  assert.deepEqual(Object.keys(metrics), [
    'pooledBrier',
    'logLoss',
    'accuracy',
    'ece',
  ])
  assert.equal(Object.values(metrics).every((metric) => metric.pass), true)
})

test('game sample evidence compares exact identifiers, not counts alone', () => {
  const comparison = compareGameSamples(['3', '1', '2'], ['1', '2', '4'])

  assert.equal(comparison.pass, false)
  assert.equal(comparison.unifiedGameCount, 3)
  assert.equal(comparison.legacyGameCount, 3)
  assert.deepEqual(comparison.extraIds, ['3'])
  assert.deepEqual(comparison.missingIds, ['4'])
})

test('Base-only parity covers the five representative Step 5 candidates with fixed 42–50 starts', () => {
  assert.deepEqual(
    BASE_EXPERIMENTS.map((candidate) => candidate.label),
    [
      'Probability Scale 18',
      'Base Home Advantage 4',
      'K Factor 1.1',
      'OT Multiplier 0.5',
      'SO Multiplier 0.2',
    ],
  )

  const payloads = BASE_EXPERIMENTS.map(buildBaseSpecialistPayload)

  assert.equal(
    payloads.every(
      (payload) =>
        payload.seasonIds.join(',') === '20232024,20242025,20252026' &&
        payload.startingRatings.center === 46 &&
        payload.startingRatings.spread === 8 &&
        payload.startingRatings.mode === 'fixed_spread',
    ),
    true,
  )
  assert.equal(payloads[0].probabilityScale, 18)
  assert.equal(payloads[1].homeAdvantage, 4)
  assert.equal(payloads[2].configuration.kFactor, 1.1)
  assert.equal(payloads[3].configuration.overtimeMultiplier, 0.5)
  assert.equal(payloads[4].configuration.shootoutMultiplier, 0.2)
})

test('Step 6 production validation uses a small explicit isolated and COMBINED set', () => {
  const combined = COMBINED_VALIDATION_EXPERIMENTS.filter(
    (candidate) => candidate.type === 'COMBINED',
  )
  const isolated = COMBINED_VALIDATION_EXPERIMENTS.filter(
    (candidate) => candidate.type !== 'COMBINED',
  )

  assert.equal(isolated.length, 4)
  assert.equal(combined.length, 2)
  assert.deepEqual(
    combined.map((candidate) => candidate.candidateId),
    ['combined-rest-quick', 'combined-ha-special'],
  )
  assert.equal(
    combined.every((candidate) =>
      candidate.components.length === 2 &&
      new Set(candidate.components.map((component) => component.type)).size === 2 &&
      candidate.components.every((component) => component.type !== 'BASE_MODEL')),
    true,
  )
})
