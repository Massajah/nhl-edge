const authService = require('../services/authService')
const authSessionService = require('../services/authSessionService')
const demoSandboxService = require('../services/demoSandboxService')

const establishSession = async (
  request,
  response,
  result,
  statusCode = 200,
  { maxExpiresAt = null } = {},
) => {
  const { expiresAt, token } = await authSessionService.createAuthSession(
    result.userId,
    { maxExpiresAt },
  )

  authSessionService.setSessionCookie(response, token, { expiresAt })
  response.status(statusCode).json({ user: result.user })
}

const demo = async (_request, response, next) => {
  try {
    const result = await demoSandboxService.createDemoSandbox()

    await establishSession(
      null,
      response,
      {
        user: authService.serializeUser(result.user),
        userId: result.userId,
      },
      201,
      { maxExpiresAt: result.expiresAt },
    )
  } catch (error) {
    next(error)
  }
}

const register = async (request, response, next) => {
  try {
    const result = await authService.registerLocalUser(request.body)
    await establishSession(request, response, result, 201)
  } catch (error) {
    next(error)
  }
}

const login = async (request, response, next) => {
  try {
    const result = await authService.loginLocalUser(request.body)
    await establishSession(request, response, result)
  } catch (error) {
    next(error)
  }
}

const google = async (request, response, next) => {
  try {
    const result = await authService.authenticateGoogleUser(request.body)
    await establishSession(request, response, result)
  } catch (error) {
    next(error)
  }
}

const me = async (request, response) => {
  response.json({ user: authService.serializeUser(request.authUser) })
}

const logout = async (request, response, next) => {
  try {
    const token = authSessionService.getSessionTokenFromRequest(request)
    if (token) await authSessionService.revokeAuthSession(token)

    authSessionService.clearSessionCookie(response)
    response.json({ success: true })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  demo,
  google,
  login,
  logout,
  me,
  register,
}
