const {
  calculateMetrics,
} = require('../services/baseModelCalibrationService')
const {
  getTierHomeAdvantageAdjustment,
} = require('../services/homeAdvantageCalibrationService')
const {
  getScheduleReplayAdjustments,
} = require('../services/scheduleCalibrationService')
const {
  getSignalAdjustment,
} = require('../services/specialTeamsCalibrationService')
const {
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
  createRatingEngineConfiguration,
} = require('../services/powerRatingEngine')
const {
  SPECIAL_TEAMS_MATCHUP_STATUSES,
} = require('../../shared/specialTeamsMatchups')

const cloneStartingState = (teamStates) =>
  new Map(
    teamStates.map((team) => [
      team.teamId,
      {
        ...team,
        finalRating: team.startingRating,
        gamesProcessed: 0,
      },
    ]),
  )

const toAdjustmentMap = (adjustments) =>
  new Map(
    (Array.isArray(adjustments) ? adjustments : []).map((entry) => [
      entry.teamId,
      Number(entry.adjustment) || 0,
    ]),
  )

const getHomeAdvantage = ({
  configuration,
  game,
  homeAdjustmentMap,
  seasonContext,
}) => {
  const feature = configuration.features.teamHomeAdvantage
  const baseHomeAdvantage = configuration.model.baseHomeAdvantage

  if (feature.enabled !== true) {
    return {
      adjustment: 0,
      effectiveHomeAdvantage: baseHomeAdvantage,
      mode: 'disabled',
      tier: null,
    }
  }

  if (feature.mode === 'tier') {
    const tier = seasonContext.homeAdvantageSnapshot?.tiers?.[game.homeTeamId]
    const adjustment = getTierHomeAdvantageAdjustment(
      tier,
      Number(feature.adjustment) || 0,
    )

    return {
      adjustment,
      effectiveHomeAdvantage: baseHomeAdvantage + adjustment,
      mode: 'tier',
      tier: tier ?? null,
    }
  }

  const adjustment = homeAdjustmentMap.get(game.homeTeamId) ?? 0

  return {
    adjustment,
    effectiveHomeAdvantage: baseHomeAdvantage + adjustment,
    mode: 'team_map',
    tier: null,
  }
}

const getSpecialTeamsAdjustments = ({ configuration, game, seasonContext }) => {
  const feature = configuration.features.specialTeams
  const neutral = {
    awayAdjustment: 0,
    awaySignal: null,
    homeAdjustment: 0,
    homeSignal: null,
  }

  if (
    feature.enabled !== true ||
    feature.automaticAdjustmentEnabled !== true
  ) {
    return neutral
  }

  const facts = seasonContext.specialTeamsFactsByThreshold
    ?.get(feature.topBottomN)
    ?.get(game.gameId)
  const awaySignal = facts?.away ?? null
  const homeSignal = facts?.home ?? null

  return {
    awayAdjustment: getSignalAdjustment(
      awaySignal,
      feature.adjustmentMagnitude,
    ),
    awaySignal,
    homeAdjustment: getSignalAdjustment(
      homeSignal,
      feature.adjustmentMagnitude,
    ),
    homeSignal,
  }
}

const createDiagnostics = () => ({
  quickRematch: { gamesAffected: new Set(), occurrences: 0 },
  restFatigue: {
    appliedConditions: {
      '3_games_in_4_days': 0,
      back_to_back: 0,
      back_to_back_travel: 0,
      normal: 0,
      well_rested: 0,
    },
  },
  specialTeams: {
    gamesAffected: 0,
    negativeOccurrences: 0,
    neutralOccurrences: 0,
    positiveOccurrences: 0,
    unavailableOccurrences: 0,
  },
  teamHomeAdvantage: {
    gamesAffected: 0,
    mode: null,
  },
})

const addSpecialTeamsOccurrence = (diagnostics, signal) => {
  const status = signal?.status

  if (status === SPECIAL_TEAMS_MATCHUP_STATUSES.POSITIVE) {
    diagnostics.positiveOccurrences += 1
  } else if (status === SPECIAL_TEAMS_MATCHUP_STATUSES.NEGATIVE) {
    diagnostics.negativeOccurrences += 1
  } else if (status === SPECIAL_TEAMS_MATCHUP_STATUSES.NEUTRAL) {
    diagnostics.neutralOccurrences += 1
  } else {
    diagnostics.unavailableOccurrences += 1
  }
}

const serializeDiagnostics = (diagnostics) => ({
  quickRematch: {
    gamesAffected: diagnostics.quickRematch.gamesAffected.size,
    occurrences: diagnostics.quickRematch.occurrences,
  },
  restFatigue: diagnostics.restFatigue,
  specialTeams: diagnostics.specialTeams,
  teamHomeAdvantage: diagnostics.teamHomeAdvantage,
})

const replayCalibrationSeason = ({
  configuration,
  seasonContext,
  startingState,
}) => {
  const ratingState = cloneStartingState(startingState)
  const engineConfiguration = createRatingEngineConfiguration({
    kFactor: configuration.model.kFactor,
    overtimeMultiplier: configuration.model.overtimeMultiplier,
    regulationMultiplier: configuration.model.regulationMultiplier,
    shootoutMultiplier: configuration.model.shootoutMultiplier,
  })
  const predictions = []
  const diagnostics = createDiagnostics()
  const homeAdjustmentMap = toAdjustmentMap(
    configuration.features.teamHomeAdvantage.adjustments,
  )

  seasonContext.games.forEach((game) => {
    const home = ratingState.get(game.homeTeamId)
    const away = ratingState.get(game.awayTeamId)

    if (!home || !away) {
      throw new TypeError(
        `Frozen starting state is missing a team for game ${game.gameId}.`,
      )
    }

    const schedule = getScheduleReplayAdjustments({
      configuration: {
        quickRematch: configuration.features.quickRematch,
        restFatigue: configuration.features.restFatigue,
      },
      facts: seasonContext.scheduleFacts.get(game.gameId),
    })
    const specialTeams = getSpecialTeamsAdjustments({
      configuration,
      game,
      seasonContext,
    })
    const homeAdvantage = getHomeAdvantage({
      configuration,
      game,
      homeAdjustmentMap,
      seasonContext,
    })
    const homeAdjustment =
      schedule.homeAdjustment + specialTeams.homeAdjustment
    const awayAdjustment =
      schedule.awayAdjustment + specialTeams.awayAdjustment
    const probability = calculatePregameProbability({
      automaticAdjustments: {
        away: { total: awayAdjustment },
        home: { total: homeAdjustment },
      },
      awayRating: away.finalRating,
      homeAdvantage: homeAdvantage.effectiveHomeAdvantage,
      homeRating: home.finalRating,
      probabilityScale: configuration.model.probabilityScale,
    })
    const winner = game.homeScore > game.awayScore
      ? WINNERS.HOME
      : WINNERS.AWAY
    const actualHomeWin = winner === WINNERS.HOME ? 1 : 0

    predictions.push({
      actualHomeWin,
      awayAdjustment,
      awayTeamId: game.awayTeamId,
      favoriteConfidence: Math.max(
        probability.homeProbability,
        probability.awayProbability,
      ),
      gameDate: game.gameDate,
      gameId: game.gameId,
      homeAdjustment,
      homeProbability: probability.homeProbability,
      homeTeamId: game.homeTeamId,
      predictedCorrect:
        (probability.homeProbability >= 0.5 && actualHomeWin === 1) ||
        (probability.homeProbability < 0.5 && actualHomeWin === 0),
      resultType: game.resultType,
      seasonId: seasonContext.seasonId,
      timestamp: game.timestamp,
    })

    ;[schedule.homeAppliedCondition, schedule.awayAppliedCondition].forEach(
      (condition) => {
        diagnostics.restFatigue.appliedConditions[condition] += 1
      },
    )
    ;[
      schedule.homeQuickRematchEligible,
      schedule.awayQuickRematchEligible,
    ].forEach((eligible) => {
      if (eligible) {
        diagnostics.quickRematch.occurrences += 1
        diagnostics.quickRematch.gamesAffected.add(game.gameId)
      }
    })
    addSpecialTeamsOccurrence(
      diagnostics.specialTeams,
      specialTeams.homeSignal,
    )
    addSpecialTeamsOccurrence(
      diagnostics.specialTeams,
      specialTeams.awaySignal,
    )
    if (specialTeams.homeAdjustment !== 0 || specialTeams.awayAdjustment !== 0) {
      diagnostics.specialTeams.gamesAffected += 1
    }
    diagnostics.teamHomeAdvantage.mode = homeAdvantage.mode
    if (homeAdvantage.adjustment !== 0) {
      diagnostics.teamHomeAdvantage.gamesAffected += 1
    }

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
    diagnostics: serializeDiagnostics(diagnostics),
    metrics: calculateMetrics(predictions),
    predictions,
    ratingState,
  }
}

const toNormalizedMetrics = (metrics, perSeason) => ({
  accuracy: metrics.accuracy.rate,
  averageSeasonBrier:
    perSeason.reduce((sum, season) => sum + season.brier, 0) /
    perSeason.length,
  ece: metrics.expectedCalibrationError,
  logLoss: metrics.logLoss,
  pooledBrier: metrics.brierScore,
  worstSeasonBrier: Math.max(...perSeason.map((season) => season.brier)),
})

const replayCalibrationRun = ({
  configuration,
  seasonContexts,
  startingStateIdentity,
}) => {
  const startingStatesBySeason = new Map(
    startingStateIdentity.seasons.map((season) => [season.seasonId, season.teams]),
  )
  const seasonResults = seasonContexts.map((seasonContext) => {
    const result = replayCalibrationSeason({
      configuration,
      seasonContext,
      startingState: startingStatesBySeason.get(seasonContext.seasonId),
    })

    return {
      ...result,
      seasonId: seasonContext.seasonId,
    }
  })
  const predictions = seasonResults.flatMap((season) => season.predictions)
  const pooledMetrics = calculateMetrics(predictions)
  const perSeason = seasonResults.map((season) => ({
    accuracy: season.metrics.accuracy.rate,
    brier: season.metrics.brierScore,
    ece: season.metrics.expectedCalibrationError,
    games: season.predictions.length,
    logLoss: season.metrics.logLoss,
    seasonId: season.seasonId,
  }))

  return {
    diagnostics: {
      chronological: true,
      resultTypes: Object.fromEntries(
        predictions.reduce((counts, prediction) => {
          counts.set(
            prediction.resultType,
            (counts.get(prediction.resultType) ?? 0) + 1,
          )
          return counts
        }, new Map()),
      ),
      seasons: Object.fromEntries(
        seasonResults.map((season) => [season.seasonId, season.diagnostics]),
      ),
    },
    metrics: toNormalizedMetrics(pooledMetrics, perSeason),
    perSeason,
    predictions,
  }
}

module.exports = {
  replayCalibrationRun,
  replayCalibrationSeason,
}
