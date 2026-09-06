const authSessionService = require('../services/authSessionService')

const sendUnauthorized = (response) => {
  response.status(401).json({
    error: 'Authentication required.',
    message: 'Authentication required.',
  })
}

const authenticate = async (request, response, next) => {
  const token = authSessionService.getSessionTokenFromRequest(request)

  if (!token) {
    sendUnauthorized(response)
    return
  }

  try {
    const resolved = await authSessionService.resolveAuthSession(token)

    if (!resolved) {
      sendUnauthorized(response)
      return
    }

    request.authSession = resolved.session
    request.authUser = resolved.user
    request.user = {
      id: resolved.user._id?.toString?.() ?? String(resolved.user.id),
      role: resolved.user.role ?? 'user',
    }

    next()
  } catch (error) {
    next(error)
  }
}

module.exports = authenticate
