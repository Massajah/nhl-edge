const { randomUUID } = require('crypto')
const mongoose = require('mongoose')

const teamGoalieSchema = new mongoose.Schema(
  {
    goalieId: {
      type: String,
      trim: true,
      required: true,
      default: randomUUID,
    },
    nhlPlayerId: {
      type: Number,
      default: null,
    },
    name: {
      type: String,
      trim: true,
      required: true,
      maxlength: 120,
    },
    ratingAdjustment: {
      type: Number,
      required: true,
      min: -5,
      max: 5,
    },
    active: {
      type: Boolean,
      default: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    sortOrder: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
    timestamps: true,
  },
)

const teamGoaliesSchema = new mongoose.Schema(
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
    teamName: {
      type: String,
      trim: true,
      required: true,
    },
    teamAbbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },
    goalies: {
      type: [teamGoalieSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
)

teamGoaliesSchema.index({ userId: 1, teamId: 1 }, { unique: true })

module.exports = mongoose.model('TeamGoalies', teamGoaliesSchema)
