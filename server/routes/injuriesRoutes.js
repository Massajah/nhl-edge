const express = require('express')
const injuriesController = require('../controllers/injuriesController')

const router = express.Router()

router.get('/', injuriesController.getInjuries)
router.get('/summary', injuriesController.getTeamInjurySummary)
router.get('/team/:teamId', injuriesController.getTeamInjuries)
router.post('/', injuriesController.createInjury)
router.put('/:id', injuriesController.updateInjury)
router.delete('/:id', injuriesController.deleteInjury)

module.exports = router
