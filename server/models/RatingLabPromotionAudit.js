const mongoose = require('mongoose')

const ratingLabPromotionAuditSchema = new mongoose.Schema(
  {
    promotionId: { type: String, required: true, unique: true, immutable: true },
    promotionPreviewId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    appliedAt: { type: Date, required: true, immutable: true },
    runId: { type: String, required: true, immutable: true },
    candidateId: { type: String, required: true, immutable: true },
    candidateLabel: { type: String, required: true, immutable: true },
    candidateType: { type: String, required: true, immutable: true },
    candidateConfigurationSignature: {
      type: String,
      required: true,
      immutable: true,
    },
    affectedFeatureFamilies: {
      type: [String],
      required: true,
      immutable: true,
    },
    beforeConfiguration: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    afterConfiguration: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    productionStateIdentityBefore: {
      type: String,
      required: true,
      immutable: true,
    },
    productionStateIdentityAfter: {
      type: String,
      required: true,
      immutable: true,
    },
    productionSnapshotId: { type: String, required: true, immutable: true },
    datasetSignature: { type: String, required: true, immutable: true },
    gameIdSignature: { type: String, required: true, immutable: true },
    startingStateSignature: { type: String, required: true, immutable: true },
    baselineIdentity: { type: String, required: true, immutable: true },
    baselineSignature: { type: String, required: true, immutable: true },
    modelVersion: { type: String, required: true, immutable: true },
    robustnessSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },
    applicationStatus: {
      type: String,
      enum: ['APPLIED'],
      required: true,
      immutable: true,
    },
  },
  {
    collection: 'rating_lab_promotion_audits',
    strict: 'throw',
    versionKey: false,
  },
)

ratingLabPromotionAuditSchema.index({
  userId: 1,
  appliedAt: -1,
  promotionId: -1,
})

module.exports = mongoose.model(
  'RatingLabPromotionAudit',
  ratingLabPromotionAuditSchema,
)
