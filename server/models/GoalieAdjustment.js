const mongoose = require('mongoose')

const goalieAdjustmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    teamId: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },
    nhlPlayerId: {
      type: Number,
      required: true,
      min: 1,
    },
    ratingAdjustment: {
      type: Number,
      required: true,
      min: -5,
      max: 5,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    activeOverride: {
      type: Boolean,
      default: null,
    },
    cachedDisplayName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id?.toString()
        returnedObject.userId = returnedObject.userId?.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

goalieAdjustmentSchema.index(
  { userId: 1, teamId: 1, nhlPlayerId: 1 },
  { unique: true },
)

module.exports = mongoose.model('GoalieAdjustment', goalieAdjustmentSchema)
