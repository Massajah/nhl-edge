const mongoose = require('mongoose')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const {
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  ODDS_SNAPSHOT_TYPE_VALUES,
} = require('../services/oddsSnapshotContracts')
const { TEAM_IDENTITIES } = require('../services/nhlTeamIdentity')

const SUPPORTED_BOOKMAKER_KEYS = Object.freeze(
  REQUESTED_BOOKMAKERS.map(({ key }) => key),
)
const SUPPORTED_TEAM_IDS = Object.freeze(
  TEAM_IDENTITIES.map(([teamId]) => teamId),
)
const supportedTeamIdSet = new Set(SUPPORTED_TEAM_IDS)

const uppercaseTrim = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

const isFiniteDecimalOdds = (value) =>
  Number.isFinite(value) && value > 1

const hasUniqueBookmakerKeys = (bookmakers = []) => {
  const keys = bookmakers.map(({ key }) => key)

  return new Set(keys).size === keys.length
}
const hasSelectedBookmakers = (keys = []) =>
  Array.isArray(keys) && keys.length > 0 && new Set(keys).size === keys.length

const bookmakerOddsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: SUPPORTED_BOOKMAKER_KEYS,
      immutable: true,
      required: true,
      trim: true,
    },
    homeOdds: {
      type: Number,
      immutable: true,
      required: true,
      validate: {
        message: 'homeOdds must be a finite decimal price greater than 1.',
        validator: isFiniteDecimalOdds,
      },
    },
    awayOdds: {
      type: Number,
      immutable: true,
      required: true,
      validate: {
        message: 'awayOdds must be a finite decimal price greater than 1.',
        validator: isFiniteDecimalOdds,
      },
    },
    lastUpdate: {
      type: Date,
      default: null,
      immutable: true,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
)

const oddsSnapshotSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: Number,
      enum: [1, 2],
      immutable: true,
      required: true,
    },
    gameId: {
      type: String,
      immutable: true,
      match: /^\d{10}$/,
      required: true,
      trim: true,
    },
    seasonId: {
      type: String,
      immutable: true,
      match: /^\d{8}$/,
      required: true,
      trim: true,
    },
    gameType: {
      type: Number,
      immutable: true,
      required: true,
      validate: {
        message: 'gameType must be a positive integer NHL game type.',
        validator: (value) => Number.isInteger(value) && value > 0,
      },
    },
    homeTeamId: {
      type: String,
      immutable: true,
      required: true,
      set: uppercaseTrim,
      validate: {
        message: 'homeTeamId must be a canonical NHL team identifier.',
        validator: (value) => supportedTeamIdSet.has(value),
      },
    },
    awayTeamId: {
      type: String,
      immutable: true,
      required: true,
      set: uppercaseTrim,
      validate: [
        {
          message: 'awayTeamId must be a canonical NHL team identifier.',
          validator: (value) => supportedTeamIdSet.has(value),
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
      type: String,
      enum: [ODDS_SNAPSHOT_PROVIDER],
      immutable: true,
      required: true,
      trim: true,
    },
    providerEventId: {
      type: String,
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
    },
    market: {
      type: String,
      enum: [ODDS_SNAPSHOT_MARKET],
      immutable: true,
      required: true,
      trim: true,
    },
    checkpointKey: {
      type: String,
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
    },
    snapshotType: {
      type: String,
      enum: ODDS_SNAPSHOT_TYPE_VALUES,
      immutable: true,
      required: true,
    },
    targetAt: {
      type: Date,
      immutable: true,
      required: true,
    },
    capturedAt: {
      type: Date,
      immutable: true,
      required: true,
    },
    scheduledStartAtCapture: {
      type: Date,
      immutable: true,
      required: true,
    },
    providerCommenceTime: {
      type: Date,
      immutable: true,
      required: true,
    },
    captureRunId: {
      type: String,
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
    },
    selectedBookmakerKeys: {
      type: [String],
      enum: SUPPORTED_BOOKMAKER_KEYS,
      default: undefined,
      immutable: true,
      required() {
        return this.schemaVersion === 2
      },
      validate: {
        message: 'Selected bookmaker keys must be non-empty and unique.',
        validator: hasSelectedBookmakers,
      },
    },
    bookmakers: {
      type: [bookmakerOddsSchema],
      immutable: true,
      required: true,
      validate: [
        {
          message: 'At least one usable bookmaker row is required.',
          validator: (bookmakers) =>
            Array.isArray(bookmakers) && bookmakers.length > 0,
        },
        {
          message: 'Bookmaker keys must be unique within a snapshot.',
          validator: hasUniqueBookmakerKeys,
        },
      ],
    },
  },
  {
    collection: 'odds_snapshots',
    strict: 'throw',
    versionKey: false,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
      },
    },
  },
)

oddsSnapshotSchema.index(
  { gameId: 1, provider: 1, checkpointKey: 1 },
  { unique: true },
)
oddsSnapshotSchema.index({
  seasonId: 1,
  snapshotType: 1,
  capturedAt: -1,
  gameId: 1,
})

const OddsSnapshot = mongoose.model('OddsSnapshot', oddsSnapshotSchema)

module.exports = OddsSnapshot
module.exports.SUPPORTED_BOOKMAKER_KEYS = SUPPORTED_BOOKMAKER_KEYS
module.exports.SUPPORTED_TEAM_IDS = SUPPORTED_TEAM_IDS
module.exports.hasUniqueBookmakerKeys = hasUniqueBookmakerKeys
module.exports.isFiniteDecimalOdds = isFiniteDecimalOdds
