const { isAllowedOrigin } = require('../config/cors')
const authSessionService = require('../services/authSessionService')

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const requireTrustedOrigin = (request, response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next()
    return
  }

  const origin = request.get('origin')

  if (origin) {
    if (isAllowedOrigin(origin)) {
      next()
      return
    }

    response.status(403).json({
      error: 'Request origin is not allowed.',
      message: 'Request origin is not allowed.',
    })
    return
  }

  // Browsers attach Origin to cross-origin mutations. If a request also has
  // an ambient session cookie, requiring Origin prevents form-based CSRF and
  // fails closed for privacy tools that strip the header.
  if (authSessionService.getSessionTokenFromRequest(request)) {
    response.status(403).json({
      error: 'Request origin is required.',
      message: 'Request origin is required.',
    })
    return
  }

  // Cookie-less server/operator calls do not carry ambient browser authority.
  next()
}

module.exports = { SAFE_METHODS, requireTrustedOrigin }
