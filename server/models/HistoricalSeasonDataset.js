const mongoose = require('mongoose')

const DATASET_STATUSES = [
  'not_imported',
  'importing',
  'partial',
  'ready',
  'error',
]

const completedWindowSchema = new mongoose.Schema(
  {
    dateFrom: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    dateTo: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    gamesFound: {
      type: Number,
      min: 0,
      default: 0,
    },
    gamesPersisted: {
      type: Number,
      min: 0,
      default: 0,
    },
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false },
)

const historicalSeasonDatasetSchema = new mongoose.Schema(
  {
    seasonId: {
      type: String,
      required: true,
      match: /^\d{8}$/,
      trim: true,
      unique: true,
    },
    regularSeasonStart: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    regularSeasonEnd: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    expectedApproximateGames: {
      type: Number,
      min: 0,
      default: 1312,
    },
    importedGames: {
      type: Number,
      min: 0,
      default: 0,
    },
    completedGames: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: DATASET_STATUSES,
      default: 'not_imported',
      required: true,
    },
    completedWindows: {
      type: [completedWindowSchema],
      default: [],
    },
    firstGameDate: {
      type: String,
      default: null,
    },
    lastGameDate: {
      type: String,
      default: null,
    },
    skippedGames: {
      type: Number,
      min: 0,
      default: 0,
    },
    skipReasons: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'NHL API',
    },
    lastErrorCode: {
      type: String,
      trim: true,
      default: null,
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

historicalSeasonDatasetSchema.index({ status: 1, seasonId: -1 })

module.exports = mongoose.model(
  'HistoricalSeasonDataset',
  historicalSeasonDatasetSchema,
)
module.exports.DATASET_STATUSES = DATASET_STATUSES
