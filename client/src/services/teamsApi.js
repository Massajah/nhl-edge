import { apiRequest } from './apiClient.js'

const requestTeams = async (path, options) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load team data.',
  })
}

export const fetchTeams = async () => {
  const data = await requestTeams('/api/teams')

  return data.teams ?? []
}

export const fetchTeamRosterState = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/roster`,
  )

  return {
    data: data.roster ?? null,
    provider: data.provider ?? { status: data.roster ? 'ready' : 'unavailable' },
  }
}

export const fetchTeamRoster = async (teamAbbreviation) =>
  (await fetchTeamRosterState(teamAbbreviation)).data

export const fetchTeamStatsState = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/stats`,
  )

  return {
    data: data.stats ?? null,
    provider: data.provider ?? { status: data.stats ? 'ready' : 'unavailable' },
  }
}

export const fetchGoalieStats = async (playerId) => {
  const data = await requestTeams(
    `/api/players/${encodeURIComponent(playerId)}/goalie-stats`,
  )

  return data.goalieStats
}

export const fetchTeamGoalieSummariesState = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/goalie-summaries`,
  )

  return {
    data: data.goalieSummaries ?? null,
    provider: data.provider ?? {
      status: data.goalieSummaries ? 'ready' : 'unavailable',
    },
  }
}

export const fetchLeagueSpecialTeamsState = async () => {
  const data = await requestTeams('/api/teams/special-teams')

  return {
    data: data.specialTeams ?? null,
    provider: data.provider ?? {
      status: data.specialTeams ? 'ready' : 'unavailable',
    },
  }
}

export const fetchTeamStats = async (teamAbbreviation) =>
  (await fetchTeamStatsState(teamAbbreviation)).data

export const fetchTeamGoalieSummaries = async (teamAbbreviation) =>
  (await fetchTeamGoalieSummariesState(teamAbbreviation)).data

export const fetchGoalieAdjustments = (teamId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/goalie-adjustments`,
  )

export const fetchSavedGoalieAdjustments = (teamId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/goalie-adjustments?localOnly=true`,
  )

export const fetchTeamModelValues = (teamId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/model-values`,
  )

export const saveTeamLines = (teamId, modelValues) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/model-values/lines`,
    {
      body: JSON.stringify(modelValues),
      method: 'PUT',
    },
  )

export const clearTeamLines = (teamId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/model-values/lines`,
    { method: 'DELETE' },
  )

export const saveGoalieAdjustment = (teamId, nhlPlayerId, adjustment) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/goalie-adjustments/${encodeURIComponent(nhlPlayerId)}`,
    {
      body: JSON.stringify(adjustment),
      method: 'PUT',
    },
  )

export const deleteGoalieAdjustment = (teamId, nhlPlayerId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/goalie-adjustments/${encodeURIComponent(nhlPlayerId)}`,
    { method: 'DELETE' },
  )
