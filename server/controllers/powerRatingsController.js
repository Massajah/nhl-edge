const powerRatingsService = require('../services/powerRatingsService')
const powerRatingHistoryService = require('../services/powerRatingHistoryService')
const nhlSeasonService = require('../services/nhlSeasonService')
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

const automaticallyUpdatePowerRatings = async (request, response, next) => {
  try {
    const result = await ratingUpdateService.applyAutomaticPowerRatingUpdate(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getPowerRatingHistory = async (request, response, next) => {
  try {
    const result = await powerRatingHistoryService.getPowerRatingHistory(
      request.user.id,
      request.query,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getPowerRatingHistorySeasons = async (_request, response, next) => {
  try {
    const result =
      await nhlSeasonService.getAvailablePowerRatingHistorySeasons()

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  automaticallyUpdatePowerRatings,
  getPowerRatingHistory,
  getPowerRatingHistorySeasons,
  getPowerRatings,
  seedPowerRatings,
  updatePowerRating,
  updatePowerRatingsFromCompletedGames,
}
