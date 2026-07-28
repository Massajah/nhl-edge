const mongoose = require('mongoose')
const BankrollProfile = require('../models/BankrollProfile')
const BankrollTransaction = require('../models/BankrollTransaction')
const Bet = require('../models/Bet')
const nhlSeasonService = require('./nhlSeasonService')

const BANKROLL_TRANSACTION_TYPES =
  BankrollTransaction.BANKROLL_TRANSACTION_TYPES
const DEFAULT_BANKROLL_CURRENCY =
  BankrollProfile.DEFAULT_BANKROLL_CURRENCY ?? 'EUR'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const DEFAULT_TRANSACTION_PAGE = 1
const DEFAULT_TRANSACTION_LIMIT = 10
const MAX_TRANSACTION_LIMIT = 100
const SUMMARY_PERIODS = Object.freeze(['all-time', 'season', 'custom'])
const SEASON_ALL = 'all'
const SEASON_CUSTOM = 'custom'
const SETTLED_RESULTS = Object.freeze(['win', 'loss', 'push', 'void'])

class BankrollError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'BankrollError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value
  }

  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value
}

const getRecordId = (record) =>
  record?.id ??
  record?._id?.toString?.() ??
  (record?._id === undefined || record?._id === null ? '' : String(record._id))

const getPlainRecord = (record) =>
  typeof record?.toObject === 'function'
    ? record.toObject()
    : typeof record?.toJSON === 'function'
      ? record.toJSON()
      : { ...record }

const maybeLean = (query) =>
  query && typeof query.lean === 'function' ? query.lean() : query

const applySession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query

const isDuplicateKeyError = (error) => error?.code === 11000

const isTransactionUnsupportedError = (error) =>
  /transaction numbers are only allowed|transactions are not supported|transaction.*not supported/i.test(
    error?.message ?? '',
  )

const canUseMongooseTransactions = () =>
  mongoose.connection.readyState === 1 &&
  typeof mongoose.startSession === 'function'

const runWithOptionalTransaction = async (callback, options = {}) => {
  const shouldUseTransactions =
    options.useTransactions ?? canUseMongooseTransactions()

  if (!shouldUseTransactions) {
    return callback(null)
  }

  const session = await mongoose.startSession()

  try {
    let result

    await session.withTransaction(async () => {
      result = await callback(session)
    })

    return result
  } catch (error) {
    if (isTransactionUnsupportedError(error)) {
      return callback(null)
    }

    throw error
  } finally {
    await session.endSession()
  }
}

const normalizeCurrency = (value = DEFAULT_BANKROLL_CURRENCY) => {
  const currency = String(value || DEFAULT_BANKROLL_CURRENCY)
    .trim()
    .toUpperCase()

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BankrollError('currency must be a three-letter ISO code.', 400, {
      field: 'currency',
    })
  }

  return currency
}

const parseMoneyToCents = (
  value,
  field,
  { allowZero = false, allowNegative = false } = {},
) => {
  if (value === null || value === undefined || value === '') {
    throw new BankrollError(`${field} is required.`, 400, { field })
  }

  const rawValue = String(value).trim()
  const isNegative = rawValue.startsWith('-')
  const unsignedValue = isNegative ? rawValue.slice(1) : rawValue

  if (isNegative && !allowNegative) {
    throw new BankrollError(`${field} cannot be negative.`, 400, { field })
  }

  if (!MONEY_PATTERN.test(unsignedValue)) {
    throw new BankrollError(
      `${field} must be a money amount with no more than two decimals.`,
      400,
      { field },
    )
  }

  const [wholePart, decimalPart = ''] = unsignedValue.split('.')
  const cents =
    Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0') || '0')
  const signedCents = isNegative ? -cents : cents

  if (!Number.isSafeInteger(signedCents)) {
    throw new BankrollError(`${field} is too large.`, 400, { field })
  }

  if (!allowZero && signedCents === 0) {
    throw new BankrollError(`${field} must be greater than 0.`, 400, {
      field,
    })
  }

  return signedCents
}

const roundMoneyToCents = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : 0
}

const centsToMoney = (value) => Number((Number(value || 0) / 100).toFixed(2))

const parseDateOnly = (value, field) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value.trim())) {
    throw new BankrollError(`${field} must use YYYY-MM-DD format.`, 400, {
      field,
    })
  }

  const [year, month, day] = value.trim().split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new BankrollError(`${field} must be a valid date.`, 400, { field })
  }

  return {
    date: value.trim(),
    dateValue: parsedDate,
    timestamp,
  }
}

const parseOptionalDate = (value, field) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  return parseDateOnly(value, field)
}

const parseOccurredAt = (value, field, { fallbackDate = new Date() } = {}) => {
  if (value === undefined || value === null || value === '') {
    return fallbackDate
  }

  if (typeof value === 'string' && DATE_PATTERN.test(value.trim())) {
    return parseDateOnly(value, field).dateValue
  }

  const dateValue = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(dateValue.getTime())) {
    throw new BankrollError(`${field} must be a valid date.`, 400, { field })
  }

  return dateValue
}

const formatDateValue = (value) => {
  if (!value) {
    return null
  }

  const dateValue = value instanceof Date ? value : new Date(value)

  return Number.isNaN(dateValue.getTime())
    ? null
    : dateValue.toISOString().slice(0, 10)
}

const formatTimestampValue = (value) => {
  if (!value) {
    return null
  }

  const dateValue = value instanceof Date ? value : new Date(value)

  return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString()
}

const addUtcDays = (date, days) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const parsePositiveIntegerQueryParam = ({
  defaultValue,
  field,
  maxValue,
  value,
}) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const numberValue = Number(value)

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new BankrollError(`${field} must be a positive integer.`, 400, {
      field,
    })
  }

  return maxValue ? Math.min(numberValue, maxValue) : numberValue
}

const validateRequestBody = (payload = {}) => {
  if (!isPlainObject(payload)) {
    throw new BankrollError('Request body must be an object.', 400)
  }
}

const getModels = (options = {}) => ({
  betModel: options.betModel ?? Bet,
  profileModel: options.profileModel ?? BankrollProfile,
  transactionModel: options.transactionModel ?? BankrollTransaction,
})

const canUseDefaultDatabaseModels = () => mongoose.connection.readyState === 1

const serializeProfile = (profile) => {
  if (!profile) {
    return null
  }

  const plainProfile = getPlainRecord(profile)

  return {
    currency: normalizeCurrency(plainProfile.currency),
    id: getRecordId(plainProfile),
    initializedAt: formatTimestampValue(plainProfile.initializedAt),
    initializedDate: formatDateValue(plainProfile.initializedAt),
    isActive: Boolean(plainProfile.isActive),
    userId: plainProfile.userId?.toString?.() ?? String(plainProfile.userId),
  }
}

const serializeTransaction = (transaction, runningBalanceCents = null) => {
  const plainTransaction = getPlainRecord(transaction)
  const amountCents = Number(plainTransaction.amountCents) || 0

  return {
    amount: centsToMoney(amountCents),
    amountCents,
    betId:
      plainTransaction.betId === null || plainTransaction.betId === undefined
        ? null
        : plainTransaction.betId.toString(),
    createdAt: formatTimestampValue(plainTransaction.createdAt),
    description:
      typeof plainTransaction.description === 'string'
        ? plainTransaction.description
        : '',
    id: getRecordId(plainTransaction),
    metadata: isPlainObject(plainTransaction.metadata)
      ? plainTransaction.metadata
      : {},
    occurredAt: formatTimestampValue(plainTransaction.occurredAt),
    occurredDate: formatDateValue(plainTransaction.occurredAt),
    runningBalance:
      runningBalanceCents === null ? null : centsToMoney(runningBalanceCents),
    runningBalanceCents,
    type: plainTransaction.type,
    updatedAt: formatTimestampValue(plainTransaction.updatedAt),
  }
}

const getActiveProfile = async (userId, options = {}) => {
  const { profileModel } = getModels(options)
  const query = profileModel.findOne({
    isActive: true,
    userId: toObjectIdIfValid(userId),
  })

  return maybeLean(applySession(query, options.session))
}

const getStartingBalanceCents = async (userId, options = {}) => {
  const { transactionModel } = getModels(options)
  const query = transactionModel
    .findOne({
      type: 'STARTING_BALANCE',
      userId: toObjectIdIfValid(userId),
    })
    .sort({ occurredAt: 1, createdAt: 1 })
  const transaction = await maybeLean(applySession(query, options.session))

  return Number(transaction?.amountCents) || 0
}

const buildDateFilter = ({ from, to }) => {
  if (!from && !to) {
    return null
  }

  const dateFilter = {}

  if (from) {
    dateFilter.$gte = from.dateValue
  }

  if (to) {
    dateFilter.$lt = addUtcDays(to.dateValue, 1)
  }

  return dateFilter
}

const resolveSeasonBoundary = async (seasonId, options = {}) => {
  const seasonMetadata =
    options.seasonMetadata ??
    (await nhlSeasonService.getAvailablePowerRatingHistorySeasons(
      options.seasonOptions,
    ))
  const season = seasonMetadata?.seasons?.find(
    (item) => item.id === String(seasonId),
  )

  if (!season) {
    throw new BankrollError('season must match an available NHL season.', 400, {
      field: 'season',
    })
  }

  return {
    from: parseDateOnly(season.startDate, 'season.startDate'),
    season: {
      endDate: season.endDate,
      id: season.id,
      isCurrent: Boolean(season.isCurrent),
      label: season.label,
      startDate: season.startDate,
    },
    to: parseDateOnly(season.endDate, 'season.endDate'),
  }
}

const normalizeTransactionType = (value) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const type = String(value).trim().toUpperCase()

  if (!BANKROLL_TRANSACTION_TYPES.includes(type)) {
    throw new BankrollError('type must be a supported bankroll transaction.', 400, {
      field: 'type',
      supportedValues: BANKROLL_TRANSACTION_TYPES,
    })
  }

  return type
}

const normalizeTransactionQuery = async (query = {}, options = {}) => {
  if (!isPlainObject(query)) {
    throw new BankrollError('Query parameters must be an object.', 400)
  }

  const page = parsePositiveIntegerQueryParam({
    defaultValue: DEFAULT_TRANSACTION_PAGE,
    field: 'page',
    value: query.page,
  })
  const limit = parsePositiveIntegerQueryParam({
    defaultValue: DEFAULT_TRANSACTION_LIMIT,
    field: 'limit',
    maxValue: MAX_TRANSACTION_LIMIT,
    value: query.limit,
  })
  const type = normalizeTransactionType(query.type)
  const seasonValue = String(query.season ?? '').trim()

  if (seasonValue && seasonValue !== SEASON_ALL && seasonValue !== SEASON_CUSTOM) {
    const boundary = await resolveSeasonBoundary(seasonValue, options)

    return {
      filters: {
        from: boundary.from.date,
        season: boundary.season.id,
        to: boundary.to.date,
        type,
      },
      limit,
      page,
      parsedDates: {
        from: boundary.from,
        to: boundary.to,
      },
      season: boundary.season,
    }
  }

  const from = parseOptionalDate(query.from, 'from')
  const to = parseOptionalDate(query.to, 'to')

  if (from && to && from.timestamp > to.timestamp) {
    throw new BankrollError('from must be on or before to.', 400, {
      from: from.date,
      to: to.date,
    })
  }

  return {
    filters: {
      from: from?.date ?? '',
      season: seasonValue || '',
      to: to?.date ?? '',
      type,
    },
    limit,
    page,
    parsedDates: {
      from,
      to,
    },
    season: null,
  }
}

const normalizeSummaryQuery = async (query = {}, options = {}) => {
  if (!isPlainObject(query)) {
    throw new BankrollError('Query parameters must be an object.', 400)
  }

  const period = String(query.period ?? 'all-time').trim() || 'all-time'

  if (!SUMMARY_PERIODS.includes(period)) {
    throw new BankrollError('period must be all-time, season, or custom.', 400, {
      field: 'period',
    })
  }

  if (period === 'all-time') {
    return {
      filters: {
        from: '',
        season: '',
        to: '',
      },
      parsedDates: {
        from: null,
        to: null,
      },
      period: {
        from: null,
        key: 'all-time',
        season: null,
        to: null,
      },
    }
  }

  if (period === 'season') {
    const seasonId = String(query.season ?? '').trim()

    if (!seasonId) {
      throw new BankrollError('season is required for season summaries.', 400, {
        field: 'season',
      })
    }

    const boundary = await resolveSeasonBoundary(seasonId, options)

    return {
      filters: {
        from: boundary.from.date,
        season: boundary.season.id,
        to: boundary.to.date,
      },
      parsedDates: {
        from: boundary.from,
        to: boundary.to,
      },
      period: {
        from: boundary.from.date,
        key: 'season',
        season: boundary.season,
        to: boundary.to.date,
      },
    }
  }

  const from = parseOptionalDate(query.from, 'from')
  const to = parseOptionalDate(query.to, 'to')

  if (!from || !to) {
    throw new BankrollError(
      'from and to are required for custom summaries.',
      400,
      { field: 'period' },
    )
  }

  if (from.timestamp > to.timestamp) {
    throw new BankrollError('from must be on or before to.', 400, {
      from: from.date,
      to: to.date,
    })
  }

  return {
    filters: {
      from: from.date,
      season: SEASON_CUSTOM,
      to: to.date,
    },
    parsedDates: {
      from,
      to,
    },
    period: {
      from: from.date,
      key: 'custom',
      season: null,
      to: to.date,
    },
  }
}

const buildTransactionFilter = ({ parsedDates, type, userId }) => {
  const filter = {
    userId: toObjectIdIfValid(userId),
  }
  const dateFilter = buildDateFilter(parsedDates)

  if (dateFilter) {
    filter.occurredAt = dateFilter
  }

  if (type) {
    filter.type = type
  }

  return filter
}

const sumAmountCents = (items) =>
  items.reduce((total, item) => total + (Number(item.amountCents) || 0), 0)

const getTransactionsForUser = async (userId, options = {}) => {
  const { transactionModel } = getModels(options)
  const query = transactionModel
    .find({
      userId: toObjectIdIfValid(userId),
    })
    .sort({ occurredAt: 1, createdAt: 1, _id: 1 })

  return maybeLean(applySession(query, options.session))
}

const calculateCurrentBankrollCents = async (userId, options = {}) => {
  const transactions = await getTransactionsForUser(userId, options)

  return sumAmountCents(Array.isArray(transactions) ? transactions : [])
}

const compareBetReferenceDateToProfileStart = (bet, profile) => {
  const referenceDate = getBetReferenceDate(bet)
  const initializedAt = profile?.initializedAt
    ? new Date(profile.initializedAt)
    : null

  if (!referenceDate || !initializedAt || Number.isNaN(initializedAt.getTime())) {
    return false
  }

  return referenceDate.getTime() >= initializedAt.getTime()
}

const getBetReferenceDate = (bet = {}) => {
  const candidates = [
    bet.scheduledStart,
    bet.analyzedAt,
    bet.updatedAt,
    bet.createdAt,
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const date = candidate instanceof Date ? candidate : new Date(candidate)

    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  return null
}

const isSettledBet = (bet = {}) => SETTLED_RESULTS.includes(bet.result)

const getTeamLabel = (team = {}, fallback) =>
  team.abbreviation || team.name || fallback

const buildBetSettlementDescription = (bet = {}) => {
  const away = getTeamLabel(bet.awayTeam, 'Away')
  const home = getTeamLabel(bet.homeTeam, 'Home')
  const selectedSide = getTeamLabel(
    bet.selectedSide ?? bet.selectedTeam,
    'Selected side',
  )

  return `${selectedSide} ${bet.result || 'settled'} (${away} at ${home})`
}

const buildBetSettlementMetadata = (bet = {}) => ({
  awayTeam: {
    abbreviation: bet.awayTeam?.abbreviation ?? '',
    name: bet.awayTeam?.name ?? '',
    teamId: bet.awayTeam?.teamId ?? '',
  },
  homeTeam: {
    abbreviation: bet.homeTeam?.abbreviation ?? '',
    name: bet.homeTeam?.name ?? '',
    teamId: bet.homeTeam?.teamId ?? '',
  },
  marketOdds: Number(bet.marketOdds) || 0,
  result: bet.result ?? 'pending',
  stake: Number(bet.stake) || 0,
})

const saveDocument = (document, session) =>
  session ? document.save({ session }) : document.save()

const assertInitialized = async (userId, options = {}) => {
  const profile = await getActiveProfile(userId, options)

  if (!profile) {
    throw new BankrollError('Bankroll has not been initialized.', 404)
  }

  return profile
}

const assertOccurredAtIsOnOrAfterStart = (occurredAt, profile) => {
  const initializedAt = new Date(profile.initializedAt)

  if (occurredAt.getTime() < initializedAt.getTime()) {
    throw new BankrollError(
      'occurredAt cannot be before the bankroll start date.',
      400,
      {
        field: 'occurredAt',
      },
    )
  }
}

const initializeBankroll = async (userId, payload = {}, options = {}) => {
  if (!userId) {
    throw new BankrollError('Authenticated userId is required.', 401)
  }

  validateRequestBody(payload)

  const { profileModel, transactionModel } = getModels(options)
  const normalizedUserId = toObjectIdIfValid(userId)
  const startingBalanceCents = parseMoneyToCents(
    payload.startingBalance,
    'startingBalance',
    { allowZero: true },
  )
  const startDate = parseDateOnly(payload.startDate, 'startDate')
  const currency = normalizeCurrency(payload.currency)

  try {
    return await runWithOptionalTransaction(async (session) => {
      const existingProfile = await maybeLean(
        applySession(
          profileModel.findOne({
            userId: normalizedUserId,
          }),
          session,
        ),
      )

      if (existingProfile) {
        throw new BankrollError('Bankroll is already initialized.', 409)
      }

      const profile = new profileModel({
        currency,
        initializedAt: startDate.dateValue,
        isActive: true,
        userId: normalizedUserId,
      })
      const startingTransaction = new transactionModel({
        amountCents: startingBalanceCents,
        description: 'Starting balance',
        occurredAt: startDate.dateValue,
        type: 'STARTING_BALANCE',
        userId: normalizedUserId,
      })

      await saveDocument(profile, session)
      await saveDocument(startingTransaction, session)

      return {
        profile: serializeProfile(profile),
        summary: {
          availableBankroll: centsToMoney(startingBalanceCents),
          availableBankrollCents: startingBalanceCents,
          bettingProfit: 0,
          bettingProfitCents: 0,
          cashFlow: 0,
          cashFlowCents: 0,
          currency,
          currentBankroll: centsToMoney(startingBalanceCents),
          currentBankrollCents: startingBalanceCents,
          deposits: 0,
          depositsCents: 0,
          initialized: true,
          initializedAt: formatTimestampValue(startDate.dateValue),
          initializedDate: startDate.date,
          pendingStake: 0,
          pendingStakeCents: 0,
          period: {
            from: null,
            key: 'all-time',
            season: null,
            to: null,
          },
          settledBets: 0,
          startingBalance: centsToMoney(startingBalanceCents),
          startingBalanceCents,
          withdrawals: 0,
          withdrawalsCents: 0,
        },
        transaction: serializeTransaction(
          startingTransaction,
          startingBalanceCents,
        ),
      }
    }, options)
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new BankrollError('Bankroll is already initialized.', 409)
    }

    throw error
  }
}

const createCashTransaction = async (
  userId,
  payload = {},
  type,
  options = {},
) => {
  if (!userId) {
    throw new BankrollError('Authenticated userId is required.', 401)
  }

  validateRequestBody(payload)

  const { transactionModel } = getModels(options)
  const normalizedUserId = toObjectIdIfValid(userId)
  const amountCents = parseMoneyToCents(payload.amount, 'amount')
  const occurredAt = parseOccurredAt(payload.occurredAt, 'occurredAt', {
    fallbackDate: options.nowProvider ? options.nowProvider() : new Date(),
  })
  const description =
    typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : type === 'DEPOSIT'
        ? 'Deposit'
        : 'Withdrawal'

  return runWithOptionalTransaction(async (session) => {
    const profile = await assertInitialized(userId, {
      ...options,
      session,
    })
    assertOccurredAtIsOnOrAfterStart(occurredAt, profile)

    const signedAmountCents =
      type === 'WITHDRAWAL' ? -amountCents : amountCents

    if (type === 'WITHDRAWAL') {
      const currentBankrollCents = await calculateCurrentBankrollCents(userId, {
        ...options,
        session,
      })

      if (amountCents > currentBankrollCents) {
        throw new BankrollError('Withdrawal exceeds current bankroll.', 400, {
          availableCents: currentBankrollCents,
          field: 'amount',
        })
      }
    }

    const transaction = new transactionModel({
      amountCents: signedAmountCents,
      description,
      occurredAt,
      type,
      userId: normalizedUserId,
    })

    await saveDocument(transaction, session)

    const summary = await getBankrollSummary(
      userId,
      { period: 'all-time' },
      {
        ...options,
        session,
      },
    )

    return {
      summary,
      transaction: serializeTransaction(transaction),
    }
  }, options)
}

const addDeposit = (userId, payload = {}, options = {}) =>
  createCashTransaction(userId, payload, 'DEPOSIT', options)

const addWithdrawal = (userId, payload = {}, options = {}) =>
  createCashTransaction(userId, payload, 'WITHDRAWAL', options)

const removeBetSettlementForBet = async (userId, betId, options = {}) => {
  if (!userId || !betId) {
    return {
      status: 'skipped',
    }
  }

  if (!options.transactionModel && !canUseDefaultDatabaseModels()) {
    return {
      status: 'skipped',
    }
  }

  const { transactionModel } = getModels(options)
  const result = await transactionModel.deleteOne({
    betId: toObjectIdIfValid(betId),
    type: 'BET_SETTLEMENT',
    userId: toObjectIdIfValid(userId),
  })

  return {
    deletedCount: Number(result?.deletedCount) || 0,
    status: 'removed',
  }
}

const syncBetSettlementForBet = async (userId, bet = {}, options = {}) => {
  if (!userId || !bet) {
    return {
      status: 'skipped',
    }
  }

  const betId = bet.id ?? bet._id

  if (!betId) {
    return {
      status: 'skipped',
    }
  }

  if (
    !options.profileModel &&
    !options.transactionModel &&
    !canUseDefaultDatabaseModels()
  ) {
    return {
      status: 'skipped',
    }
  }

  const profile = await getActiveProfile(userId, options)

  if (
    !profile ||
    !isSettledBet(bet) ||
    !compareBetReferenceDateToProfileStart(bet, profile)
  ) {
    return removeBetSettlementForBet(userId, betId, options)
  }

  const { transactionModel } = getModels(options)
  const referenceDate = getBetReferenceDate(bet)
  const amountCents = roundMoneyToCents(bet.profit)
  const update = {
    $set: {
      amountCents,
      description: buildBetSettlementDescription(bet),
      metadata: buildBetSettlementMetadata(bet),
      occurredAt: referenceDate,
      userId: toObjectIdIfValid(userId),
    },
    $setOnInsert: {
      betId: toObjectIdIfValid(betId),
      type: 'BET_SETTLEMENT',
    },
  }

  await transactionModel.findOneAndUpdate(
    {
      betId: toObjectIdIfValid(betId),
      type: 'BET_SETTLEMENT',
      userId: toObjectIdIfValid(userId),
    },
    update,
    {
      new: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )

  return {
    amountCents,
    status: 'upserted',
  }
}

const getPendingStakeCents = async (userId, profile, options = {}) => {
  const { betModel } = getModels(options)
  const pendingBets = await maybeLean(
    betModel.find({
      result: 'pending',
      userId: toObjectIdIfValid(userId),
    }),
  )

  return (Array.isArray(pendingBets) ? pendingBets : []).reduce((total, bet) => {
    if (!compareBetReferenceDateToProfileStart(bet, profile)) {
      return total
    }

    return total + roundMoneyToCents(bet.stake)
  }, 0)
}

const filterTransactionsByDateRange = (transactions, parsedDates) => {
  const dateFilter = buildDateFilter(parsedDates)

  if (!dateFilter) {
    return transactions
  }

  return transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurredAt)

    if (Number.isNaN(occurredAt.getTime())) {
      return false
    }

    if (dateFilter.$gte && occurredAt < dateFilter.$gte) {
      return false
    }

    return !(dateFilter.$lt && occurredAt >= dateFilter.$lt)
  })
}

const buildUninitializedSummary = (normalizedQuery = null) => ({
  availableBankroll: 0,
  availableBankrollCents: 0,
  bettingProfit: 0,
  bettingProfitCents: 0,
  cashFlow: 0,
  cashFlowCents: 0,
  currency: DEFAULT_BANKROLL_CURRENCY,
  currentBankroll: 0,
  currentBankrollCents: 0,
  deposits: 0,
  depositsCents: 0,
  initialized: false,
  initializedAt: null,
  initializedDate: null,
  pendingStake: 0,
  pendingStakeCents: 0,
  period: normalizedQuery?.period ?? {
    from: null,
    key: 'all-time',
    season: null,
    to: null,
  },
  settledBets: 0,
  startingBalance: 0,
  startingBalanceCents: 0,
  withdrawals: 0,
  withdrawalsCents: 0,
})

const getBankrollSummary = async (userId, query = {}, options = {}) => {
  if (!userId) {
    throw new BankrollError('Authenticated userId is required.', 401)
  }

  const normalizedQuery = await normalizeSummaryQuery(query, options)
  const profile = await getActiveProfile(userId, options)

  if (!profile) {
    return buildUninitializedSummary(normalizedQuery)
  }

  const allTransactions = await getTransactionsForUser(userId, options)
  const safeTransactions = Array.isArray(allTransactions) ? allTransactions : []
  const periodTransactions = filterTransactionsByDateRange(
    safeTransactions,
    normalizedQuery.parsedDates,
  )
  const startingBalanceCents = await getStartingBalanceCents(userId, options)
  const currentBankrollCents = sumAmountCents(safeTransactions)
  const depositsCents = sumAmountCents(
    periodTransactions.filter((transaction) => transaction.type === 'DEPOSIT'),
  )
  const withdrawalsCents = Math.abs(
    sumAmountCents(
      periodTransactions.filter(
        (transaction) => transaction.type === 'WITHDRAWAL',
      ),
    ),
  )
  const bettingProfitCents = sumAmountCents(
    periodTransactions.filter(
      (transaction) => transaction.type === 'BET_SETTLEMENT',
    ),
  )
  const pendingStakeCents = await getPendingStakeCents(userId, profile, options)
  const availableBankrollCents = currentBankrollCents - pendingStakeCents

  return {
    availableBankroll: centsToMoney(availableBankrollCents),
    availableBankrollCents,
    bettingProfit: centsToMoney(bettingProfitCents),
    bettingProfitCents,
    cashFlow: centsToMoney(depositsCents - withdrawalsCents),
    cashFlowCents: depositsCents - withdrawalsCents,
    currency: normalizeCurrency(profile.currency),
    currentBankroll: centsToMoney(currentBankrollCents),
    currentBankrollCents,
    deposits: centsToMoney(depositsCents),
    depositsCents,
    initialized: true,
    initializedAt: formatTimestampValue(profile.initializedAt),
    initializedDate: formatDateValue(profile.initializedAt),
    pendingStake: centsToMoney(pendingStakeCents),
    pendingStakeCents,
    period: normalizedQuery.period,
    settledBets: periodTransactions.filter(
      (transaction) => transaction.type === 'BET_SETTLEMENT',
    ).length,
    startingBalance: centsToMoney(startingBalanceCents),
    startingBalanceCents,
    withdrawals: centsToMoney(withdrawalsCents),
    withdrawalsCents,
  }
}

const getBankrollTransactions = async (userId, query = {}, options = {}) => {
  if (!userId) {
    throw new BankrollError('Authenticated userId is required.', 401)
  }

  const { transactionModel } = getModels(options)
  const normalizedQuery = await normalizeTransactionQuery(query, options)
  const filter = buildTransactionFilter({
    parsedDates: normalizedQuery.parsedDates,
    type: normalizedQuery.filters.type,
    userId,
  })
  const sort = {
    occurredAt: -1,
    createdAt: -1,
    _id: -1,
  }
  const skip = (normalizedQuery.page - 1) * normalizedQuery.limit
  const [records, totalItems] = await Promise.all([
    maybeLean(
      transactionModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(normalizedQuery.limit),
    ),
    transactionModel.countDocuments(filter),
  ])
  const items = Array.isArray(records) ? records : []
  const pageIds = new Set(items.map(getRecordId).filter(Boolean))
  const runningBalancesById = new Map()

  if (pageIds.size > 0) {
    let runningBalanceCents = 0
    const allUserTransactions = await getTransactionsForUser(userId, options)
    const transactionsForRunningBalance = Array.isArray(allUserTransactions)
      ? allUserTransactions
      : []

    transactionsForRunningBalance.forEach((transaction) => {
      runningBalanceCents += Number(transaction.amountCents) || 0
      const id = getRecordId(transaction)

      if (pageIds.has(id)) {
        runningBalancesById.set(id, runningBalanceCents)
      }
    })
  }

  const totalPages = Math.ceil(totalItems / normalizedQuery.limit)

  return {
    filters: normalizedQuery.filters,
    items: items.map((transaction) =>
      serializeTransaction(
        transaction,
        runningBalancesById.get(getRecordId(transaction)) ?? null,
      ),
    ),
    pagination: {
      hasNextPage: normalizedQuery.page < totalPages,
      hasPreviousPage: normalizedQuery.page > 1,
      limit: normalizedQuery.limit,
      page: normalizedQuery.page,
      totalItems,
      totalPages,
    },
    season: normalizedQuery.season,
  }
}

const getBankrollSeasons = (options = {}) =>
  nhlSeasonService.getAvailablePowerRatingHistorySeasons(options)

const normalizeBackfillUserScope = ({ allUsers = false, userId } = {}) => {
  const normalizedUserId = String(userId ?? '').trim()

  if (!allUsers && !normalizedUserId) {
    throw new BankrollError('Specify --userId=<id> or --all for backfill.', 400)
  }

  if (allUsers && normalizedUserId) {
    throw new BankrollError('Use either --userId=<id> or --all, not both.', 400)
  }

  return {
    allUsers: Boolean(allUsers),
    userId: normalizedUserId,
  }
}

const backfillBankrollSettlements = async (options = {}) => {
  const { betModel, profileModel } = getModels(options)
  const scope = normalizeBackfillUserScope(options)
  const profileFilter = scope.allUsers
    ? { isActive: true }
    : {
        isActive: true,
        userId: toObjectIdIfValid(scope.userId),
      }
  const profiles = await maybeLean(profileModel.find(profileFilter))
  const summary = {
    confirm: Boolean(options.confirm),
    matchedBets: 0,
    profilesProcessed: 0,
    profilesSkipped: 0,
    settlementsWritten: 0,
  }

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    summary.profilesProcessed += 1

    const profileUserId = profile.userId?.toString?.() ?? String(profile.userId)
    const settledBets = await maybeLean(
      betModel.find({
        result: {
          $in: SETTLED_RESULTS,
        },
        userId: toObjectIdIfValid(profileUserId),
      }),
    )
    const eligibleBets = (Array.isArray(settledBets) ? settledBets : []).filter(
      (bet) => compareBetReferenceDateToProfileStart(bet, profile),
    )

    summary.matchedBets += eligibleBets.length

    if (!options.confirm) {
      continue
    }

    for (const bet of eligibleBets) {
      await syncBetSettlementForBet(profileUserId, bet, options)
      summary.settlementsWritten += 1
    }
  }

  if (summary.profilesProcessed === 0) {
    summary.profilesSkipped = 1
  }

  return summary
}

module.exports = {
  BANKROLL_TRANSACTION_TYPES,
  DEFAULT_BANKROLL_CURRENCY,
  DEFAULT_TRANSACTION_LIMIT,
  DEFAULT_TRANSACTION_PAGE,
  MAX_TRANSACTION_LIMIT,
  SEASON_ALL,
  SEASON_CUSTOM,
  SUMMARY_PERIODS,
  BankrollError,
  addDeposit,
  addWithdrawal,
  backfillBankrollSettlements,
  buildDateFilter,
  calculateCurrentBankrollCents,
  centsToMoney,
  getBankrollSeasons,
  getBankrollSummary,
  getBankrollTransactions,
  getBetReferenceDate,
  initializeBankroll,
  normalizeSummaryQuery,
  normalizeTransactionQuery,
  parseMoneyToCents,
  removeBetSettlementForBet,
  roundMoneyToCents,
  syncBetSettlementForBet,
}
