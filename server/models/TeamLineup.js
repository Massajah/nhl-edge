const mongoose = require('mongoose')

const forwardLineSchema = new mongoose.Schema(
  {
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
    },
    leftWingPlayerId: {
      type: Number,
      default: null,
      min: 1,
    },
    leftWingDisplayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    centerPlayerId: {
      type: Number,
      default: null,
      min: 1,
    },
    centerDisplayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    rightWingPlayerId: {
      type: Number,
      default: null,
      min: 1,
    },
    rightWingDisplayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
  },
  { _id: false },
)

const defensePairSchema = new mongoose.Schema(
  {
    pairNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    leftDefensePlayerId: {
      type: Number,
      default: null,
      min: 1,
    },
    leftDefenseDisplayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    rightDefensePlayerId: {
      type: Number,
      default: null,
      min: 1,
    },
    rightDefenseDisplayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
  },
  { _id: false },
)

const teamLineupSchema = new mongoose.Schema(
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
    forwardLines: {
      type: [forwardLineSchema],
      default: [],
    },
    defensePairs: {
      type: [defensePairSchema],
      default: [],
    },
    lineupNote: {
      type: String,
      trim: true,
      maxlength: 1500,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id?.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
      },
    },
  },
)

teamLineupSchema.index({ userId: 1, teamId: 1 }, { unique: true })

module.exports = mongoose.model('TeamLineup', teamLineupSchema)
