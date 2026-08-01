const mongoose = require('mongoose')

const quickRematchSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    restFatigueEnabled: {
      type: Boolean,
      default: true,
    },
    wellRestedEnabled: {
      type: Boolean,
      default: false,
    },
    wellRestedAdjustment: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.25,
    },
    threeInFourEnabled: {
      type: Boolean,
      default: true,
    },
    threeInFourAdjustment: {
      type: Number,
      min: -3,
      max: 0,
      default: -0.5,
    },
    backToBackEnabled: {
      type: Boolean,
      default: true,
    },
    backToBackAdjustment: {
      type: Number,
      min: -3,
      max: 0,
      default: -0.75,
    },
    backToBackTravelEnabled: {
      type: Boolean,
      default: true,
    },
    backToBackTravelAdjustment: {
      type: Number,
      min: -3,
      max: 0,
      default: -1.25,
    },
    quickRematchEnabled: {
      type: Boolean,
      default: true,
    },
    quickRematchMaximumDays: {
      type: Number,
      min: 1,
      max: 14,
      default: 5,
    },
    quickRematchLoserAdjustment: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.25,
    },
    enabled: {
      type: Boolean,
    },
    maxDaysSincePreviousMeeting: {
      type: Number,
    },
    loserAdjustment: {
      type: Number,
    },
    wellRestedAdjustmentEnabled: {
      type: Boolean,
    },
    backToBackHomeAdjustment: {
      type: Number,
    },
    backToBackAwayAdjustment: {
      type: Number,
    },
    fourInSixAdjustment: {
      type: Number,
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

quickRematchSettingsSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model(
  'QuickRematchSettings',
  quickRematchSettingsSchema,
)
