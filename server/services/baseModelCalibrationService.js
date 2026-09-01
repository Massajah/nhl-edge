const { randomUUID } = require('node:crypto')
const PowerRating = require('../models/PowerRating')
const nhlApiService = require('./nhlApiService')
const historicalNhlDataService = require('./historicalNhlDataService')
const nhlSeasonService = require('./nhlSeasonService')
const { getSeedTeams } = require('./powerRatingsService')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const {
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
  classifyCompletedGameResult,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')
const {
  getProductionRatingEngineSettings,
} = require('./ratingEngineSettingsService')
const {
  NHL_GAME_TYPE_CODES,
  SKIP_REASONS,
  classifyGameEligibility,
  getGameId,
  getGameStart,
  getGameStartTimestamp,
} = require('./nhlGameEligibility')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const {
  STARTING_STATE_POLICIES,
  createStartingStateIdentity,
} = require('../calibration/calibrationIdentity')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SEASON_PATTERN = /^\d{8}$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CALIBRATION_DATE_RANGE_DAYS = 370
const LOG_LOSS_EPSILON = 1e-15
const STARTING_MODES = Object.freeze({
  CURRENT: 'current',
  FIXED_SPREAD: 'fixed_spread',
})
const STARTING_ORDERING_MODES = Object.freeze({
  ALPHABETICAL: 'historical_fallback',
  CURRENT_RATINGS: 'current_ratings',
})
const STARTING_ORDERING_SOURCES = Object.freeze({
  ALPHABETICAL: 'seed_team_name_alphabetical',
  CURRENT_RATING_ORDER: 'current production baseRating descending',
  CURRENT_RATING_VALUES: 'current production baseRating values',
})
const DEFAULT_FIXED_CENTER = BASE_MODEL_V1.startingRatings.center
const DEFAULT_FIXED_SPREAD = BASE_MODEL_V1.startingRatings.spread
const EXPECTED_FULL_SEASON_GAMES = 1312
const MINIMUM_FULL_SEASON_GAMES = 1250
const HOME_PROBABILITY_BUCKETS = Object.freeze([
  [0, 0.4],
  [0.4, 0.45],
  [0.45, 0.5],
  [0.5, 0.55],
  [0.55, 0.6],
  [0.6, 0.65],
  [0.65, 0.7],
  [0.7, 0.75],
  [0.75, 0.8],
  [0.8, 1],
])
const CONFIDENCE_BUCKETS = Object.freeze([
  [0.5, 0.55],
  [0.55, 0.6],
  [0.6, 0.65],
  [0.65, 0.7],
  [0.7, 0.75],
  [0.75, 0.8],
  [0.8, 1],
])
const SUPPORTED_INPUT_FIELDS = new Set([
  'configuration',
  'dateFrom',
  'dateTo',
  'homeAdvantage',
  'label',
  'probabilityScale',
  'seasonId',
  'seasonIds',
  'startingRatings',
  'useCustomDateRange',
])

class BaseModelCalibrationError extends Error {
  constructor(message, statusCode = 500, details = undefined, errorCode = null) {
    super(message)
    this.name = 'BaseModelCalibrationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
    this.errorCode = errorCode
  }
}

const logCalibrationDiagnostic = (logger, event, details) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NHL_EDGE_CALIBRATION_DEBUG !== 'true'
  ) {
    return
  }

  logger.debug?.(`Base Model Calibration: ${event}`, details)
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const round = (value, decimals = 8) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const parseDate = (value, field) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new BaseModelCalibrationError(
      `${field} must use YYYY-MM-DD format.`,
      400,
      { field },
    )
  }

  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BaseModelCalibrationError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return { date: value, timestamp }
}

const normalizeNumber = (value, field, { max, min, minExclusive = false }) => {
  if (value === null || value === '' || !Number.isFinite(Number(value))) {
    throw new BaseModelCalibrationError(`${field} must be a finite number.`, 400, {
      field,
    })
  }

  const numberValue = Number(value)
  const belowMinimum = minExclusive ? numberValue <= min : numberValue < min

  if (belowMinimum || numberValue > max) {
    const minimumLabel = minExclusive ? `greater than ${min}` : `at least ${min}`

    throw new BaseModelCalibrationError(
      `${field} must be ${minimumLabel} and no more than ${max}.`,
      400,
      { field },
    )
  }

  return numberValue
}

const validateDateRange = (dateFrom, dateTo) => {
  if (dateFrom.timestamp > dateTo.timestamp) {
    throw new BaseModelCalibrationError(
      'dateFrom must be on or before dateTo.',
      400,
      { dateFrom: dateFrom.date, dateTo: dateTo.date },
    )
  }

  const dateRangeDays =
    Math.floor((dateTo.timestamp - dateFrom.timestamp) / DAY_MS) + 1

  if (dateRangeDays > MAX_CALIBRATION_DATE_RANGE_DAYS) {
    throw new BaseModelCalibrationError(
      `Calibration date range cannot exceed ${MAX_CALIBRATION_DATE_RANGE_DAYS} days.`,
      400,
      { dateRangeDays, maxDateRangeDays: MAX_CALIBRATION_DATE_RANGE_DAYS },
    )
  }
}

const normalizeCommonCalibrationInput = (payload) => {
  if (!isPlainObject(payload)) {
    throw new BaseModelCalibrationError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => !SUPPORTED_INPUT_FIELDS.has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new BaseModelCalibrationError(
      'Request body contains unsupported calibration fields.',
      400,
      { unsupportedFields },
    )
  }

  const startingRatings = payload.startingRatings

  if (!isPlainObject(startingRatings)) {
    throw new BaseModelCalibrationError(
      'startingRatings must be an object.',
      400,
      { field: 'startingRatings' },
    )
  }

  const unsupportedStartingFields = Object.keys(startingRatings).filter(
    (field) => !['center', 'mode', 'spread'].includes(field),
  )

  if (unsupportedStartingFields.length > 0) {
    throw new BaseModelCalibrationError(
      'startingRatings contains unsupported fields.',
      400,
      { unsupportedFields: unsupportedStartingFields },
    )
  }

  const startingMode = startingRatings.mode ?? STARTING_MODES.CURRENT

  if (!Object.values(STARTING_MODES).includes(startingMode)) {
    throw new BaseModelCalibrationError(
      'startingRatings.mode must be current or fixed_spread.',
      400,
      { field: 'startingRatings.mode' },
    )
  }

  const label = String(payload.label ?? '').trim()

  if (label.length > 80) {
    throw new BaseModelCalibrationError(
      'label cannot exceed 80 characters.',
      400,
      { field: 'label' },
    )
  }

  if (payload.configuration !== undefined && !isPlainObject(payload.configuration)) {
    throw new BaseModelCalibrationError(
      'configuration must be an object.',
      400,
      { field: 'configuration' },
    )
  }

  const configurationInput = payload.configuration ?? {}
  const unsupportedConfigurationFields = Object.keys(configurationInput).filter(
    (field) =>
      ![
        'kFactor',
        'overtimeMultiplier',
        'regulationMultiplier',
        'shootoutMultiplier',
      ].includes(field),
  )

  if (unsupportedConfigurationFields.length > 0) {
    throw new BaseModelCalibrationError(
      'configuration contains unsupported fields.',
      400,
      { unsupportedFields: unsupportedConfigurationFields },
    )
  }

  const configuration = createRatingEngineConfiguration({
    kFactor: normalizeNumber(
      configurationInput.kFactor ?? BASE_MODEL_V1.kFactor,
      'configuration.kFactor',
      { min: 0, max: 10, minExclusive: true },
    ),
    overtimeMultiplier: normalizeNumber(
      configurationInput.overtimeMultiplier ?? BASE_MODEL_V1.overtimeMultiplier,
      'configuration.overtimeMultiplier',
      { min: 0, max: 2 },
    ),
    regulationMultiplier: normalizeNumber(
      configurationInput.regulationMultiplier ??
        BASE_MODEL_V1.regulationMultiplier,
      'configuration.regulationMultiplier',
      { min: 0, max: 2 },
    ),
    shootoutMultiplier: normalizeNumber(
      configurationInput.shootoutMultiplier ?? BASE_MODEL_V1.shootoutMultiplier,
      'configuration.shootoutMultiplier',
      { min: 0, max: 2 },
    ),
  })

  return {
    configuration,
    homeAdvantage: normalizeNumber(
      payload.homeAdvantage ?? BASE_MODEL_V1.baseHomeAdvantage,
      'homeAdvantage',
      { min: 0, max: 15 },
    ),
    label,
    probabilityScale: normalizeNumber(
      payload.probabilityScale ?? BASE_MODEL_V1.probabilityScale,
      'probabilityScale',
      { min: 0, max: 50, minExclusive: true },
    ),
    startingRatings: {
      center: normalizeNumber(
        startingRatings.center ?? DEFAULT_FIXED_CENTER,
        'startingRatings.center',
        { min: -1000, max: 1000 },
      ),
      mode: startingMode,
      spread: normalizeNumber(
        startingRatings.spread ?? DEFAULT_FIXED_SPREAD,
        'startingRatings.spread',
        { min: 0, max: 100, minExclusive: true },
      ),
    },
  }
}

const normalizeCalibrationInput = (payload) => {
  const common = normalizeCommonCalibrationInput(payload)
  const dateFrom = parseDate(payload.dateFrom, 'dateFrom')
  const dateTo = parseDate(payload.dateTo, 'dateTo')
  validateDateRange(dateFrom, dateTo)
  const seasonId = normalizeSeasonId(payload.seasonId)

  if (!SEASON_PATTERN.test(seasonId)) {
    throw new BaseModelCalibrationError(
      'seasonId must use the NHL YYYYyyyy format.',
      400,
      { field: 'seasonId' },
    )
  }

  return {
    ...common,
    dateFrom: dateFrom.date,
    dateFromTimestamp: dateFrom.timestamp,
    dateTo: dateTo.date,
    dateToTimestamp: dateTo.timestamp,
    seasonId,
  }
}

const getCompletedHistoricalSeasons = (seasonMetadata, today) =>
  (seasonMetadata?.seasons ?? []).filter((season) => season.endDate < today)

const normalizeSeasonSelections = (payload, seasonMetadata, today) => {
  const availableSeasons = getCompletedHistoricalSeasons(seasonMetadata, today)
  const availableById = new Map(
    availableSeasons.map((season) => [normalizeSeasonId(season.id), season]),
  )
  const isMultiSeasonRequest = Array.isArray(payload.seasonIds)

  if (isMultiSeasonRequest && payload.seasonId !== undefined) {
    throw new BaseModelCalibrationError(
      'Provide seasonIds or seasonId, not both.',
      400,
      { field: 'seasonIds' },
    )
  }

  const requestedIds = isMultiSeasonRequest
    ? payload.seasonIds.map(normalizeSeasonId)
    : [normalizeSeasonId(payload.seasonId)]

  if (requestedIds.length === 0) {
    throw new BaseModelCalibrationError(
      'Select at least one historical season.',
      400,
      { field: 'seasonIds' },
    )
  }

  if (requestedIds.some((seasonId) => !SEASON_PATTERN.test(seasonId))) {
    throw new BaseModelCalibrationError(
      'Every seasonId must use the NHL YYYYyyyy format.',
      400,
      { field: isMultiSeasonRequest ? 'seasonIds' : 'seasonId' },
    )
  }

  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new BaseModelCalibrationError(
      'Historical seasons cannot be selected more than once.',
      400,
      { field: 'seasonIds' },
    )
  }

  const unsupportedIds = requestedIds.filter((seasonId) => !availableById.has(seasonId))

  if (unsupportedIds.length > 0) {
    throw new BaseModelCalibrationError(
      isMultiSeasonRequest
        ? 'One or more seasons are not available as completed historical seasons.'
        : 'seasonId is not available in the supported historical season list.',
      400,
      { field: 'seasonIds', unsupportedSeasonIds: unsupportedIds },
    )
  }

  if (
    payload.useCustomDateRange !== undefined &&
    typeof payload.useCustomDateRange !== 'boolean'
  ) {
    throw new BaseModelCalibrationError(
      'useCustomDateRange must be a boolean.',
      400,
      { field: 'useCustomDateRange' },
    )
  }

  const useCustomDateRange = isMultiSeasonRequest
    ? payload.useCustomDateRange === true
    : true

  if (
    isMultiSeasonRequest &&
    !useCustomDateRange &&
    (payload.dateFrom !== undefined || payload.dateTo !== undefined)
  ) {
    throw new BaseModelCalibrationError(
      'dateFrom and dateTo are only accepted when useCustomDateRange is enabled.',
      400,
      { field: 'useCustomDateRange' },
    )
  }

  if (useCustomDateRange && requestedIds.length !== 1) {
    throw new BaseModelCalibrationError(
      'A custom date range can only be used with one historical season.',
      400,
      { field: 'useCustomDateRange' },
    )
  }

  return requestedIds.map((seasonId) => {
    const season = availableById.get(seasonId)
    const dateFrom = parseDate(
      useCustomDateRange ? payload.dateFrom : season.startDate,
      'dateFrom',
    )
    const dateTo = parseDate(
      useCustomDateRange ? payload.dateTo : season.endDate,
      'dateTo',
    )
    validateDateRange(dateFrom, dateTo)

    if (dateFrom.date < season.startDate || dateTo.date > season.endDate) {
      throw new BaseModelCalibrationError(
        'Calibration dates must stay within the selected regular season.',
        400,
        {
          field: 'dateRange',
          seasonEndDate: season.endDate,
          seasonStartDate: season.startDate,
        },
      )
    }

    return {
      ...season,
      dateFrom: dateFrom.date,
      dateFromTimestamp: dateFrom.timestamp,
      dateTo: dateTo.date,
      dateToTimestamp: dateTo.timestamp,
      id: seasonId,
      metadataSource: season.metadataSource ?? seasonMetadata.metadataSource,
    }
  })
}

const validateSelectedSeason = (input, seasonMetadata) => {
  const season = seasonMetadata?.seasons?.find(
    (candidate) => candidate.id === input.seasonId,
  )

  if (!season) {
    throw new BaseModelCalibrationError(
      'seasonId is not available in the supported historical season list.',
      400,
      { field: 'seasonId' },
    )
  }

  if (input.dateFrom < season.startDate || input.dateTo > season.endDate) {
    throw new BaseModelCalibrationError(
      'Calibration dates must stay within the selected regular season.',
      400,
      {
        field: 'dateRange',
        seasonEndDate: season.endDate,
        seasonStartDate: season.startDate,
      },
    )
  }

  return season
}

const compareGamesChronologically = (left, right) => {
  const timeDifference =
    (getGameStartTimestamp(left) ?? Number.POSITIVE_INFINITY) -
    (getGameStartTimestamp(right) ?? Number.POSITIVE_INFINITY)

  if (timeDifference !== 0) {
    return timeDifference
  }

  return String(getGameId(left) ?? '').localeCompare(String(getGameId(right) ?? ''))
}

const deduplicateGames = (games) => {
  const gamesById = new Map()
  const gamesWithoutIds = []

  ;(Array.isArray(games) ? games : []).forEach((game) => {
    const gameId = getGameId(game)

    if (gameId === null || gameId === undefined || gameId === '') {
      gamesWithoutIds.push(game)
      return
    }

    if (!gamesById.has(String(gameId))) {
      gamesById.set(String(gameId), game)
    }
  })

  return [...gamesById.values(), ...gamesWithoutIds].sort(
    compareGamesChronologically,
  )
}

const buildTeamDirectory = async (teamsProvider = getSeedTeams) => {
  const teams = await teamsProvider()
  const teamsById = new Map()

  teams.forEach((team) => {
    const normalizedTeam = {
      abbreviation: normalizeIdentifier(team.abbreviation),
      teamId: normalizeIdentifier(team.teamId ?? team.id),
      teamName: team.teamName ?? team.name,
    }

    teamsById.set(normalizedTeam.teamId, normalizedTeam)
    teamsById.set(normalizedTeam.abbreviation, normalizedTeam)
  })

  return { teams, teamsById }
}

const incrementReason = (reasons, reason) => {
  reasons[reason] = (reasons[reason] ?? 0) + 1
}

const prepareDataset = ({ games, input, teamsById }) => {
  const uniqueGames = deduplicateGames(games)
  const includedGames = []
  const skippedGames = []
  const skipReasons = {}
  const gameTypes = {
    playoffs: false,
    preseason: false,
    regularSeason: true,
  }

  uniqueGames.forEach((game) => {
    const eligibility = classifyGameEligibility(game, {
      dateFrom: input.dateFrom,
      dateFromTimestamp: input.dateFromTimestamp,
      dateTo: input.dateTo,
      dateToTimestamp: input.dateToTimestamp,
      gameTypes,
      teamsById,
    })

    if (!eligibility.eligible) {
      incrementReason(skipReasons, eligibility.reason)
      skippedGames.push({
        gameDate: getGameStart(game),
        gameId: getGameId(game),
        reason: eligibility.reason,
      })
      return
    }

    const classification = classifyCompletedGameResult(game)

    if (!classification.isResolved) {
      const reason =
        classification.warning?.code === 'GAME_NOT_FINAL'
          ? SKIP_REASONS.NOT_COMPLETED
          : classification.warning?.code === 'UNRESOLVED_RESULT_TYPE'
            ? SKIP_REASONS.UNRESOLVED_RESULT_TYPE
            : SKIP_REASONS.MALFORMED_GAME

      incrementReason(skipReasons, reason)
      skippedGames.push({
        gameDate: getGameStart(game),
        gameId: getGameId(game),
        reason,
        sourceCode: classification.warning?.code ?? null,
      })
      return
    }

    includedGames.push({
      awayTeam: eligibility.awayTeam,
      game,
      homeTeam: eligibility.homeTeam,
      resultType: classification.resultType,
      winner: classification.winner,
    })
  })

  return {
    includedGames,
    skippedGames,
    skipReasons,
    summary: {
      gamesFound: uniqueGames.length,
      gamesIncluded: includedGames.length,
      gamesSkipped: skippedGames.length,
    },
  }
}

const normalizeCurrentRatings = (documents) => {
  const ratingsByIdentifier = new Map()

  ;(Array.isArray(documents) ? documents : []).forEach((document) => {
    const teamId = normalizeIdentifier(document.teamId)
    const abbreviation = normalizeIdentifier(document.abbreviation)

    if (teamId) {
      ratingsByIdentifier.set(teamId, document)
    }

    if (abbreviation) {
      ratingsByIdentifier.set(abbreviation, document)
    }
  })

  return ratingsByIdentifier
}

const formatStartingRating = (value) =>
  Number.isInteger(value) ? String(value) : String(round(value, 2))

const getFixedSpreadLabel = (startingRatings, orderingLabel) => {
  const minimum = startingRatings.center - startingRatings.spread / 2
  const maximum = startingRatings.center + startingRatings.spread / 2

  return `Fixed ${formatStartingRating(minimum)}–${formatStartingRating(
    maximum,
  )} · ${orderingLabel}`
}

const resolveStartingStatePolicy = ({
  isLatestHistoricalSeason,
  isMultiSeason,
  startingRatings,
}) => {
  if (startingRatings.mode === STARTING_MODES.CURRENT) {
    return {
      comparableToUnifiedMultiSeason: false,
      label: 'Current production ratings · Scenario only (non-comparable)',
      orderingMode: STARTING_ORDERING_MODES.CURRENT_RATINGS,
      orderingSource: STARTING_ORDERING_SOURCES.CURRENT_RATING_VALUES,
      policy: STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER,
      usesHistoricalOrderingFallback: false,
    }
  }

  if (isMultiSeason || !isLatestHistoricalSeason) {
    return {
      comparableToUnifiedMultiSeason: true,
      label: getFixedSpreadLabel(startingRatings, 'Alphabetical ordering'),
      orderingMode: STARTING_ORDERING_MODES.ALPHABETICAL,
      orderingSource: STARTING_ORDERING_SOURCES.ALPHABETICAL,
      policy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
      usesHistoricalOrderingFallback: !isMultiSeason,
    }
  }

  return {
    comparableToUnifiedMultiSeason: false,
    label: getFixedSpreadLabel(
      startingRatings,
      'Current production ordering · Scenario only (non-comparable)',
    ),
    orderingMode: STARTING_ORDERING_MODES.CURRENT_RATINGS,
    orderingSource: STARTING_ORDERING_SOURCES.CURRENT_RATING_ORDER,
    policy: STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER,
    usesHistoricalOrderingFallback: false,
  }
}

const buildStartingState = ({
  currentRatings,
  input,
  orderingMode = STARTING_ORDERING_MODES.CURRENT_RATINGS,
  teams,
}) => {
  const ratingsByIdentifier = normalizeCurrentRatings(currentRatings)
  const invalidTeamIds = []
  const rankedTeams = teams
    .map((team) => {
      const teamId = normalizeIdentifier(team.teamId ?? team.id)
      const currentRating = ratingsByIdentifier.get(teamId)
      const baseRating = Number(currentRating?.baseRating)

      if (!currentRating || !Number.isFinite(baseRating)) {
        invalidTeamIds.push(teamId)
      }

      return {
        abbreviation: normalizeIdentifier(team.abbreviation),
        baseRating,
        teamId,
        teamName: team.teamName ?? team.name,
      }
    })
    .sort((left, right) => {
      if (orderingMode === STARTING_ORDERING_MODES.ALPHABETICAL) {
        return (
          left.teamName.localeCompare(right.teamName) ||
          left.teamId.localeCompare(right.teamId)
        )
      }

      const difference = right.baseRating - left.baseRating

      return difference !== 0
        ? difference
        : left.teamName.localeCompare(right.teamName)
    })

  if (
    invalidTeamIds.length > 0 &&
    !(
      input.startingRatings.mode === STARTING_MODES.FIXED_SPREAD &&
      orderingMode === STARTING_ORDERING_MODES.ALPHABETICAL
    )
  ) {
    throw new BaseModelCalibrationError(
      'Calibration requires a complete set of finite current Power Ratings.',
      400,
      { field: 'startingRatings', teamIds: invalidTeamIds },
      'missing_starting_order',
    )
  }

  const state = new Map()
  const denominator = Math.max(1, rankedTeams.length - 1)

  rankedTeams.forEach((team, index) => {
    const fixedRating =
      input.startingRatings.center +
      input.startingRatings.spread / 2 -
      (input.startingRatings.spread * index) / denominator
    const startingRating =
      input.startingRatings.mode === STARTING_MODES.FIXED_SPREAD
        ? fixedRating
        : team.baseRating

    state.set(team.teamId, {
      ...team,
      finalRating: startingRating,
      gamesProcessed: 0,
      startingRating,
    })
  })

  return state
}

const cloneRatingState = (ratingState, offset = 0) =>
  [...ratingState.entries()].reduce((clone, [teamId, team]) => {
    clone.set(teamId, {
      ...team,
      finalRating: team.finalRating + offset,
      startingRating: team.startingRating + offset,
    })

    return clone
  }, new Map())

const replayDataset = ({ includedGames, input, ratingState }) => {
  const predictions = []

  includedGames.forEach(({ awayTeam, game, homeTeam, resultType, winner }) => {
    const home = ratingState.get(homeTeam.teamId)
    const away = ratingState.get(awayTeam.teamId)

    if (!home || !away) {
      throw new BaseModelCalibrationError(
        'An included game is missing a complete starting rating.',
        400,
        { gameId: getGameId(game) },
      )
    }

    const probability = calculatePregameProbability({
      awayRating: away.finalRating,
      automaticAdjustments: {},
      homeAdvantage: input.homeAdvantage,
      homeRating: home.finalRating,
      probabilityScale: input.probabilityScale,
    })
    const actualHomeWin = winner === WINNERS.HOME ? 1 : 0

    predictions.push({
      actualHomeWin,
      favoriteConfidence: Math.max(
        probability.homeProbability,
        probability.awayProbability,
      ),
      gameId: getGameId(game),
      homeProbability: probability.homeProbability,
      predictedCorrect:
        (probability.homeProbability >= 0.5 && actualHomeWin === 1) ||
        (probability.homeProbability < 0.5 && actualHomeWin === 0),
    })

    const update = calculateRatingUpdate({
      awayExpectedProbability: probability.awayProbability,
      configuration: input.configuration,
      homeExpectedProbability: probability.homeProbability,
      resultType,
      winner,
    })

    home.finalRating += update.homeDelta
    away.finalRating += update.awayDelta
    home.gamesProcessed += 1
    away.gamesProcessed += 1
  })

  return { predictions, ratingState }
}

const getMedian = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const buildBuckets = (predictions, ranges, probabilitySelector, outcomeSelector) =>
  ranges.map(([min, max], index) => {
    const isLast = index === ranges.length - 1
    const bucketPredictions = predictions.filter((prediction) => {
      const probability = probabilitySelector(prediction)

      return probability >= min && (isLast ? probability <= max : probability < max)
    })
    const count = bucketPredictions.length
    const averageProbability = count
      ? bucketPredictions.reduce(
          (total, prediction) => total + probabilitySelector(prediction),
          0,
        ) / count
      : null
    const actualRate = count
      ? bucketPredictions.reduce(
          (total, prediction) => total + Number(outcomeSelector(prediction)),
          0,
        ) / count
      : null

    return {
      actualRate: round(actualRate),
      averageProbability: round(averageProbability),
      count,
      gap:
        count > 0 ? round(Math.abs(averageProbability - actualRate)) : null,
      label: `${Math.round(min * 100)}–${Math.round(max * 100)}%`,
      max,
      min,
    }
  })

const calculateConstantProbabilityMetrics = (outcomes, probability) => {
  const clippedProbability = Math.min(
    1 - LOG_LOSS_EPSILON,
    Math.max(LOG_LOSS_EPSILON, probability),
  )
  const totals = outcomes.reduce(
    (result, outcome) => ({
      brier: result.brier + (probability - outcome) ** 2,
      logLoss:
        result.logLoss -
        (outcome * Math.log(clippedProbability) +
          (1 - outcome) * Math.log(1 - clippedProbability)),
    }),
    { brier: 0, logLoss: 0 },
  )

  return {
    brierScore: round(totals.brier / outcomes.length),
    logLoss: round(totals.logLoss / outcomes.length),
    probability: round(probability),
  }
}

const calculateSanityBaselines = (predictions) => {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new BaseModelCalibrationError(
      'Sanity baselines require at least one included game.',
      400,
      { field: 'dateRange' },
    )
  }

  const outcomes = predictions.map((prediction) => prediction.actualHomeWin)
  const historicalHomeWinRate =
    outcomes.reduce((total, outcome) => total + outcome, 0) / outcomes.length

  return {
    constant50: calculateConstantProbabilityMetrics(outcomes, 0.5),
    historicalHomeRate: calculateConstantProbabilityMetrics(
      outcomes,
      historicalHomeWinRate,
    ),
  }
}

const compareBrierScore = (score, baselineScore) => {
  if (Math.abs(score - baselineScore) <= 1e-12) {
    return 'equal'
  }

  return score < baselineScore ? 'better' : 'worse'
}

const buildBaselineComparison = (metrics, sanityBaselines) => ({
  constant50: compareBrierScore(
    metrics.brierScore,
    sanityBaselines.constant50.brierScore,
  ),
  historicalHomeRate: compareBrierScore(
    metrics.brierScore,
    sanityBaselines.historicalHomeRate.brierScore,
  ),
})

const calculateMetrics = (predictions) => {
  if (predictions.length === 0) {
    throw new BaseModelCalibrationError(
      'No completed regular-season games were eligible for calibration.',
      400,
      { field: 'dateRange' },
    )
  }

  let brierTotal = 0
  let logLossTotal = 0
  let clippedPredictions = 0
  let correctPredictions = 0
  let homeWins = 0
  let predictedHome = 0

  predictions.forEach((prediction) => {
    const probability = prediction.homeProbability
    const outcome = prediction.actualHomeWin
    const clippedProbability = Math.min(
      1 - LOG_LOSS_EPSILON,
      Math.max(LOG_LOSS_EPSILON, probability),
    )

    if (clippedProbability !== probability) {
      clippedPredictions += 1
    }

    brierTotal += (probability - outcome) ** 2
    logLossTotal +=
      -(outcome * Math.log(clippedProbability) +
        (1 - outcome) * Math.log(1 - clippedProbability))
    correctPredictions += Number(prediction.predictedCorrect)
    homeWins += outcome
    predictedHome += Number(probability >= 0.5)
  })

  const calibrationBuckets = buildBuckets(
    predictions,
    HOME_PROBABILITY_BUCKETS,
    (prediction) => prediction.homeProbability,
    (prediction) => prediction.actualHomeWin,
  )
  const confidenceBuckets = buildBuckets(
    predictions,
    CONFIDENCE_BUCKETS,
    (prediction) => prediction.favoriteConfidence,
    (prediction) => prediction.predictedCorrect,
  )
  const expectedCalibrationError = calibrationBuckets.reduce(
    (total, bucket) =>
      total + (bucket.count / predictions.length) * (bucket.gap ?? 0),
    0,
  )
  const probabilities = predictions.map((prediction) => prediction.homeProbability)
  const confidences = predictions.map((prediction) => prediction.favoriteConfidence)

  return {
    accuracy: {
      correct: correctPredictions,
      homeWinRate: round(homeWins / predictions.length),
      predictedHomeRate: round(predictedHome / predictions.length),
      rate: round(correctPredictions / predictions.length),
      total: predictions.length,
    },
    brierScore: round(brierTotal / predictions.length),
    calibrationBuckets,
    clippedPredictions,
    confidenceBuckets,
    expectedCalibrationError: round(expectedCalibrationError),
    logLoss: round(logLossTotal / predictions.length),
    predictionDistribution: {
      favoriteConfidenceAbove60Rate: round(
        confidences.filter((confidence) => confidence >= 0.6).length /
          predictions.length,
      ),
      favoriteConfidenceAbove65Rate: round(
        confidences.filter((confidence) => confidence >= 0.65).length /
          predictions.length,
      ),
      favoriteConfidenceAbove70Rate: round(
        confidences.filter((confidence) => confidence >= 0.7).length /
          predictions.length,
      ),
      favoriteConfidenceAbove75Rate: round(
        confidences.filter((confidence) => confidence >= 0.75).length /
          predictions.length,
      ),
      maximum: round(Math.max(...probabilities)),
      mean: round(
        probabilities.reduce((total, probability) => total + probability, 0) /
          probabilities.length,
      ),
      median: round(getMedian(probabilities)),
      minimum: round(Math.min(...probabilities)),
    },
  }
}

const serializeTeamResults = (ratingState) =>
  [...ratingState.values()]
    .map((team) => ({
      abbreviation: team.abbreviation,
      finalRating: round(team.finalRating, 6),
      gamesProcessed: team.gamesProcessed,
      netChange: round(team.finalRating - team.startingRating, 6),
      startingRating: round(team.startingRating, 6),
      teamId: team.teamId,
      teamName: team.teamName,
    }))
    .sort(
      (left, right) =>
        right.finalRating - left.finalRating ||
        left.teamName.localeCompare(right.teamName),
    )

const buildFinalRatingSummary = (teamResults) => {
  const ratings = teamResults.map((team) => team.finalRating)
  const average =
    ratings.reduce((total, rating) => total + rating, 0) / ratings.length
  const highest = teamResults[0]
  const lowest = teamResults.at(-1)

  return {
    average: round(average, 6),
    bottomTeams: teamResults.slice(-5).reverse(),
    highest: highest
      ? {
          abbreviation: highest.abbreviation,
          rating: highest.finalRating,
          teamId: highest.teamId,
          teamName: highest.teamName,
        }
      : null,
    lowest: lowest
      ? {
          abbreviation: lowest.abbreviation,
          rating: lowest.finalRating,
          teamId: lowest.teamId,
          teamName: lowest.teamName,
        }
      : null,
    spread: highest && lowest ? round(highest.finalRating - lowest.finalRating, 6) : null,
    topTeams: teamResults.slice(0, 5),
  }
}

const buildCenterInvarianceDiagnostic = ({ includedGames, input, startingState }) => {
  const offset = 100
  const baseline = replayDataset({
    includedGames,
    input,
    ratingState: cloneRatingState(startingState),
  })
  const shifted = replayDataset({
    includedGames,
    input,
    ratingState: cloneRatingState(startingState, offset),
  })
  const maximumProbabilityDifference = baseline.predictions.reduce(
    (maximum, prediction, index) =>
      Math.max(
        maximum,
        Math.abs(
          prediction.homeProbability -
            shifted.predictions[index].homeProbability,
        ),
      ),
    0,
  )
  const maximumFinalRatingOffsetError = [...baseline.ratingState.keys()].reduce(
    (maximum, teamId) =>
      Math.max(
        maximum,
        Math.abs(
          shifted.ratingState.get(teamId).finalRating -
            baseline.ratingState.get(teamId).finalRating -
            offset,
        ),
      ),
    0,
  )

  return {
    maximumFinalRatingOffsetError: round(maximumFinalRatingOffsetError, 12),
    maximumProbabilityDifference: round(maximumProbabilityDifference, 12),
    passed:
      maximumProbabilityDifference <= 1e-12 &&
      maximumFinalRatingOffsetError <= 1e-10,
    testedCenterOffset: offset,
  }
}

const buildWarnings = ({ baselineComparison, dataset, metrics }) => {
  const warnings = []

  if (dataset.summary.gamesIncluded < 100) {
    warnings.push({
      code: 'LOW_SAMPLE_SIZE',
      message: 'Fewer than 100 games were included; compare metrics cautiously.',
    })
  }

  if (dataset.summary.gamesSkipped > 0) {
    warnings.push({
      code: 'GAMES_SKIPPED',
      message: 'Some discovered games were excluded; review the skip reasons.',
    })
  }

  if (metrics.clippedPredictions > 0) {
    warnings.push({
      code: 'LOG_LOSS_CLIPPING',
      message: `${metrics.clippedPredictions} predictions were clipped for log loss.`,
    })
  }

  const range =
    metrics.predictionDistribution.maximum - metrics.predictionDistribution.minimum

  if (range < 0.1) {
    warnings.push({
      code: 'NARROW_PREDICTION_RANGE',
      message: 'The prediction range is narrow and may be under-confident.',
    })
  }

  if (
    metrics.predictionDistribution.minimum < 0.05 ||
    metrics.predictionDistribution.maximum > 0.95
  ) {
    warnings.push({
      code: 'EXTREME_PREDICTIONS',
      message: 'The run produced probabilities below 5% or above 95%.',
    })
  }

  if (baselineComparison.historicalHomeRate === 'worse') {
    warnings.push({
      code: 'WORSE_THAN_HOME_RATE_BASELINE',
      message:
        'This configuration does not outperform a constant home-win-rate prediction on this dataset.',
    })
  }

  if (metrics.expectedCalibrationError > 0.1) {
    warnings.push({
      code: 'LARGE_CALIBRATION_ERROR',
      message:
        'Large calibration error: predicted probabilities differ substantially from observed outcomes.',
    })
  }

  return warnings
}

const getCurrentRatingDocuments = (userId) =>
  PowerRating.find({ userId }).sort({ teamName: 1 })

const buildExpectedGameRange = (season, selectedRange = season) => {
  const isFullSeason =
    selectedRange.dateFrom === season.startDate &&
    selectedRange.dateTo === season.endDate

  return {
    approximate: isFullSeason ? EXPECTED_FULL_SEASON_GAMES : null,
    minimum: isFullSeason ? MINIMUM_FULL_SEASON_GAMES : null,
    rule: isFullSeason
      ? `A modern full regular season should include at least ${MINIMUM_FULL_SEASON_GAMES} completed games.`
      : 'No full-season threshold is applied to a custom date range.',
  }
}

const buildSeasonBoundaries = (season) => ({
  metadataSource: season.metadataSource ?? null,
  resolvedEndDate: season.dateTo,
  resolvedStartDate: season.dateFrom,
  seasonEndDate: season.endDate,
  seasonStartDate: season.startDate,
})

const getSeasonFailure = (error, season, context = {}) => {
  let errorCode = error?.errorCode ?? 'simulation_failed'
  let status = 'simulation_failed'
  let userMessage = 'Season data could not be loaded or calibrated.'

  if (
    error?.upstreamStatus === 429 ||
    error?.statusCode === 429 ||
    errorCode === 'rate_limited'
  ) {
    errorCode = 'rate_limited'
    status = 'rate_limited'
    userMessage =
      error?.publicMessage ?? historicalNhlDataService.RATE_LIMIT_MESSAGE
  } else if (errorCode === 'no_games') {
    status = 'no_games'
    userMessage = 'No completed regular-season games were available.'
  } else if (errorCode === 'incomplete_historical_data') {
    status = 'data_unavailable'
    userMessage = error.publicMessage
  } else if (errorCode === 'historical_dataset_partial') {
    status = 'data_unavailable'
    userMessage = error.publicMessage
  } else if (
    errorCode === 'missing_starting_order' ||
    error?.details?.field === 'startingRatings'
  ) {
    errorCode = 'missing_starting_order'
    status = 'invalid_team_order'
    userMessage =
      'A valid season-specific starting team order was unavailable.'
  } else if (error instanceof nhlApiService.NhlApiError) {
    errorCode = 'historical_data_unavailable'
    status = 'data_unavailable'
    userMessage = 'The NHL historical schedule was unavailable.'
  } else if (error instanceof BaseModelCalibrationError) {
    userMessage = error.publicMessage
  }

  return {
    boundaries: buildSeasonBoundaries(season),
    dataSource: context.dataSource ?? 'NHL API / shared cache',
    errorCode,
    gamesFound: context.gamesFound ?? 0,
    gamesIncluded: context.gamesIncluded ?? 0,
    gamesSkipped: context.gamesSkipped ?? 0,
    label: season.label ?? season.id,
    metrics: null,
    seasonId: season.id,
    status,
    userMessage,
  }
}

const getCalibrationOptions = async (userId, options = {}) => {
  if (!userId) {
    throw new BaseModelCalibrationError('Authenticated userId is required.', 401)
  }

  const [productionSettings, seasonMetadata, currentRatings] = await Promise.all([
    (options.settingsProvider ?? getProductionRatingEngineSettings)(userId),
    (options.seasonsProvider ??
      nhlSeasonService.getAvailablePowerRatingHistorySeasons)(),
    (options.currentRatingsProvider ?? getCurrentRatingDocuments)(userId),
  ])
  const today = (options.todayProvider ?? nhlApiService.getTodayNhlDate)()
  const historicalSeasons = getCompletedHistoricalSeasons(seasonMetadata, today).map(
    (season) => ({
      ...season,
      expectedGames: buildExpectedGameRange(season),
      metadataSource: season.metadataSource ?? seasonMetadata.metadataSource,
    }),
  )
  const historicalStatuses = await (
    options.historicalStatusProvider ??
    historicalNhlDataService.getHistoricalSeasonStatuses
  )(historicalSeasons, { repository: options.historicalRepository })
  const historicalStatusesBySeason = new Map(
    (historicalStatuses ?? []).map((status) => [status.seasonId, status]),
  )
  const seasonsWithDatasetStatus = historicalSeasons.map((season) => ({
    ...season,
    historicalDataset:
      historicalStatusesBySeason.get(season.id) ??
      historicalNhlDataService.makeDatasetStatus(null, {
        expectedApproximateGames: EXPECTED_FULL_SEASON_GAMES,
        id: season.id,
      }),
  }))
  const defaultSeason = seasonsWithDatasetStatus[0] ?? null
  const boundarySources = [
    ...new Set(seasonsWithDatasetStatus.map((season) => season.metadataSource)),
  ]

  return {
    defaults: {
      configuration: {
        kFactor: BASE_MODEL_V1.kFactor,
        overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
        regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
        shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
      },
      dateFrom: defaultSeason?.startDate ?? '',
      dateTo: defaultSeason?.endDate ?? '',
      homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      probabilityScale: BASE_MODEL_V1.probabilityScale,
      seasonId: defaultSeason?.id ?? '',
      startingRatings: {
        center: DEFAULT_FIXED_CENTER,
        mode: STARTING_MODES.CURRENT,
        spread: DEFAULT_FIXED_SPREAD,
      },
    },
    startingStatePolicies: {
      multiSeason: {
        description:
          'Every evaluated season uses the same deterministic seed-team alphabetical order.',
        label: 'Fixed 42–50 · Alphabetical ordering',
        policy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
      },
      singleSeasonScenarios: {
        currentProductionAvailable: true,
        description:
          'Current-rating starting states are useful for scenario exploration but are not used for leakage-safe multi-season Model Calibration.',
      },
    },
    isolation: {
      automaticAdjustmentsIncluded: false,
      historicalInputs: 'shared_persistent_read_only',
      persistence: 'none',
      productionRatingsWritable: false,
    },
    modelVersion: productionSettings.modelVersion,
    probabilityFormula: '1 / (1 + exp(-(homeRating + homeAdvantage - awayRating) / probabilityScale))',
    productionRatingCount: Array.isArray(currentRatings)
      ? currentRatings.length
      : 0,
    seasons: seasonsWithDatasetStatus,
    seasonMetadataSource:
      boundarySources.length === 1
        ? boundarySources[0]
        : seasonMetadata.metadataSource,
    warning: seasonMetadata.warning,
  }
}

const runBaseModelCalibration = async (userId, payload, options = {}) => {
  if (!userId) {
    throw new BaseModelCalibrationError('Authenticated userId is required.', 401)
  }

  const [, seasonMetadata] = await Promise.all([
    (options.settingsProvider ?? getProductionRatingEngineSettings)(userId),
    (options.seasonsProvider ??
      nhlSeasonService.getAvailablePowerRatingHistorySeasons)(),
  ])
  const commonInput = normalizeCommonCalibrationInput(payload)
  const today = (options.todayProvider ?? nhlApiService.getTodayNhlDate)()
  const selectedSeasons = normalizeSeasonSelections(
    payload,
    seasonMetadata,
    today,
  )
  const requestId = (options.requestIdProvider ?? randomUUID)()
  const diagnosticLogger = options.logger ?? console
  const isMultiSeasonCalibration = selectedSeasons.length > 1

  logCalibrationDiagnostic(diagnosticLogger, 'request received', {
    requestId,
    selectedSeasonIds: selectedSeasons.map((season) => season.id),
  })

  if (
    selectedSeasons.length > 1 &&
    commonInput.startingRatings.mode === STARTING_MODES.CURRENT
  ) {
    throw new BaseModelCalibrationError(
      'Current production ratings cannot be used for cross-season calibration. Use fixed spread.',
      400,
      { field: 'startingRatings.mode' },
    )
  }

  const [{ teams, teamsById }, currentRatings] = await Promise.all([
    buildTeamDirectory(options.teamsProvider),
    (options.currentRatingsProvider ?? getCurrentRatingDocuments)(userId),
  ])
  const historicalSeasons = getCompletedHistoricalSeasons(seasonMetadata, today)
  const latestHistoricalSeason = historicalSeasons.reduce(
    (latest, season) =>
      !latest || season.endDate > latest.endDate ? season : latest,
    null,
  )
  const gamesProvider = options.gamesProvider ?? null
  const preparedSeasons = gamesProvider
    ? null
    : await (
        options.historicalSeasonsProvider ??
        historicalNhlDataService.ensureHistoricalSeasons
      )(selectedSeasons, {
        repository: options.historicalRepository,
        teamsProvider: async () => teams,
        windowProvider: options.historicalWindowProvider,
      })

  const settledSeasons = []

  for (const season of selectedSeasons) {
    const executionContext = {
      cacheKey: nhlApiService.getHistoricalScheduleRangeCacheKey(
        season.id,
        season.dateFrom,
        season.dateTo,
      ),
      dataSource:
        options.dataSource ??
        (gamesProvider
          ? 'NHL API / shared cache'
          : 'MongoDB historical dataset'),
      gamesFound: 0,
      gamesIncluded: 0,
      gamesSkipped: 0,
    }

    logCalibrationDiagnostic(diagnosticLogger, 'season started', {
      boundaries: buildSeasonBoundaries(season),
      requestId,
      seasonId: season.id,
    })

    try {
      const value = await (async () => {
      const input = {
        ...commonInput,
        dateFrom: season.dateFrom,
        dateFromTimestamp: season.dateFromTimestamp,
        dateTo: season.dateTo,
        dateToTimestamp: season.dateToTimestamp,
        seasonId: season.id,
      }
      const isOlderSeason = season.id !== latestHistoricalSeason?.id
      const startingStatePolicy = resolveStartingStatePolicy({
        isLatestHistoricalSeason: !isOlderSeason,
        isMultiSeason: isMultiSeasonCalibration,
        startingRatings: input.startingRatings,
      })
      const {
        orderingMode,
        orderingSource,
        usesHistoricalOrderingFallback,
      } = startingStatePolicy
      const gameLoad = gamesProvider
        ? await gamesProvider(input.dateFrom, input.dateTo, {
            allowStale: true,
            includeProviderState: true,
            seasonId: input.seasonId,
          })
        : preparedSeasons?.get(input.seasonId)

      if (!gamesProvider && gameLoad?.status !== 'ready') {
        executionContext.gamesFound = gameLoad?.dataset?.importedGames ?? 0
        executionContext.gamesIncluded = gameLoad?.dataset?.completedGames ?? 0
        executionContext.gamesSkipped = gameLoad?.dataset?.skippedGames ?? 0
        const rateLimited = gameLoad?.dataset?.lastErrorCode === 'rate_limited'

        throw new BaseModelCalibrationError(
          gameLoad?.message ??
            'Historical season data is not ready. Prepare or resume this season and try again.',
          503,
          {
            dataset: gameLoad?.dataset ?? null,
            seasonId: input.seasonId,
          },
          rateLimited ? 'rate_limited' : 'historical_dataset_partial',
        )
      }

      const games = Array.isArray(gameLoad) ? gameLoad : gameLoad?.games

      executionContext.dataSource = options.dataSource ?? (
        gamesProvider
          ? gameLoad?.source
            ? `NHL API / ${gameLoad.source.replaceAll('_', ' ')}`
            : 'NHL API / shared cache'
          : 'MongoDB historical dataset'
      )
      executionContext.cacheKey = gameLoad?.cacheKey ?? null
      executionContext.providerRequestCount = gameLoad?.requestCount ?? null

      const dataset = prepareDataset({ games, input, teamsById })
      Object.assign(executionContext, dataset.summary)
      const expectedGames = buildExpectedGameRange(season, input)

      if (dataset.summary.gamesIncluded === 0) {
        throw new BaseModelCalibrationError(
          'No completed regular-season games were eligible for calibration.',
          502,
          dataset.summary,
          'no_games',
        )
      }

      if (
        teams.length >= 30 &&
        expectedGames.minimum !== null &&
        dataset.summary.gamesIncluded < expectedGames.minimum
      ) {
        throw new BaseModelCalibrationError(
          `Only ${dataset.summary.gamesIncluded} completed games were included for ${
            season.label ?? season.id
          }; historical data may be incomplete.`,
          502,
          dataset.summary,
          'incomplete_historical_data',
        )
      }

      const startingState = buildStartingState({
        currentRatings,
        input,
        orderingMode,
        teams,
      })
      const replay = replayDataset({
        includedGames: dataset.includedGames,
        input,
        ratingState: cloneRatingState(startingState),
      })
      const metrics = calculateMetrics(replay.predictions)
      const sanityBaselines = calculateSanityBaselines(replay.predictions)
      const baselineComparison = buildBaselineComparison(metrics, sanityBaselines)
      const centerInvariance = buildCenterInvarianceDiagnostic({
        includedGames: dataset.includedGames,
        input,
        startingState,
      })
      const warnings = buildWarnings({ baselineComparison, dataset, metrics })
      const teamResults = serializeTeamResults(replay.ratingState)

      if (!centerInvariance.passed) {
        warnings.push({
          code: 'CENTER_INVARIANCE_FAILED',
          message: 'Adding a constant to all starting ratings changed predictions.',
        })
      }

      if (usesHistoricalOrderingFallback) {
        warnings.push({
          code: 'HISTORICAL_ORDERING_FALLBACK',
          message:
            'A franchise-normalized alphabetical ordering was used because a historical preseason rating snapshot is unavailable.',
        })
      }

      if (
        input.startingRatings.mode === STARTING_MODES.CURRENT
      ) {
        warnings.push({
          code: 'CURRENT_RATINGS_SCENARIO_NON_COMPARABLE',
          message:
            'Current-rating starting states are useful for scenario exploration but are not used for leakage-safe multi-season Model Calibration.',
        })
      }

      if (
        input.startingRatings.mode === STARTING_MODES.FIXED_SPREAD &&
        startingStatePolicy.policy ===
          STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER
      ) {
        warnings.push({
          code: 'CURRENT_ORDER_FIXED_SPREAD_SCENARIO_NON_COMPARABLE',
          message:
            'This single-season fixed spread uses current production ordering for scenario exploration and is not comparable to the leakage-safe multi-season reference.',
        })
      }

      return {
        _dataset: dataset,
        _predictions: replay.predictions,
        _startingState: startingState,
        baselineComparison,
        calibrationBuckets: metrics.calibrationBuckets,
        confidenceBuckets: metrics.confidenceBuckets,
        dataset: {
          ...dataset.summary,
          gameType: NHL_GAME_TYPE_CODES.REGULAR_SEASON,
          skipReasons: dataset.skipReasons,
          source: executionContext.dataSource,
        },
        diagnostics: {
          cacheKey: executionContext.cacheKey,
          centerInvariance,
          providerRequestCount: executionContext.providerRequestCount,
        },
        boundaries: buildSeasonBoundaries(season),
        dataSource: executionContext.dataSource,
        errorCode: null,
        expectedGames,
        filters: {
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          seasonId: input.seasonId,
        },
        finalRatingSummary: buildFinalRatingSummary(teamResults),
        label: season.label ?? season.id,
        metadataSource: season.metadataSource,
        metrics: {
          accuracy: metrics.accuracy,
          brierScore: metrics.brierScore,
          clippedPredictions: metrics.clippedPredictions,
          expectedCalibrationError: metrics.expectedCalibrationError,
          logLoss: metrics.logLoss,
          predictionDistribution: metrics.predictionDistribution,
        },
        orderingSource,
        sanityBaselines,
        seasonId: season.id,
        status: 'completed',
        startingState: {
          comparableToUnifiedMultiSeason:
            startingStatePolicy.comparableToUnifiedMultiSeason,
          label: startingStatePolicy.label,
          orderingSource,
          policy: startingStatePolicy.policy,
        },
        teamResults,
        userMessage: null,
        warnings,
      }
      })()

      settledSeasons.push({
        context: executionContext,
        status: 'fulfilled',
        value,
      })
      logCalibrationDiagnostic(diagnosticLogger, 'season completed', {
        cacheKey: executionContext.cacheKey,
        gamesFound: executionContext.gamesFound,
        gamesIncluded: executionContext.gamesIncluded,
        gamesSkipped: executionContext.gamesSkipped,
        requestId,
        seasonId: season.id,
        status: 'completed',
      })
    } catch (reason) {
      settledSeasons.push({
        context: executionContext,
        reason,
        status: 'rejected',
      })
      const failure = getSeasonFailure(reason, season, executionContext)

      logCalibrationDiagnostic(diagnosticLogger, 'season failed', {
        cacheKey: executionContext.cacheKey,
        errorCode: failure.errorCode,
        gamesFound: failure.gamesFound,
        gamesIncluded: failure.gamesIncluded,
        gamesSkipped: failure.gamesSkipped,
        requestId,
        seasonId: season.id,
        status: failure.status,
      })
    }
  }
  const seasonResults = []
  const seasonFailures = []
  const seasonCoverage = []

  settledSeasons.forEach((settled, index) => {
    const season = selectedSeasons[index]

    if (settled.status === 'fulfilled') {
      seasonResults.push(settled.value)
      seasonCoverage.push({
        boundaries: settled.value.boundaries,
        dataSource: settled.value.dataSource,
        errorCode: null,
        expectedGames: settled.value.expectedGames,
        gamesFound: settled.value.dataset.gamesFound,
        gamesIncluded: settled.value.dataset.gamesIncluded,
        gamesSkipped: settled.value.dataset.gamesSkipped,
        label: settled.value.label,
        metrics: settled.value.metrics,
        seasonId: settled.value.seasonId,
        status: 'completed',
        userMessage: null,
      })
      return
    }

    const failure = {
      ...getSeasonFailure(settled.reason, season, settled.context),
      expectedGames: buildExpectedGameRange(season, season),
    }

    seasonCoverage.push(failure)
    seasonFailures.push({
      ...failure,
      message: failure.userMessage,
      seasonLabel: failure.label,
    })
  })

  if (seasonResults.length === 0) {
    const firstFailure = settledSeasons.find(
      (result) => result.status === 'rejected',
    )
    const firstReason = firstFailure?.reason

    throw new BaseModelCalibrationError(
      firstReason instanceof BaseModelCalibrationError
        ? firstReason.publicMessage
        : 'No selected historical season could be calibrated.',
      firstReason?.statusCode ?? 502,
      { seasons: seasonCoverage },
      firstReason?.errorCode ?? 'all_seasons_failed',
    )
  }

  const allPredictions = seasonResults.flatMap((result) => result._predictions)
  const startingStatePolicies = [
    ...new Set(seasonResults.map((result) => result.startingState.policy)),
  ]
  const startingStateIdentity = createStartingStateIdentity({
    policy:
      startingStatePolicies.length === 1
        ? startingStatePolicies[0]
        : STARTING_STATE_POLICIES.UNKNOWN,
    seasonStartingStates: seasonResults.map((result) => ({
      orderingSource: result.startingState.orderingSource,
      policy: result.startingState.policy,
      seasonId: result.seasonId,
      teams: result._startingState,
    })),
  })
  const metrics = calculateMetrics(allPredictions)
  const sanityBaselines = calculateSanityBaselines(allPredictions)
  const baselineComparison = buildBaselineComparison(metrics, sanityBaselines)
  const aggregateDataset = seasonResults.reduce(
    (aggregate, result) => {
      aggregate.gamesFound += result.dataset.gamesFound
      aggregate.gamesIncluded += result.dataset.gamesIncluded
      aggregate.gamesSkipped += result.dataset.gamesSkipped
      Object.entries(result.dataset.skipReasons).forEach(([reason, count]) => {
        aggregate.skipReasons[reason] = (aggregate.skipReasons[reason] ?? 0) + count
      })
      return aggregate
    },
    { gamesFound: 0, gamesIncluded: 0, gamesSkipped: 0, skipReasons: {} },
  )
  const seasonBrierScores = seasonResults.map((result) => result.metrics.brierScore)
  const averageSeasonBrier =
    seasonBrierScores.reduce((total, score) => total + score, 0) /
    seasonBrierScores.length
  const brierVariance =
    seasonBrierScores.reduce(
      (total, score) => total + (score - averageSeasonBrier) ** 2,
      0,
    ) / seasonBrierScores.length
  const bestSeason = [...seasonResults].sort(
    (left, right) => left.metrics.brierScore - right.metrics.brierScore,
  )[0]
  const worstSeason = [...seasonResults].sort(
    (left, right) => right.metrics.brierScore - left.metrics.brierScore,
  )[0]
  const hasCrossSeasonStability = seasonResults.length >= 2
  const brierRange = hasCrossSeasonStability
    ? Math.max(...seasonBrierScores) - Math.min(...seasonBrierScores)
    : null
  const brierStandardDeviation = hasCrossSeasonStability
    ? Math.sqrt(brierVariance)
    : null
  const stabilityLevel =
    seasonResults.length < 2
      ? 'not_assessed'
      : brierRange <= 0.01 && brierStandardDeviation <= 0.005
      ? 'stable'
      : brierRange <= 0.02 && brierStandardDeviation <= 0.01
        ? 'mixed'
        : 'unstable'
  const aggregate = {
    averageSeasonBrier: round(averageSeasonBrier),
    bestSeason: {
      brierScore: bestSeason.metrics.brierScore,
      label: bestSeason.label,
      seasonId: bestSeason.seasonId,
    },
    brierRange: round(brierRange),
    brierStandardDeviation: round(brierStandardDeviation),
    completedSeasons: seasonResults.length,
    incomplete: seasonFailures.length > 0,
    requestedSeasons: selectedSeasons.length,
    worstSeason: {
      brierScore: worstSeason.metrics.brierScore,
      label: worstSeason.label,
      seasonId: worstSeason.seasonId,
    },
  }
  const stability = {
    brierRange: aggregate.brierRange,
    brierStandardDeviation: aggregate.brierStandardDeviation,
    level: stabilityLevel,
    seasonsBeatingConstant50: seasonResults.filter(
      (result) => result.baselineComparison.constant50 === 'better',
    ).length,
    seasonsBeatingHomeRate: seasonResults.filter(
      (result) => result.baselineComparison.historicalHomeRate === 'better',
    ).length,
    seasonsEvaluated: seasonResults.length,
    seasonsSelected: selectedSeasons.length,
    partial: seasonFailures.length > 0,
    thresholds: {
      mixed: { maximumRange: 0.02, maximumStandardDeviation: 0.01 },
      stable: { maximumRange: 0.01, maximumStandardDeviation: 0.005 },
    },
  }
  const aggregateDatasetForWarnings = { summary: aggregateDataset }
  const warnings = buildWarnings({
    baselineComparison,
    dataset: aggregateDatasetForWarnings,
    metrics,
  })

  if (seasonFailures.length > 0) {
    warnings.push({
      code: 'INCOMPLETE_SEASON_COVERAGE',
      message:
        'Aggregate metrics are incomplete because one or more selected seasons failed.',
    })
  }

  const publicSeasonResults = seasonResults.map(
    ({ _dataset, _predictions, _startingState, ...result }) => result,
  )
  const singleSeasonResult =
    selectedSeasons.length === 1 && seasonFailures.length === 0
      ? publicSeasonResults[0]
      : null
  const runLabel =
    commonInput.label ||
    (commonInput.startingRatings.mode === STARTING_MODES.CURRENT
      ? 'Current'
      : 'Fixed spread')
  const centerInvariance = singleSeasonResult
    ? singleSeasonResult.diagnostics.centerInvariance
    : {
        passed: publicSeasonResults.every(
          (result) => result.diagnostics.centerInvariance.passed,
        ),
        seasonsTested: publicSeasonResults.length,
        testedCenterOffset: 100,
      }

  return {
    aggregate,
    baselineComparison,
    calibrationBuckets: metrics.calibrationBuckets,
    confidenceBuckets: metrics.confidenceBuckets,
    coverage: {
      completedSeasons: publicSeasonResults.length,
      completedSeasonIds: publicSeasonResults.map((result) => result.seasonId),
      failedSeasons: seasonFailures.length,
      failedSeasonIds: seasonFailures.map((failure) => failure.seasonId),
      incomplete: seasonFailures.length > 0,
      seasons: seasonCoverage,
      selectedSeasons: selectedSeasons.length,
      requestedSeasonIds: selectedSeasons.map((season) => season.id),
    },
    dataset: {
      ...aggregateDataset,
      gameType: NHL_GAME_TYPE_CODES.REGULAR_SEASON,
      source:
        options.dataSource ??
        [...new Set(publicSeasonResults.map((result) => result.dataSource))].join(
          ' + ',
        ),
    },
    displayLabel:
      selectedSeasons.length === 1
        ? `${selectedSeasons[0].label ?? selectedSeasons[0].id} · ${
            runLabel
          } · Scale ${commonInput.probabilityScale}`
        : seasonFailures.length > 0
          ? `Partial aggregate · ${publicSeasonResults.length} of ${
              selectedSeasons.length
            } seasons · ${runLabel} · Scale ${commonInput.probabilityScale}`
          : `Aggregate · ${selectedSeasons.length} seasons · ${
              runLabel
            } · Scale ${commonInput.probabilityScale}`,
    diagnostics: {
      centerInvariance,
      chronologicalReplay: true,
      formula:
        '1 / (1 + exp(-(homeRating + homeAdvantage - awayRating) / probabilityScale))',
      metricDefinitions: {
        brierScore:
          'Mean squared error of all pooled binary home-win predictions. Lower is better.',
        expectedCalibrationError:
          'Sum of pooled bucket frequency multiplied by absolute average-probability versus actual-home-win-rate gap.',
        logLoss:
          `Pooled binary cross-entropy with probabilities clipped to [${LOG_LOSS_EPSILON}, ${
            1 - LOG_LOSS_EPSILON
          }]. Lower is better.`,
      },
      predictionCalculatedBeforeUpdate: true,
      productionWrites: false,
      providerRequestCount: settledSeasons.reduce(
        (total, result) =>
          total + (Number(result.context?.providerRequestCount) || 0),
        0,
      ),
      providerRequestStrategy:
        'Weekly date-range batches, at most two active schedule requests per season; seasons run sequentially.',
      ratingResetBetweenSeasons: true,
      startingStateSignature: startingStateIdentity.startingStateSignature,
      skippedGames: seasonResults.flatMap(
        (result) => result._dataset.skippedGames.map((game) => ({
          ...game,
          seasonId: result.seasonId,
        })),
      ),
    },
    experimental: true,
    filters: {
      dateFrom: singleSeasonResult?.filters.dateFrom ?? null,
      dateTo: singleSeasonResult?.filters.dateTo ?? null,
      seasonId: singleSeasonResult?.seasonId ?? null,
      seasonIds: selectedSeasons.map((season) => season.id),
      useCustomDateRange: Array.isArray(payload.seasonIds)
        ? payload.useCustomDateRange === true
        : true,
    },
    finalRatingSummary: singleSeasonResult?.finalRatingSummary ?? null,
    label: commonInput.label,
    metrics: {
      accuracy: metrics.accuracy,
      brierScore: metrics.brierScore,
      clippedPredictions: metrics.clippedPredictions,
      expectedCalibrationError: metrics.expectedCalibrationError,
      logLoss: metrics.logLoss,
      predictionDistribution: metrics.predictionDistribution,
    },
    modelVersion: commonInput.configuration.modelVersion,
    rankingEligible: seasonFailures.length === 0,
    parameters: {
      configuration: commonInput.configuration,
      homeAdvantage: commonInput.homeAdvantage,
      probabilityScale: commonInput.probabilityScale,
      startingRatings: {
        ...commonInput.startingRatings,
        comparableToUnifiedMultiSeason:
          publicSeasonResults.every(
            (result) =>
              result.startingState.comparableToUnifiedMultiSeason === true,
          ),
        label:
          singleSeasonResult?.startingState.label ??
          (startingStateIdentity.policy ===
          STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL
            ? getFixedSpreadLabel(
                commonInput.startingRatings,
                'Alphabetical ordering',
              )
            : 'Mixed starting-state policies'),
        orderingSource:
          singleSeasonResult?.orderingSource ??
          (startingStateIdentity.policy ===
          STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL
            ? STARTING_ORDERING_SOURCES.ALPHABETICAL
            : 'See each season result.'),
        policy: startingStateIdentity.policy,
        startingStateSignature: startingStateIdentity.startingStateSignature,
      },
    },
    sanityBaselines,
    seasonFailures,
    seasonResults: publicSeasonResults,
    stability,
    teamResults: singleSeasonResult?.teamResults ?? [],
    warnings,
  }
}

module.exports = {
  BaseModelCalibrationError,
  DEFAULT_FIXED_CENTER,
  DEFAULT_FIXED_SPREAD,
  EXPECTED_FULL_SEASON_GAMES,
  HOME_PROBABILITY_BUCKETS,
  LOG_LOSS_EPSILON,
  MAX_CALIBRATION_DATE_RANGE_DAYS,
  MINIMUM_FULL_SEASON_GAMES,
  STARTING_MODES,
  STARTING_ORDERING_MODES,
  STARTING_ORDERING_SOURCES,
  buildStartingState,
  buildBaselineComparison,
  buildWarnings,
  buildExpectedGameRange,
  calculateSanityBaselines,
  calculateMetrics,
  getCalibrationOptions,
  getCompletedHistoricalSeasons,
  getSeasonFailure,
  normalizeCalibrationInput,
  normalizeSeasonSelections,
  prepareDataset,
  replayDataset,
  resolveStartingStatePolicy,
  runBaseModelCalibration,
  validateSelectedSeason,
}
