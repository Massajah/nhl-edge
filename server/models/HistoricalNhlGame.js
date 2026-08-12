const mongoose = require('mongoose')

const RESULT_TYPES = ['regulation', 'overtime', 'shootout']
const COMPLETED_GAME_STATES = ['FINAL', 'OFF']

const uppercaseTrim = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

const historicalNhlGameSchema = new mongoose.Schema(
  {
    gameId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    seasonId: {
      type: String,
      required: true,
      match: /^\d{8}$/,
      trim: true,
    },
    gameDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    startTimeUTC: {
      type: Date,
      required: true,
    },
    gameType: {
      type: Number,
      enum: [2],
      required: true,
    },
    homeTeamId: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    homeTeamAbbreviation: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    awayTeamId: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    awayTeamAbbreviation: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    homeScore: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
    },
    awayScore: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
    },
    resultType: {
      type: String,
      enum: RESULT_TYPES,
      required: true,
    },
    gameState: {
      type: String,
      enum: COMPLETED_GAME_STATES,
      required: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'NHL API',
    },
    sourceUpdatedAt: {
      type: Date,
      default: null,
    },
    importedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

historicalNhlGameSchema.index({ seasonId: 1, gameDate: 1 })
historicalNhlGameSchema.index({ seasonId: 1, startTimeUTC: 1 })

module.exports = mongoose.model('HistoricalNhlGame', historicalNhlGameSchema)
module.exports.COMPLETED_GAME_STATES = COMPLETED_GAME_STATES
module.exports.RESULT_TYPES = RESULT_TYPES
