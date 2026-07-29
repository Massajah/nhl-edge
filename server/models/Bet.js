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
    homeStoredInjuryImpact: { type: Number, default: 0 },
    awayStoredInjuryImpact: { type: Number, default: 0 },
    homeInjuries: { type: Number, default: 0 },
    awayInjuries: { type: Number, default: 0 },
    homeGoalie: { type: Number, default: 0 },
    awayGoalie: { type: Number, default: 0 },
    homeGoalieId: { type: String, trim: true, default: '' },
    homeGoalieName: { type: String, trim: true, default: '' },
    awayGoalieId: { type: String, trim: true, default: '' },
    awayGoalieName: { type: String, trim: true, default: '' },
    homeRecentForm: { type: Number, default: 0 },
    awayRecentForm: { type: Number, default: 0 },
    homeRestFatigue: { type: Number, default: 0 },
    awayRestFatigue: { type: Number, default: 0 },
    homeMotivation: { type: Number, default: 0 },
    awayMotivation: { type: Number, default: 0 },
    homeManualAdjustment: { type: Number, default: 0 },
    awayManualAdjustment: { type: Number, default: 0 },
  },
  { _id: false },
)

const bettingSettingsSnapshotSchema = new mongoose.Schema(
  {
    bankrollBasis: {
      type: String,
      enum: ['', 'AVAILABLE', 'CURRENT'],
      default: '',
    },
    customKellyFraction: {
      type: Number,
      default: null,
    },
    kellyMode: {
      type: String,
      enum: ['', 'FULL', 'HALF', 'QUARTER', 'CUSTOM'],
      default: '',
    },
    maximumStakePercent: {
      type: Number,
      default: null,
    },
    minimumEdgePercent: {
      type: Number,
      default: null,
    },
    stakeRoundingIncrement: {
      type: Number,
      default: null,
    },
  },
  { _id: false },
)

const kellyRecommendationSchema = new mongoose.Schema(
  {
    appliedKellyFraction: {
      type: Number,
      default: null,
    },
    bankrollAmountAtRecommendation: {
      type: Number,
      default: null,
    },
    bankrollBasis: {
      type: String,
      enum: ['', 'AVAILABLE', 'CURRENT'],
      default: '',
    },
    bettingSettingsSnapshot: {
      type: bettingSettingsSnapshotSchema,
      default: null,
    },
    capApplied: {
      type: Boolean,
      default: false,
    },
    eligible: {
      type: Boolean,
      default: false,
    },
    fractionalKellyPercent: {
      type: Number,
      default: null,
    },
    fullKellyPercent: {
      type: Number,
      default: null,
    },
    maximumStakePercent: {
      type: Number,
      default: null,
    },
    minimumEdgePercent: {
      type: Number,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    recommendedStakeAmount: {
      type: Number,
      default: null,
    },
    recommendedStakePercent: {
      type: Number,
      default: null,
    },
    roundingIncrement: {
      type: Number,
      default: null,
    },
  },
  { _id: false },
)

const betSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
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
    selectedTeam: {
      type: teamSchema,
      default: () => ({}),
    },
    selectedSide: {
      type: selectedSideSchema,
      default: () => ({}),
    },
    modelStatus: {
      type: String,
      trim: true,
      default: '',
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
    impliedMarketProbability: {
      type: Number,
      default: null,
    },
    expectedValue: {
      type: Number,
      default: null,
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
    awayBaseRating: {
      type: Number,
      default: null,
    },
    homeBaseRating: {
      type: Number,
      default: null,
    },
    awayEffectiveRating: {
      type: Number,
      default: null,
    },
    homeEffectiveRating: {
      type: Number,
      default: null,
    },
    ratingDifference: {
      type: Number,
      default: null,
    },
    goalieAdjustment: {
      type: Number,
      default: null,
    },
    storedInjuryImpact: {
      type: Number,
      default: null,
    },
    gameInjuryAdjustment: {
      type: Number,
      default: null,
    },
    totalInjuryAdjustment: {
      type: Number,
      default: null,
    },
    restFatigueAdjustment: {
      type: Number,
      default: null,
    },
    motivationAdjustment: {
      type: Number,
      default: null,
    },
    manualAdjustment: {
      type: Number,
      default: null,
    },
    selectedGoalieName: {
      type: String,
      trim: true,
      default: '',
    },
    selectedGoalieSavePercentage: {
      type: Number,
      default: null,
    },
    selectedGoalieGamesPlayed: {
      type: Number,
      default: null,
    },
    selectedGoalieGamesStarted: {
      type: Number,
      default: null,
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
    kellyRecommendation: {
      type: kellyRecommendationSchema,
      default: undefined,
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

betSchema.index({ userId: 1, analyzedAt: -1, createdAt: -1 })
betSchema.index({ userId: 1, gameId: 1 })

module.exports = mongoose.model('Bet', betSchema)
module.exports.RESULT_VALUES = RESULT_VALUES
