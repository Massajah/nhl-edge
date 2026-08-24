import { normalizeBets } from './savedAnalyses.js'

export const BET_HISTORY_DEFAULT_PAGE = 1
export const BET_HISTORY_DEFAULT_LIMIT = 5
export const BET_HISTORY_LIMIT_OPTIONS = [5, 10, 20]
export const BET_HISTORY_SEASON_ALL = 'all'
export const BET_HISTORY_SEASON_CURRENT = 'current'
export const BET_HISTORY_MODEL_STATUSES = Object.freeze({
  BET_CANDIDATE: 'Bet Candidate',
  POSITIVE_VALUE_BELOW_THRESHOLD: 'Positive Value · Below Threshold',
  NO_VALUE: 'No Value',
  LEGACY: 'Legacy',
})

export const normalizeBetHistoryModelStatus = (value) => {
  const normalizedValue = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  if (
    normalizedValue === 'bet_candidate' ||
    normalizedValue === 'positive_value'
  ) {
    return BET_HISTORY_MODEL_STATUSES.BET_CANDIDATE
  }

  if (
    normalizedValue === 'positive_value_below_threshold' ||
    normalizedValue === 'below_threshold'
  ) {
    return BET_HISTORY_MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD
  }

  if (normalizedValue === 'no_value') {
    return BET_HISTORY_MODEL_STATUSES.NO_VALUE
  }

  return BET_HISTORY_MODEL_STATUSES.LEGACY
}

const toInteger = (value, fallback = 0) => {
  const number = Number(value)

  return Number.isInteger(number) ? number : fallback
}

const toNumber = (value) => {
  const number = Number(value)

  return Number.isFinite(number) ? number : 0
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const buildBetHistoryQueryString = ({
  limit = BET_HISTORY_DEFAULT_LIMIT,
  modelStatus = 'all',
  page = BET_HISTORY_DEFAULT_PAGE,
  result = 'all',
  season = BET_HISTORY_SEASON_ALL,
} = {}) => {
  const query = new URLSearchParams()
  const safeLimit = toInteger(limit, BET_HISTORY_DEFAULT_LIMIT)
  const safePage = toInteger(page, BET_HISTORY_DEFAULT_PAGE)

  query.set('page', String(safePage > 0 ? safePage : BET_HISTORY_DEFAULT_PAGE))
  query.set(
    'limit',
    String(safeLimit > 0 ? safeLimit : BET_HISTORY_DEFAULT_LIMIT),
  )
  query.set('result', String(result || 'all'))
  query.set('modelStatus', String(modelStatus || 'all'))
  query.set('season', String(season || BET_HISTORY_SEASON_ALL))

  return `?${query.toString()}`
}

const normalizePagination = (pagination = {}) => {
  const page = toInteger(pagination.page, BET_HISTORY_DEFAULT_PAGE)
  const pageSize = toInteger(
    pagination.pageSize,
    BET_HISTORY_DEFAULT_LIMIT,
  )
  const totalItems = toInteger(pagination.totalItems)
  const totalPages = toInteger(pagination.totalPages)

  return {
    hasNextPage: Boolean(pagination.hasNextPage),
    hasPreviousPage: Boolean(pagination.hasPreviousPage),
    page: page > 0 ? page : BET_HISTORY_DEFAULT_PAGE,
    pageSize: pageSize > 0 ? pageSize : BET_HISTORY_DEFAULT_LIMIT,
    totalItems: totalItems >= 0 ? totalItems : 0,
    totalPages: totalPages >= 0 ? totalPages : 0,
  }
}

const normalizeSummary = (summary = {}) => {
  const statusCounts = Object.values(BET_HISTORY_MODEL_STATUSES).reduce(
    (counts, status) => ({ ...counts, [status]: 0 }),
    {},
  )

  if (isPlainObject(summary.statusCounts)) {
    Object.entries(summary.statusCounts).forEach(([status, count]) => {
      const normalizedStatus = normalizeBetHistoryModelStatus(status)

      statusCounts[normalizedStatus] += Math.max(0, toInteger(count))
    })
  }

  return {
    losses: Math.max(0, toInteger(summary.losses)),
    pending: Math.max(0, toInteger(summary.pending)),
    pushes: Math.max(0, toInteger(summary.pushes)),
    settledStake: toNumber(summary.settledStake),
    statusCounts,
    totalBets: Math.max(0, toInteger(summary.totalBets)),
    totalProfit: toNumber(summary.totalProfit),
    totalStake: toNumber(summary.totalStake),
    wins: Math.max(0, toInteger(summary.wins)),
  }
}

export const normalizeBetHistoryResponse = (data = {}) => {
  if (
    !isPlainObject(data) ||
    !Array.isArray(data.items) ||
    !isPlainObject(data.pagination) ||
    !isPlainObject(data.summary)
  ) {
    throw new Error('Bet history response was malformed.')
  }

  return {
    filters: isPlainObject(data.filters) ? data.filters : {},
    items: normalizeBets(data.items).map((bet) => ({
      ...bet,
      modelStatus: normalizeBetHistoryModelStatus(
        bet.recommendationState || bet.modelStatus,
      ),
    })),
    pagination: normalizePagination(data.pagination),
    summary: normalizeSummary(data.summary),
  }
}

export const createEmptyBetHistoryResponse = () => ({
  filters: {
    modelStatus: 'all',
    result: 'all',
    season: BET_HISTORY_SEASON_ALL,
  },
  items: [],
  pagination: normalizePagination(),
  summary: normalizeSummary(),
})
