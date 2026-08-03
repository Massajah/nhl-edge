const express = require('express')
const marketOddsController = require('../controllers/marketOddsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)
router.get('/nhl', marketOddsController.getNhlMarketOdds)
router.get('/status', marketOddsController.getMarketOddsStatus)

module.exports = router
