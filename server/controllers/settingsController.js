const ratingEngineSettingsService = require('../services/ratingEngineSettingsService')
const bettingSettingsService = require('../services/bettingSettingsService')
const quickRematchSettingsService = require('../services/quickRematchSettingsService')
const bookmakerPreferencesService = require('../services/bookmakerPreferencesService')
const { marketOddsService } = require('../services/marketOddsService')
const userDataResetService = require('../services/userDataResetService')
const databaseStorageService = require('../services/databaseStorageService')

const getDatabaseStorage = async (request, response, next) => {
  try {
    const result = await databaseStorageService.getDatabaseStorageStatus({
      refresh: request.query.refresh === 'true',
    })

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const resetSettingsToDefaults = async (request, response, next) => {
  try {
    const result = await userDataResetService.resetSettingsToDefaults(
      request.user.id,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const resetForNewSeason = async (request, response, next) => {
  try {
    const result = await userDataResetService.resetForNewSeason(request.user.id)

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const factoryResetUserData = async (request, response, next) => {
  try {
    const result = await userDataResetService.factoryResetUserData(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getBookmakerPreferences = async (request, response, next) => {
  try {
    const result = await bookmakerPreferencesService.getBookmakerPreferences(
      request.user.id,
      marketOddsService.getStatus().availableBookmakers,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateBookmakerPreferences = async (request, response, next) => {
  try {
    const result = await bookmakerPreferencesService.updateBookmakerPreferences(
      request.user.id,
      request.body,
      marketOddsService.getStatus().availableBookmakers,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

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

const updateRatingEngineParameters = async (request, response, next) => {
  try {
    const result = await ratingEngineSettingsService.updateRatingEngineParameters(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const updateRatingEngineModelAdjustments = async (request, response, next) => {
  try {
    const result =
      await ratingEngineSettingsService.updateRatingEngineModelAdjustments(
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
      { scope: request.body?.scope },
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
  factoryResetUserData,
  getBettingSettings,
  getBookmakerPreferences,
  getDatabaseStorage,
  getQuickRematchSettings,
  getRatingEngineSettings,
  resetBettingSettings,
  resetForNewSeason,
  resetQuickRematchSettings,
  resetRatingEngineSettings,
  resetSettingsToDefaults,
  updateBettingSettings,
  updateBookmakerPreferences,
  updateQuickRematchSettings,
  updateRatingEngineModelAdjustments,
  updateRatingEngineParameters,
  updateRatingEngineSettings,
}
