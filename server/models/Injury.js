const mongoose = require('mongoose')

const INJURY_STATUSES = [
  'out',
  'injured-reserve',
  'day-to-day',
  'questionable',
  'healthy',
]
const DURATION_TYPES = ['short-term', 'long-term', 'unknown']

const injurySchema = new mongoose.Schema(
  {
    teamId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    teamName: {
      type: String,
      required: true,
      trim: true,
    },
    teamAbbreviation: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: INJURY_STATUSES,
      default: 'out',
    },
    injuryType: {
      type: String,
      trim: true,
      default: '',
    },
    impact: {
      type: Number,
      required: true,
      default: 0,
      max: 0,
    },
    durationType: {
      type: String,
      enum: DURATION_TYPES,
      default: 'unknown',
    },
    expectedReturn: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

module.exports = mongoose.model('Injury', injurySchema)
module.exports.INJURY_STATUSES = INJURY_STATUSES
module.exports.DURATION_TYPES = DURATION_TYPES
