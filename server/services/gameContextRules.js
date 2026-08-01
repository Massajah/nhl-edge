const {
  DEFAULT_QUICK_REMATCH_SETTINGS,
  normalizeScheduleAdjustmentSettings,
} = require('./quickRematchSettingsService')

const SOURCE_VERSION = 'game-context-v1'
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const ADJUSTMENT_CATEGORIES = Object.freeze({
  quickRematch: 'quickRematch',
  restFatigue: 'restFatigue',
})
const QUICK_REMATCH_CONDITION_ID = 'quick_rematch'
const REST_FATIGUE_ADJUSTMENTS = Object.freeze({
  backToBack: -0.75,
  backToBackTravel: -1.25,
  normal: 0,
  threeInFour: -0.5,
  wellRested: 0.25,
})
const REST_FATIGUE_CONDITION_IDS = Object.freeze({
  backToBack: 'back_to_back',
  backToBackAway: 'back_to_back',
  backToBackHome: 'back_to_back',
  backToBackTravel: 'back_to_back_travel',
  fourInSix: '4_games_in_6_days',
  heavySchedule: 'heavy_fatigue',
  normal: 'normal',
  threeInFour: '3_games_in_4_days',
  wellRested: 'well_rested',
})
const REST_FATIGUE_CONDITION_LABELS = Object.freeze({
  backToBack: 'Back-to-back',
  backToBackAway: 'Back-to-back',
  backToBackHome: 'Back-to-back',
  backToBackTravel: 'Back-to-back with travel',
  fourInSix: '4 games in 6 days',
  heavySchedule: 'Heavy schedule',
  normal: 'Normal rest',
  threeInFour: '3 games in 4 days',
  wellRested: 'Well rested',
})
const REST_FATIGUE_PRECEDENCE = Object.freeze([
  'backToBackTravel',
  'backToBack',
  'threeInFour',
  'wellRested',
  'normal',
])
const MANUAL_ADJUSTMENT_LIMITS = Object.freeze({
  max: 3,
  min: -3,
})
const WINDOW_BOUNDARY_MODE = 'start_exclusive_end_inclusive'

class GameContextError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'GameContextError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toFiniteNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value.trim()
  }

  return typeof value?.default === 'string' ? value.default.trim() : ''
}

const normalizeTeamIdentityValue = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()

const normalizeVenueCityKey = (value) =>
  getLocalizedValue(value)
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const getVenueCityFromGame = (game = {}) => {
  const candidateValues = [
    game.venueCity,
    game.venueCityName,
    game.venueLocation,
    game.venue?.city,
    game.venue?.location,
    game.venue?.venueLocation,
  ]

  const rawCity = candidateValues
    .map(getLocalizedValue)
    .find((candidateValue) => candidateValue)

  if (!rawCity) {
    return {
      city: null,
      key: null,
      source: 'unavailable',
    }
  }

  const city = rawCity.split(',')[0].trim()

  return {
    city,
    key: normalizeVenueCityKey(city),
    source: 'venue_city',
  }
}

const roundAdjustment = (value) => Number(Number(value || 0).toFixed(2))

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value) || 0))

const clampManualAdjustment = (value) =>
  roundAdjustment(
    clamp(value, MANUAL_ADJUSTMENT_LIMITS.min, MANUAL_ADJUSTMENT_LIMITS.max),
  )

const normalizeTeam = (team = {}) => ({
  abbreviation: String(team.abbreviation ?? team.abbrev ?? '')
    .trim()
    .toUpperCase(),
  name:
    typeof team.name === 'string'
      ? team.name.trim()
      : typeof team.placeName?.default === 'string' &&
          typeof team.commonName?.default === 'string'
        ? `${team.placeName.default} ${team.commonName.default}`.trim()
        : String(team.abbreviation ?? team.abbrev ?? '').trim().toUpperCase(),
  score: toFiniteNumber(team.score, null),
  teamId: String(team.teamId ?? team.id ?? team.abbreviation ?? team.abbrev ?? '')
    .trim()
    .toUpperCase(),
})

const normalizeGame = (game = {}) => {
  const homeTeam = normalizeTeam(game.homeTeam)
  const awayTeam = normalizeTeam(game.awayTeam)
  const startValue = game.startTimeUTC ?? game.scheduledStart ?? game.gameDate
  const scheduledStart = startValue ? new Date(startValue) : null
  const venueCity = getVenueCityFromGame(game)

  return {
    awayTeam,
    gameId: String(game.gameId ?? game.id ?? '').trim(),
    gameState: String(game.gameState ?? '').trim().toUpperCase(),
    homeTeam,
    scheduledStart:
      scheduledStart && !Number.isNaN(scheduledStart.getTime())
        ? scheduledStart
        : null,
    status: String(game.status ?? '').trim(),
    venueCity: venueCity.city,
    venueCityKey: venueCity.key,
    venueCitySource: venueCity.source,
  }
}

const serializeTeam = (team = {}) => ({
  abbreviation: team.abbreviation ?? '',
  name: team.name ?? '',
  teamId: team.teamId ?? team.abbreviation ?? '',
})

const getTeamKey = (team = {}) => {
  const normalizedTeam = team ?? {}

  return normalizeTeamIdentityValue(
    normalizedTeam.abbreviation ||
      normalizedTeam.abbrev ||
      normalizedTeam.teamId ||
      normalizedTeam.id,
  )
}

const getTeamIdentityKeys = (teamOrKey = {}) => {
  if (
    typeof teamOrKey === 'string' ||
    typeof teamOrKey === 'number'
  ) {
    const key = normalizeTeamIdentityValue(teamOrKey)

    return new Set(key ? [key] : [])
  }

  if (!teamOrKey || typeof teamOrKey !== 'object') {
    return new Set()
  }

  return new Set(
    [
      teamOrKey.teamId,
      teamOrKey.id,
      teamOrKey.abbreviation,
      teamOrKey.abbrev,
    ]
      .map(normalizeTeamIdentityValue)
      .filter(Boolean),
  )
}

const teamMatchesIdentity = (team, targetIdentityKeys) => {
  const teamIdentityKeys = getTeamIdentityKeys(team)

  return [...targetIdentityKeys].some((identityKey) =>
    teamIdentityKeys.has(identityKey),
  )
}

const getComparableTeamIdentity = (team = {}) => {
  const normalizedTeam = team ?? {}
  const explicitTeamId = normalizeTeamIdentityValue(
    normalizedTeam.teamId || normalizedTeam.id,
  )
  const abbreviation = normalizeTeamIdentityValue(
    normalizedTeam.abbreviation || normalizedTeam.abbrev,
  )

  if (explicitTeamId && explicitTeamId !== abbreviation) {
    return {
      key: explicitTeamId,
      source: 'team_id',
    }
  }

  if (abbreviation) {
    return {
      key: abbreviation,
      source: 'abbreviation',
    }
  }

  if (explicitTeamId) {
    return {
      key: explicitTeamId,
      source: 'team_id',
    }
  }

  return {
    key: null,
    source: '',
  }
}

const getGameTeamKeys = (game) =>
  new Set([getTeamKey(game.homeTeam), getTeamKey(game.awayTeam)].filter(Boolean))

const gameIncludesTeam = (game, teamAbbreviation) =>
  getTeamKey(game.homeTeam) === teamAbbreviation ||
  getTeamKey(game.awayTeam) === teamAbbreviation

const gameIncludesBothTeams = (game, teamA, teamB) => {
  const keys = getGameTeamKeys(game)

  return keys.has(teamA) && keys.has(teamB)
}

const getTeamSide = (game, teamId) => {
  if (!game) {
    return null
  }

  const targetIdentityKeys = getTeamIdentityKeys(teamId)

  if (targetIdentityKeys.size === 0) {
    return null
  }

  if (teamMatchesIdentity(game.homeTeam, targetIdentityKeys)) {
    return 'home'
  }

  if (teamMatchesIdentity(game.awayTeam, targetIdentityKeys)) {
    return 'away'
  }

  return null
}

const getTeamScore = (game, teamAbbreviation) => {
  if (getTeamKey(game.homeTeam) === teamAbbreviation) {
    return game.homeTeam.score
  }

  if (getTeamKey(game.awayTeam) === teamAbbreviation) {
    return game.awayTeam.score
  }

  return null
}

const getOpponentTeam = (game, teamAbbreviation) =>
  getTeamKey(game.homeTeam) === teamAbbreviation ? game.awayTeam : game.homeTeam

const getNormalizedGameVenueCity = (game = {}) => {
  const normalizedGame = game ?? {}

  return {
    city: normalizedGame.venueCity ?? null,
    key: normalizedGame.venueCityKey ?? null,
    source: normalizedGame.venueCitySource ?? 'unavailable',
  }
}

const classifyBackToBackTravel = ({
  currentGame,
  isBackToBack,
  previousGame,
  teamAbbreviation,
  teamId,
}) => {
  const currentVenue = getNormalizedGameVenueCity(currentGame)
  const previousVenue = getNormalizedGameVenueCity(previousGame)
  const targetTeamId = teamId ?? teamAbbreviation
  const currentTeamSide = getTeamSide(currentGame, targetTeamId)
  const previousTeamSide = getTeamSide(previousGame, targetTeamId)
  const currentHomeTeamIdentity = getComparableTeamIdentity(
    currentGame?.homeTeam,
  )
  const previousHomeTeamIdentity = getComparableTeamIdentity(
    previousGame?.homeTeam,
  )
  const currentHomeTeamId = currentHomeTeamIdentity.key
  const previousHomeTeamId = previousHomeTeamIdentity.key
  const buildResult = ({
    classificationSource,
    condition,
    sameAwayHomeTeam = null,
    travelBetweenGames,
  }) => ({
    classificationSource,
    condition,
    currentHomeTeamId,
    currentTeamSide,
    currentVenueCity: currentVenue.city,
    isBackToBack: Boolean(isBackToBack && previousGame),
    previousHomeTeamId,
    previousTeamSide,
    previousVenueCity: previousVenue.city,
    sameAwayHomeTeam,
    source: classificationSource,
    travelBetweenGames,
  })

  if (!isBackToBack || !previousGame) {
    return buildResult({
      classificationSource: 'not_back_to_back',
      condition: 'normal',
      travelBetweenGames: false,
    })
  }

  if (!previousTeamSide || !currentTeamSide) {
    return buildResult({
      classificationSource: 'insufficient_schedule_identity',
      condition: 'back_to_back',
      travelBetweenGames: null,
    })
  }

  if (
    previousTeamSide === 'away' &&
    currentTeamSide === 'away'
  ) {
    if (
      !previousHomeTeamId ||
      !currentHomeTeamId ||
      previousHomeTeamIdentity.source !== currentHomeTeamIdentity.source
    ) {
      return buildResult({
        classificationSource: 'insufficient_schedule_identity',
        condition: 'back_to_back',
        travelBetweenGames: null,
      })
    }

    const sameAwayHomeTeam = previousHomeTeamId === currentHomeTeamId

    return buildResult({
      classificationSource: 'schedule_structure',
      condition: sameAwayHomeTeam ? 'back_to_back' : 'back_to_back_travel',
      sameAwayHomeTeam,
      travelBetweenGames: !sameAwayHomeTeam,
    })
  }

  if (
    previousTeamSide === 'home' &&
    currentTeamSide === 'home'
  ) {
    return buildResult({
      classificationSource: 'schedule_structure',
      condition: 'back_to_back',
      travelBetweenGames: false,
    })
  }

  return buildResult({
    classificationSource: 'schedule_structure',
    condition: 'back_to_back_travel',
    travelBetweenGames: true,
  })
}

const getUtcCalendarDay = (date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

const getCalendarDayDiff = (currentDate, previousDate) =>
  Math.round(
    (getUtcCalendarDay(currentDate) - getUtcCalendarDay(previousDate)) /
      MS_PER_DAY,
  )

const deriveSeasonIdFromDate = (date) => {
  const parsedDate = date instanceof Date ? date : new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  const year = parsedDate.getUTCFullYear()
  const startYear = parsedDate.getUTCMonth() >= 6 ? year : year - 1

  return `${startYear}${startYear + 1}`
}

const getGameStartTime = (game) => game.scheduledStart?.getTime?.() ?? null

const toIsoString = (date) =>
  date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null

const hasGameStarted = (game, now = new Date()) => {
  if (['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(game.gameState)) {
    return true
  }

  const startTime = getGameStartTime(game)

  return Number.isFinite(startTime) && startTime <= now.getTime()
}

const uniqueGamesById = (games = []) => {
  const gamesById = new Map()

  games.forEach((game) => {
    const normalizedGame = normalizeGame(game)

    if (!normalizedGame.gameId || !normalizedGame.scheduledStart) {
      return
    }

    gamesById.set(normalizedGame.gameId, normalizedGame)
  })

  return [...gamesById.values()].sort(
    (left, right) => getGameStartTime(left) - getGameStartTime(right),
  )
}

const getPriorTeamGames = (scheduleGames, currentGame, teamAbbreviation) => {
  const currentStartTime = getGameStartTime(currentGame)

  if (!Number.isFinite(currentStartTime)) {
    return []
  }

  return uniqueGamesById(scheduleGames).filter((game) => {
    const startTime = getGameStartTime(game)

    return (
      game.gameId !== currentGame.gameId &&
      Number.isFinite(startTime) &&
      startTime < currentStartTime &&
      gameIncludesTeam(game, teamAbbreviation)
    )
  })
}

const createScheduleWindowDiagnostics = ({
  currentGame,
  scheduleGames,
  teamAbbreviation,
  windowDays,
}) => {
  const currentStartTime = getGameStartTime(currentGame)

  if (!Number.isFinite(currentStartTime)) {
    return {
      boundaryMode: WINDOW_BOUNDARY_MODE,
      countedGames: [],
      count: 0,
      currentGameId: currentGame?.gameId ?? '',
      teamAbbreviation,
      windowDays,
      windowEnd: null,
      windowStart: null,
    }
  }

  const windowMs = windowDays * MS_PER_DAY
  const windowStartTime = currentStartTime - windowMs
  const countedGames = uniqueGamesById([...scheduleGames, currentGame])
    .filter((game) => {
      const startTime = getGameStartTime(game)

      return (
        Number.isFinite(startTime) &&
        startTime > windowStartTime &&
        startTime <= currentStartTime &&
        gameIncludesTeam(game, teamAbbreviation)
      )
    })
    .map((game) => {
      const opponent = getOpponentTeam(game, teamAbbreviation)

      return {
        gameId: game.gameId,
        opponentAbbreviation: opponent.abbreviation,
        opponentName: opponent.name,
        startTimeUTC: toIsoString(game.scheduledStart),
      }
    })

  return {
    boundaryMode: WINDOW_BOUNDARY_MODE,
    countedGames,
    count: countedGames.length,
    currentGameId: currentGame.gameId,
    teamAbbreviation,
    windowDays,
    windowEnd: new Date(currentStartTime).toISOString(),
    windowStart: new Date(windowStartTime).toISOString(),
  }
}

const countGamesInWindow = (options) =>
  createScheduleWindowDiagnostics(options).count

const logScheduleWindowDiagnostics = (diagnostics) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NHL_EDGE_CONTEXT_DEBUG !== 'true'
  ) {
    return
  }

  console.debug('Game Context schedule window', diagnostics)
}

const getRestFatigueCondition = ({
  currentGame,
  gamesInFourDays,
  gamesInSixDays,
  isBackToBack,
  previousGame,
  restDays,
  teamAbbreviation,
}) => {
  const conditionFlags = new Set(['normal'])
  const travelClassification = classifyBackToBackTravel({
    currentGame,
    isBackToBack,
    previousGame,
    teamId: teamAbbreviation,
  })

  if (restDays >= 2) {
    conditionFlags.add('wellRested')
  }

  if (gamesInFourDays >= 3) {
    conditionFlags.add('threeInFour')
  }

  if (gamesInSixDays >= 4) {
    conditionFlags.add('fourInSix')
  }

  if (isBackToBack) {
    conditionFlags.add(
      travelClassification.travelBetweenGames === true
        ? 'backToBackTravel'
        : 'backToBack',
    )
  }

  const selectedCondition =
    REST_FATIGUE_PRECEDENCE.find((condition) =>
      conditionFlags.has(condition),
    ) ?? 'normal'

  return {
    conditionFlags: [...conditionFlags].filter(
      (condition) => condition !== 'normal' || conditionFlags.size === 1,
    ),
    currentVenueCity: travelClassification.currentVenueCity,
    currentHomeTeamId: travelClassification.currentHomeTeamId,
    currentTeamSide: travelClassification.currentTeamSide,
    hasMeaningfulTravel: travelClassification.travelBetweenGames === true,
    previousHomeTeamId: travelClassification.previousHomeTeamId,
    previousTeamSide: travelClassification.previousTeamSide,
    previousVenueCity: travelClassification.previousVenueCity,
    sameAwayHomeTeam: travelClassification.sameAwayHomeTeam,
    selectedCondition,
    travelBetweenGames: travelClassification.travelBetweenGames,
    travelClassificationSource: travelClassification.classificationSource,
  }
}

const getRestFatigueAdjustmentForCondition = (condition) => {
  return REST_FATIGUE_ADJUSTMENTS[condition] ?? REST_FATIGUE_ADJUSTMENTS.normal
}

const getRestFatigueConditionId = (condition) =>
  REST_FATIGUE_CONDITION_IDS[condition] ?? condition ?? 'normal'

const shouldApplyRestFatigueCondition = (condition, settings = {}) => {
  if (!settings.restFatigueEnabled || condition === 'normal') {
    return false
  }

  if (condition === 'wellRested') {
    return settings.wellRestedEnabled === true
  }

  if (condition === 'threeInFour') {
    return settings.threeInFourEnabled === true
  }

  if (condition === 'backToBack') {
    return settings.backToBackEnabled === true
  }

  if (condition === 'backToBackTravel') {
    return settings.backToBackTravelEnabled === true
  }

  return false
}

const getAppliedRestFatigueAdjustment = (condition, settings = {}) => {
  if (condition === 'backToBack') {
    return Number.isFinite(Number(settings.backToBackAdjustment))
      ? Number(settings.backToBackAdjustment)
      : REST_FATIGUE_ADJUSTMENTS.backToBack
  }

  if (condition === 'backToBackTravel') {
    return Number.isFinite(Number(settings.backToBackTravelAdjustment))
      ? Number(settings.backToBackTravelAdjustment)
      : REST_FATIGUE_ADJUSTMENTS.backToBackTravel
  }

  if (condition === 'threeInFour') {
    return Number.isFinite(Number(settings.threeInFourAdjustment))
      ? Number(settings.threeInFourAdjustment)
      : REST_FATIGUE_ADJUSTMENTS.threeInFour
  }

  if (condition === 'wellRested') {
    return Number.isFinite(Number(settings.wellRestedAdjustment))
      ? Number(settings.wellRestedAdjustment)
      : REST_FATIGUE_ADJUSTMENTS.wellRested
  }

  return getRestFatigueAdjustmentForCondition(condition)
}

const buildRestFatigueAdjustmentBreakdown = (
  selectedCondition = 'normal',
  settings = {},
) => {
  const normalizedSettings = normalizeScheduleAdjustmentSettings(settings)

  if (!shouldApplyRestFatigueCondition(selectedCondition, normalizedSettings)) {
    return []
  }

  return [
    {
      adjustment: roundAdjustment(
        getAppliedRestFatigueAdjustment(selectedCondition, normalizedSettings),
      ),
      category: ADJUSTMENT_CATEGORIES.restFatigue,
      condition: getRestFatigueConditionId(selectedCondition),
    },
  ]
}

const buildQuickRematchAdjustmentBreakdown = (adjustment) =>
  Math.abs(roundAdjustment(adjustment)) >= 0.005
    ? [
        {
          adjustment: roundAdjustment(adjustment),
          category: ADJUSTMENT_CATEGORIES.quickRematch,
          condition: QUICK_REMATCH_CONDITION_ID,
        },
      ]
    : []

const sumAdjustmentBreakdown = (adjustmentBreakdown = [], category) =>
  roundAdjustment(
    adjustmentBreakdown
      .filter((item) => item.category === category)
      .reduce((total, item) => total + item.adjustment, 0),
  )

const buildUnavailableTeamContext = ({
  existingContext = {},
  reason,
  team,
}) => {
  const manualRestFatigueAdjustment = clampManualAdjustment(
    existingContext.manualRestFatigueAdjustment,
  )
  const manualQuickRematchAdjustment = clampManualAdjustment(
    existingContext.manualQuickRematchAdjustment,
  )
  const restFatigueOverrideEnabled = Boolean(
    existingContext.restFatigueOverrideEnabled,
  )
  const quickRematchOverrideEnabled = Boolean(
    existingContext.quickRematchOverrideEnabled,
  )
  const effectiveRestFatigueAdjustment = restFatigueOverrideEnabled
    ? manualRestFatigueAdjustment
    : 0
  const effectiveQuickRematchAdjustment = quickRematchOverrideEnabled
    ? manualQuickRematchAdjustment
    : 0

  return {
    adjustmentBreakdown: [],
    automaticQuickRematchAdjustment: 0,
    automaticRestFatigueAdjustment: 0,
    conditions: [],
    dataStatus: 'unavailable',
    effectiveQuickRematchAdjustment,
    effectiveRestFatigueAdjustment,
    gamesInFourDays: 0,
    gamesInSixDays: 0,
    backToBack: false,
    currentHomeTeamId: null,
    currentTeamSide: null,
    currentVenueCity: null,
    hasMeaningfulTravel: false,
    isBackToBack: false,
    manualQuickRematchAdjustment,
    manualRestFatigueAdjustment,
    previousHomeTeamId: null,
    previousTeamSide: null,
    previousVenueCity: null,
    quickRematch: {
      eligible: false,
      hoursSincePreviousMeeting: null,
      previousGameDate: null,
      previousGameId: '',
      previousLoserAbbreviation: '',
      previousOpponentAbbreviation: '',
      previousOpponentName: '',
      previousWinnerAbbreviation: '',
      reason,
    },
    quickRematchOverrideEnabled,
    reasons: [reason],
    restDays: null,
    restFatigueCondition: 'normal',
    restFatigueOverrideEnabled,
    sameAwayHomeTeam: null,
    team: serializeTeam(team),
    totalGameContextAdjustment: roundAdjustment(
      effectiveRestFatigueAdjustment + effectiveQuickRematchAdjustment,
    ),
    travelBetweenGames: false,
    travelClassificationSource: 'unavailable',
  }
}

const findPreviousHeadToHead = ({
  currentGame,
  scheduleGames,
  teamAbbreviation,
  opponentAbbreviation,
}) => {
  const currentStartTime = getGameStartTime(currentGame)

  if (!Number.isFinite(currentStartTime)) {
    return null
  }

  return uniqueGamesById(scheduleGames)
    .filter((game) => {
      const startTime = getGameStartTime(game)

      return (
        game.gameId !== currentGame.gameId &&
        Number.isFinite(startTime) &&
        startTime < currentStartTime &&
        gameIncludesBothTeams(game, teamAbbreviation, opponentAbbreviation)
      )
    })
    .sort((left, right) => getGameStartTime(right) - getGameStartTime(left))[0]
}

const buildQuickRematchContext = ({
  currentGame,
  now = new Date(),
  opponentAbbreviation,
  scheduleGames,
  settings = DEFAULT_QUICK_REMATCH_SETTINGS,
  teamAbbreviation,
}) => {
  const normalizedSettings = normalizeScheduleAdjustmentSettings(settings)

  if (!normalizedSettings.quickRematchEnabled) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: null,
        previousGameDate: null,
        previousGameId: '',
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: '',
        previousWinnerAbbreviation: '',
        reason: 'Quick rematch adjustment is disabled.',
      },
    }
  }

  if (hasGameStarted(currentGame, now)) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: null,
        previousGameDate: null,
        previousGameId: '',
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: '',
        previousWinnerAbbreviation: '',
        reason: 'Current game has already started.',
      },
    }
  }

  const previousGame = findPreviousHeadToHead({
    currentGame,
    opponentAbbreviation,
    scheduleGames,
    teamAbbreviation,
  })

  if (!previousGame) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: null,
        previousGameDate: null,
        previousGameId: '',
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: '',
        previousWinnerAbbreviation: '',
        reason: 'No previous head-to-head meeting in the loaded season.',
      },
    }
  }

  const hoursSincePreviousMeeting =
    (getGameStartTime(currentGame) - getGameStartTime(previousGame)) /
    MS_PER_HOUR
  const maxHours = normalizedSettings.quickRematchMaximumDays * 24

  if (hoursSincePreviousMeeting > maxHours) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: roundAdjustment(hoursSincePreviousMeeting),
        previousGameDate: previousGame.scheduledStart,
        previousGameId: previousGame.gameId,
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: getOpponentTeam(previousGame, teamAbbreviation).name,
        previousWinnerAbbreviation: '',
        reason: 'Previous head-to-head meeting is outside the configured window.',
      },
    }
  }

  const teamScore = getTeamScore(previousGame, teamAbbreviation)
  const opponentScore = getTeamScore(previousGame, opponentAbbreviation)

  if (!Number.isFinite(teamScore) || !Number.isFinite(opponentScore)) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: roundAdjustment(hoursSincePreviousMeeting),
        previousGameDate: previousGame.scheduledStart,
        previousGameId: previousGame.gameId,
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: getOpponentTeam(previousGame, teamAbbreviation).name,
        previousWinnerAbbreviation: '',
        reason: 'Previous head-to-head meeting has no final score.',
      },
    }
  }

  if (teamScore === opponentScore) {
    return {
      adjustment: 0,
      quickRematch: {
        eligible: false,
        hoursSincePreviousMeeting: roundAdjustment(hoursSincePreviousMeeting),
        previousGameDate: previousGame.scheduledStart,
        previousGameId: previousGame.gameId,
        previousLoserAbbreviation: '',
        previousOpponentAbbreviation: opponentAbbreviation,
        previousOpponentName: getOpponentTeam(previousGame, teamAbbreviation).name,
        previousWinnerAbbreviation: '',
        reason: 'Previous head-to-head meeting did not have a loser.',
      },
    }
  }

  const teamLostPreviousMeeting = teamScore < opponentScore
  const loserAbbreviation = teamLostPreviousMeeting
    ? teamAbbreviation
    : opponentAbbreviation
  const winnerAbbreviation = teamLostPreviousMeeting
    ? opponentAbbreviation
    : teamAbbreviation

  return {
    adjustment: teamLostPreviousMeeting
      ? normalizedSettings.quickRematchLoserAdjustment
      : 0,
    quickRematch: {
      eligible: teamLostPreviousMeeting,
      hoursSincePreviousMeeting: roundAdjustment(hoursSincePreviousMeeting),
      previousGameDate: previousGame.scheduledStart,
      previousGameId: previousGame.gameId,
      previousLoserAbbreviation: loserAbbreviation,
      previousOpponentAbbreviation: opponentAbbreviation,
      previousOpponentName: getOpponentTeam(previousGame, teamAbbreviation).name,
      previousWinnerAbbreviation: winnerAbbreviation,
      reason: teamLostPreviousMeeting
        ? 'Lost the previous head-to-head meeting inside the configured window.'
        : 'Won the previous head-to-head meeting; no quick rematch penalty is applied.',
    },
  }
}

const calculateTeamGameContext = ({
  currentGame,
  existingContext = {},
  now = new Date(),
  opponentAbbreviation,
  quickRematchSettings = DEFAULT_QUICK_REMATCH_SETTINGS,
  scheduleGames,
  team,
}) => {
  const teamAbbreviation = getTeamKey(team)
  const scheduleAdjustmentSettings =
    normalizeScheduleAdjustmentSettings(quickRematchSettings)

  if (!teamAbbreviation || !currentGame?.scheduledStart) {
    return buildUnavailableTeamContext({
      existingContext,
      reason: 'Current game is missing team or start time data.',
      team,
    })
  }

  const teamScheduleGames = uniqueGamesById(scheduleGames).filter((game) =>
    gameIncludesTeam(game, teamAbbreviation),
  )

  if (teamScheduleGames.length === 0) {
    return buildUnavailableTeamContext({
      existingContext,
      reason: 'Team schedule history is unavailable.',
      team,
    })
  }

  const priorGames = getPriorTeamGames(
    teamScheduleGames,
    currentGame,
    teamAbbreviation,
  )
  const previousGame = priorGames[priorGames.length - 1] ?? null
  const calendarDayDiff = previousGame
    ? getCalendarDayDiff(currentGame.scheduledStart, previousGame.scheduledStart)
    : null
  const restDays =
    Number.isFinite(calendarDayDiff) && calendarDayDiff >= 0
      ? Math.max(0, calendarDayDiff - 1)
      : null
  const isBackToBack = calendarDayDiff === 1
  const fourDayWindow = createScheduleWindowDiagnostics({
    currentGame,
    scheduleGames: teamScheduleGames,
    teamAbbreviation,
    windowDays: 4,
  })
  const sixDayWindow = createScheduleWindowDiagnostics({
    currentGame,
    scheduleGames: teamScheduleGames,
    teamAbbreviation,
    windowDays: 6,
  })
  const gamesInFourDays = fourDayWindow.count
  const gamesInSixDays = sixDayWindow.count
  const restCondition = getRestFatigueCondition({
    currentGame,
    gamesInFourDays,
    gamesInSixDays,
    isBackToBack,
    previousGame,
    restDays,
    teamAbbreviation,
  })
  const restFatigueAdjustmentBreakdown = buildRestFatigueAdjustmentBreakdown(
    restCondition.selectedCondition,
    scheduleAdjustmentSettings,
  )
  const quickRematch = buildQuickRematchContext({
    currentGame,
    now,
    opponentAbbreviation,
    scheduleGames,
    settings: scheduleAdjustmentSettings,
    teamAbbreviation,
  })
  const quickRematchAdjustmentBreakdown = buildQuickRematchAdjustmentBreakdown(
    quickRematch.adjustment,
  )
  const adjustmentBreakdown = [
    ...restFatigueAdjustmentBreakdown,
    ...quickRematchAdjustmentBreakdown,
  ]
  const automaticRestFatigueAdjustment = sumAdjustmentBreakdown(
    adjustmentBreakdown,
    ADJUSTMENT_CATEGORIES.restFatigue,
  )
  const automaticQuickRematchAdjustment = sumAdjustmentBreakdown(
    adjustmentBreakdown,
    ADJUSTMENT_CATEGORIES.quickRematch,
  )
  const manualRestFatigueAdjustment = clampManualAdjustment(
    existingContext.manualRestFatigueAdjustment,
  )
  const manualQuickRematchAdjustment = clampManualAdjustment(
    existingContext.manualQuickRematchAdjustment,
  )
  const restFatigueOverrideEnabled = Boolean(
    existingContext.restFatigueOverrideEnabled,
  )
  const quickRematchOverrideEnabled = Boolean(
    existingContext.quickRematchOverrideEnabled,
  )
  const effectiveRestFatigueAdjustment = restFatigueOverrideEnabled
    ? manualRestFatigueAdjustment
    : automaticRestFatigueAdjustment
  const effectiveQuickRematchAdjustment = quickRematchOverrideEnabled
    ? manualQuickRematchAdjustment
    : automaticQuickRematchAdjustment
  const conditionIds = restCondition.conditionFlags.map(
    getRestFatigueConditionId,
  )
  const appliedConditionIds = new Set(
    adjustmentBreakdown.map((item) => item.condition),
  )
  const informationalConditionIds = conditionIds.filter(
    (condition) =>
      condition !== 'normal' && !appliedConditionIds.has(condition),
  )
  const reasons = [
    ...restCondition.conditionFlags.map(
      (condition) => REST_FATIGUE_CONDITION_LABELS[condition] ?? condition,
    ),
    quickRematch.quickRematch.reason,
  ].filter(Boolean)

  if (!previousGame) {
    reasons.unshift('No previous game in the loaded season.')
  }

  const scheduleWindowDiagnostics = {
    currentGameId: currentGame.gameId,
    currentStartTimeUTC: toIsoString(currentGame.scheduledStart),
    adjustmentBreakdown,
    detectedConditions: conditionIds,
    finalCounts: {
      gamesInFourDays,
      gamesInSixDays,
      automaticRestFatigueAdjustment,
      automaticQuickRematchAdjustment,
    },
    informationalConditions: informationalConditionIds,
    fourDayWindow,
    backToBack: isBackToBack,
    currentHomeTeamId: restCondition.currentHomeTeamId,
    currentTeamSide: restCondition.currentTeamSide,
    currentVenueCity: restCondition.currentVenueCity,
    previousGameId: previousGame?.gameId ?? '',
    previousHomeTeamId: restCondition.previousHomeTeamId,
    previousTeamSide: restCondition.previousTeamSide,
    previousVenueCity: restCondition.previousVenueCity,
    sameAwayHomeTeam: restCondition.sameAwayHomeTeam,
    selectedCondition: getRestFatigueConditionId(restCondition.selectedCondition),
    sixDayWindow,
    teamAbbreviation,
    teamId: team.teamId ?? teamAbbreviation,
    travelBetweenGames: restCondition.travelBetweenGames,
    travelClassificationSource: restCondition.travelClassificationSource,
  }

  logScheduleWindowDiagnostics(scheduleWindowDiagnostics)

  return {
    adjustmentBreakdown,
    automaticQuickRematchAdjustment,
    automaticRestFatigueAdjustment,
    conditions: conditionIds,
    dataStatus: 'available',
    effectiveQuickRematchAdjustment,
    effectiveRestFatigueAdjustment,
    gamesInFourDays,
    gamesInSixDays,
    backToBack: isBackToBack,
    currentHomeTeamId: restCondition.currentHomeTeamId,
    currentTeamSide: restCondition.currentTeamSide,
    currentVenueCity: restCondition.currentVenueCity,
    hasMeaningfulTravel: restCondition.hasMeaningfulTravel,
    isBackToBack,
    manualQuickRematchAdjustment,
    manualRestFatigueAdjustment,
    previousHomeTeamId: restCondition.previousHomeTeamId,
    previousTeamSide: restCondition.previousTeamSide,
    previousVenueCity: restCondition.previousVenueCity,
    quickRematch: quickRematch.quickRematch,
    quickRematchOverrideEnabled,
    reasons,
    restDays,
    restFatigueCondition: getRestFatigueConditionId(
      restCondition.selectedCondition,
    ),
    restFatigueOverrideEnabled,
    sameAwayHomeTeam: restCondition.sameAwayHomeTeam,
    scheduleWindowDiagnostics,
    team: serializeTeam(team),
    totalGameContextAdjustment: roundAdjustment(
      effectiveRestFatigueAdjustment + effectiveQuickRematchAdjustment,
    ),
    travelBetweenGames: restCondition.travelBetweenGames,
    travelClassificationSource: restCondition.travelClassificationSource,
  }
}

const calculateGameContextForGame = ({
  awayScheduleGames = [],
  currentGame,
  existingContext = {},
  homeScheduleGames = [],
  now = new Date(),
  quickRematchSettings = DEFAULT_QUICK_REMATCH_SETTINGS,
}) => {
  const normalizedGame = normalizeGame(currentGame)
  const scheduleGames = uniqueGamesById([
    ...awayScheduleGames,
    ...homeScheduleGames,
    normalizedGame,
  ])
  const awayContext = calculateTeamGameContext({
    currentGame: normalizedGame,
    existingContext: existingContext.awayContext ?? {},
    now,
    opponentAbbreviation: getTeamKey(normalizedGame.homeTeam),
    quickRematchSettings,
    scheduleGames,
    team: normalizedGame.awayTeam,
  })
  const homeContext = calculateTeamGameContext({
    currentGame: normalizedGame,
    existingContext: existingContext.homeContext ?? {},
    now,
    opponentAbbreviation: getTeamKey(normalizedGame.awayTeam),
    quickRematchSettings,
    scheduleGames,
    team: normalizedGame.homeTeam,
  })
  const lastCalculatedAt = now

  return {
    awayContext,
    awayTeam: serializeTeam(normalizedGame.awayTeam),
    gameId: normalizedGame.gameId,
    gameState: normalizedGame.gameState,
    homeContext,
    homeTeam: serializeTeam(normalizedGame.homeTeam),
    lastCalculatedAt,
    scheduledStart: normalizedGame.scheduledStart,
    sourceVersion: SOURCE_VERSION,
    status: normalizedGame.status,
  }
}

const normalizeOverridePayload = (payload = {}) => {
  if (!isPlainObject(payload)) {
    throw new GameContextError('Request body must be an object.', 400)
  }

  const allowedSides = ['awayContext', 'homeContext']
  const unsupportedTopLevelFields = Object.keys(payload).filter(
    (field) => !allowedSides.includes(field),
  )

  if (unsupportedTopLevelFields.length > 0) {
    throw new GameContextError(
      'Request body contains unsupported game context fields.',
      400,
      { unsupportedFields: unsupportedTopLevelFields },
    )
  }

  const updates = {}
  const fieldErrors = {}

  allowedSides.forEach((side) => {
    if (!Object.hasOwn(payload, side)) {
      return
    }

    const sidePayload = payload[side]

    if (!isPlainObject(sidePayload)) {
      fieldErrors[side] = `${side} must be an object.`
      return
    }

    const allowedFields = [
      'manualQuickRematchAdjustment',
      'manualRestFatigueAdjustment',
      'quickRematchOverrideEnabled',
      'restFatigueOverrideEnabled',
    ]
    const unsupportedFields = Object.keys(sidePayload).filter(
      (field) => !allowedFields.includes(field),
    )

    if (unsupportedFields.length > 0) {
      fieldErrors[side] = `${side} contains unsupported fields: ${unsupportedFields.join(
        ', ',
      )}.`
      return
    }

    if (Object.hasOwn(sidePayload, 'restFatigueOverrideEnabled')) {
      updates[`${side}.restFatigueOverrideEnabled`] = Boolean(
        sidePayload.restFatigueOverrideEnabled,
      )
    }

    if (Object.hasOwn(sidePayload, 'quickRematchOverrideEnabled')) {
      updates[`${side}.quickRematchOverrideEnabled`] = Boolean(
        sidePayload.quickRematchOverrideEnabled,
      )
    }

    ;['manualRestFatigueAdjustment', 'manualQuickRematchAdjustment'].forEach(
      (field) => {
        if (!Object.hasOwn(sidePayload, field)) {
          return
        }

        const value = Number(sidePayload[field])

        if (
          !Number.isFinite(value) ||
          value < MANUAL_ADJUSTMENT_LIMITS.min ||
          value > MANUAL_ADJUSTMENT_LIMITS.max
        ) {
          fieldErrors[`${side}.${field}`] =
            `${field} must be between -3 and 3.`
          return
        }

        updates[`${side}.${field}`] = roundAdjustment(value)
      },
    )
  })

  if (Object.keys(fieldErrors).length > 0) {
    throw new GameContextError('Game context override validation failed.', 400, {
      fieldErrors,
    })
  }

  if (Object.keys(updates).length === 0) {
    throw new GameContextError(
      'At least one game context override field is required.',
      400,
    )
  }

  return updates
}

module.exports = {
  ADJUSTMENT_CATEGORIES,
  GameContextError,
  MANUAL_ADJUSTMENT_LIMITS,
  MS_PER_DAY,
  QUICK_REMATCH_CONDITION_ID,
  REST_FATIGUE_ADJUSTMENTS,
  REST_FATIGUE_CONDITION_LABELS,
  REST_FATIGUE_PRECEDENCE,
  SOURCE_VERSION,
  WINDOW_BOUNDARY_MODE,
  buildQuickRematchContext,
  calculateGameContextForGame,
  calculateTeamGameContext,
  classifyBackToBackTravel,
  clampManualAdjustment,
  createScheduleWindowDiagnostics,
  deriveSeasonIdFromDate,
  hasGameStarted,
  normalizeGame,
  normalizeOverridePayload,
  roundAdjustment,
  serializeTeam,
}
