const mongoose = require('mongoose')

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

const goalieSelectionSchema = new mongoose.Schema(
  {
    selectionType: {
      type: String,
      enum: ['provider_goalie', 'team_goalie', 'custom', 'unknown'],
      default: 'unknown',
    },
    teamId: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    teamGoalieId: {
      type: String,
      trim: true,
      default: null,
    },
    nhlPlayerId: {
      type: Number,
      default: null,
    },
    goalieName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    customNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    source: {
      type: String,
      enum: [
        'provider_goalie',
        'team_goalie',
        'team_roster',
        'custom',
        'unknown',
      ],
      default: 'unknown',
    },
    confirmationStatus: {
      type: String,
      enum: ['unknown', 'selected', 'expected', 'confirmed'],
      default: 'unknown',
    },
    teamDefaultAdjustment: {
      type: Number,
      min: -5,
      max: 5,
      default: null,
    },
    manualAdjustment: {
      type: Number,
      min: -5,
      max: 5,
      default: null,
    },
    overrideEnabled: {
      type: Boolean,
      default: false,
    },
    effectiveAdjustment: {
      type: Number,
      min: -5,
      max: 5,
      default: 0,
    },
  },
  { _id: false },
)

const quickRematchContextSchema = new mongoose.Schema(
  {
    eligible: {
      type: Boolean,
      default: false,
    },
    previousGameId: {
      type: String,
      trim: true,
      default: '',
    },
    previousGameDate: {
      type: Date,
      default: null,
    },
    previousOpponentAbbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    previousOpponentName: {
      type: String,
      trim: true,
      default: '',
    },
    previousWinnerAbbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    previousLoserAbbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    hoursSincePreviousMeeting: {
      type: Number,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false },
)

const restFatigueAdjustmentBreakdownSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      trim: true,
      enum: ['quickRematch', 'restFatigue'],
      default: 'restFatigue',
    },
    condition: {
      type: String,
      trim: true,
      default: '',
    },
    adjustment: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
)

const teamGameContextSchema = new mongoose.Schema(
  {
    team: {
      type: teamSchema,
      default: () => ({}),
    },
    restDays: {
      type: Number,
      default: null,
    },
    isBackToBack: {
      type: Boolean,
      default: false,
    },
    backToBack: {
      type: Boolean,
      default: false,
    },
    gamesInFourDays: {
      type: Number,
      default: 0,
    },
    gamesInSixDays: {
      type: Number,
      default: 0,
    },
    hasMeaningfulTravel: {
      type: Boolean,
      default: false,
    },
    travelBetweenGames: {
      type: Boolean,
      default: null,
    },
    previousTeamSide: {
      type: String,
      enum: ['home', 'away', null],
      default: null,
    },
    currentTeamSide: {
      type: String,
      enum: ['home', 'away', null],
      default: null,
    },
    previousHomeTeamId: {
      type: String,
      trim: true,
      default: null,
    },
    currentHomeTeamId: {
      type: String,
      trim: true,
      default: null,
    },
    sameAwayHomeTeam: {
      type: Boolean,
      default: null,
    },
    previousVenueCity: {
      type: String,
      trim: true,
      default: null,
    },
    currentVenueCity: {
      type: String,
      trim: true,
      default: null,
    },
    travelClassificationSource: {
      type: String,
      trim: true,
      default: '',
    },
    restFatigueCondition: {
      type: String,
      trim: true,
      default: 'normal',
    },
    conditions: {
      type: [String],
      default: [],
    },
    automaticRestFatigueAdjustment: {
      type: Number,
      default: 0,
    },
    adjustmentBreakdown: {
      type: [restFatigueAdjustmentBreakdownSchema],
      default: [],
    },
    manualRestFatigueAdjustment: {
      type: Number,
      default: 0,
    },
    restFatigueOverrideEnabled: {
      type: Boolean,
      default: false,
    },
    effectiveRestFatigueAdjustment: {
      type: Number,
      default: 0,
    },
    quickRematch: {
      type: quickRematchContextSchema,
      default: () => ({}),
    },
    automaticQuickRematchAdjustment: {
      type: Number,
      default: 0,
    },
    manualQuickRematchAdjustment: {
      type: Number,
      default: 0,
    },
    quickRematchOverrideEnabled: {
      type: Boolean,
      default: false,
    },
    effectiveQuickRematchAdjustment: {
      type: Number,
      default: 0,
    },
    totalGameContextAdjustment: {
      type: Number,
      default: 0,
    },
    reasons: {
      type: [String],
      default: [],
    },
    dataStatus: {
      type: String,
      enum: [
        'available',
        'incomplete',
        'partial',
        'rate_limited',
        'ready',
        'unavailable',
      ],
      default: 'available',
    },
    scheduleWindowDiagnostics: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
)

const gameContextSchema = new mongoose.Schema(
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
      required: true,
    },
    scheduledStart: {
      type: Date,
      default: null,
    },
    gameState: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      default: '',
    },
    homeTeam: {
      type: teamSchema,
      default: () => ({}),
    },
    awayTeam: {
      type: teamSchema,
      default: () => ({}),
    },
    homeContext: {
      type: teamGameContextSchema,
      default: () => ({}),
    },
    awayContext: {
      type: teamGameContextSchema,
      default: () => ({}),
    },
    goalieSelections: {
      away: {
        type: goalieSelectionSchema,
        default: () => ({}),
      },
      home: {
        type: goalieSelectionSchema,
        default: () => ({}),
      },
    },
    sourceVersion: {
      type: String,
      trim: true,
      required: true,
    },
    lastCalculatedAt: {
      type: Date,
      required: true,
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

gameContextSchema.index({ userId: 1, gameId: 1 }, { unique: true })

module.exports = mongoose.model('GameContext', gameContextSchema)
