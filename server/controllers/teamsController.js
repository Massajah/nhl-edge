const nhlApiService = require('../services/nhlApiService')
const goalieAdjustmentsService = require('../services/goalieAdjustmentsService')
const teamLineupsService = require('../services/teamLineupsService')

const getTeamModelValues = async (request, response, next) => {
  try {
    const result = await teamLineupsService.getTeamLineup(
      request.user.id,
      request.params.teamId,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const saveTeamModelValues = async (request, response, next) => {
  try {
    const result = await teamLineupsService.saveTeamLineup(
      request.user.id,
      request.params.teamId,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const clearTeamModelValues = async (request, response, next) => {
  try {
    const result = await teamLineupsService.clearTeamLineup(
      request.user.id,
      request.params.teamId,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getGoalieAdjustments = async (request, response, next) => {
  try {
    const result = await goalieAdjustmentsService.getProviderGoalieAdjustments(
      request.user.id,
      request.params.teamId,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const saveGoalieAdjustment = async (request, response, next) => {
  try {
    const result = await goalieAdjustmentsService.saveGoalieAdjustment(
      request.user.id,
      request.params.teamId,
      request.params.nhlPlayerId,
      request.body,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const deleteGoalieAdjustment = async (request, response, next) => {
  try {
    const result = await goalieAdjustmentsService.deleteGoalieAdjustment(
      request.user.id,
      request.params.teamId,
      request.params.nhlPlayerId,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

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
    const message = 'Team abbreviation must use 2 to 4 letters.'

    response.status(400).json({
      error: message,
      message,
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
    const message = 'Team abbreviation must use 2 to 4 letters.'

    response.status(400).json({
      error: message,
      message,
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
    const message = 'Team abbreviation must use 2 to 4 letters.'

    response.status(400).json({
      error: message,
      message,
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
  clearTeamModelValues,
  deleteGoalieAdjustment,
  getGoalieAdjustments,
  getTeamModelValues,
  getTeamGoalieSummaries,
  getTeamRoster,
  getTeamStats,
  getTeams,
  saveTeamModelValues,
  saveGoalieAdjustment,
}
