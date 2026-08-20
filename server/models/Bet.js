const mongoose = require('mongoose')
const {
  SPECIAL_TEAMS_MATCHUP_STATUSES,
  SPECIAL_TEAMS_MODES,
  SPECIAL_TEAMS_SIGNALS,
} = require('../../shared/specialTeamsMatchups')

const RESULT_VALUES = ['pending', 'win', 'loss', 'push', 'void']
const BET_TYPE_VALUES = ['', 'moneyline']
const BANKROLL_ACCOUNTING_VALUES = ['legacy', 'transactional']
const SETTLEMENT_SOURCE_VALUES = ['automatic', 'manual']
const RECOMMENDATION_STATE_VALUES = [
  '',
  'NO_VALUE',
  'POSITIVE_VALUE_BELOW_THRESHOLD',
  'BET_CANDIDATE',
]

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

const specialTeamsSnapshotSchema = new mongoose.Schema(
  {
    adjustment: {
      type: Number,
      min: -1,
      max: 1,
      default: 0,
    },
    mode: {
      type: String,
      enum: Object.values(SPECIAL_TEAMS_MODES),
      default: SPECIAL_TEAMS_MODES.ALERT_ONLY,
    },
    opponentPkRank: {
      type: Number,
      default: null,
    },
    ppRank: {
      type: Number,
      default: null,
    },
    signal: {
      type: String,
      enum: Object.values(SPECIAL_TEAMS_SIGNALS),
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(SPECIAL_TEAMS_MATCHUP_STATUSES),
      default: SPECIAL_TEAMS_MATCHUP_STATUSES.UNAVAILABLE,
    },
    threshold: {
      type: Number,
      default: null,
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
    homeQuickRematch: { type: Number, default: 0 },
    awayQuickRematch: { type: Number, default: 0 },
    homeSpecialTeamsAdjustment: { type: Number, default: 0 },
    awaySpecialTeamsAdjustment: { type: Number, default: 0 },
    homeSpecialTeamsSnapshot: {
      type: specialTeamsSnapshotSchema,
      default: null,
    },
    awaySpecialTeamsSnapshot: {
      type: specialTeamsSnapshotSchema,
      default: null,
    },
    homeMotivation: { type: Number, default: 0 },
    awayMotivation: { type: Number, default: 0 },
    homeManualAdjustment: { type: Number, default: 0 },
    awayManualAdjustment: { type: Number, default: 0 },
  },
  { _id: false },
)

const settlementCorrectionSchema = new mongoose.Schema(
  {
    previousResult: {
      type: String,
      enum: RESULT_VALUES,
      required: true,
    },
    newResult: {
      type: String,
      enum: RESULT_VALUES,
      required: true,
    },
    correctedAt: {
      type: Date,
      required: true,
    },
    source: {
      type: String,
      enum: SETTLEMENT_SOURCE_VALUES,
      required: true,
    },
  },
  { _id: false },
)

const goalieSelectionSnapshotSchema = new mongoose.Schema(
  {
    selectionType: {
      type: String,
      enum: ['provider_goalie', 'team_goalie', 'custom', 'unknown'],
      required: true,
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
      required: true,
    },
    confirmationStatus: {
      type: String,
      enum: ['unknown', 'selected', 'expected', 'confirmed'],
      required: true,
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
      required: true,
    },
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
    recommendationState: {
      type: String,
      enum: RECOMMENDATION_STATE_VALUES,
      default: '',
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
    betType: {
      type: String,
      enum: BET_TYPE_VALUES,
      default: '',
    },
    placementId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
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
    recommendationState: {
      type: String,
      enum: RECOMMENDATION_STATE_VALUES,
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
    marketOddsSource: {
      type: String,
      enum: ['manual', 'manual_override', 'provider'],
      default: 'manual',
    },
    providerName: {
      type: String,
      trim: true,
      default: null,
    },
    providerEventId: {
      type: String,
      trim: true,
      default: null,
    },
    bookmakerKey: {
      type: String,
      trim: true,
      default: null,
    },
    bookmakerTitle: {
      type: String,
      trim: true,
      default: null,
    },
    providerFetchedAt: {
      type: Date,
      default: null,
    },
    bookmakerLastUpdate: {
      type: Date,
      default: null,
    },
    offeredOdds: {
      type: Number,
      default: null,
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
    quickRematchAdjustment: {
      type: Number,
      default: null,
    },
    specialTeamsAdjustment: {
      type: Number,
      default: null,
    },
    specialTeamsSnapshot: {
      type: specialTeamsSnapshotSchema,
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
    goalieSelectionSnapshot: {
      type: goalieSelectionSnapshotSchema,
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
    bankrollAccounting: {
      type: String,
      enum: BANKROLL_ACCOUNTING_VALUES,
      default: 'legacy',
    },
    stakeVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
    settlementVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    settlementSource: {
      type: String,
      enum: SETTLEMENT_SOURCE_VALUES,
      default: null,
    },
    settledGameId: {
      type: String,
      trim: true,
      default: '',
    },
    finalHomeScore: {
      type: Number,
      default: null,
    },
    finalAwayScore: {
      type: Number,
      default: null,
    },
    settlementReturn: {
      type: Number,
      min: 0,
      default: 0,
    },
    settlementIssue: {
      type: String,
      trim: true,
      default: '',
    },
    settlementCheckStatus: {
      type: String,
      trim: true,
      default: '',
    },
    lastSettlementCheckAt: {
      type: Date,
      default: null,
    },
    settlementCorrections: {
      type: [settlementCorrectionSchema],
      default: () => [],
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
    gameContextSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
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
betSchema.index(
  { userId: 1, placementId: 1 },
  {
    partialFilterExpression: {
      placementId: {
        $exists: true,
        $type: 'string',
      },
    },
    unique: true,
  },
)

module.exports = mongoose.model('Bet', betSchema)
module.exports.BANKROLL_ACCOUNTING_VALUES = BANKROLL_ACCOUNTING_VALUES
module.exports.BET_TYPE_VALUES = BET_TYPE_VALUES
module.exports.RESULT_VALUES = RESULT_VALUES
module.exports.SETTLEMENT_SOURCE_VALUES = SETTLEMENT_SOURCE_VALUES
