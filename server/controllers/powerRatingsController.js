const powerRatingsService = require('../services/powerRatingsService')
const ratingUpdateService = require('../services/ratingUpdateService')

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

const updatePowerRatingsFromCompletedGames = async (request, response, next) => {
  try {
    const result = await ratingUpdateService.applyCompletedGamesToPowerRatings(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getPowerRatings,
  seedPowerRatings,
  updatePowerRating,
  updatePowerRatingsFromCompletedGames,
}
