const modelPerformanceService = require('../services/modelPerformanceService')

const getModelPerformance = async (request, response, next) => {
  try {
    const performance = await modelPerformanceService.getModelPerformance(
      request.user.id,
      request.query,
    )

    response.json(performance)
  } catch (error) {
    next(error)
  }
}

const getModelPerformanceGames = async (request, response, next) => {
  try {
    const games = await modelPerformanceService.getModelPerformanceGames(
      request.user.id,
      request.query,
    )

    response.json(games)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getModelPerformance,
  getModelPerformanceGames,
}
