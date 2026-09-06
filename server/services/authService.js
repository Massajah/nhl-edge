const mongoose = require('mongoose')
const User = require('../models/User')
const { isLocalAuthEnabled } = require('../config/auth')
const googleAuthService = require('./googleAuthService')
const powerRatingsService = require('./powerRatingsService')
const { hashPassword, verifyPassword } = require('../utils/password')
const { isValidEmail, normalizeEmail } = require('../utils/email')

class AuthError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const toText = (value, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const serializeUser = (user) => {
  const plainUser =
    typeof user.toJSON === 'function'
      ? user.toJSON()
      : {
          ...user,
          id: user._id?.toString() ?? user.id?.toString(),
        }

  return {
    id: plainUser.id ?? plainUser._id?.toString(),
    email: plainUser.email,
    name: plainUser.name ?? '',
    authProvider: plainUser.authProvider,
    profileImage: plainUser.profileImage ?? '',
    role: plainUser.role ?? 'user',
    createdAt: plainUser.createdAt,
    lastLoginAt: plainUser.lastLoginAt ?? null,
  }
}

const buildAuthResult = (user) => ({
  user: serializeUser(user),
  userId: user._id ?? user.id,
})

const localAuthDisabledError = () =>
  new AuthError('Local authentication is disabled.', 404)

const duplicateEmailError = () =>
  new AuthError('Unable to create an account with those credentials.', 409)

const googleAccountCollisionError = () =>
  new AuthError('Unable to sign in with this Google account.', 409)

const isDuplicateKeyError = (error) => error?.code === 11000

const findUserByEmail = async (email, { includePassword = false } = {}) => {
  const query = User.findOne({ email })

  if (includePassword && typeof query.select === 'function') {
    return query.select('+passwordHash')
  }

  return query
}

const validateEmailInput = (email) => {
  const normalizedEmail = normalizeEmail(email)

  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError('A valid email is required.', 400)
  }

  return normalizedEmail
}

const assertLocalAuthEnabled = (environment = process.env) => {
  if (!isLocalAuthEnabled(environment)) throw localAuthDisabledError()
}

const assertUserIsActive = (user) => {
  if (user?.status === 'disabled') {
    throw new AuthError('Authentication required.', 401)
  }
}

const persistUser = async (user) => {
  if (typeof user.save === 'function') await user.save()
  return user
}

const registerLocalUser = async (
  payload = {},
  { environment = process.env } = {},
) => {
  assertLocalAuthEnabled(environment)
  const email = validateEmailInput(payload.email)

  if (await findUserByEmail(email)) throw duplicateEmailError()

  const passwordHash = await hashPassword(payload.password)
  let user

  try {
    user = await User.create({
      authProvider: 'local',
      email,
      lastLoginAt: new Date(),
      name: toText(payload.name),
      passwordHash,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateEmailError()
    throw error
  }

  await powerRatingsService.initializeDefaultPowerRatings(user._id)
  return buildAuthResult(user)
}

const loginLocalUser = async (
  payload = {},
  { environment = process.env } = {},
) => {
  assertLocalAuthEnabled(environment)
  const email = validateEmailInput(payload.email)
  const invalidCredentialsError = new AuthError('Invalid email or password.', 401)
  const user = await findUserByEmail(email, { includePassword: true })

  if (!user?.passwordHash || user.status === 'disabled') {
    throw invalidCredentialsError
  }

  if (!(await verifyPassword(payload.password, user.passwordHash))) {
    throw invalidCredentialsError
  }

  user.lastLoginAt = new Date()
  await persistUser(user)
  await powerRatingsService.initializeDefaultPowerRatings(user._id)

  return buildAuthResult(user)
}

const updateReturningGoogleUser = async (user, claims) => {
  if (user.googleId !== claims.googleId) throw googleAccountCollisionError()

  assertUserIsActive(user)
  if (!user.name && claims.name) user.name = claims.name
  if (!user.profileImage && claims.profileImage) {
    user.profileImage = claims.profileImage
  }
  user.lastLoginAt = new Date()

  return persistUser(user)
}

const authenticateGoogleUser = async (payload = {}) => {
  const claims = await googleAuthService.verifyGoogleIdToken(payload.credential)
  let user = await User.findOne({ googleId: claims.googleId })

  if (user) {
    user = await updateReturningGoogleUser(user, claims)
    await powerRatingsService.initializeDefaultPowerRatings(user._id)
    return buildAuthResult(user)
  }

  // Email is profile/contact information. It is deliberately not an account-
  // linking credential because local accounts do not prove email ownership.
  if (await findUserByEmail(claims.email)) throw googleAccountCollisionError()

  try {
    user = await User.create({
      authProvider: 'google',
      email: claims.email,
      googleId: claims.googleId,
      lastLoginAt: new Date(),
      name: claims.name,
      profileImage: claims.profileImage,
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error

    // A concurrent request for the same verified Google subject may have won.
    // An email-only conflict is never accepted as proof of account ownership.
    user = await User.findOne({ googleId: claims.googleId })
    if (!user) throw googleAccountCollisionError()
    user = await updateReturningGoogleUser(user, claims)
  }

  await powerRatingsService.initializeDefaultPowerRatings(user._id)
  return buildAuthResult(user)
}

const getSafeUserById = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AuthError('Authenticated user was not found.', 401)
  }

  const user = await User.findOne({
    _id: userId,
    status: { $ne: 'disabled' },
  })

  if (!user) throw new AuthError('Authenticated user was not found.', 401)
  return serializeUser(user)
}

module.exports = {
  AuthError,
  assertLocalAuthEnabled,
  authenticateGoogleUser,
  getSafeUserById,
  loginLocalUser,
  registerLocalUser,
  serializeUser,
}
