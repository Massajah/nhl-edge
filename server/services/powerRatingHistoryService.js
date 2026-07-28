const mongoose = require('mongoose')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const { getSeedTeams } = require('./powerRatingsService')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_HISTORY_PAGE = 1
const DEFAULT_HISTORY_LIMIT = 25
const MAX_HISTORY_LIMIT = 100
const RESULT_TYPES = ProcessedRatingGame.RESULT_TYPES

class PowerRatingHistoryError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'PowerRatingHistoryError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const toOptionalFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const roundPresentationNumber = (value) => {
  const numberValue = toOptionalFiniteNumber(value)

  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(6)) : null
}

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value
  }

  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value
}

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
    throw new PowerRatingHistoryError(
      `${field} must be a positive integer.`,
      400,
      { field },
    )
  }

  return maxValue ? Math.min(numberValue, maxValue) : numberValue
}

const parseDateParameter = (value, field) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new PowerRatingHistoryError(
      `${field} must use YYYY-MM-DD format.`,
      400,
      { field },
    )
  }

  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new PowerRatingHistoryError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return {
    date: value,
    dateValue: parsedDate,
    timestamp,
  }
}

const normalizeResultType = (value) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const normalizedResultType = normalizeIdentifier(value)

  if (!RESULT_TYPES.includes(normalizedResultType)) {
    throw new PowerRatingHistoryError(
      'resultType must be REGULATION, OVERTIME, or SHOOTOUT.',
      400,
      { field: 'resultType', supportedValues: RESULT_TYPES },
    )
  }

  return normalizedResultType
}

const buildTeamDirectory = async (teamsProvider = getSeedTeams) => {
  const teams = await teamsProvider()

  return teams.reduce(
    (directory, team) => {
      const snapshot = {
        abbreviation: normalizeIdentifier(team.abbreviation),
        teamId: normalizeIdentifier(team.teamId ?? team.id),
        teamName: team.teamName ?? team.name ?? '',
      }

      if (snapshot.teamId) {
        directory.byKey.set(snapshot.teamId, snapshot)
        directory.supportedKeys.add(snapshot.teamId)
      }

      if (snapshot.abbreviation) {
        directory.byKey.set(snapshot.abbreviation, snapshot)
        directory.supportedKeys.add(snapshot.abbreviation)
      }

      return directory
    },
    {
      byKey: new Map(),
      supportedKeys: new Set(),
    },
  )
}

const normalizeTeamFilter = (value, teamDirectory) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const normalizedTeam = normalizeIdentifier(value)

  if (!teamDirectory.supportedKeys.has(normalizedTeam)) {
    throw new PowerRatingHistoryError(
      'team must match a supported NHL team abbreviation or id.',
      400,
      { field: 'team' },
    )
  }

  return normalizedTeam
}

const normalizeHistoryQuery = async (
  query = {},
  { teamsProvider = getSeedTeams } = {},
) => {
  if (!isPlainObject(query)) {
    throw new PowerRatingHistoryError('Query parameters must be an object.', 400)
  }

  const page = parsePositiveIntegerQueryParam({
    defaultValue: DEFAULT_HISTORY_PAGE,
    field: 'page',
    value: query.page,
  })
  const limit = parsePositiveIntegerQueryParam({
    defaultValue: DEFAULT_HISTORY_LIMIT,
    field: 'limit',
    maxValue: MAX_HISTORY_LIMIT,
    value: query.limit,
  })
  const from = parseDateParameter(query.from, 'from')
  const to = parseDateParameter(query.to, 'to')

  if (from && to && from.timestamp > to.timestamp) {
    throw new PowerRatingHistoryError('from must be on or before to.', 400, {
      from: from.date,
      to: to.date,
    })
  }

  const teamDirectory = await buildTeamDirectory(teamsProvider)
  const team = normalizeTeamFilter(query.team, teamDirectory)
  const resultType = normalizeResultType(query.resultType)

  return {
    filters: {
      from: from?.date ?? null,
      resultType,
      team,
      to: to?.date ?? null,
    },
    limit,
    page,
    parsedDates: {
      from,
      to,
    },
    teamDirectory,
  }
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
    dateFilter.$lt = new Date(to.timestamp + 24 * 60 * 60 * 1000)
  }

  return dateFilter
}

const buildHistoryFilter = ({ parsedDates, resultType, team, userId }) => {
  const filter = {
    userId: toObjectIdIfValid(userId),
  }
  const gameDateFilter = buildDateFilter(parsedDates)

  if (gameDateFilter) {
    filter.gameDate = gameDateFilter
  }

  if (team) {
    filter.$or = [
      { awayTeamAbbreviation: team },
      { awayTeamId: team },
      { homeTeamAbbreviation: team },
      { homeTeamId: team },
    ]
  }

  if (resultType) {
    filter.resultType = resultType
  }

  return filter
}

const maybeLean = (query) =>
  query && typeof query.lean === 'function' ? query.lean() : query

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

const getPlainRecord = (record) =>
  typeof record?.toObject === 'function'
    ? record.toObject()
    : typeof record?.toJSON === 'function'
      ? record.toJSON()
      : { ...record }

const buildTeamResponse = ({ record, side, teamDirectory }) => {
  const abbreviation = normalizeIdentifier(
    record[`${side}TeamAbbreviation`] ??
      record[`${side}Team`] ??
      record[`${side}`],
  )
  const teamId = normalizeIdentifier(
    record[`${side}TeamId`] ?? record[`${side}Team`] ?? abbreviation,
  )
  const seedTeam =
    teamDirectory.byKey.get(teamId) ?? teamDirectory.byKey.get(abbreviation)

  return {
    abbreviation: seedTeam?.abbreviation ?? (abbreviation || null),
    id: seedTeam?.teamId ?? (teamId || null),
    name:
      seedTeam?.teamName ??
      record[`${side}TeamName`] ??
      record[`${side}TeamFullName`] ??
      null,
  }
}

const normalizeEngineSettingsSnapshot = (snapshot) => {
  if (!isPlainObject(snapshot)) {
    return null
  }

  return {
    homeAdvantage: roundPresentationNumber(snapshot.homeAdvantage),
    kFactor: roundPresentationNumber(snapshot.kFactor),
    modelVersion:
      typeof snapshot.modelVersion === 'string' ? snapshot.modelVersion : null,
    overtimeMultiplier: roundPresentationNumber(snapshot.overtimeMultiplier),
    regulationMultiplier: roundPresentationNumber(
      snapshot.regulationMultiplier,
    ),
    shootoutMultiplier: roundPresentationNumber(snapshot.shootoutMultiplier),
  }
}

const normalizeAuditRecord = (record, teamDirectory) => {
  const plainRecord = getPlainRecord(record)

  return {
    awayRatingAfter: roundPresentationNumber(plainRecord.awayRatingAfter),
    awayRatingBefore: roundPresentationNumber(plainRecord.awayRatingBefore),
    awayRatingChange: roundPresentationNumber(plainRecord.awayRatingChange),
    awayScore: toOptionalFiniteNumber(plainRecord.awayScore),
    awayTeam: buildTeamResponse({
      record: plainRecord,
      side: 'away',
      teamDirectory,
    }),
    baseHomeAdvantage: roundPresentationNumber(plainRecord.baseHomeAdvantage),
    effectiveHomeAdvantage: roundPresentationNumber(
      plainRecord.effectiveHomeAdvantage,
    ),
    engineSettingsSnapshot: normalizeEngineSettingsSnapshot(
      plainRecord.engineSettingsSnapshot,
    ),
    gameDate: formatDateValue(plainRecord.gameDate),
    gameId: toOptionalFiniteNumber(plainRecord.gameId),
    homeRatingAfter: roundPresentationNumber(plainRecord.homeRatingAfter),
    homeRatingBefore: roundPresentationNumber(plainRecord.homeRatingBefore),
    homeRatingChange: roundPresentationNumber(plainRecord.homeRatingChange),
    homeScore: toOptionalFiniteNumber(plainRecord.homeScore),
    homeTeam: buildTeamResponse({
      record: plainRecord,
      side: 'home',
      teamDirectory,
    }),
    homeTeamAdjustment: roundPresentationNumber(plainRecord.homeTeamAdjustment),
    id: plainRecord.id ?? plainRecord._id?.toString() ?? null,
    processedAt: formatTimestampValue(plainRecord.processedAt),
    resultType: normalizeIdentifier(plainRecord.resultType) || null,
  }
}

const normalizeSummary = (summary = {}) => ({
  dateRange: {
    from: formatDateValue(summary.dateFrom),
    to: formatDateValue(summary.dateTo),
  },
  gamesProcessed: Number.isInteger(summary.gamesProcessed)
    ? summary.gamesProcessed
    : 0,
  mostRecentGame: summary.mostRecentGame
    ? {
        awayTeam:
          normalizeIdentifier(summary.mostRecentGame.awayTeamAbbreviation) ||
          null,
        gameDate: formatDateValue(summary.mostRecentGame.gameDate),
        gameId: toOptionalFiniteNumber(summary.mostRecentGame.gameId),
        homeTeam:
          normalizeIdentifier(summary.mostRecentGame.homeTeamAbbreviation) ||
          null,
        processedAt: formatTimestampValue(summary.mostRecentGame.processedAt),
      }
    : null,
  teamsAffected: Number.isInteger(summary.teamsAffected)
    ? summary.teamsAffected
    : 0,
  totalRatingMovement: roundPresentationNumber(summary.totalRatingMovement),
})

const buildSummaryAggregationPipeline = (filter) => [
  {
    $match: filter,
  },
  {
    $facet: {
      mostRecentGame: [
        {
          $sort: {
            processedAt: -1,
            gameDate: -1,
            gameId: -1,
          },
        },
        {
          $limit: 1,
        },
        {
          $project: {
            awayTeamAbbreviation: 1,
            gameDate: 1,
            gameId: 1,
            homeTeamAbbreviation: 1,
            processedAt: 1,
          },
        },
      ],
      teams: [
        {
          $project: {
            teamKeys: [
              {
                $ifNull: ['$awayTeamAbbreviation', '$awayTeamId'],
              },
              {
                $ifNull: ['$homeTeamAbbreviation', '$homeTeamId'],
              },
            ],
          },
        },
        {
          $unwind: '$teamKeys',
        },
        {
          $match: {
            teamKeys: {
              $nin: [null, ''],
            },
          },
        },
        {
          $group: {
            _id: '$teamKeys',
          },
        },
        {
          $count: 'count',
        },
      ],
      totals: [
        {
          $group: {
            _id: null,
            dateFrom: {
              $min: '$gameDate',
            },
            dateTo: {
              $max: '$gameDate',
            },
            gamesProcessed: {
              $sum: 1,
            },
            totalAwayMovement: {
              $sum: {
                $abs: {
                  $convert: {
                    input: '$awayRatingChange',
                    onError: 0,
                    onNull: 0,
                    to: 'double',
                  },
                },
              },
            },
            totalHomeMovement: {
              $sum: {
                $abs: {
                  $convert: {
                    input: '$homeRatingChange',
                    onError: 0,
                    onNull: 0,
                    to: 'double',
                  },
                },
              },
            },
          },
        },
      ],
    },
  },
]

const getSummaryFromAggregation = async ({ filter, processedRatingGameModel }) => {
  if (typeof processedRatingGameModel.aggregate !== 'function') {
    return null
  }

  const [result] = await processedRatingGameModel.aggregate(
    buildSummaryAggregationPipeline(filter),
  )
  const totals = result?.totals?.[0]

  if (!totals) {
    return normalizeSummary()
  }

  return normalizeSummary({
    dateFrom: totals.dateFrom,
    dateTo: totals.dateTo,
    gamesProcessed: totals.gamesProcessed,
    mostRecentGame: result.mostRecentGame?.[0] ?? null,
    teamsAffected: result.teams?.[0]?.count ?? 0,
    totalRatingMovement:
      toOptionalFiniteNumber(totals.totalAwayMovement) +
      toOptionalFiniteNumber(totals.totalHomeMovement),
  })
}

const getFallbackSummary = ({ items, totalItems }) => {
  const teams = new Set()

  items.forEach((item) => {
    if (item.awayTeam.abbreviation) {
      teams.add(item.awayTeam.abbreviation)
    }

    if (item.homeTeam.abbreviation) {
      teams.add(item.homeTeam.abbreviation)
    }
  })

  return normalizeSummary({
    dateFrom: items
      .map((item) => item.gameDate)
      .filter(Boolean)
      .sort()[0],
    dateTo: items
      .map((item) => item.gameDate)
      .filter(Boolean)
      .sort()
      .at(-1),
    gamesProcessed: totalItems,
    mostRecentGame: items[0]
      ? {
          awayTeamAbbreviation: items[0].awayTeam.abbreviation,
          gameDate: items[0].gameDate,
          gameId: items[0].gameId,
          homeTeamAbbreviation: items[0].homeTeam.abbreviation,
          processedAt: items[0].processedAt,
        }
      : null,
    teamsAffected: teams.size,
    totalRatingMovement: null,
  })
}

const getPowerRatingHistory = async (userId, query = {}, options = {}) => {
  if (!userId) {
    throw new PowerRatingHistoryError('Authenticated userId is required.', 401)
  }

  const processedRatingGameModel =
    options.processedRatingGameModel ?? ProcessedRatingGame
  const normalizedQuery = await normalizeHistoryQuery(query, {
    teamsProvider: options.teamsProvider,
  })
  const filter = buildHistoryFilter({
    parsedDates: normalizedQuery.parsedDates,
    resultType: normalizedQuery.filters.resultType,
    team: normalizedQuery.filters.team,
    userId,
  })
  const sort = {
    processedAt: -1,
    gameDate: -1,
    gameId: -1,
  }
  const skip = (normalizedQuery.page - 1) * normalizedQuery.limit
  const [records, totalItems] = await Promise.all([
    maybeLean(
      processedRatingGameModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(normalizedQuery.limit),
    ),
    processedRatingGameModel.countDocuments(filter),
  ])
  const items = (Array.isArray(records) ? records : []).map((record) =>
    normalizeAuditRecord(record, normalizedQuery.teamDirectory),
  )
  const summary =
    (await getSummaryFromAggregation({
      filter,
      processedRatingGameModel,
    })) ?? getFallbackSummary({ items, totalItems })
  const totalPages = Math.ceil(totalItems / normalizedQuery.limit)

  return {
    filters: normalizedQuery.filters,
    items,
    pagination: {
      hasNextPage: normalizedQuery.page < totalPages,
      hasPreviousPage: normalizedQuery.page > 1,
      limit: normalizedQuery.limit,
      page: normalizedQuery.page,
      totalItems,
      totalPages,
    },
    summary,
  }
}

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HISTORY_PAGE,
  MAX_HISTORY_LIMIT,
  PowerRatingHistoryError,
  RESULT_TYPES,
  getPowerRatingHistory,
  normalizeHistoryQuery,
}
