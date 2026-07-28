const nhlApiService = require('./nhlApiService')
const { getSeedTeams } = require('./powerRatingsService')
const { NHL_GAME_TYPE_CODES } = require('./nhlGameEligibility')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FALLBACK_METADATA_SOURCE = 'fallback'
const NHL_API_METADATA_SOURCE = 'nhl-api'
const DEFAULT_SEASON_COUNT = 5
const SEASON_CACHE_TTL_MS = 12 * 60 * 60 * 1000

const FALLBACK_SEASONS = Object.freeze([
  {
    id: '20262027',
    startDate: '2026-10-01',
    endDate: '2027-04-30',
  },
  {
    id: '20252026',
    startDate: '2025-10-07',
    endDate: '2026-04-16',
  },
  {
    id: '20242025',
    startDate: '2024-10-04',
    endDate: '2025-04-17',
  },
  {
    id: '20232024',
    startDate: '2023-10-10',
    endDate: '2024-04-18',
  },
  {
    id: '20222023',
    startDate: '2022-10-07',
    endDate: '2023-04-14',
  },
  {
    id: '20212022',
    startDate: '2021-10-12',
    endDate: '2022-04-29',
  },
])

let availableSeasonsCache = null
let availableSeasonsPromise = null

class NhlSeasonError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'NhlSeasonError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const toOptionalFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const normalizeSeasonId = (seasonId) => {
  const value = String(seasonId ?? '').trim()

  return /^\d{8}$/.test(value) ? value : ''
}

const getSeasonStartYear = (seasonId) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)

  return normalizedSeasonId ? Number(normalizedSeasonId.slice(0, 4)) : null
}

const buildSeasonId = (startYear) =>
  Number.isInteger(startYear) ? `${startYear}${startYear + 1}` : ''

const buildPreviousSeasonIds = (seasonId, count) => {
  const startYear = getSeasonStartYear(seasonId)

  if (!Number.isInteger(startYear)) {
    return []
  }

  return Array.from({ length: count }, (_item, index) =>
    buildSeasonId(startYear - index - 1),
  )
}

const buildNextSeasonId = (seasonId) => {
  const startYear = getSeasonStartYear(seasonId)

  return Number.isInteger(startYear) ? buildSeasonId(startYear + 1) : ''
}

const getSeasonLabel = (seasonId) => {
  const startYear = getSeasonStartYear(seasonId)

  if (!Number.isInteger(startYear)) {
    return ''
  }

  return `${startYear}\u2013${String(startYear + 1).slice(-2)}`
}

const parseDate = (value, field = 'date') => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new NhlSeasonError(`${field} must use YYYY-MM-DD format.`, 400, {
      field,
    })
  }

  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new NhlSeasonError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return {
    date: value,
    timestamp,
  }
}

const formatDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 10)

const normalizeSeasonBoundary = ({ endDate, id, startDate }) => {
  const normalizedId = normalizeSeasonId(id)

  if (!normalizedId) {
    throw new NhlSeasonError('Season ID must use YYYYyyyy format.', 500, {
      id,
    })
  }

  const parsedStart = parseDate(startDate, 'startDate')
  const parsedEnd = parseDate(endDate, 'endDate')

  if (parsedStart.timestamp > parsedEnd.timestamp) {
    throw new NhlSeasonError('Season startDate must be on or before endDate.', 500, {
      endDate,
      id,
      startDate,
    })
  }

  return {
    id: normalizedId,
    label: getSeasonLabel(normalizedId),
    startDate: parsedStart.date,
    endDate: parsedEnd.date,
  }
}

const getFallbackSeasonById = (seasonId) =>
  FALLBACK_SEASONS.find((season) => season.id === normalizeSeasonId(seasonId))

const buildFallbackSeasonFromId = (seasonId) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)
  const startYear = getSeasonStartYear(normalizedSeasonId)

  if (!Number.isInteger(startYear)) {
    throw new NhlSeasonError('Season ID must use YYYYyyyy format.', 500, {
      seasonId,
    })
  }

  return {
    id: normalizedSeasonId,
    startDate: `${startYear}-10-01`,
    endDate: `${startYear + 1}-04-30`,
  }
}

const getFallbackBoundary = (seasonId) =>
  normalizeSeasonBoundary(
    getFallbackSeasonById(seasonId) ?? buildFallbackSeasonFromId(seasonId),
  )

const getGameDate = (game = {}) => {
  if (typeof game.gameDate === 'string' && DATE_PATTERN.test(game.gameDate)) {
    return game.gameDate
  }

  if (typeof game.startTimeUTC === 'string') {
    const parsedTimestamp = Date.parse(game.startTimeUTC)

    return Number.isFinite(parsedTimestamp) ? formatDate(parsedTimestamp) : ''
  }

  return ''
}

const isRegularSeasonGame = (game = {}) =>
  Number(game.gameType) === NHL_GAME_TYPE_CODES.REGULAR_SEASON

const normalizeScheduleGames = (schedule) =>
  Array.isArray(schedule?.games) ? schedule.games : []

const deriveSeasonBoundaryFromSchedules = async ({
  clubScheduleSeasonProvider = nhlApiService.getClubScheduleSeason,
  seasonId,
  teamsProvider = getSeedTeams,
}) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)
  const teams = await teamsProvider()
  const schedules = await Promise.all(
    teams.map((team) =>
      clubScheduleSeasonProvider(team.abbreviation ?? team.teamId, normalizedSeasonId),
    ),
  )
  const gameDates = [
    ...new Set(
      schedules
        .flatMap(normalizeScheduleGames)
        .filter(isRegularSeasonGame)
        .map(getGameDate)
        .filter(Boolean),
    ),
  ].sort()

  if (gameDates.length === 0) {
    throw new NhlSeasonError(
      `No regular-season schedule games were available for ${normalizedSeasonId}.`,
      502,
      { seasonId: normalizedSeasonId },
    )
  }

  return normalizeSeasonBoundary({
    id: normalizedSeasonId,
    startDate: gameDates[0],
    endDate: gameDates.at(-1),
  })
}

const decorateCurrentSeason = (seasons, currentSeasonId) =>
  seasons
    .map((season) => ({
      ...season,
      isCurrent: season.id === currentSeasonId,
    }))
    .sort((seasonA, seasonB) => seasonB.id.localeCompare(seasonA.id))

const getSeasonForDate = (seasons, date) => {
  const today = parseDate(date, 'today')
  const sortedSeasons = [...seasons].sort((left, right) =>
    left.startDate.localeCompare(right.startDate),
  )

  for (const season of sortedSeasons) {
    const start = parseDate(season.startDate, 'startDate')
    const end = parseDate(season.endDate, 'endDate')

    if (today.timestamp >= start.timestamp && today.timestamp <= end.timestamp) {
      return season
    }
  }

  for (let index = 1; index < sortedSeasons.length; index += 1) {
    const previousSeason = sortedSeasons[index - 1]
    const nextSeason = sortedSeasons[index]
    const previousEnd = parseDate(previousSeason.endDate, 'endDate')
    const nextStart = parseDate(nextSeason.startDate, 'startDate')

    if (
      today.timestamp > previousEnd.timestamp &&
      today.timestamp < nextStart.timestamp
    ) {
      return nextSeason
    }
  }

  const newestSeason = sortedSeasons.at(-1)
  const newestEnd = newestSeason
    ? parseDate(newestSeason.endDate, 'endDate')
    : null

  if (newestEnd && today.timestamp > newestEnd.timestamp) {
    return newestSeason
  }

  return sortedSeasons[0] ?? null
}

const buildSeasonIdList = (currentSeasonId, count) => [
  currentSeasonId,
  ...buildPreviousSeasonIds(currentSeasonId, Math.max(0, count - 1)),
]

const buildFallbackSeasons = ({ count = DEFAULT_SEASON_COUNT, today }) => {
  const currentSeason = getSeasonForDate(
    FALLBACK_SEASONS.map(normalizeSeasonBoundary),
    today,
  )
  const currentSeasonId = currentSeason?.id ?? FALLBACK_SEASONS[0].id
  const seasonIds = buildSeasonIdList(currentSeasonId, count)
  const seasons = seasonIds.map(getFallbackBoundary)

  return {
    currentSeasonId,
    metadataSource: FALLBACK_METADATA_SOURCE,
    seasons: decorateCurrentSeason(seasons, currentSeasonId),
    warning:
      'Using fallback NHL regular-season boundaries because live season metadata was unavailable.',
  }
}

const buildNhlApiSeasons = async ({
  clubScheduleSeasonProvider,
  count = DEFAULT_SEASON_COUNT,
  currentSeasonContextProvider = nhlApiService.getCurrentSeasonContext,
  teamsProvider,
  today,
}) => {
  const context = await currentSeasonContextProvider()
  const apiCurrentSeasonId = normalizeSeasonId(context.currentSeasonId)

  if (!apiCurrentSeasonId) {
    throw new NhlSeasonError('NHL API did not return a current season.')
  }

  const currentBoundary = await deriveSeasonBoundaryFromSchedules({
    clubScheduleSeasonProvider,
    seasonId: apiCurrentSeasonId,
    teamsProvider,
  })
  const todayDate = parseDate(today, 'today')
  const currentEnd = parseDate(currentBoundary.endDate, 'endDate')
  const effectiveCurrentSeasonId =
    todayDate.timestamp > currentEnd.timestamp
      ? buildNextSeasonId(apiCurrentSeasonId)
      : apiCurrentSeasonId
  const seasonIds = buildSeasonIdList(effectiveCurrentSeasonId, count)
  const seasons = await Promise.all(
    seasonIds.map((seasonId) =>
      deriveSeasonBoundaryFromSchedules({
        clubScheduleSeasonProvider,
        seasonId,
        teamsProvider,
      }),
    ),
  )

  return {
    currentSeasonId: effectiveCurrentSeasonId,
    metadataSource: NHL_API_METADATA_SOURCE,
    seasons: decorateCurrentSeason(seasons, effectiveCurrentSeasonId),
    warning: null,
  }
}

const normalizeAvailableSeasonsResponse = (response) => ({
  currentSeasonId: response.currentSeasonId,
  metadataSource: response.metadataSource,
  seasons: response.seasons.map((season) => ({
    endDate: season.endDate,
    id: season.id,
    isCurrent: Boolean(season.isCurrent),
    label: season.label,
    startDate: season.startDate,
  })),
  warning: response.warning ?? null,
})

const getAvailablePowerRatingHistorySeasons = async (options = {}) => {
  const today = options.todayProvider
    ? options.todayProvider()
    : nhlApiService.getTodayNhlDate()
  const cacheKey = today
  const now = Date.now()

  if (
    !options.skipCache &&
    availableSeasonsCache &&
    availableSeasonsCache.cacheKey === cacheKey &&
    availableSeasonsCache.expiresAt > now
  ) {
    return availableSeasonsCache.data
  }

  if (!options.skipCache && availableSeasonsPromise) {
    return availableSeasonsPromise
  }

  const buildResponse = async () => {
    try {
      return await buildNhlApiSeasons({
        clubScheduleSeasonProvider: options.clubScheduleSeasonProvider,
        count: options.count,
        currentSeasonContextProvider: options.currentSeasonContextProvider,
        teamsProvider: options.teamsProvider,
        today,
      })
    } catch {
      return buildFallbackSeasons({
        count: options.count,
        today,
      })
    }
  }

  const responsePromise = buildResponse()
    .then(normalizeAvailableSeasonsResponse)
    .then((data) => {
      if (!options.skipCache) {
        availableSeasonsCache = {
          cacheKey,
          data,
          expiresAt: Date.now() + SEASON_CACHE_TTL_MS,
        }
      }

      return data
    })
    .finally(() => {
      availableSeasonsPromise = null
    })

  if (!options.skipCache) {
    availableSeasonsPromise = responsePromise
  }

  return responsePromise
}

module.exports = {
  DEFAULT_SEASON_COUNT,
  FALLBACK_METADATA_SOURCE,
  FALLBACK_SEASONS,
  NHL_API_METADATA_SOURCE,
  NhlSeasonError,
  buildFallbackSeasons,
  buildSeasonId,
  deriveSeasonBoundaryFromSchedules,
  getAvailablePowerRatingHistorySeasons,
  getSeasonForDate,
  getSeasonLabel,
  normalizeSeasonBoundary,
}
