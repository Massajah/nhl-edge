const express = require('express')
const powerRatingSimulationsController = require('../controllers/powerRatingSimulationsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get(
  '/model-calibration/options',
  powerRatingSimulationsController.getModelCalibrationOptions,
)
router.get(
  '/model-calibration/promotions',
  powerRatingSimulationsController.listModelCalibrationPromotions,
)
router.get(
  '/model-calibration/promotions/:promotionId',
  powerRatingSimulationsController.getModelCalibrationPromotion,
)
router.post(
  '/model-calibration/run',
  powerRatingSimulationsController.runModelCalibration,
)
router.post(
  '/model-calibration/robustness',
  powerRatingSimulationsController.runModelCalibrationRobustness,
)
router.post(
  '/model-calibration/promotion/preview',
  powerRatingSimulationsController.previewModelCalibrationPromotion,
)
router.post(
  '/model-calibration/promotion/apply',
  powerRatingSimulationsController.applyModelCalibrationPromotion,
)

router.get(
  '/calibration/options',
  powerRatingSimulationsController.getBaseModelCalibrationOptions,
)
router.post(
  '/calibration/historical-seasons/:seasonId/prepare',
  powerRatingSimulationsController.prepareHistoricalCalibrationSeason,
)
router.post(
  '/calibration/run',
  powerRatingSimulationsController.runBaseModelCalibration,
)
router.get(
  '/home-advantage/options',
  powerRatingSimulationsController.getHomeAdvantageCalibrationOptions,
)
router.post(
  '/home-advantage/historical-seasons/:seasonId/prepare',
  powerRatingSimulationsController.prepareHomeAdvantageHistoricalSeason,
)
router.post(
  '/home-advantage/run',
  powerRatingSimulationsController.runHomeAdvantageCalibration,
)
router.get(
  '/schedule-context/options',
  powerRatingSimulationsController.getScheduleCalibrationOptions,
)
router.post(
  '/schedule-context/historical-seasons/:seasonId/prepare',
  powerRatingSimulationsController.prepareScheduleCalibrationSeason,
)
router.post(
  '/schedule-context/run',
  powerRatingSimulationsController.runScheduleCalibration,
)
router.get(
  '/special-teams/options',
  powerRatingSimulationsController.getSpecialTeamsCalibrationOptions,
)
router.post(
  '/special-teams/historical-seasons/:seasonId/prepare',
  powerRatingSimulationsController.prepareSpecialTeamsCalibrationGameSeason,
)
router.post(
  '/special-teams/reference-seasons/:seasonId/prepare',
  powerRatingSimulationsController.prepareSpecialTeamsReferenceSeason,
)
router.post(
  '/special-teams/run',
  powerRatingSimulationsController.runSpecialTeamsCalibration,
)
router.post('/preview', powerRatingSimulationsController.previewPowerRatingSimulation)

module.exports = router
