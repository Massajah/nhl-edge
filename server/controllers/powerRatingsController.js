const powerRatingsService = require('../services/powerRatingsService')

const getPowerRatings = async (_request, response, next) => {
  try {
    const ratings = await powerRatingsService.getPowerRatings()

    response.json({ ratings })
  } catch (error) {
    next(error)
  }
}

const updatePowerRating = async (request, response, next) => {
  try {
    const rating = await powerRatingsService.updatePowerRating(
      request.params.teamId,
      request.body,
    )

    response.json({ rating })
  } catch (error) {
    next(error)
  }
}

const seedPowerRatings = async (_request, response, next) => {
  try {
    const result = await powerRatingsService.seedPowerRatings()

    response.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getPowerRatings,
  seedPowerRatings,
  updatePowerRating,
}
