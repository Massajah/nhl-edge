const express = require('express')
const bankrollController = require('../controllers/bankrollController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/seasons', bankrollController.getBankrollSeasons)
router.get('/summary', bankrollController.getBankrollSummary)
router.get('/transactions', bankrollController.getBankrollTransactions)
router.post('/initialize', bankrollController.initializeBankroll)
router.post('/deposits', bankrollController.addDeposit)
router.post('/withdrawals', bankrollController.addWithdrawal)

module.exports = router
