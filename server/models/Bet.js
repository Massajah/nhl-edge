const mongoose = require('mongoose')

const RESULT_VALUES = ['pending', 'win', 'loss', 'push', 'void']

const teamSchema = new mongoose.Schema(
  {
    teamId: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    abbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
  },
  { _id: false },
)

const selectedSideSchema = new mongoose.Schema(
  {
    teamId: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    abbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    homeAway: {
      type: String,
      enum: ['home', 'away'],
      default: 'home',
    },
  },
  { _id: false },
)

const adjustmentsSchema = new mongoose.Schema(
  {
    homeAdvantage: { type: Number, default: 0 },
    homeInjuries: { type: Number, default: 0 },
    awayInjuries: { type: Number, default: 0 },
    homeGoalie: { type: Number, default: 0 },
    awayGoalie: { type: Number, default: 0 },
    homeRecentForm: { type: Number, default: 0 },
    awayRecentForm: { type: Number, default: 0 },
    homeMotivation: { type: Number, default: 0 },
    awayMotivation: { type: Number, default: 0 },
  },
  { _id: false },
)

const betSchema = new mongoose.Schema(
  {
    gameId: {
      type: String,
      trim: true,
      default: '',
    },
    analyzedAt: {
      type: Date,
      required: true,
    },
    scheduledStart: {
      type: Date,
      default: null,
    },
    homeTeam: {
      type: teamSchema,
      default: () => ({}),
    },
    awayTeam: {
      type: teamSchema,
      default: () => ({}),
    },
    selectedSide: {
      type: selectedSideSchema,
      default: () => ({}),
    },
    modelProbability: {
      type: Number,
      default: 0,
    },
    fairOdds: {
      type: Number,
      default: 0,
    },
    marketOdds: {
      type: Number,
      default: 1.01,
      min: 1.01,
    },
    probabilityEdge: {
      type: Number,
      default: 0,
    },
    oddsValuePercentage: {
      type: Number,
      default: 0,
    },
    recommendation: {
      type: String,
      trim: true,
      default: '',
    },
    stake: {
      type: Number,
      default: 1,
      min: 0,
    },
    stakeType: {
      type: String,
      trim: true,
      default: 'units',
    },
    sportsbook: {
      type: String,
      trim: true,
      default: '',
    },
    closingOdds: {
      type: Number,
      default: null,
    },
    result: {
      type: String,
      enum: RESULT_VALUES,
      default: 'pending',
    },
    profit: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    adjustments: {
      type: adjustmentsSchema,
      default: () => ({}),
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

module.exports = mongoose.model('Bet', betSchema)
module.exports.RESULT_VALUES = RESULT_VALUES
