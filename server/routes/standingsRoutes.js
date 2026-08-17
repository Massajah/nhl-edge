const express = require('express')
const standingsController = require('../controllers/standingsController')

const router = express.Router()

router.get('/playoffs', standingsController.getPlayoffs)
router.get('/', standingsController.getStandings)

module.exports = router
