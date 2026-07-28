const mongoose = require('mongoose')

const DEFAULT_BANKROLL_CURRENCY = 'EUR'

const bankrollProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: DEFAULT_BANKROLL_CURRENCY,
      minlength: 3,
      maxlength: 3,
    },
    initializedAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        returnedObject.userId = returnedObject.userId?.toString()
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

bankrollProfileSchema.index({ userId: 1, isActive: 1 })

module.exports = mongoose.model('BankrollProfile', bankrollProfileSchema)
module.exports.DEFAULT_BANKROLL_CURRENCY = DEFAULT_BANKROLL_CURRENCY
