const express = require('express')
const betsController = require('../controllers/betsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/', betsController.getBets)
router.post('/', betsController.createBet)
router.put('/:id', betsController.updateBet)
router.delete('/:id', betsController.deleteBet)

module.exports = router
