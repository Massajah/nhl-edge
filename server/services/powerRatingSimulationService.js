const PowerRating = require('../models/PowerRating')
const nhlApiService = require('./nhlApiService')
const { getSeedTeams } = require('./powerRatingsService')
const {
  DEFAULT_BASE_RATING,
  DEFAULT_RATING_ENGINE_CONFIGURATION,
  calculatePregameProbability,
  calculateRatingUpdate,
  classifyCompletedGameResult,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')
const {
  DEFAULT_REPLAY_GAME_TYPE_FILTERS,
  SKIP_REASONS,
  classifyGameEligibility,
  getGameId,
  getGameStart,
  getGameStartTimestamp,
  getTeamSnapshotFromApi,
} = require('./nhlGameEligibility')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_REPLAY_DATE_RANGE_DAYS = 370
const STARTING_MODES = Object.freeze({
  CURRENT: 'current',
  EQUAL: 'equal',
})
const DEFAULT_REPLAY_HOME_ADVANTAGE = 2.5
const RESPONSE_CONTROL_DEFAULTS = Object.freeze({
  includeGameResults: false,
  includeSkippedGames: false,
})
const SUMMARY_PRECISION_DECIMALS = 6

class PowerRatingSimulationError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'PowerRatingSimulationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const toOptionalFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const parseReplayDate = (value, field) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new PowerRatingSimulationError(
      `${field} must use YYYY-MM-DD format.`,
      400,
      { field },
    )
  }

  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new PowerRatingSimulationError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return {
    date: value,
    timestamp,
  }
}

const formatReplayDate = (timestamp) =>
  new Date(timestamp).toISOString().slice(0, 10)

const listReplayDates = ({ dateFromTimestamp, dateToTimestamp }) => {
  const dates = []

  for (
    let timestamp = dateFromTimestamp;
    timestamp <= dateToTimestamp;
    timestamp += DAY_MS
  ) {
    dates.push(formatReplayDate(timestamp))
  }

  return dates
}

const normalizeStartingMode = (startingMode = STARTING_MODES.CURRENT) => {
  if (!Object.values(STARTING_MODES).includes(startingMode)) {
    throw new PowerRatingSimulationError(
      'startingMode must be current or equal.',
      400,
      { field: 'startingMode' },
    )
  }

  return startingMode
}

const validateBoolean = (value, field, fallback) => {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw new PowerRatingSimulationError(`${field} must be a boolean.`, 400, {
      field,
    })
  }

  return value
}

const normalizeGameTypeFilters = (gameTypes) => {
  if (gameTypes === undefined) {
    return { ...DEFAULT_REPLAY_GAME_TYPE_FILTERS }
  }

  if (!isPlainObject(gameTypes)) {
    throw new PowerRatingSimulationError('gameTypes must be an object.', 400, {
      field: 'gameTypes',
    })
  }

  const supportedFields = Object.keys(DEFAULT_REPLAY_GAME_TYPE_FILTERS)
  const unsupportedFields = Object.keys(gameTypes).filter(
    (field) => !supportedFields.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new PowerRatingSimulationError(
      'gameTypes contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  const normalizedGameTypes = supportedFields.reduce(
    (filters, field) => ({
      ...filters,
      [field]: validateBoolean(gameTypes[field], `gameTypes.${field}`, filters[field]),
    }),
    { ...DEFAULT_REPLAY_GAME_TYPE_FILTERS },
  )

  if (!Object.values(normalizedGameTypes).some(Boolean)) {
    throw new PowerRatingSimulationError(
      'At least one supported game type must be enabled.',
      400,
      { field: 'gameTypes' },
    )
  }

  return normalizedGameTypes
}

const normalizeResponseControls = (payload = {}) => ({
  includeGameResults: validateBoolean(
    payload.includeGameResults,
    'includeGameResults',
    RESPONSE_CONTROL_DEFAULTS.includeGameResults,
  ),
  includeSkippedGames: validateBoolean(
    payload.includeSkippedGames,
    'includeSkippedGames',
    RESPONSE_CONTROL_DEFAULTS.includeSkippedGames,
  ),
})

const normalizePreviewInput = (payload = {}) => {
  if (!isPlainObject(payload)) {
    throw new PowerRatingSimulationError('Request body must be an object.', 400)
  }

  const parsedDateFrom = parseReplayDate(payload.dateFrom, 'dateFrom')
  const parsedDateTo = parseReplayDate(payload.dateTo, 'dateTo')

  if (parsedDateFrom.timestamp > parsedDateTo.timestamp) {
    throw new PowerRatingSimulationError(
      'dateFrom must be on or before dateTo.',
      400,
      {
        dateFrom: parsedDateFrom.date,
        dateTo: parsedDateTo.date,
      },
    )
  }

  const dateRangeDays =
    Math.floor((parsedDateTo.timestamp - parsedDateFrom.timestamp) / DAY_MS) + 1

  if (dateRangeDays > MAX_REPLAY_DATE_RANGE_DAYS) {
    throw new PowerRatingSimulationError(
      `Replay date range cannot exceed ${MAX_REPLAY_DATE_RANGE_DAYS} days.`,
      400,
      {
        dateRangeDays,
        maxDateRangeDays: MAX_REPLAY_DATE_RANGE_DAYS,
      },
    )
  }

  return {
    configuration: createRatingEngineConfiguration(payload.configuration),
    dateFrom: parsedDateFrom.date,
    dateFromTimestamp: parsedDateFrom.timestamp,
    dateTo: parsedDateTo.date,
    dateToTimestamp: parsedDateTo.timestamp,
    gameTypes: normalizeGameTypeFilters(payload.gameTypes),
    responseControls: normalizeResponseControls(payload),
    startingMode: normalizeStartingMode(payload.startingMode),
  }
}

const normalizeReplayDates = ({
  dateFrom,
  dateFromTimestamp,
  dateTo,
  dateToTimestamp,
}) => {
  const parsedDateFrom = Number.isFinite(dateFromTimestamp)
    ? {
        date: dateFrom,
        timestamp: dateFromTimestamp,
      }
    : parseReplayDate(dateFrom, 'dateFrom')
  const parsedDateTo = Number.isFinite(dateToTimestamp)
    ? {
        date: dateTo,
        timestamp: dateToTimestamp,
      }
    : parseReplayDate(dateTo, 'dateTo')

  return {
    dateFrom: parsedDateFrom.date,
    dateFromTimestamp: parsedDateFrom.timestamp,
    dateTo: parsedDateTo.date,
    dateToTimestamp: parsedDateTo.timestamp,
  }
}

const getScheduleGamesForDate = async (date) => {
  const schedule = await nhlApiService.getScheduleForDate(date)
  const scheduleDay = schedule.gameWeek?.find((day) => day.date === date)
  const games = scheduleDay?.games ?? schedule.games ?? []

  return Array.isArray(games)
    ? games.map((game) => ({
        ...game,
        __replayScheduleDate: date,
      }))
    : []
}

const fetchNhlScheduleGames = async ({ dateFromTimestamp, dateToTimestamp }) => {
  const games = []
  const dates = listReplayDates({
    dateFromTimestamp,
    dateToTimestamp,
  })

  for (const date of dates) {
    const dateGames = await getScheduleGamesForDate(date)

    games.push(...dateGames)
  }

  return games
}

const deduplicateGamesById = (games = []) => {
  const seenGameIds = new Set()
  const uniqueGames = []

  ;(Array.isArray(games) ? games : []).forEach((game, index) => {
    const gameId = getGameId(game)

    if (gameId === null || gameId === undefined || gameId === '') {
      uniqueGames.push(game)
      return
    }

    const gameKey = String(gameId)

    if (seenGameIds.has(gameKey)) {
      return
    }

    seenGameIds.add(gameKey)
    uniqueGames.push({
      ...game,
      __replaySourceIndex: index,
    })
  })

  return uniqueGames
}

const buildTeamDirectory = async () => {
  const seedTeams = await getSeedTeams()
  const teamsById = new Map()

  seedTeams.forEach((team) => {
    teamsById.set(normalizeIdentifier(team.teamId), {
      abbreviation: normalizeIdentifier(team.abbreviation),
      teamId: normalizeIdentifier(team.teamId),
      teamName: team.teamName,
    })
  })

  return {
    seedTeams,
    teamsById,
  }
}

const getRatingValue = (ratingDocument, field) =>
  toOptionalFiniteNumber(ratingDocument?.[field])

const getCurrentPowerRatingDocuments = async (userId) =>
  PowerRating.find({ userId }).sort({ teamName: 1 })

const buildCurrentRatingState = async ({
  currentRatingsProvider = getCurrentPowerRatingDocuments,
  seedTeams,
  userId,
  warnings,
}) => {
  const currentRatings = await currentRatingsProvider(userId)
  const ratingsByIdentifier = new Map()

  ;(Array.isArray(currentRatings) ? currentRatings : []).forEach((rating) => {
    const teamId = normalizeIdentifier(rating.teamId)
    const abbreviation = normalizeIdentifier(rating.abbreviation)

    if (teamId) {
      ratingsByIdentifier.set(teamId, rating)
    }

    if (abbreviation) {
      ratingsByIdentifier.set(abbreviation, rating)
    }
  })

  const missingTeamIds = []
  const invalidTeamIds = []
  const ratingState = new Map()

  seedTeams.forEach((team) => {
    const teamId = normalizeIdentifier(team.teamId)
    const currentRating = ratingsByIdentifier.get(teamId)
    const currentBaseRating = getRatingValue(currentRating, 'baseRating')
    const currentHomeAdvantage = getRatingValue(currentRating, 'homeAdvantage')
    const hasRating = Boolean(currentRating)
    const startingRating = hasRating
      ? (currentBaseRating ?? DEFAULT_BASE_RATING)
      : DEFAULT_BASE_RATING
    const homeAdvantage = hasRating
      ? (currentHomeAdvantage ?? DEFAULT_REPLAY_HOME_ADVANTAGE)
      : DEFAULT_REPLAY_HOME_ADVANTAGE

    if (!hasRating) {
      missingTeamIds.push(teamId)
    } else if (
      currentBaseRating === null ||
      currentHomeAdvantage === null
    ) {
      invalidTeamIds.push(teamId)
    }

    ratingState.set(teamId, {
      abbreviation: normalizeIdentifier(team.abbreviation),
      finalRating: startingRating,
      gamesProcessed: 0,
      homeAdvantage,
      startingRating,
      teamId,
      teamName: team.teamName,
    })
  })

  if (missingTeamIds.length > 0) {
    warnings.push({
      code: 'MISSING_CURRENT_RATINGS',
      message:
        'Some current Power Ratings were missing and were initialized in memory only.',
      teamIds: missingTeamIds,
    })
  }

  if (invalidTeamIds.length > 0) {
    warnings.push({
      code: 'INVALID_CURRENT_RATINGS',
      message:
        'Some current Power Ratings had invalid numeric fields and were initialized in memory only.',
      teamIds: invalidTeamIds,
    })
  }

  return ratingState
}

const buildEqualRatingState = ({ seedTeams }) =>
  seedTeams.reduce((ratingState, team) => {
    const teamId = normalizeIdentifier(team.teamId)

    ratingState.set(teamId, {
      abbreviation: normalizeIdentifier(team.abbreviation),
      finalRating: DEFAULT_BASE_RATING,
      gamesProcessed: 0,
      homeAdvantage: DEFAULT_REPLAY_HOME_ADVANTAGE,
      startingRating: DEFAULT_BASE_RATING,
      teamId,
      teamName: team.teamName,
    })

    return ratingState
  }, new Map())

const buildInitialRatingState = async ({
  currentRatingsProvider,
  seedTeams,
  startingMode,
  userId,
  warnings,
}) => {
  if (startingMode === STARTING_MODES.EQUAL) {
    return buildEqualRatingState({ seedTeams })
  }

  return buildCurrentRatingState({
    currentRatingsProvider,
    seedTeams,
    userId,
    warnings,
  })
}

const buildTeamSnapshot = (team) => ({
  abbreviation: team?.abbreviation || null,
  teamId: team?.teamId || null,
  teamName: team?.teamName || null,
})

const getFinalScore = (game = {}) => ({
  away: toOptionalFiniteNumber(game.awayTeam?.score),
  home: toOptionalFiniteNumber(game.homeTeam?.score),
})

const buildSkippedGameAudit = ({
  awayTeam,
  details = {},
  game,
  homeTeam,
  reason,
}) => ({
  awayTeam: awayTeam
    ? buildTeamSnapshot(awayTeam)
    : getTeamSnapshotFromApi(game?.awayTeam),
  details,
  gameDate: getGameStart(game),
  gameId: getGameId(game),
  homeTeam: homeTeam
    ? buildTeamSnapshot(homeTeam)
    : getTeamSnapshotFromApi(game?.homeTeam),
  reason,
})

const incrementSkipReason = (skipReasons, reason) => {
  skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
}

const compareGamesChronologically = (gameA, gameB) => {
  const timestampA = getGameStartTimestamp(gameA) ?? Number.POSITIVE_INFINITY
  const timestampB = getGameStartTimestamp(gameB) ?? Number.POSITIVE_INFINITY
  const timeDifference = timestampA - timestampB

  if (timeDifference !== 0) {
    return timeDifference
  }

  const gameIdDifference = String(getGameId(gameA) ?? '').localeCompare(
    String(getGameId(gameB) ?? ''),
  )

  if (gameIdDifference !== 0) {
    return gameIdDifference
  }

  return (gameA.__replaySourceIndex ?? 0) - (gameB.__replaySourceIndex ?? 0)
}

const serializeTeamResults = (ratingState) =>
  [...ratingState.values()]
    .map((team) => ({
      abbreviation: team.abbreviation,
      finalRating: team.finalRating,
      gamesProcessed: team.gamesProcessed,
      netChange: team.finalRating - team.startingRating,
      startingRating: team.startingRating,
      teamId: team.teamId,
      teamName: team.teamName,
    }))
    .sort((teamA, teamB) => {
      const ratingDifference = teamB.finalRating - teamA.finalRating

      if (ratingDifference !== 0) {
        return ratingDifference
      }

      return teamA.teamName.localeCompare(teamB.teamName)
    })

const roundSummaryNumber = (value) =>
  Number.isFinite(value)
    ? Number(value.toFixed(SUMMARY_PRECISION_DECIMALS))
    : null

const calculateTeamRatingSummary = (teamResults) => {
  const teams = Array.isArray(teamResults) ? teamResults : []
  const ratings = teams
    .map((team) => toOptionalFiniteNumber(team.finalRating))
    .filter(Number.isFinite)

  if (ratings.length === 0) {
    return {
      averageRating: null,
      highestRatedTeam: null,
      highestRating: null,
      lowestRatedTeam: null,
      lowestRating: null,
      medianRating: null,
      ratingRange: null,
      standardDeviation: null,
      teamsRanked: 0,
    }
  }

  const average = ratings.reduce((total, value) => total + value, 0) / ratings.length
  const sortedRatings = [...ratings].sort((ratingA, ratingB) => ratingA - ratingB)
  const middleIndex = Math.floor(sortedRatings.length / 2)
  const median =
    sortedRatings.length % 2 === 0
      ? (sortedRatings[middleIndex - 1] + sortedRatings[middleIndex]) / 2
      : sortedRatings[middleIndex]
  const variance =
    ratings.reduce((total, rating) => total + (rating - average) ** 2, 0) /
    ratings.length
  const highestTeam = teams.reduce((highest, team) =>
    team.finalRating > highest.finalRating ? team : highest,
  )
  const lowestTeam = teams.reduce((lowest, team) =>
    team.finalRating < lowest.finalRating ? team : lowest,
  )
  const highestRating = highestTeam.finalRating
  const lowestRating = lowestTeam.finalRating

  return {
    averageRating: roundSummaryNumber(average),
    highestRatedTeam: {
      abbreviation: highestTeam.abbreviation,
      rating: roundSummaryNumber(highestRating),
      teamId: highestTeam.teamId,
    },
    highestRating: roundSummaryNumber(highestRating),
    lowestRatedTeam: {
      abbreviation: lowestTeam.abbreviation,
      rating: roundSummaryNumber(lowestRating),
      teamId: lowestTeam.teamId,
    },
    lowestRating: roundSummaryNumber(lowestRating),
    medianRating: roundSummaryNumber(median),
    ratingRange: roundSummaryNumber(highestRating - lowestRating),
    standardDeviation: roundSummaryNumber(Math.sqrt(variance)),
    teamsRanked: ratings.length,
  }
}

const buildResultSkipDetails = (game, classification) => ({
  awayScore: getFinalScore(game).away,
  gameOutcomeLastPeriodType: game?.gameOutcome?.lastPeriodType ?? null,
  homeScore: getFinalScore(game).home,
  periodDescriptorPeriodType: game?.periodDescriptor?.periodType ?? null,
  sourceCode: classification.warning?.code ?? null,
})

const getResultSkipReason = (classification) => {
  if (classification.warning?.code === 'GAME_NOT_FINAL') {
    return SKIP_REASONS.NOT_COMPLETED
  }

  if (
    classification.warning?.code === 'MISSING_FINAL_SCORE' ||
    classification.warning?.code === 'TIED_FINAL_SCORE'
  ) {
    return SKIP_REASONS.MALFORMED_GAME
  }

  return SKIP_REASONS.UNRESOLVED_RESULT_TYPE
}

const processReplayGame = ({
  awayTeam,
  configuration,
  game,
  homeTeam,
  ratingState,
}) => {
  const homeRatingState = ratingState.get(homeTeam.teamId)
  const awayRatingState = ratingState.get(awayTeam.teamId)
  const homeRatingBefore = homeRatingState.finalRating
  const awayRatingBefore = awayRatingState.finalRating
  const homeAdvantageUsed = homeRatingState.homeAdvantage
  const pregameProbability = calculatePregameProbability({
    awayRating: awayRatingBefore,
    automaticAdjustments: {},
    homeAdvantage: homeAdvantageUsed,
    homeRating: homeRatingBefore,
  })
  const classification = classifyCompletedGameResult(game)

  if (!classification.isResolved) {
    const reason = getResultSkipReason(classification)

    return {
      processed: false,
      skippedGame: buildSkippedGameAudit({
        awayTeam,
        details: buildResultSkipDetails(game, classification),
        game,
        homeTeam,
        reason,
      }),
    }
  }

  const ratingUpdate = calculateRatingUpdate({
    awayExpectedProbability: pregameProbability.awayProbability,
    configuration,
    homeExpectedProbability: pregameProbability.homeProbability,
    resultType: classification.resultType,
    winner: classification.winner,
  })
  const homeRatingAfter = homeRatingBefore + ratingUpdate.homeDelta
  const awayRatingAfter = awayRatingBefore + ratingUpdate.awayDelta

  homeRatingState.finalRating = homeRatingAfter
  awayRatingState.finalRating = awayRatingAfter
  homeRatingState.gamesProcessed += 1
  awayRatingState.gamesProcessed += 1

  return {
    gameResult: {
      awayDelta: ratingUpdate.awayDelta,
      awayExpectedProbability: pregameProbability.awayProbability,
      awayRatingAfter,
      awayRatingBefore,
      awayTeam: buildTeamSnapshot(awayTeam),
      finalScore: classification.finalScore,
      gameDate: getGameStart(game),
      gameId: getGameId(game),
      homeAdvantageUsed,
      homeDelta: ratingUpdate.homeDelta,
      homeExpectedProbability: pregameProbability.homeProbability,
      homeRatingAfter,
      homeRatingBefore,
      homeTeam: buildTeamSnapshot(homeTeam),
      resultMultiplier: ratingUpdate.resultMultiplier,
      resultType: classification.resultType,
      winner: classification.winner,
    },
    processed: true,
  }
}

const buildReplayResponse = ({
  configuration,
  dateFrom,
  dateTo,
  gameResults,
  gameTypes,
  gamesEligible,
  gamesFetched,
  gamesProcessed,
  responseControls,
  skippedGames,
  skipReasons,
  startingMode,
  teamResults,
  warnings,
}) => {
  const summary = {
    gamesEligible,
    gamesFetched,
    gamesProcessed,
    gamesSkipped: skippedGames.length,
    ...calculateTeamRatingSummary(teamResults),
  }
  const response = {
    modelVersion: configuration.modelVersion,
    configuration,
    filters: {
      dateFrom,
      dateTo,
      gameTypes,
      startingMode,
    },
    summary,
    skipReasons,
    teamResults,
    gameResultsIncluded: responseControls.includeGameResults,
  }

  if (responseControls.includeGameResults) {
    response.gameResults = gameResults
  }

  response.skippedGamesIncluded = responseControls.includeSkippedGames

  if (responseControls.includeSkippedGames) {
    response.skippedGames = skippedGames
  }

  response.warnings = warnings

  return response
}

const replayHistoricalPowerRatings = async ({
  configuration = DEFAULT_RATING_ENGINE_CONFIGURATION,
  currentRatingsProvider,
  dateFrom,
  dateFromTimestamp,
  dateTo,
  dateToTimestamp,
  gamesProvider = fetchNhlScheduleGames,
  gameTypes = DEFAULT_REPLAY_GAME_TYPE_FILTERS,
  includeGameResults = RESPONSE_CONTROL_DEFAULTS.includeGameResults,
  includeSkippedGames = RESPONSE_CONTROL_DEFAULTS.includeSkippedGames,
  startingMode,
  userId,
}) => {
  if (!userId) {
    throw new PowerRatingSimulationError('Authenticated userId is required.', 401)
  }

  const normalizedDates = normalizeReplayDates({
    dateFrom,
    dateFromTimestamp,
    dateTo,
    dateToTimestamp,
  })
  const warnings = []
  const normalizedConfiguration = createRatingEngineConfiguration(configuration)
  const normalizedGameTypes = normalizeGameTypeFilters(gameTypes)
  const responseControls = {
    includeGameResults: validateBoolean(
      includeGameResults,
      'includeGameResults',
      RESPONSE_CONTROL_DEFAULTS.includeGameResults,
    ),
    includeSkippedGames: validateBoolean(
      includeSkippedGames,
      'includeSkippedGames',
      RESPONSE_CONTROL_DEFAULTS.includeSkippedGames,
    ),
  }
  const normalizedStartingMode = normalizeStartingMode(startingMode)
  const { seedTeams, teamsById } = await buildTeamDirectory()
  const ratingState = await buildInitialRatingState({
    currentRatingsProvider,
    seedTeams,
    startingMode: normalizedStartingMode,
    userId,
    warnings,
  })
  const fetchedGames = await gamesProvider(normalizedDates)
  const uniqueGames = deduplicateGamesById(fetchedGames).sort(
    compareGamesChronologically,
  )
  const gameResults = []
  const skippedGames = []
  const skipReasons = {}
  let gamesEligible = 0
  let gamesProcessed = 0

  uniqueGames.forEach((game) => {
    const eligibility = classifyGameEligibility(game, {
      dateFrom: normalizedDates.dateFrom,
      dateFromTimestamp: normalizedDates.dateFromTimestamp,
      dateTo: normalizedDates.dateTo,
      dateToTimestamp: normalizedDates.dateToTimestamp,
      gameTypes: normalizedGameTypes,
      teamsById,
    })

    if (!eligibility.eligible) {
      const skippedGame = buildSkippedGameAudit({
        details: eligibility.details,
        game,
        reason: eligibility.reason,
      })

      skippedGames.push(skippedGame)
      incrementSkipReason(skipReasons, eligibility.reason)
      return
    }

    gamesEligible += 1

    const result = processReplayGame({
      awayTeam: eligibility.awayTeam,
      configuration: normalizedConfiguration,
      game,
      homeTeam: eligibility.homeTeam,
      ratingState,
    })

    if (result.processed) {
      gamesProcessed += 1
      gameResults.push(result.gameResult)
      return
    }

    skippedGames.push(result.skippedGame)
    incrementSkipReason(skipReasons, result.skippedGame.reason)
  })

  const teamResults = serializeTeamResults(ratingState)

  return buildReplayResponse({
    configuration: normalizedConfiguration,
    dateFrom: normalizedDates.dateFrom,
    dateTo: normalizedDates.dateTo,
    gameResults,
    gameTypes: normalizedGameTypes,
    gamesEligible,
    gamesFetched: uniqueGames.length,
    gamesProcessed,
    responseControls,
    skippedGames,
    skipReasons,
    startingMode: normalizedStartingMode,
    teamResults,
    warnings,
  })
}

const previewPowerRatingSimulation = async (userId, payload) => {
  const normalizedInput = normalizePreviewInput(payload)

  return replayHistoricalPowerRatings({
    configuration: normalizedInput.configuration,
    dateFrom: normalizedInput.dateFrom,
    dateFromTimestamp: normalizedInput.dateFromTimestamp,
    dateTo: normalizedInput.dateTo,
    dateToTimestamp: normalizedInput.dateToTimestamp,
    gameTypes: normalizedInput.gameTypes,
    includeGameResults: normalizedInput.responseControls.includeGameResults,
    includeSkippedGames: normalizedInput.responseControls.includeSkippedGames,
    startingMode: normalizedInput.startingMode,
    userId,
  })
}

module.exports = {
  MAX_REPLAY_DATE_RANGE_DAYS,
  PowerRatingSimulationError,
  RESPONSE_CONTROL_DEFAULTS,
  STARTING_MODES,
  calculateTeamRatingSummary,
  deduplicateGamesById,
  fetchCompletedNhlGames: fetchNhlScheduleGames,
  fetchNhlScheduleGames,
  normalizeGameTypeFilters,
  normalizePreviewInput,
  previewPowerRatingSimulation,
  replayHistoricalPowerRatings,
}
