process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const {
  MAX_HISTORY_LIMIT,
  getPowerRatingHistory,
  normalizeHistoryQuery,
} = require('../services/powerRatingHistoryService')

const userA = new mongoose.Types.ObjectId()
const userB = new mongoose.Types.ObjectId()

const teamsProvider = async () => [
  {
    abbreviation: 'BOS',
    teamId: 'BOS',
    teamName: 'Boston Bruins',
  },
  {
    abbreviation: 'CAR',
    teamId: 'CAR',
    teamName: 'Carolina Hurricanes',
  },
  {
    abbreviation: 'NYR',
    teamId: 'NYR',
    teamName: 'New York Rangers',
  },
  {
    abbreviation: 'TOR',
    teamId: 'TOR',
    teamName: 'Toronto Maple Leafs',
  },
]

const sameValue = (left, right) => String(left) === String(right)

const toComparableValue = (value) => {
  if (value instanceof Date) {
    return value.getTime()
  }

  return value
}

const compareWithSort = (sortSpec) => (left, right) => {
  for (const [field, direction] of Object.entries(sortSpec)) {
    const leftValue = toComparableValue(left[field])
    const rightValue = toComparableValue(right[field])

    if (leftValue === rightValue) {
      continue
    }

    if (leftValue === null || leftValue === undefined) {
      return 1
    }

    if (rightValue === null || rightValue === undefined) {
      return -1
    }

    if (leftValue < rightValue) {
      return direction < 0 ? 1 : -1
    }

    return direction < 0 ? -1 : 1
  }

  return 0
}

const matchesCondition = (actualValue, expectedValue) => {
  if (
    expectedValue &&
    typeof expectedValue === 'object' &&
    (Object.hasOwn(expectedValue, '$gte') || Object.hasOwn(expectedValue, '$lt'))
  ) {
    if (
      Object.hasOwn(expectedValue, '$gte') &&
      toComparableValue(actualValue) < toComparableValue(expectedValue.$gte)
    ) {
      return false
    }

    if (
      Object.hasOwn(expectedValue, '$lt') &&
      toComparableValue(actualValue) >= toComparableValue(expectedValue.$lt)
    ) {
      return false
    }

    return true
  }

  return sameValue(actualValue, expectedValue)
}

const matchesFilter = (record, filter) =>
  Object.entries(filter).every(([field, expectedValue]) => {
    if (field === '$or') {
      return expectedValue.some((candidateFilter) =>
        matchesFilter(record, candidateFilter),
      )
    }

    return matchesCondition(record[field], expectedValue)
  })

const queryOf = (records) => {
  let currentRecords = [...records]

  return {
    limit(limit) {
      currentRecords = currentRecords.slice(0, limit)
      return this
    },
    skip(count) {
      currentRecords = currentRecords.slice(count)
      return this
    },
    sort(sortSpec) {
      currentRecords = [...currentRecords].sort(compareWithSort(sortSpec))
      return this
    },
    lean() {
      return Promise.resolve(currentRecords.map((record) => ({ ...record })))
    },
    then(resolve, reject) {
      return this.lean().then(resolve, reject)
    },
    catch(reject) {
      return this.lean().catch(reject)
    },
  }
}

const createModel = (records) => ({
  countDocuments(filter) {
    return Promise.resolve(records.filter((record) => matchesFilter(record, filter)).length)
  },
  find(filter) {
    return queryOf(records.filter((record) => matchesFilter(record, filter)))
  },
})

const makeRecord = ({
  away = 'NYR',
  gameDate,
  gameId,
  home = 'BOS',
  processedAt,
  resultType = 'REGULATION',
  userId = userA,
  withAudit = true,
}) => ({
  awayRatingAfter: withAudit ? 52.21 : undefined,
  awayRatingBefore: withAudit ? 53 : undefined,
  awayRatingChange: withAudit ? -0.79 : undefined,
  awayScore: 2,
  awayTeamAbbreviation: away,
  awayTeamId: away,
  baseHomeAdvantage: withAudit ? 4 : undefined,
  effectiveHomeAdvantage: withAudit ? 4 : undefined,
  engineSettingsSnapshot: withAudit
    ? {
        homeAdvantage: 4,
        kFactor: 1.2,
        modelVersion: 'power-rating-v1',
        overtimeMultiplier: 0.7,
        regulationMultiplier: 1,
        shootoutMultiplier: 0.5,
      }
    : undefined,
  gameDate: new Date(`${gameDate}T00:00:00.000Z`),
  gameId,
  homeRatingAfter: withAudit ? 45.79 : undefined,
  homeRatingBefore: withAudit ? 45 : undefined,
  homeRatingChange: withAudit ? 0.79 : undefined,
  homeScore: 1,
  homeTeamAbbreviation: home,
  homeTeamAdjustment: withAudit ? 0 : undefined,
  homeTeamId: home,
  processedAt: processedAt ? new Date(processedAt) : undefined,
  resultType,
  userId,
})

const getHistory = (records, query = {}, id = userA) =>
  getPowerRatingHistory(id, query, {
    processedRatingGameModel: createModel(records),
    teamsProvider,
  })

test('history is scoped to the authenticated user', async () => {
  const result = await getHistory([
    makeRecord({ gameDate: '2026-01-10', gameId: 1, userId: userA }),
    makeRecord({ gameDate: '2026-01-11', gameId: 2, userId: userB }),
  ])

  assert.equal(result.pagination.totalItems, 1)
  assert.deepEqual(
    result.items.map((item) => item.gameId),
    [1],
  )
})

test('one user cannot access another user records with the same game id', async () => {
  const result = await getHistory([
    makeRecord({ gameDate: '2026-01-10', gameId: 1001, userId: userA }),
    makeRecord({ gameDate: '2026-01-10', gameId: 1001, userId: userB }),
  ], {}, userB)

  assert.equal(result.pagination.totalItems, 1)
  assert.equal(result.items[0].gameId, 1001)
  assert.equal(result.items[0].homeTeam.abbreviation, 'BOS')
})

test('history defaults to newest processed records first', async () => {
  const result = await getHistory([
    makeRecord({
      gameDate: '2026-01-10',
      gameId: 1,
      processedAt: '2026-07-27T10:00:00.000Z',
    }),
    makeRecord({
      gameDate: '2026-01-11',
      gameId: 2,
      processedAt: '2026-07-28T10:00:00.000Z',
    }),
    makeRecord({
      gameDate: '2026-01-12',
      gameId: 3,
      processedAt: '2026-07-28T10:00:00.000Z',
    }),
  ])

  assert.deepEqual(
    result.items.map((item) => item.gameId),
    [3, 2, 1],
  )
})

test('history pagination returns stable page metadata', async () => {
  const result = await getHistory(
    [
      makeRecord({ gameDate: '2026-01-10', gameId: 1 }),
      makeRecord({ gameDate: '2026-01-11', gameId: 2 }),
      makeRecord({ gameDate: '2026-01-12', gameId: 3 }),
    ],
    {
      limit: '2',
      page: '2',
    },
  )

  assert.equal(result.items.length, 1)
  assert.equal(result.pagination.page, 2)
  assert.equal(result.pagination.limit, 2)
  assert.equal(result.pagination.totalItems, 3)
  assert.equal(result.pagination.totalPages, 2)
  assert.equal(result.pagination.hasPreviousPage, true)
  assert.equal(result.pagination.hasNextPage, false)
})

test('history team filter matches either side by canonical abbreviation', async () => {
  const result = await getHistory(
    [
      makeRecord({ away: 'CAR', gameDate: '2026-01-10', gameId: 1 }),
      makeRecord({ gameDate: '2026-01-11', gameId: 2, home: 'CAR' }),
      makeRecord({ gameDate: '2026-01-12', gameId: 3 }),
    ],
    {
      team: 'car',
    },
  )

  assert.deepEqual(
    result.items.map((item) => item.gameId).sort(),
    [1, 2],
  )
  assert.equal(result.filters.team, 'CAR')
})

test('history date filter applies inclusive game-date bounds', async () => {
  const result = await getHistory(
    [
      makeRecord({ gameDate: '2026-01-09', gameId: 1 }),
      makeRecord({ gameDate: '2026-01-10', gameId: 2 }),
      makeRecord({ gameDate: '2026-01-31', gameId: 3 }),
      makeRecord({ gameDate: '2026-02-01', gameId: 4 }),
    ],
    {
      from: '2026-01-10',
      to: '2026-01-31',
    },
  )

  assert.deepEqual(
    result.items.map((item) => item.gameId).sort(),
    [2, 3],
  )
  assert.deepEqual(result.filters, {
    from: '2026-01-10',
    resultType: null,
    team: null,
    to: '2026-01-31',
  })
})

test('history filtering by selected season date range uses the existing date contract', async () => {
  const result = await getHistory(
    [
      makeRecord({ gameDate: '2025-10-06', gameId: 1 }),
      makeRecord({ gameDate: '2025-10-07', gameId: 2 }),
      makeRecord({ gameDate: '2026-04-16', gameId: 3 }),
      makeRecord({ gameDate: '2026-04-17', gameId: 4 }),
    ],
    {
      from: '2025-10-07',
      to: '2026-04-16',
    },
  )

  assert.deepEqual(
    result.items.map((item) => item.gameId).sort(),
    [2, 3],
  )
})

test('history all-seasons mode omits date filters', async () => {
  const normalized = await normalizeHistoryQuery(
    {
      page: '1',
      team: 'CAR',
    },
    { teamsProvider },
  )

  assert.equal(normalized.filters.from, null)
  assert.equal(normalized.filters.to, null)
  assert.equal(normalized.parsedDates.from, null)
  assert.equal(normalized.parsedDates.to, null)
  assert.equal(normalized.filters.team, 'CAR')
})

test('history result-type filter normalizes supported values', async () => {
  const result = await getHistory(
    [
      makeRecord({ gameDate: '2026-01-10', gameId: 1 }),
      makeRecord({
        gameDate: '2026-01-11',
        gameId: 2,
        resultType: 'OVERTIME',
      }),
      makeRecord({
        gameDate: '2026-01-12',
        gameId: 3,
        resultType: 'SHOOTOUT',
      }),
    ],
    {
      resultType: 'overtime',
    },
  )

  assert.deepEqual(
    result.items.map((item) => item.gameId),
    [2],
  )
  assert.equal(result.filters.resultType, 'OVERTIME')
})

test('history rejects invalid page and limit values while clamping excessive limits', async () => {
  await assert.rejects(
    () => normalizeHistoryQuery({ page: '0' }, { teamsProvider }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'page must be a positive integer.',
  )
  await assert.rejects(
    () => normalizeHistoryQuery({ limit: 'many' }, { teamsProvider }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'limit must be a positive integer.',
  )

  const normalized = await normalizeHistoryQuery(
    {
      limit: '1000',
    },
    { teamsProvider },
  )

  assert.equal(normalized.limit, MAX_HISTORY_LIMIT)
})

test('history rejects invalid date ranges and unsupported result types', async () => {
  await assert.rejects(
    () =>
      normalizeHistoryQuery(
        {
          from: '2026-02-01',
          to: '2026-01-31',
        },
        { teamsProvider },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'from must be on or before to.',
  )
  await assert.rejects(
    () =>
      normalizeHistoryQuery(
        {
          resultType: 'winner',
        },
        { teamsProvider },
      ),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'resultType must be REGULATION, OVERTIME, or SHOOTOUT.',
  )
})

test('legacy processed-game records with missing audit fields are returned safely', async () => {
  const result = await getHistory([
    makeRecord({
      gameDate: '2026-01-10',
      gameId: 1,
      withAudit: false,
    }),
  ])
  const [item] = result.items

  assert.equal(item.awayRatingBefore, null)
  assert.equal(item.awayRatingAfter, null)
  assert.equal(item.awayRatingChange, null)
  assert.equal(item.baseHomeAdvantage, null)
  assert.equal(item.engineSettingsSnapshot, null)
  assert.equal(
    Object.values(item).some((value) => Number.isNaN(value)),
    false,
  )
})

test('processed-game unique user and game index remains unchanged', () => {
  const uniqueUserGameIndex = ProcessedRatingGame.schema.indexes().find(
    ([fields, options]) =>
      fields.userId === 1 && fields.gameId === 1 && options.unique === true,
  )

  assert.ok(uniqueUserGameIndex)
})
