const express = require('express')
const settingsController = require('../controllers/settingsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/betting', settingsController.getBettingSettings)
router.put('/betting', settingsController.updateBettingSettings)
router.post('/betting/reset', settingsController.resetBettingSettings)
router.get('/rating-engine', settingsController.getRatingEngineSettings)
router.put('/rating-engine', settingsController.updateRatingEngineSettings)
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
