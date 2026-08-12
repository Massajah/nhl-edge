const powerRatingSimulationService = require('../services/powerRatingSimulationService')
const baseModelCalibrationService = require('../services/baseModelCalibrationService')
const historicalNhlDataService = require('../services/historicalNhlDataService')
const homeAdvantageCalibrationService = require('../services/homeAdvantageCalibrationService')
const scheduleCalibrationService = require('../services/scheduleCalibrationService')
const specialTeamsCalibrationService = require('../services/specialTeamsCalibrationService')

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
  getBaseModelCalibrationOptions,
  getHomeAdvantageCalibrationOptions,
  getScheduleCalibrationOptions,
  getSpecialTeamsCalibrationOptions,
  prepareHistoricalCalibrationSeason,
  prepareHomeAdvantageHistoricalSeason,
  prepareScheduleCalibrationSeason,
  prepareSpecialTeamsCalibrationGameSeason,
  prepareSpecialTeamsReferenceSeason,
  previewPowerRatingSimulation,
  runBaseModelCalibration,
  runHomeAdvantageCalibration,
  runScheduleCalibration,
  runSpecialTeamsCalibration,
}
