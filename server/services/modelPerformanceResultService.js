const nhlApiService = require('./nhlApiService')
const {
  getGameIdentity,
  resolveForwardPredictionResult,
} = require('./forwardPredictionContracts')
const { PERFORMANCE_REASON_CODES } = require('./modelPerformanceContracts')

const RESULT_SOURCE = Object.freeze({
  HISTORICAL_NHL_GAME: 'HistoricalNhlGame',
  NHL_GAME_LANDING: 'NHL_GAME_LANDING',
})
const GOALIE_MATCH_STATUS = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  UNAVAILABLE: 'UNAVAILABLE',
})
const ACTUAL_STARTER_SOURCE = 'NHL_GAMECENTER_BOXSCORE'

const toHistoricalGameContract = (storedGame = {}) => ({
  awayTeam: {
    abbreviation:
      storedGame.awayTeamAbbreviation ?? storedGame.awayTeamId ?? '',
    score: storedGame.awayScore,
  },
  gameId: storedGame.gameId,
  gameState: storedGame.gameState,
  gameType: storedGame.gameType,
  homeTeam: {
    abbreviation:
      storedGame.homeTeamAbbreviation ?? storedGame.homeTeamId ?? '',
    score: storedGame.homeScore,
  },
  resultType: storedGame.resultType,
  season: storedGame.seasonId,
  startTimeUTC: storedGame.startTimeUTC,
  status: storedGame.gameState,
})

const isPostponed = (game = {}) =>
  /postpon/i.test(String(game.status ?? '')) ||
  String(game.gameScheduleState ?? '').toUpperCase() === 'PPD'

const normalizeResultType = (game = {}) => {
  const value = String(
    game.resultType ?? game.gameOutcome?.lastPeriodType ?? '',
  ).toUpperCase()

  if (['REG', 'REGULATION'].includes(value)) return 'REGULATION'
  if (['OT', 'OVERTIME'].includes(value)) return 'OVERTIME'
  if (['SO', 'SHOOTOUT'].includes(value)) return 'SHOOTOUT'
  return null
}

const mapResolutionReason = (resolution, game) => {
  if (resolution.status === 'FINAL') return null
  if (resolution.status === 'RESULT_PENDING') {
    return PERFORMANCE_REASON_CODES.RESULT_PENDING
  }
  if (resolution.status === 'INVALID_FINAL_RESULT') {
    return PERFORMANCE_REASON_CODES.INVALID_FINAL_RESULT
  }
  if (['IDENTITY_MISMATCH', 'RESCHEDULED'].includes(resolution.status)) {
    return PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH
  }
  if (resolution.status === 'GAME_UNAVAILABLE') {
    return isPostponed(game)
      ? PERFORMANCE_REASON_CODES.GAME_POSTPONED
      : PERFORMANCE_REASON_CODES.GAME_UNAVAILABLE
  }

  return PERFORMANCE_REASON_CODES.RESULT_UNAVAILABLE
}

const resolvePredictionResult = ({ game, prediction, source }) => {
  if (!game) {
    return {
      awayScore: null,
      homeScore: null,
      homeWon: null,
      reason: PERFORMANCE_REASON_CODES.RESULT_UNAVAILABLE,
      resultType: null,
      source: source ?? null,
      status: 'UNAVAILABLE',
    }
  }

  const resolution = resolveForwardPredictionResult(prediction, game)

  return {
    awayScore: resolution.awayScore ?? null,
    homeScore: resolution.homeScore ?? null,
    homeWon: resolution.homeWon,
    reason: mapResolutionReason(resolution, game),
    resultType:
      resolution.status === 'FINAL' ? normalizeResultType(game) : null,
    source: source ?? null,
    status: resolution.status,
  }
}

const mapWithConcurrency = async (values, worker, concurrency = 6) => {
  const results = new Array(values.length)
  let cursor = 0

  const run = async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(values[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, run),
  )

  return results
}

const resolvePredictionResults = async ({
  gameProvider = nhlApiService.getGameLanding,
  historicalGames = [],
  predictions = [],
} = {}) => {
  const historicalByGameId = new Map(
    historicalGames.map((game) => [String(game.gameId), game]),
  )

  const rows = await mapWithConcurrency(predictions, async (prediction) => {
    const historical = historicalByGameId.get(String(prediction.gameId))

    if (historical) {
      return resolvePredictionResult({
        game: toHistoricalGameContract(historical),
        prediction,
        source: RESULT_SOURCE.HISTORICAL_NHL_GAME,
      })
    }

    try {
      const game = await gameProvider(prediction.gameId)

      return resolvePredictionResult({
        game,
        prediction,
        source: RESULT_SOURCE.NHL_GAME_LANDING,
      })
    } catch {
      return resolvePredictionResult({
        game: null,
        prediction,
        source: RESULT_SOURCE.NHL_GAME_LANDING,
      })
    }
  })

  return new Map(
    predictions.map((prediction, index) => [prediction, rows[index]]),
  )
}

const unavailableActualStartingGoalies = () => ({
  away: null,
  home: null,
  source: ACTUAL_STARTER_SOURCE,
})

const resolvePredictionActualStartingGoalies = async ({
  gameProvider = nhlApiService.getGameBoxscore,
  prediction,
} = {}) => {
  try {
    const game = await gameProvider(prediction.gameId)
    const identity = getGameIdentity(game)
    if (!identity || ['gameId', 'seasonId', 'gameType', 'homeTeamId', 'awayTeamId']
      .some((field) => identity[field] !== prediction[field]) ||
      +identity.scheduledStartAtCapture !== +new Date(prediction.scheduledStartAtCapture)) {
      return unavailableActualStartingGoalies()
    }

    return {
      away: game.actualStartingGoalies?.away ?? null,
      home: game.actualStartingGoalies?.home ?? null,
      source: ACTUAL_STARTER_SOURCE,
    }
  } catch {
    return unavailableActualStartingGoalies()
  }
}

const resolveActualStartingGoalies = async ({
  gameProvider,
  predictions = [],
} = {}) => {
  const rows = await mapWithConcurrency(
    predictions,
    (prediction) => resolvePredictionActualStartingGoalies({
      gameProvider,
      prediction,
    }),
  )

  return new Map(
    predictions.map((prediction, index) => [prediction, rows[index]]),
  )
}

const compareStartingGoalie = (selected, actual) => {
  const selectedId = Number(selected?.nhlPlayerId)
  const actualId = Number(actual?.playerId)
  if (!Number.isSafeInteger(selectedId) || selectedId <= 0 ||
      !Number.isSafeInteger(actualId) || actualId <= 0) {
    return GOALIE_MATCH_STATUS.UNAVAILABLE
  }

  return selectedId === actualId
    ? GOALIE_MATCH_STATUS.MATCH
    : GOALIE_MATCH_STATUS.MISMATCH
}

module.exports = {
  ACTUAL_STARTER_SOURCE,
  GOALIE_MATCH_STATUS,
  compareStartingGoalie,
  RESULT_SOURCE,
  mapResolutionReason,
  mapWithConcurrency,
  normalizeResultType,
  resolvePredictionResult,
  resolvePredictionResults,
  resolveActualStartingGoalies,
  resolvePredictionActualStartingGoalies,
  toHistoricalGameContract,
}
