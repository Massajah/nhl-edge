const mongoose = require('mongoose')
const AuthSession = require('../models/AuthSession')
const BankrollProfile = require('../models/BankrollProfile')
const BankrollTransaction = require('../models/BankrollTransaction')
const Bet = require('../models/Bet')
const BettingSettings = require('../models/BettingSettings')
const BookmakerPreferences = require('../models/BookmakerPreferences')
const ForwardPredictionSnapshot = require('../models/ForwardPredictionSnapshot')
const GameContext = require('../models/GameContext')
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
const User = require('../models/User')
const { ACCOUNT_TYPES } = require('../config/accountTypes')
const { getDemoCleanupBatchSize } = require('../config/demoSandbox')

// This is the authoritative inventory of persistent, owner-scoped NHL Edge data.
// Global NHL schedules, historical datasets, odds snapshots/caches, capture runs,
// quota ledgers, closing markets, leases and migration markers are intentionally absent.
const DEMO_OWNED_DATA_MODELS = Object.freeze({
  bankrollProfiles: BankrollProfile,
  bankrollTransactions: BankrollTransaction,
  bets: Bet,
  bettingSettings: BettingSettings,
  bookmakerPreferences: BookmakerPreferences,
  forwardPredictionSnapshots: ForwardPredictionSnapshot,
  gameContexts: GameContext,
  goalieAdjustments: GoalieAdjustment,
  injuries: Injury,
  powerRatings: PowerRating,
  powerRatingSettings: PowerRatingSettings,
  processedRatingGames: ProcessedRatingGame,
  quickRematchSettings: QuickRematchSettings,
  ratingEngineSettings: RatingEngineSettings,
  ratingLabPromotionAudits: RatingLabPromotionAudit,
  teamGoalies: TeamGoalies,
  teamLineups: TeamLineup,
})

const normalizeDate = (value, field) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const buildExpiredDemoFilter = (now) => ({
  accountType: ACCOUNT_TYPES.DEMO_SANDBOX,
  expiresAt: { $lte: normalizeDate(now, 'expiration boundary') },
})

const resolveQuery = async (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const getDeletedCount = (result) => Number(result?.deletedCount) || 0

const runWithTransaction = async (work, options = {}) => {
  if (options.runInTransaction) return options.runInTransaction(work)
  return mongoose.connection.transaction((session) => work(session))
}

const getModels = (options = {}) => ({
  authSessionModel: options.authSessionModel ?? AuthSession,
  ownedDataModels: options.ownedDataModels ?? DEMO_OWNED_DATA_MODELS,
  userModel: options.userModel ?? User,
})

const cleanupOneExpiredDemo = async (userId, now, options = {}) => {
  if (!userId) throw new TypeError('Demo cleanup requires an exact owner ID.')

  const { authSessionModel, ownedDataModels, userModel } = getModels(options)
  const expirationFilter = buildExpiredDemoFilter(now)

  return runWithTransaction(async (session) => {
    const exactAccountFilter = { _id: userId, ...expirationFilter }
    const candidate = await resolveQuery(
      userModel.findOne(exactAccountFilter, { _id: 1 }, { session }),
    )

    if (!candidate) return { counts: {}, removed: false }

    const counts = {}

    for (const [name, model] of Object.entries(ownedDataModels)) {
      counts[name] = getDeletedCount(
        await model.deleteMany({ userId }, { session }),
      )
    }

    counts.authSessions = getDeletedCount(
      await authSessionModel.deleteMany({ userId }, { session }),
    )

    const userResult = await userModel.deleteOne(exactAccountFilter, { session })

    if (getDeletedCount(userResult) !== 1) {
      throw new Error('Expired demo account changed during cleanup.')
    }

    counts.users = 1
    return { counts, removed: true }
  }, options)
}

const createDemoSandboxCleanupService = (defaults = {}) => ({
  async cleanupExpiredDemoSandboxes(runOptions = {}) {
    const options = { ...defaults, ...runOptions }
    const environment = options.environment ?? process.env
    const logger = options.logger ?? console
    const now = normalizeDate(
      (options.now ?? (() => new Date()))(),
      'clock',
    )
    const { userModel } = getModels(options)
    let query = userModel
      .find(buildExpiredDemoFilter(now), { _id: 1 })
      .sort({ expiresAt: 1, _id: 1 })
      .limit(getDemoCleanupBatchSize(environment))
    query = typeof query.lean === 'function' ? query.lean() : query
    const candidates = (await query) ?? []
    const summary = {
      expiredAccounts: candidates.length,
      failures: 0,
      removed: 0,
    }
    const errors = []

    for (const candidate of candidates) {
      try {
        const result = await cleanupOneExpiredDemo(candidate._id, now, options)
        if (result.removed) summary.removed += 1
      } catch (error) {
        summary.failures += 1
        errors.push(error)
        logger.warn?.('Demo sandbox cleanup failed for one account.', {
          errorName: error.name,
        })
      }
    }

    logger.info?.('Demo sandbox cleanup completed.', summary)

    if (errors.length > 0) {
      const error = new AggregateError(errors, 'Demo sandbox cleanup failed.')
      error.summary = summary
      throw error
    }

    return summary
  },
})

const demoSandboxCleanupService = createDemoSandboxCleanupService()

module.exports = {
  DEMO_OWNED_DATA_MODELS,
  buildExpiredDemoFilter,
  cleanupOneExpiredDemo,
  createDemoSandboxCleanupService,
  demoSandboxCleanupService,
}
