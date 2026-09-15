const mongoose = require('mongoose')
const { isValidEmail, normalizeEmail } = require('../utils/email')
const {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_VALUES,
} = require('../config/accountTypes')

const AUTH_PROVIDERS = ['local', 'google', 'both', 'demo']
const USER_ROLES = ['user', 'admin']
const USER_STATUSES = ['active', 'disabled']

const userSchema = new mongoose.Schema(
  {
    accountType: {
      type: String,
      enum: ACCOUNT_TYPE_VALUES,
      default: ACCOUNT_TYPES.NORMAL,
      immutable: true,
      required: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeEmail,
      validate: {
        validator: (email) => !email || isValidEmail(email),
        message: 'Email must be valid.',
      },
    },
    passwordHash: {
      type: String,
      select: false,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    authProvider: {
      type: String,
      enum: AUTH_PROVIDERS,
      default: 'local',
      required: true,
    },
    googleId: {
      type: String,
      trim: true,
      default: undefined,
    },
    profileImage: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
      required: true,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
      required: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      immutable: true,
      validate: {
        validator(value) {
          return this.accountType === ACCOUNT_TYPES.DEMO_SANDBOX
            ? value instanceof Date && Number.isFinite(value.getTime())
            : value === null || value === undefined
        },
        message: 'Only demo sandbox accounts may have an expiration.',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.passwordHash
        delete returnedObject.googleId
      },
    },
  },
)

// Mongoose does not apply a default to an immutable path while hydrating an
// existing document. Materialize the Phase 1 NORMAL default when a historical
// document is next validated, while leaving projected-out and invalid values
// untouched. The explicit overwrite is limited to the legacy-empty case so
// account type remains immutable for every classified account.
userSchema.pre('validate', function materializeHistoricalAccountType() {
  const isLegacyEmptyAccountType =
    this.accountType === undefined ||
    this.accountType === null ||
    this.accountType === ''

  if (
    !this.isNew &&
    this.isSelected('accountType') &&
    isLegacyEmptyAccountType
  ) {
    this.$set('accountType', ACCOUNT_TYPES.NORMAL, undefined, {
      overwriteImmutable: true,
    })
  }
})

userSchema.index({ email: 1 }, { unique: true, sparse: true })
userSchema.index({ googleId: 1 }, { unique: true, sparse: true })
// Deliberately not a TTL index: demo child data must be deleted before its User.
userSchema.index({ accountType: 1, expiresAt: 1 })

module.exports = mongoose.model('User', userSchema)
module.exports.AUTH_PROVIDERS = AUTH_PROVIDERS
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES
module.exports.USER_ROLES = USER_ROLES
module.exports.USER_STATUSES = USER_STATUSES
