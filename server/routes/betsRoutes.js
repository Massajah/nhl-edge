const express = require('express')
const betsController = require('../controllers/betsController')

const router = express.Router()

router.get('/', betsController.getBets)
router.post('/', betsController.createBet)
router.put('/:id', betsController.updateBet)
router.delete('/:id', betsController.deleteBet)

module.exports = router
