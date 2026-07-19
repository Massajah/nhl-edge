const DEFAULT_JWT_EXPIRES_IN = '7d'

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET
  }

  if (process.env.NODE_ENV === 'test') {
    return 'test-jwt-secret'
  }

  return ''
}

const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN

const assertJwtConfig = () => {
  if (process.env.NODE_ENV !== 'test' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required before starting the NHL Edge API.')
  }
}

module.exports = {
  assertJwtConfig,
  getJwtExpiresIn,
  getJwtSecret,
}
