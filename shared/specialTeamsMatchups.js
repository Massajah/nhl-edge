const SPECIAL_TEAMS_MATCHUP_STATUSES = Object.freeze({
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
  POSITIVE: 'positive',
  UNAVAILABLE: 'unavailable',
})

const normalizeTeamKey = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()

const toValidRank = (value, leagueTeamCount) => {
  const rank = Number(value)

  return Number.isInteger(rank) && rank >= 1 && rank <= leagueTeamCount
    ? rank
    : null
}

const getRankValue = (stats, field) => {
  if (!stats || typeof stats !== 'object') {
    return null
  }

  const threeSeasonStats = stats.previousThreeSeasonsAverage ?? stats

  return field === 'powerPlay'
    ? threeSeasonStats.powerPlayLeagueRank ??
        threeSeasonStats.averagePowerPlayLeagueRank
    : threeSeasonStats.penaltyKillLeagueRank ??
        threeSeasonStats.averagePenaltyKillLeagueRank
}

const evaluateOffensiveMatchup = ({
  leagueTeamCount,
  opponentPenaltyKillRank,
  powerPlayRank,
  threshold,
}) => {
  const ppRank = toValidRank(powerPlayRank, leagueTeamCount)
  const opponentPkRank = toValidRank(
    opponentPenaltyKillRank,
    leagueTeamCount,
  )
  const bottomRankStart = leagueTeamCount - threshold + 1

  if (ppRank === null || opponentPkRank === null) {
    return {
      bottomRankStart,
      opponentPkRank,
      ppRank,
      rankGap: null,
      status: SPECIAL_TEAMS_MATCHUP_STATUSES.UNAVAILABLE,
    }
  }

  const isPositive = ppRank <= threshold && opponentPkRank >= bottomRankStart
  const isNegative = ppRank >= bottomRankStart && opponentPkRank <= threshold

  return {
    bottomRankStart,
    opponentPkRank,
    ppRank,
    rankGap:
      isPositive || isNegative ? Math.abs(opponentPkRank - ppRank) : null,
    status: isPositive
      ? SPECIAL_TEAMS_MATCHUP_STATUSES.POSITIVE
      : isNegative
        ? SPECIAL_TEAMS_MATCHUP_STATUSES.NEGATIVE
        : SPECIAL_TEAMS_MATCHUP_STATUSES.NEUTRAL,
  }
}

const calculateSpecialTeamsMatchup = ({
  awayTeamSpecialTeams,
  homeTeamSpecialTeams,
  leagueTeamCount,
  threshold = 6,
} = {}) => {
  const normalizedLeagueTeamCount = Number(leagueTeamCount)
  const normalizedThreshold = Number(threshold)
  const hasValidConfiguration =
    Number.isInteger(normalizedLeagueTeamCount) &&
    normalizedLeagueTeamCount > 1 &&
    Number.isInteger(normalizedThreshold) &&
    normalizedThreshold >= 1 &&
    normalizedThreshold * 2 <= normalizedLeagueTeamCount

  if (!hasValidConfiguration) {
    const unavailable = {
      bottomRankStart: null,
      opponentPkRank: null,
      ppRank: null,
      rankGap: null,
      status: SPECIAL_TEAMS_MATCHUP_STATUSES.UNAVAILABLE,
    }

    return {
      away: { ...unavailable },
      home: { ...unavailable },
      leagueTeamCount: Number.isInteger(normalizedLeagueTeamCount)
        ? normalizedLeagueTeamCount
        : null,
      threshold: Number.isInteger(normalizedThreshold)
        ? normalizedThreshold
        : null,
    }
  }

  return {
    away: evaluateOffensiveMatchup({
      leagueTeamCount: normalizedLeagueTeamCount,
      opponentPenaltyKillRank: getRankValue(
        homeTeamSpecialTeams,
        'penaltyKill',
      ),
      powerPlayRank: getRankValue(awayTeamSpecialTeams, 'powerPlay'),
      threshold: normalizedThreshold,
    }),
    home: evaluateOffensiveMatchup({
      leagueTeamCount: normalizedLeagueTeamCount,
      opponentPenaltyKillRank: getRankValue(
        awayTeamSpecialTeams,
        'penaltyKill',
      ),
      powerPlayRank: getRankValue(homeTeamSpecialTeams, 'powerPlay'),
      threshold: normalizedThreshold,
    }),
    leagueTeamCount: normalizedLeagueTeamCount,
    threshold: normalizedThreshold,
  }
}

const indexLeagueSpecialTeams = (specialTeams = {}) =>
  (Array.isArray(specialTeams?.teams) ? specialTeams.teams : []).reduce(
    (teamsByAbbreviation, teamStats) => {
      const teamKey = normalizeTeamKey(teamStats?.teamAbbreviation)

      if (teamKey) {
        teamsByAbbreviation[teamKey] = teamStats
      }

      return teamsByAbbreviation
    },
    {},
  )

const getSpecialTeamsMatchupForTeams = ({
  awayTeam,
  homeTeam,
  specialTeams,
  threshold,
} = {}) => {
  const teamsByAbbreviation = indexLeagueSpecialTeams(specialTeams)

  return calculateSpecialTeamsMatchup({
    awayTeamSpecialTeams:
      teamsByAbbreviation[normalizeTeamKey(awayTeam)] ?? null,
    homeTeamSpecialTeams:
      teamsByAbbreviation[normalizeTeamKey(homeTeam)] ?? null,
    leagueTeamCount: specialTeams?.leagueTeamCount,
    threshold,
  })
}

const specialTeamsMatchupApi = {
  SPECIAL_TEAMS_MATCHUP_STATUSES,
  calculateSpecialTeamsMatchup,
  getSpecialTeamsMatchupForTeams,
  indexLeagueSpecialTeams,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = specialTeamsMatchupApi
}

if (typeof globalThis !== 'undefined') {
  globalThis.__NHL_EDGE_SPECIAL_TEAMS_MATCHUPS__ = specialTeamsMatchupApi
}
