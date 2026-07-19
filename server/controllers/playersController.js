const nhlApiService = require('../services/nhlApiService')

const getGoalieStats = async (request, response, next) => {
  const { playerId } = request.params

  if (!nhlApiService.isValidPlayerId(playerId)) {
    const message = 'Player ID must be numeric.'

    response.status(400).json({
      error: message,
      message,
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
