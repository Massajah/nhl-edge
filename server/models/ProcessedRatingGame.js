const mongoose = require('mongoose')

const RESULT_TYPES = ['REGULATION', 'OVERTIME', 'SHOOTOUT']

const uppercaseTrim = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

const engineSettingsSnapshotSchema = new mongoose.Schema(
  {
    modelVersion: {
      type: String,
      required: true,
      trim: true,
    },
    kFactor: {
      type: Number,
      required: true,
    },
    homeAdvantage: {
      type: Number,
      required: true,
    },
    regulationMultiplier: {
      type: Number,
      required: true,
    },
    overtimeMultiplier: {
      type: Number,
      required: true,
    },
    shootoutMultiplier: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
)

const processedRatingGameSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    gameId: {
      type: Number,
      required: true,
    },
    gameDate: {
      type: Date,
      required: true,
    },
    homeTeamId: {
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
    homeTeamAbbreviation: {
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
    },
    awayScore: {
      type: Number,
      required: true,
    },
    resultType: {
      type: String,
      enum: RESULT_TYPES,
      required: true,
    },
    homeRatingBefore: {
      type: Number,
      required: true,
    },
    awayRatingBefore: {
      type: Number,
      required: true,
    },
    homeRatingAfter: {
      type: Number,
      required: true,
    },
    awayRatingAfter: {
      type: Number,
      required: true,
    },
    homeRatingChange: {
      type: Number,
      required: true,
    },
    awayRatingChange: {
      type: Number,
      required: true,
    },
    baseHomeAdvantage: {
      type: Number,
      required: true,
    },
    homeTeamAdjustment: {
      type: Number,
      required: true,
    },
    effectiveHomeAdvantage: {
      type: Number,
      required: true,
    },
    processedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    engineSettingsSnapshot: {
      type: engineSettingsSnapshotSchema,
      required: true,
    },
  },
  {
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

processedRatingGameSchema.index({ userId: 1, gameId: 1 }, { unique: true })
processedRatingGameSchema.index({ gameId: 1 })
processedRatingGameSchema.index({ userId: 1, gameDate: 1 })

module.exports = mongoose.model('ProcessedRatingGame', processedRatingGameSchema)
module.exports.RESULT_TYPES = RESULT_TYPES
