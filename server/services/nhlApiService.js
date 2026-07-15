const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1'
const NHL_TIME_ZONE = 'America/New_York'
const REQUEST_TIMEOUT_MS = 8000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

class NhlApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'NhlApiError'
    this.statusCode = options.statusCode ?? 502
    this.upstreamStatus = options.upstreamStatus
    this.cause = options.cause
  }
}

const gameStateLabels = {
  FUT: 'Scheduled',
  PRE: 'Pregame',
  LIVE: 'Live',
  CRIT: 'Critical',
  FINAL: 'Final',
  OFF: 'Final',
  POST: 'Postponed',
}

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  return value?.default ?? ''
}

const getTeamName = (team = {}) => {
  const placeName = getLocalizedValue(team.placeName)
  const commonName = getLocalizedValue(team.commonName)
  const fullName = getLocalizedValue(team.name)

  if (fullName) {
    return fullName
  }

  if (placeName && commonName) {
    return `${placeName} ${commonName}`
  }

  return commonName || placeName || team.abbrev || 'TBD'
}

const getGameStatus = (game = {}) => {
  if (game.gameScheduleState === 'PPD') {
    return 'Postponed'
  }

  return gameStateLabels[game.gameState] ?? game.gameState ?? 'Unknown'
}

const simplifyTeam = (team = {}) => ({
  name: getTeamName(team),
  abbreviation: team.abbrev ?? '',
  logo: team.logo ?? team.darkLogo ?? '',
  score: Number.isFinite(team.score) ? team.score : null,
})

const simplifyGame = (game = {}) => ({
  gameId: game.id,
  startTimeUTC: game.startTimeUTC,
  homeTeam: simplifyTeam(game.homeTeam),
  awayTeam: simplifyTeam(game.awayTeam),
  gameState: game.gameState ?? 'UNKNOWN',
  status: getGameStatus(game),
})

const formatDateInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return `${values.year}-${values.month}-${values.day}`
}

const getTodayNhlDate = () => formatDateInTimeZone(new Date(), NHL_TIME_ZONE)

const isValidScheduleDate = (date) => {
  if (!DATE_PATTERN.test(date)) {
    return false
  }

  const [year, month, day] = date.split('-').map(Number)
  const parsedDate = new Date(Date.UTC(year, month - 1, day))

  return (
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day
  )
}

const requestNhlApi = async (path) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${NHL_API_BASE_URL}${path}`, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new NhlApiError('NHL API returned an unsuccessful response.', {
        upstreamStatus: response.status,
      })
    }

    return await response.json()
  } catch (error) {
    if (error instanceof NhlApiError) {
      throw error
    }

    const isTimeout = error.name === 'AbortError'

    throw new NhlApiError(
      isTimeout
        ? 'NHL API request timed out.'
        : 'Unable to reach the NHL API.',
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }
}

const getScheduleForDate = async (date) => requestNhlApi(`/schedule/${date}`)

const getGamesForDate = async (date) => {
  const schedule = await getScheduleForDate(date)
  const scheduleDay = schedule.gameWeek?.find((day) => day.date === date)
  const games = scheduleDay?.games ?? []

  return {
    date,
    games: games.map(simplifyGame),
  }
}

const getTodaysGames = async () => getGamesForDate(getTodayNhlDate())

module.exports = {
  NhlApiError,
  getGamesForDate,
  getScheduleForDate,
  getTodayNhlDate,
  getTodaysGames,
  isValidScheduleDate,
}
