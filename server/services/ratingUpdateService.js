const mongoose = require('mongoose')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const nhlApiService = require('./nhlApiService')
const {
  calculatePregameProbability,
  calculateRatingUpdate,
  classifyCompletedGameResult,
} = require('./powerRatingEngine')
const {
  getProductionRatingEngineSettings,
  getRatingUpdateConfiguration,
} = require('./ratingEngineSettingsService')
const {
  calculateEffectiveHomeAdvantage,
} = require('./homeAdvantageService')
const { getSeedTeams } = require('./powerRatingsService')
const {
  deduplicateGamesById,
  fetchNhlScheduleGames,
} = require('./powerRatingSimulationService')
const {
  SKIP_REASONS,
  classifyGameEligibility,
  getGameId,
  getGameStart,
  getGameStartTimestamp,
} = require('./nhlGameEligibility')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_UPDATE_RANGE_DAYS = 7
const LIVE_UPDATE_GAME_TYPE_FILTERS = Object.freeze({
  playoffs: false,
  preseason: false,
  regularSeason: true,
})
const PRESENTATION_PRECISION_DECIMALS = 6

class RatingUpdateError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'RatingUpdateError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const toOptionalFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const roundPresentationNumber = (value) =>
  Number.isFinite(value)
    ? Number(value.toFixed(PRESENTATION_PRECISION_DECIMALS))
    : null

const parseUpdateDate = (value, field) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new RatingUpdateError(`${field} must use YYYY-MM-DD format.`, 400, {
      field,
    })
  }

  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new RatingUpdateError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return {
    date: value,
    timestamp,
  }
}

const formatDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 10)

const normalizeUpdateDateRange = (
  payload = {},
  { todayProvider = nhlApiService.getTodayNhlDate } = {},
) => {
  const normalizedPayload = payload ?? {}

  if (!isPlainObject(normalizedPayload)) {
    throw new RatingUpdateError('Request body must be an object.', 400)
  }

  const supportedFields = new Set(['from', 'to'])
  const unsupportedFields = Object.keys(normalizedPayload).filter(
    (field) => !supportedFields.has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new RatingUpdateError(
      'Request body contains unsupported rating update fields.',
      400,
      { unsupportedFields },
    )
  }

  const today = parseUpdateDate(todayProvider(), 'today')
  const parsedTo = Object.hasOwn(normalizedPayload, 'to')
    ? parseUpdateDate(normalizedPayload.to, 'to')
    : today

  if (parsedTo.timestamp > today.timestamp) {
    throw new RatingUpdateError('to cannot be after today.', 400, {
      field: 'to',
      today: today.date,
    })
  }

  const parsedFrom = Object.hasOwn(normalizedPayload, 'from')
    ? parseUpdateDate(normalizedPayload.from, 'from')
    : {
        date: formatDate(
          parsedTo.timestamp - (DEFAULT_UPDATE_RANGE_DAYS - 1) * DAY_MS,
        ),
        timestamp:
          parsedTo.timestamp - (DEFAULT_UPDATE_RANGE_DAYS - 1) * DAY_MS,
      }

  if (parsedFrom.timestamp > today.timestamp) {
    throw new RatingUpdateError('from cannot be after today.', 400, {
      field: 'from',
      today: today.date,
    })
  }

  if (parsedFrom.timestamp > parsedTo.timestamp) {
    throw new RatingUpdateError('from must be on or before to.', 400, {
      from: parsedFrom.date,
      to: parsedTo.date,
    })
  }

  return {
    from: parsedFrom.date,
    fromTimestamp: parsedFrom.timestamp,
    to: parsedTo.date,
    toTimestamp: parsedTo.timestamp,
  }
}

const buildTeamDirectory = async () => {
  const seedTeams = await getSeedTeams()

  return seedTeams.reduce((teamsById, team) => {
    const teamSnapshot = {
      abbreviation: normalizeIdentifier(team.abbreviation),
      teamId: normalizeIdentifier(team.teamId),
      teamName: team.teamName,
    }

    teamsById.set(teamSnapshot.teamId, teamSnapshot)
    teamsById.set(teamSnapshot.abbreviation, teamSnapshot)

    return teamsById
  }, new Map())
}

const normalizeGameId = (game) => {
  const rawGameId = getGameId(game)

  if (rawGameId === null || rawGameId === undefined || rawGameId === '') {
    return null
  }

  const gameId = Number(rawGameId)

  return Number.isFinite(gameId) ? gameId : null
}

const compareGamesChronologically = (gameA, gameB) => {
  const timestampA = getGameStartTimestamp(gameA) ?? Number.POSITIVE_INFINITY
  const timestampB = getGameStartTimestamp(gameB) ?? Number.POSITIVE_INFINITY
  const timestampDifference = timestampA - timestampB

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return String(getGameId(gameA) ?? '').localeCompare(
    String(getGameId(gameB) ?? ''),
  )
}

const applySession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query

const selectGameId = (query) =>
  query && typeof query.select === 'function' ? query.select('gameId') : query

const isDuplicateKeyError = (error) => error?.code === 11000

const isTransactionUnsupportedError = (error) =>
  /transaction numbers are only allowed|transactions are not supported|transaction.*not supported/i.test(
    error?.message ?? '',
  )

const canUseMongooseTransactions = () =>
  mongoose.connection.readyState === 1 &&
  typeof mongoose.startSession === 'function'

const loadExistingProcessedGameIds = async ({
  processedRatingGameModel,
  userId,
  gameIds,
}) => {
  if (gameIds.length === 0) {
    return new Set()
  }

  const query = selectGameId(
    processedRatingGameModel.find({
      gameId: { $in: gameIds },
      userId,
    }),
  )
  const processedGames = await query

  return new Set(
    (Array.isArray(processedGames) ? processedGames : []).map((game) =>
      Number(game.gameId),
    ),
  )
}

const loadPowerRatingsForGame = async ({
  awayTeam,
  homeTeam,
  powerRatingModel,
  session,
  userId,
}) => {
  const teamIds = [homeTeam.teamId, awayTeam.teamId]
  const query = applySession(
    powerRatingModel.find({
      teamId: { $in: teamIds },
      userId,
    }),
    session,
  )
  const ratings = await query
  const ratingsByTeamId = new Map()

  ;(Array.isArray(ratings) ? ratings : []).forEach((rating) => {
    ratingsByTeamId.set(normalizeIdentifier(rating.teamId), rating)
  })

  return {
    awayRating: ratingsByTeamId.get(awayTeam.teamId) ?? null,
    homeRating: ratingsByTeamId.get(homeTeam.teamId) ?? null,
  }
}

const buildMissingRatingError = ({ awayRating, awayTeam, gameId, homeRating, homeTeam }) => {
  const missingTeams = [
    homeRating ? null : homeTeam.abbreviation,
    awayRating ? null : awayTeam.abbreviation,
  ].filter(Boolean)

  return {
    gameId,
    reason: `Missing Power Rating for ${missingTeams.join(', ')}`,
  }
}

const validateRatingValue = ({ gameId, rating, team }) => {
  const baseRating = toOptionalFiniteNumber(rating?.baseRating)

  if (!Number.isFinite(baseRating)) {
    return {
      error: {
        gameId,
        reason: `Invalid Power Rating for team ${team.abbreviation}`,
      },
      value: null,
    }
  }

  return {
    error: null,
    value: baseRating,
  }
}

const buildResultType = (resultType) => String(resultType).toUpperCase()

const buildResultLabel = ({
  awayScore,
  awayTeam,
  homeScore,
  homeTeam,
}) => `${awayTeam.abbreviation} ${awayScore}-${homeScore} ${homeTeam.abbreviation}`

const buildEngineSettingsSnapshot = (settings) => ({
  modelVersion: settings.modelVersion,
  kFactor: settings.kFactor,
  homeAdvantage: settings.homeAdvantage,
  regulationMultiplier: settings.regulationMultiplier,
  overtimeMultiplier: settings.overtimeMultiplier,
  shootoutMultiplier: settings.shootoutMultiplier,
})

const buildProcessedGameResponse = ({
  auditRecord,
  awayTeam,
  homeTeam,
}) => ({
  gameId: auditRecord.gameId,
  awayTeam: awayTeam.abbreviation,
  homeTeam: homeTeam.abbreviation,
  result: buildResultLabel({
    awayScore: auditRecord.awayScore,
    awayTeam,
    homeScore: auditRecord.homeScore,
    homeTeam,
  }),
  resultType: auditRecord.resultType,
  awayRatingBefore: roundPresentationNumber(auditRecord.awayRatingBefore),
  awayRatingAfter: roundPresentationNumber(auditRecord.awayRatingAfter),
  awayRatingChange: roundPresentationNumber(auditRecord.awayRatingChange),
  homeRatingBefore: roundPresentationNumber(auditRecord.homeRatingBefore),
  homeRatingAfter: roundPresentationNumber(auditRecord.homeRatingAfter),
  homeRatingChange: roundPresentationNumber(auditRecord.homeRatingChange),
  baseHomeAdvantage: roundPresentationNumber(auditRecord.baseHomeAdvantage),
  homeTeamAdjustment: roundPresentationNumber(auditRecord.homeTeamAdjustment),
  effectiveHomeAdvantage: roundPresentationNumber(
    auditRecord.effectiveHomeAdvantage,
  ),
})

const updateTeamRating = async ({
  powerRatingModel,
  ratingAfter,
  ratingChange,
  session,
  teamId,
  userId,
}) => {
  const options = session ? { session } : undefined

  const result = await powerRatingModel.updateOne(
    {
      teamId,
      userId,
    },
    {
      $set: {
        baseRating: ratingAfter,
        lastRatingChange: ratingChange,
      },
    },
    options,
  )

  if (result && Object.hasOwn(result, 'matchedCount') && result.matchedCount === 0) {
    throw new RatingUpdateError(
      `Power Rating for team ${teamId} was not found during update.`,
      409,
    )
  }
}

const createProcessedRatingGame = async ({
  auditRecord,
  processedRatingGameModel,
  session,
}) => {
  if (session) {
    return processedRatingGameModel.create([auditRecord], { session })
  }

  return processedRatingGameModel.create([auditRecord])
}

const deleteProcessedRatingGame = async ({
  gameId,
  processedRatingGameModel,
  userId,
}) => {
  if (typeof processedRatingGameModel.deleteOne !== 'function') {
    return
  }

  await processedRatingGameModel.deleteOne({
    gameId,
    userId,
  })
}

const processEligibleGameWithoutTransaction = async ({
  awayTeam,
  configuration,
  game,
  homeTeam,
  powerRatingModel,
  processedAt,
  processedRatingGameModel,
  session,
  settings,
  userId,
}) => {
  const gameId = normalizeGameId(game)

  if (!Number.isFinite(gameId)) {
    return {
      error: {
        gameId: null,
        reason: 'Missing NHL game ID.',
      },
      status: 'skipped',
    }
  }

  const classification = classifyCompletedGameResult(game)

  if (!classification.isResolved) {
    return {
      error: {
        code: classification.warning?.code ?? SKIP_REASONS.UNRESOLVED_RESULT_TYPE,
        gameId,
        reason:
          classification.warning?.message ??
          'Completed game result could not be resolved.',
      },
      status: 'skipped',
    }
  }

  const { awayRating, homeRating } = await loadPowerRatingsForGame({
    awayTeam,
    homeTeam,
    powerRatingModel,
    session,
    userId,
  })

  if (!homeRating || !awayRating) {
    return {
      error: buildMissingRatingError({
        awayRating,
        awayTeam,
        gameId,
        homeRating,
        homeTeam,
      }),
      status: 'skipped',
    }
  }

  const homeRatingValue = validateRatingValue({
    gameId,
    rating: homeRating,
    team: homeTeam,
  })
  const awayRatingValue = validateRatingValue({
    gameId,
    rating: awayRating,
    team: awayTeam,
  })

  if (homeRatingValue.error || awayRatingValue.error) {
    return {
      error: homeRatingValue.error ?? awayRatingValue.error,
      status: 'skipped',
    }
  }

  const homeAdvantageAudit = calculateEffectiveHomeAdvantage({
    baseHomeAdvantage: settings.homeAdvantage,
    homeRating,
  })
  const pregameProbability = calculatePregameProbability({
    awayRating: awayRatingValue.value,
    automaticAdjustments: {},
    homeAdvantage: homeAdvantageAudit.effectiveHomeAdvantage,
    homeRating: homeRatingValue.value,
  })
  const ratingUpdate = calculateRatingUpdate({
    awayExpectedProbability: pregameProbability.awayProbability,
    configuration,
    homeExpectedProbability: pregameProbability.homeProbability,
    resultType: classification.resultType,
    winner: classification.winner,
  })
  const homeRatingAfter = homeRatingValue.value + ratingUpdate.homeDelta
  const awayRatingAfter = awayRatingValue.value + ratingUpdate.awayDelta
  const auditRecord = {
    awayRatingAfter,
    awayRatingBefore: awayRatingValue.value,
    awayRatingChange: ratingUpdate.awayDelta,
    awayScore: classification.finalScore.away,
    awayTeamAbbreviation: awayTeam.abbreviation,
    awayTeamId: awayTeam.teamId,
    baseHomeAdvantage: homeAdvantageAudit.baseHomeAdvantage,
    effectiveHomeAdvantage: homeAdvantageAudit.effectiveHomeAdvantage,
    engineSettingsSnapshot: buildEngineSettingsSnapshot(settings),
    gameDate: new Date(getGameStart(game)),
    gameId,
    homeRatingAfter,
    homeRatingBefore: homeRatingValue.value,
    homeRatingChange: ratingUpdate.homeDelta,
    homeScore: classification.finalScore.home,
    homeTeamAbbreviation: homeTeam.abbreviation,
    homeTeamAdjustment: homeAdvantageAudit.homeTeamAdjustment,
    homeTeamId: homeTeam.teamId,
    processedAt,
    resultType: buildResultType(classification.resultType),
    userId,
  }
  let auditCreated = false

  try {
    await createProcessedRatingGame({
      auditRecord,
      processedRatingGameModel,
      session,
    })
    auditCreated = true

    await updateTeamRating({
      powerRatingModel,
      ratingAfter: homeRatingAfter,
      ratingChange: ratingUpdate.homeDelta,
      session,
      teamId: homeTeam.teamId,
      userId,
    })
    await updateTeamRating({
      powerRatingModel,
      ratingAfter: awayRatingAfter,
      ratingChange: ratingUpdate.awayDelta,
      session,
      teamId: awayTeam.teamId,
      userId,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      if (session) {
        throw error
      }

      return {
        status: 'alreadyProcessed',
      }
    }

    if (auditCreated && !session) {
      await deleteProcessedRatingGame({
        gameId,
        processedRatingGameModel,
        userId,
      }).catch(() => {})
    }

    throw error
  }

  return {
    processedGame: buildProcessedGameResponse({
      auditRecord,
      awayTeam,
      homeTeam,
    }),
    status: 'processed',
  }
}

const processEligibleGame = async (context) => {
  if (!context.useTransactions) {
    return processEligibleGameWithoutTransaction({
      ...context,
      session: null,
    })
  }

  const session = await mongoose.startSession()

  try {
    let transactionResult

    await session.withTransaction(async () => {
      transactionResult = await processEligibleGameWithoutTransaction({
        ...context,
        session,
      })
    })

    return transactionResult
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        status: 'alreadyProcessed',
      }
    }

    if (isTransactionUnsupportedError(error)) {
      return processEligibleGameWithoutTransaction({
        ...context,
        session: null,
      })
    }

    throw error
  } finally {
    await session.endSession()
  }
}

const findEligibleGames = ({ dates, games, teamsById }) => {
  const uniqueGames = deduplicateGamesById(games).sort(
    compareGamesChronologically,
  )
  const eligibleGames = []

  uniqueGames.forEach((game) => {
    const eligibility = classifyGameEligibility(game, {
      dateFrom: dates.from,
      dateFromTimestamp: dates.fromTimestamp,
      dateTo: dates.to,
      dateToTimestamp: dates.toTimestamp,
      gameTypes: LIVE_UPDATE_GAME_TYPE_FILTERS,
      teamsById,
    })

    if (!eligibility.eligible) {
      return
    }

    eligibleGames.push({
      awayTeam: eligibility.awayTeam,
      game,
      gameId: normalizeGameId(game),
      homeTeam: eligibility.homeTeam,
    })
  })

  return {
    eligibleGames,
    gamesFetched: uniqueGames.length,
  }
}

const applyCompletedGamesToPowerRatings = async (
  userId,
  payload = {},
  options = {},
) => {
  if (!userId) {
    throw new RatingUpdateError('Authenticated userId is required.', 401)
  }

  const dates = normalizeUpdateDateRange(payload, {
    todayProvider: options.todayProvider,
  })
  const gamesProvider = options.gamesProvider ?? fetchNhlScheduleGames
  const powerRatingModel = options.powerRatingModel ?? PowerRating
  const processedRatingGameModel =
    options.processedRatingGameModel ?? ProcessedRatingGame
  const settingsProvider =
    options.settingsProvider ?? getProductionRatingEngineSettings
  const settings = await settingsProvider(userId)
  const configuration = getRatingUpdateConfiguration(settings)
  const teamsById = await buildTeamDirectory()
  const fetchedGames = await gamesProvider({
    dateFrom: dates.from,
    dateFromTimestamp: dates.fromTimestamp,
    dateTo: dates.to,
    dateToTimestamp: dates.toTimestamp,
  })
  const { eligibleGames } = findEligibleGames({
    dates,
    games: fetchedGames,
    teamsById,
  })
  const gameIds = eligibleGames
    .map((game) => game.gameId)
    .filter(Number.isFinite)
  const processedGameIds = await loadExistingProcessedGameIds({
    gameIds,
    processedRatingGameModel,
    userId,
  })
  const summary = {
    success: true,
    dateRange: {
      from: dates.from,
      to: dates.to,
    },
    gamesFound: eligibleGames.length,
    gamesAlreadyProcessed: 0,
    gamesProcessed: 0,
    gamesSkipped: 0,
    errors: [],
    processedGames: [],
  }
  const useTransactions =
    options.useTransactions ?? canUseMongooseTransactions()
  const processedAt = options.processedAt ?? new Date()

  for (const eligibleGame of eligibleGames) {
    if (
      Number.isFinite(eligibleGame.gameId) &&
      processedGameIds.has(eligibleGame.gameId)
    ) {
      summary.gamesAlreadyProcessed += 1
      continue
    }

    const result = await processEligibleGame({
      awayTeam: eligibleGame.awayTeam,
      configuration,
      game: eligibleGame.game,
      homeTeam: eligibleGame.homeTeam,
      powerRatingModel,
      processedAt,
      processedRatingGameModel,
      settings,
      useTransactions,
      userId,
    })

    if (result.status === 'alreadyProcessed') {
      summary.gamesAlreadyProcessed += 1
      continue
    }

    if (result.status === 'skipped') {
      summary.gamesSkipped += 1
      summary.errors.push(result.error)
      continue
    }

    summary.gamesProcessed += 1
    summary.processedGames.push(result.processedGame)
  }

  return summary
}

module.exports = {
  DEFAULT_UPDATE_RANGE_DAYS,
  LIVE_UPDATE_GAME_TYPE_FILTERS,
  RatingUpdateError,
  applyCompletedGamesToPowerRatings,
  normalizeUpdateDateRange,
}
