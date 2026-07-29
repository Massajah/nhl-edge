const mongoose = require('mongoose')

const KELLY_MODES = Object.freeze(['FULL', 'HALF', 'QUARTER', 'CUSTOM'])
const BANKROLL_BASES = Object.freeze(['AVAILABLE', 'CURRENT'])
const STAKE_ROUNDING_INCREMENTS = Object.freeze([0.01, 0.05, 0.1, 0.5, 1, 5])

const bettingSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kellyMode: {
      type: String,
      enum: KELLY_MODES,
      required: true,
    },
    customKellyFraction: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    maximumStakePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    minimumEdgePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    stakeRoundingIncrement: {
      type: Number,
      enum: STAKE_ROUNDING_INCREMENTS,
      required: true,
    },
    bankrollBasis: {
      type: String,
      enum: BANKROLL_BASES,
      required: true,
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

bettingSettingsSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model('BettingSettings', bettingSettingsSchema)
module.exports.BANKROLL_BASES = BANKROLL_BASES
module.exports.KELLY_MODES = KELLY_MODES
module.exports.STAKE_ROUNDING_INCREMENTS = STAKE_ROUNDING_INCREMENTS
