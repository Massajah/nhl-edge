const mongoose = require('mongoose')
const { isValidEmail, normalizeEmail } = require('../utils/email')

const AUTH_PROVIDERS = ['local', 'google', 'both']

const userSchema = new mongoose.Schema(
  {
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

userSchema.index({ email: 1 }, { unique: true, sparse: true })
userSchema.index({ googleId: 1 }, { unique: true, sparse: true })

module.exports = mongoose.model('User', userSchema)
module.exports.AUTH_PROVIDERS = AUTH_PROVIDERS
