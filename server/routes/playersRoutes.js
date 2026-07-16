const express = require('express')
const playersController = require('../controllers/playersController')

const router = express.Router()

router.get('/:playerId/goalie-stats', playersController.getGoalieStats)

module.exports = router
