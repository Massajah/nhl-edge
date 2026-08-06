const express = require('express')
const teamsController = require('../controllers/teamsController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.get('/', teamsController.getTeams)
router.get(
  '/:teamId/model-values',
  authenticate,
  teamsController.getTeamModelValues,
)
router.put(
  '/:teamId/model-values/lines',
  authenticate,
  teamsController.saveTeamModelValues,
)
router.delete(
  '/:teamId/model-values/lines',
  authenticate,
  teamsController.clearTeamModelValues,
)
router.get(
  '/:teamId/goalie-adjustments',
  authenticate,
  teamsController.getGoalieAdjustments,
)
router.put(
  '/:teamId/goalie-adjustments/:nhlPlayerId',
  authenticate,
  teamsController.saveGoalieAdjustment,
)
router.delete(
  '/:teamId/goalie-adjustments/:nhlPlayerId',
  authenticate,
  teamsController.deleteGoalieAdjustment,
)
router.get('/:teamAbbreviation/roster', teamsController.getTeamRoster)
router.get(
  '/:teamAbbreviation/goalie-summaries',
  teamsController.getTeamGoalieSummaries,
)
router.get('/:teamAbbreviation/stats', teamsController.getTeamStats)

module.exports = router
