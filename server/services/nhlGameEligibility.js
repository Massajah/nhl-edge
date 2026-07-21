const DAY_MS = 24 * 60 * 60 * 1000

const NHL_GAME_TYPE_CODES = Object.freeze({
  PRESEASON: 1,
  REGULAR_SEASON: 2,
  PLAYOFFS: 3,
})
const NON_NHL_GAME_TYPE_CODES = new Set([19])
const KNOWN_NON_NHL_TEAM_ABBREVIATIONS = new Set([
  'CAN',
  'CZE',
  'FIN',
  'GER',
  'SUI',
  'SVK',
  'SWE',
  'USA',
])
const DEFAULT_REPLAY_GAME_TYPE_FILTERS = Object.freeze({
  regularSeason: true,
  playoffs: true,
  preseason: false,
})
const GAME_TYPE_FILTER_KEY_BY_CODE = Object.freeze({
  [NHL_GAME_TYPE_CODES.PRESEASON]: 'preseason',
  [NHL_GAME_TYPE_CODES.REGULAR_SEASON]: 'regularSeason',
  [NHL_GAME_TYPE_CODES.PLAYOFFS]: 'playoffs',
})
const GAME_TYPE_LABEL_BY_CODE = Object.freeze({
  [NHL_GAME_TYPE_CODES.PRESEASON]: 'preseason',
  [NHL_GAME_TYPE_CODES.REGULAR_SEASON]: 'regularSeason',
  [NHL_GAME_TYPE_CODES.PLAYOFFS]: 'playoffs',
  19: 'international',
})
const COMPLETED_GAME_STATES = new Set(['FINAL', 'OFF'])
const SKIP_REASONS = Object.freeze({
  MALFORMED_GAME: 'MALFORMED_GAME',
  MISSING_START_TIME: 'MISSING_START_TIME',
  NON_NHL_GAME: 'NON_NHL_GAME',
  NON_NHL_TEAM: 'NON_NHL_TEAM',
  NOT_COMPLETED: 'NOT_COMPLETED',
  OUTSIDE_DATE_RANGE: 'OUTSIDE_DATE_RANGE',
  UNKNOWN_TEAM_MAPPING: 'UNKNOWN_TEAM_MAPPING',
  UNRESOLVED_RESULT_TYPE: 'UNRESOLVED_RESULT_TYPE',
  UNSUPPORTED_GAME_TYPE: 'UNSUPPORTED_GAME_TYPE',
})

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  return value?.default ?? ''
}

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const getGameId = (game = {}) => game.id ?? game.gameId ?? null

const getGameStart = (game = {}) =>
  game.startTimeUTC ?? game.gameDate ?? game.startTime ?? null

const getGameStartTimestamp = (game = {}) => {
  const timestamp = Date.parse(getGameStart(game))

  return Number.isFinite(timestamp) ? timestamp : null
}

const getTeamNameFromApi = (team = {}) => {
  const fullName = getLocalizedValue(team.name)
  const placeName = getLocalizedValue(team.placeName)
  const commonName = getLocalizedValue(team.commonName)

  if (fullName) {
    return fullName
  }

  return [placeName, commonName].filter(Boolean).join(' ') || ''
}

const getTeamAbbreviationFromApi = (team = {}) =>
  normalizeIdentifier(
    getLocalizedValue(
      team.abbrev ?? team.abbreviation ?? team.teamAbbrev ?? team.triCode,
    ),
  )

const getTeamSnapshotFromApi = (team = {}, mappedTeam = null) => ({
  abbreviation: getTeamAbbreviationFromApi(team) || mappedTeam?.abbreviation || null,
  nhlTeamId: team?.id ?? null,
  teamId: mappedTeam?.teamId ?? null,
  teamName: getTeamNameFromApi(team) || mappedTeam?.teamName || null,
})

const getGameTypeCode = (game = {}) => {
  const gameType = Number(game.gameType)

  return Number.isInteger(gameType) ? gameType : null
}

const getGameTypeLabel = (gameType) =>
  GAME_TYPE_LABEL_BY_CODE[gameType] ?? 'unknown'

const resolveTeam = ({ rawTeam, teamsById }) => {
  const abbreviation = getTeamAbbreviationFromApi(rawTeam)
  const mappedTeam = teamsById?.get(abbreviation) ?? null

  return {
    abbreviation,
    isResolved: Boolean(mappedTeam),
    snapshot: getTeamSnapshotFromApi(rawTeam, mappedTeam),
    team: mappedTeam
      ? {
          ...mappedTeam,
          teamName: getTeamNameFromApi(rawTeam) || mappedTeam.teamName,
        }
      : null,
  }
}

const buildIneligibleResult = ({ details = {}, game, reason }) => ({
  details: {
    gameState: getLocalizedValue(game?.gameState) || null,
    gameType: getGameTypeCode(game),
    gameTypeLabel: getGameTypeLabel(getGameTypeCode(game)),
    season: game?.season ?? null,
    ...details,
  },
  eligible: false,
  gameDate: getGameStart(game),
  gameId: getGameId(game),
  reason,
})

const isWithinDateBounds = ({
  dateFromTimestamp,
  dateToTimestamp,
  gameTimestamp,
}) =>
  (!Number.isFinite(dateFromTimestamp) || gameTimestamp >= dateFromTimestamp) &&
  (!Number.isFinite(dateToTimestamp) || gameTimestamp < dateToTimestamp + DAY_MS)

const classifyGameEligibility = (game = {}, context = {}) => {
  const gameTypes = context.gameTypes ?? DEFAULT_REPLAY_GAME_TYPE_FILTERS

  if (!isPlainObject(game)) {
    return buildIneligibleResult({
      details: {
        field: 'game',
      },
      game,
      reason: SKIP_REASONS.MALFORMED_GAME,
    })
  }

  const gameTimestamp = getGameStartTimestamp(game)

  if (!Number.isFinite(gameTimestamp)) {
    return buildIneligibleResult({
      details: {
        field: 'startTimeUTC',
      },
      game,
      reason: SKIP_REASONS.MISSING_START_TIME,
    })
  }

  if (
    !isWithinDateBounds({
      dateFromTimestamp: context.dateFromTimestamp,
      dateToTimestamp: context.dateToTimestamp,
      gameTimestamp,
    })
  ) {
    return buildIneligibleResult({
      details: {
        dateFrom: context.dateFrom ?? null,
        dateTo: context.dateTo ?? null,
      },
      game,
      reason: SKIP_REASONS.OUTSIDE_DATE_RANGE,
    })
  }

  const gameState = getLocalizedValue(game.gameState).toUpperCase()

  if (!COMPLETED_GAME_STATES.has(gameState)) {
    return buildIneligibleResult({
      details: {
        supportedGameStates: [...COMPLETED_GAME_STATES],
      },
      game,
      reason: SKIP_REASONS.NOT_COMPLETED,
    })
  }

  if (!isPlainObject(game.homeTeam) || !isPlainObject(game.awayTeam)) {
    return buildIneligibleResult({
      details: {
        field: !isPlainObject(game.homeTeam) ? 'homeTeam' : 'awayTeam',
      },
      game,
      reason: SKIP_REASONS.MALFORMED_GAME,
    })
  }

  const gameType = getGameTypeCode(game)

  if (!Number.isInteger(gameType)) {
    return buildIneligibleResult({
      details: {
        field: 'gameType',
      },
      game,
      reason: SKIP_REASONS.MALFORMED_GAME,
    })
  }

  if (NON_NHL_GAME_TYPE_CODES.has(gameType)) {
    return buildIneligibleResult({
      details: {
        awayTeam: getTeamSnapshotFromApi(game.awayTeam),
        homeTeam: getTeamSnapshotFromApi(game.homeTeam),
      },
      game,
      reason: SKIP_REASONS.NON_NHL_GAME,
    })
  }

  const filterKey = GAME_TYPE_FILTER_KEY_BY_CODE[gameType]

  if (!filterKey || gameTypes[filterKey] !== true) {
    return buildIneligibleResult({
      details: {
        enabledGameTypes: gameTypes,
        supportedGameTypeCodes: NHL_GAME_TYPE_CODES,
      },
      game,
      reason: SKIP_REASONS.UNSUPPORTED_GAME_TYPE,
    })
  }

  const homeTeam = resolveTeam({
    rawTeam: game.homeTeam,
    teamsById: context.teamsById,
  })
  const awayTeam = resolveTeam({
    rawTeam: game.awayTeam,
    teamsById: context.teamsById,
  })

  if (!homeTeam.abbreviation || !awayTeam.abbreviation) {
    return buildIneligibleResult({
      details: {
        awayTeam: awayTeam.snapshot,
        homeTeam: homeTeam.snapshot,
      },
      game,
      reason: SKIP_REASONS.MALFORMED_GAME,
    })
  }

  if (
    KNOWN_NON_NHL_TEAM_ABBREVIATIONS.has(homeTeam.abbreviation) ||
    KNOWN_NON_NHL_TEAM_ABBREVIATIONS.has(awayTeam.abbreviation)
  ) {
    return buildIneligibleResult({
      details: {
        awayTeam: awayTeam.snapshot,
        homeTeam: homeTeam.snapshot,
      },
      game,
      reason: SKIP_REASONS.NON_NHL_TEAM,
    })
  }

  if (!homeTeam.isResolved || !awayTeam.isResolved) {
    return buildIneligibleResult({
      details: {
        awayTeam: awayTeam.snapshot,
        homeTeam: homeTeam.snapshot,
      },
      game,
      reason: SKIP_REASONS.UNKNOWN_TEAM_MAPPING,
    })
  }

  return {
    awayTeam: awayTeam.team,
    details: {
      gameType,
      gameTypeLabel: getGameTypeLabel(gameType),
      season: game.season ?? null,
    },
    eligible: true,
    gameDate: getGameStart(game),
    gameId: getGameId(game),
    homeTeam: homeTeam.team,
    reason: null,
  }
}

module.exports = {
  COMPLETED_GAME_STATES,
  DEFAULT_REPLAY_GAME_TYPE_FILTERS,
  GAME_TYPE_FILTER_KEY_BY_CODE,
  NHL_GAME_TYPE_CODES,
  SKIP_REASONS,
  classifyGameEligibility,
  getGameId,
  getGameStart,
  getGameStartTimestamp,
  getTeamAbbreviationFromApi,
  getTeamNameFromApi,
  getTeamSnapshotFromApi,
  getGameTypeLabel,
}
