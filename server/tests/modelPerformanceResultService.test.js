process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  GOALIE_MATCH_STATUS,
  RESULT_SOURCE,
  compareStartingGoalie,
  resolveActualStartingGoalies,
  resolvePredictionActualStartingGoalies,
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

test('actual starter comparison uses canonical IDs and never treats missing identity as mismatch', () => {
  assert.equal(
    compareStartingGoalie({ nhlPlayerId: 8478498 }, { playerId: 8478498 }),
    GOALIE_MATCH_STATUS.MATCH,
  )
  assert.equal(
    compareStartingGoalie({ nhlPlayerId: 8478498 }, { playerId: 8478048 }),
    GOALIE_MATCH_STATUS.MISMATCH,
  )
  for (const [selected, actual] of [
    [null, { playerId: 1 }],
    [{ nhlPlayerId: null, selectionType: 'custom' }, { playerId: 1 }],
    [{ nhlPlayerId: 1 }, null],
    [{ nhlPlayerId: 1 }, { playerId: null }],
  ]) {
    assert.equal(
      compareStartingGoalie(selected, actual),
      GOALIE_MATCH_STATUS.UNAVAILABLE,
    )
  }
})

test('actual starter resolution requires exact game identity and is non-fatal', async () => {
  const prediction = makePrediction()
  const actualStartingGoalies = {
    away: { name: 'A. Away', playerId: 2, teamId: 'COL' },
    home: { name: 'H. Home', playerId: 1, teamId: 'BOS' },
  }
  const available = await resolvePredictionActualStartingGoalies({
    gameProvider: async () => makeGame({ actualStartingGoalies }),
    prediction,
  })
  const mismatch = await resolvePredictionActualStartingGoalies({
    gameProvider: async () => makeGame({
      actualStartingGoalies,
      startTimeUTC: '2026-10-08T20:00:00.000Z',
    }),
    prediction,
  })
  const unavailable = await resolvePredictionActualStartingGoalies({
    gameProvider: async () => { throw new Error('offline') },
    prediction,
  })

  assert.deepEqual(available.home, actualStartingGoalies.home)
  assert.equal(mismatch.home, null)
  assert.equal(unavailable.away, null)
})

test('actual starter resolution is bounded and returns one result per visible prediction', async () => {
  const predictions = [
    makePrediction(),
    makePrediction({ gameId: '2026020002' }),
  ]
  let providerCalls = 0
  const results = await resolveActualStartingGoalies({
    gameProvider: async (gameId) => {
      providerCalls += 1
      return makeGame({
        actualStartingGoalies: {
          away: { name: 'A. Away', playerId: 2, teamId: 'COL' },
          home: { name: 'H. Home', playerId: 1, teamId: 'BOS' },
        },
        gameId,
      })
    },
    predictions,
  })

  assert.equal(providerCalls, 2)
  assert.equal(results.size, 2)
})
