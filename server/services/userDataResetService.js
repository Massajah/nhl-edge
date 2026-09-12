const mongoose = require('mongoose')
const BankrollProfile = require('../models/BankrollProfile')
const BankrollTransaction = require('../models/BankrollTransaction')
const Bet = require('../models/Bet')
const BettingSettings = require('../models/BettingSettings')
const BookmakerPreferences = require('../models/BookmakerPreferences')
const GameContext = require('../models/GameContext')
const ForwardPredictionSnapshot = require('../models/ForwardPredictionSnapshot')
const GoalieAdjustment = require('../models/GoalieAdjustment')
const Injury = require('../models/Injury')
const PowerRating = require('../models/PowerRating')
const PowerRatingSettings = require('../models/PowerRatingSettings')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const QuickRematchSettings = require('../models/QuickRematchSettings')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const RatingLabPromotionAudit = require('../models/RatingLabPromotionAudit')
const TeamGoalies = require('../models/TeamGoalies')
const TeamLineup = require('../models/TeamLineup')
const nhlSeasonService = require('./nhlSeasonService')
const powerRatingsService = require('./powerRatingsService')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
} = require('./ratingEngineSettingsService')
const {
  DEFAULT_QUICK_REMATCH_SETTINGS,
} = require('./quickRematchSettingsService')
const { DEFAULT_BETTING_SETTINGS } = require('./bettingSettingsService')
const {
  DEFAULT_STARTING_RATING_SCALE,
  normalizeStartingRatingScale,
} = require('./startingRatingScaleService')

const FACTORY_RESET_CONFIRMATION = 'DELETE'

class UserDataResetError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'UserDataResetError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const getModels = (options = {}) => ({
  BankrollProfile: options.models?.BankrollProfile ?? BankrollProfile,
  BankrollTransaction:
    options.models?.BankrollTransaction ?? BankrollTransaction,
  Bet: options.models?.Bet ?? Bet,
  BettingSettings: options.models?.BettingSettings ?? BettingSettings,
  BookmakerPreferences:
    options.models?.BookmakerPreferences ?? BookmakerPreferences,
  GameContext: options.models?.GameContext ?? GameContext,
  ForwardPredictionSnapshot: options.models?.ForwardPredictionSnapshot ?? ForwardPredictionSnapshot,
  GoalieAdjustment: options.models?.GoalieAdjustment ?? GoalieAdjustment,
  Injury: options.models?.Injury ?? Injury,
  PowerRating: options.models?.PowerRating ?? PowerRating,
  PowerRatingSettings:
    options.models?.PowerRatingSettings ?? PowerRatingSettings,
  ProcessedRatingGame:
    options.models?.ProcessedRatingGame ?? ProcessedRatingGame,
  QuickRematchSettings:
    options.models?.QuickRematchSettings ?? QuickRematchSettings,
  RatingEngineSettings:
    options.models?.RatingEngineSettings ?? RatingEngineSettings,
  RatingLabPromotionAudit:
    options.models?.RatingLabPromotionAudit ?? RatingLabPromotionAudit,
  TeamGoalies: options.models?.TeamGoalies ?? TeamGoalies,
  TeamLineup: options.models?.TeamLineup ?? TeamLineup,
})

const requireUserId = (userId) => {
  if (!userId) {
    throw new UserDataResetError('Authenticated userId is required.', 401)
  }
}

const getDeletedCount = (result) => Number(result?.deletedCount) || 0

const deleteOneForUser = async (model, userId, session) =>
  getDeletedCount(await model.deleteOne({ userId }, { session }))

const deleteManyForUser = async (model, userId, session, extraFilter = {}) =>
  getDeletedCount(
    await model.deleteMany({ ...extraFilter, userId }, { session }),
  )

const runWithTransaction = async (work, options = {}) => {
  if (options.runInTransaction) {
    return options.runInTransaction(work)
  }

  return mongoose.connection.transaction((session) => work(session))
}

const buildDefaultSettings = () => ({
  betting: { ...DEFAULT_BETTING_SETTINGS },
  quickRematch: { ...DEFAULT_QUICK_REMATCH_SETTINGS },
  ratingEngine: { ...DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS },
  startingRatingScale: normalizeStartingRatingScale(
    DEFAULT_STARTING_RATING_SCALE,
  ),
})

const resetSettingsDocuments = async (userId, session, models) => ({
  bettingSettings: await deleteOneForUser(
    models.BettingSettings,
    userId,
    session,
  ),
  bookmakerPreferences: await deleteOneForUser(
    models.BookmakerPreferences,
    userId,
    session,
  ),
  powerRatingSettings: await deleteOneForUser(
    models.PowerRatingSettings,
    userId,
    session,
  ),
  quickRematchSettings: await deleteOneForUser(
    models.QuickRematchSettings,
    userId,
    session,
  ),
  ratingEngineSettings: await deleteOneForUser(
    models.RatingEngineSettings,
    userId,
    session,
  ),
})

const auditReset = (type, userId, counts, options = {}) => {
  const logger = options.logger ?? console

  logger.info('NHL Edge user data reset completed.', {
    counts,
    resetType: type,
    timestamp: new Date().toISOString(),
    userId: String(userId),
  })
}

const resetSettingsToDefaults = async (userId, options = {}) => {
  requireUserId(userId)
  const models = getModels(options)
  const counts = await runWithTransaction(
    (session) => resetSettingsDocuments(userId, session, models),
    options,
  )
  const result = {
    counts,
    defaults: buildDefaultSettings(),
    message: 'Settings restored to NHL Edge defaults.',
    preserved: [
      'bets',
      'bankroll',
      'powerRatings',
      'ratingHistory',
      'injuries',
      'gameData',
      'historicalDatasets',
    ],
    resetType: 'settings',
    success: true,
  }

  auditReset(result.resetType, userId, counts, options)
  return result
}

const getCurrentSeasonBoundary = async (options = {}) => {
  const provider =
    options.seasonMetadataProvider ??
    nhlSeasonService.getAvailablePowerRatingHistorySeasons
  const metadata = await provider()
  const season = metadata?.seasons?.find(
    (candidate) =>
      candidate.id === metadata.currentSeasonId || candidate.isCurrent,
  )

  if (!season?.startDate || !season?.endDate) {
    throw new UserDataResetError(
      'Unable to identify the current NHL season reset boundary.',
      503,
    )
  }

  return {
    end: new Date(`${season.endDate}T23:59:59.999Z`),
    id: season.id,
    start: new Date(`${season.startDate}T00:00:00.000Z`),
  }
}

const resetForNewSeason = async (userId, options = {}) => {
  requireUserId(userId)
  const models = getModels(options)
  const season = await getCurrentSeasonBoundary(options)
  const resetPowerRatings =
    options.resetPowerRatings ?? powerRatingsService.resetPowerRatings
  const result = await runWithTransaction(async (session) => {
    const startingScaleDocument = await models.PowerRatingSettings.findOne(
      { userId },
      null,
      { session },
    )
    const startingRatingScale = normalizeStartingRatingScale(
      startingScaleDocument,
    )
    const ratingsResult = await resetPowerRatings(userId, {
      clearSeasonStartingRating: true,
      powerRatingModel: models.PowerRating,
      session,
      startingRatingScale,
    })
    const counts = {
      gameContexts: await deleteManyForUser(
        models.GameContext,
        userId,
        session,
      ),
      injuries: await deleteManyForUser(models.Injury, userId, session),
      processedRatingGames: await deleteManyForUser(
        models.ProcessedRatingGame,
        userId,
        session,
        { gameDate: { $gte: season.start, $lte: season.end } },
      ),
      powerRatings: Number(ratingsResult?.totalTeams) || 0,
    }

    return {
      counts,
      message:
        'New season state prepared. Bets and bankroll history were preserved.',
      preserved: [
        'settings',
        'bets',
        'bankroll',
        'historicalDatasets',
        'providerCaches',
      ],
      resetType: 'new-season',
      preservedForwardPredictions: true,
      seasonId: season.id,
      startingRatingScale,
      success: true,
    }
  }, options)

  auditReset(result.resetType, userId, result.counts, options)
  return result
}

const factoryResetUserData = async (userId, payload = {}, options = {}) => {
  requireUserId(userId)

  if (payload.confirmation !== FACTORY_RESET_CONFIRMATION) {
    throw new UserDataResetError(
      `Type ${FACTORY_RESET_CONFIRMATION} to confirm the factory reset.`,
      400,
      { field: 'confirmation' },
    )
  }

  const models = getModels(options)
  const result = await runWithTransaction(async (session) => {
    const settings = await resetSettingsDocuments(userId, session, models)
    const counts = {
      ...settings,
      bankrollProfiles: await deleteManyForUser(
        models.BankrollProfile,
        userId,
        session,
      ),
      bankrollTransactions: await deleteManyForUser(
        models.BankrollTransaction,
        userId,
        session,
      ),
      bets: await deleteManyForUser(models.Bet, userId, session),
      forwardPredictions: await deleteManyForUser(models.ForwardPredictionSnapshot, userId, session),
      gameContexts: await deleteManyForUser(
        models.GameContext,
        userId,
        session,
      ),
      goalieAdjustments: await deleteManyForUser(
        models.GoalieAdjustment,
        userId,
        session,
      ),
      injuries: await deleteManyForUser(models.Injury, userId, session),
      powerRatingHistory: await deleteManyForUser(
        models.ProcessedRatingGame,
        userId,
        session,
      ),
      powerRatings: await deleteManyForUser(
        models.PowerRating,
        userId,
        session,
      ),
      ratingLabPromotionAudits: await deleteManyForUser(
        models.RatingLabPromotionAudit,
        userId,
        session,
      ),
      teamGoalies: await deleteManyForUser(
        models.TeamGoalies,
        userId,
        session,
      ),
      teamLineups: await deleteManyForUser(
        models.TeamLineup,
        userId,
        session,
      ),
    }

    return {
      counts,
      defaults: buildDefaultSettings(),
      message: 'NHL Edge user data was reset.',
      preserved: [
        'account',
        'historicalNhlGames',
        'historicalSeasonDatasets',
        'historicalSpecialTeamsSeasons',
        'providerCaches',
      ],
      resetType: 'factory',
      success: true,
    }
  }, options)

  auditReset(result.resetType, userId, result.counts, options)
  return result
}

module.exports = {
  FACTORY_RESET_CONFIRMATION,
  UserDataResetError,
  factoryResetUserData,
  resetForNewSeason,
  resetSettingsToDefaults,
}
