const ratingEngineSettingsService = require('../services/ratingEngineSettingsService')
const bettingSettingsService = require('../services/bettingSettingsService')
const quickRematchSettingsService = require('../services/quickRematchSettingsService')

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

const getQuickRematchSettings = async (request, response, next) => {
  try {
    const result = await quickRematchSettingsService.getQuickRematchSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateQuickRematchSettings = async (request, response, next) => {
  try {
    const result = await quickRematchSettingsService.updateQuickRematchSettings(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const resetQuickRematchSettings = async (request, response, next) => {
  try {
    const result = await quickRematchSettingsService.resetQuickRematchSettings(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getBettingSettings,
  getQuickRematchSettings,
  getRatingEngineSettings,
  resetBettingSettings,
  resetQuickRematchSettings,
  resetRatingEngineSettings,
  updateBettingSettings,
  updateQuickRematchSettings,
  updateRatingEngineSettings,
}
