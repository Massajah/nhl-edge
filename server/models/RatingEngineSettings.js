const mongoose = require('mongoose')
const {
  DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS,
  MAXIMUM_GOALIE_PENALTY_LIMITS,
  MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS,
  PRODUCTION_PROBABILITY_SCALE_LIMITS,
  SPECIAL_TEAMS_ADJUSTMENT_LIMITS,
  SPECIAL_TEAMS_MODES,
} = require('../config/baseModel')

const ratingEngineSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kFactor: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.kFactor,
      min: 0,
      max: 10,
    },
    homeAdvantage: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.homeAdvantage,
      min: 0,
      max: 15,
    },
    regulationMultiplier: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.regulationMultiplier,
      min: 0,
      max: 2,
    },
    overtimeMultiplier: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.overtimeMultiplier,
      min: 0,
      max: 2,
    },
    shootoutMultiplier: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.shootoutMultiplier,
      min: 0,
      max: 2,
    },
    probabilityScale: {
      type: Number,
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.probabilityScale,
      min: PRODUCTION_PROBABILITY_SCALE_LIMITS.min,
      max: PRODUCTION_PROBABILITY_SCALE_LIMITS.max,
    },
    maximumGoaliePenalty: {
      type: Number,
      required: true,
      default:
        DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.maximumGoaliePenalty,
      min: MAXIMUM_GOALIE_PENALTY_LIMITS.min,
      max: MAXIMUM_GOALIE_PENALTY_LIMITS.max,
    },
    maximumPlayerInjuryPenalty: {
      type: Number,
      required: true,
      default:
        DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.maximumPlayerInjuryPenalty,
      min: MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS.min,
      max: MAXIMUM_PLAYER_INJURY_PENALTY_LIMITS.max,
      validate: {
        validator: (value) => Number.isInteger(value * 2),
        message: 'maximumPlayerInjuryPenalty must use 0.50-point increments.',
      },
    },
    specialTeamsAlertsEnabled: {
      type: Boolean,
      required: true,
      default:
        DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.specialTeamsAlertsEnabled,
    },
    specialTeamsRankThreshold: {
      type: Number,
      required: true,
      default:
        DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.specialTeamsRankThreshold,
      min: 3,
      max: 12,
      validate: {
        validator: Number.isInteger,
        message: 'specialTeamsRankThreshold must be an integer.',
      },
    },
    specialTeamsMode: {
      type: String,
      enum: Object.values(SPECIAL_TEAMS_MODES),
      required: true,
      default: DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.specialTeamsMode,
    },
    specialTeamsAdjustment: {
      type: Number,
      required: true,
      default:
        DEFAULT_PRODUCTION_RATING_ENGINE_SETTINGS.specialTeamsAdjustment,
      min: SPECIAL_TEAMS_ADJUSTMENT_LIMITS.min,
      max: SPECIAL_TEAMS_ADJUSTMENT_LIMITS.max,
      validate: {
        validator: (value) =>
          Number.isInteger(value / SPECIAL_TEAMS_ADJUSTMENT_LIMITS.step),
        message: 'specialTeamsAdjustment must use 0.25-point increments.',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        returnedObject.userId = returnedObject.userId?.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

ratingEngineSettingsSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model(
  'RatingEngineSettings',
  ratingEngineSettingsSchema,
)
