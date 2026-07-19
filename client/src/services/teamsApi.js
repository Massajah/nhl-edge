import { apiRequest } from './apiClient.js'

const requestTeams = async (path) => {
  return apiRequest(path, undefined, {
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
