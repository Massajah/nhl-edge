const HistoricalNhlGame = require('../models/HistoricalNhlGame')
const HistoricalSeasonDataset = require('../models/HistoricalSeasonDataset')
const nhlApiService = require('./nhlApiService')
const nhlSeasonService = require('./nhlSeasonService')
const { getSeedTeams } = require('./powerRatingsService')
const {
  NHL_GAME_TYPE_CODES,
  SKIP_REASONS,
  classifyGameEligibility,
  getGameStart,
} = require('./nhlGameEligibility')
const {
  RESULT_TYPES,
  classifyCompletedGameResult,
} = require('./powerRatingEngine')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EXPECTED_APPROXIMATE_GAMES = 1312
const MINIMUM_PLAUSIBLE_GAMES = 1250
const IMPORT_WINDOW_DAYS = 7
const RATE_LIMIT_MESSAGE =
  'Historical season preparation paused because the NHL service is rate limiting requests. Saved progress will be reused when you resume.'
const PREPARATION_ERROR_MESSAGE =
  'Historical season preparation could not continue. Saved progress will be reused when you resume.'
const DATASET_SOURCE = 'NHL API'

const importPromisesBySeason = new Map()
let importQueue = Promise.resolve()

class HistoricalNhlDataError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'HistoricalNhlDataError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const asPlainObject = (value) =>
  typeof value?.toObject === 'function' ? value.toObject() : value

const resolveLean = (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const createHistoricalNhlRepository = ({
  datasetModel = HistoricalSeasonDataset,
  gameModel = HistoricalNhlGame,
} = {}) => ({
  async getDataset(seasonId) {
    return resolveLean(datasetModel.findOne({ seasonId }))
  },

  async getDatasets(seasonIds) {
    return resolveLean(datasetModel.find({ seasonId: { $in: seasonIds } }))
  },

  async getGamesBySeason(seasonId) {
    const query = gameModel.find({ seasonId }).sort({ startTimeUTC: 1, gameId: 1 })
    return resolveLean(query)
  },

  async getGamesBySeasons(seasonIds) {
    const query = gameModel
      .find({ seasonId: { $in: seasonIds } })
      .sort({ seasonId: 1, startTimeUTC: 1, gameId: 1 })
    return resolveLean(query)
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

  async upsertGames(games) {
    if (!Array.isArray(games) || games.length === 0) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    return gameModel.bulkWrite(
      games.map((game) => {
        const { importedAt, ...storedGame } = game

        return {
          updateOne: {
            filter: { gameId: game.gameId },
            update: {
              $set: storedGame,
              $setOnInsert: { importedAt },
            },
            upsert: true,
          },
        }
      }),
      { ordered: false },
    )
  },
})

const defaultRepository = createHistoricalNhlRepository()

const parseUtcDate = (value, field) => {
  if (!DATE_PATTERN.test(value)) {
    throw new HistoricalNhlDataError(`${field} must use YYYY-MM-DD format.`, 400, {
      field,
    })
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.toISOString().slice(0, 10) !== value) {
    throw new HistoricalNhlDataError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return date
}

const formatUtcDate = (date) => date.toISOString().slice(0, 10)

const addUtcDays = (date, days) =>
  new Date(date.getTime() + Number(days) * DAY_MS)

const buildImportWindows = (dateFrom, dateTo) => {
  const start = parseUtcDate(dateFrom, 'regularSeasonStart')
  const end = parseUtcDate(dateTo, 'regularSeasonEnd')

  if (start > end) {
    throw new HistoricalNhlDataError(
      'Regular-season start must be before regular-season end.',
      400,
    )
  }

  const windows = []

  for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, IMPORT_WINDOW_DAYS)) {
    const windowEnd = new Date(
      Math.min(addUtcDays(cursor, IMPORT_WINDOW_DAYS - 1).getTime(), end.getTime()),
    )
    windows.push({
      dateFrom: formatUtcDate(cursor),
      dateTo: formatUtcDate(windowEnd),
    })
  }

  return windows
}

const getWindowKey = (window) => `${window.dateFrom}:${window.dateTo}`

const buildTeamDirectory = async (teamsProvider = getSeedTeams) => {
  const teams = await teamsProvider()
  const teamsById = new Map()

  ;(Array.isArray(teams) ? teams : []).forEach((team) => {
    const keys = [team.teamId, team.abbreviation]
      .map((value) => String(value ?? '').trim().toUpperCase())
      .filter(Boolean)

    keys.forEach((key) => teamsById.set(key, team))
  })

  return teamsById
}

const normalizeSeasonDefinition = (season) => {
  const seasonId = normalizeSeasonId(season?.id ?? season?.seasonId)
  const regularSeasonStart = season?.startDate ?? season?.regularSeasonStart
  const regularSeasonEnd = season?.endDate ?? season?.regularSeasonEnd

  if (!seasonId) {
    throw new HistoricalNhlDataError(
      'seasonId must use canonical YYYYyyyy format.',
      400,
      { field: 'seasonId' },
    )
  }

  parseUtcDate(regularSeasonStart, 'regularSeasonStart')
  parseUtcDate(regularSeasonEnd, 'regularSeasonEnd')

  return {
    expectedApproximateGames:
      Number(season?.expectedApproximateGames) || EXPECTED_APPROXIMATE_GAMES,
    id: seasonId,
    label: season?.label ?? seasonId,
    regularSeasonEnd,
    regularSeasonStart,
  }
}

const resolveSeasonDefinition = async (seasonId, options = {}) => {
  if (options.season) {
    const season = normalizeSeasonDefinition(options.season)

    if (season.id !== normalizeSeasonId(seasonId)) {
      throw new HistoricalNhlDataError('Season metadata does not match seasonId.', 400)
    }

    return season
  }

  const metadata = await (
    options.seasonsProvider ??
    nhlSeasonService.getAvailablePowerRatingHistorySeasons
  )()
  const normalizedSeasonId = normalizeSeasonId(seasonId)
  const matchingSeason = metadata?.seasons?.find(
    (season) => normalizeSeasonId(season.id) === normalizedSeasonId,
  )

  if (!matchingSeason) {
    throw new HistoricalNhlDataError('Historical season is not available.', 404, {
      seasonId: normalizedSeasonId,
    })
  }

  const season = normalizeSeasonDefinition(matchingSeason)
  const today = (options.todayProvider ?? nhlApiService.getTodayNhlDate)()

  if (season.regularSeasonEnd >= today) {
    throw new HistoricalNhlDataError(
      'Only completed historical regular seasons can be prepared.',
      400,
      { seasonId: season.id },
    )
  }

  return season
}

const getReplayScheduleDate = (game) =>
  game?.__replayScheduleDate ??
  game?.replayScheduleDate ??
  game?.scheduleDate ??
  String(getGameStart(game) ?? '').slice(0, 10)

const addReason = (reasonCounts, reason) => {
  const key = reason || SKIP_REASONS.MALFORMED_GAME
  reasonCounts[key] = (reasonCounts[key] ?? 0) + 1
}

const normalizeHistoricalGames = ({
  games,
  season,
  sourceFetchedAt,
  teamsById,
  now = new Date(),
}) => {
  const records = []
  const skipReasons = {}
  const seenGameIds = new Set()

  ;(Array.isArray(games) ? games : []).forEach((game) => {
    const eligibility = classifyGameEligibility(game, {
      dateFrom: season.regularSeasonStart,
      dateTo: season.regularSeasonEnd,
      gameTypes: {
        playoffs: false,
        preseason: false,
        regularSeason: true,
      },
      teamsById,
    })

    if (!eligibility.eligible) {
      addReason(skipReasons, eligibility.reason)
      return
    }

    const result = classifyCompletedGameResult(game)

    if (!result.isResolved) {
      addReason(skipReasons, SKIP_REASONS.UNRESOLVED_RESULT_TYPE)
      return
    }

    const gameId = String(eligibility.gameId ?? '').trim()
    const gameDate = getReplayScheduleDate(game)
    const startTimeUTC = new Date(getGameStart(game))

    if (!gameId || seenGameIds.has(gameId)) {
      addReason(skipReasons, gameId ? 'DUPLICATE_GAME_ID' : SKIP_REASONS.MALFORMED_GAME)
      return
    }

    if (
      !DATE_PATTERN.test(gameDate) ||
      gameDate < season.regularSeasonStart ||
      gameDate > season.regularSeasonEnd ||
      !Number.isFinite(startTimeUTC.getTime()) ||
      !Number.isInteger(result.finalScore.home) ||
      !Number.isInteger(result.finalScore.away) ||
      result.finalScore.home < 0 ||
      result.finalScore.away < 0
    ) {
      addReason(skipReasons, SKIP_REASONS.MALFORMED_GAME)
      return
    }

    seenGameIds.add(gameId)
    records.push({
      awayScore: result.finalScore.away,
      awayTeamAbbreviation: eligibility.awayTeam.abbreviation,
      awayTeamId: eligibility.awayTeam.teamId,
      gameDate,
      gameId,
      gameState: String(game.gameState).toUpperCase(),
      gameType: NHL_GAME_TYPE_CODES.REGULAR_SEASON,
      homeScore: result.finalScore.home,
      homeTeamAbbreviation: eligibility.homeTeam.abbreviation,
      homeTeamId: eligibility.homeTeam.teamId,
      importedAt: now,
      resultType: result.resultType,
      seasonId: season.id,
      source: DATASET_SOURCE,
      sourceUpdatedAt: sourceFetchedAt ? new Date(sourceFetchedAt) : now,
      startTimeUTC,
    })
  })

  return {
    records,
    skipReasons,
    skippedGames: Object.values(skipReasons).reduce((total, count) => total + count, 0),
  }
}

const RESULT_PERIOD_TYPES = Object.freeze({
  [RESULT_TYPES.OVERTIME]: 'OT',
  [RESULT_TYPES.REGULATION]: 'REG',
  [RESULT_TYPES.SHOOTOUT]: 'SO',
})

const serializeStoredGame = (storedGame) => {
  const game = asPlainObject(storedGame)

  return {
    __replayScheduleDate: game.gameDate,
    awayTeam: {
      abbrev: game.awayTeamAbbreviation,
      abbreviation: game.awayTeamAbbreviation,
      score: game.awayScore,
    },
    gameId: game.gameId,
    gameOutcome: {
      lastPeriodType: RESULT_PERIOD_TYPES[game.resultType],
    },
    gameState: game.gameState,
    gameType: game.gameType,
    homeTeam: {
      abbrev: game.homeTeamAbbreviation,
      abbreviation: game.homeTeamAbbreviation,
      score: game.homeScore,
    },
    season: Number(game.seasonId),
    startTimeUTC: new Date(game.startTimeUTC).toISOString(),
  }
}

const mergeReasonCounts = (left = {}, right = {}) => {
  const merged = { ...left }

  Object.entries(right).forEach(([reason, count]) => {
    merged[reason] = (merged[reason] ?? 0) + Number(count || 0)
  })

  return merged
}

const validateStoredSeasonDataset = ({
  completedWindows = [],
  games = [],
  minimumPlausibleGames = MINIMUM_PLAUSIBLE_GAMES,
  season,
  windows = buildImportWindows(
    season.regularSeasonStart,
    season.regularSeasonEnd,
  ),
}) => {
  const duplicateGameIds = []
  const invalidGameIds = []
  const seenIds = new Set()
  const validGames = []

  games.forEach((rawGame) => {
    const game = asPlainObject(rawGame)
    const gameId = String(game.gameId ?? '')
    const duplicate = seenIds.has(gameId)
    const valid =
      gameId &&
      game.seasonId === season.id &&
      DATE_PATTERN.test(game.gameDate ?? '') &&
      game.gameDate >= season.regularSeasonStart &&
      game.gameDate <= season.regularSeasonEnd &&
      Number.isInteger(game.homeScore) &&
      Number.isInteger(game.awayScore) &&
      game.homeScore >= 0 &&
      game.awayScore >= 0 &&
      game.homeScore !== game.awayScore &&
      RESULT_PERIOD_TYPES[game.resultType]

    if (duplicate) {
      duplicateGameIds.push(gameId)
    } else if (!valid) {
      invalidGameIds.push(gameId || null)
    } else {
      seenIds.add(gameId)
      validGames.push(game)
    }
  })

  validGames.sort((left, right) =>
    left.gameDate.localeCompare(right.gameDate) ||
    new Date(left.startTimeUTC).getTime() - new Date(right.startTimeUTC).getTime(),
  )
  const completedWindowKeys = new Set(completedWindows.map(getWindowKey))
  const missingWindows = windows.filter(
    (window) => !completedWindowKeys.has(getWindowKey(window)),
  )
  const firstGameDate = validGames[0]?.gameDate ?? null
  const lastGameDate = validGames.at(-1)?.gameDate ?? null
  const boundaryComplete =
    firstGameDate === season.regularSeasonStart &&
    lastGameDate === season.regularSeasonEnd
  const plausibleCount = validGames.length >= minimumPlausibleGames
  const ready =
    missingWindows.length === 0 &&
    duplicateGameIds.length === 0 &&
    invalidGameIds.length === 0 &&
    boundaryComplete &&
    plausibleCount

  let lastErrorCode = null

  if (missingWindows.length > 0) {
    lastErrorCode = 'missing_date_windows'
  } else if (duplicateGameIds.length > 0) {
    lastErrorCode = 'duplicate_games'
  } else if (invalidGameIds.length > 0) {
    lastErrorCode = 'invalid_games'
  } else if (!boundaryComplete) {
    lastErrorCode = 'boundary_mismatch'
  } else if (!plausibleCount) {
    lastErrorCode = 'insufficient_games'
  }

  return {
    boundaryComplete,
    completedGames: validGames.length,
    duplicateGameIds,
    firstGameDate,
    invalidGameIds,
    lastErrorCode,
    lastGameDate,
    missingWindows,
    plausibleCount,
    ready,
  }
}

const makeDatasetStatus = (dataset, season = {}) => {
  const document = asPlainObject(dataset) ?? {}
  const completedWindows = Array.isArray(document.completedWindows)
    ? document.completedWindows
    : []

  return {
    completedAt: document.completedAt ?? null,
    completedGames: document.completedGames ?? 0,
    completedWindows: completedWindows.length,
    expectedApproximateGames:
      document.expectedApproximateGames ??
      season.expectedApproximateGames ??
      EXPECTED_APPROXIMATE_GAMES,
    firstGameDate: document.firstGameDate ?? null,
    gamesFound: completedWindows.reduce(
      (total, window) => total + Number(window.gamesFound ?? 0),
      0,
    ),
    gamesPersisted: document.importedGames ?? 0,
    importedGames: document.importedGames ?? 0,
    lastAttemptAt: document.lastAttemptAt ?? null,
    lastErrorCode: document.lastErrorCode ?? null,
    lastGameDate: document.lastGameDate ?? null,
    seasonId: document.seasonId ?? season.id ?? null,
    skipReasons: document.skipReasons ?? {},
    skippedGames: document.skippedGames ?? 0,
    status: document.status ?? 'not_imported',
  }
}

const getHistoricalSeasonStatuses = async (seasonDefinitions, options = {}) => {
  const seasons = seasonDefinitions.map(normalizeSeasonDefinition)
  const datasets = await (options.repository ?? defaultRepository).getDatasets(
    seasons.map((season) => season.id),
  )
  const datasetsBySeason = new Map(
    (datasets ?? []).map((dataset) => [dataset.seasonId, dataset]),
  )

  return seasons.map((season) => {
    const status = makeDatasetStatus(datasetsBySeason.get(season.id), season)

    if (
      status.status === 'importing' &&
      !importPromisesBySeason.has(season.id)
    ) {
      return {
        ...status,
        status: status.importedGames > 0 ? 'partial' : 'not_imported',
      }
    }

    return status
  })
}

const loadPreparedSeasons = async (seasonIds, options = {}) => {
  const normalizedIds = [
    ...new Set(seasonIds.map(normalizeSeasonId).filter(Boolean)),
  ]
  const repository = options.repository ?? defaultRepository
  const [datasets, games] = await Promise.all([
    repository.getDatasets(normalizedIds),
    repository.getGamesBySeasons(normalizedIds),
  ])
  const datasetsBySeason = new Map(
    (datasets ?? []).map((dataset) => [dataset.seasonId, dataset]),
  )
  const gamesBySeason = new Map(normalizedIds.map((seasonId) => [seasonId, []]))

  ;(games ?? []).forEach((game) => {
    if (gamesBySeason.has(game.seasonId)) {
      gamesBySeason.get(game.seasonId).push(serializeStoredGame(game))
    }
  })

  gamesBySeason.forEach((seasonGames) => {
    seasonGames.sort(
      (left, right) =>
        new Date(left.startTimeUTC).getTime() -
          new Date(right.startTimeUTC).getTime() ||
        String(left.gameId).localeCompare(String(right.gameId)),
    )
  })

  return { datasetsBySeason, gamesBySeason }
}

const defaultWindowProvider = async (window) => {
  const state = await nhlApiService.getScheduleForDate(window.dateFrom, {
    allowStale: true,
    includeMetadata: true,
  })
  const normalizedState = state?.data
    ? state
    : { data: state, fetchedAt: null, source: 'live' }

  return {
    fetchedAt: normalizedState.fetchedAt,
    games: nhlApiService.extractScheduleGamesForDateRange(
      [normalizedState.data],
      window.dateFrom,
      window.dateTo,
    ),
    source: normalizedState.source,
  }
}

const getProviderErrorCode = (error) => {
  if (error?.upstreamStatus === 429 || error?.statusCode === 429) {
    return 'rate_limited'
  }

  return 'nhl_schedule_unavailable'
}

const buildPreparationResult = ({ dataset, games = [], message = null, season, totalWindows }) => ({
  dataset: makeDatasetStatus(dataset, season),
  games,
  message,
  progress: {
    completedWindows: dataset?.completedWindows?.length ?? 0,
    percent: totalWindows
      ? Math.round(((dataset?.completedWindows?.length ?? 0) / totalWindows) * 100)
      : 0,
    totalWindows,
  },
  seasonId: season.id,
  status: dataset?.status ?? 'not_imported',
})

const runSeasonImport = async (season, options = {}) => {
  const repository = options.repository ?? defaultRepository
  const windows = buildImportWindows(
    season.regularSeasonStart,
    season.regularSeasonEnd,
  )
  const existing = asPlainObject(
    options.existingDataset ?? (await repository.getDataset(season.id)),
  )

  if (existing?.status === 'ready' && options.refresh !== true) {
    const storedGames = await repository.getGamesBySeason(season.id)
    return buildPreparationResult({
      dataset: existing,
      games: storedGames.map(serializeStoredGame),
      season,
      totalWindows: windows.length,
    })
  }

  let completedWindows =
    options.refresh === true ? [] : [...(existing?.completedWindows ?? [])]
  let skipReasons = options.refresh === true ? {} : { ...(existing?.skipReasons ?? {}) }
  let skippedGames = options.refresh === true ? 0 : Number(existing?.skippedGames ?? 0)
  let dataset = await repository.upsertDataset(season.id, {
    completedAt: null,
    completedWindows,
    expectedApproximateGames: season.expectedApproximateGames,
    lastAttemptAt: new Date(),
    lastErrorCode: null,
    regularSeasonEnd: season.regularSeasonEnd,
    regularSeasonStart: season.regularSeasonStart,
    skipReasons,
    skippedGames,
    source: DATASET_SOURCE,
    status: 'importing',
  })
  const completedWindowKeys = new Set(completedWindows.map(getWindowKey))
  const teamsById = await buildTeamDirectory(options.teamsProvider)
  const windowProvider = options.windowProvider ?? defaultWindowProvider

  for (const window of windows) {
    if (completedWindowKeys.has(getWindowKey(window))) {
      continue
    }

    let windowResult

    try {
      windowResult = await windowProvider(window, { seasonId: season.id })
    } catch (error) {
      const errorCode = getProviderErrorCode(error)
      const storedGames = await repository.getGamesBySeason(season.id)
      const validation = validateStoredSeasonDataset({
        completedWindows,
        games: storedGames,
        minimumPlausibleGames:
          options.minimumPlausibleGames ?? MINIMUM_PLAUSIBLE_GAMES,
        season,
        windows,
      })
      dataset = await repository.upsertDataset(season.id, {
        completedGames: validation.completedGames,
        completedWindows,
        firstGameDate: validation.firstGameDate,
        importedGames: storedGames.length,
        lastAttemptAt: new Date(),
        lastErrorCode: errorCode,
        lastGameDate: validation.lastGameDate,
        skipReasons,
        skippedGames,
        status: storedGames.length > 0 ? 'partial' : 'error',
      })

      return buildPreparationResult({
        dataset,
        games: storedGames.map(serializeStoredGame),
        message:
          errorCode === 'rate_limited'
            ? RATE_LIMIT_MESSAGE
            : PREPARATION_ERROR_MESSAGE,
        season,
        totalWindows: windows.length,
      })
    }

    const normalized = normalizeHistoricalGames({
      games: windowResult?.games,
      now: options.nowProvider?.() ?? new Date(),
      season,
      sourceFetchedAt: windowResult?.fetchedAt,
      teamsById,
    })

    await repository.upsertGames(normalized.records)
    skipReasons = mergeReasonCounts(skipReasons, normalized.skipReasons)
    skippedGames += normalized.skippedGames
    const completedWindow = {
      completedAt: new Date(),
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      gamesFound: Array.isArray(windowResult?.games) ? windowResult.games.length : 0,
      gamesPersisted: normalized.records.length,
    }
    completedWindows = [...completedWindows, completedWindow]
    completedWindowKeys.add(getWindowKey(window))
    const importedGames = (await repository.getGamesBySeason(season.id)).length
    dataset = await repository.upsertDataset(season.id, {
      completedGames: importedGames,
      completedWindows,
      importedGames,
      lastAttemptAt: new Date(),
      lastErrorCode: null,
      skipReasons,
      skippedGames,
      status: 'importing',
    })
  }

  const storedGames = await repository.getGamesBySeason(season.id)
  const validation = validateStoredSeasonDataset({
    completedWindows,
    games: storedGames,
    minimumPlausibleGames:
      options.minimumPlausibleGames ?? MINIMUM_PLAUSIBLE_GAMES,
    season,
    windows,
  })
  const completedAt = validation.ready ? new Date() : null
  dataset = await repository.upsertDataset(season.id, {
    completedAt,
    completedGames: validation.completedGames,
    completedWindows,
    firstGameDate: validation.firstGameDate,
    importedGames: storedGames.length,
    lastAttemptAt: new Date(),
    lastErrorCode: validation.lastErrorCode,
    lastGameDate: validation.lastGameDate,
    skipReasons,
    skippedGames,
    status: validation.ready ? 'ready' : 'partial',
  })

  return buildPreparationResult({
    dataset,
    games: storedGames.map(serializeStoredGame),
    message: validation.ready
      ? 'Historical season is ready for calibration.'
      : `Historical season remains partial (${validation.completedGames}/${season.expectedApproximateGames} completed games). Saved progress will be reused.`,
    season,
    totalWindows: windows.length,
  })
}

const enqueueSeasonImport = (season, options) => {
  if (importPromisesBySeason.has(season.id)) {
    return importPromisesBySeason.get(season.id)
  }

  const task = importQueue.then(
    () => runSeasonImport(season, options),
    () => runSeasonImport(season, options),
  )
  importQueue = task.catch(() => undefined)
  importPromisesBySeason.set(season.id, task)

  task
    .finally(() => {
      importPromisesBySeason.delete(season.id)
    })
    .catch(() => undefined)

  return task
}

const ensureHistoricalSeason = async (seasonId, options = {}) => {
  const season = await resolveSeasonDefinition(seasonId, options)
  return enqueueSeasonImport(season, options)
}

const ensureHistoricalSeasons = async (seasonDefinitions, options = {}) => {
  const seasons = seasonDefinitions.map(normalizeSeasonDefinition)
  const prepared = await loadPreparedSeasons(
    seasons.map((season) => season.id),
    options,
  )
  const resultsBySeason = new Map()
  let pausedForRateLimit = false

  for (const season of seasons) {
    const dataset = prepared.datasetsBySeason.get(season.id)

    if (dataset?.status === 'ready') {
      resultsBySeason.set(
        season.id,
        buildPreparationResult({
          dataset,
          games: prepared.gamesBySeason.get(season.id) ?? [],
          season,
          totalWindows: buildImportWindows(
            season.regularSeasonStart,
            season.regularSeasonEnd,
          ).length,
        }),
      )
      continue
    }

    if (pausedForRateLimit) {
      const totalWindows = buildImportWindows(
        season.regularSeasonStart,
        season.regularSeasonEnd,
      ).length
      const status = makeDatasetStatus(dataset, season)

      resultsBySeason.set(season.id, {
        dataset: status,
        games: prepared.gamesBySeason.get(season.id) ?? [],
        message: RATE_LIMIT_MESSAGE,
        progress: {
          completedWindows: status.completedWindows,
          percent: totalWindows
            ? Math.round((status.completedWindows / totalWindows) * 100)
            : 0,
          totalWindows,
        },
        seasonId: season.id,
        status: status.status,
      })
      continue
    }

    const result = await ensureHistoricalSeason(season.id, {
      ...options,
      existingDataset: dataset,
      season,
    })
    resultsBySeason.set(season.id, result)
    pausedForRateLimit = result.dataset.lastErrorCode === 'rate_limited'
  }

  return resultsBySeason
}

const prepareHistoricalSeason = async (
  seasonId,
  payload = {},
  options = {},
) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HistoricalNhlDataError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter((field) => field !== 'refresh')

  if (unsupportedFields.length > 0) {
    throw new HistoricalNhlDataError(
      'Request contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  if (Object.hasOwn(payload, 'refresh') && typeof payload.refresh !== 'boolean') {
    throw new HistoricalNhlDataError('refresh must be a boolean.', 400, {
      field: 'refresh',
    })
  }

  return ensureHistoricalSeason(seasonId, {
    ...options,
    refresh: payload.refresh === true,
  })
}

module.exports = {
  DATASET_SOURCE,
  EXPECTED_APPROXIMATE_GAMES,
  HistoricalNhlDataError,
  IMPORT_WINDOW_DAYS,
  MINIMUM_PLAUSIBLE_GAMES,
  PREPARATION_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  buildImportWindows,
  createHistoricalNhlRepository,
  ensureHistoricalSeason,
  ensureHistoricalSeasons,
  getHistoricalSeasonStatuses,
  loadPreparedSeasons,
  makeDatasetStatus,
  normalizeHistoricalGames,
  prepareHistoricalSeason,
  serializeStoredGame,
  validateStoredSeasonDataset,
}
