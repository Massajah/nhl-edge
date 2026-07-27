const mongoose = require('mongoose')

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
      min: 0,
      max: 10,
    },
    homeAdvantage: {
      type: Number,
      required: true,
      min: 0,
      max: 15,
    },
    regulationMultiplier: {
      type: Number,
      required: true,
      min: 0,
      max: 2,
    },
    overtimeMultiplier: {
      type: Number,
      required: true,
      min: 0,
      max: 2,
    },
    shootoutMultiplier: {
      type: Number,
      required: true,
      min: 0,
      max: 2,
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
