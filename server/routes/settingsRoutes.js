const express = require('express')
const settingsController = require('../controllers/settingsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/storage', settingsController.getDatabaseStorage)
router.post('/reset/settings', settingsController.resetSettingsToDefaults)
router.post('/reset/new-season', settingsController.resetForNewSeason)
router.post('/reset/factory', settingsController.factoryResetUserData)

router.get('/betting', settingsController.getBettingSettings)
router.put('/betting', settingsController.updateBettingSettings)
router.post('/betting/reset', settingsController.resetBettingSettings)
router.get('/bookmakers', settingsController.getBookmakerPreferences)
router.put('/bookmakers', settingsController.updateBookmakerPreferences)
router.get('/rating-engine', settingsController.getRatingEngineSettings)
router.put('/rating-engine', settingsController.updateRatingEngineSettings)
router.put(
  '/rating-engine/engine',
  settingsController.updateRatingEngineParameters,
)
router.put(
  '/rating-engine/model-adjustments',
  settingsController.updateRatingEngineModelAdjustments,
)
router.post(
  '/rating-engine/reset',
  settingsController.resetRatingEngineSettings,
)
router.get('/quick-rematch', settingsController.getQuickRematchSettings)
router.put('/quick-rematch', settingsController.updateQuickRematchSettings)
router.post(
  '/quick-rematch/reset',
  settingsController.resetQuickRematchSettings,
)

module.exports = router
