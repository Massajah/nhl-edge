const express = require('express')
const powerRatingsController = require('../controllers/powerRatingsController')

const router = express.Router()

router.get('/', powerRatingsController.getPowerRatings)
router.put('/:teamId', powerRatingsController.updatePowerRating)
router.post('/seed', powerRatingsController.seedPowerRatings)

module.exports = router
