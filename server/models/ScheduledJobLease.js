const mongoose = require('mongoose')

const SCHEDULED_JOB_LEASE_STATUSES = Object.freeze([
  'RUNNING',
  'COMPLETED',
  'FAILED',
])

const scheduledJobLeaseSchema = new mongoose.Schema(
  {
    slotKey: {
      immutable: true,
      maxlength: 200,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    jobName: {
      immutable: true,
      maxlength: 100,
      required: true,
      trim: true,
      type: String,
    },
    intendedAt: { immutable: true, required: true, type: Date },
    leaseToken: {
      maxlength: 100,
      required: true,
      trim: true,
      type: String,
    },
    acquiredAt: { required: true, type: Date },
    expiresAt: { required: true, type: Date },
    completedAt: { default: null, type: Date },
    attemptCount: { default: 1, min: 1, type: Number },
    status: {
      enum: SCHEDULED_JOB_LEASE_STATUSES,
      required: true,
      type: String,
    },
    outcome: {
      default: '',
      maxlength: 100,
      trim: true,
      type: String,
    },
  },
  {
    collection: 'scheduled_job_leases',
    strict: 'throw',
    versionKey: false,
  },
)

scheduledJobLeaseSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 35 * 24 * 60 * 60 },
)

const ScheduledJobLease = mongoose.model(
  'ScheduledJobLease',
  scheduledJobLeaseSchema,
)

module.exports = ScheduledJobLease
module.exports.SCHEDULED_JOB_LEASE_STATUSES = SCHEDULED_JOB_LEASE_STATUSES
