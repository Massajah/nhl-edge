const SPECIAL_TEAMS_MATCHUP_STATUSES = Object.freeze({
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
  POSITIVE: 'positive',
  UNAVAILABLE: 'unavailable',
})

const SPECIAL_TEAMS_MODES = Object.freeze({
  ALERT_ONLY: 'alert_only',
  AUTOMATIC: 'automatic',
  OFF: 'off',
})

const SPECIAL_TEAMS_SIGNALS = Object.freeze({
  NEGATIVE: 'weak_pp_vs_strong_pk',
  POSITIVE: 'strong_pp_vs_weak_pk',
})

const DEFAULT_SPECIAL_TEAMS_SETTINGS = Object.freeze({
  specialTeamsAdjustment: 0.5,
  specialTeamsAlertsEnabled: true,
  specialTeamsMode: SPECIAL_TEAMS_MODES.ALERT_ONLY,
  specialTeamsRankThreshold: 6,
})

const SPECIAL_TEAMS_ADJUSTMENT_LIMITS = Object.freeze({
  max: 1,
  min: 0.25,
  step: 0.25,
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

const normalizeSpecialTeamsMode = (mode, legacyAlertsEnabled) => {
  const normalizedMode = String(mode ?? '').trim().toLowerCase()

  if (Object.values(SPECIAL_TEAMS_MODES).includes(normalizedMode)) {
    return normalizedMode
  }

  return legacyAlertsEnabled === false
    ? SPECIAL_TEAMS_MODES.OFF
    : SPECIAL_TEAMS_MODES.ALERT_ONLY
}

const normalizeSpecialTeamsAdjustment = (value) => {
  const adjustment = Number(value)
  const { max, min, step } = SPECIAL_TEAMS_ADJUSTMENT_LIMITS

  return Number.isFinite(adjustment) &&
    adjustment >= min &&
    adjustment <= max &&
    Number.isInteger(adjustment / step)
    ? adjustment
    : DEFAULT_SPECIAL_TEAMS_SETTINGS.specialTeamsAdjustment
}

const getSignalFromStatus = (status) => {
  if (status === SPECIAL_TEAMS_MATCHUP_STATUSES.POSITIVE) {
    return SPECIAL_TEAMS_SIGNALS.POSITIVE
  }

  if (status === SPECIAL_TEAMS_MATCHUP_STATUSES.NEGATIVE) {
    return SPECIAL_TEAMS_SIGNALS.NEGATIVE
  }

  return null
}

const createTeamSpecialTeamsContext = ({
  magnitude,
  mode,
  teamMatchup,
  threshold,
}) => {
  const isOff = mode === SPECIAL_TEAMS_MODES.OFF
  const signal = isOff ? null : getSignalFromStatus(teamMatchup.status)
  let adjustment = 0

  if (mode === SPECIAL_TEAMS_MODES.AUTOMATIC) {
    if (signal === SPECIAL_TEAMS_SIGNALS.POSITIVE) {
      adjustment = magnitude
    } else if (signal === SPECIAL_TEAMS_SIGNALS.NEGATIVE) {
      adjustment = -magnitude
    }
  }

  return {
    adjustment,
    mode,
    opponentPkRank: teamMatchup.opponentPkRank,
    ppRank: teamMatchup.ppRank,
    signal,
    status: isOff
      ? SPECIAL_TEAMS_MATCHUP_STATUSES.NEUTRAL
      : teamMatchup.status,
    threshold,
  }
}

const getSpecialTeamsContextForTeams = ({
  adjustment,
  awayTeam,
  homeTeam,
  legacyAlertsEnabled,
  mode,
  specialTeams,
  threshold,
} = {}) => {
  const normalizedMode = normalizeSpecialTeamsMode(
    mode,
    legacyAlertsEnabled,
  )
  const magnitude = normalizeSpecialTeamsAdjustment(adjustment)
  const matchup = getSpecialTeamsMatchupForTeams({
    awayTeam,
    homeTeam,
    specialTeams,
    threshold,
  })

  return {
    away: createTeamSpecialTeamsContext({
      magnitude,
      mode: normalizedMode,
      teamMatchup: matchup.away,
      threshold: matchup.threshold,
    }),
    home: createTeamSpecialTeamsContext({
      magnitude,
      mode: normalizedMode,
      teamMatchup: matchup.home,
      threshold: matchup.threshold,
    }),
    leagueTeamCount: matchup.leagueTeamCount,
    magnitude,
    mode: normalizedMode,
    threshold: matchup.threshold,
  }
}

const applySpecialTeamsContextToInputs = (inputs = {}, context = null) => ({
  ...inputs,
  away: {
    ...inputs.away,
    specialTeamsAdjustment: Number(context?.away?.adjustment) || 0,
    specialTeamsContext: context?.away ? { ...context.away } : null,
  },
  home: {
    ...inputs.home,
    specialTeamsAdjustment: Number(context?.home?.adjustment) || 0,
    specialTeamsContext: context?.home ? { ...context.home } : null,
  },
})

const specialTeamsMatchupApi = {
  DEFAULT_SPECIAL_TEAMS_SETTINGS,
  SPECIAL_TEAMS_ADJUSTMENT_LIMITS,
  SPECIAL_TEAMS_MATCHUP_STATUSES,
  SPECIAL_TEAMS_MODES,
  SPECIAL_TEAMS_SIGNALS,
  applySpecialTeamsContextToInputs,
  calculateSpecialTeamsMatchup,
  getSpecialTeamsContextForTeams,
  getSpecialTeamsMatchupForTeams,
  indexLeagueSpecialTeams,
  normalizeSpecialTeamsAdjustment,
  normalizeSpecialTeamsMode,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = specialTeamsMatchupApi
}

if (typeof globalThis !== 'undefined') {
  globalThis.__NHL_EDGE_SPECIAL_TEAMS_MATCHUPS__ = specialTeamsMatchupApi
}
