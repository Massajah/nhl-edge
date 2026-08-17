const express = require('express')
const powerRatingsController = require('../controllers/powerRatingsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/starting-scale', powerRatingsController.getStartingRatingScale)
router.put('/starting-scale', powerRatingsController.updateStartingRatingScale)
router.get('/', powerRatingsController.getPowerRatings)
router.get('/history/seasons', powerRatingsController.getPowerRatingHistorySeasons)
router.get('/history', powerRatingsController.getPowerRatingHistory)
router.post('/auto-update', powerRatingsController.automaticallyUpdatePowerRatings)
router.post('/update', powerRatingsController.updatePowerRatingsFromCompletedGames)
router.post('/reset', powerRatingsController.resetPowerRatings)
router.put('/starting/:teamId', powerRatingsController.updateStartingPowerRating)
router.put('/:teamId', powerRatingsController.updatePowerRating)
router.post('/seed', powerRatingsController.seedPowerRatings)

module.exports = router
