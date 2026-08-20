export const filterTeams = (
  teams,
  {
    conferenceFilter = 'all',
    divisionFilter = 'all',
    searchTerm = '',
  } = {},
) => {
  const normalizedSearch = searchTerm.trim().toLowerCase()

  return teams.filter((team) => {
    if (
      conferenceFilter !== 'all' &&
      team.conference !== conferenceFilter
    ) {
      return false
    }

    if (divisionFilter !== 'all' && team.division !== divisionFilter) {
      return false
    }

    if (!normalizedSearch) {
      return true
    }

    return [team.name, team.abbreviation, team.conference, team.division].some(
      (value = '') => value.toLowerCase().includes(normalizedSearch),
    )
  })
}

const normalizeTeamIdentity = (value) =>
  String(value ?? '').trim().toUpperCase()

export const getTeamStanding = (standings = [], team = {}) => {
  const standingsRows = Array.isArray(standings) ? standings : []
  const teamIdentities = new Set(
    [team.id, team.teamId, team.abbreviation]
      .map(normalizeTeamIdentity)
      .filter(Boolean),
  )

  return (
    standingsRows.find((standing) =>
      [standing.teamId, standing.teamAbbreviation]
        .map(normalizeTeamIdentity)
        .some((identity) => identity && teamIdentities.has(identity)),
    ) ?? null
  )
}
