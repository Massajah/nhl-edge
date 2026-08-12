const specialTeamsMatchups = require('../../shared/specialTeamsMatchups')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const historicalNhlDataService = require('./historicalNhlDataService')
const historicalSpecialTeamsDataService = require('./historicalSpecialTeamsDataService')
const { FALLBACK_SEASONS, getSeasonLabel } = require('./nhlSeasonService')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const { getSeedTeams } = require('./powerRatingsService')
const {
  STARTING_MODES,
  buildStartingState,
  calculateMetrics,
} = require('./baseModelCalibrationService')
const { preparePhase3ReplayGames } = require('./scheduleCalibrationService')
const {
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')

const TARGET_SEASON_IDS = Object.freeze([
  '20232024',
  '20242025',
  '20252026',
])
const STANDARD_THRESHOLDS = Object.freeze([4, 6, 8, 10])
const STANDARD_ADJUSTMENTS = Object.freeze([0, 0.25, 0.5, 0.75, 1])
const CUSTOM_THRESHOLD_LIMITS = Object.freeze({ max: 12, min: 2 })
const {
  NEGATIVE,
  NEUTRAL,
  POSITIVE,
  UNAVAILABLE,
} = specialTeamsMatchups.SPECIAL_TEAMS_MATCHUP_STATUSES

class SpecialTeamsCalibrationError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'SpecialTeamsCalibrationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const round = (value, decimals = 8) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const getSeasonDefinition = (seasonId, { targetOnly = false } = {}) => {
  const normalizedId = normalizeSeasonId(seasonId)
  const season = FALLBACK_SEASONS.find((candidate) => candidate.id === normalizedId)

  if (!season || (targetOnly && !TARGET_SEASON_IDS.includes(normalizedId))) {
    throw new SpecialTeamsCalibrationError(
      targetOnly
        ? 'Season is not part of the Phase 4 target window.'
        : 'Historical Special Teams season is not supported.',
      400,
      { seasonId: normalizedId || seasonId },
    )
  }

  return {
    endDate: season.endDate,
    expectedApproximateGames: normalizedId === '20202021' ? 868 : 1312,
    id: normalizedId,
    label: getSeasonLabel(normalizedId),
    startDate: season.startDate,
  }
}

const getPriorSeasonIds = (targetSeasonId, count = 3) => {
  const normalizedId = normalizeSeasonId(targetSeasonId)

  if (!normalizedId) {
    return []
  }

  const startYear = Number(normalizedId.slice(0, 4))

  return Array.from({ length: count }, (_item, index) => {
    const priorStartYear = startYear - count + index
    return `${priorStartYear}${priorStartYear + 1}`
  })
}

const getRequiredReferenceSeasonIds = (targetSeasonIds = TARGET_SEASON_IDS) => [
  ...new Set(targetSeasonIds.flatMap((seasonId) => getPriorSeasonIds(seasonId))),
]

const normalizeTeam = (team = {}) => {
  const teamId = getNhlTeamIdentity(
    team.teamId,
    team.id,
    team.abbreviation,
    team.teamName,
    team.name,
  )

  return teamId
    ? {
        abbreviation: teamId,
        teamId,
        teamName: team.teamName ?? team.name ?? teamId,
      }
    : null
}

const rankSpecialTeamsRows = (rows, field) => {
  const ranked = (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isFinite(row?.[field]))
    .sort(
      (left, right) =>
        right[field] - left[field] ||
        String(left.teamId).localeCompare(String(right.teamId)),
    )
  const ranksByTeam = new Map()
  let rank = null
  let previousValue = null

  ranked.forEach((row, index) => {
    if (index === 0 || row[field] !== previousValue) {
      rank = index + 1
    }

    ranksByTeam.set(row.teamId, rank)
    previousValue = row[field]
  })

  return ranksByTeam
}

const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const buildFrozenSpecialTeamsReference = ({
  seasonDatasets,
  targetSeasonId,
  targetTeamIds,
}) => {
  const normalizedTargetSeasonId = normalizeSeasonId(targetSeasonId)
  const sourceSeasonIds = getPriorSeasonIds(normalizedTargetSeasonId)
  const sourceDatasets = sourceSeasonIds.map((seasonId) =>
    seasonDatasets.get(seasonId),
  )
  const missingSeasonIds = sourceSeasonIds.filter(
    (_seasonId, index) => sourceDatasets[index]?.status !== 'ready',
  )

  if (missingSeasonIds.length > 0) {
    throw new SpecialTeamsCalibrationError(
      'Frozen Special Teams reference is not ready.',
      409,
      {
        missingReferenceSeasonIds: missingSeasonIds,
        targetSeasonId: normalizedTargetSeasonId,
      },
    )
  }

  if (sourceSeasonIds.includes(normalizedTargetSeasonId)) {
    throw new SpecialTeamsCalibrationError(
      'Target-season Special Teams data cannot be used in its own replay.',
      500,
      { sourceSeasonIds, targetSeasonId: normalizedTargetSeasonId },
    )
  }

  const rowsBySeason = sourceDatasets.map(
    (dataset) =>
      new Map(
        (dataset.teams ?? []).map((row) => [
          getNhlTeamIdentity(
            row.teamId,
            row.sourceTeamAbbreviation,
            row.teamName,
          ),
          row,
        ]),
      ),
  )
  const canonicalTargetTeamIds = [
    ...new Set(
      (targetTeamIds ?? [])
        .map((teamId) => getNhlTeamIdentity(teamId))
        .filter(Boolean),
    ),
  ].sort()
  const averageRows = canonicalTargetTeamIds.map((teamId) => {
    const seasonRows = rowsBySeason.map((rows) => rows.get(teamId))
    const powerPlayValues = seasonRows
      .map((row) => Number(row?.rawPowerPlayPercentage))
      .filter(Number.isFinite)
    const penaltyKillValues = seasonRows
      .map((row) => Number(row?.rawPenaltyKillPercentage))
      .filter(Number.isFinite)

    return {
      averagePenaltyKillPercentage:
        penaltyKillValues.length === sourceSeasonIds.length
          ? average(penaltyKillValues)
          : null,
      averagePowerPlayPercentage:
        powerPlayValues.length === sourceSeasonIds.length
          ? average(powerPlayValues)
          : null,
      seasonValues: sourceSeasonIds.map((seasonId, index) => ({
        penaltyKillPercentage:
          seasonRows[index]?.rawPenaltyKillPercentage ?? null,
        powerPlayPercentage:
          seasonRows[index]?.rawPowerPlayPercentage ?? null,
        seasonId,
        sourceTeamAbbreviation:
          seasonRows[index]?.sourceTeamAbbreviation ?? null,
      })),
      teamId,
    }
  })
  const powerPlayRanks = rankSpecialTeamsRows(
    averageRows,
    'averagePowerPlayPercentage',
  )
  const penaltyKillRanks = rankSpecialTeamsRows(
    averageRows,
    'averagePenaltyKillPercentage',
  )
  const teams = averageRows.map((row) => ({
    averagePenaltyKillPercentage: round(
      row.averagePenaltyKillPercentage,
      10,
    ),
    averagePowerPlayPercentage: round(row.averagePowerPlayPercentage, 10),
    penaltyKillLeagueRank: penaltyKillRanks.get(row.teamId) ?? null,
    powerPlayLeagueRank: powerPlayRanks.get(row.teamId) ?? null,
    seasonValues: row.seasonValues,
    teamAbbreviation: row.teamId,
  }))

  return {
    frozenBeforeTargetSeason: true,
    leagueTeamCount: canonicalTargetTeamIds.length,
    methodology: 'frozen_preseason_previous_three_completed_regular_seasons',
    previousThreeSeasonIds: sourceSeasonIds,
    sourceSeasonIds,
    targetSeasonId: normalizedTargetSeasonId,
    targetSeasonIncluded: false,
    teams,
    unavailableTeamIds: teams
      .filter(
        (team) =>
          team.powerPlayLeagueRank === null ||
          team.penaltyKillLeagueRank === null,
      )
      .map((team) => team.teamAbbreviation),
  }
}

const buildMatchupFacts = (games, specialTeamsReference, thresholds) => {
  const factsByThreshold = new Map(
    thresholds.map((threshold) => [threshold, new Map()]),
  )

  ;(games ?? []).forEach((game) => {
    thresholds.forEach((threshold) => {
      factsByThreshold.get(threshold).set(
        game.gameId,
        specialTeamsMatchups.getSpecialTeamsMatchupForTeams({
          awayTeam: game.awayTeamId,
          homeTeam: game.homeTeamId,
          specialTeams: specialTeamsReference,
          threshold,
        }),
      )
    })
  })

  return factsByThreshold
}

const buildStartingRatingState = (teams) =>
  buildStartingState({
    currentRatings: [],
    input: {
      startingRatings: {
        center: BASE_MODEL_V1.startingRatings.center,
        mode: STARTING_MODES.FIXED_SPREAD,
        spread: BASE_MODEL_V1.startingRatings.spread,
      },
    },
    orderingMode: 'historical_fallback',
    teams,
  })

const getSignalAdjustment = (signal, magnitude) => {
  if (magnitude === 0) return 0
  if (signal?.status === POSITIVE) return magnitude
  if (signal?.status === NEGATIVE) return -magnitude
  return 0
}

const createOccurrenceDiagnostics = () => ({
  bothTeamsSignal: 0,
  gamesAffected: 0,
  negativeOccurrences: 0,
  neutralOccurrences: 0,
  positiveOccurrences: 0,
  unavailableOccurrences: 0,
})

const isSignal = (status) => status === POSITIVE || status === NEGATIVE

const addOccurrence = (diagnostics, status) => {
  if (status === POSITIVE) diagnostics.positiveOccurrences += 1
  else if (status === NEGATIVE) diagnostics.negativeOccurrences += 1
  else if (status === NEUTRAL) diagnostics.neutralOccurrences += 1
  else diagnostics.unavailableOccurrences += 1
}

const replaySpecialTeamsSeason = ({
  adjustment,
  factsByGameId,
  games,
  teams,
}) => {
  const ratingState = buildStartingRatingState(teams)
  const engineConfiguration = createRatingEngineConfiguration({
    kFactor: BASE_MODEL_V1.kFactor,
    overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
    regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
    shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  })
  const predictions = []
  const occurrences = createOccurrenceDiagnostics()

  games.forEach((game) => {
    const home = ratingState.get(game.homeTeamId)
    const away = ratingState.get(game.awayTeamId)
    const facts = factsByGameId.get(game.gameId)
    const homeSignal = facts?.home ?? { rankGap: null, status: UNAVAILABLE }
    const awaySignal = facts?.away ?? { rankGap: null, status: UNAVAILABLE }
    const homeAdjustment = getSignalAdjustment(homeSignal, adjustment)
    const awayAdjustment = getSignalAdjustment(awaySignal, adjustment)
    const homeHasSignal = isSignal(homeSignal.status)
    const awayHasSignal = isSignal(awaySignal.status)

    addOccurrence(occurrences, homeSignal.status)
    addOccurrence(occurrences, awaySignal.status)
    if (homeHasSignal || awayHasSignal) occurrences.gamesAffected += 1
    if (homeHasSignal && awayHasSignal) occurrences.bothTeamsSignal += 1

    const probability = calculatePregameProbability({
      automaticAdjustments: {
        away: { total: awayAdjustment },
        home: { total: homeAdjustment },
      },
      awayRating: away.finalRating,
      homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      homeRating: home.finalRating,
      probabilityScale: BASE_MODEL_V1.probabilityScale,
    })
    const winner = game.homeScore > game.awayScore ? WINNERS.HOME : WINNERS.AWAY
    const actualHomeWin = winner === WINNERS.HOME ? 1 : 0

    predictions.push({
      actualHomeWin,
      awayAdjustment,
      awaySignal,
      favoriteConfidence: Math.max(
        probability.homeProbability,
        probability.awayProbability,
      ),
      gameId: game.gameId,
      homeAdjustment,
      homeProbability: probability.homeProbability,
      homeSignal,
      predictedCorrect:
        (probability.homeProbability >= 0.5 && actualHomeWin === 1) ||
        (probability.homeProbability < 0.5 && actualHomeWin === 0),
    })

    const update = calculateRatingUpdate({
      awayExpectedProbability: probability.awayProbability,
      configuration: engineConfiguration,
      homeExpectedProbability: probability.homeProbability,
      resultType: game.resultType,
      winner,
    })

    home.finalRating += update.homeDelta
    away.finalRating += update.awayDelta
    home.gamesProcessed += 1
    away.gamesProcessed += 1
  })

  return {
    metrics: calculateMetrics(predictions),
    occurrences,
    predictions,
    ratingState,
  }
}

const calculateStability = (scores) => {
  if (scores.length < 2) {
    return {
      brierRange: null,
      brierStandardDeviation: null,
      level: 'not_assessed',
    }
  }

  const mean = average(scores)
  const range = Math.max(...scores) - Math.min(...scores)
  const standardDeviation = Math.sqrt(
    average(scores.map((score) => (score - mean) ** 2)),
  )

  return {
    brierRange: round(range),
    brierStandardDeviation: round(standardDeviation),
    level:
      range <= 0.01 && standardDeviation <= 0.005
        ? 'stable'
        : range <= 0.02 && standardDeviation <= 0.01
          ? 'mixed'
          : 'unstable',
  }
}

const aggregateOccurrences = (seasonResults) =>
  seasonResults.reduce((totals, season) => {
    Object.keys(totals).forEach((field) => {
      totals[field] += Number(season.occurrences[field] ?? 0)
    })
    return totals
  }, createOccurrenceDiagnostics())

const buildSignalDiagnostic = (predictions, status) => {
  const samples = []

  predictions.forEach((prediction) => {
    ;[
      {
        actualWin: prediction.actualHomeWin,
        probability: prediction.homeProbability,
        signal: prediction.homeSignal,
      },
      {
        actualWin: 1 - prediction.actualHomeWin,
        probability: 1 - prediction.homeProbability,
        signal: prediction.awaySignal,
      },
    ].forEach((sample) => {
      if (sample.signal.status === status) samples.push(sample)
    })
  })
  const rankGaps = samples
    .map((sample) => Number(sample.signal.rankGap))
    .filter(Number.isFinite)

  return {
    actualWinRate: samples.length
      ? round(average(samples.map((sample) => sample.actualWin)))
      : null,
    averageBaselineExpectedWinProbability: samples.length
      ? round(average(samples.map((sample) => sample.probability)))
      : null,
    averageBrierContribution: samples.length
      ? round(
          average(
            samples.map(
              (sample) => (sample.probability - sample.actualWin) ** 2,
            ),
          ),
        )
      : null,
    occurrences: samples.length,
    rankExtremity: {
      averageRankGap: rankGaps.length ? round(average(rankGaps)) : null,
      maximumRankGap: rankGaps.length ? Math.max(...rankGaps) : null,
      minimumRankGap: rankGaps.length ? Math.min(...rankGaps) : null,
    },
  }
}

const buildComparison = ({ adjustment, replayContexts, threshold }) => {
  const seasonReplays = replayContexts.map((context) => ({
    replay: replaySpecialTeamsSeason({
      adjustment,
      factsByGameId: context.factsByThreshold.get(threshold),
      games: context.games,
      teams: context.teams,
    }),
    seasonId: context.seasonId,
  }))
  const seasonResults = seasonReplays.map(({ replay, seasonId }) => ({
    games: replay.predictions.length,
    gamesAffectedPercentage: replay.predictions.length
      ? round(replay.occurrences.gamesAffected / replay.predictions.length)
      : null,
    metrics: {
      accuracy: replay.metrics.accuracy.rate,
      brierScore: replay.metrics.brierScore,
      expectedCalibrationError: replay.metrics.expectedCalibrationError,
      logLoss: replay.metrics.logLoss,
    },
    occurrences: replay.occurrences,
    seasonId,
  }))
  const predictions = seasonReplays.flatMap(({ replay }) => replay.predictions)
  const metrics = calculateMetrics(predictions)
  const occurrences = aggregateOccurrences(seasonResults)
  const seasonBrierScores = seasonResults.map(
    (season) => season.metrics.brierScore,
  )
  const worstSeason = [...seasonResults].sort(
    (left, right) => right.metrics.brierScore - left.metrics.brierScore,
  )[0]

  return {
    adjustment,
    averageSeasonBrier: round(average(seasonBrierScores)),
    games: predictions.length,
    gamesAffectedPercentage: predictions.length
      ? round(occurrences.gamesAffected / predictions.length)
      : null,
    metrics: {
      accuracy: metrics.accuracy.rate,
      brierScore: metrics.brierScore,
      expectedCalibrationError: metrics.expectedCalibrationError,
      logLoss: metrics.logLoss,
    },
    occurrences,
    predictions,
    seasonResults,
    stability: calculateStability(seasonBrierScores),
    threshold,
    worstSeason: worstSeason
      ? {
          brierScore: worstSeason.metrics.brierScore,
          seasonId: worstSeason.seasonId,
        }
      : null,
  }
}

const applyBaselineDeltas = (comparison, baseline) => {
  comparison.delta = {
    brierScore: round(
      comparison.metrics.brierScore - baseline.metrics.brierScore,
    ),
    logLoss: round(comparison.metrics.logLoss - baseline.metrics.logLoss),
  }
  comparison.seasonResults.forEach((season) => {
    const baselineSeason = baseline.seasonResults.find(
      (candidate) => candidate.seasonId === season.seasonId,
    )
    season.delta = {
      brierScore: round(
        season.metrics.brierScore - baselineSeason.metrics.brierScore,
      ),
      logLoss: round(
        season.metrics.logLoss - baselineSeason.metrics.logLoss,
      ),
    }
  })
  comparison.seasonsBeatingBaseline = comparison.seasonResults.filter(
    (season) => season.delta.brierScore < 0,
  ).length

  return comparison
}

const normalizeRunPayload = (payload = {}) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SpecialTeamsCalibrationError(
      'Request body must be an object.',
      400,
    )
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => !['customThreshold', 'seasonIds'].includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new SpecialTeamsCalibrationError(
      'Request contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  const seasonIds = [
    ...new Set(
      (payload.seasonIds ?? TARGET_SEASON_IDS).map((seasonId) =>
        normalizeSeasonId(seasonId),
      ),
    ),
  ]

  if (
    seasonIds.length === 0 ||
    seasonIds.some((seasonId) => !TARGET_SEASON_IDS.includes(seasonId))
  ) {
    throw new SpecialTeamsCalibrationError(
      'Select at least one supported Phase 4 target season.',
      400,
      { field: 'seasonIds' },
    )
  }

  let customThreshold = null

  if (
    payload.customThreshold !== undefined &&
    payload.customThreshold !== null &&
    payload.customThreshold !== ''
  ) {
    customThreshold = Number(payload.customThreshold)

    if (
      !Number.isInteger(customThreshold) ||
      customThreshold < CUSTOM_THRESHOLD_LIMITS.min ||
      customThreshold > CUSTOM_THRESHOLD_LIMITS.max
    ) {
      throw new SpecialTeamsCalibrationError(
        `customThreshold must be an integer between ${CUSTOM_THRESHOLD_LIMITS.min} and ${CUSTOM_THRESHOLD_LIMITS.max}.`,
        400,
        { field: 'customThreshold' },
      )
    }
  }

  const thresholds = [...new Set([
    ...STANDARD_THRESHOLDS,
    ...(customThreshold === null ? [] : [customThreshold]),
  ])].sort((left, right) => left - right)

  return { customThreshold, seasonIds, thresholds }
}

const loadReplayContexts = async (seasonIds, thresholds, options = {}) => {
  const targetDefinitions = seasonIds.map((seasonId) =>
    getSeasonDefinition(seasonId, { targetOnly: true }),
  )
  const referenceSeasonIds = getRequiredReferenceSeasonIds(seasonIds)
  const [preparedGames, specialTeamsDatasets, seedTeams] = await Promise.all([
    (options.historicalGamesLoader ?? historicalNhlDataService.loadPreparedSeasons)(
      seasonIds,
      { repository: options.historicalRepository },
    ),
    (
      options.specialTeamsLoader ??
      historicalSpecialTeamsDataService.loadPreparedSpecialTeamsSeasons
    )(referenceSeasonIds, {
      repository: options.specialTeamsRepository,
    }),
    (options.teamsProvider ?? getSeedTeams)(),
  ])
  const missingGameSeasonIds = seasonIds.filter(
    (seasonId) =>
      preparedGames.datasetsBySeason.get(seasonId)?.status !== 'ready',
  )
  const missingReferenceSeasonIds = referenceSeasonIds.filter(
    (seasonId) => specialTeamsDatasets.get(seasonId)?.status !== 'ready',
  )

  if (missingGameSeasonIds.length || missingReferenceSeasonIds.length) {
    throw new SpecialTeamsCalibrationError(
      'Phase 4 historical inputs are not ready.',
      409,
      { missingGameSeasonIds, missingReferenceSeasonIds },
    )
  }

  const teams = seedTeams.map(normalizeTeam).filter(Boolean)
  const replayContexts = targetDefinitions.map((season) => {
    const prepared = preparePhase3ReplayGames(
      preparedGames.gamesBySeason.get(season.id) ?? [],
      season.id,
      teams,
    )
    const targetTeamIds = [
      ...new Set(
        prepared.games.flatMap((game) => [
          game.homeTeamId,
          game.awayTeamId,
        ]),
      ),
    ]
    const specialTeamsReference = buildFrozenSpecialTeamsReference({
      seasonDatasets: specialTeamsDatasets,
      targetSeasonId: season.id,
      targetTeamIds,
    })

    if (prepared.games.length === 0) {
      throw new SpecialTeamsCalibrationError(
        `No eligible historical games were available for ${season.id}.`,
        409,
        { seasonId: season.id },
      )
    }

    return {
      factsByThreshold: buildMatchupFacts(
        prepared.games,
        specialTeamsReference,
        thresholds,
      ),
      games: prepared.games,
      historicalEligibility: prepared.eligibility,
      seasonId: season.id,
      specialTeamsReference,
      teams,
    }
  })

  return { replayContexts, referenceSeasonIds }
}

const getSpecialTeamsCalibrationOptions = async (userId, options = {}) => {
  if (!userId) {
    throw new SpecialTeamsCalibrationError(
      'Authenticated userId is required.',
      401,
    )
  }

  const targetDefinitions = TARGET_SEASON_IDS.map((seasonId) =>
    getSeasonDefinition(seasonId, { targetOnly: true }),
  )
  const referenceSeasonIds = getRequiredReferenceSeasonIds()
  const [gameStatuses, specialTeamsStatuses] = await Promise.all([
    (
      options.historicalStatusProvider ??
      historicalNhlDataService.getHistoricalSeasonStatuses
    )(targetDefinitions, { repository: options.historicalRepository }),
    (
      options.specialTeamsStatusProvider ??
      historicalSpecialTeamsDataService.getHistoricalSpecialTeamsStatuses
    )(referenceSeasonIds, { repository: options.specialTeamsRepository }),
  ])
  const gameStatusById = new Map(
    gameStatuses.map((status) => [status.seasonId, status]),
  )
  const specialTeamsStatusById = new Map(
    specialTeamsStatuses.map((status) => [status.seasonId, status]),
  )

  return {
    adjustmentOptions: STANDARD_ADJUSTMENTS,
    baseline: {
      baseHomeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      contextualLayers: {
        injuries: false,
        quickRematch: false,
        restFatigue: false,
        teamHomeAdvantage: false,
      },
      kFactor: BASE_MODEL_V1.kFactor,
      modelVersion: BASE_MODEL_V1.modelVersion,
      name: 'Base Model v1 only',
      overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
      probabilityScale: BASE_MODEL_V1.probabilityScale,
      regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
      shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
      startingRatings: BASE_MODEL_V1.startingRatings,
    },
    customThresholdLimits: CUSTOM_THRESHOLD_LIMITS,
    defaultSeasonIds: TARGET_SEASON_IDS,
    isolation: {
      historicalGameSource:
        'HistoricalNhlGame / HistoricalSeasonDataset',
      historicalSpecialTeamsSource: 'HistoricalSpecialTeamsSeason',
      productionProbabilityWrites: false,
      productionRatingWrites: false,
      productionSettingsRead: false,
      productionSettingsWrites: false,
      providerCallsDuringPreparedReplay: false,
    },
    methodology: {
      bothTeamsEvaluatedIndependently: true,
      frozenPreseason: true,
      rankingWindow: 3,
      targetSeasonDataIncluded: false,
    },
    referenceSeasons: referenceSeasonIds.map((seasonId) => ({
      ...getSeasonDefinition(seasonId),
      specialTeamsDataset:
        specialTeamsStatusById.get(seasonId) ??
        historicalSpecialTeamsDataService.makeDatasetStatus(null, seasonId),
    })),
    seasons: targetDefinitions.map((season) => {
      const sourceSeasonIds = getPriorSeasonIds(season.id)
      const missingReferenceSeasonIds = sourceSeasonIds.filter(
        (seasonId) =>
          specialTeamsStatusById.get(seasonId)?.status !== 'ready',
      )
      const historicalDataset =
        gameStatusById.get(season.id) ??
        historicalNhlDataService.makeDatasetStatus(null, season)

      return {
        ...season,
        eligibleForMainComparison:
          historicalDataset.status === 'ready' &&
          missingReferenceSeasonIds.length === 0,
        historicalDataset,
        specialTeamsReference: {
          complete: missingReferenceSeasonIds.length === 0,
          missingSeasonIds: missingReferenceSeasonIds,
          partialAllowedInMainComparison: false,
          sourceSeasonIds,
        },
      }
    }),
    standardCombinationCount:
      STANDARD_THRESHOLDS.length * STANDARD_ADJUSTMENTS.length,
    thresholdOptions: STANDARD_THRESHOLDS,
  }
}

const runSpecialTeamsCalibration = async (userId, payload, options = {}) => {
  if (!userId) {
    throw new SpecialTeamsCalibrationError(
      'Authenticated userId is required.',
      401,
    )
  }

  const input = normalizeRunPayload(payload)
  const { replayContexts, referenceSeasonIds } = await loadReplayContexts(
    input.seasonIds,
    input.thresholds,
    options,
  )
  const comparisons = input.thresholds.flatMap((threshold) =>
    STANDARD_ADJUSTMENTS.map((adjustment) =>
      buildComparison({ adjustment, replayContexts, threshold }),
    ),
  )
  const baseline = comparisons.find(
    (comparison) =>
      comparison.threshold === input.thresholds[0] &&
      comparison.adjustment === 0,
  )

  comparisons.forEach((comparison) => {
    applyBaselineDeltas(comparison, baseline)
  })
  const rankedComparisons = [...comparisons].sort(
    (left, right) =>
      left.metrics.brierScore - right.metrics.brierScore ||
      Math.abs(left.adjustment) - Math.abs(right.adjustment) ||
      left.threshold - right.threshold,
  )
  rankedComparisons.forEach((comparison, index) => {
    comparison.best = index === 0
    comparison.rank = index + 1
  })
  const thresholdSummary = input.thresholds.map((threshold) => {
    const thresholdComparisons = comparisons.filter(
      (comparison) => comparison.threshold === threshold,
    )
    const thresholdControl = thresholdComparisons.find(
      (comparison) => comparison.adjustment === 0,
    )
    const best = [...thresholdComparisons].sort(
      (left, right) =>
        left.metrics.brierScore - right.metrics.brierScore ||
        Math.abs(left.adjustment) - Math.abs(right.adjustment),
    )[0]

    return {
      bestPooledBrier: best.metrics.brierScore,
      bestTestedAdjustment: best.adjustment,
      gamesAffectedPercentage: thresholdControl.gamesAffectedPercentage,
      occurrences: thresholdControl.occurrences,
      seasonsBeatingBaseline: best.seasonsBeatingBaseline,
      signalDiagnostics: {
        negative: buildSignalDiagnostic(
          thresholdControl.predictions,
          NEGATIVE,
        ),
        positive: buildSignalDiagnostic(
          thresholdControl.predictions,
          POSITIVE,
        ),
      },
      threshold,
      totalSignalOccurrences:
        thresholdControl.occurrences.positiveOccurrences +
        thresholdControl.occurrences.negativeOccurrences,
    }
  })
  const publicComparisons = comparisons.map(
    ({ predictions: _predictions, ...comparison }) => comparison,
  )
  const best = publicComparisons.find((comparison) => comparison.best)

  return {
    adjustmentOptions: STANDARD_ADJUSTMENTS,
    baseline: {
      metrics: baseline.metrics,
      model: 'Base Model v1 only',
      seasonResults: baseline.seasonResults,
    },
    bestTestedResult: {
      adjustment: best.adjustment,
      brierDelta: best.delta.brierScore,
      pooledBrier: best.metrics.brierScore,
      seasonsBeatingBaseline: best.seasonsBeatingBaseline,
      threshold: best.threshold,
    },
    comparisons: publicComparisons,
    diagnostics: {
      bothTeamsEvaluatedIndependently: true,
      historicalEligibility: replayContexts.map((context) => ({
        ...context.historicalEligibility,
        seasonId: context.seasonId,
      })),
      historicalSpecialTeamsLoadedOnce: true,
      productionMatchupUtility: 'shared/specialTeamsMatchups.js',
      productionWrites: false,
      providerCallsDuringReplay: false,
      ratingResetBetweenSeasons: true,
      referenceSeasonIds,
      selectedSeasonIds: input.seasonIds,
      targetSeasonDataIncludedInReference: false,
    },
    experimental: true,
    modelVersion: BASE_MODEL_V1.modelVersion,
    rankingAudit: replayContexts.map((context) =>
      context.specialTeamsReference,
    ),
    standardCombinationCount:
      STANDARD_THRESHOLDS.length * STANDARD_ADJUSTMENTS.length,
    testedCombinationCount: comparisons.length,
    thresholdSummary,
    thresholds: input.thresholds,
  }
}

const prepareSpecialTeamsCalibrationGameSeason = async (
  userId,
  seasonId,
  payload,
  options = {},
) => {
  if (!userId) {
    throw new SpecialTeamsCalibrationError(
      'Authenticated userId is required.',
      401,
    )
  }

  const season = getSeasonDefinition(seasonId, { targetOnly: true })

  return (
    options.prepareProvider ?? historicalNhlDataService.prepareHistoricalSeason
  )(season.id, payload, { ...options, season })
}

const prepareSpecialTeamsReferenceSeason = async (
  userId,
  seasonId,
  payload,
  options = {},
) => {
  if (!userId) {
    throw new SpecialTeamsCalibrationError(
      'Authenticated userId is required.',
      401,
    )
  }

  const normalizedId = normalizeSeasonId(seasonId)

  if (!getRequiredReferenceSeasonIds().includes(normalizedId)) {
    throw new SpecialTeamsCalibrationError(
      'Season is not required by the Phase 4 frozen ranking windows.',
      400,
      { seasonId: normalizedId || seasonId },
    )
  }

  return (
    options.prepareProvider ??
    historicalSpecialTeamsDataService.prepareHistoricalSpecialTeamsSeason
  )(normalizedId, payload, options)
}

module.exports = {
  CUSTOM_THRESHOLD_LIMITS,
  STANDARD_ADJUSTMENTS,
  STANDARD_THRESHOLDS,
  SpecialTeamsCalibrationError,
  TARGET_SEASON_IDS,
  applyBaselineDeltas,
  buildComparison,
  buildFrozenSpecialTeamsReference,
  buildMatchupFacts,
  buildSignalDiagnostic,
  getPriorSeasonIds,
  getRequiredReferenceSeasonIds,
  getSignalAdjustment,
  getSpecialTeamsCalibrationOptions,
  loadReplayContexts,
  normalizeRunPayload,
  prepareSpecialTeamsCalibrationGameSeason,
  prepareSpecialTeamsReferenceSeason,
  rankSpecialTeamsRows,
  replaySpecialTeamsSeason,
  runSpecialTeamsCalibration,
}
