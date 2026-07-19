const authService = require('../services/authService')

const sendUnauthorized = (response) => {
  response.status(401).json({
    error: 'Authentication required.',
    message: 'Authentication required.',
  })
}

const authenticate = (request, response, next) => {
  const authorization = request.get('authorization') ?? ''
  const [scheme, token] = authorization.split(' ')

  if (scheme !== 'Bearer' || !token) {
    sendUnauthorized(response)
    return
  }

  try {
    const { userId } = authService.verifyAuthToken(token)
    request.user = {
      id: userId,
    }

    next()
  } catch {
    sendUnauthorized(response)
  }
}

module.exports = authenticate
