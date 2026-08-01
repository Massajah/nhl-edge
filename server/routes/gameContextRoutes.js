const express = require('express')
const gameContextController = require('../controllers/gameContextController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.post('/bulk', gameContextController.getGameContexts)
router.patch('/:gameId', gameContextController.updateGameContextOverrides)

module.exports = router
