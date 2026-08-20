export const SPECIAL_TEAMS_RANK_THRESHOLD_LIMITS = Object.freeze({
  max: 12,
  min: 3,
})

import '../../../shared/specialTeamsMatchups.js'

const specialTeamsMatchups =
  globalThis.__NHL_EDGE_SPECIAL_TEAMS_MATCHUPS__

export const {
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
} = specialTeamsMatchups

export const DEFAULT_SPECIAL_TEAMS_ALERT_SETTINGS =
  DEFAULT_SPECIAL_TEAMS_SETTINGS
