const express = require('express')
const modelPerformanceController = require('../controllers/modelPerformanceController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)
router.get('/', modelPerformanceController.getModelPerformance)
router.get('/games', modelPerformanceController.getModelPerformanceGames)

module.exports = router
