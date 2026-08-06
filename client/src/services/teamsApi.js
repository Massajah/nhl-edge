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

export const fetchTeamRoster = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/roster`,
  )

  return data.roster
}

export const fetchTeamStats = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/stats`,
  )

  return data.stats
}

export const fetchGoalieStats = async (playerId) => {
  const data = await requestTeams(
    `/api/players/${encodeURIComponent(playerId)}/goalie-stats`,
  )

  return data.goalieStats
}

export const fetchTeamGoalieSummaries = async (teamAbbreviation) => {
  const data = await requestTeams(
    `/api/teams/${encodeURIComponent(teamAbbreviation)}/goalie-summaries`,
  )

  return data.goalieSummaries
}

export const fetchGoalieAdjustments = (teamId) =>
  requestTeams(
    `/api/teams/${encodeURIComponent(teamId)}/goalie-adjustments`,
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
