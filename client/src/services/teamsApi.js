const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

const requestTeams = async (path) => {
  const response = await fetch(`${API_BASE_URL}${path}`)

  if (!response.ok) {
    let message = 'Unable to load team data.'

    try {
      const data = await response.json()
      message = data.error ?? message
    } catch {
      // Keep the default message when the server cannot return JSON.
    }

    throw new Error(message)
  }

  return response.json()
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
