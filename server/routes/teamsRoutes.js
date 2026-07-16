const express = require('express')
const teamsController = require('../controllers/teamsController')

const router = express.Router()

router.get('/', teamsController.getTeams)
router.get('/:teamAbbreviation/roster', teamsController.getTeamRoster)
router.get(
  '/:teamAbbreviation/goalie-summaries',
  teamsController.getTeamGoalieSummaries,
)
router.get('/:teamAbbreviation/stats', teamsController.getTeamStats)

module.exports = router
