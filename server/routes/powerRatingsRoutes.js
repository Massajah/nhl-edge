const express = require('express')
const powerRatingsController = require('../controllers/powerRatingsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/', powerRatingsController.getPowerRatings)
router.post('/update', powerRatingsController.updatePowerRatingsFromCompletedGames)
router.put('/:teamId', powerRatingsController.updatePowerRating)
router.post('/seed', powerRatingsController.seedPowerRatings)

module.exports = router
