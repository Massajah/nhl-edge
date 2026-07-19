const powerRatingsService = require('../services/powerRatingsService')

const getPowerRatings = async (request, response, next) => {
  try {
    const ratings = await powerRatingsService.getPowerRatings(request.user.id)

    response.json({ ratings })
  } catch (error) {
    next(error)
  }
}

const updatePowerRating = async (request, response, next) => {
  try {
    const rating = await powerRatingsService.updatePowerRating(
      request.user.id,
      request.params.teamId,
      request.body,
    )

    response.json({ rating })
  } catch (error) {
    next(error)
  }
}

const seedPowerRatings = async (request, response, next) => {
  try {
    const result = await powerRatingsService.seedPowerRatings(request.user.id)

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
