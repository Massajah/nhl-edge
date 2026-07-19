const bcrypt = require('bcryptjs')

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_SALT_ROUNDS = 12

class PasswordError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'PasswordError'
    this.statusCode = statusCode
    this.publicMessage = message
  }
}

const validatePlainPassword = (password) => {
  if (typeof password !== 'string') {
    throw new PasswordError('Password is required.')
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordError(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
  }
}

const hashPassword = async (password) => {
  validatePlainPassword(password)

  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS)
}

const verifyPassword = async (password, passwordHash) => {
  if (typeof password !== 'string' || typeof passwordHash !== 'string') {
    return false
  }

  return bcrypt.compare(password, passwordHash)
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PasswordError,
  hashPassword,
  validatePlainPassword,
  verifyPassword,
}
