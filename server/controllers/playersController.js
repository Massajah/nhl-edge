const nhlApiService = require('../services/nhlApiService')

const getGoalieStats = async (request, response, next) => {
  const { playerId } = request.params

  if (!nhlApiService.isValidPlayerId(playerId)) {
    response.status(400).json({
      error: 'Player ID must be numeric.',
    })
    return
  }

  try {
    const goalieStats = await nhlApiService.getGoalieStatsForPlayer(playerId)

    response.json({ goalieStats })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getGoalieStats,
}
