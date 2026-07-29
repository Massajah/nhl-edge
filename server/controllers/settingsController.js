const ratingEngineSettingsService = require('../services/ratingEngineSettingsService')
const bettingSettingsService = require('../services/bettingSettingsService')

const getBettingSettings = async (request, response, next) => {
  try {
    const result = await bettingSettingsService.getBettingSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateBettingSettings = async (request, response, next) => {
  try {
    const result = await bettingSettingsService.updateBettingSettings(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const resetBettingSettings = async (request, response, next) => {
  try {
    const result = await bettingSettingsService.resetBettingSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

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
  getBettingSettings,
  getRatingEngineSettings,
  resetBettingSettings,
  resetRatingEngineSettings,
  updateBettingSettings,
  updateRatingEngineSettings,
}
