const mongoose = require('mongoose')

const uppercaseTrim = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

const powerRatingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    teamId: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    teamName: {
      type: String,
      required: true,
      trim: true,
    },
    abbreviation: {
      type: String,
      required: true,
      trim: true,
      set: uppercaseTrim,
    },
    baseRating: {
      type: Number,
      required: true,
      default: 50,
    },
    homeAdvantage: {
      type: Number,
      required: true,
      default: 2.5,
    },
    manualAdjustment: {
      type: Number,
      default: 0,
    },
    lastRatingChange: {
      type: Number,
      default: 0,
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

powerRatingSchema.index({ userId: 1, teamId: 1 }, { unique: true })
powerRatingSchema.index({ userId: 1, abbreviation: 1 }, { unique: true })
powerRatingSchema.index({ userId: 1, teamName: 1 })

module.exports = mongoose.model('PowerRating', powerRatingSchema)
