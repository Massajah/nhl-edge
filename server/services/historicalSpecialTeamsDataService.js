const HistoricalSpecialTeamsSeason = require('../models/HistoricalSpecialTeamsSeason')
const nhlApiService = require('./nhlApiService')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const DATASET_SOURCE = 'NHL Stats API'
const EXPECTED_TEAM_COUNTS = Object.freeze({
  '20202021': 31,
})
const DEFAULT_EXPECTED_TEAM_COUNT = 32
const preparationPromisesBySeason = new Map()

class HistoricalSpecialTeamsDataError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'HistoricalSpecialTeamsDataError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const asPlainObject = (value) =>
  typeof value?.toObject === 'function' ? value.toObject() : value

const resolveLean = (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const createHistoricalSpecialTeamsRepository = ({
  datasetModel = HistoricalSpecialTeamsSeason,
} = {}) => ({
  async getDataset(seasonId) {
    return resolveLean(datasetModel.findOne({ seasonId }))
  },

  async getDatasets(seasonIds) {
    return resolveLean(datasetModel.find({ seasonId: { $in: seasonIds } }))
  },

  async upsertDataset(seasonId, values) {
    const query = datasetModel.findOneAndUpdate(
      { seasonId },
      {
        $set: values,
        $setOnInsert: { seasonId },
      },
      {
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        upsert: true,
      },
    )

    return resolveLean(query)
  },
})

const defaultRepository = createHistoricalSpecialTeamsRepository()

const calculatePowerPlayPercentage = (goals, opportunities) => {
  const normalizedGoals = Number(goals)
  const normalizedOpportunities = Number(opportunities)

  return Number.isFinite(normalizedGoals) &&
    Number.isFinite(normalizedOpportunities) &&
    normalizedGoals >= 0 &&
    normalizedOpportunities > 0 &&
    normalizedGoals <= normalizedOpportunities
    ? normalizedGoals / normalizedOpportunities
    : null
}

const calculatePenaltyKillPercentage = (goalsAllowed, situations) => {
  const normalizedGoalsAllowed = Number(goalsAllowed)
  const normalizedSituations = Number(situations)

  return Number.isFinite(normalizedGoalsAllowed) &&
    Number.isFinite(normalizedSituations) &&
    normalizedGoalsAllowed >= 0 &&
    normalizedSituations > 0 &&
    normalizedGoalsAllowed <= normalizedSituations
    ? 1 - normalizedGoalsAllowed / normalizedSituations
    : null
}

const getExpectedTeamCount = (seasonId) =>
  EXPECTED_TEAM_COUNTS[seasonId] ?? DEFAULT_EXPECTED_TEAM_COUNT

const normalizeTeamRow = (row = {}) => {
  const teamId = getNhlTeamIdentity(
    row.teamId,
    row.sourceTeamAbbreviation,
    row.teamAbbreviation,
    row.teamName,
  )
  const gamesPlayed = Number(row.gamesPlayed)
  const powerPlayGoals = Number(row.powerPlayGoals)
  const powerPlayOpportunities = Number(row.powerPlayOpportunities)
  const penaltyKillSituations = Number(row.penaltyKillSituations)
  const powerPlayGoalsAllowed = Number(row.powerPlayGoalsAllowed)
  const rawPowerPlayPercentage = calculatePowerPlayPercentage(
    powerPlayGoals,
    powerPlayOpportunities,
  )
  const rawPenaltyKillPercentage = calculatePenaltyKillPercentage(
    powerPlayGoalsAllowed,
    penaltyKillSituations,
  )

  if (
    !teamId ||
    !Number.isInteger(gamesPlayed) ||
    gamesPlayed <= 0 ||
    !Number.isInteger(powerPlayGoals) ||
    !Number.isInteger(powerPlayOpportunities) ||
    !Number.isInteger(penaltyKillSituations) ||
    !Number.isInteger(powerPlayGoalsAllowed) ||
    rawPowerPlayPercentage === null ||
    rawPenaltyKillPercentage === null
  ) {
    return null
  }

  return {
    gamesPlayed,
    penaltyKillSituations,
    powerPlayGoals,
    powerPlayGoalsAllowed,
    powerPlayOpportunities,
    rawPenaltyKillPercentage,
    rawPowerPlayPercentage,
    sourceTeamAbbreviation: String(
      row.sourceTeamAbbreviation ?? row.teamAbbreviation ?? teamId,
    )
      .trim()
      .toUpperCase(),
    teamId,
    teamName: String(row.teamName ?? teamId).trim() || teamId,
  }
}

const normalizeSeasonRows = (seasonId, rows, options = {}) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)

  if (!normalizedSeasonId) {
    throw new HistoricalSpecialTeamsDataError(
      'seasonId must use canonical YYYYyyyy format.',
      400,
      { field: 'seasonId' },
    )
  }

  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map(normalizeTeamRow)
    .filter(Boolean)
    .sort((left, right) => left.teamId.localeCompare(right.teamId))
  const duplicateTeamIds = normalizedRows
    .filter((row, index) => normalizedRows[index - 1]?.teamId === row.teamId)
    .map((row) => row.teamId)
  const expectedTeamCount =
    options.expectedTeamCount ?? getExpectedTeamCount(normalizedSeasonId)

  if (
    duplicateTeamIds.length > 0 ||
    normalizedRows.length !== expectedTeamCount
  ) {
    throw new HistoricalSpecialTeamsDataError(
      'Historical Special Teams season is incomplete.',
      409,
      {
        actualTeamCount: normalizedRows.length,
        duplicateTeamIds,
        expectedTeamCount,
        seasonId: normalizedSeasonId,
      },
    )
  }

  return normalizedRows
}

const makeDatasetStatus = (dataset, seasonId) => {
  const document = asPlainObject(dataset) ?? {}

  return {
    completedAt: document.completedAt ?? null,
    lastAttemptAt: document.lastAttemptAt ?? null,
    lastErrorCode: document.lastErrorCode ?? null,
    seasonId: document.seasonId ?? normalizeSeasonId(seasonId) ?? null,
    source: document.source ?? DATASET_SOURCE,
    sourceFetchedAt: document.sourceFetchedAt ?? null,
    status: document.status ?? 'not_imported',
    teamCount: document.teamCount ?? 0,
  }
}

const getHistoricalSpecialTeamsStatuses = async (seasonIds, options = {}) => {
  const normalizedIds = [
    ...new Set((seasonIds ?? []).map(normalizeSeasonId).filter(Boolean)),
  ]
  const datasets = await (
    options.repository ?? defaultRepository
  ).getDatasets(normalizedIds)
  const datasetsById = new Map(
    (datasets ?? []).map((dataset) => [dataset.seasonId, dataset]),
  )

  return normalizedIds.map((seasonId) => {
    const status = makeDatasetStatus(datasetsById.get(seasonId), seasonId)

    return status.status === 'importing' &&
      !preparationPromisesBySeason.has(seasonId)
      ? { ...status, status: 'not_imported' }
      : status
  })
}

const loadPreparedSpecialTeamsSeasons = async (seasonIds, options = {}) => {
  const normalizedIds = [
    ...new Set((seasonIds ?? []).map(normalizeSeasonId).filter(Boolean)),
  ]
  const datasets = await (
    options.repository ?? defaultRepository
  ).getDatasets(normalizedIds)

  return new Map(
    (datasets ?? []).map((dataset) => [dataset.seasonId, asPlainObject(dataset)]),
  )
}

const getProviderErrorCode = (error) =>
  error?.upstreamStatus === 429 || error?.statusCode === 429
    ? 'rate_limited'
    : 'nhl_special_teams_unavailable'

const runPreparation = async (seasonId, options = {}) => {
  const repository = options.repository ?? defaultRepository
  const existing = asPlainObject(await repository.getDataset(seasonId))

  if (existing?.status === 'ready' && options.refresh !== true) {
    return {
      dataset: makeDatasetStatus(existing, seasonId),
      message: 'Historical Special Teams season is ready.',
      seasonId,
      status: 'ready',
    }
  }

  await repository.upsertDataset(seasonId, {
    completedAt: null,
    lastAttemptAt: new Date(),
    lastErrorCode: null,
    source: DATASET_SOURCE,
    status: 'importing',
  })

  try {
    const rows = await (
      options.rowsProvider ?? nhlApiService.getHistoricalSeasonSpecialTeamsRows
    )(seasonId)
    const teams = normalizeSeasonRows(seasonId, rows, options)
    const completedAt = options.nowProvider?.() ?? new Date()
    const dataset = await repository.upsertDataset(seasonId, {
      completedAt,
      lastAttemptAt: completedAt,
      lastErrorCode: null,
      source: DATASET_SOURCE,
      sourceFetchedAt: completedAt,
      status: 'ready',
      teamCount: teams.length,
      teams,
    })

    return {
      dataset: makeDatasetStatus(dataset, seasonId),
      message: 'Historical Special Teams season is ready.',
      seasonId,
      status: 'ready',
    }
  } catch (error) {
    const errorCode = getProviderErrorCode(error)
    const preserveReadyDataset = existing?.status === 'ready'

    await repository.upsertDataset(seasonId, {
      completedAt: preserveReadyDataset ? existing.completedAt : null,
      lastAttemptAt: new Date(),
      lastErrorCode: errorCode,
      source: DATASET_SOURCE,
      status: preserveReadyDataset ? 'ready' : 'error',
      teamCount: preserveReadyDataset ? existing.teamCount : 0,
      teams: preserveReadyDataset ? existing.teams : [],
    })

    if (error instanceof HistoricalSpecialTeamsDataError) {
      throw error
    }

    throw new HistoricalSpecialTeamsDataError(
      errorCode === 'rate_limited'
        ? 'Historical Special Teams preparation paused because the NHL service is rate limiting requests. Retry will reuse the saved season state.'
        : 'Historical Special Teams preparation failed. Retry is safe.',
      errorCode === 'rate_limited' ? 429 : 502,
      { errorCode, seasonId },
    )
  }
}

const prepareHistoricalSpecialTeamsSeason = async (
  seasonId,
  payload = {},
  options = {},
) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HistoricalSpecialTeamsDataError(
      'Request body must be an object.',
      400,
    )
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => field !== 'refresh',
  )

  if (unsupportedFields.length > 0) {
    throw new HistoricalSpecialTeamsDataError(
      'Request contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  if (Object.hasOwn(payload, 'refresh') && typeof payload.refresh !== 'boolean') {
    throw new HistoricalSpecialTeamsDataError(
      'refresh must be a boolean.',
      400,
      { field: 'refresh' },
    )
  }

  const normalizedSeasonId = normalizeSeasonId(seasonId)

  if (!normalizedSeasonId) {
    throw new HistoricalSpecialTeamsDataError(
      'seasonId must use canonical YYYYyyyy format.',
      400,
      { field: 'seasonId' },
    )
  }

  if (!preparationPromisesBySeason.has(normalizedSeasonId)) {
    const promise = runPreparation(normalizedSeasonId, {
      ...options,
      refresh: payload.refresh === true,
    }).finally(() => {
      preparationPromisesBySeason.delete(normalizedSeasonId)
    })

    preparationPromisesBySeason.set(normalizedSeasonId, promise)
  }

  return preparationPromisesBySeason.get(normalizedSeasonId)
}

module.exports = {
  DATASET_SOURCE,
  DEFAULT_EXPECTED_TEAM_COUNT,
  EXPECTED_TEAM_COUNTS,
  HistoricalSpecialTeamsDataError,
  calculatePenaltyKillPercentage,
  calculatePowerPlayPercentage,
  createHistoricalSpecialTeamsRepository,
  getExpectedTeamCount,
  getHistoricalSpecialTeamsStatuses,
  loadPreparedSpecialTeamsSeasons,
  makeDatasetStatus,
  normalizeSeasonRows,
  normalizeTeamRow,
  prepareHistoricalSpecialTeamsSeason,
}
