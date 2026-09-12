const { BASE_MODEL_V1 } = require('../config/baseModel')
const nhlSeasonService = require('./nhlSeasonService')
const {
  CALCULATION_CONTRACT_VERSION,
  PREDICTION_DEFINITION,
} = require('./forwardPredictionContracts')
const {
  PERFORMANCE_REASON_CODES,
  PERFORMANCE_STATUSES,
  MOVEMENT_TOLERANCE,
  average,
  calculateAccuracy,
  calculateBetClv,
  calculateBetPerformance,
  calculateBrier,
  calculateCalibration,
  calculateMarketMovement,
  calculateNoVigConsensus,
  calculatePairedBrier,
  isRecognizedBookmakerKey,
  percentage,
  summarizeClv,
  uniqueReasons,
  validateOfficialPrediction,
} = require('./modelPerformanceContracts')
const {
  modelPerformanceRepository,
} = require('./modelPerformanceRepository')
const {
  resolvePredictionResults,
} = require('./modelPerformanceResultService')
const { ODDS_SNAPSHOT_TYPES } = require('./oddsSnapshotContracts')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const {
  CAPTURE_HEALTH_FILTERS,
  loadCaptureHealth,
  serializeCaptureHealth,
} = require('./modelPerformanceCaptureHealthService')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SEASON_PATTERN = /^\d{8}$/
const MODEL_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const GAME_STATUS_FILTERS = Object.freeze([
  'all',
  'resolved',
  'pending',
  'missing_market',
  'excluded',
  ...Object.keys(CAPTURE_HEALTH_FILTERS),
])

class ModelPerformanceError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message)
    this.name = 'ModelPerformanceError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const parseDate = (value, field) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ModelPerformanceError(
      `${field} must use YYYY-MM-DD format.`,
      400,
      { field },
    )
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.toISOString().slice(0, 10) !== value) {
    throw new ModelPerformanceError(`${field} must be a valid date.`, 400, {
      field,
    })
  }

  return date
}

const addUtcDays = (date, days) =>
  new Date(date.getTime() + Number(days) * 24 * 60 * 60 * 1000)

const getPerformanceSeasonEnd = (seasonId, regularSeasonEnd) => {
  const endYear = Number(String(seasonId).slice(4))
  const playoffEnvelopeEnd = new Date(Date.UTC(endYear, 6, 15))

  return playoffEnvelopeEnd > regularSeasonEnd
    ? playoffEnvelopeEnd
    : regularSeasonEnd
}

const parsePositiveInteger = (value, field, defaultValue, maximum = Infinity) => {
  if (value === undefined || value === null || value === '') return defaultValue
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    throw new ModelPerformanceError(`${field} must be a positive integer.`, 400, {
      field,
    })
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ModelPerformanceError(`${field} must be a positive integer.`, 400, {
      field,
      maximum: Number.isFinite(maximum) ? maximum : undefined,
    })
  }

  return parsed
}

const normalizeRawText = (value, field) => {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) {
    throw new ModelPerformanceError(`${field} must be a single value.`, 400, {
      field,
    })
  }

  return String(value ?? '').trim()
}

const getSeasonMetadata = async (options) =>
  options.seasonMetadata ??
  (await (
    options.seasonMetadataProvider ??
    nhlSeasonService.getAvailablePowerRatingHistorySeasons
  )(options.seasonOptions))

const normalizePerformanceQuery = async (
  query = {},
  options = {},
  { games = false } = {},
) => {
  if (!query || Array.isArray(query) || typeof query !== 'object') {
    throw new ModelPerformanceError('Query parameters must be an object.')
  }

  const seasonMetadata = await getSeasonMetadata(options)
  const rawSeason = normalizeRawText(query.season, 'season')
  const seasonId =
    rawSeason === '' || rawSeason.toLowerCase() === 'current'
      ? String(seasonMetadata?.currentSeasonId ?? '')
      : rawSeason

  if (!SEASON_PATTERN.test(seasonId)) {
    throw new ModelPerformanceError(
      'season must use the canonical eight-digit NHL season ID.',
      400,
      { field: 'season' },
    )
  }

  const season = seasonMetadata?.seasons?.find(
    (candidate) => String(candidate.id) === seasonId,
  )
  if (!season) {
    throw new ModelPerformanceError('season is not available.', 400, {
      field: 'season',
    })
  }

  const from = parseDate(query.from, 'from')
  const to = parseDate(query.to, 'to')
  if (from && to && from > to) {
    throw new ModelPerformanceError('from must not be after to.', 400, {
      field: 'from',
    })
  }

  const seasonStart = parseDate(season.startDate, 'season.startDate')
  const regularSeasonEnd = parseDate(season.endDate, 'season.endDate')
  const performanceSeasonEnd = getPerformanceSeasonEnd(
    seasonId,
    regularSeasonEnd,
  )
  const seasonEndExclusive = addUtcDays(performanceSeasonEnd, 1)
  const requestedEndExclusive = to ? addUtcDays(to, 1) : null
  const start = new Date(
    Math.max(seasonStart.getTime(), from?.getTime() ?? -Infinity),
  )
  const endExclusive = new Date(
    Math.min(
      seasonEndExclusive.getTime(),
      requestedEndExclusive?.getTime() ?? Infinity,
    ),
  )
  if (start >= endExclusive) {
    throw new ModelPerformanceError(
      'The selected date range does not overlap the selected season.',
      400,
      { field: 'from' },
    )
  }
  const modelVersion = normalizeRawText(query.modelVersion, 'modelVersion')
  if (modelVersion && !MODEL_VERSION_PATTERN.test(modelVersion)) {
    throw new ModelPerformanceError('modelVersion is invalid.', 400, {
      field: 'modelVersion',
    })
  }

  const status = games
    ? normalizeRawText(query.status, 'status').toLowerCase() || 'all'
    : 'all'
  if (games && !GAME_STATUS_FILTERS.includes(status)) {
    throw new ModelPerformanceError('status is not supported.', 400, {
      field: 'status',
      supportedValues: GAME_STATUS_FILTERS,
    })
  }

  return {
    availableSeasons: (seasonMetadata?.seasons ?? []).map((candidate) => ({
      endDate: candidate.endDate,
      id: String(candidate.id),
      isCurrent: Boolean(candidate.isCurrent),
      label: candidate.label,
      startDate: candidate.startDate,
    })),
    endExclusive,
    from: from?.toISOString().slice(0, 10) ?? null,
    limit: games
      ? parsePositiveInteger(query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
      : null,
    modelVersion: modelVersion || null,
    page: games
      ? parsePositiveInteger(query.page, 'page', DEFAULT_PAGE)
      : null,
    season: {
      endDate: season.endDate,
      id: seasonId,
      isCurrent: Boolean(season.isCurrent),
      label: season.label,
      performanceEndDate: performanceSeasonEnd.toISOString().slice(0, 10),
      regularSeasonEndDate: season.endDate,
      startDate: season.startDate,
    },
    start,
    status,
    to: to?.toISOString().slice(0, 10) ?? null,
  }
}

const sameTimestamp = (left, right) => {
  const leftTimestamp = new Date(left).getTime()
  const rightTimestamp = new Date(right).getTime()

  return (
    Number.isFinite(leftTimestamp) &&
    Number.isFinite(rightTimestamp) &&
    leftTimestamp === rightTimestamp
  )
}

const exactGameIdentity = (prediction, document) =>
  String(document?.gameId ?? '') === String(prediction.gameId) &&
  String(document?.seasonId ?? '') === String(prediction.seasonId) &&
  Number(document?.gameType) === Number(prediction.gameType) &&
  String(document?.homeTeamId ?? '') === String(prediction.homeTeamId) &&
  String(document?.awayTeamId ?? '') === String(prediction.awayTeamId) &&
  sameTimestamp(
    document?.scheduledStartAtCapture,
    prediction.scheduledStartAtCapture,
  )

const findExactDocument = (prediction, documents = []) =>
  documents.find((document) => exactGameIdentity(prediction, document)) ?? null

const resolveMarket = (prediction, documents, missingReason) => {
  const gameDocuments = documents.filter(
    ({ gameId }) => String(gameId) === String(prediction.gameId),
  )
  const exact = findExactDocument(prediction, gameDocuments)

  if (!exact) {
    return {
      awayProbability: null,
      bookmakerCount: 0,
      homeProbability: null,
      reason:
        gameDocuments.length > 0
          ? PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH
          : missingReason,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
    }
  }

  if (
    missingReason === PERFORMANCE_REASON_CODES.MISSING_FINAL_MARKET &&
    !exact.finalizedAt
  ) {
    return {
      awayProbability: null,
      bookmakerCount: 0,
      homeProbability: null,
      reason: PERFORMANCE_REASON_CODES.MISSING_FINAL_MARKET,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
    }
  }

  const consensus = calculateNoVigConsensus(exact.bookmakers ?? exact.finalBookmakers)

  return {
    awayProbability: consensus.awayProbability,
    bookmakerCount: consensus.bookmakerCount,
    homeProbability: consensus.homeProbability,
    reason: consensus.reason,
    status: consensus.status,
  }
}

const selectPredictionSide = (homeProbability) =>
  homeProbability === 0.5
    ? 'NO_PICK'
    : homeProbability > 0.5
      ? 'home'
      : 'away'

const getRowStatus = (result) => {
  if (result.status === 'FINAL') return 'RESOLVED'
  if (
    [
      PERFORMANCE_REASON_CODES.RESULT_PENDING,
      PERFORMANCE_REASON_CODES.RESULT_UNAVAILABLE,
      PERFORMANCE_REASON_CODES.GAME_POSTPONED,
      PERFORMANCE_REASON_CODES.GAME_UNAVAILABLE,
    ].includes(result.reason)
  ) {
    return 'PENDING'
  }

  return 'EXCLUDED'
}

const closingMarketForBet = (bet, closingMarkets) => {
  const candidates = closingMarkets.filter(
    ({ gameId }) => String(gameId) === String(bet.gameId),
  )
  const exact = candidates.find((market) =>
    sameTimestamp(market.scheduledStartAtCapture, bet.scheduledStart),
  )

  return exact ?? candidates[0] ?? null
}

const summarizeGameBets = (bets, clvByBet) => {
  if (bets.length === 0) return null

  const settled = bets.filter((bet) =>
    ['win', 'loss', 'push', 'void'].includes(bet.result),
  )
  const eligibleClv = bets
    .map((bet) => clvByBet.get(bet))
    .filter(({ status }) => status === PERFORMANCE_STATUSES.AVAILABLE)

  return {
    averageSameBookClvPercent: average(
      eligibleClv.map(({ clvPercent }) => clvPercent),
    ),
    betCount: bets.length,
    profit:
      settled.length > 0
        ? settled.reduce(
            (sum, bet) =>
              sum + (Number.isFinite(Number(bet.profit)) ? Number(bet.profit) : 0),
            0,
          )
        : null,
    sameBookClvEligibleCount: eligibleClv.length,
    sameBookClvReasons: uniqueReasons(
      bets.map((bet) => clvByBet.get(bet).reason),
    ),
    settledCount: settled.length,
  }
}

const finiteNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)

  return Number.isFinite(number) ? number : null
}

const decimalOddsOrNull = (value) => {
  const number = finiteNumberOrNull(value)

  return number !== null && number > 1 ? number : null
}

const probabilityOrNull = (value) => {
  const number = finiteNumberOrNull(value)

  return number !== null && number > 0 && number < 1 ? number : null
}

const timelinePricePoint = (snapshot, bookmakerKey, oddsField) => {
  const bookmaker = (snapshot?.bookmakers ?? []).find(
    ({ key }) => key === bookmakerKey,
  )
  const odds = decimalOddsOrNull(bookmaker?.[oddsField])

  return odds === null
    ? null
    : {
        observedAt: snapshot.capturedAt,
        odds,
        snapshotType: snapshot.snapshotType,
      }
}

const buildBetDetail = ({
  bet,
  clv,
  prediction,
  timelineSnapshots,
}) => {
  const declaredSide = bet.selectedSide?.homeAway
  const selectedTeamId = getNhlTeamIdentity(
    bet.selectedSide?.teamId,
    bet.selectedSide?.abbreviation,
    bet.selectedTeam?.teamId,
    bet.selectedTeam?.abbreviation,
  )
  const expectedSelectedTeamId =
    declaredSide === 'home'
      ? prediction.homeTeamId
      : declaredSide === 'away'
        ? prediction.awayTeamId
        : null
  const side =
    selectedTeamId && selectedTeamId === expectedSelectedTeamId
      ? declaredSide
      : null
  const oddsField = side === 'home' ? 'homeOdds' : side === 'away' ? 'awayOdds' : null
  const exactStart = sameTimestamp(
    bet.scheduledStart,
    prediction.scheduledStartAtCapture,
  )
  const bookmakerKey =
    bet.marketOddsSource === 'provider' &&
    isRecognizedBookmakerKey(bet.bookmakerKey)
      ? String(bet.bookmakerKey)
      : null
  const exactSnapshots = exactStart
    ? timelineSnapshots.filter((snapshot) => exactGameIdentity(prediction, snapshot))
    : []
  const pricedSnapshots =
    bookmakerKey && oddsField
      ? exactSnapshots
          .map((snapshot) => ({
            point: timelinePricePoint(snapshot, bookmakerKey, oddsField),
            snapshot,
          }))
          .filter(({ point }) => point)
          .sort(
            (left, right) =>
              new Date(left.point.observedAt).getTime() -
              new Date(right.point.observedAt).getTime(),
          )
      : []
  const checkpointPoint = (snapshotType) =>
    pricedSnapshots.find(
      ({ snapshot }) => snapshot.snapshotType === snapshotType,
    )?.point ?? null
  const marketOdds = decimalOddsOrNull(bet.marketOdds)

  return {
    analyzedAt: bet.analyzedAt ?? null,
    bookmaker: {
      key: bookmakerKey,
      name: bet.bookmakerTitle ?? bet.providerName ?? null,
      source: bet.marketOddsSource ?? null,
    },
    closingComparison: {
      bestFinalOdds: clv.bestFinalOdds,
      clvPercent: clv.clvPercent,
      reason: clv.reason,
      sameBookFinalOdds: clv.finalOdds,
      status: clv.status,
      vsBestFinalPercent: clv.vsBestFinalPercent,
    },
    createdAt: bet.createdAt ?? null,
    expectedValuePercent: finiteNumberOrNull(bet.expectedValue),
    id: String(bet._id ?? ''),
    marketOdds,
    modelAtBet: {
      fairOdds: decimalOddsOrNull(bet.fairOdds),
      probability: probabilityOrNull(bet.modelProbability),
      probabilityEdge: finiteNumberOrNull(bet.probabilityEdge),
    },
    priceTimeline: {
      bet: marketOdds === null
        ? null
        : { observedAt: bet.createdAt ?? bet.analyzedAt ?? null, odds: marketOdds },
      earliestCaptured: pricedSnapshots[0]?.point ?? null,
      final: clv.finalOdds === null
        ? null
        : { observedAt: clv.finalObservedAt, odds: clv.finalOdds },
      t2: checkpointPoint(ODDS_SNAPSHOT_TYPES.T2),
      t6: checkpointPoint(ODDS_SNAPSHOT_TYPES.T6),
    },
    profit: ['win', 'loss', 'push', 'void'].includes(bet.result)
      ? finiteNumberOrNull(bet.profit)
      : null,
    result: bet.result ?? 'pending',
    selectedSide: {
      homeAway: side ?? null,
      teamId: selectedTeamId,
    },
    stake: finiteNumberOrNull(bet.stake),
  }
}

const makeReasonCounts = (reasons) =>
  reasons.filter(Boolean).reduce((counts, reason) => {
    counts[reason] = (counts[reason] ?? 0) + 1
    return counts
  }, {})

const buildDataset = async (userId, rawQuery, options = {}, games = false) => {
  if (!userId) {
    throw new ModelPerformanceError('Authentication required.', 401)
  }

  const repository = options.repository ?? modelPerformanceRepository
  const normalized = await normalizePerformanceQuery(rawQuery, options, { games })
  const predictionFilter = {
    endExclusive: normalized.endExclusive,
    predictionDefinition: PREDICTION_DEFINITION,
    seasonId: normalized.season.id,
    start: normalized.start,
    userId,
  }
  const [latestModelVersion, discoveredModelVersions] = await Promise.all([
    normalized.modelVersion
      ? Promise.resolve(null)
      : repository.findLatestModelVersion(predictionFilter),
    typeof repository.findModelVersions === 'function'
      ? repository.findModelVersions(predictionFilter)
      : Promise.resolve([]),
  ])
  const modelVersion =
    normalized.modelVersion ?? latestModelVersion ?? BASE_MODEL_V1.modelVersion
  const availableModelVersions = [...new Set([
    ...discoveredModelVersions,
    modelVersion,
  ])].sort()
  const [candidatePredictions, bets] = await Promise.all([
    repository.findPredictions({ ...predictionFilter, modelVersion }),
    repository.findBets({
      endExclusive: normalized.endExclusive,
      start: normalized.start,
      userId,
    }),
  ])
  const invalidPredictionReasons = []
  const predictions = candidatePredictions.filter((prediction) => {
    const reason = validateOfficialPrediction(prediction)
    if (reason) invalidPredictionReasons.push(reason)
    return !reason
  })
  const captureHealthPromise = loadCaptureHealth({
    normalized,
    now: options.captureHealthNow,
    predictions,
    repository,
    scheduleProvider:
      options.captureHealthScheduleProvider ??
      repository.captureHealthScheduleProvider,
  })
  const predictionGameIds = predictions.map(({ gameId }) => String(gameId))
  const allGameIds = [
    ...new Set([
      ...predictionGameIds,
      ...bets.map(({ gameId }) => String(gameId ?? '')).filter(Boolean),
    ]),
  ]
  const [
    historicalGames,
    timelineSnapshots,
    closingMarkets,
    captureHealth,
  ] = await Promise.all([
    repository.findHistoricalGames(predictionGameIds),
    games && typeof repository.findTimelineSnapshots === 'function'
      ? repository.findTimelineSnapshots(
          predictionGameIds,
          normalized.season.id,
        )
      : repository.findT2Snapshots(predictionGameIds, normalized.season.id),
    repository.findClosingMarkets(allGameIds),
    captureHealthPromise,
  ])
  const t2Snapshots = timelineSnapshots.filter(
    ({ snapshotType }) =>
      !snapshotType || snapshotType === ODDS_SNAPSHOT_TYPES.T2,
  )
  const results = await resolvePredictionResults({
    gameProvider: options.gameProvider,
    historicalGames,
    predictions,
  })
  const clvByBet = new Map(
    bets.map((bet) => [
      bet,
      calculateBetClv(bet, closingMarketForBet(bet, closingMarkets)),
    ]),
  )
  const betsByGameId = new Map()

  bets.forEach((bet) => {
    const gameId = String(bet.gameId ?? '')
    if (!betsByGameId.has(gameId)) betsByGameId.set(gameId, [])
    betsByGameId.get(gameId).push(bet)
  })

  const rows = predictions.map((prediction) => {
    const result = results.get(prediction)
    const t2Market = resolveMarket(
      prediction,
      t2Snapshots,
      PERFORMANCE_REASON_CODES.MISSING_T2_MARKET,
    )
    const finalMarket = resolveMarket(
      prediction,
      closingMarkets,
      PERFORMANCE_REASON_CODES.MISSING_FINAL_MARKET,
    )
    const gameBets = betsByGameId.get(String(prediction.gameId)) ?? []
    const betDetails = games
      ? gameBets.map((bet) =>
          buildBetDetail({
            bet,
            clv: clvByBet.get(bet),
            prediction,
            timelineSnapshots,
          }),
        )
      : []
    const allMarketsAvailable =
      t2Market.status === PERFORMANCE_STATUSES.AVAILABLE &&
      finalMarket.status === PERFORMANCE_STATUSES.AVAILABLE
    const distanceAtT2 =
      t2Market.homeProbability === null
        ? null
        : Math.abs(prediction.homeWinProbability - t2Market.homeProbability) * 100
    const distanceAtFinal =
      finalMarket.homeProbability === null
        ? null
        : Math.abs(prediction.homeWinProbability - finalMarket.homeProbability) * 100
    const distanceChange =
      allMarketsAvailable ? distanceAtFinal - distanceAtT2 : null
    const movement =
      distanceChange === null
        ? null
        : distanceChange < -MOVEMENT_TOLERANCE * 100
          ? 'TOWARD_MODEL'
          : distanceChange > MOVEMENT_TOLERANCE * 100
            ? 'AWAY_FROM_MODEL'
            : 'UNCHANGED'

    return {
      awayTeamId: prediction.awayTeamId,
      betDetails,
      bets: summarizeGameBets(gameBets, clvByBet),
      completeness: prediction.completeness,
      finalMarket,
      gameId: prediction.gameId,
      generatedAt: prediction.generatedAt,
      homeTeamId: prediction.homeTeamId,
      marketDistance: {
        changePercentagePoints: distanceChange,
        finalPercentagePoints: distanceAtFinal,
        movement,
        t2PercentagePoints: distanceAtT2,
      },
      model: {
        adjustments: prediction.adjustments,
        awayWinProbability: prediction.awayWinProbability,
        awayFairOdds: prediction.awayFairOdds,
        homeWinProbability: prediction.homeWinProbability,
        homeFairOdds: prediction.homeFairOdds,
        pick: selectPredictionSide(prediction.homeWinProbability),
        state: prediction.modelState,
      },
      modelVersion: prediction.modelVersion,
      reasons: uniqueReasons([
        result.reason,
        t2Market.reason,
        finalMarket.reason,
      ]),
      result,
      scheduledStart: prediction.scheduledStartAtCapture,
      settingsFingerprint: prediction.settingsFingerprint,
      status: getRowStatus(result),
      t2Market,
    }
  })

  return {
    availableModelVersions,
    bets,
    captureHealth,
    closingMarkets,
    clvByBet,
    invalidPredictionReasons,
    modelVersion,
    normalized,
    predictions,
    rows,
  }
}

const withCoverage = (comparison, officialPredictionCount) => ({
  ...comparison,
  marketCoveragePercent: percentage(
    comparison.marketCoverageCount,
    officialPredictionCount,
  ),
})

const buildMetadata = (dataset) => {
  const fingerprints = new Set(
    dataset.predictions.map(({ settingsFingerprint }) => settingsFingerprint),
  )

  return {
    availableModelVersions: dataset.availableModelVersions,
    availableSeasons: dataset.normalized.availableSeasons,
    calculationContractVersion: CALCULATION_CONTRACT_VERSION,
    dateRange: {
      effectiveFrom: dataset.normalized.start.toISOString().slice(0, 10),
      effectiveTo: new Date(
        dataset.normalized.endExclusive.getTime() - 1,
      ).toISOString().slice(0, 10),
      from: dataset.normalized.from,
      to: dataset.normalized.to,
    },
    mixedSettings: fingerprints.size > 1,
    modelVersion: dataset.modelVersion,
    officialPredictionCount: dataset.predictions.length,
    predictionDefinition: PREDICTION_DEFINITION,
    season: dataset.normalized.season,
    settingsFingerprintCount: fingerprints.size,
  }
}

const buildCoverage = (dataset) => {
  const officialPredictions = dataset.rows.length
  const validFinalResults = dataset.rows.filter(
    ({ result }) => result.status === 'FINAL',
  ).length
  const validT2Markets = dataset.rows.filter(
    ({ t2Market }) => t2Market.status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length
  const validFinalMarkets = dataset.rows.filter(
    ({ finalMarket }) => finalMarket.status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length
  const validT2AndFinalMarkets = dataset.rows.filter(
    ({ finalMarket, t2Market }) =>
      finalMarket.status === PERFORMANCE_STATUSES.AVAILABLE &&
      t2Market.status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length
  const recognizedBets = dataset.bets.filter(({ bookmakerKey }) =>
    isRecognizedBookmakerKey(bookmakerKey),
  ).length
  const sameBookClvEligibleBets = [...dataset.clvByBet.values()].filter(
    ({ status }) => status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length

  return {
    bets: {
      betsWithRecognizedBookmaker: recognizedBets,
      clvCoveragePercent: percentage(
        sameBookClvEligibleBets,
        dataset.bets.length,
      ),
      sameBookClvEligibleBets,
      settledBets: dataset.bets.filter((bet) =>
        ['win', 'loss', 'push', 'void'].includes(bet.result),
      ).length,
      totalRelevantBets: dataset.bets.length,
    },
    forward: {
      finalMarketCoveragePercent: percentage(
        validFinalMarkets,
        officialPredictions,
      ),
      officialPredictions,
      resolvedPredictions: validFinalResults,
      resultCoveragePercent: percentage(
        validFinalResults,
        officialPredictions,
      ),
      t2MarketCoveragePercent: percentage(validT2Markets, officialPredictions),
      validFinalMarkets,
      validFinalResults,
      validT2AndFinalMarkets,
      validT2Markets,
    },
  }
}

const buildDataQuality = (dataset) => {
  const forwardReasons = [
    ...dataset.invalidPredictionReasons,
    ...dataset.rows.flatMap((row) => row.reasons),
  ]
  const betReasons = [...dataset.clvByBet.values()].map(({ reason }) => reason)

  if (dataset.predictions.length === 0) {
    forwardReasons.push(PERFORMANCE_REASON_CODES.NO_OFFICIAL_PREDICTION)
  }
  if (dataset.bets.length === 0) {
    betReasons.push(PERFORMANCE_REASON_CODES.NO_RELEVANT_BET)
  }

  const forwardReasonCounts = makeReasonCounts(forwardReasons)
  const betReasonCounts = makeReasonCounts(betReasons)
  const reasonCounts = makeReasonCounts([...forwardReasons, ...betReasons])

  return {
    bets: {
      reasonCounts: betReasonCounts,
      reasons: Object.keys(betReasonCounts).sort(),
    },
    forward: {
      reasonCounts: forwardReasonCounts,
      reasons: Object.keys(forwardReasonCounts).sort(),
    },
    reasonCounts,
    reasons: Object.keys(reasonCounts).sort(),
    status:
      dataset.predictions.length === 0 && dataset.bets.length === 0
        ? PERFORMANCE_STATUSES.UNAVAILABLE
        : [...forwardReasons, ...betReasons].filter(Boolean).length > 0
          ? 'partial'
          : 'complete',
  }
}

const getModelPerformance = async (userId, query = {}, options = {}) => {
  const dataset = await buildDataset(userId, query, options)
  const resolvedRows = dataset.rows.filter(
    ({ result }) => result.status === 'FINAL',
  )
  const modelObservations = resolvedRows.map(({ model, result }) => ({
    outcome: result.homeWon ? 1 : 0,
    probability: model.homeWinProbability,
  }))
  const modelBrier = calculateBrier(modelObservations, dataset.rows.length)
  if (dataset.rows.length === 0) {
    modelBrier.reasons = [PERFORMANCE_REASON_CODES.NO_OFFICIAL_PREDICTION]
  } else {
    modelBrier.reasons = uniqueReasons(
      dataset.rows
        .filter(({ result }) => result.status !== 'FINAL')
        .map(({ result }) => result.reason),
    )
  }
  const t2Coverage = dataset.rows.filter(
    ({ t2Market }) => t2Market.status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length
  const finalCoverage = dataset.rows.filter(
    ({ finalMarket }) => finalMarket.status === PERFORMANCE_STATUSES.AVAILABLE,
  ).length
  const t2Comparison = calculatePairedBrier({
    marketCoverageCount: t2Coverage,
    observations: resolvedRows.map(({ model, result, t2Market }) => ({
      bookmakerCount: t2Market.bookmakerCount,
      marketProbability: t2Market.homeProbability,
      modelProbability: model.homeWinProbability,
      outcome: result.homeWon ? 1 : 0,
    })),
    resolvedCount: resolvedRows.length,
  })
  const finalComparison = calculatePairedBrier({
    marketCoverageCount: finalCoverage,
    observations: resolvedRows.map(({ finalMarket, model, result }) => ({
      bookmakerCount: finalMarket.bookmakerCount,
      marketProbability: finalMarket.homeProbability,
      modelProbability: model.homeWinProbability,
      outcome: result.homeWon ? 1 : 0,
    })),
    resolvedCount: resolvedRows.length,
  })
  const clvRows = [...dataset.clvByBet.values()]
  const enrichComparison = (comparison, marketField) => ({
    ...withCoverage(comparison, dataset.rows.length),
    missingMarketCount: Math.max(
      0,
      dataset.rows.length - comparison.marketCoverageCount,
    ),
    reasons:
      dataset.rows.length === 0
        ? [PERFORMANCE_REASON_CODES.NO_OFFICIAL_PREDICTION]
        : uniqueReasons(
            dataset.rows.map((row) => row[marketField].reason),
          ),
  })

  return {
    betPerformance: calculateBetPerformance(dataset.bets),
    calibration: calculateCalibration(
      resolvedRows.map(({ model, result }) => ({
        homeProbability: model.homeWinProbability,
        homeWon: result.homeWon,
      })),
    ),
    captureHealth: serializeCaptureHealth(dataset.captureHealth),
    clv: summarizeClv(clvRows, dataset.bets.length),
    cohortDefinition: {
      authenticatedOwnerOnly: true,
      calculationContractVersion: CALCULATION_CONTRACT_VERSION,
      modelVersion: dataset.modelVersion,
      predictionDefinition: PREDICTION_DEFINITION,
      resultResolution: 'read_time_exact_identity',
      t2Window: {
        closeMinutesBeforeStart: 75,
        inclusiveBoundaries: true,
        openMinutesBeforeStart: 120,
      },
    },
    coverage: buildCoverage(dataset),
    dataQuality: buildDataQuality(dataset),
    forwardOverview: {
      accuracy: calculateAccuracy(
        resolvedRows.map(({ model, result }) => ({
          homeProbability: model.homeWinProbability,
          homeWon: result.homeWon,
        })),
      ),
      modelBrier,
    },
    marketComparison: {
      final: enrichComparison(
        finalComparison,
        'finalMarket',
      ),
      movementTowardModel: calculateMarketMovement(
        dataset.rows.map(({ finalMarket, model, t2Market }) => ({
          finalProbability: finalMarket.homeProbability,
          modelProbability: model.homeWinProbability,
          t2Probability: t2Market.homeProbability,
        })),
      ),
      t2: enrichComparison(
        t2Comparison,
        't2Market',
      ),
    },
    metadata: buildMetadata(dataset),
  }
}

const rowMatchesStatus = (row, status) => {
  if (status === 'all') return true
  if (status === 'resolved') return row.status === 'RESOLVED'
  if (status === 'pending') return row.status === 'PENDING'
  if (status === 'excluded') return row.status === 'EXCLUDED'
  if (status === 'missing_market') {
    return [row.t2Market, row.finalMarket].some(
      ({ status: marketStatus }) =>
        marketStatus === PERFORMANCE_STATUSES.UNAVAILABLE,
    )
  }

  return false
}

const getModelPerformanceGames = async (userId, query = {}, options = {}) => {
  const dataset = await buildDataset(userId, query, options, true)
  const captureFilter = CAPTURE_HEALTH_FILTERS[dataset.normalized.status]
  const filtered = captureFilter
    ? dataset.captureHealth.missingGames?.[captureFilter.detailKey] ?? []
    : dataset.rows.filter((row) =>
        rowMatchesStatus(row, dataset.normalized.status),
      )
  const totalItems = filtered.length
  const totalPages = Math.ceil(totalItems / dataset.normalized.limit)
  const offset = (dataset.normalized.page - 1) * dataset.normalized.limit

  return {
    captureHealth: serializeCaptureHealth(dataset.captureHealth),
    cohortDefinition: {
      modelVersion: dataset.modelVersion,
      predictionDefinition: PREDICTION_DEFINITION,
    },
    coverage: buildCoverage(dataset),
    dataQuality: buildDataQuality(dataset),
    filters: {
      from: dataset.normalized.from,
      limit: dataset.normalized.limit,
      modelVersion: dataset.modelVersion,
      page: dataset.normalized.page,
      season: dataset.normalized.season.id,
      status: dataset.normalized.status,
      to: dataset.normalized.to,
    },
    items: filtered.slice(offset, offset + dataset.normalized.limit),
    metadata: buildMetadata(dataset),
    pagination: {
      hasNextPage: dataset.normalized.page < totalPages,
      hasPreviousPage: dataset.normalized.page > 1,
      page: dataset.normalized.page,
      pageSize: dataset.normalized.limit,
      totalItems,
      totalPages,
    },
  }
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  GAME_STATUS_FILTERS,
  MAX_LIMIT,
  ModelPerformanceError,
  buildCoverage,
  buildDataQuality,
  buildDataset,
  exactGameIdentity,
  getModelPerformance,
  getModelPerformanceGames,
  getPerformanceSeasonEnd,
  normalizePerformanceQuery,
  resolveMarket,
  rowMatchesStatus,
}
