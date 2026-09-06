const mongoose = require('mongoose')

const legacyOwnershipMigrationSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, unique: true, immutable: true },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    ownerEmail: { type: String, required: true, immutable: true },
    ownerGoogleId: { type: String, required: true, immutable: true },
    collectionResults: { type: mongoose.Schema.Types.Mixed, required: true },
    droppedLegacyIndexes: { type: [String], default: [] },
    totalChanged: { type: Number, required: true, min: 0 },
    completedAt: { type: Date, required: true, immutable: true },
  },
  {
    collection: 'legacy_ownership_migrations',
    versionKey: false,
  },
)

module.exports = mongoose.model(
  'LegacyOwnershipMigration',
  legacyOwnershipMigrationSchema,
)
