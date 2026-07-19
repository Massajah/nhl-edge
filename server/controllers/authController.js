const authService = require('../services/authService')

const register = async (request, response, next) => {
  try {
    const result = await authService.registerLocalUser(request.body)

    response.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

const login = async (request, response, next) => {
  try {
    const result = await authService.loginLocalUser(request.body)

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const google = async (request, response, next) => {
  try {
    const result = await authService.authenticateGoogleUser(request.body)

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const me = async (request, response, next) => {
  try {
    const user = await authService.getSafeUserById(request.user.id)

    response.json({ user })
  } catch (error) {
    next(error)
  }
}

const logout = async (_request, response) => {
  response.json({ success: true })
}

module.exports = {
  google,
  login,
  logout,
  me,
  register,
}
