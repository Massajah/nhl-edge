const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1'
const NHL_STATS_API_BASE_URL = 'https://api.nhle.com/stats/rest/en'
const { getKnownTeamById } = require('./teamCatalogService')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const NHL_TIME_ZONE = 'America/New_York'
const REQUEST_TIMEOUT_MS = 8000
const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_NHL_API_CONCURRENCY_LIMIT = 3
const DEFAULT_NHL_API_MAX_RETRIES = 1
const NHL_API_RETRY_BASE_DELAY_MS = 250
const NHL_API_RETRY_MAX_DELAY_MS = 5000
const NHL_API_CACHE_TTLS_MS = Object.freeze({
  currentSchedule: 30 * 1000,
  default: 5 * 60 * 1000,
  futureSchedule: 15 * 60 * 1000,
  historicalSchedule: 30 * 24 * 60 * 60 * 1000,
})
const REGULAR_SEASON_GAME_TYPE_ID = 2
const SPECIAL_TEAMS_CACHE_TTL_MS = 8 * 60 * 60 * 1000
const GOALIE_STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TEAM_ABBREVIATION_PATTERN = /^[A-Z]{2,4}$/
const PLAYER_ID_PATTERN = /^\d+$/

let statsTeamDirectoryPromise = null
let leagueSpecialTeamsStatsCache = null
let leagueSpecialTeamsStatsPromise = null
const goalieStatsCache = new Map()
const goalieStatsPromises = new Map()
const goalieSeasonStatsCache = new Map()
const goalieSeasonStatsPromises = new Map()
const nhlApiResponseCache = new Map()
const nhlApiInFlightRequests = new Map()
const historicalScheduleRangeCache = new Map()
const historicalScheduleRangePromises = new Map()

class NhlApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'NhlApiError'
    this.statusCode = options.statusCode ?? 500
    this.upstreamStatus = options.upstreamStatus
    this.publicMessage = options.publicMessage
    this.retryAfterMs = options.retryAfterMs
    this.cause = options.cause
  }
}

const sleep = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })

const normalizeRequestPath = (path) => String(path ?? '').trim()

const getHeaderValue = (headers, headerName) => {
  if (!headers) {
    return null
  }

  if (typeof headers.get === 'function') {
    return headers.get(headerName)
  }

  return headers[headerName] ?? headers[headerName.toLowerCase()] ?? null
}

const parseRetryAfterMs = (headers) => {
  const retryAfter = getHeaderValue(headers, 'Retry-After')

  if (!retryAfter) {
    return null
  }

  const seconds = Number(retryAfter)

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const retryAt = Date.parse(retryAfter)

  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null
}

const getUtcDateValue = (date = new Date()) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const getScheduleCacheTtlMs = (path, now = new Date()) => {
  const scheduleMatch = normalizeRequestPath(path).match(/^\/schedule\/(.+)$/)

  if (!scheduleMatch || !isValidScheduleDate(scheduleMatch[1])) {
    return NHL_API_CACHE_TTLS_MS.default
  }

  const requestDate = scheduleMatch[1]
  const today = getTodayNhlDate(now)

  if (requestDate < today) {
    return NHL_API_CACHE_TTLS_MS.historicalSchedule
  }

  if (requestDate === today) {
    return NHL_API_CACHE_TTLS_MS.currentSchedule
  }

  return NHL_API_CACHE_TTLS_MS.futureSchedule
}

const getCacheTtlMs = (path, now = new Date()) => {
  const normalizedPath = normalizeRequestPath(path)

  if (normalizedPath.startsWith('/schedule/')) {
    return getScheduleCacheTtlMs(normalizedPath, now)
  }

  if (normalizedPath.startsWith('/club-schedule-season/')) {
    return NHL_API_CACHE_TTLS_MS.historicalSchedule
  }

  return NHL_API_CACHE_TTLS_MS.default
}

const createConcurrencyLimiter = (limit = DEFAULT_NHL_API_CONCURRENCY_LIMIT) => {
  const maxConcurrent = Math.max(1, Number(limit) || 1)
  const queue = []
  let activeCount = 0

  const pump = () => {
    if (activeCount >= maxConcurrent || queue.length === 0) {
      return
    }

    const next = queue.shift()
    activeCount += 1

    next
      .task()
      .then(next.resolve, next.reject)
      .finally(() => {
        activeCount -= 1
        pump()
      })
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({
          reject,
          resolve,
          task,
        })
        pump()
      })
    },
  }
}

const defaultNhlLimiter = createConcurrencyLimiter()

const createNhlApiRequester = ({
  cache = new Map(),
  concurrencyLimit = DEFAULT_NHL_API_CONCURRENCY_LIMIT,
  fetchImpl = fetch,
  inFlightRequests = new Map(),
  jitterMs = () => Math.floor(Math.random() * 100),
  limiter = createConcurrencyLimiter(concurrencyLimit),
  logger = console,
  maxRetries = DEFAULT_NHL_API_MAX_RETRIES,
  now = () => Date.now(),
  sleepImpl = sleep,
} = {}) => {
  const logDevelopmentRequest = ({ cacheStatus, key, path }) => {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.NHL_EDGE_API_DEBUG !== 'true'
    ) {
      return
    }

    logger.debug?.('NHL API request', {
      cacheStatus,
      caller: 'nhlApiService',
      endpointUrl: key,
      path,
      requestStartTime: new Date(now()).toISOString(),
    })
  }

  const logDevelopmentEvent = (message, details) => {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.NHL_EDGE_API_DEBUG !== 'true'
    ) {
      return
    }

    logger.debug?.(message, details)
  }

  const executeFetch = async ({ baseUrl, path }) => {
    let attempt = 0

    while (attempt <= maxRetries) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        })

        if (response.ok) {
          return await response.json()
        }

        const retryAfterMs = parseRetryAfterMs(response.headers)

        if (response.status === 429 && attempt < maxRetries) {
          const delayMs = retryAfterMs === null
            ? Math.min(
                NHL_API_RETRY_MAX_DELAY_MS,
                NHL_API_RETRY_BASE_DELAY_MS * 2 ** attempt + jitterMs(),
              )
            : Math.min(retryAfterMs, NHL_API_RETRY_MAX_DELAY_MS)

          logDevelopmentEvent('NHL API 429 retry', {
            attempt: attempt + 1,
            delayMs,
            path,
          })
          await sleepImpl(delayMs)
          attempt += 1
          continue
        }

        throw new NhlApiError('NHL API returned an unsuccessful response.', {
          publicMessage:
            response.status === 429
              ? 'NHL API rate limit reached. Try again shortly.'
              : undefined,
          retryAfterMs,
          statusCode: response.status === 429 ? 429 : 500,
          upstreamStatus: response.status,
        })
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

    throw new NhlApiError('NHL API returned an unsuccessful response.')
  }

  const selectResult = (result, includeMetadata) =>
    includeMetadata ? result : result.data

  const resolveRequest = async (
    requestPromise,
    cachedResponse,
    { allowStale = false, includeMetadata = false } = {},
  ) => {
    try {
      return selectResult(await requestPromise, includeMetadata)
    } catch (error) {
      if (
        cachedResponse?.data &&
        (allowStale || error.upstreamStatus === 429)
      ) {
        logDevelopmentEvent('NHL API stale-cache fallback', {
          upstreamStatus: error.upstreamStatus,
        })

        return selectResult({
          data: cachedResponse.data,
          fetchedAt: cachedResponse.fetchedAt ?? null,
          source: 'stale_cache',
          stale: true,
        }, includeMetadata)
      }

      throw error
    }
  }

  return async (baseUrl, rawPath, options = {}) => {
    const path = normalizeRequestPath(rawPath)
    const key = `${baseUrl}${path}`
    const cachedResponse = cache.get(key)
    const nowMs = now()

    if (cachedResponse && cachedResponse.expiresAt > nowMs) {
      logDevelopmentRequest({ cacheStatus: 'hit', key, path })
      return selectResult({
        data: cachedResponse.data,
        fetchedAt: cachedResponse.fetchedAt ?? null,
        source: 'cache',
        stale: false,
      }, options.includeMetadata)
    }

    if (inFlightRequests.has(key)) {
      logDevelopmentRequest({ cacheStatus: 'in_flight', key, path })
      return resolveRequest(
        inFlightRequests.get(key),
        cachedResponse,
        options,
      )
    }

    logDevelopmentRequest({
      cacheStatus: cachedResponse ? 'stale' : 'miss',
      key,
      path,
    })

    const requestPromise = limiter
      .run(() => executeFetch({ baseUrl, path }))
      .then((data) => {
        const fetchedAt = new Date(now()).toISOString()

        cache.set(key, {
          data,
          expiresAt: now() + getCacheTtlMs(path, new Date(now())),
          fetchedAt,
        })

        return {
          data,
          fetchedAt,
          source: 'live',
          stale: false,
        }
      })
      .finally(() => {
        inFlightRequests.delete(key)
      })

    inFlightRequests.set(key, requestPromise)

    return resolveRequest(requestPromise, cachedResponse, options)
  }
}

const requestNhlResourceWithCache = createNhlApiRequester({
  cache: nhlApiResponseCache,
  inFlightRequests: nhlApiInFlightRequests,
  limiter: defaultNhlLimiter,
})

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

const getStandingTeamName = (standing = {}) =>
  getLocalizedValue(standing.teamName) ||
  getLocalizedValue(standing.teamCommonName) ||
  getLocalizedValue(standing.teamPlaceName) ||
  getLocalizedValue(standing.teamAbbrev) ||
  'Unknown Team'

const getTeamAbbreviation = (team = {}) =>
  getLocalizedValue(team.teamAbbrev ?? team.abbrev ?? team.abbreviation)
    .trim()
    .toUpperCase()

const getConferenceName = (standing = {}) =>
  getLocalizedValue(standing.conferenceName) ||
  standing.conferenceAbbrev ||
  ''

const getDivisionName = (standing = {}) =>
  getLocalizedValue(standing.divisionName) || standing.divisionAbbrev || ''

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

const getVenueCity = (game = {}) => {
  const rawLocation =
    getLocalizedValue(game.venueCity) ||
    getLocalizedValue(game.venueCityName) ||
    getLocalizedValue(game.venueLocation) ||
    getLocalizedValue(game.venue?.city) ||
    getLocalizedValue(game.venue?.location) ||
    getLocalizedValue(game.venue?.venueLocation)

  return rawLocation ? rawLocation.split(',')[0].trim() : ''
}

const simplifyGame = (game = {}) => ({
  gameId: game.id,
  gameType: game.gameType ?? null,
  season: game.season ?? null,
  startTimeUTC: game.startTimeUTC,
  homeTeam: simplifyTeam(game.homeTeam),
  awayTeam: simplifyTeam(game.awayTeam),
  gameState: game.gameState ?? 'UNKNOWN',
  gameOutcome: game.gameOutcome ?? null,
  periodDescriptor: game.periodDescriptor ?? null,
  status: getGameStatus(game),
  venueCity: getVenueCity(game),
  venueLocation: getLocalizedValue(game.venueLocation),
  venueName: getLocalizedValue(game.venueName) || getLocalizedValue(game.venue),
})

const simplifyStandingTeam = (standing = {}) => ({
  name: getStandingTeamName(standing),
  abbreviation: getTeamAbbreviation(standing),
  logo: standing.teamLogo ?? '',
  conference: getConferenceName(standing),
  division: getDivisionName(standing),
})

const formatHeight = (heightInInches) => {
  if (!Number.isFinite(heightInInches)) {
    return ''
  }

  const feet = Math.floor(heightInInches / 12)
  const inches = heightInInches % 12

  return `${feet}' ${inches}"`
}

const formatWeight = (weightInPounds) =>
  Number.isFinite(weightInPounds) ? `${weightInPounds} lb` : ''

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const getPlayerFullName = (player = {}) => {
  const fullName = getLocalizedValue(player.fullName)
  const firstName = getLocalizedValue(player.firstName)
  const lastName = getLocalizedValue(player.lastName)

  if (fullName) {
    return fullName
  }

  return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown Player'
}

const normalizePlayer = (player = {}) => {
  const heightInInches = toOptionalNumber(player.heightInInches)
  const weightInPounds = toOptionalNumber(player.weightInPounds)

  return {
    id: player.id ?? null,
    fullName: getPlayerFullName(player),
    position: player.positionCode ?? player.position ?? '',
    sweaterNumber: player.sweaterNumber ? String(player.sweaterNumber) : '',
    shootsCatches: player.shootsCatches ?? '',
    height: formatHeight(heightInInches),
    heightInInches: Number.isFinite(heightInInches) ? heightInInches : null,
    weight: formatWeight(weightInPounds),
    weightInPounds: Number.isFinite(weightInPounds) ? weightInPounds : null,
    birthDate: player.birthDate ?? '',
    nationality: player.birthCountry ?? player.nationality ?? '',
    headshot: player.headshot ?? '',
  }
}

const normalizeRosterGroup = (players) =>
  (Array.isArray(players) ? players : []).map(normalizePlayer)

const normalizeTeamAbbreviation = (teamAbbreviation = '') =>
  String(teamAbbreviation).trim().toUpperCase()

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

const getTodayNhlDate = (date = new Date()) =>
  formatDateInTimeZone(date, NHL_TIME_ZONE)

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

const isValidTeamAbbreviation = (teamAbbreviation) =>
  TEAM_ABBREVIATION_PATTERN.test(normalizeTeamAbbreviation(teamAbbreviation))

const normalizePlayerId = (playerId = '') => String(playerId).trim()

const isValidPlayerId = (playerId) =>
  PLAYER_ID_PATTERN.test(normalizePlayerId(playerId))

const requestNhlResource = async (baseUrl, path, options) =>
  requestNhlResourceWithCache(baseUrl, path, options)

const requestNhlApi = async (path, options) =>
  requestNhlResource(NHL_API_BASE_URL, path, options)

const requestNhlStatsApi = async (path, options) =>
  requestNhlResource(NHL_STATS_API_BASE_URL, path, options)

const getProviderStatus = (source) => {
  if (source === 'cache') {
    return 'cached'
  }

  if (source === 'stale_cache') {
    return 'stale'
  }

  return 'ready'
}

const serializeProviderState = (data, metadata, includeProviderState) => {
  if (!includeProviderState) {
    return data
  }

  return {
    data,
    fetchedAt: metadata?.fetchedAt ?? null,
    source: metadata?.source ?? 'live',
    stale: Boolean(metadata?.stale),
    status: getProviderStatus(metadata?.source),
  }
}

const roundToOneDecimal = (value) => Number(value.toFixed(1))

const roundToTwoDecimals = (value) => Number(value.toFixed(2))

const roundToThreeDecimals = (value) => Number(value.toFixed(3))

const toPercentagePoints = (value) => {
  const numberValue = toOptionalNumber(value)

  return Number.isFinite(numberValue)
    ? roundToOneDecimal(numberValue * 100)
    : null
}

const buildSeasonId = (startYear) => startYear * 10000 + startYear + 1

const getSeasonStartYear = (seasonId) => {
  const seasonNumber = toOptionalNumber(seasonId)

  return Number.isFinite(seasonNumber)
    ? Math.trunc(seasonNumber / 10000)
    : null
}

const getPreviousSeasonIds = (seasonId, count) => {
  const currentStartYear = getSeasonStartYear(seasonId)

  if (!Number.isFinite(currentStartYear)) {
    return []
  }

  return Array.from({ length: count }, (_item, index) =>
    buildSeasonId(currentStartYear - index - 1),
  )
}

const buildEmptyGoalieSeasonStats = ({
  playerId,
  playerName,
  seasonId,
  status = 'no_nhl_games',
}) => ({
  playerId,
  playerName,
  season: seasonId,
  dataStatus: status,
  gamesPlayed: null,
  gamesStarted: null,
  wins: null,
  losses: null,
  overtimeLosses: null,
  savePercentage: null,
  goalsAgainstAverage: null,
  saves: null,
  shotsAgainst: null,
  shutouts: null,
})

const sumAvailableNumbers = (items, field) => {
  const values = items.map((item) => toOptionalNumber(item[field]))

  if (!values.some(Number.isFinite)) {
    return null
  }

  return values.reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  )
}

const getGoalieFullName = (player = {}) => {
  const rosterName = getPlayerFullName(player)

  if (rosterName && rosterName !== 'Unknown Player') {
    return rosterName
  }

  return (
    getLocalizedValue(player.firstName) && getLocalizedValue(player.lastName)
      ? `${getLocalizedValue(player.firstName)} ${getLocalizedValue(
          player.lastName,
        )}`
      : getLocalizedValue(player.name) || 'Unknown Goalie'
  )
}

const normalizeStatsTeamDirectory = (teams = []) =>
  teams.reduce((teamsById, team) => {
    const teamId = toOptionalNumber(team.id)
    const abbreviation = normalizeTeamAbbreviation(
      team.triCode ?? team.rawTricode,
    )

    if (Number.isFinite(teamId) && abbreviation) {
      teamsById.set(teamId, abbreviation)
    }

    return teamsById
  }, new Map())

const getStatsTeamDirectory = async () => {
  if (!statsTeamDirectoryPromise) {
    statsTeamDirectoryPromise = requestNhlStatsApi('/team')
      .then((teamDirectory) => {
        const teams = Array.isArray(teamDirectory.data)
          ? teamDirectory.data
          : []

        return normalizeStatsTeamDirectory(teams)
      })
      .catch((error) => {
        statsTeamDirectoryPromise = null
        throw error
      })
  }

  return statsTeamDirectoryPromise
}

const getCurrentSeasonContext = async () => {
  const standings = await requestNhlApi('/standings/now', {
    allowStale: true,
  })
  const standingsTeams = Array.isArray(standings.standings)
    ? standings.standings
    : []
  const currentSeasonId = standingsTeams.reduce((latestSeasonId, standing) => {
    const seasonId = toOptionalNumber(standing.seasonId)

    return Number.isFinite(seasonId)
      ? Math.max(latestSeasonId, seasonId)
      : latestSeasonId
  }, 0)
  const currentTeamAbbreviations = [
    ...new Set(standingsTeams.map(getTeamAbbreviation).filter(Boolean)),
  ]

  if (!Number.isFinite(currentSeasonId) || currentSeasonId <= 0) {
    throw new NhlApiError('NHL API did not return a current season.')
  }

  return {
    currentSeasonId,
    currentTeamAbbreviations,
  }
}

const getSeasonSpecialTeamsRows = async (seasonId, teamsById) => {
  const cayenneExpression = encodeURIComponent(
    `seasonId=${seasonId} and gameTypeId=${REGULAR_SEASON_GAME_TYPE_ID}`,
  )
  const summary = await requestNhlStatsApi(
    `/team/summary?cayenneExp=${cayenneExpression}`,
  )
  const teamSummaries = Array.isArray(summary.data) ? summary.data : []

  return teamSummaries
    .map((teamSummary) => {
      const teamId = toOptionalNumber(teamSummary.teamId)
      const teamAbbreviation = teamsById.get(teamId)

      if (!teamAbbreviation) {
        return null
      }

      return {
        seasonId,
        teamAbbreviation,
        rawPowerPlayPercentage: toOptionalNumber(teamSummary.powerPlayPct),
        rawPenaltyKillPercentage: toOptionalNumber(teamSummary.penaltyKillPct),
      }
    })
    .filter(Boolean)
}

const calculatePowerPlayPercentage = (goals, opportunities) => {
  const normalizedGoals = toOptionalNumber(goals)
  const normalizedOpportunities = toOptionalNumber(opportunities)

  return Number.isFinite(normalizedGoals) &&
    Number.isFinite(normalizedOpportunities) &&
    normalizedOpportunities > 0
    ? normalizedGoals / normalizedOpportunities
    : null
}

const calculatePenaltyKillPercentage = (goalsAllowed, situations) => {
  const normalizedGoalsAllowed = toOptionalNumber(goalsAllowed)
  const normalizedSituations = toOptionalNumber(situations)

  return Number.isFinite(normalizedGoalsAllowed) &&
    Number.isFinite(normalizedSituations) &&
    normalizedSituations > 0
    ? 1 - normalizedGoalsAllowed / normalizedSituations
    : null
}

const getHistoricalSeasonSpecialTeamsRows = async (seasonId) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)

  if (!normalizedSeasonId) {
    throw new NhlApiError('Season must use canonical YYYYyyyy format.', {
      statusCode: 400,
    })
  }

  const cayenneExpression = encodeURIComponent(
    `seasonId=${normalizedSeasonId} and gameTypeId=${REGULAR_SEASON_GAME_TYPE_ID}`,
  )
  const [teamsById, powerPlayResponse, penaltyKillResponse] = await Promise.all([
    getStatsTeamDirectory(),
    requestNhlStatsApi(
      `/team/powerplay?limit=-1&cayenneExp=${cayenneExpression}`,
    ),
    requestNhlStatsApi(
      `/team/penaltykill?limit=-1&cayenneExp=${cayenneExpression}`,
    ),
  ])
  const powerPlayRows = Array.isArray(powerPlayResponse.data)
    ? powerPlayResponse.data
    : []
  const penaltyKillByTeamId = new Map(
    (Array.isArray(penaltyKillResponse.data) ? penaltyKillResponse.data : [])
      .map((row) => [toOptionalNumber(row.teamId), row])
      .filter(([teamId]) => Number.isFinite(teamId)),
  )

  return powerPlayRows
    .map((powerPlay) => {
      const teamId = toOptionalNumber(powerPlay.teamId)
      const penaltyKill = penaltyKillByTeamId.get(teamId)
      const teamAbbreviation = teamsById.get(teamId)
      const powerPlayGoals = toOptionalNumber(powerPlay.powerPlayGoalsFor)
      const powerPlayOpportunities = toOptionalNumber(
        powerPlay.ppOpportunities,
      )
      const penaltyKillSituations = toOptionalNumber(
        penaltyKill?.timesShorthanded,
      )
      const powerPlayGoalsAllowed = toOptionalNumber(
        penaltyKill?.ppGoalsAgainst,
      )
      const rawPowerPlayPercentage = calculatePowerPlayPercentage(
        powerPlayGoals,
        powerPlayOpportunities,
      )
      const rawPenaltyKillPercentage = calculatePenaltyKillPercentage(
        powerPlayGoalsAllowed,
        penaltyKillSituations,
      )

      if (
        !Number.isFinite(teamId) ||
        !teamAbbreviation ||
        !penaltyKill ||
        !Number.isFinite(rawPowerPlayPercentage) ||
        !Number.isFinite(rawPenaltyKillPercentage)
      ) {
        return null
      }

      return {
        gamesPlayed: Math.max(
          toOptionalNumber(powerPlay.gamesPlayed) ?? 0,
          toOptionalNumber(penaltyKill.gamesPlayed) ?? 0,
        ),
        penaltyKillSituations,
        powerPlayGoals,
        powerPlayGoalsAllowed,
        powerPlayOpportunities,
        rawPenaltyKillPercentage,
        rawPowerPlayPercentage,
        seasonId: normalizedSeasonId,
        sourceTeamAbbreviation: teamAbbreviation,
        teamId,
        teamName:
          powerPlay.teamFullName ?? penaltyKill.teamFullName ?? teamAbbreviation,
      }
    })
    .filter(Boolean)
}

const rankSpecialTeamsRows = (rows, field) => {
  const sortedRows = rows
    .filter((row) => Number.isFinite(row[field]))
    .sort((rowA, rowB) => rowB[field] - rowA[field])
  const ranksByTeam = new Map()
  let currentRank = null
  let previousValue = null

  sortedRows.forEach((row, index) => {
    if (index === 0 || row[field] !== previousValue) {
      currentRank = index + 1
    }

    ranksByTeam.set(row.teamAbbreviation, currentRank)
    previousValue = row[field]
  })

  return ranksByTeam
}

const buildSeasonSpecialTeamsByTeam = (seasonId, rows) => {
  const powerPlayRanks = rankSpecialTeamsRows(rows, 'rawPowerPlayPercentage')
  const penaltyKillRanks = rankSpecialTeamsRows(
    rows,
    'rawPenaltyKillPercentage',
  )

  return rows.reduce((statsByTeam, row) => {
    statsByTeam.set(row.teamAbbreviation, {
      seasonId,
      rawPowerPlayPercentage: row.rawPowerPlayPercentage,
      rawPenaltyKillPercentage: row.rawPenaltyKillPercentage,
      powerPlayPercentage: toPercentagePoints(row.rawPowerPlayPercentage),
      penaltyKillPercentage: toPercentagePoints(row.rawPenaltyKillPercentage),
      powerPlayLeagueRank: powerPlayRanks.get(row.teamAbbreviation) ?? null,
      penaltyKillLeagueRank:
        penaltyKillRanks.get(row.teamAbbreviation) ?? null,
    })

    return statsByTeam
  }, new Map())
}

const averageValues = (values) =>
  values.reduce((total, value) => total + value, 0) / values.length

const buildAverageSpecialTeamsByTeam = (seasonIds, seasonStatsByTeam) => {
  const teamAbbreviations = new Set()

  seasonStatsByTeam.forEach((seasonStats) => {
    seasonStats.forEach((_stats, teamAbbreviation) => {
      teamAbbreviations.add(teamAbbreviation)
    })
  })

  const averageRows = [...teamAbbreviations].map((teamAbbreviation) => {
    const powerPlayValues = seasonStatsByTeam
      .map((seasonStats) =>
        seasonStats.get(teamAbbreviation)?.rawPowerPlayPercentage,
      )
      .filter(Number.isFinite)
    const penaltyKillValues = seasonStatsByTeam
      .map((seasonStats) =>
        seasonStats.get(teamAbbreviation)?.rawPenaltyKillPercentage,
      )
      .filter(Number.isFinite)

    return {
      teamAbbreviation,
      rawAveragePowerPlayPercentage:
        powerPlayValues.length === seasonIds.length
          ? averageValues(powerPlayValues)
          : null,
      rawAveragePenaltyKillPercentage:
        penaltyKillValues.length === seasonIds.length
          ? averageValues(penaltyKillValues)
          : null,
    }
  })
  const powerPlayRanks = rankSpecialTeamsRows(
    averageRows,
    'rawAveragePowerPlayPercentage',
  )
  const penaltyKillRanks = rankSpecialTeamsRows(
    averageRows,
    'rawAveragePenaltyKillPercentage',
  )

  return averageRows.reduce((statsByTeam, row) => {
    statsByTeam.set(row.teamAbbreviation, {
      seasonIds,
      averagePowerPlayPercentage: toPercentagePoints(
        row.rawAveragePowerPlayPercentage,
      ),
      averagePenaltyKillPercentage: toPercentagePoints(
        row.rawAveragePenaltyKillPercentage,
      ),
      averagePowerPlayLeagueRank:
        powerPlayRanks.get(row.teamAbbreviation) ?? null,
      averagePenaltyKillLeagueRank:
        penaltyKillRanks.get(row.teamAbbreviation) ?? null,
    })

    return statsByTeam
  }, new Map())
}

const serializeSeasonSpecialTeams = (stats, seasonId) => ({
  seasonId,
  powerPlayPercentage: stats?.powerPlayPercentage ?? null,
  penaltyKillPercentage: stats?.penaltyKillPercentage ?? null,
  powerPlayLeagueRank: stats?.powerPlayLeagueRank ?? null,
  penaltyKillLeagueRank: stats?.penaltyKillLeagueRank ?? null,
})

const serializeAverageSpecialTeams = (stats, seasonIds) => ({
  seasonIds,
  averagePowerPlayPercentage: stats?.averagePowerPlayPercentage ?? null,
  averagePenaltyKillPercentage: stats?.averagePenaltyKillPercentage ?? null,
  averagePowerPlayLeagueRank: stats?.averagePowerPlayLeagueRank ?? null,
  averagePenaltyKillLeagueRank: stats?.averagePenaltyKillLeagueRank ?? null,
})

const buildLeagueSpecialTeamsStats = async () => {
  const { currentSeasonId, currentTeamAbbreviations } =
    await getCurrentSeasonContext()
  const previousSeasonIds = getPreviousSeasonIds(currentSeasonId, 3)
  const seasonIds = [currentSeasonId, ...previousSeasonIds]
  const teamsById = await getStatsTeamDirectory()
  const rowsBySeason = await Promise.all(
    seasonIds.map((seasonId) => getSeasonSpecialTeamsRows(seasonId, teamsById)),
  )
  const currentSeasonStatsByTeam = buildSeasonSpecialTeamsByTeam(
    currentSeasonId,
    rowsBySeason[0] ?? [],
  )
  const previousSeasonStatsByTeam = buildSeasonSpecialTeamsByTeam(
    previousSeasonIds[0],
    rowsBySeason[1] ?? [],
  )
  const previousThreeSeasonStatsByTeam = previousSeasonIds.map(
    (seasonId, index) =>
      buildSeasonSpecialTeamsByTeam(seasonId, rowsBySeason[index + 1] ?? []),
  )
  const previousThreeSeasonAverageStatsByTeam = buildAverageSpecialTeamsByTeam(
    previousSeasonIds,
    previousThreeSeasonStatsByTeam,
  )

  return {
    currentSeasonId,
    previousSeasonId: previousSeasonIds[0],
    previousThreeSeasonIds: previousSeasonIds,
    currentTeamAbbreviations,
    currentSeasonStatsByTeam,
    previousSeasonStatsByTeam,
    previousThreeSeasonAverageStatsByTeam,
  }
}

const getLeagueSpecialTeamsStats = async ({ includeProviderState = false } = {}) => {
  const now = Date.now()

  if (
    leagueSpecialTeamsStatsCache &&
    leagueSpecialTeamsStatsCache.expiresAt > now
  ) {
    return serializeProviderState(
      leagueSpecialTeamsStatsCache.data,
      {
        fetchedAt: leagueSpecialTeamsStatsCache.fetchedAt,
        source: 'cache',
        stale: false,
      },
      includeProviderState,
    )
  }

  if (!leagueSpecialTeamsStatsPromise) {
    leagueSpecialTeamsStatsPromise = buildLeagueSpecialTeamsStats()
      .then((data) => {
        const fetchedAt = new Date().toISOString()

        leagueSpecialTeamsStatsCache = {
          data,
          expiresAt: Date.now() + SPECIAL_TEAMS_CACHE_TTL_MS,
          fetchedAt,
        }

        return {
          data,
          fetchedAt,
          source: 'live',
          stale: false,
        }
      })
      .finally(() => {
        leagueSpecialTeamsStatsPromise = null
      })
  }

  try {
    const result = await leagueSpecialTeamsStatsPromise

    return includeProviderState ? {
      ...result,
      status: 'ready',
    } : result.data
  } catch (error) {
    if (!leagueSpecialTeamsStatsCache?.data) {
      throw error
    }

    return serializeProviderState(
      leagueSpecialTeamsStatsCache.data,
      {
        fetchedAt: leagueSpecialTeamsStatsCache.fetchedAt,
        source: 'stale_cache',
        stale: true,
      },
      includeProviderState,
    )
  }
}

const getSpecialTeamsForTeam = async (teamAbbreviation, options = {}) => {
  const normalizedAbbreviation = normalizeTeamAbbreviation(teamAbbreviation)

  if (!isValidTeamAbbreviation(normalizedAbbreviation)) {
    throw new NhlApiError('Team abbreviation must use 2 to 4 letters.', {
      statusCode: 400,
    })
  }

  const leagueState = await getLeagueSpecialTeamsStats({
    includeProviderState: true,
  })
  const leagueStats = leagueState.data

  if (!leagueStats.currentTeamAbbreviations.includes(normalizedAbbreviation)) {
    throw new NhlApiError('Team not found.', {
      statusCode: 404,
    })
  }

  const specialTeams = {
    teamAbbreviation: normalizedAbbreviation,
    currentSeason: serializeSeasonSpecialTeams(
      leagueStats.currentSeasonStatsByTeam.get(normalizedAbbreviation),
      leagueStats.currentSeasonId,
    ),
    previousSeason: serializeSeasonSpecialTeams(
      leagueStats.previousSeasonStatsByTeam.get(normalizedAbbreviation),
      leagueStats.previousSeasonId,
    ),
    previousThreeSeasonsAverage: serializeAverageSpecialTeams(
      leagueStats.previousThreeSeasonAverageStatsByTeam.get(
        normalizedAbbreviation,
      ),
      leagueStats.previousThreeSeasonIds,
    ),
  }

  return serializeProviderState(
    specialTeams,
    leagueState,
    options.includeProviderState,
  )
}

const getLeagueSpecialTeamsMatchupData = async (options = {}) => {
  const leagueState = await getLeagueSpecialTeamsStats({
    includeProviderState: true,
  })
  const leagueStats = leagueState.data
  const teams = leagueStats.currentTeamAbbreviations.map(
    (teamAbbreviation) => {
      const stats = leagueStats.previousThreeSeasonAverageStatsByTeam.get(
        teamAbbreviation,
      )

      return {
        penaltyKillLeagueRank:
          stats?.averagePenaltyKillLeagueRank ?? null,
        powerPlayLeagueRank:
          stats?.averagePowerPlayLeagueRank ?? null,
        teamAbbreviation,
      }
    },
  )
  const matchupData = {
    leagueTeamCount: leagueStats.currentTeamAbbreviations.length,
    previousThreeSeasonIds: leagueStats.previousThreeSeasonIds,
    teams,
  }

  return serializeProviderState(
    matchupData,
    leagueState,
    options.includeProviderState,
  )
}

const getPlayerLanding = async (playerId) => {
  try {
    return await requestNhlApi(`/player/${encodeURIComponent(playerId)}/landing`)
  } catch (error) {
    if (error instanceof NhlApiError && error.upstreamStatus === 404) {
      throw new NhlApiError('Player not found.', {
        statusCode: 404,
        upstreamStatus: error.upstreamStatus,
      })
    }

    throw error
  }
}

const getCurrentRosterGoalieForPlayer = async (playerId) => {
  const player = await getPlayerLanding(playerId)

  if (player.position !== 'G') {
    throw new NhlApiError('Goalie statistics are only available for goalies.', {
      statusCode: 400,
    })
  }

  const currentTeamAbbreviation = normalizeTeamAbbreviation(
    player.currentTeamAbbrev,
  )

  if (!player.isActive || !currentTeamAbbreviation) {
    throw new NhlApiError('Goalie is not on a current NHL roster.', {
      statusCode: 404,
    })
  }

  let roster

  try {
    roster = await requestNhlApi(
      `/roster/${encodeURIComponent(currentTeamAbbreviation)}/current`,
    )
  } catch (error) {
    throw new NhlApiError('Unable to verify the goalie roster status.', {
      cause: error,
      publicMessage: 'Unable to load NHL goalie roster data right now.',
      statusCode: 500,
      upstreamStatus: error.upstreamStatus,
    })
  }

  const rosterGoalie = (Array.isArray(roster.goalies) ? roster.goalies : []).find(
    (goalie) => toOptionalNumber(goalie.id) === toOptionalNumber(playerId),
  )

  if (!rosterGoalie || rosterGoalie.positionCode !== 'G') {
    throw new NhlApiError('Goalie is not on a current NHL roster.', {
      statusCode: 404,
    })
  }

  return {
    ...player,
    ...rosterGoalie,
    playerId: toOptionalNumber(playerId),
    fullName: getGoalieFullName(rosterGoalie),
    currentTeamAbbreviation,
  }
}

const combineGoalieSeasonRows = ({
  playerId,
  playerName,
  rows,
  seasonId,
}) => {
  if (rows.length === 0) {
    return buildEmptyGoalieSeasonStats({ playerId, playerName, seasonId })
  }

  const gamesPlayed = sumAvailableNumbers(rows, 'gamesPlayed')
  const gamesStarted = sumAvailableNumbers(rows, 'gamesStarted')
  const wins = sumAvailableNumbers(rows, 'wins')
  const losses = sumAvailableNumbers(rows, 'losses')
  const overtimeLosses = sumAvailableNumbers(rows, 'otLosses')
  const saves = sumAvailableNumbers(rows, 'saves')
  const shotsAgainst = sumAvailableNumbers(rows, 'shotsAgainst')
  const shutouts = sumAvailableNumbers(rows, 'shutouts')
  const goalsAgainst = sumAvailableNumbers(rows, 'goalsAgainst')
  const timeOnIce = sumAvailableNumbers(rows, 'timeOnIce')
  const savePercentage =
    Number.isFinite(saves) && Number.isFinite(shotsAgainst) && shotsAgainst > 0
      ? roundToThreeDecimals(saves / shotsAgainst)
      : null
  const goalsAgainstAverage =
    Number.isFinite(goalsAgainst) &&
    Number.isFinite(timeOnIce) &&
    timeOnIce > 0
      ? roundToTwoDecimals((goalsAgainst * 3600) / timeOnIce)
      : null

  return {
    playerId,
    playerName,
    season: seasonId,
    dataStatus: 'available',
    gamesPlayed,
    gamesStarted,
    wins,
    losses,
    overtimeLosses,
    savePercentage,
    goalsAgainstAverage,
    saves,
    shotsAgainst,
    shutouts,
  }
}

const getGoalieSeasonStats = async ({ playerId, playerName, seasonId }) => {
  const cayenneExpression = encodeURIComponent(
    `playerId=${playerId} and seasonId=${seasonId} and gameTypeId=${REGULAR_SEASON_GAME_TYPE_ID}`,
  )
  const summary = await requestNhlStatsApi(
    `/goalie/summary?cayenneExp=${cayenneExpression}`,
  )

  if (!Array.isArray(summary.data)) {
    return buildEmptyGoalieSeasonStats({
      playerId,
      playerName,
      seasonId,
      status: 'unavailable',
    })
  }

  const rows = summary.data.filter(
    (row) => toOptionalNumber(row.playerId) === playerId,
  )
  const apiPlayerName = getLocalizedValue(summary.data[0]?.goalieFullName)
  const resolvedPlayerName = apiPlayerName || playerName

  return combineGoalieSeasonRows({
    playerId,
    playerName: resolvedPlayerName,
    rows,
    seasonId,
  })
}

const getGoalieSeasonStatsCached = async ({ playerId, playerName, seasonId }) => {
  const cacheKey = `${playerId}:${seasonId}`
  const cachedStats = goalieSeasonStatsCache.get(cacheKey)

  if (cachedStats && cachedStats.expiresAt > Date.now()) {
    return cachedStats.data
  }

  if (!goalieSeasonStatsPromises.has(cacheKey)) {
    const statsPromise = getGoalieSeasonStats({
      playerId,
      playerName,
      seasonId,
    })
      .then((data) => {
        goalieSeasonStatsCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + GOALIE_STATS_CACHE_TTL_MS,
        })

        return data
      })
      .catch((error) => {
        if (cachedStats?.data) {
          return cachedStats.data
        }

        throw error
      })
      .finally(() => {
        goalieSeasonStatsPromises.delete(cacheKey)
      })

    goalieSeasonStatsPromises.set(cacheKey, statsPromise)
  }

  return goalieSeasonStatsPromises.get(cacheKey)
}

const getGoalieSummariesForTeam = async (teamAbbreviation, options = {}) => {
  const normalizedAbbreviation = normalizeTeamAbbreviation(teamAbbreviation)

  if (!isValidTeamAbbreviation(normalizedAbbreviation)) {
    throw new NhlApiError('Team abbreviation must use 2 to 4 letters.', {
      statusCode: 400,
    })
  }

  const [rosterState, { currentSeasonId }] = await Promise.all([
    getRosterForTeam(normalizedAbbreviation, { includeProviderState: true }),
    getCurrentSeasonContext(),
  ])
  const roster = rosterState.data
  const rosterGoalies = (roster.goalies ?? []).filter(
    (player) => player.position === 'G',
  )

  try {
    const goalies = await Promise.all(
      rosterGoalies.map(async (goalie) => {
        const playerId = toOptionalNumber(goalie.id)
        const playerName = goalie.fullName
        const currentSeason = Number.isFinite(playerId)
          ? await getGoalieSeasonStatsCached({
              playerId,
              playerName,
              seasonId: currentSeasonId,
            })
          : buildEmptyGoalieSeasonStats({
              playerId: null,
              playerName,
              seasonId: currentSeasonId,
              status: 'unavailable',
            })

        return {
          playerId,
          playerName,
          currentSeason,
        }
      }),
    )

    const summaries = {
      teamAbbreviation: normalizedAbbreviation,
      season: currentSeasonId,
      goalies,
    }

    return serializeProviderState(
      summaries,
      rosterState,
      options.includeProviderState,
    )
  } catch (error) {
    throw new NhlApiError('Unable to load goalie summaries.', {
      cause: error,
      publicMessage: 'Unable to load NHL goalie summaries right now.',
      statusCode: 500,
      upstreamStatus: error.upstreamStatus,
    })
  }
}

const buildGoalieStatsForPlayer = async (playerId) => {
  const normalizedPlayerId = toOptionalNumber(playerId)

  if (!Number.isFinite(normalizedPlayerId)) {
    throw new NhlApiError('Player ID must be numeric.', {
      statusCode: 400,
    })
  }

  const [{ currentSeasonId }, rosterGoalie] = await Promise.all([
    getCurrentSeasonContext(),
    getCurrentRosterGoalieForPlayer(normalizedPlayerId),
  ])
  const previousSeasonId = getPreviousSeasonIds(currentSeasonId, 1)[0]
  const playerName = rosterGoalie.fullName

  try {
    const [currentSeason, previousSeason] = await Promise.all([
      getGoalieSeasonStatsCached({
        playerId: normalizedPlayerId,
        playerName,
        seasonId: currentSeasonId,
      }),
      getGoalieSeasonStatsCached({
        playerId: normalizedPlayerId,
        playerName,
        seasonId: previousSeasonId,
      }),
    ])

    return {
      playerId: normalizedPlayerId,
      playerName,
      currentSeason,
      previousSeason,
    }
  } catch (error) {
    if (error instanceof NhlApiError) {
      throw new NhlApiError('Unable to load goalie statistics.', {
        cause: error,
        publicMessage: 'Unable to load NHL goalie statistics right now.',
        statusCode: 500,
        upstreamStatus: error.upstreamStatus,
      })
    }

    throw error
  }
}

const getGoalieStatsForPlayer = async (playerId) => {
  const normalizedPlayerId = normalizePlayerId(playerId)

  if (!isValidPlayerId(normalizedPlayerId)) {
    throw new NhlApiError('Player ID must be numeric.', {
      statusCode: 400,
    })
  }

  const { currentSeasonId } = await getCurrentSeasonContext()
  const cacheKey = `${normalizedPlayerId}:${currentSeasonId}`
  const cachedStats = goalieStatsCache.get(cacheKey)

  if (cachedStats && cachedStats.expiresAt > Date.now()) {
    return cachedStats.data
  }

  if (!goalieStatsPromises.has(cacheKey)) {
    const statsPromise = buildGoalieStatsForPlayer(normalizedPlayerId)
      .then((data) => {
        goalieStatsCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + GOALIE_STATS_CACHE_TTL_MS,
        })

        return data
      })
      .catch((error) => {
        if (cachedStats?.data) {
          return cachedStats.data
        }

        throw error
      })
      .finally(() => {
        goalieStatsPromises.delete(cacheKey)
      })

    goalieStatsPromises.set(cacheKey, statsPromise)
  }

  return goalieStatsPromises.get(cacheKey)
}

const getScheduleForDate = async (date, options) =>
  requestNhlApi(`/schedule/${date}`, options)

const getClubScheduleSeason = async (teamAbbreviation, seasonId) => {
  const normalizedAbbreviation = normalizeTeamAbbreviation(teamAbbreviation)
  const normalizedSeasonId = String(seasonId ?? '').trim()

  if (!isValidTeamAbbreviation(normalizedAbbreviation)) {
    throw new NhlApiError('Team abbreviation must use 2 to 4 letters.', {
      statusCode: 400,
    })
  }

  if (!/^\d{8}$/.test(normalizedSeasonId)) {
    throw new NhlApiError('Season ID must use YYYYyyyy format.', {
      statusCode: 400,
    })
  }

  return requestNhlApi(
    `/club-schedule-season/${encodeURIComponent(
      normalizedAbbreviation,
    )}/${encodeURIComponent(normalizedSeasonId)}`,
  )
}

const parseUtcDateValue = (date) => {
  if (!isValidScheduleDate(date)) {
    throw new NhlApiError('Schedule date must use YYYY-MM-DD format.', {
      statusCode: 400,
    })
  }

  const [year, month, day] = date.split('-').map(Number)

  return new Date(Date.UTC(year, month - 1, day))
}

const addUtcDays = (date, dayCount) =>
  new Date(date.getTime() + dayCount * MS_PER_DAY)

const formatUtcDateValue = (date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const buildScheduleDateRequests = (dateFrom, dateTo) => {
  const startDate = parseUtcDateValue(dateFrom)
  const endDate = parseUtcDateValue(dateTo)

  if (startDate.getTime() > endDate.getTime()) {
    throw new NhlApiError('Schedule start date must be before end date.', {
      statusCode: 400,
    })
  }

  const requestDates = []
  let cursor = startDate

  while (cursor.getTime() <= endDate.getTime()) {
    requestDates.push(formatUtcDateValue(cursor))
    cursor = addUtcDays(cursor, 7)
  }

  const endDateValue = formatUtcDateValue(endDate)

  if (!requestDates.includes(endDateValue)) {
    requestDates.push(endDateValue)
  }

  return requestDates
}

const extractScheduleGamesForDateRange = (
  schedules = [],
  dateFrom,
  dateTo,
) => {
  const gamesById = new Map()

  schedules.forEach((schedule) => {
    const scheduleDays = Array.isArray(schedule?.gameWeek)
      ? schedule.gameWeek
      : []

    scheduleDays.forEach((scheduleDay) => {
      if (scheduleDay.date < dateFrom || scheduleDay.date > dateTo) {
        return
      }

      ;(Array.isArray(scheduleDay.games) ? scheduleDay.games : []).forEach(
        (game) => {
          const simplifiedGame = {
            ...simplifyGame(game),
            __replayScheduleDate: scheduleDay.date,
          }

          if (simplifiedGame.gameId) {
            gamesById.set(String(simplifiedGame.gameId), simplifiedGame)
          }
        },
      )
    })
  })

  return [...gamesById.values()].sort(
    (left, right) =>
      new Date(left.startTimeUTC).getTime() -
      new Date(right.startTimeUTC).getTime(),
  )
}

const getHistoricalScheduleRangeCacheKey = (seasonId, dateFrom, dateTo) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)

  return normalizedSeasonId
    ? `/historical-schedule-season/${normalizedSeasonId}/${dateFrom}/${dateTo}`
    : ''
}

const getScheduleRangeSource = (scheduleStates) => {
  const sources = new Set(scheduleStates.map((state) => state.source))

  if (sources.has('live')) {
    return sources.size === 1 ? 'live' : 'mixed'
  }

  if (sources.has('stale_cache')) {
    return 'stale_cache'
  }

  return 'cache'
}

const loadScheduleGamesForDateRange = async (dateFrom, dateTo, options = {}) => {
  const requestDates = buildScheduleDateRequests(dateFrom, dateTo)
  const scheduleStates = []
  const batchSize = Math.max(1, Math.min(2, Number(options.batchSize) || 2))
  const scheduleProvider =
    options.getScheduleForDateProvider ?? getScheduleForDate

  for (let index = 0; index < requestDates.length; index += batchSize) {
    const batchDates = requestDates.slice(index, index + batchSize)
    const batch = await Promise.all(
      batchDates.map(async (date) => {
        const state = await scheduleProvider(date, {
          allowStale: options.allowStale === true,
          includeMetadata: true,
        })

        return state?.data
          ? state
          : {
              data: state,
              fetchedAt: null,
              source: 'live',
              stale: false,
            }
      }),
    )

    scheduleStates.push(...batch)
  }

  const schedules = scheduleStates.map((state) => state.data)

  return {
    cacheKey: getHistoricalScheduleRangeCacheKey(
      options.seasonId,
      dateFrom,
      dateTo,
    ),
    fetchedAt: scheduleStates
      .map((state) => state.fetchedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
    games: extractScheduleGamesForDateRange(schedules, dateFrom, dateTo),
    requestCount: requestDates.length,
    source: getScheduleRangeSource(scheduleStates),
    stale: scheduleStates.some((state) => state.stale),
  }
}

const selectScheduleRangeResult = (state, includeProviderState) =>
  includeProviderState ? state : state.games

const getScheduleGamesForDateRange = async (dateFrom, dateTo, options = {}) => {
  const cacheKey = getHistoricalScheduleRangeCacheKey(
    options.seasonId,
    dateFrom,
    dateTo,
  )
  const cached = cacheKey ? historicalScheduleRangeCache.get(cacheKey) : null
  const now = Date.now()

  if (cached && cached.expiresAt > now) {
    return selectScheduleRangeResult(
      {
        ...cached.data,
        source: 'season_cache',
        stale: false,
      },
      options.includeProviderState,
    )
  }

  if (cacheKey && historicalScheduleRangePromises.has(cacheKey)) {
    return selectScheduleRangeResult(
      await historicalScheduleRangePromises.get(cacheKey),
      options.includeProviderState,
    )
  }

  const requestPromise = loadScheduleGamesForDateRange(dateFrom, dateTo, {
    ...options,
    allowStale: options.allowStale !== false,
  }).then((state) => {
    if (cacheKey) {
      historicalScheduleRangeCache.set(cacheKey, {
        data: state,
        expiresAt: Date.now() + NHL_API_CACHE_TTLS_MS.historicalSchedule,
      })
    }

    return state
  })

  if (cacheKey) {
    historicalScheduleRangePromises.set(cacheKey, requestPromise)
  }

  try {
    return selectScheduleRangeResult(
      await requestPromise,
      options.includeProviderState,
    )
  } catch (error) {
    if (cached?.data && options.allowStale !== false) {
      return selectScheduleRangeResult(
        {
          ...cached.data,
          source: 'season_stale_cache',
          stale: true,
        },
        options.includeProviderState,
      )
    }

    throw error
  } finally {
    if (cacheKey) {
      historicalScheduleRangePromises.delete(cacheKey)
    }
  }
}

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

const getTeams = async () => {
  const standings = await requestNhlApi('/standings/now')
  const standingsTeams = Array.isArray(standings.standings)
    ? standings.standings
    : []

  return standingsTeams
    .map(simplifyStandingTeam)
    .filter((team) => team.abbreviation)
    .sort((teamA, teamB) => teamA.name.localeCompare(teamB.name))
}

const getRosterForTeam = async (teamAbbreviation, options = {}) => {
  const normalizedAbbreviation = normalizeTeamAbbreviation(teamAbbreviation)

  if (!isValidTeamAbbreviation(normalizedAbbreviation)) {
    throw new NhlApiError('Team abbreviation must use 2 to 4 letters.', {
      statusCode: 400,
    })
  }

  const knownTeam = getKnownTeamById(normalizedAbbreviation)

  if (!knownTeam) {
    throw new NhlApiError('Team not found.', {
      statusCode: 404,
    })
  }

  try {
    const requestRoster = options.requestRoster ?? requestNhlApi
    const rosterState = await requestRoster(
      `/roster/${encodeURIComponent(normalizedAbbreviation)}/current`,
      {
        allowStale: true,
        includeMetadata: true,
      },
    )
    const roster = rosterState.data
    const normalizedRoster = {
      team: {
        abbreviation: knownTeam.teamAbbreviation,
        name: knownTeam.teamName,
      },
      teamAbbreviation: normalizedAbbreviation,
      forwards: normalizeRosterGroup(roster.forwards),
      defensemen: normalizeRosterGroup(roster.defensemen),
      goalies: normalizeRosterGroup(roster.goalies),
    }

    return serializeProviderState(
      normalizedRoster,
      rosterState,
      options.includeProviderState,
    )
  } catch (error) {
    if (error instanceof NhlApiError && error.upstreamStatus === 404) {
      throw new NhlApiError('Roster not found for that team.', {
        statusCode: 404,
        upstreamStatus: error.upstreamStatus,
      })
    }

    throw error
  }
}

module.exports = {
  NHL_API_CACHE_TTLS_MS,
  NhlApiError,
  buildScheduleDateRequests,
  createConcurrencyLimiter,
  createNhlApiRequester,
  extractScheduleGamesForDateRange,
  getClubScheduleSeason,
  getCacheTtlMs,
  getCurrentSeasonContext,
  getGamesForDate,
  getGoalieSummariesForTeam,
  getGoalieStatsForPlayer,
  getHistoricalSeasonSpecialTeamsRows,
  getHistoricalScheduleRangeCacheKey,
  getLeagueSpecialTeamsMatchupData,
  getRosterForTeam,
  getScheduleGamesForDateRange,
  getScheduleForDate,
  getSpecialTeamsForTeam,
  getTeams,
  getTodayNhlDate,
  getTodaysGames,
  isValidPlayerId,
  isValidScheduleDate,
  isValidTeamAbbreviation,
  parseRetryAfterMs,
  loadScheduleGamesForDateRange,
}
