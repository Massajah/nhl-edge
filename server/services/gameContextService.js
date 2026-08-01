const GameContext = require('../models/GameContext')
const nhlApiService = require('./nhlApiService')
const quickRematchSettingsService = require('./quickRematchSettingsService')
const {
  GameContextError,
  MS_PER_DAY,
  calculateGameContextForGame,
  normalizeGame,
  normalizeOverridePayload,
  roundAdjustment,
} = require('./gameContextRules')

const MAX_BULK_GAMES = 30
const GAME_CONTEXT_MUTABLE_FIELDS = Object.freeze([
  'scheduledStart',
  'gameState',
  'status',
  'homeTeam',
  'awayTeam',
  'homeContext',
  'awayContext',
  'sourceVersion',
  'lastCalculatedAt',
])

const getContextModel = (options = {}) => options.contextModel ?? GameContext

const getScheduleGamesForDateRangeProvider = (options = {}) =>
  options.getScheduleGamesForDateRange ??
  nhlApiService.getScheduleGamesForDateRange

const getQuickRematchSettingsProvider = (options = {}) =>
  options.getQuickRematchSettings ??
  quickRematchSettingsService.getQuickRematchSettings

const asPlainDocument = (document) =>
  typeof document?.toJSON === 'function' ? document.toJSON() : document

const serializeContext = (document) => asPlainDocument(document)

const buildGameContextMutableUpdate = (context = {}) =>
  GAME_CONTEXT_MUTABLE_FIELDS.reduce((updates, field) => {
    if (Object.hasOwn(context, field)) {
      updates[field] = context[field]
    }

    return updates
  }, {})

const validateGamesPayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new GameContextError('Request body must be an object.', 400)
  }

  if (!Array.isArray(payload.games)) {
    throw new GameContextError('games must be an array.', 400, {
      field: 'games',
    })
  }

  if (payload.games.length > MAX_BULK_GAMES) {
    throw new GameContextError(`games cannot include more than ${MAX_BULK_GAMES} items.`, 400, {
      field: 'games',
    })
  }

  return payload.games.map((game, index) => {
    const normalizedGame = normalizeGame(game)
    const missingFields = []

    if (!normalizedGame.gameId) {
      missingFields.push('gameId')
    }

    if (!normalizedGame.scheduledStart) {
      missingFields.push('startTimeUTC')
    }

    if (!normalizedGame.homeTeam.abbreviation) {
      missingFields.push('homeTeam.abbreviation')
    }

    if (!normalizedGame.awayTeam.abbreviation) {
      missingFields.push('awayTeam.abbreviation')
    }

    if (missingFields.length > 0) {
      throw new GameContextError('Game context request contains an invalid game.', 400, {
        index,
        missingFields,
      })
    }

    return normalizedGame
  })
}

const formatUtcDateValue = (date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const addUtcDays = (date, dayCount) =>
  new Date(date.getTime() + dayCount * MS_PER_DAY)

const getScheduleRangeForGames = (games, quickRematchSettings = {}) => {
  const startTimes = games
    .map((game) => game.scheduledStart?.getTime?.())
    .filter(Number.isFinite)

  if (startTimes.length === 0) {
    return null
  }

  const maxHistoryDays = Math.max(
    6,
    Number(
      quickRematchSettings.quickRematchMaximumDays ??
        quickRematchSettings.maxDaysSincePreviousMeeting,
    ) || 0,
  )
  const minStartTime = Math.min(...startTimes)
  const maxStartTime = Math.max(...startTimes)

  return {
    dateFrom: formatUtcDateValue(
      addUtcDays(new Date(minStartTime), -maxHistoryDays - 1),
    ),
    dateTo: formatUtcDateValue(addUtcDays(new Date(maxStartTime), 1)),
    maxHistoryDays,
  }
}

const loadScheduleGamesForContext = async (
  games,
  quickRematchSettings,
  options = {},
) => {
  const scheduleRange = getScheduleRangeForGames(games, quickRematchSettings)

  if (!scheduleRange) {
    return {
      scheduleError: null,
      scheduleGames: [],
      scheduleRange: null,
    }
  }

  try {
    const getScheduleGamesForDateRange =
      getScheduleGamesForDateRangeProvider(options)
    const scheduleGames = await getScheduleGamesForDateRange(
      scheduleRange.dateFrom,
      scheduleRange.dateTo,
    )

    return {
      scheduleError: null,
      scheduleGames,
      scheduleRange,
    }
  } catch (error) {
    return {
      scheduleError: error,
      scheduleGames: [],
      scheduleRange,
    }
  }
}

const getScheduleErrorStatus = (error) =>
  error?.upstreamStatus === 429 || error?.statusCode === 429
    ? 'rate_limited'
    : 'unavailable'

const getScheduleErrorReason = (error) =>
  getScheduleErrorStatus(error) === 'rate_limited'
    ? 'NHL API rate limit reached while loading schedule history.'
    : 'Team schedule history is unavailable.'

const buildExistingContextMap = async (userId, gameIds, contextModel) => {
  if (gameIds.length === 0) {
    return new Map()
  }

  const existingDocuments = await contextModel.find({
    gameId: { $in: gameIds },
    userId,
  })

  return existingDocuments.reduce((contextsByGameId, document) => {
    const plainDocument = asPlainDocument(document)

    contextsByGameId.set(plainDocument.gameId, plainDocument)

    return contextsByGameId
  }, new Map())
}

const markScheduleUnavailable = ({
  context,
  dataStatus = 'unavailable',
  reason = 'Team schedule history is unavailable.',
  side,
  team,
}) => {
  const sideKey = `${side}Context`
  const existingSideContext = context[sideKey]
  const effectiveRestFatigueAdjustment =
    existingSideContext.restFatigueOverrideEnabled
      ? existingSideContext.manualRestFatigueAdjustment
      : 0
  const effectiveQuickRematchAdjustment =
    existingSideContext.quickRematchOverrideEnabled
      ? existingSideContext.manualQuickRematchAdjustment
      : 0

  context[sideKey] = {
    ...existingSideContext,
    adjustmentBreakdown: [],
    automaticQuickRematchAdjustment: 0,
    automaticRestFatigueAdjustment: 0,
    conditions: [],
    dataStatus,
    effectiveQuickRematchAdjustment,
    effectiveRestFatigueAdjustment,
    gamesInFourDays: 0,
    gamesInSixDays: 0,
    backToBack: false,
    currentHomeTeamId: null,
    currentTeamSide: null,
    currentVenueCity: null,
    hasMeaningfulTravel: false,
    isBackToBack: false,
    previousHomeTeamId: null,
    previousTeamSide: null,
    previousVenueCity: null,
    quickRematch: {
      ...existingSideContext.quickRematch,
      eligible: false,
      reason,
    },
    reasons: [reason],
    restDays: null,
    restFatigueCondition: 'normal',
    sameAwayHomeTeam: null,
    team,
    totalGameContextAdjustment: roundAdjustment(
      effectiveRestFatigueAdjustment + effectiveQuickRematchAdjustment,
    ),
    travelBetweenGames: false,
    travelClassificationSource: 'unavailable',
  }
}

const buildContextsForGames = async (userId, games, options = {}) => {
  if (!userId) {
    throw new GameContextError('Authenticated userId is required.', 401)
  }

  const contextModel = getContextModel(options)
  const now = options.now ?? new Date()
  const [{ settings: quickRematchSettings }, existingContextsByGameId] =
    await Promise.all([
      getQuickRematchSettingsProvider(options)(userId, options),
      buildExistingContextMap(
        userId,
        games.map((game) => game.gameId),
        contextModel,
      ),
    ])
  const { scheduleError, scheduleGames } = await loadScheduleGamesForContext(
    games,
    quickRematchSettings,
    options,
  )
  const scheduleErrorStatus = scheduleError
    ? getScheduleErrorStatus(scheduleError)
    : null
  const scheduleErrorReason = scheduleError
    ? getScheduleErrorReason(scheduleError)
    : ''

  return games.map((game) => {
    const existingContext = existingContextsByGameId.get(game.gameId) ?? {}
    const context = calculateGameContextForGame({
      awayScheduleGames: scheduleGames,
      currentGame: game,
      existingContext,
      homeScheduleGames: scheduleGames,
      now,
      quickRematchSettings,
    })

    if (scheduleError) {
      markScheduleUnavailable({
        context,
        dataStatus: scheduleErrorStatus,
        reason: scheduleErrorReason,
        side: 'away',
        team: context.awayTeam,
      })
      markScheduleUnavailable({
        context,
        dataStatus: scheduleErrorStatus,
        reason: scheduleErrorReason,
        side: 'home',
        team: context.homeTeam,
      })
    }

    return {
      ...context,
      userId,
    }
  })
}

const getGameContexts = async (userId, payload = {}, options = {}) => {
  const games = validateGamesPayload(payload)
  const contextModel = getContextModel(options)
  const contexts = await buildContextsForGames(userId, games, options)
  const savedContexts = await Promise.all(
    contexts.map((context) =>
      contextModel.findOneAndUpdate(
        {
          gameId: context.gameId,
          userId,
        },
        {
          $set: buildGameContextMutableUpdate(context),
          $setOnInsert: {
            gameId: context.gameId,
            userId,
          },
        },
        {
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          upsert: true,
        },
      ),
    ),
  )

  return {
    contexts: savedContexts.map(serializeContext),
    sourceVersion: contexts[0]?.sourceVersion ?? 'game-context-v1',
  }
}

const updateGameContextOverrides = async (
  userId,
  gameId,
  payload = {},
  options = {},
) => {
  if (!userId) {
    throw new GameContextError('Authenticated userId is required.', 401)
  }

  const normalizedGameId = String(gameId ?? '').trim()

  if (!normalizedGameId) {
    throw new GameContextError('gameId is required.', 400, { field: 'gameId' })
  }

  const contextModel = getContextModel(options)
  const updates = normalizeOverridePayload(payload)
  const document = await contextModel.findOneAndUpdate(
    {
      gameId: normalizedGameId,
      userId,
    },
    {
      $set: updates,
      $setOnInsert: {
        gameId: normalizedGameId,
        lastCalculatedAt: new Date(0),
        sourceVersion: 'game-context-v1',
        userId,
      },
    },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )

  return {
    context: serializeContext(document),
    success: true,
  }
}

module.exports = {
  GAME_CONTEXT_MUTABLE_FIELDS,
  MAX_BULK_GAMES,
  buildGameContextMutableUpdate,
  buildContextsForGames,
  getGameContexts,
  getScheduleRangeForGames,
  loadScheduleGamesForContext,
  updateGameContextOverrides,
  validateGamesPayload,
}
