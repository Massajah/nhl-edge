const express = require('express')
const powerRatingSimulationsController = require('../controllers/powerRatingSimulationsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.post('/preview', powerRatingSimulationsController.previewPowerRatingSimulation)

module.exports = router
