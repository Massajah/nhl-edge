const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const User = require('../models/User')
const { getJwtExpiresIn, getJwtSecret } = require('../config/auth')
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
    createdAt: plainUser.createdAt,
  }
}

const signAuthToken = (userId) =>
  jwt.sign({ userId: userId.toString() }, getJwtSecret(), {
    expiresIn: getJwtExpiresIn(),
  })

const verifyAuthToken = (token) => {
  try {
    const payload = jwt.verify(token, getJwtSecret())

    if (!payload?.userId) {
      throw new AuthError('Authentication required.', 401)
    }

    return {
      userId: payload.userId,
    }
  } catch {
    throw new AuthError('Authentication required.', 401)
  }
}

const buildAuthResponse = (user) => ({
  token: signAuthToken(user._id ?? user.id),
  user: serializeUser(user),
})

const duplicateEmailError = () =>
  new AuthError('A user with that email already exists.', 409)

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

const registerLocalUser = async (payload = {}) => {
  const email = validateEmailInput(payload.email)

  if (await findUserByEmail(email)) {
    throw duplicateEmailError()
  }

  const passwordHash = await hashPassword(payload.password)

  let user

  try {
    user = await User.create({
      authProvider: 'local',
      email,
      name: toText(payload.name),
      passwordHash,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateEmailError()
    }

    throw error
  }

  await powerRatingsService.initializeDefaultPowerRatings(user._id)

  return buildAuthResponse(user)
}

const loginLocalUser = async (payload = {}) => {
  const email = validateEmailInput(payload.email)
  const invalidCredentialsError = new AuthError('Invalid email or password.', 401)
  const user = await findUserByEmail(email, { includePassword: true })

  if (!user?.passwordHash) {
    throw invalidCredentialsError
  }

  const passwordMatches = await verifyPassword(payload.password, user.passwordHash)

  if (!passwordMatches) {
    throw invalidCredentialsError
  }

  await powerRatingsService.initializeDefaultPowerRatings(user._id)

  return buildAuthResponse(user)
}

const persistUser = async (user) => {
  if (typeof user.save === 'function') {
    await user.save()
  }

  return user
}

const mergeGoogleClaimsIntoUser = async (user, claims) => {
  if (!user.googleId) {
    user.googleId = claims.googleId
  }

  if (!user.email) {
    user.email = claims.email
  }

  if (!user.name && claims.name) {
    user.name = claims.name
  }

  if (!user.profileImage && claims.profileImage) {
    user.profileImage = claims.profileImage
  }

  if (user.authProvider === 'local') {
    user.authProvider = 'both'
  } else if (!user.authProvider) {
    user.authProvider = 'google'
  }

  return persistUser(user)
}

const findGoogleUserAfterDuplicate = async (claims) =>
  User.findOne({
    $or: [{ googleId: claims.googleId }, { email: claims.email }],
  })

const authenticateGoogleUser = async (payload = {}) => {
  const claims = await googleAuthService.verifyGoogleIdToken(payload.credential)
  let user = await User.findOne({ googleId: claims.googleId })

  if (user) {
    user = await mergeGoogleClaimsIntoUser(user, claims)
    await powerRatingsService.initializeDefaultPowerRatings(user._id)

    return buildAuthResponse(user)
  }

  user = await findUserByEmail(claims.email)

  if (user) {
    user = await mergeGoogleClaimsIntoUser(user, claims)
    await powerRatingsService.initializeDefaultPowerRatings(user._id)

    return buildAuthResponse(user)
  }

  try {
    user = await User.create({
      authProvider: 'google',
      email: claims.email,
      googleId: claims.googleId,
      name: claims.name,
      profileImage: claims.profileImage,
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    user = await findGoogleUserAfterDuplicate(claims)

    if (!user) {
      throw duplicateEmailError()
    }

    user = await mergeGoogleClaimsIntoUser(user, claims)
  }

  await powerRatingsService.initializeDefaultPowerRatings(user._id)

  return buildAuthResponse(user)
}

const getSafeUserById = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AuthError('Authenticated user was not found.', 401)
  }

  const user = await User.findById(userId)

  if (!user) {
    throw new AuthError('Authenticated user was not found.', 401)
  }

  return serializeUser(user)
}

module.exports = {
  AuthError,
  authenticateGoogleUser,
  getSafeUserById,
  loginLocalUser,
  registerLocalUser,
  serializeUser,
  signAuthToken,
  verifyAuthToken,
}
