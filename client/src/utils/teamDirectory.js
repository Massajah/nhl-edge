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
