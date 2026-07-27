const ratingEngineSettingsService = require('../services/ratingEngineSettingsService')

const getRatingEngineSettings = async (request, response, next) => {
  try {
    const result = await ratingEngineSettingsService.getRatingEngineSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateRatingEngineSettings = async (request, response, next) => {
  try {
    const result = await ratingEngineSettingsService.updateRatingEngineSettings(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const resetRatingEngineSettings = async (request, response, next) => {
  try {
    const result = await ratingEngineSettingsService.resetRatingEngineSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getRatingEngineSettings,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
}
