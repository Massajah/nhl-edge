const mongoose = require('mongoose')

const authSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    lastSeenAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      immutable: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'auth_sessions',
    timestamps: { createdAt: true, updatedAt: false },
  },
)

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
authSessionSchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('AuthSession', authSessionSchema)
