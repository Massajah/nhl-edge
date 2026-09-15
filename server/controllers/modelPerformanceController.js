const modelPerformanceService = require('../services/modelPerformanceService')
const demoModelPerformanceService = require('../services/demoModelPerformanceService')
const {
  isDemoSandboxAccount,
  isProductionAccount,
} = require('../config/accountTypes')

const getPerformanceOptions = (request) => ({
  productionCaptureEligible: isProductionAccount(request.authUser),
})

const getPerformanceService = (request) =>
  isDemoSandboxAccount(request.authUser)
    ? {
        getModelPerformance:
          demoModelPerformanceService.getDemoModelPerformance,
        getModelPerformanceGames:
          demoModelPerformanceService.getDemoModelPerformanceGames,
      }
    : modelPerformanceService

const getModelPerformance = async (request, response, next) => {
  try {
    const service = getPerformanceService(request)
    const performance = await service.getModelPerformance(
      request.user.id,
      request.query,
      service === modelPerformanceService
        ? getPerformanceOptions(request)
        : undefined,
    )

    response.json(performance)
  } catch (error) {
    next(error)
  }
}

const getModelPerformanceGames = async (request, response, next) => {
  try {
    const service = getPerformanceService(request)
    const games = await service.getModelPerformanceGames(
      request.user.id,
      request.query,
      service === modelPerformanceService
        ? getPerformanceOptions(request)
        : undefined,
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
