const powerRatingSimulationService = require('../services/powerRatingSimulationService')

const previewPowerRatingSimulation = async (request, response, next) => {
  try {
    const simulation =
      await powerRatingSimulationService.previewPowerRatingSimulation(
        request.user.id,
        request.body,
      )

    response.json(simulation)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  previewPowerRatingSimulation,
}
