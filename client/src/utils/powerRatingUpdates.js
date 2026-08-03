import {
  formatPowerRatingDisplayValue,
  formatSignedPowerRatingDisplayValue,
} from './powerRatings.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

export const POWER_RATING_UPDATE_RANGE_DAYS = 7
export const MAX_POWER_RATING_UPDATE_RANGE_DAYS = 31
export const PROCESSED_GAMES_PREVIEW_LIMIT = 8
export const AUTOMATIC_POWER_RATING_UPDATE_STATUSES = Object.freeze({
  PARTIAL: 'partial',
  REQUIRES_INITIALIZATION: 'requires_initialization',
  UNAVAILABLE: 'unavailable',
  UPDATED: 'updated',
  UP_TO_DATE: 'up_to_date',
})

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const padDatePart = (value) => String(value).padStart(2, '0')

const startOfLocalDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const addLocalDays = (date, days) => {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)

  return startOfLocalDay(nextDate)
}

const toLocalDaySerial = (date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const toSummaryCount = (value, field) => {
  const numberValue = Number(value)

  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`Power Rating update response has invalid ${field}.`)
  }

  return numberValue
}

const normalizeTeamAbbreviation = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const normalizeDateString = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  return value.trim().slice(0, 10)
}

export const formatLocalDateInputValue = (date = new Date()) =>
  [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-')

export const parseLocalDateInputValue = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return null
  }

  const [year, month, day] = value.split('-').map(Number)
  const parsedDate = new Date(year, month - 1, day)

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null
  }

  return startOfLocalDay(parsedDate)
}

export const createDefaultPowerRatingUpdateRange = (todayDate = new Date()) => {
  const today = startOfLocalDay(todayDate)
  const from = addLocalDays(today, -(POWER_RATING_UPDATE_RANGE_DAYS - 1))

  return {
    from: formatLocalDateInputValue(from),
    to: formatLocalDateInputValue(today),
  }
}

export const getPowerRatingUpdateRangeDayCount = ({ from, to }) => {
  const fromDate = parseLocalDateInputValue(from)
  const toDate = parseLocalDateInputValue(to)

  if (!fromDate || !toDate) {
    return 0
  }

  return toLocalDaySerial(toDate) - toLocalDaySerial(fromDate) + 1
}

export const validatePowerRatingUpdateRange = (
  range = {},
  { maxDays = MAX_POWER_RATING_UPDATE_RANGE_DAYS, today = new Date() } = {},
) => {
  const fieldErrors = {}
  const todayDate =
    typeof today === 'string'
      ? parseLocalDateInputValue(today)
      : startOfLocalDay(today)
  const fromDate = parseLocalDateInputValue(range.from)
  const toDate = parseLocalDateInputValue(range.to)

  if (!fromDate) {
    fieldErrors.from = 'Date From must use YYYY-MM-DD.'
  }

  if (!toDate) {
    fieldErrors.to = 'Date To must use YYYY-MM-DD.'
  }

  if (!todayDate) {
    fieldErrors.to = 'Today must use YYYY-MM-DD.'
  }

  if (fromDate && todayDate && toLocalDaySerial(fromDate) > toLocalDaySerial(todayDate)) {
    fieldErrors.from = 'Date From cannot be in the future.'
  }

  if (toDate && todayDate && toLocalDaySerial(toDate) > toLocalDaySerial(todayDate)) {
    fieldErrors.to = 'Date To cannot be in the future.'
  }

  if (
    fromDate &&
    toDate &&
    toLocalDaySerial(fromDate) > toLocalDaySerial(toDate)
  ) {
    fieldErrors.from = 'Date From must be on or before Date To.'
  }

  const dayCount =
    fromDate && toDate
      ? toLocalDaySerial(toDate) - toLocalDaySerial(fromDate) + 1
      : 0

  if (dayCount > maxDays) {
    fieldErrors.to = `Manual updates are limited to ${maxDays} days.`
  }

  const message = Object.values(fieldErrors)[0] ?? ''

  return {
    dayCount,
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    message,
  }
}

export const buildPowerRatingUpdateRequestBody = (range = {}) => {
  const validation = validatePowerRatingUpdateRange(range)

  if (!validation.isValid) {
    throw new Error(validation.message)
  }

  return {
    from: range.from,
    to: range.to,
  }
}

export const buildAutomaticPowerRatingUpdateRequestBody = ({
  throughDate,
} = {}) => {
  if (throughDate === undefined || throughDate === null || throughDate === '') {
    return {}
  }

  if (typeof throughDate !== 'string' || !DATE_PATTERN.test(throughDate)) {
    throw new Error('throughDate must use YYYY-MM-DD.')
  }

  return {
    throughDate,
  }
}

const normalizePowerRatingUpdateError = (error = {}) => ({
  code: typeof error.code === 'string' ? error.code : '',
  gameId:
    error.gameId === null || error.gameId === undefined
      ? null
      : String(error.gameId),
  reason:
    typeof error.reason === 'string' && error.reason.trim()
      ? error.reason.trim()
      : 'Unknown update issue.',
})

const normalizeProcessedGame = (game = {}) => ({
  gameDate: normalizeDateString(game.gameDate),
  gameId:
    game.gameId === null || game.gameId === undefined
      ? null
      : String(game.gameId),
  awayTeam: normalizeTeamAbbreviation(
    game.awayTeam ?? game.awayTeamAbbreviation,
  ),
  homeTeam: normalizeTeamAbbreviation(
    game.homeTeam ?? game.homeTeamAbbreviation,
  ),
  awayScore: toOptionalNumber(game.awayScore),
  homeScore: toOptionalNumber(game.homeScore),
  result: typeof game.result === 'string' ? game.result : '',
  resultType: typeof game.resultType === 'string' ? game.resultType : '',
  awayRatingBefore: toOptionalNumber(game.awayRatingBefore),
  awayRatingAfter: toOptionalNumber(game.awayRatingAfter),
  awayRatingChange: toOptionalNumber(game.awayRatingChange),
  homeRatingBefore: toOptionalNumber(game.homeRatingBefore),
  homeRatingAfter: toOptionalNumber(game.homeRatingAfter),
  homeRatingChange: toOptionalNumber(game.homeRatingChange),
})

const normalizeEngineSettingsSnapshot = (settings = {}) => {
  if (!isPlainObject(settings)) {
    return null
  }

  return {
    homeAdvantage: toOptionalNumber(settings.homeAdvantage),
    kFactor: toOptionalNumber(settings.kFactor),
    modelVersion:
      typeof settings.modelVersion === 'string' ? settings.modelVersion : '',
    overtimeMultiplier: toOptionalNumber(settings.overtimeMultiplier),
    regulationMultiplier: toOptionalNumber(settings.regulationMultiplier),
    shootoutMultiplier: toOptionalNumber(settings.shootoutMultiplier),
  }
}

const normalizeLatestProcessedGame = (game = {}) => {
  if (!isPlainObject(game)) {
    return null
  }

  return {
    awayScore: toOptionalNumber(game.awayScore),
    awayTeam: normalizeTeamAbbreviation(
      game.awayTeam ?? game.awayTeamAbbreviation,
    ),
    gameDate: normalizeDateString(game.gameDate),
    gameId:
      game.gameId === null || game.gameId === undefined
        ? null
        : String(game.gameId),
    homeScore: toOptionalNumber(game.homeScore),
    homeTeam: normalizeTeamAbbreviation(
      game.homeTeam ?? game.homeTeamAbbreviation,
    ),
    processedAt:
      typeof game.processedAt === 'string' && game.processedAt.trim()
        ? game.processedAt.trim()
        : '',
    result: typeof game.result === 'string' ? game.result : '',
    resultType: typeof game.resultType === 'string' ? game.resultType : '',
    settingsSnapshot: normalizeEngineSettingsSnapshot(
      game.settingsSnapshot ?? game.engineSettingsSnapshot,
    ),
  }
}

const normalizeAutomaticPowerRatingDateRange = (dateRange) =>
  isPlainObject(dateRange)
    ? {
        from: normalizeDateString(dateRange.from),
        to: normalizeDateString(dateRange.to),
      }
    : null

export const normalizePowerRatingUpdateResult = (data = {}) => {
  if (!isPlainObject(data)) {
    throw new Error('Power Rating update response was malformed.')
  }

  if (typeof data.success !== 'boolean') {
    throw new Error('Power Rating update response was malformed.')
  }

  if (
    !isPlainObject(data.dateRange) ||
    typeof data.dateRange.from !== 'string' ||
    typeof data.dateRange.to !== 'string' ||
    !Array.isArray(data.errors) ||
    !Array.isArray(data.processedGames)
  ) {
    throw new Error('Power Rating update response was malformed.')
  }

  return {
    success: data.success,
    dateRange: {
      from: data.dateRange.from,
      to: data.dateRange.to,
    },
    gamesFound: toSummaryCount(data.gamesFound, 'gamesFound'),
    gamesAlreadyProcessed: toSummaryCount(
      data.gamesAlreadyProcessed,
      'gamesAlreadyProcessed',
    ),
    gamesProcessed: toSummaryCount(data.gamesProcessed, 'gamesProcessed'),
    gamesSkipped: toSummaryCount(data.gamesSkipped, 'gamesSkipped'),
    errors: data.errors.map(normalizePowerRatingUpdateError),
    processedGames: data.processedGames.map(normalizeProcessedGame),
  }
}

export const normalizeAutomaticPowerRatingUpdateResult = (data = {}) => {
  if (!isPlainObject(data)) {
    throw new Error('Automatic Power Rating update response was malformed.')
  }

  const statuses = Object.values(AUTOMATIC_POWER_RATING_UPDATE_STATUSES)

  if (!statuses.includes(data.status)) {
    throw new Error('Automatic Power Rating update response was malformed.')
  }

  if (!Array.isArray(data.errors) || !Array.isArray(data.processedGames)) {
    throw new Error('Automatic Power Rating update response was malformed.')
  }

  return {
    dateRange: normalizeAutomaticPowerRatingDateRange(data.dateRange),
    errors: data.errors.map(normalizePowerRatingUpdateError),
    gamesAlreadyProcessed: toSummaryCount(
      data.gamesAlreadyProcessed,
      'gamesAlreadyProcessed',
    ),
    gamesFound: toSummaryCount(data.gamesFound, 'gamesFound'),
    gamesProcessed: toSummaryCount(data.gamesProcessed, 'gamesProcessed'),
    gamesSkipped: toSummaryCount(data.gamesSkipped, 'gamesSkipped'),
    latestProcessedGame: normalizeLatestProcessedGame(
      data.latestProcessedGame,
    ),
    message:
      typeof data.message === 'string' && data.message.trim()
        ? data.message.trim()
        : '',
    processedGames: data.processedGames.map(normalizeProcessedGame),
    ratingSettingsUsed: normalizeEngineSettingsSnapshot(
      data.ratingSettingsUsed,
    ),
    status: data.status,
    success: Boolean(data.success),
  }
}

export const formatPowerRatingNumber = (value) =>
  formatPowerRatingDisplayValue(value, { fallback: '--' })

export const formatSignedRatingChange = formatSignedPowerRatingDisplayValue

export const formatResultTypeLabel = (resultType = '') => {
  const normalizedResultType = String(resultType).trim().toUpperCase()

  if (normalizedResultType === 'REGULATION') {
    return 'Regulation'
  }

  if (normalizedResultType === 'OVERTIME') {
    return 'Overtime'
  }

  if (normalizedResultType === 'SHOOTOUT') {
    return 'Shootout'
  }

  return normalizedResultType || 'Unknown'
}

export const getPowerRatingUpdateOutcomeTone = (result) => {
  if (!result) {
    return ''
  }

  if (result.gamesProcessed > 0 && result.errors.length === 0) {
    return 'success'
  }

  if (result.gamesProcessed > 0) {
    return 'warning'
  }

  if (result.errors.length > 0) {
    return 'error'
  }

  return 'neutral'
}

export const getPowerRatingUpdateOutcomeMessage = (result) => {
  if (!result) {
    return ''
  }

  if (result.gamesProcessed > 0 && result.errors.length > 0) {
    return `${result.gamesProcessed} ${
      result.gamesProcessed === 1 ? 'game was' : 'games were'
    } processed. Review skipped games and errors below.`
  }

  if (result.gamesProcessed > 0) {
    return `${result.gamesProcessed} ${
      result.gamesProcessed === 1 ? 'game was' : 'games were'
    } processed successfully.`
  }

  if (result.errors.length > 0) {
    return 'No games were processed. Review skipped games and errors below.'
  }

  if (result.gamesAlreadyProcessed > 0) {
    return 'No new completed games were available. All eligible games in this range were already processed.'
  }

  return 'No completed NHL regular-season games were available in this range.'
}

export const getMostRecentProcessedGameDate = (processedGames = []) =>
  processedGames
    .map((game) => game.gameDate)
    .filter(Boolean)
    .sort()
    .at(-1) ?? ''

export const getVisibleProcessedGames = (
  processedGames = [],
  { limit = PROCESSED_GAMES_PREVIEW_LIMIT, showAll = false } = {},
) => {
  const safeGames = Array.isArray(processedGames) ? processedGames : []
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 0

  return showAll ? safeGames : safeGames.slice(0, safeLimit)
}

export const hasHiddenProcessedGames = (
  processedGames = [],
  { limit = PROCESSED_GAMES_PREVIEW_LIMIT, showAll = false } = {},
) =>
  !showAll &&
  Array.isArray(processedGames) &&
  processedGames.length > limit

export const canRunPowerRatingUpdate = ({
  hasUnsavedRatings = false,
  isUpdating = false,
  validation,
} = {}) => Boolean(validation?.isValid) && !hasUnsavedRatings && !isUpdating
