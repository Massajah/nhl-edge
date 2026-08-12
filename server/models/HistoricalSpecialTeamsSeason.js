const mongoose = require('mongoose')

const DATASET_STATUSES = ['importing', 'ready', 'error']

const teamSpecialTeamsSchema = new mongoose.Schema(
  {
    teamId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    sourceTeamAbbreviation: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    teamName: {
      type: String,
      required: true,
      trim: true,
    },
    gamesPlayed: {
      type: Number,
      min: 0,
      required: true,
    },
    powerPlayGoals: {
      type: Number,
      min: 0,
      required: true,
    },
    powerPlayOpportunities: {
      type: Number,
      min: 0,
      required: true,
    },
    rawPowerPlayPercentage: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    penaltyKillSituations: {
      type: Number,
      min: 0,
      required: true,
    },
    powerPlayGoalsAllowed: {
      type: Number,
      min: 0,
      required: true,
    },
    rawPenaltyKillPercentage: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
  },
  { _id: false },
)

const historicalSpecialTeamsSeasonSchema = new mongoose.Schema(
  {
    seasonId: {
      type: String,
      required: true,
      match: /^\d{8}$/,
      trim: true,
      unique: true,
    },
    status: {
      type: String,
      enum: DATASET_STATUSES,
      required: true,
      default: 'importing',
    },
    teams: {
      type: [teamSpecialTeamsSchema],
      default: [],
    },
    teamCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'NHL Stats API',
    },
    sourceFetchedAt: {
      type: Date,
      default: null,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastErrorCode: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

historicalSpecialTeamsSeasonSchema.index({ status: 1, seasonId: -1 })

module.exports = mongoose.model(
  'HistoricalSpecialTeamsSeason',
  historicalSpecialTeamsSeasonSchema,
)
module.exports.DATASET_STATUSES = DATASET_STATUSES
