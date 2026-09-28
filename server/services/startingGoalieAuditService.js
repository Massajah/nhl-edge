const Bet = require('../models/Bet')
const nhlApiService = require('./nhlApiService')
const {
  getGameIdentity,
  isForwardPredictionGameBlocked,
} = require('./forwardPredictionContracts')
const { COMPLETED_GAME_STATES } = require('./nhlGameEligibility')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const ACTUAL_STARTER_SOURCE = 'NHL_GAMECENTER_BOXSCORE'
const MAX_AUDIT_BET_IDS = 50
const GOALIE_MATCH_STATUS = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  UNAVAILABLE: 'UNAVAILABLE',
})
const IDENTITY_FIELDS = ['gameId', 'homeTeamId', 'awayTeamId']

const validPlayerId = (value) => {
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const compareStartingGoalie = (selected, actual) => {
  if (['custom', 'unknown'].includes(selected?.selectionType)) {
    return GOALIE_MATCH_STATUS.UNAVAILABLE
  }
  const selectedId = validPlayerId(selected?.nhlPlayerId)
  const actualId = validPlayerId(actual?.playerId)
  if (selectedId === null || actualId === null) {
    return GOALIE_MATCH_STATUS.UNAVAILABLE
  }
  return selectedId === actualId
    ? GOALIE_MATCH_STATUS.MATCH
    : GOALIE_MATCH_STATUS.MISMATCH
}

const unavailableActualStartingGoalies = () => ({
  away: null,
  home: null,
  source: ACTUAL_STARTER_SOURCE,
  verifiedGameIdentity: null,
})

const betGameIdentity = (bet = {}) => {
  const gameId = String(bet.gameId ?? '').trim()
  const start = new Date(bet.scheduledStart ?? NaN)
  const awayTeamId = getNhlTeamIdentity(
    bet.awayTeam?.teamId,
    bet.awayTeam?.abbreviation,
  )
  const homeTeamId = getNhlTeamIdentity(
    bet.homeTeam?.teamId,
    bet.homeTeam?.abbreviation,
  )
  if (!/^\d{10}$/.test(gameId) || !Number.isFinite(+start) ||
      !awayTeamId || !homeTeamId || awayTeamId === homeTeamId) {
    return null
  }
  return { awayTeamId, gameId, homeTeamId, scheduledStartAtCapture: start }
}

const matchesIdentity = (expected, actual) => {
  if (!expected || !actual ||
      IDENTITY_FIELDS.some((field) => actual[field] !== expected[field]) ||
      +actual.scheduledStartAtCapture !== +new Date(expected.scheduledStartAtCapture)) {
    return false
  }
  if (expected.seasonId && actual.seasonId !== expected.seasonId) return false
  if (expected.gameType && actual.gameType !== expected.gameType) return false
  return true
}

const auditedGameIdentity = (game) => {
  const predictionIdentity = getGameIdentity(game)
  if (predictionIdentity) return predictionIdentity
  if (Number(game?.gameType) !== 1) return null
  const gameId = String(game.gameId ?? game.id ?? '')
  const seasonId = String(game.season ?? game.seasonId ?? '')
  const scheduledStartAtCapture = new Date(game.startTimeUTC ?? NaN)
  const awayTeamId = getNhlTeamIdentity(
    game.awayTeam?.abbreviation, game.awayTeam?.abbrev, game.awayTeam?.name,
  )
  const homeTeamId = getNhlTeamIdentity(
    game.homeTeam?.abbreviation, game.homeTeam?.abbrev, game.homeTeam?.name,
  )
  if (!/^\d{10}$/.test(gameId) || !/^\d{8}$/.test(seasonId) ||
      !Number.isFinite(+scheduledStartAtCapture) || !awayTeamId ||
      !homeTeamId || awayTeamId === homeTeamId) return null
  return { awayTeamId, gameId, gameType: 1, homeTeamId,
    scheduledStartAtCapture, seasonId }
}

const matchesFinalGame = (expected, game) =>
  Boolean(game && !isForwardPredictionGameBlocked(game) &&
    COMPLETED_GAME_STATES.has(String(game.gameState ?? '').toUpperCase()) &&
    matchesIdentity(expected, auditedGameIdentity(game)))

const resolveGameActualStartingGoalies = async ({
  expectedIdentity,
  gameProvider = nhlApiService.getGameBoxscore,
}) => {
  try {
    const game = await gameProvider(expectedIdentity.gameId)
    if (!matchesFinalGame(expectedIdentity, game)) {
      return unavailableActualStartingGoalies()
    }
    const identity = auditedGameIdentity(game)
    const side = (key) => {
      const goalie = game.actualStartingGoalies?.[key]
      return getNhlTeamIdentity(goalie?.teamId) === identity[`${key}TeamId`] &&
        validPlayerId(goalie.playerId) !== null
        ? goalie
        : null
    }
    return {
      away: side('away'),
      home: side('home'),
      source: ACTUAL_STARTER_SOURCE,
      verifiedGameIdentity: identity,
    }
  } catch {
    return unavailableActualStartingGoalies()
  }
}

const resolvePredictionActualStartingGoalies = ({ gameProvider, prediction }) =>
  resolveGameActualStartingGoalies({
    expectedIdentity: prediction,
    gameProvider,
  })

const isComparableSide = (selected, teamId) =>
  selected?.selectionType === 'provider_goalie' &&
  selected?.sourceType === 'MANUAL' &&
  getNhlTeamIdentity(selected.teamId) === teamId &&
  validPlayerId(selected.nhlPlayerId) !== null

const hasComparableBetGoalie = (bet) => {
  const identity = betGameIdentity(bet)
  if (!identity || !bet?.startingGoaliesAtBet) return false
  return ['away', 'home'].some((side) =>
    isComparableSide(
      bet.startingGoaliesAtBet[side],
      identity[`${side}TeamId`],
    ))
}

const isAuditableBetForGame = (bet, gameIdentity) =>
  hasComparableBetGoalie(bet) && matchesIdentity(betGameIdentity(bet), gameIdentity)

const publicActualStartingGoalies = (actual) => ({
  away: actual?.away ?? null,
  home: actual?.home ?? null,
  source: ACTUAL_STARTER_SOURCE,
})

const buildBetStartingGoalieAudit = (bet, actual = null) => {
  const selected = bet?.startingGoaliesAtBet
  if (!selected) return null
  const identity = betGameIdentity(bet)
  const verified = matchesIdentity(identity, actual?.verifiedGameIdentity)
  const sides = Object.fromEntries(['away', 'home'].map((side) => {
    const selection = selected[side]
    const actualGoalie = verified &&
      getNhlTeamIdentity(actual?.[side]?.teamId) === identity[`${side}TeamId`]
      ? actual[side]
      : null
    const comparable = verified &&
      isComparableSide(selection, identity[`${side}TeamId`])
    return [side, {
      actualStarter: actualGoalie ? { displayName: actualGoalie.name || 'Unavailable' } : null,
      selectedAtBet: selection
        ? { displayName: selection.displayName || 'Other / Unlisted goalie' }
        : null,
      status: comparable
        ? compareStartingGoalie(selection, actualGoalie)
        : GOALIE_MATCH_STATUS.UNAVAILABLE,
    }]
  }))
  return {
    away: sides.away,
    hasMismatch: Object.values(sides).some((side) =>
      side.status === GOALIE_MATCH_STATUS.MISMATCH),
    home: sides.home,
    source: ACTUAL_STARTER_SOURCE,
  }
}

const parseAuditBetIds = (value) => {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('betIds must be a comma-separated list.'), {
      statusCode: 400,
    })
  }
  const submitted = value.split(',').map((id) => id.trim()).filter(Boolean)
  if (value.length > MAX_AUDIT_BET_IDS * 64 ||
      submitted.length === 0 || submitted.length > MAX_AUDIT_BET_IDS) {
    throw Object.assign(new Error(`betIds must contain 1–${MAX_AUDIT_BET_IDS} IDs.`), {
      statusCode: 400,
    })
  }
  return [...new Set(submitted)]
}

const mapWithConcurrency = async (values, worker, limit = 6) => {
  let cursor = 0
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor++
      await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run))
}

const getBetsStartingGoalieAudits = async (userId, rawIds, options = {}) => {
  if (!userId) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 })
  const ids = parseAuditBetIds(rawIds)
  const audits = Object.fromEntries(ids.map((id) => [id, null]))
  if (options.demo === true) return { audits }

  const betModel = options.betModel ?? Bet
  const validIds = ids.filter((id) => /^[a-f\d]{24}$/i.test(id))
  if (!validIds.length) return { audits }
  const bets = await betModel.find({ _id: { $in: validIds }, userId })
  const eligible = []
  for (const bet of bets) {
    const id = String(bet._id)
    audits[id] = buildBetStartingGoalieAudit(bet)
    if (hasComparableBetGoalie(bet) && +new Date(bet.scheduledStart) < Date.now()) {
      eligible.push(bet)
    }
  }
  if (!eligible.length) return { audits }

  const byDate = new Map()
  for (const bet of eligible) {
    const date = nhlApiService.getTodayNhlDate(new Date(bet.scheduledStart))
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(bet)
  }
  const finalBetsByGame = new Map()
  await mapWithConcurrency([...byDate], async ([date, dateBets]) => {
    try {
      const schedule = await (options.scheduleProvider ?? nhlApiService.getGamesForDate)(date)
      const games = new Map((schedule?.games ?? []).map((game) => [String(game.gameId), game]))
      for (const bet of dateBets) {
        const identity = betGameIdentity(bet)
        if (!matchesFinalGame(identity, games.get(identity.gameId))) continue
        if (!finalBetsByGame.has(identity.gameId)) finalBetsByGame.set(identity.gameId, [])
        finalBetsByGame.get(identity.gameId).push(bet)
      }
    } catch {
      // Diagnostic enrichment is optional. Other dates and games still resolve.
    }
  }, 3)

  await mapWithConcurrency([...finalBetsByGame], async ([gameId, gameBets]) => {
    const actual = await resolveGameActualStartingGoalies({
      expectedIdentity: betGameIdentity(gameBets[0]),
      gameProvider: options.gameProvider,
    })
    for (const bet of gameBets) {
      audits[String(bet._id)] = buildBetStartingGoalieAudit(bet, actual)
    }
  })
  return { audits }
}

module.exports = {
  ACTUAL_STARTER_SOURCE,
  GOALIE_MATCH_STATUS,
  MAX_AUDIT_BET_IDS,
  betGameIdentity,
  buildBetStartingGoalieAudit,
  compareStartingGoalie,
  getBetsStartingGoalieAudits,
  hasComparableBetGoalie,
  isAuditableBetForGame,
  matchesFinalGame,
  parseAuditBetIds,
  publicActualStartingGoalies,
  resolveGameActualStartingGoalies,
  resolvePredictionActualStartingGoalies,
  unavailableActualStartingGoalies,
}
