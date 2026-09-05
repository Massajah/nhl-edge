const mongoose = require('mongoose')
const {
  ODDS_SNAPSHOT_PROVIDER,
} = require('../services/oddsSnapshotContracts')

const QUOTA_LEDGER_SOURCES = Object.freeze([
  'MANUAL',
  'AUTOMATIC',
  'CONTROLLED_PROBE',
])
const QUOTA_REQUEST_STATUSES = Object.freeze(['SUCCESS', 'FAILED'])

const nonNegativeNumber = {
  default: 0,
  min: 0,
  type: Number,
}

const nonNegativeInteger = {
  ...nonNegativeNumber,
  validate: {
    message: 'Quota ledger counts must be non-negative integers.',
    validator: Number.isInteger,
  },
}

const nullableNonNegativeNumber = {
  default: null,
  min: 0,
  type: Number,
}

const oddsQuotaLedgerSchema = new mongoose.Schema(
  {
    schemaVersion: {
      enum: [1],
      immutable: true,
      required: true,
      type: Number,
    },
    provider: {
      enum: [ODDS_SNAPSHOT_PROVIDER],
      immutable: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    remaining: nullableNonNegativeNumber,
    used: nullableNonNegativeNumber,
    lastRequestCost: nullableNonNegativeNumber,
    observedAt: { default: null, type: Date },
    source: {
      default: null,
      enum: [...QUOTA_LEDGER_SOURCES, null],
      type: String,
    },
    lastRequestAt: { default: null, type: Date },
    lastRequestStatus: {
      default: null,
      enum: [...QUOTA_REQUEST_STATUSES, null],
      type: String,
    },
    billingWindowKey: {
      match: /^\d{4}-\d{2}$/,
      required: true,
      trim: true,
      type: String,
    },
    billingWindowStartedAt: { required: true, type: Date },
    billingWindowEndsAt: { required: true, type: Date },
    automaticCreditSpend: nonNegativeNumber,
    automaticRequestCount: nonNegativeInteger,
    automaticSuccessfulRequestCount: nonNegativeInteger,
    controlledProbeRequestCount: nonNegativeInteger,
    dailyKey: {
      match: /^\d{4}-\d{2}-\d{2}$/,
      required: true,
      trim: true,
      type: String,
    },
    dailyAutomaticSuccessfulRequestCount: nonNegativeInteger,
    updatedAt: { required: true, type: Date },
  },
  {
    collection: 'odds_quota_ledgers',
    strict: 'throw',
    versionKey: false,
  },
)

const OddsQuotaLedger = mongoose.model(
  'OddsQuotaLedger',
  oddsQuotaLedgerSchema,
)

module.exports = OddsQuotaLedger
module.exports.QUOTA_LEDGER_SOURCES = QUOTA_LEDGER_SOURCES
module.exports.QUOTA_REQUEST_STATUSES = QUOTA_REQUEST_STATUSES
