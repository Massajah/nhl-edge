const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const { COMPLETED_GAME_STATES } = require('./nhlGameEligibility')

const PREDICTION_DEFINITION = 'OFFICIAL_T2_AUTOMATIC_V1'
const CALCULATION_CONTRACT_VERSION = 'automatic-prediction-v1'
const OPEN_BEFORE_MS = 120 * 60 * 1000
const CLOSE_BEFORE_MS = 75 * 60 * 1000

const timestamp = (value) => value == null ? NaN : new Date(value).getTime()
const teamId = (team) => getNhlTeamIdentity(team?.abbreviation, team?.abbrev, team?.name)
const blockedStatus = (game) => /postpon|cancel|abandon|suspend/i.test(String(game?.status ?? '')) ||
  [game?.gameScheduleState, game?.gameState].some((state) =>
    ['PPD', 'CNCL', 'CANC', 'SUSP'].includes(String(state ?? '').toUpperCase()))

// Both boundaries are inclusive. Check this again after asynchronous input loading.
const getT2Eligibility = (game, observedAt) => {
  const start = timestamp(game?.startTimeUTC ?? game?.scheduledStartAtCapture)
  const observed = timestamp(observedAt)
  if (!Number.isFinite(start) || !Number.isFinite(observed)) return 'INVALID_TIME'
  if (blockedStatus(game)) return 'GAME_UNAVAILABLE'
  if (!['FUT', 'PRE'].includes(game?.gameState)) return 'GAME_NOT_PREGAME'
  if (observed >= start) return 'GAME_STARTED'
  if (observed < start - OPEN_BEFORE_MS) return 'BEFORE_T2_WINDOW'
  if (observed > start - CLOSE_BEFORE_MS) return 'AFTER_T2_WINDOW'
  return null
}

const getGameIdentity = (game) => {
  const identity = {
    gameId: String(game?.gameId ?? game?.id ?? ''),
    seasonId: String(game?.season ?? game?.seasonId ?? ''),
    gameType: Number(game?.gameType),
    scheduledStartAtCapture: new Date(timestamp(game?.startTimeUTC)),
    homeTeamId: teamId(game?.homeTeam),
    awayTeamId: teamId(game?.awayTeam),
  }
  if (!/^\d{10}$/.test(identity.gameId) || !/^\d{8}$/.test(identity.seasonId) ||
      ![2, 3].includes(identity.gameType) || !Number.isFinite(+identity.scheduledStartAtCapture) ||
      !identity.homeTeamId || !identity.awayTeamId || identity.homeTeamId === identity.awayTeamId) return null
  return identity
}

const snapshotKey = ({ userId, gameId, scheduledStartAtCapture }) => ({
  userId, gameId, scheduledStartAtCapture, predictionDefinition: PREDICTION_DEFINITION,
})

// Pure future result join: caller first scopes snapshots to its authenticated owner.
// A new start must never be scored against the old immutable observation.
const resolveForwardPredictionResult = (snapshot, game) => {
  const identity = getGameIdentity(game)
  if (!identity || ['gameId', 'seasonId', 'gameType', 'homeTeamId', 'awayTeamId']
    .some((field) => identity[field] !== snapshot[field])) return { status: 'IDENTITY_MISMATCH', homeWon: null }
  if (+identity.scheduledStartAtCapture !== timestamp(snapshot.scheduledStartAtCapture)) {
    return { status: 'RESCHEDULED', homeWon: null }
  }
  if (blockedStatus(game)) return { status: 'GAME_UNAVAILABLE', homeWon: null }
  if (!COMPLETED_GAME_STATES.has(game.gameState)) return { status: 'RESULT_PENDING', homeWon: null }
  const scores = [game.homeTeam?.score, game.awayTeam?.score]
  if (scores.some((score) => score == null || score === '' || !Number.isInteger(Number(score)) || Number(score) < 0) ||
      Number(scores[0]) === Number(scores[1])) return { status: 'INVALID_FINAL_RESULT', homeWon: null }
  return { status: 'FINAL', homeWon: Number(scores[0]) > Number(scores[1]),
    homeScore: Number(scores[0]), awayScore: Number(scores[1]) }
}

module.exports = { CALCULATION_CONTRACT_VERSION, CLOSE_BEFORE_MS, OPEN_BEFORE_MS,
  PREDICTION_DEFINITION, getGameIdentity, getT2Eligibility,
  isForwardPredictionGameBlocked: blockedStatus, resolveForwardPredictionResult, snapshotKey }
