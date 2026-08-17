const mongoose = require('mongoose')

const BANKROLL_TRANSACTION_TYPES = Object.freeze([
  'STARTING_BALANCE',
  'DEPOSIT',
  'WITHDRAWAL',
  'BET_STAKE',
  'BET_WIN_RETURN',
  'BET_VOID_RETURN',
  'BET_SETTLEMENT',
  'MANUAL_ADJUSTMENT',
  'SETTLEMENT_REVERSAL',
  'ADJUSTMENT',
])

const bankrollTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: BANKROLL_TRANSACTION_TYPES,
      required: true,
    },
    amountCents: {
      type: Number,
      required: true,
      validate: {
        message: 'amountCents must be an integer.',
        validator: Number.isInteger,
      },
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    betId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bet',
      default: null,
    },
    actionKey: {
      type: String,
      trim: true,
      default: null,
    },
    balanceAfterCents: {
      type: Number,
      default: null,
      validate: {
        message: 'balanceAfterCents must be an integer.',
        validator: (value) => value === null || Number.isInteger(value),
      },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        returnedObject.userId = returnedObject.userId?.toString()
        returnedObject.betId = returnedObject.betId?.toString() ?? null
        delete returnedObject._id
        delete returnedObject.__v
      },
    },
  },
)

bankrollTransactionSchema.index({ userId: 1, occurredAt: -1, createdAt: -1 })
bankrollTransactionSchema.index({ userId: 1, type: 1, occurredAt: -1 })
bankrollTransactionSchema.index(
  { userId: 1, actionKey: 1 },
  {
    partialFilterExpression: {
      actionKey: {
        $exists: true,
        $type: 'string',
      },
    },
    unique: true,
  },
)
bankrollTransactionSchema.index(
  { userId: 1, betId: 1, type: 1 },
  {
    partialFilterExpression: {
      betId: {
        $exists: true,
        $ne: null,
      },
      type: 'BET_SETTLEMENT',
    },
    unique: true,
  },
)

module.exports = mongoose.model(
  'BankrollTransaction',
  bankrollTransactionSchema,
)
module.exports.BANKROLL_TRANSACTION_TYPES = BANKROLL_TRANSACTION_TYPES
