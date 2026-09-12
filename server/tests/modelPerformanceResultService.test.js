process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  RESULT_SOURCE,
  resolvePredictionResult,
  resolvePredictionResults,
} = require('../services/modelPerformanceResultService')

const START = '2026-10-08T19:00:00.000Z'
const makePrediction = (overrides = {}) => ({
  awayTeamId: 'COL',
  gameId: '2026020001',
  gameType: 2,
  homeTeamId: 'BOS',
  scheduledStartAtCapture: START,
  seasonId: '20262027',
  ...overrides,
})
const makeGame = (overrides = {}) => ({
  awayTeam: { abbreviation: 'COL', score: 2 },
  gameId: '2026020001',
  gameState: 'FINAL',
  gameType: 2,
  homeTeam: { abbreviation: 'BOS', score: 3 },
  season: '20262027',
  startTimeUTC: START,
  status: 'Final',
  ...overrides,
})

test('canonical result resolution scores regulation, overtime and shootout winners normally', () => {
  for (const gameOutcome of [
    { lastPeriodType: 'REG' },
    { lastPeriodType: 'OT' },
    { lastPeriodType: 'SO' },
  ]) {
    const result = resolvePredictionResult({
      game: makeGame({ gameOutcome }),
      prediction: makePrediction(),
      source: 'fixture',
    })

    assert.equal(result.status, 'FINAL')
    assert.equal(result.homeWon, true)
    assert.equal(result.homeScore, 3)
    assert.equal(result.awayScore, 2)
    assert.equal(
      result.resultType,
      gameOutcome.lastPeriodType === 'REG'
        ? 'REGULATION'
        : gameOutcome.lastPeriodType === 'OT'
          ? 'OVERTIME'
          : 'SHOOTOUT',
    )
  }

  const away = resolvePredictionResult({
    game: makeGame({
      awayTeam: { abbreviation: 'COL', score: 4 },
      homeTeam: { abbreviation: 'BOS', score: 1 },
    }),
    prediction: makePrediction(),
  })
  assert.equal(away.homeWon, false)
})

test('canonical result resolution exposes pending, postponed and invalid-final states', () => {
  const pending = resolvePredictionResult({
    game: makeGame({ gameState: 'FUT' }),
    prediction: makePrediction(),
  })
  const postponed = resolvePredictionResult({
    game: makeGame({ gameState: 'FUT', status: 'Postponed' }),
    prediction: makePrediction(),
  })
  const invalid = resolvePredictionResult({
    game: makeGame({
      awayTeam: { abbreviation: 'COL', score: 2 },
      homeTeam: { abbreviation: 'BOS', score: 2 },
    }),
    prediction: makePrediction(),
  })

  assert.equal(pending.reason, 'RESULT_PENDING')
  assert.equal(postponed.reason, 'GAME_POSTPONED')
  assert.equal(invalid.reason, 'INVALID_FINAL_RESULT')
})

test('scheduled-start mismatch is excluded while a prediction for the new start resolves', () => {
  const rescheduled = makeGame({ startTimeUTC: '2026-10-08T20:00:00.000Z' })
  const oldPrediction = resolvePredictionResult({
    game: rescheduled,
    prediction: makePrediction(),
  })
  const newPrediction = resolvePredictionResult({
    game: rescheduled,
    prediction: makePrediction({
      scheduledStartAtCapture: '2026-10-08T20:00:00.000Z',
    }),
  })

  assert.equal(oldPrediction.reason, 'SCHEDULE_IDENTITY_MISMATCH')
  assert.equal(newPrediction.status, 'FINAL')
})

test('result resolution prefers stored HistoricalNhlGame and falls back read-only to NHL landing', async () => {
  const storedPrediction = makePrediction()
  const providerPrediction = makePrediction({ gameId: '2026020002' })
  let providerCalls = 0
  const results = await resolvePredictionResults({
    gameProvider: async (gameId) => {
      providerCalls += 1
      return makeGame({ gameId })
    },
    historicalGames: [
      {
        awayScore: 2,
        awayTeamAbbreviation: 'COL',
        gameId: '2026020001',
        gameState: 'FINAL',
        gameType: 2,
        homeScore: 3,
        homeTeamAbbreviation: 'BOS',
        resultType: 'OT',
        seasonId: '20262027',
        startTimeUTC: START,
      },
    ],
    predictions: [storedPrediction, providerPrediction],
  })

  assert.equal(providerCalls, 1)
  assert.equal(results.get(storedPrediction).source, RESULT_SOURCE.HISTORICAL_NHL_GAME)
  assert.equal(results.get(storedPrediction).resultType, 'OVERTIME')
  assert.equal(results.get(providerPrediction).source, RESULT_SOURCE.NHL_GAME_LANDING)
})
