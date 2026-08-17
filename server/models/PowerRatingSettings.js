const mongoose = require('mongoose')
const { BASE_MODEL_V1 } = require('../config/baseModel')

const STARTING_RATING_SCALE_MODES = ['standard', 'custom']

const powerRatingSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startingRatingScaleMode: {
      type: String,
      enum: STARTING_RATING_SCALE_MODES,
      required: true,
      default: 'standard',
    },
    startingRatingCenter: {
      type: Number,
      required: true,
      default: BASE_MODEL_V1.startingRatings.center,
      min: 0,
      max: 100,
    },
    startingRatingSpread: {
      type: Number,
      required: true,
      default: BASE_MODEL_V1.startingRatings.spread,
      min: Number.EPSILON,
      max: 100,
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

powerRatingSettingsSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model(
  'PowerRatingSettings',
  powerRatingSettingsSchema,
)
