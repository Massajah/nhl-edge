const nhlApiService = require('./nhlApiService')
const nhlSeasonService = require('./nhlSeasonService')
const {
  getSeasonLabel,
  normalizeSeasonId,
} = require('./nhlSeasonIdentity')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const RECENT_STANDINGS_SEASON_COUNT = 6
const CURRENT_STANDINGS_CACHE_TTL_MS = 10 * 60 * 1000
const HISTORICAL_STANDINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REGULAR_SEASON_GAME_TYPE_ID = 2
const NHL_STANDINGS_PROVIDER = 'NHL Web API'
const NHL_CLINCH_INDICATORS = Object.freeze([
  Object.freeze({ code: 'x', label: 'Clinched playoff berth' }),
  Object.freeze({ code: 'y', label: 'Clinched division title' }),
  Object.freeze({ code: 'z', label: 'Clinched conference title' }),
  Object.freeze({ code: 'p', label: "Clinched Presidents' Trophy" }),
  Object.freeze({ code: 'e', label: 'Eliminated from playoff contention' }),
])

const standingsCache = new Map()
const standingsInFlightRequests = new Map()

class StandingsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'StandingsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  return value?.default ?? ''
}

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const toOptionalInteger = (value) => {
  const numberValue = toOptionalNumber(value)

  return Number.isInteger(numberValue) ? numberValue : null
}

const normalizeTeamAbbreviation = (standing = {}) =>
  getLocalizedValue(standing.teamAbbrev).trim().toUpperCase()

const normalizeTeamName = (standing = {}) =>
  getLocalizedValue(standing.teamName) ||
  getLocalizedValue(standing.teamCommonName) ||
  getLocalizedValue(standing.placeName) ||
  normalizeTeamAbbreviation(standing) ||
  'Unknown Team'

const normalizeLastTenRecord = (standing = {}) => {
  const wins = toOptionalInteger(standing.l10Wins)
  const losses = toOptionalInteger(standing.l10Losses)
  const overtimeLosses = toOptionalInteger(standing.l10OtLosses)

  return [wins, losses, overtimeLosses].every(Number.isInteger)
    ? `${wins}-${losses}-${overtimeLosses}`
    : null
}

const normalizeStreak = (standing = {}) => {
  const code = String(standing.streakCode ?? '').trim().toUpperCase()
  const count = toOptionalInteger(standing.streakCount)

  return code && Number.isInteger(count) && count >= 0
    ? `${code}${count}`
    : null
}

const normalizeGoalDifferential = (standing = {}, goalsFor, goalsAgainst) => {
  const providerDifferential = toOptionalInteger(standing.goalDifferential)

  if (Number.isInteger(providerDifferential)) {
    return providerDifferential
  }

  return Number.isInteger(goalsFor) && Number.isInteger(goalsAgainst)
    ? goalsFor - goalsAgainst
    : null
}

const normalizeStandingRow = (standing = {}) => {
  const teamAbbreviation = normalizeTeamAbbreviation(standing)
  const teamName = normalizeTeamName(standing)
  const goalsFor = toOptionalInteger(standing.goalFor)
  const goalsAgainst = toOptionalInteger(standing.goalAgainst)

  if (!teamAbbreviation) {
    return null
  }

  return {
    clinchIndicator: String(standing.clinchIndicator ?? '').trim(),
    conference: getLocalizedValue(standing.conferenceName),
    conferenceRank: toOptionalInteger(standing.conferenceSequence),
    division: getLocalizedValue(standing.divisionName),
    divisionRank: toOptionalInteger(standing.divisionSequence),
    gamesPlayed: toOptionalInteger(standing.gamesPlayed),
    goalDifferential: normalizeGoalDifferential(
      standing,
      goalsFor,
      goalsAgainst,
    ),
    goalsAgainst,
    goalsFor,
    last10Record: normalizeLastTenRecord(standing),
    losses: toOptionalInteger(standing.losses),
    officialRank: toOptionalInteger(standing.leagueSequence),
    overtimeLosses: toOptionalInteger(standing.otLosses),
    pointPercentage: toOptionalNumber(standing.pointPctg),
    points: toOptionalInteger(standing.points),
    regulationPlusOvertimeWins: toOptionalInteger(
      standing.regulationPlusOtWins,
    ),
    regulationWins: toOptionalInteger(standing.regulationWins),
    streak: normalizeStreak(standing),
    teamAbbreviation,
    teamId:
      getNhlTeamIdentity(teamAbbreviation, teamName) ?? teamAbbreviation,
    teamLogo: String(standing.teamLogo ?? '').trim(),
    teamName,
    wildcardRank: toOptionalInteger(standing.wildcardSequence),
    wins: toOptionalInteger(standing.wins),
  }
}

const compareOfficialOrder = (left, right) =>
  (left.officialRank ?? Number.POSITIVE_INFINITY) -
    (right.officialRank ?? Number.POSITIVE_INFINITY) ||
  left.teamName.localeCompare(right.teamName)

const normalizeStandings = (standings, seasonId) =>
  (Array.isArray(standings) ? standings : [])
    .filter(
      (standing) =>
        normalizeSeasonId(standing.seasonId) === seasonId &&
        Number(standing.gameTypeId) === REGULAR_SEASON_GAME_TYPE_ID,
    )
    .map(normalizeStandingRow)
    .filter(Boolean)
    .sort(compareOfficialOrder)

const normalizeSeasonOption = (season, currentSeasonId) => ({
  endDate: season.endDate,
  id: normalizeSeasonId(season.id),
  isCurrent:
    normalizeSeasonId(season.id) === currentSeasonId ||
    Boolean(season.isCurrent),
  label: season.label || getSeasonLabel(season.id),
  startDate: season.startDate,
})

const loadRecentSeasons = async (options = {}) => {
  const seasonMetadataProvider =
    options.seasonMetadataProvider ??
    (() =>
      nhlSeasonService.getAvailablePowerRatingHistorySeasons({
        count: RECENT_STANDINGS_SEASON_COUNT,
      }))
  const metadata = await seasonMetadataProvider()
  const currentSeasonId = normalizeSeasonId(metadata?.currentSeasonId)
  const seasons = (Array.isArray(metadata?.seasons) ? metadata.seasons : [])
    .map((season) => normalizeSeasonOption(season, currentSeasonId))
    .filter(
      (season) =>
        season.id && season.startDate && season.endDate && season.label,
    )
    .slice(0, RECENT_STANDINGS_SEASON_COUNT)

  if (!currentSeasonId || seasons.length === 0) {
    throw new StandingsError(
      'Recent NHL standings seasons are unavailable.',
      503,
    )
  }

  return {
    currentSeasonId,
    seasons,
  }
}

const resolveSelectedSeason = ({ query = {}, seasonMetadata }) => {
  if (query === null || Array.isArray(query) || typeof query !== 'object') {
    throw new StandingsError('Standings query must be an object.', 400, {
      code: 'invalid_season',
    })
  }

  const unsupportedFields = Object.keys(query).filter(
    (field) => field !== 'season',
  )

  if (unsupportedFields.length > 0) {
    throw new StandingsError(
      'Standings query contains unsupported fields.',
      400,
      { code: 'invalid_season', unsupportedFields },
    )
  }

  const requestedSeasonId = Object.hasOwn(query, 'season')
    ? normalizeSeasonId(query.season)
    : seasonMetadata.currentSeasonId

  if (!requestedSeasonId) {
    throw new StandingsError(
      'season must use canonical YYYYyyyy or display YYYY–yy format.',
      400,
      { code: 'invalid_season' },
    )
  }

  const selectedSeason = seasonMetadata.seasons.find(
    (season) => season.id === requestedSeasonId,
  )

  if (!selectedSeason) {
    throw new StandingsError(
      'Standings are limited to the current and five previous NHL seasons.',
      400,
      {
        code: 'invalid_season',
        supportedSeasonIds: seasonMetadata.seasons.map((season) => season.id),
      },
    )
  }

  return selectedSeason
}

const normalizeProviderState = (result) => {
  if (result?.data && typeof result.data === 'object') {
    return result
  }

  return {
    data: result,
    fetchedAt: null,
    source: 'live',
    stale: false,
  }
}

const buildProviderResponse = (providerState, standingDate) => ({
  endpoint: `/standings/${standingDate}`,
  fetchedAt: providerState?.fetchedAt ?? null,
  name: NHL_STANDINGS_PROVIDER,
  source: providerState?.source ?? null,
  stale: Boolean(providerState?.stale),
})

const buildBaseResponse = ({ seasonMetadata, selectedSeason }) => ({
  clinchIndicators: NHL_CLINCH_INDICATORS,
  currentSeasonId: seasonMetadata.currentSeasonId,
  season: selectedSeason,
  seasons: seasonMetadata.seasons,
  selectedSeasonId: selectedSeason.id,
})

const loadStandingsResponse = async ({
  options,
  seasonMetadata,
  selectedSeason,
}) => {
  const isCurrent = selectedSeason.id === seasonMetadata.currentSeasonId
  const standingDate = isCurrent ? 'now' : selectedSeason.endDate
  const standingsProvider =
    options.standingsProvider ?? nhlApiService.getLeagueStandings
  let providerState

  try {
    providerState = normalizeProviderState(
      await standingsProvider(standingDate),
    )
  } catch (error) {
    return {
      ...buildBaseResponse({ seasonMetadata, selectedSeason }),
      error: {
        code: 'provider_error',
        message: 'NHL standings are temporarily unavailable.',
      },
      provider: buildProviderResponse(null, standingDate),
      standings: [],
      status: 'provider_error',
    }
  }

  const standings = normalizeStandings(
    providerState.data?.standings,
    selectedSeason.id,
  )
  const hasPlayedRegularSeasonGame = standings.some(
    (standing) => (standing.gamesPlayed ?? 0) > 0,
  )
  const visibleStandings = hasPlayedRegularSeasonGame ? standings : []
  const status = visibleStandings.length > 0
    ? 'ready'
    : isCurrent
      ? 'no_standings'
      : 'unavailable'

  return {
    ...buildBaseResponse({ seasonMetadata, selectedSeason }),
    error:
      status === 'unavailable'
        ? {
            code: 'unavailable',
            message: 'Standings are unavailable for the selected season.',
          }
        : null,
    provider: buildProviderResponse(providerState, standingDate),
    standings: visibleStandings,
    status,
  }
}

const getStandings = async (query = {}, options = {}) => {
  const seasonMetadata = await loadRecentSeasons(options)
  const selectedSeason = resolveSelectedSeason({ query, seasonMetadata })
  const cache = options.cache ?? standingsCache
  const inFlightRequests =
    options.inFlightRequests ?? standingsInFlightRequests
  const now = options.nowProvider ?? Date.now
  const cacheKey = `${seasonMetadata.currentSeasonId}:${selectedSeason.id}`
  const cached = cache.get(cacheKey)
  const nowMs = now()

  if (cached && cached.expiresAt > nowMs) {
    return cached.response
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)
  }

  const requestPromise = loadStandingsResponse({
    options,
    seasonMetadata,
    selectedSeason,
  })
    .then((response) => {
      if (response.status !== 'provider_error') {
        const ttl = selectedSeason.isCurrent
          ? CURRENT_STANDINGS_CACHE_TTL_MS
          : HISTORICAL_STANDINGS_CACHE_TTL_MS

        cache.set(cacheKey, {
          expiresAt: now() + ttl,
          response,
        })
      }

      return response
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey)
    })

  inFlightRequests.set(cacheKey, requestPromise)

  return requestPromise
}

module.exports = {
  CURRENT_STANDINGS_CACHE_TTL_MS,
  HISTORICAL_STANDINGS_CACHE_TTL_MS,
  NHL_STANDINGS_PROVIDER,
  NHL_CLINCH_INDICATORS,
  RECENT_STANDINGS_SEASON_COUNT,
  StandingsError,
  getStandings,
  normalizeStandingRow,
  normalizeStandings,
  resolveSelectedSeason,
}
