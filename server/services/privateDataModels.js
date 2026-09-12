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

const PRIVATE_DATA_MODELS = Object.freeze([
  BankrollProfile,
  BankrollTransaction,
  Bet,
  BettingSettings,
  BookmakerPreferences,
  GameContext,
  ForwardPredictionSnapshot,
  GoalieAdjustment,
  Injury,
  PowerRating,
  PowerRatingSettings,
  ProcessedRatingGame,
  QuickRematchSettings,
  RatingEngineSettings,
  RatingLabPromotionAudit,
  TeamGoalies,
  TeamLineup,
])

module.exports = { PRIVATE_DATA_MODELS }
