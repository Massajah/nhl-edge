const gameContextService = require('../services/gameContextService')

const getGameContexts = async (request, response, next) => {
  try {
    const result = await gameContextService.getGameContexts(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateGameContextOverrides = async (request, response, next) => {
  try {
    const result = await gameContextService.updateGameContextOverrides(
      request.user.id,
      request.params.gameId,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getGameContexts,
  updateGameContextOverrides,
}
