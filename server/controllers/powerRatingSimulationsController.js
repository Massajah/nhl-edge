const powerRatingSimulationService = require('../services/powerRatingSimulationService')
const baseModelCalibrationService = require('../services/baseModelCalibrationService')
const historicalNhlDataService = require('../services/historicalNhlDataService')
const homeAdvantageCalibrationService = require('../services/homeAdvantageCalibrationService')
const scheduleCalibrationService = require('../services/scheduleCalibrationService')
const specialTeamsCalibrationService = require('../services/specialTeamsCalibrationService')
const calibrationOrchestrator = require('../calibration/calibrationOrchestrator')
const calibrationOrchestrationOptions = require('../calibration/calibrationOrchestrationOptions')
const calibrationRobustnessService = require('../calibration/calibrationRobustnessService')
const calibrationPromotionService = require('../calibration/calibrationPromotionService')
const calibrationPromotionHistoryService = require('../calibration/calibrationPromotionHistoryService')

const listModelCalibrationPromotions = async (request, response, next) => {
  try {
    const result =
      await calibrationPromotionHistoryService.listCalibrationPromotions(
        request.user.id,
        request.query,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getModelCalibrationPromotion = async (request, response, next) => {
  try {
    const result =
      await calibrationPromotionHistoryService.getCalibrationPromotion(
        request.user.id,
        request.params.promotionId,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getModelCalibrationOptions = async (request, response, next) => {
  try {
    const options =
      await calibrationOrchestrationOptions.getCalibrationOrchestrationOptions(
        request.user.id,
      )

    response.json(options)
  } catch (error) {
    next(error)
  }
}

const runModelCalibration = async (request, response, next) => {
  try {
    const result = await calibrationOrchestrator.runCalibrationOrchestration(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const runModelCalibrationRobustness = async (request, response, next) => {
  try {
    const result = calibrationRobustnessService.runCalibrationRobustness(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const previewModelCalibrationPromotion = async (request, response, next) => {
  try {
    const result =
      await calibrationPromotionService.createCalibrationPromotionPreview(
        request.user.id,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const applyModelCalibrationPromotion = async (request, response, next) => {
  try {
    const result = await calibrationPromotionService.applyCalibrationPromotion(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getSpecialTeamsCalibrationOptions = async (request, response, next) => {
  try {
    const options =
      await specialTeamsCalibrationService.getSpecialTeamsCalibrationOptions(
        request.user.id,
      )

    response.json(options)
  } catch (error) {
    next(error)
  }
}

const runSpecialTeamsCalibration = async (request, response, next) => {
  try {
    const result =
      await specialTeamsCalibrationService.runSpecialTeamsCalibration(
        request.user.id,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const prepareSpecialTeamsCalibrationGameSeason = async (
  request,
  response,
  next,
) => {
  try {
    const result =
      await specialTeamsCalibrationService.prepareSpecialTeamsCalibrationGameSeason(
        request.user.id,
        request.params.seasonId,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const prepareSpecialTeamsReferenceSeason = async (
  request,
  response,
  next,
) => {
  try {
    const result =
      await specialTeamsCalibrationService.prepareSpecialTeamsReferenceSeason(
        request.user.id,
        request.params.seasonId,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getScheduleCalibrationOptions = async (request, response, next) => {
  try {
    const options =
      await scheduleCalibrationService.getScheduleCalibrationOptions(
        request.user.id,
      )

    response.json(options)
  } catch (error) {
    next(error)
  }
}

const runScheduleCalibration = async (request, response, next) => {
  try {
    const result = await scheduleCalibrationService.runScheduleCalibration(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const prepareScheduleCalibrationSeason = async (request, response, next) => {
  try {
    const result =
      await scheduleCalibrationService.prepareScheduleCalibrationSeason(
        request.user.id,
        request.params.seasonId,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getHomeAdvantageCalibrationOptions = async (request, response, next) => {
  try {
    const options =
      await homeAdvantageCalibrationService.getHomeAdvantageCalibrationOptions(
        request.user.id,
      )

    response.json(options)
  } catch (error) {
    next(error)
  }
}

const runHomeAdvantageCalibration = async (request, response, next) => {
  try {
    const result =
      await homeAdvantageCalibrationService.runHomeAdvantageCalibration(
        request.user.id,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const prepareHomeAdvantageHistoricalSeason = async (request, response, next) => {
  try {
    const result =
      await homeAdvantageCalibrationService.prepareHomeAdvantageHistoricalSeason(
        request.user.id,
        request.params.seasonId,
        request.body,
      )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getBaseModelCalibrationOptions = async (request, response, next) => {
  try {
    const options = await baseModelCalibrationService.getCalibrationOptions(
      request.user.id,
    )

    response.json(options)
  } catch (error) {
    next(error)
  }
}

const runBaseModelCalibration = async (request, response, next) => {
  try {
    const result = await baseModelCalibrationService.runBaseModelCalibration(
      request.user.id,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const prepareHistoricalCalibrationSeason = async (request, response, next) => {
  try {
    const result = await historicalNhlDataService.prepareHistoricalSeason(
      request.params.seasonId,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

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
  applyModelCalibrationPromotion,
  getBaseModelCalibrationOptions,
  getModelCalibrationPromotion,
  getModelCalibrationOptions,
  getHomeAdvantageCalibrationOptions,
  getScheduleCalibrationOptions,
  getSpecialTeamsCalibrationOptions,
  prepareHistoricalCalibrationSeason,
  prepareHomeAdvantageHistoricalSeason,
  prepareScheduleCalibrationSeason,
  prepareSpecialTeamsCalibrationGameSeason,
  prepareSpecialTeamsReferenceSeason,
  listModelCalibrationPromotions,
  previewPowerRatingSimulation,
  previewModelCalibrationPromotion,
  runBaseModelCalibration,
  runHomeAdvantageCalibration,
  runModelCalibration,
  runModelCalibrationRobustness,
  runScheduleCalibration,
  runSpecialTeamsCalibration,
}
