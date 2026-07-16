const nhlApiService = require('../services/nhlApiService')

const getTeams = async (_request, response, next) => {
  try {
    const teams = await nhlApiService.getTeams()

    response.json({ teams })
  } catch (error) {
    next(error)
  }
}

const getTeamRoster = async (request, response, next) => {
  const { teamAbbreviation } = request.params

  if (!nhlApiService.isValidTeamAbbreviation(teamAbbreviation)) {
    response.status(400).json({
      error: 'Team abbreviation must use 2 to 4 letters.',
    })
    return
  }

  try {
    const roster = await nhlApiService.getRosterForTeam(teamAbbreviation)

    response.json({ roster })
  } catch (error) {
    next(error)
  }
}

const getTeamStats = async (request, response, next) => {
  const { teamAbbreviation } = request.params

  if (!nhlApiService.isValidTeamAbbreviation(teamAbbreviation)) {
    response.status(400).json({
      error: 'Team abbreviation must use 2 to 4 letters.',
    })
    return
  }

  try {
    const stats = await nhlApiService.getSpecialTeamsForTeam(teamAbbreviation)

    response.json({ stats })
  } catch (error) {
    next(error)
  }
}

const getTeamGoalieSummaries = async (request, response, next) => {
  const { teamAbbreviation } = request.params

  if (!nhlApiService.isValidTeamAbbreviation(teamAbbreviation)) {
    response.status(400).json({
      error: 'Team abbreviation must use 2 to 4 letters.',
    })
    return
  }

  try {
    const goalieSummaries =
      await nhlApiService.getGoalieSummariesForTeam(teamAbbreviation)

    response.json({ goalieSummaries })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getTeamGoalieSummaries,
  getTeamRoster,
  getTeamStats,
  getTeams,
}
