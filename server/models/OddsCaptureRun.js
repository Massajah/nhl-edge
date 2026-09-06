const mongoose = require('mongoose')
const {
  ODDS_SNAPSHOT_TYPE_VALUES,
} = require('../services/oddsSnapshotContracts')

const CAPTURE_RUN_STATUSES = Object.freeze([
  'STARTED',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'QUOTA_BLOCKED',
  'RECOVERED_FAILED',
])
const CAPTURE_RUN_FINAL_STATUSES = Object.freeze(
  CAPTURE_RUN_STATUSES.filter((status) => status !== 'STARTED'),
)
const CAPTURE_TRIGGER_SOURCES = Object.freeze([
  'MANUAL',
  'SCHEDULED',
  'RETRY',
  'TEST',
])
const CHECKPOINT_RESULT_STATUSES = Object.freeze([
  'STORED',
  'EXISTING',
  'SKIPPED',
  'FAILED',
  'BLOCKED',
])
const MAX_CHECKPOINT_RESULTS = 64
const MAX_REASON_COUNTS = 32
const MAX_REASON_KEY_LENGTH = 80

const nonNegativeInteger = {
  min: 0,
  type: Number,
  validate: {
    message: 'Capture counts must be non-negative integers.',
    validator: Number.isInteger,
  },
}

const quotaSnapshotSchema = new mongoose.Schema(
  {
    remaining: { type: Number, min: 0, default: null },
    used: { type: Number, min: 0, default: null },
    lastCost: { type: Number, min: 0, default: null },
    observedAt: { type: Date, default: null },
  },
  { _id: false, strict: 'throw' },
)

const checkpointResultSchema = new mongoose.Schema(
  {
    gameId: {
      type: String,
      match: /^\d{10}$/,
      required: true,
      trim: true,
    },
    checkpointKey: {
      type: String,
      maxlength: 200,
      required: true,
      trim: true,
    },
    snapshotType: {
      type: String,
      enum: [...ODDS_SNAPSHOT_TYPE_VALUES, 'CLOSING'],
      required: true,
    },
    status: {
      type: String,
      enum: CHECKPOINT_RESULT_STATUSES,
      required: true,
    },
    reason: {
      type: String,
      maxlength: 160,
      default: '',
      trim: true,
    },
  },
  { _id: false, strict: 'throw' },
)

const hasBoundedReasonCounts = (reasonCounts) => {
  if (!reasonCounts) {
    return true
  }

  const entries = reasonCounts instanceof Map
    ? [...reasonCounts.entries()]
    : Object.entries(reasonCounts)

  return (
    entries.length <= MAX_REASON_COUNTS &&
    entries.every(
      ([reason, count]) =>
        Boolean(String(reason).trim()) &&
        String(reason).trim().length <= MAX_REASON_KEY_LENGTH &&
        Number.isInteger(count) &&
        count >= 0,
    )
  )
}

const oddsCaptureRunSchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
    },
    runKey: {
      type: String,
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
    },
    triggerSource: {
      type: String,
      enum: CAPTURE_TRIGGER_SOURCES,
      immutable: true,
      required: true,
    },
    intendedAt: { type: Date, immutable: true, required: true },
    startedAt: { type: Date, immutable: true, required: true },
    completedAt: { type: Date, default: null },
    recoveredAt: { type: Date, default: null },
    recoveryReason: {
      type: String,
      maxlength: 160,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: CAPTURE_RUN_STATUSES,
      default: 'STARTED',
      required: true,
    },
    providerRequestCount: { ...nonNegativeInteger, default: 0 },
    actualCreditCost: { type: Number, min: 0, default: null },
    quotaBefore: { type: quotaSnapshotSchema, default: null },
    quotaAfter: { type: quotaSnapshotSchema, default: null },
    eventsReceived: { ...nonNegativeInteger, default: 0 },
    gamesConsidered: { ...nonNegativeInteger, default: 0 },
    gamesMatched: { ...nonNegativeInteger, default: 0 },
    snapshotsStored: { ...nonNegativeInteger, default: 0 },
    gamesSkipped: { ...nonNegativeInteger, default: 0 },
    checkpointResults: {
      type: [checkpointResultSchema],
      default: [],
      validate: {
        message: `checkpointResults cannot exceed ${MAX_CHECKPOINT_RESULTS} entries.`,
        validator: (results) =>
          Array.isArray(results) && results.length <= MAX_CHECKPOINT_RESULTS,
      },
    },
    reasonCounts: {
      type: Map,
      of: Number,
      default: () => new Map(),
      validate: {
        message: `reasonCounts must contain at most ${MAX_REASON_COUNTS} non-negative integer counts.`,
        validator: hasBoundedReasonCounts,
      },
    },
  },
  {
    collection: 'odds_capture_runs',
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

oddsCaptureRunSchema.index({ runKey: 1 }, { unique: true })
oddsCaptureRunSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 400 * 24 * 60 * 60 },
)

const OddsCaptureRun = mongoose.model('OddsCaptureRun', oddsCaptureRunSchema)

module.exports = OddsCaptureRun
module.exports.CAPTURE_RUN_FINAL_STATUSES = CAPTURE_RUN_FINAL_STATUSES
module.exports.CAPTURE_RUN_STATUSES = CAPTURE_RUN_STATUSES
module.exports.CAPTURE_TRIGGER_SOURCES = CAPTURE_TRIGGER_SOURCES
module.exports.CHECKPOINT_RESULT_STATUSES = CHECKPOINT_RESULT_STATUSES
module.exports.MAX_CHECKPOINT_RESULTS = MAX_CHECKPOINT_RESULTS
module.exports.MAX_REASON_COUNTS = MAX_REASON_COUNTS
module.exports.MAX_REASON_KEY_LENGTH = MAX_REASON_KEY_LENGTH
module.exports.hasBoundedReasonCounts = hasBoundedReasonCounts
