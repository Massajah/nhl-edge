const mongoose = require('mongoose')

const bookmakerPreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    disabledBookmakerKeys: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
)

bookmakerPreferencesSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model(
  'BookmakerPreferences',
  bookmakerPreferencesSchema,
)
