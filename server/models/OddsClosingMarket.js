const mongoose = require('mongoose')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const {
  CLOSING_MARKET_SCHEMA_VERSION,
  CLOSING_SAFETY_REASON,
  MAX_CLOSING_OBSERVATIONS,
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
} = require('../services/oddsClosingMarketContracts')
const { TEAM_IDENTITIES } = require('../services/nhlTeamIdentity')

const bookmakerKeys = REQUESTED_BOOKMAKERS.map(({ key }) => key)
const teamIds = new Set(TEAM_IDENTITIES.map(([teamId]) => teamId))
const validOdds = (value) => Number.isFinite(value) && value > 1
const hasUniqueValues = (values = []) =>
  Array.isArray(values) && new Set(values).size === values.length
const hasUniqueBookmakerKeys = (rows = []) =>
  Array.isArray(rows) && hasUniqueValues(rows.map(({ key }) => key))

const priceSchema = new mongoose.Schema(
  {
    key: { enum: bookmakerKeys, required: true, trim: true, type: String },
    homeOdds: { required: true, type: Number, validate: validOdds },
    awayOdds: { required: true, type: Number, validate: validOdds },
    lastUpdate: { default: null, type: Date },
  },
  { _id: false, strict: 'throw' },
)

const latestSafePriceSchema = new mongoose.Schema(
  {
    key: { enum: bookmakerKeys, required: true, trim: true, type: String },
    homeOdds: { required: true, type: Number, validate: validOdds },
    awayOdds: { required: true, type: Number, validate: validOdds },
    lastUpdate: { default: null, type: Date },
    observedAt: { required: true, type: Date },
    providerCommenceTime: { required: true, type: Date },
    providerEventId: { maxlength: 200, required: true, trim: true, type: String },
    lastUpdateMissing: { required: true, type: Boolean },
    safetyReason: {
      enum: [CLOSING_SAFETY_REASON],
      required: true,
      type: String,
    },
  },
  { _id: false, strict: 'throw' },
)

const observationSchema = new mongoose.Schema(
  {
    capturedAt: { required: true, type: Date },
    providerCommenceTime: { required: true, type: Date },
    providerEventId: { maxlength: 200, required: true, trim: true, type: String },
    marketStateHash: { maxlength: 64, minlength: 64, required: true, type: String },
    selectedBookmakerKeys: {
      enum: bookmakerKeys,
      required: true,
      type: [String],
      validate: hasUniqueValues,
    },
    bookmakers: {
      default: [],
      type: [priceSchema],
      validate: hasUniqueBookmakerKeys,
    },
  },
  { _id: false, strict: 'throw' },
)

const bestPriceSchema = new mongoose.Schema(
  {
    bookmakerKey: { enum: bookmakerKeys, required: true, type: String },
    odds: { required: true, type: Number, validate: validOdds },
    observedAt: { required: true, type: Date },
    lastUpdate: { default: null, type: Date },
  },
  { _id: false, strict: 'throw' },
)

const oddsClosingMarketSchema = new mongoose.Schema(
  {
    schemaVersion: {
      enum: [CLOSING_MARKET_SCHEMA_VERSION],
      immutable: true,
      required: true,
      type: Number,
    },
    closingKey: {
      immutable: true,
      maxlength: 260,
      required: true,
      trim: true,
      type: String,
    },
    gameId: {
      immutable: true,
      match: /^\d{10}$/,
      required: true,
      trim: true,
      type: String,
    },
    seasonId: {
      immutable: true,
      match: /^\d{8}$/,
      required: true,
      trim: true,
      type: String,
    },
    gameType: {
      immutable: true,
      required: true,
      type: Number,
      validate: (value) => Number.isInteger(value) && value > 0,
    },
    homeTeamId: {
      immutable: true,
      required: true,
      type: String,
      validate: (value) => teamIds.has(value),
    },
    awayTeamId: {
      immutable: true,
      required: true,
      type: String,
      validate: [
        {
          message: 'awayTeamId must be a canonical NHL team identifier.',
          validator: (value) => teamIds.has(value),
        },
        {
          message: 'homeTeamId and awayTeamId must differ.',
          validator(value) {
            return value !== this.homeTeamId
          },
        },
      ],
    },
    provider: {
      enum: [ODDS_SNAPSHOT_PROVIDER],
      immutable: true,
      required: true,
      type: String,
    },
    market: {
      enum: [ODDS_SNAPSHOT_MARKET],
      immutable: true,
      required: true,
      type: String,
    },
    scheduledStartAtCapture: { immutable: true, required: true, type: Date },
    selectedBookmakerKeys: {
      enum: bookmakerKeys,
      required: true,
      type: [String],
      validate: [
        {
          message: 'At least one selected bookmaker is required.',
          validator: (values) => Array.isArray(values) && values.length > 0,
        },
        {
          message: 'Selected bookmaker keys must be unique.',
          validator: hasUniqueValues,
        },
      ],
    },
    observations: {
      default: [],
      type: [observationSchema],
      validate: {
        message: `Closing observations cannot exceed ${MAX_CLOSING_OBSERVATIONS}.`,
        validator: (rows) => rows.length <= MAX_CLOSING_OBSERVATIONS,
      },
    },
    latestSafeBookmakers: {
      default: [],
      type: [latestSafePriceSchema],
      validate: hasUniqueBookmakerKeys,
    },
    lastMarketStateHash: { maxlength: 64, minlength: 64, required: true, type: String },
    firstObservedAt: { required: true, type: Date },
    lastObservedAt: { required: true, type: Date },
    revision: { default: 1, min: 1, required: true, type: Number },
    finalizedAt: { default: null, type: Date },
    finalizationReason: {
      default: null,
      enum: ['CLOSING_WINDOW_ENDED', 'GAME_STARTED', 'NO_SAFE_ODDS', null],
      type: String,
    },
    finalSelectedBookmakerKeys: {
      default: [],
      enum: bookmakerKeys,
      type: [String],
      validate: hasUniqueValues,
    },
    finalBookmakers: {
      default: [],
      type: [latestSafePriceSchema],
      validate: hasUniqueBookmakerKeys,
    },
    bestFinal: {
      default: () => ({ away: null, home: null }),
      type: new mongoose.Schema(
        {
          away: { default: null, type: bestPriceSchema },
          home: { default: null, type: bestPriceSchema },
        },
        { _id: false, strict: 'throw' },
      ),
    },
  },
  {
    collection: 'odds_closing_markets',
    strict: 'throw',
    versionKey: false,
  },
)

oddsClosingMarketSchema.index({ closingKey: 1 }, { unique: true })
oddsClosingMarketSchema.index({ gameId: 1, scheduledStartAtCapture: -1 })
oddsClosingMarketSchema.index({ finalizedAt: 1, scheduledStartAtCapture: 1 })
oddsClosingMarketSchema.index({ 'finalBookmakers.key': 1, scheduledStartAtCapture: -1 })

module.exports = mongoose.model('OddsClosingMarket', oddsClosingMarketSchema)
