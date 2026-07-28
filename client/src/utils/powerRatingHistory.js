import { NHL_TEAMS } from '../data/teams.js'
import {
  formatLocalDateInputValue,
  parseLocalDateInputValue,
} from './powerRatingUpdates.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RESULT_TYPES = ['REGULATION', 'OVERTIME', 'SHOOTOUT']
const RESULT_MULTIPLIER_FIELDS = Object.freeze({
  OVERTIME: {
    field: 'overtimeMultiplier',
    label: 'Overtime Multiplier',
  },
  REGULATION: {
    field: 'regulationMultiplier',
    label: 'Regulation Multiplier',
  },
  SHOOTOUT: {
    field: 'shootoutMultiplier',
    label: 'Shootout Multiplier',
  },
})

export const POWER_RATING_HISTORY_DEFAULT_PAGE = 1
export const POWER_RATING_HISTORY_DEFAULT_LIMIT = 25
export const POWER_RATING_HISTORY_LIMIT_OPTIONS = [10, 25, 50, 100]
export const POWER_RATING_HISTORY_SEASON_ALL = 'all'
export const POWER_RATING_HISTORY_SEASON_CUSTOM = 'custom'
export const POWER_RATING_HISTORY_UNAVAILABLE =
  'Not available for this historical record'

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const normalizeOptionalDate = (value) =>
  typeof value === 'string' && DATE_PATTERN.test(value.trim())
    ? value.trim()
    : ''

const hasValue = (value) =>
  value !== null && value !== undefined && String(value).trim() !== ''

const toOptionalNumber = (value) => {
  if (!hasValue(value)) {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const normalizeHistoryTeam = (team = {}) => ({
  abbreviation: normalizeIdentifier(team.abbreviation ?? team.id),
  id:
    team.id === null || team.id === undefined || team.id === ''
      ? null
      : String(team.id),
  name: typeof team.name === 'string' ? team.name : '',
})

const normalizeEngineSettingsSnapshot = (snapshot) => {
  if (!isPlainObject(snapshot)) {
    return null
  }

  return {
    homeAdvantage: toOptionalNumber(snapshot.homeAdvantage),
    kFactor: toOptionalNumber(snapshot.kFactor),
    modelVersion:
      typeof snapshot.modelVersion === 'string' ? snapshot.modelVersion : '',
    overtimeMultiplier: toOptionalNumber(snapshot.overtimeMultiplier),
    regulationMultiplier: toOptionalNumber(snapshot.regulationMultiplier),
    shootoutMultiplier: toOptionalNumber(snapshot.shootoutMultiplier),
  }
}

const normalizeHistoryItem = (item = {}) => ({
  awayRatingAfter: toOptionalNumber(item.awayRatingAfter),
  awayRatingBefore: toOptionalNumber(item.awayRatingBefore),
  awayRatingChange: toOptionalNumber(item.awayRatingChange),
  awayScore: toOptionalNumber(item.awayScore),
  awayTeam: normalizeHistoryTeam(item.awayTeam),
  baseHomeAdvantage: toOptionalNumber(item.baseHomeAdvantage),
  effectiveHomeAdvantage: toOptionalNumber(item.effectiveHomeAdvantage),
  engineSettingsSnapshot: normalizeEngineSettingsSnapshot(
    item.engineSettingsSnapshot,
  ),
  gameDate: normalizeOptionalDate(item.gameDate),
  gameId:
    item.gameId === null || item.gameId === undefined || item.gameId === ''
      ? null
      : String(item.gameId),
  homeRatingAfter: toOptionalNumber(item.homeRatingAfter),
  homeRatingBefore: toOptionalNumber(item.homeRatingBefore),
  homeRatingChange: toOptionalNumber(item.homeRatingChange),
  homeScore: toOptionalNumber(item.homeScore),
  homeTeam: normalizeHistoryTeam(item.homeTeam),
  homeTeamAdjustment: toOptionalNumber(item.homeTeamAdjustment),
  id:
    item.id === null || item.id === undefined || item.id === ''
      ? null
      : String(item.id),
  processedAt:
    typeof item.processedAt === 'string' && item.processedAt.trim()
      ? item.processedAt.trim()
      : '',
  resultType: normalizeIdentifier(item.resultType),
})

const normalizePagination = (pagination = {}) => {
  const page = Number(pagination.page)
  const limit = Number(pagination.limit)
  const totalItems = Number(pagination.totalItems)
  const totalPages = Number(pagination.totalPages)

  return {
    hasNextPage: Boolean(pagination.hasNextPage),
    hasPreviousPage: Boolean(pagination.hasPreviousPage),
    limit:
      Number.isInteger(limit) && limit > 0
        ? limit
        : POWER_RATING_HISTORY_DEFAULT_LIMIT,
    page:
      Number.isInteger(page) && page > 0
        ? page
        : POWER_RATING_HISTORY_DEFAULT_PAGE,
    totalItems:
      Number.isInteger(totalItems) && totalItems >= 0 ? totalItems : 0,
    totalPages:
      Number.isInteger(totalPages) && totalPages >= 0 ? totalPages : 0,
  }
}

const normalizeHistoryFilters = (filters = {}) => ({
  from: typeof filters.from === 'string' ? filters.from : '',
  resultType: normalizeIdentifier(filters.resultType),
  team: normalizeIdentifier(filters.team),
  to: typeof filters.to === 'string' ? filters.to : '',
})

const normalizeMostRecentGame = (game) => {
  if (!isPlainObject(game)) {
    return null
  }

  return {
    awayTeam: normalizeIdentifier(game.awayTeam),
    gameDate: normalizeOptionalDate(game.gameDate),
    gameId:
      game.gameId === null || game.gameId === undefined || game.gameId === ''
        ? null
        : String(game.gameId),
    homeTeam: normalizeIdentifier(game.homeTeam),
    processedAt:
      typeof game.processedAt === 'string' && game.processedAt.trim()
        ? game.processedAt.trim()
        : '',
  }
}

const normalizeHistorySummary = (summary = {}) => ({
  dateRange: {
    from: normalizeOptionalDate(summary.dateRange?.from),
    to: normalizeOptionalDate(summary.dateRange?.to),
  },
  gamesProcessed: toOptionalNumber(summary.gamesProcessed) ?? 0,
  mostRecentGame: normalizeMostRecentGame(summary.mostRecentGame),
  teamsAffected: toOptionalNumber(summary.teamsAffected) ?? 0,
  totalRatingMovement: toOptionalNumber(summary.totalRatingMovement),
})

const normalizeHistorySeason = (season = {}) => ({
  endDate: normalizeOptionalDate(season.endDate),
  id:
    season.id === null || season.id === undefined || season.id === ''
      ? ''
      : String(season.id),
  isCurrent: Boolean(season.isCurrent),
  label: typeof season.label === 'string' ? season.label : '',
  startDate: normalizeOptionalDate(season.startDate),
})

export const normalizePowerRatingHistorySeasonsResponse = (data = {}) => {
  if (!isPlainObject(data) || !Array.isArray(data.seasons)) {
    throw new Error('Power Rating history seasons response was malformed.')
  }

  const seasons = data.seasons.map(normalizeHistorySeason).filter(
    (season) => season.id && season.label && season.startDate && season.endDate,
  )
  const currentSeasonId =
    typeof data.currentSeasonId === 'string'
      ? data.currentSeasonId
      : seasons.find((season) => season.isCurrent)?.id || seasons[0]?.id || ''

  return {
    currentSeasonId,
    metadataSource:
      typeof data.metadataSource === 'string' ? data.metadataSource : '',
    seasons: seasons.map((season) => ({
      ...season,
      isCurrent: season.id === currentSeasonId,
    })),
    warning: typeof data.warning === 'string' ? data.warning : '',
  }
}

export const getCurrentPowerRatingHistorySeasonId = (seasonMetadata) =>
  seasonMetadata?.currentSeasonId ||
  seasonMetadata?.seasons?.find((season) => season.isCurrent)?.id ||
  seasonMetadata?.seasons?.[0]?.id ||
  ''

export const createDefaultPowerRatingHistoryFilters = (seasonId = '') => ({
  from: '',
  resultType: '',
  season: seasonId,
  team: '',
  to: '',
})

export const getPowerRatingHistorySeasonById = (seasonMetadata, seasonId) =>
  seasonMetadata?.seasons?.find((season) => season.id === seasonId) ?? null

export const getPowerRatingHistorySeasonSelectValue = (
  filters = {},
  seasonMetadata,
) => filters.season || getCurrentPowerRatingHistorySeasonId(seasonMetadata)

export const getPowerRatingHistoryDateFields = (
  filters = {},
  seasonMetadata,
) => {
  const seasonValue = getPowerRatingHistorySeasonSelectValue(
    filters,
    seasonMetadata,
  )
  const selectedSeason = getPowerRatingHistorySeasonById(
    seasonMetadata,
    seasonValue,
  )

  if (selectedSeason) {
    return {
      disabled: true,
      from: selectedSeason.startDate,
      selectedSeason,
      to: selectedSeason.endDate,
    }
  }

  if (seasonValue === POWER_RATING_HISTORY_SEASON_ALL) {
    return {
      disabled: true,
      from: '',
      selectedSeason: null,
      to: '',
    }
  }

  return {
    disabled: false,
    from: filters.from ?? '',
    selectedSeason: null,
    to: filters.to ?? '',
  }
}

export const resolvePowerRatingHistoryFilters = (
  filters = {},
  seasonMetadata,
) => {
  const dateFields = getPowerRatingHistoryDateFields(filters, seasonMetadata)
  const seasonValue = getPowerRatingHistorySeasonSelectValue(
    filters,
    seasonMetadata,
  )
  const isAllSeasons = seasonValue === POWER_RATING_HISTORY_SEASON_ALL

  return {
    from: isAllSeasons ? '' : dateFields.from,
    resultType: filters.resultType ?? '',
    team: filters.team ?? '',
    to: isAllSeasons ? '' : dateFields.to,
  }
}

export const applyPowerRatingHistorySeasonSelection = (
  filters = {},
  seasonValue,
  seasonMetadata,
) => {
  const currentDateFields = getPowerRatingHistoryDateFields(
    filters,
    seasonMetadata,
  )

  if (seasonValue === POWER_RATING_HISTORY_SEASON_ALL) {
    return {
      ...filters,
      from: '',
      season: seasonValue,
      to: '',
    }
  }

  if (seasonValue === POWER_RATING_HISTORY_SEASON_CUSTOM) {
    return {
      ...filters,
      from: currentDateFields.from,
      season: seasonValue,
      to: currentDateFields.to,
    }
  }

  const selectedSeason = getPowerRatingHistorySeasonById(
    seasonMetadata,
    seasonValue,
  )

  return {
    ...filters,
    from: selectedSeason?.startDate ?? '',
    season: seasonValue,
    to: selectedSeason?.endDate ?? '',
  }
}

export const hasAppliedPowerRatingHistoryFilters = (filters = {}) =>
  Boolean(
    filters.from ||
      filters.to ||
      filters.team ||
      filters.resultType ||
      (filters.season && filters.season !== POWER_RATING_HISTORY_SEASON_ALL),
  )

export const validatePowerRatingHistoryFilters = (
  filters = {},
  { seasonMetadata, today = new Date() } = {},
) => {
  const fieldErrors = {}
  const todayDate =
    typeof today === 'string'
      ? parseLocalDateInputValue(today)
      : parseLocalDateInputValue(formatLocalDateInputValue(today))
  const seasonValue = getPowerRatingHistorySeasonSelectValue(
    filters,
    seasonMetadata,
  )
  const validatesCustomDates =
    !seasonValue || seasonValue === POWER_RATING_HISTORY_SEASON_CUSTOM
  const fromDate =
    validatesCustomDates && filters.from
      ? parseLocalDateInputValue(filters.from)
      : null
  const toDate =
    validatesCustomDates && filters.to
      ? parseLocalDateInputValue(filters.to)
      : null
  const supportedTeamIds = new Set(
    NHL_TEAMS.flatMap((team) => [team.id, team.abbreviation]).map(
      normalizeIdentifier,
    ),
  )
  const normalizedTeam = normalizeIdentifier(filters.team)
  const normalizedResultType = normalizeIdentifier(filters.resultType)

  if (validatesCustomDates && filters.from && !fromDate) {
    fieldErrors.from = 'Date From must use YYYY-MM-DD.'
  }

  if (validatesCustomDates && filters.to && !toDate) {
    fieldErrors.to = 'Date To must use YYYY-MM-DD.'
  }

  if (fromDate && todayDate && fromDate > todayDate) {
    fieldErrors.from = 'Date From cannot be in the future.'
  }

  if (toDate && todayDate && toDate > todayDate) {
    fieldErrors.to = 'Date To cannot be in the future.'
  }

  if (fromDate && toDate && fromDate > toDate) {
    fieldErrors.from = 'Date From must be on or before Date To.'
  }

  if (normalizedTeam && !supportedTeamIds.has(normalizedTeam)) {
    fieldErrors.team = 'Team must match an NHL team.'
  }

  if (normalizedResultType && !RESULT_TYPES.includes(normalizedResultType)) {
    fieldErrors.resultType =
      'Result Type must be Regulation, Overtime, or Shootout.'
  }

  const message = Object.values(fieldErrors)[0] ?? ''

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    message,
  }
}

export const buildPowerRatingHistoryQueryString = (params = {}) => {
  const queryParams = new URLSearchParams()
  const page = Number(params.page)
  const limit = Number(params.limit)
  const filters = resolvePowerRatingHistoryFilters(
    params.filters ?? params,
    params.seasonMetadata,
  )
  const from = typeof filters.from === 'string' ? filters.from.trim() : ''
  const to = typeof filters.to === 'string' ? filters.to.trim() : ''
  const team = normalizeIdentifier(filters.team)
  const resultType = normalizeIdentifier(filters.resultType)

  queryParams.set(
    'page',
    String(
      Number.isInteger(page) && page > 0
        ? page
        : POWER_RATING_HISTORY_DEFAULT_PAGE,
    ),
  )
  queryParams.set(
    'limit',
    String(
      Number.isInteger(limit) && limit > 0
        ? limit
        : POWER_RATING_HISTORY_DEFAULT_LIMIT,
    ),
  )

  if (from) {
    queryParams.set('from', from)
  }

  if (to) {
    queryParams.set('to', to)
  }

  if (team) {
    queryParams.set('team', team)
  }

  if (resultType) {
    queryParams.set('resultType', resultType)
  }

  return `?${queryParams.toString()}`
}

export const normalizePowerRatingHistoryResponse = (data = {}) => {
  if (
    !isPlainObject(data) ||
    !Array.isArray(data.items) ||
    !isPlainObject(data.pagination)
  ) {
    throw new Error('Power Rating history response was malformed.')
  }

  return {
    filters: normalizeHistoryFilters(data.filters),
    items: data.items.map(normalizeHistoryItem),
    pagination: normalizePagination(data.pagination),
    summary: normalizeHistorySummary(data.summary),
  }
}

export const formatHistoryRatingValue = (value) => {
  const numberValue = toOptionalNumber(value)

  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : '--'
}

export const formatHistorySignedRatingChange = (value) => {
  const numberValue = toOptionalNumber(value)

  if (!Number.isFinite(numberValue)) {
    return '--'
  }

  return `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(2)}`
}

export const formatHistoryDate = (value) => {
  const normalizedDate = normalizeOptionalDate(value)

  if (!normalizedDate) {
    return 'Date unavailable'
  }

  const [year, month, day] = normalizedDate.split('-').map(Number)

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export const formatHistoryTimestamp = (value) => {
  if (!value) {
    return POWER_RATING_HISTORY_UNAVAILABLE
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return POWER_RATING_HISTORY_UNAVAILABLE
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export const formatHistoryScore = (item) => {
  const awayTeam = item.awayTeam?.abbreviation || 'Away'
  const homeTeam = item.homeTeam?.abbreviation || 'Home'

  if (Number.isFinite(item.awayScore) && Number.isFinite(item.homeScore)) {
    return `${awayTeam} ${item.awayScore}-${item.homeScore} ${homeTeam}`
  }

  return `${awayTeam} at ${homeTeam}`
}

export const getHistoryRatingChangeTone = (value) => {
  const numberValue = toOptionalNumber(value)

  if (numberValue > 0) {
    return 'positive'
  }

  if (numberValue < 0) {
    return 'negative'
  }

  return 'neutral'
}

export const getPowerRatingHistoryEmptyState = ({
  filters = {},
  selectedSeason = null,
  totalItems = 0,
} = {}) => {
  if (totalItems > 0) {
    return null
  }

  const hasTeamOrResultFilter = Boolean(filters.team || filters.resultType)
  const seasonValue = filters.season ?? ''

  if (selectedSeason) {
    return hasTeamOrResultFilter
      ? {
          message: 'No records match the selected season and team filters.',
          title: 'No matching update records',
        }
      : {
          message: `No Power Rating updates have been processed for the ${selectedSeason.label} season.`,
          title: `No ${selectedSeason.label} update history`,
        }
  }

  if (seasonValue === POWER_RATING_HISTORY_SEASON_ALL && hasTeamOrResultFilter) {
    return {
      message: 'No records match the selected team or result-type filters.',
      title: 'No matching update records',
    }
  }

  if (hasAppliedPowerRatingHistoryFilters(filters)) {
    return {
      message: 'No update records match the selected filters.',
      title: 'No matching update records',
    }
  }

  return {
    message: 'No Power Rating updates have been processed yet.',
    title: 'No update history yet',
  }
}

export const getNextPowerRatingHistoryPage = (
  pagination,
  direction,
) => {
  const page = Number(pagination?.page)
  const totalPages = Number(pagination?.totalPages)
  const currentPage =
    Number.isInteger(page) && page > 0
      ? page
      : POWER_RATING_HISTORY_DEFAULT_PAGE
  const safeTotalPages =
    Number.isInteger(totalPages) && totalPages > 0
      ? totalPages
      : currentPage

  if (direction === 'previous') {
    return Math.max(1, currentPage - 1)
  }

  if (direction === 'next') {
    return Math.min(safeTotalPages, currentPage + 1)
  }

  return currentPage
}

const makeDetailRow = ({ key, label, value }) => ({
  isAvailable: value !== POWER_RATING_HISTORY_UNAVAILABLE,
  key,
  label,
  value,
})

const formatDetailNumber = (value) => {
  const numberValue = toOptionalNumber(value)

  return Number.isFinite(numberValue)
    ? numberValue.toFixed(2)
    : POWER_RATING_HISTORY_UNAVAILABLE
}

const formatDetailTransition = (before, after) => {
  const beforeValue = toOptionalNumber(before)
  const afterValue = toOptionalNumber(after)

  if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) {
    return POWER_RATING_HISTORY_UNAVAILABLE
  }

  return `${beforeValue.toFixed(2)} -> ${afterValue.toFixed(2)}`
}

export const getPowerRatingHistoryAuditRows = (item = {}) => {
  const snapshot = item.engineSettingsSnapshot ?? {}
  const normalizedResultType = normalizeIdentifier(item.resultType)
  const multiplier = RESULT_MULTIPLIER_FIELDS[normalizedResultType]
  const multiplierValue = multiplier
    ? snapshot[multiplier.field]
    : undefined

  return [
    makeDetailRow({
      key: 'kFactor',
      label: 'K Factor',
      value: formatDetailNumber(snapshot.kFactor),
    }),
    makeDetailRow({
      key: 'baseHomeAdvantage',
      label: 'Base Home Advantage',
      value: formatDetailNumber(item.baseHomeAdvantage ?? snapshot.homeAdvantage),
    }),
    makeDetailRow({
      key: 'homeTeamAdjustment',
      label: 'Home Team Adjustment',
      value: formatDetailNumber(item.homeTeamAdjustment),
    }),
    makeDetailRow({
      key: 'effectiveHomeAdvantage',
      label: 'Effective Home Advantage',
      value: formatDetailNumber(item.effectiveHomeAdvantage),
    }),
    makeDetailRow({
      key: 'resultMultiplier',
      label: multiplier?.label ?? 'Result Multiplier',
      value: formatDetailNumber(multiplierValue),
    }),
    makeDetailRow({
      key: 'processedAt',
      label: 'Processing Timestamp',
      value: formatHistoryTimestamp(item.processedAt),
    }),
    makeDetailRow({
      key: 'gameId',
      label: 'NHL Game ID',
      value: item.gameId ? String(item.gameId) : POWER_RATING_HISTORY_UNAVAILABLE,
    }),
    makeDetailRow({
      key: 'awayRatingTransition',
      label: `${item.awayTeam?.abbreviation || 'Away'} Rating`,
      value: formatDetailTransition(item.awayRatingBefore, item.awayRatingAfter),
    }),
    makeDetailRow({
      key: 'homeRatingTransition',
      label: `${item.homeTeam?.abbreviation || 'Home'} Rating`,
      value: formatDetailTransition(item.homeRatingBefore, item.homeRatingAfter),
    }),
  ]
}
