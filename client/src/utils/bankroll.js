import { normalizePowerRatingHistorySeasonsResponse } from './powerRatingHistory.js'
import {
  formatLocalDateInputValue,
  parseLocalDateInputValue,
} from './powerRatingUpdates.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/

export const BANKROLL_DEFAULT_CURRENCY = 'EUR'
export const BANKROLL_DEFAULT_PAGE = 1
export const BANKROLL_DEFAULT_LIMIT = 10
export const BANKROLL_LIMIT_OPTIONS = [10, 25, 50]
export const BANKROLL_PERIOD_ALL_TIME = 'all-time'
export const BANKROLL_PERIOD_SEASON = 'season'
export const BANKROLL_PERIOD_CUSTOM = 'custom'
export const BANKROLL_SEASON_ALL = 'all'
export const BANKROLL_SEASON_CUSTOM = 'custom'
export const BANKROLL_TRANSACTION_TYPES = [
  'STARTING_BALANCE',
  'DEPOSIT',
  'WITHDRAWAL',
  'BET_SETTLEMENT',
  'ADJUSTMENT',
]

export const BANKROLL_TRANSACTION_LABELS = Object.freeze({
  ADJUSTMENT: 'Adjustment',
  BET_SETTLEMENT: 'Bet settlement',
  DEPOSIT: 'Deposit',
  STARTING_BALANCE: 'Starting balance',
  WITHDRAWAL: 'Withdrawal',
})

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasValue = (value) =>
  value !== null && value !== undefined && String(value).trim() !== ''

const toNumber = (value, fallback = 0) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const toInteger = (value, fallback = 0) => {
  const numberValue = Number(value)

  return Number.isInteger(numberValue) ? numberValue : fallback
}

const normalizeOptionalDate = (value) =>
  typeof value === 'string' && DATE_PATTERN.test(value.trim())
    ? value.trim()
    : ''

const normalizeTimestamp = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : ''

export const normalizeBankrollCurrency = (value) => {
  const currency = String(value || BANKROLL_DEFAULT_CURRENCY)
    .trim()
    .toUpperCase()

  return /^[A-Z]{3}$/.test(currency) ? currency : BANKROLL_DEFAULT_CURRENCY
}

export const isValidBankrollMoneyInput = (
  value,
  { allowZero = false } = {},
) => {
  if (!hasValue(value)) {
    return false
  }

  const trimmedValue = String(value).trim()

  if (!MONEY_PATTERN.test(trimmedValue)) {
    return false
  }

  return allowZero || Number(trimmedValue) > 0
}

const toMoneyNumber = (value, fallback = 0) =>
  Number(toNumber(value, fallback).toFixed(2))

export const parseBankrollMoneyInput = (
  value,
  { allowZero = false } = {},
) => {
  if (!isValidBankrollMoneyInput(value, { allowZero })) {
    return null
  }

  return toMoneyNumber(value)
}

const normalizeMoneyField = (source, field) => {
  const cents = Number(source?.[`${field}Cents`])

  if (Number.isInteger(cents)) {
    return {
      [`${field}`]: Number((cents / 100).toFixed(2)),
      [`${field}Cents`]: cents,
    }
  }

  const value = toMoneyNumber(source?.[field])

  return {
    [`${field}`]: value,
    [`${field}Cents`]: Math.round(value * 100),
  }
}

const normalizeSeason = (season = {}) => ({
  endDate: normalizeOptionalDate(season.endDate),
  id:
    season.id === null || season.id === undefined || season.id === ''
      ? ''
      : String(season.id),
  isCurrent: Boolean(season.isCurrent),
  label: typeof season.label === 'string' ? season.label : '',
  startDate: normalizeOptionalDate(season.startDate),
})

const normalizePeriod = (period = {}) => ({
  from: normalizeOptionalDate(period.from),
  key:
    period.key === BANKROLL_PERIOD_SEASON ||
    period.key === BANKROLL_PERIOD_CUSTOM
      ? period.key
      : BANKROLL_PERIOD_ALL_TIME,
  season: isPlainObject(period.season) ? normalizeSeason(period.season) : null,
  to: normalizeOptionalDate(period.to),
})

export const normalizeBankrollSummary = (data = {}) => {
  const source = isPlainObject(data.summary) ? data.summary : data

  return {
    ...normalizeMoneyField(source, 'availableBankroll'),
    ...normalizeMoneyField(source, 'bettingProfit'),
    ...normalizeMoneyField(source, 'cashFlow'),
    ...normalizeMoneyField(source, 'currentBankroll'),
    ...normalizeMoneyField(source, 'deposits'),
    ...normalizeMoneyField(source, 'pendingStake'),
    ...normalizeMoneyField(source, 'startingBalance'),
    ...normalizeMoneyField(source, 'withdrawals'),
    currency: normalizeBankrollCurrency(source.currency),
    initialized: Boolean(source.initialized),
    initializedAt: normalizeTimestamp(source.initializedAt),
    initializedDate: normalizeOptionalDate(source.initializedDate),
    period: normalizePeriod(source.period),
    settledBets: Math.max(0, toInteger(source.settledBets)),
  }
}

export const normalizeBankrollTransaction = (item = {}) => {
  const amountCents =
    item.amountCents !== null &&
    item.amountCents !== undefined &&
    Number.isInteger(Number(item.amountCents))
    ? Number(item.amountCents)
    : Math.round(toNumber(item.amount) * 100)
  const runningBalanceCents =
    item.runningBalanceCents !== null &&
    item.runningBalanceCents !== undefined &&
    Number.isInteger(Number(item.runningBalanceCents))
    ? Number(item.runningBalanceCents)
    : null

  return {
    amount: Number((amountCents / 100).toFixed(2)),
    amountCents,
    betId:
      item.betId === null || item.betId === undefined || item.betId === ''
        ? ''
        : String(item.betId),
    createdAt: normalizeTimestamp(item.createdAt),
    description: typeof item.description === 'string' ? item.description : '',
    id:
      item.id === null || item.id === undefined || item.id === ''
        ? ''
        : String(item.id),
    metadata: isPlainObject(item.metadata) ? item.metadata : {},
    occurredAt: normalizeTimestamp(item.occurredAt),
    occurredDate: normalizeOptionalDate(item.occurredDate),
    runningBalance:
      runningBalanceCents === null
        ? item.runningBalance === null || item.runningBalance === undefined
          ? null
          : toMoneyNumber(item.runningBalance)
        : Number((runningBalanceCents / 100).toFixed(2)),
    runningBalanceCents,
    type: BANKROLL_TRANSACTION_TYPES.includes(item.type)
      ? item.type
      : 'ADJUSTMENT',
    updatedAt: normalizeTimestamp(item.updatedAt),
  }
}

const normalizePagination = (pagination = {}) => {
  const page = toInteger(pagination.page, BANKROLL_DEFAULT_PAGE)
  const limit = toInteger(pagination.limit, BANKROLL_DEFAULT_LIMIT)
  const totalItems = toInteger(pagination.totalItems)
  const totalPages = toInteger(pagination.totalPages)

  return {
    hasNextPage: Boolean(pagination.hasNextPage),
    hasPreviousPage: Boolean(pagination.hasPreviousPage),
    limit: limit > 0 ? limit : BANKROLL_DEFAULT_LIMIT,
    page: page > 0 ? page : BANKROLL_DEFAULT_PAGE,
    totalItems: totalItems >= 0 ? totalItems : 0,
    totalPages: totalPages >= 0 ? totalPages : 0,
  }
}

export const normalizeBankrollTransactionsResponse = (data = {}) => {
  if (
    !isPlainObject(data) ||
    !Array.isArray(data.items) ||
    !isPlainObject(data.pagination)
  ) {
    throw new Error('Bankroll transactions response was malformed.')
  }

  return {
    filters: isPlainObject(data.filters) ? data.filters : {},
    items: data.items.map(normalizeBankrollTransaction),
    pagination: normalizePagination(data.pagination),
    season: isPlainObject(data.season) ? normalizeSeason(data.season) : null,
  }
}

export const normalizeBankrollSeasonsResponse = (data = {}) =>
  normalizePowerRatingHistorySeasonsResponse(data)

export const getCurrentBankrollSeasonId = (seasonMetadata) =>
  seasonMetadata?.currentSeasonId ||
  seasonMetadata?.seasons?.find((season) => season.isCurrent)?.id ||
  seasonMetadata?.seasons?.[0]?.id ||
  ''

export const createDefaultBankrollFilters = () => ({
  from: '',
  period: BANKROLL_PERIOD_ALL_TIME,
  season: BANKROLL_SEASON_ALL,
  to: '',
  type: '',
})

export const getBankrollSeasonById = (seasonMetadata, seasonId) =>
  seasonMetadata?.seasons?.find((season) => season.id === seasonId) ?? null

export const getBankrollPeriodSelectValue = (filters = {}) => {
  if (filters.period === BANKROLL_PERIOD_CUSTOM) {
    return BANKROLL_SEASON_CUSTOM
  }

  if (filters.period === BANKROLL_PERIOD_SEASON && filters.season) {
    return filters.season
  }

  return BANKROLL_SEASON_ALL
}

export const getBankrollDateFields = (filters = {}, seasonMetadata) => {
  const periodValue = getBankrollPeriodSelectValue(filters)
  const selectedSeason = getBankrollSeasonById(seasonMetadata, periodValue)

  if (selectedSeason) {
    return {
      disabled: true,
      from: selectedSeason.startDate,
      selectedSeason,
      to: selectedSeason.endDate,
    }
  }

  if (periodValue === BANKROLL_SEASON_ALL) {
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

export const applyBankrollPeriodSelection = (
  filters = {},
  periodValue,
  seasonMetadata,
) => {
  const currentDateFields = getBankrollDateFields(filters, seasonMetadata)

  if (periodValue === BANKROLL_SEASON_ALL) {
    return {
      ...filters,
      from: '',
      period: BANKROLL_PERIOD_ALL_TIME,
      season: BANKROLL_SEASON_ALL,
      to: '',
    }
  }

  if (periodValue === BANKROLL_SEASON_CUSTOM) {
    return {
      ...filters,
      from: currentDateFields.from,
      period: BANKROLL_PERIOD_CUSTOM,
      season: BANKROLL_SEASON_CUSTOM,
      to: currentDateFields.to,
    }
  }

  const selectedSeason = getBankrollSeasonById(seasonMetadata, periodValue)

  return {
    ...filters,
    from: selectedSeason?.startDate ?? '',
    period: BANKROLL_PERIOD_SEASON,
    season: periodValue,
    to: selectedSeason?.endDate ?? '',
  }
}

export const resolveBankrollFilters = (filters = {}, seasonMetadata) => {
  const periodValue = getBankrollPeriodSelectValue(filters)
  const selectedSeason = getBankrollSeasonById(seasonMetadata, periodValue)

  if (selectedSeason) {
    return {
      from: selectedSeason.startDate,
      period: BANKROLL_PERIOD_SEASON,
      season: selectedSeason.id,
      to: selectedSeason.endDate,
      type: filters.type ?? '',
    }
  }

  if (periodValue === BANKROLL_SEASON_CUSTOM) {
    return {
      from: filters.from ?? '',
      period: BANKROLL_PERIOD_CUSTOM,
      season: BANKROLL_SEASON_CUSTOM,
      to: filters.to ?? '',
      type: filters.type ?? '',
    }
  }

  return {
    from: '',
    period: BANKROLL_PERIOD_ALL_TIME,
    season: BANKROLL_SEASON_ALL,
    to: '',
    type: filters.type ?? '',
  }
}

export const validateBankrollFilters = (
  filters = {},
  { seasonMetadata, today = new Date() } = {},
) => {
  const fieldErrors = {}
  const resolvedFilters = resolveBankrollFilters(filters, seasonMetadata)
  const validatesCustomDates =
    resolvedFilters.period === BANKROLL_PERIOD_CUSTOM
  const todayDate =
    typeof today === 'string'
      ? parseLocalDateInputValue(today)
      : parseLocalDateInputValue(formatLocalDateInputValue(today))
  const fromDate =
    validatesCustomDates && resolvedFilters.from
      ? parseLocalDateInputValue(resolvedFilters.from)
      : null
  const toDate =
    validatesCustomDates && resolvedFilters.to
      ? parseLocalDateInputValue(resolvedFilters.to)
      : null

  if (validatesCustomDates && !resolvedFilters.from) {
    fieldErrors.from = 'Date From is required.'
  } else if (validatesCustomDates && !fromDate) {
    fieldErrors.from = 'Date From must use YYYY-MM-DD.'
  }

  if (validatesCustomDates && !resolvedFilters.to) {
    fieldErrors.to = 'Date To is required.'
  } else if (validatesCustomDates && !toDate) {
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

  const message = Object.values(fieldErrors)[0] ?? ''

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    message,
  }
}

export const validateBankrollInitialization = (
  draft = {},
  { today = new Date() } = {},
) => {
  const fieldErrors = {}
  const startDate = parseLocalDateInputValue(draft.startDate)
  const todayDate =
    typeof today === 'string'
      ? parseLocalDateInputValue(today)
      : parseLocalDateInputValue(formatLocalDateInputValue(today))

  if (!isValidBankrollMoneyInput(draft.startingBalance, { allowZero: true })) {
    fieldErrors.startingBalance =
      'Starting Balance must be 0 or a positive amount with up to two decimals.'
  }

  if (!startDate) {
    fieldErrors.startDate = 'Start Date must use YYYY-MM-DD.'
  }

  if (startDate && todayDate && startDate > todayDate) {
    fieldErrors.startDate = 'Start Date cannot be in the future.'
  }

  if (!/^[A-Za-z]{3}$/.test(String(draft.currency ?? '').trim())) {
    fieldErrors.currency = 'Currency must use a three-letter code.'
  }

  const message = Object.values(fieldErrors)[0] ?? ''

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    message,
  }
}

export const validateBankrollCashTransaction = (
  draft = {},
  { currentBankroll = null, today = new Date(), type = 'DEPOSIT' } = {},
) => {
  const fieldErrors = {}
  const occurredAt = parseLocalDateInputValue(draft.occurredAt)
  const todayDate =
    typeof today === 'string'
      ? parseLocalDateInputValue(today)
      : parseLocalDateInputValue(formatLocalDateInputValue(today))
  const amount = parseBankrollMoneyInput(draft.amount)

  if (amount === null) {
    fieldErrors.amount = 'Amount must be greater than 0 with up to two decimals.'
  }

  if (!occurredAt) {
    fieldErrors.occurredAt = 'Date must use YYYY-MM-DD.'
  }

  if (occurredAt && todayDate && occurredAt > todayDate) {
    fieldErrors.occurredAt = 'Date cannot be in the future.'
  }

  if (
    type === 'WITHDRAWAL' &&
    amount !== null &&
    Number.isFinite(currentBankroll) &&
    amount > currentBankroll
  ) {
    fieldErrors.amount = 'Withdrawal exceeds current bankroll.'
  }

  const message = Object.values(fieldErrors)[0] ?? ''

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
    message,
  }
}

export const buildBankrollInitializationRequest = (draft = {}) => {
  const validation = validateBankrollInitialization(draft)

  if (!validation.isValid) {
    throw new Error(validation.message)
  }

  return {
    currency: normalizeBankrollCurrency(draft.currency),
    startDate: draft.startDate,
    startingBalance: parseBankrollMoneyInput(draft.startingBalance, {
      allowZero: true,
    }),
  }
}

export const buildBankrollCashTransactionRequest = (
  draft = {},
  options = {},
) => {
  const validation = validateBankrollCashTransaction(draft, options)

  if (!validation.isValid) {
    throw new Error(validation.message)
  }

  return {
    amount: parseBankrollMoneyInput(draft.amount),
    description:
      typeof draft.description === 'string' ? draft.description.trim() : '',
    occurredAt: draft.occurredAt,
  }
}

export const buildBankrollSummaryQueryString = ({
  filters = {},
  seasonMetadata,
} = {}) => {
  const queryParams = new URLSearchParams()
  const resolvedFilters = resolveBankrollFilters(filters, seasonMetadata)

  queryParams.set('period', resolvedFilters.period)

  if (resolvedFilters.period === BANKROLL_PERIOD_SEASON) {
    queryParams.set('season', resolvedFilters.season)
  }

  if (resolvedFilters.period === BANKROLL_PERIOD_CUSTOM) {
    queryParams.set('from', resolvedFilters.from)
    queryParams.set('to', resolvedFilters.to)
  }

  return `?${queryParams.toString()}`
}

export const buildBankrollTransactionsQueryString = ({
  filters = {},
  limit,
  page,
  seasonMetadata,
} = {}) => {
  const queryParams = new URLSearchParams()
  const resolvedFilters = resolveBankrollFilters(filters, seasonMetadata)
  const safePage = Number(page)
  const safeLimit = Number(limit)
  const type = String(resolvedFilters.type ?? '').trim().toUpperCase()

  queryParams.set(
    'page',
    String(
      Number.isInteger(safePage) && safePage > 0
        ? safePage
        : BANKROLL_DEFAULT_PAGE,
    ),
  )
  queryParams.set(
    'limit',
    String(
      Number.isInteger(safeLimit) && safeLimit > 0
        ? safeLimit
        : BANKROLL_DEFAULT_LIMIT,
    ),
  )

  if (resolvedFilters.period === BANKROLL_PERIOD_SEASON) {
    queryParams.set('season', resolvedFilters.season)
  }

  if (resolvedFilters.period === BANKROLL_PERIOD_CUSTOM) {
    queryParams.set('from', resolvedFilters.from)
    queryParams.set('to', resolvedFilters.to)
  }

  if (BANKROLL_TRANSACTION_TYPES.includes(type)) {
    queryParams.set('type', type)
  }

  return `?${queryParams.toString()}`
}

export const formatBankrollCurrency = (
  value,
  currency = BANKROLL_DEFAULT_CURRENCY,
) => {
  const amount = toNumber(value)
  const normalizedCurrency = normalizeBankrollCurrency(currency)

  try {
    return new Intl.NumberFormat(undefined, {
      currency: normalizedCurrency,
      style: 'currency',
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${normalizedCurrency}`
  }
}

export const formatSignedBankrollCurrency = (
  value,
  currency = BANKROLL_DEFAULT_CURRENCY,
) => {
  const amount = toNumber(value)
  const sign = amount >= 0 ? '+' : '-'
  const formattedValue = formatBankrollCurrency(Math.abs(amount), currency)

  return `${sign}${formattedValue}`
}

export const formatBankrollDate = (value) => {
  const normalizedDate = normalizeOptionalDate(value)

  if (!normalizedDate) {
    return 'Date unavailable'
  }

  const [year, month, day] = normalizedDate.split('-').map(Number)

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export const getBankrollTransactionLabel = (type) =>
  BANKROLL_TRANSACTION_LABELS[type] ?? 'Transaction'

export const getBankrollTransactionTone = (transaction = {}) => {
  if (transaction.amount > 0) {
    return 'positive'
  }

  if (transaction.amount < 0) {
    return 'negative'
  }

  return 'neutral'
}
