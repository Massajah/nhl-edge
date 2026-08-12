export const DEFAULT_SPECIAL_TEAMS_ALERT_SETTINGS = Object.freeze({
  specialTeamsAlertsEnabled: true,
  specialTeamsRankThreshold: 6,
})

export const SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS = Object.freeze({
  max: 12,
  min: 3,
})

import '../../../shared/specialTeamsMatchups.js'

const specialTeamsMatchups =
  globalThis.__NHL_EDGE_SPECIAL_TEAMS_MATCHUPS__

export const {
  SPECIAL_TEAMS_MATCHUP_STATUSES,
  calculateSpecialTeamsMatchup,
  getSpecialTeamsMatchupForTeams,
  indexLeagueSpecialTeams,
} = specialTeamsMatchups
