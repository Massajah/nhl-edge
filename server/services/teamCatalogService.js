const {
  TEAM_IDENTITIES,
  getNhlTeamIdentity,
} = require('./nhlTeamIdentity')

const normalizeTeamIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const KNOWN_TEAMS = Object.freeze(
  TEAM_IDENTITIES.map(([teamId, teamName]) =>
    Object.freeze({
      teamAbbreviation: teamId,
      teamId,
      teamName,
    }),
  ),
)

const getKnownTeams = () => KNOWN_TEAMS

const getKnownTeamById = (teamIdentity) => {
  const teamId = getNhlTeamIdentity(teamIdentity)

  return teamId
    ? KNOWN_TEAMS.find((team) => team.teamId === teamId) ?? null
    : null
}

module.exports = {
  getKnownTeamById,
  getKnownTeams,
  normalizeTeamIdentifier,
}
