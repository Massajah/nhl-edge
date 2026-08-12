const nhlApiService = require('../services/nhlApiService')
const goalieAdjustmentsService = require('../services/goalieAdjustmentsService')
const teamLineupsService = require('../services/teamLineupsService')

const getUnavailableProviderState = (error) => ({
  errorCode: error?.upstreamStatus === 429
    ? 'NHL_RATE_LIMITED'
    : 'NHL_PROVIDER_UNAVAILABLE',
  fetchedAt: null,
  source: null,
  stale: false,
  status: error?.upstreamStatus === 429 ? 'rate_limited' : 'unavailable',
})

const sendProviderResult = (response, key, result) => {
  const { data, ...provider } = result

  response.json({
    [key]: data,
    provider,
  })
}

const handleProviderSectionError = (response, next, key, error) => {
  if (
    error?.name !== 'NhlApiError' ||
    ((error.statusCode ?? 500) < 500 && error.upstreamStatus !== 429)
  ) {
    next(error)
    return
  }

  response.json({
    [key]: null,
    provider: getUnavailableProviderState(error),
  })
}

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
    const result = request.query.localOnly === 'true'
      ? await goalieAdjustmentsService.getSavedGoalieAdjustments(
          request.user.id,
          request.params.teamId,
        )
      : await goalieAdjustmentsService.getProviderGoalieAdjustments(
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
    const roster = await nhlApiService.getRosterForTeam(teamAbbreviation, {
      includeProviderState: true,
    })

    sendProviderResult(response, 'roster', roster)
  } catch (error) {
    handleProviderSectionError(response, next, 'roster', error)
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
    const stats = await nhlApiService.getSpecialTeamsForTeam(
      teamAbbreviation,
      { includeProviderState: true },
    )

    sendProviderResult(response, 'stats', stats)
  } catch (error) {
    handleProviderSectionError(response, next, 'stats', error)
  }
}

const getLeagueSpecialTeams = async (_request, response, next) => {
  try {
    const specialTeams = await nhlApiService.getLeagueSpecialTeamsMatchupData({
      includeProviderState: true,
    })

    sendProviderResult(response, 'specialTeams', specialTeams)
  } catch (error) {
    handleProviderSectionError(response, next, 'specialTeams', error)
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
    const goalieSummaries = await nhlApiService.getGoalieSummariesForTeam(
      teamAbbreviation,
      { includeProviderState: true },
    )

    sendProviderResult(response, 'goalieSummaries', goalieSummaries)
  } catch (error) {
    handleProviderSectionError(response, next, 'goalieSummaries', error)
  }
}

module.exports = {
  clearTeamModelValues,
  deleteGoalieAdjustment,
  getGoalieAdjustments,
  getLeagueSpecialTeams,
  getTeamModelValues,
  getTeamGoalieSummaries,
  getTeamRoster,
  getTeamStats,
  getTeams,
  saveTeamModelValues,
  saveGoalieAdjustment,
  getUnavailableProviderState,
}
