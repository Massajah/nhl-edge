const historicalNhlDataService = require('./historicalNhlDataService')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const { FALLBACK_SEASONS, getSeasonLabel } = require('./nhlSeasonService')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const { getSeedTeams } = require('./powerRatingsService')
const {
  STARTING_MODES,
  buildStartingState,
  calculateMetrics,
  prepareDataset,
} = require('./baseModelCalibrationService')
const {
  REST_FATIGUE_ADJUSTMENTS,
  REST_FATIGUE_PRECEDENCE,
  buildQuickRematchContext,
  calculateGameContextForGame,
  normalizeGame,
} = require('./gameContextRules')
const {
  DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS,
  DEFAULT_QUICK_REMATCH_SETTINGS,
  getQuickRematchSettings,
} = require('./quickRematchSettingsService')
const {
  WINNERS,
  classifyCompletedGameResult,
  calculatePregameProbability,
  calculateRatingUpdate,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')

const DEFAULT_SEASON_IDS = Object.freeze([
  '20232024',
  '20242025',
  '20252026',
])
const RULE_IDS = Object.freeze({
  BACK_TO_BACK: 'back_to_back',
  BACK_TO_BACK_TRAVEL: 'back_to_back_travel',
  THREE_IN_FOUR: '3_games_in_4_days',
  WELL_RESTED: 'well_rested',
})
const RULE_ORDER = Object.freeze([
  RULE_IDS.BACK_TO_BACK_TRAVEL,
  RULE_IDS.BACK_TO_BACK,
  RULE_IDS.THREE_IN_FOUR,
  RULE_IDS.WELL_RESTED,
])
const PRIMARY_RULE_IDS = Object.freeze([
  RULE_IDS.THREE_IN_FOUR,
  RULE_IDS.BACK_TO_BACK,
  RULE_IDS.BACK_TO_BACK_TRAVEL,
])
const OPTIONAL_RULE_IDS = Object.freeze([RULE_IDS.WELL_RESTED])
const QUICK_REMATCH_WINDOWS = Object.freeze([3, 5, 7, 10, 14])
const QUICK_REMATCH_ADJUSTMENTS = Object.freeze([0, 0.1, 0.25, 0.5])
const MAX_CUSTOM_QUICK_REMATCH_WINDOW = 30
const MAX_CUSTOM_QUICK_REMATCH_ADJUSTMENT = 1
const RULES = Object.freeze([
  Object.freeze({
    definition:
      'Two or more rest days before the current game. A season-opening game with no prior game in the loaded season is not classified as Well Rested.',
    id: RULE_IDS.WELL_RESTED,
    label: 'Well Rested',
    presetValues: Object.freeze([0, 0.1, 0.25, 0.5, 0.75]),
    productionValue: REST_FATIGUE_ADJUSTMENTS.wellRested,
  }),
  Object.freeze({
    definition:
      'The team\'s third game inside the production four-day rolling window (start-exclusive, end-inclusive).',
    id: RULE_IDS.THREE_IN_FOUR,
    label: '3 Games in 4 Days',
    presetValues: Object.freeze([0, -0.25, -0.5, -0.75, -1]),
    productionValue: REST_FATIGUE_ADJUSTMENTS.threeInFour,
  }),
  Object.freeze({
    definition:
      'Consecutive UTC calendar-day games where both games are home games, or both games are away against the same home team.',
    id: RULE_IDS.BACK_TO_BACK,
    label: 'Back-to-Back',
    presetValues: Object.freeze([0, -0.25, -0.5, -0.75, -1, -1.25]),
    productionValue: REST_FATIGUE_ADJUSTMENTS.backToBack,
  }),
  Object.freeze({
    definition:
      'All other known consecutive UTC calendar-day transitions: home-to-away, away-to-home, or away-to-away against different home teams.',
    id: RULE_IDS.BACK_TO_BACK_TRAVEL,
    label: 'Back-to-Back + Travel',
    presetValues: Object.freeze([
      0,
      -0.5,
      -1,
      -1.5,
      -2,
      -2.5,
      -3,
      -3.5,
      -4,
      -4.5,
      -5,
    ]),
    productionValue: REST_FATIGUE_ADJUSTMENTS.backToBackTravel,
  }),
])
const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]))
const MIN_CUSTOM_ADJUSTMENT = -6
const MAX_CUSTOM_ADJUSTMENT = 3
// Retained for older Rating Lab clients that expect the former symmetric option.
const MAX_ABSOLUTE_CUSTOM_ADJUSTMENT = 3

class ScheduleCalibrationError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'ScheduleCalibrationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const round = (value, decimals = 8) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const getSeasonDefinition = (seasonId) => {
  const normalizedId = normalizeSeasonId(seasonId)
  const season = FALLBACK_SEASONS.find((candidate) => candidate.id === normalizedId)

  if (!season || !DEFAULT_SEASON_IDS.includes(normalizedId)) {
    throw new ScheduleCalibrationError(
      'Season is not part of the Phase 3A calibration window.',
      400,
      { seasonId: normalizedId || seasonId },
    )
  }

  return {
    endDate: season.endDate,
    expectedApproximateGames: 1312,
    id: normalizedId,
    label: getSeasonLabel(normalizedId),
    startDate: season.startDate,
  }
}

const getSeasonDefinitions = () => DEFAULT_SEASON_IDS.map(getSeasonDefinition)

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

const getHistoricalGameSeasonId = (game = {}) =>
  normalizeSeasonId(game.seasonId ?? String(game.season ?? ''))

const getHistoricalGameTeamId = (game, side) =>
  getNhlTeamIdentity(
    game?.[`${side}TeamId`],
    game?.[`${side}TeamAbbreviation`],
    game?.[`${side}Team`]?.abbrev,
    game?.[`${side}Team`]?.abbreviation,
    game?.[`${side}Team`]?.name,
  )

const buildHistoricalTeamDirectory = (teams) => {
  const teamsById = new Map()

  teams.forEach((team) => {
    ;[team.teamId, team.abbreviation].filter(Boolean).forEach((identifier) => {
      teamsById.set(identifier, team)
    })
  })

  return teamsById
}

const buildHistoricalEligibilityDiagnostics = ({
  baseDataset,
  loadedGames,
  seasonId,
  seasonMatchedGames,
  teamsById,
}) => {
  const regularSeasonGames = seasonMatchedGames.filter(
    (game) => Number(game?.gameType) === 2,
  )
  const completedGames = regularSeasonGames.filter((game) =>
    ['FINAL', 'OFF'].includes(String(game?.gameState ?? '').trim().toUpperCase()),
  )
  const validTeamGames = completedGames.filter(
    (game) =>
      teamsById.has(getHistoricalGameTeamId(game, 'home')) &&
      teamsById.has(getHistoricalGameTeamId(game, 'away')),
  )
  const validResultGames = validTeamGames.filter(
    (game) => classifyCompletedGameResult(game).isResolved,
  )

  return {
    completed: completedGames.length,
    eligible: baseDataset.summary.gamesIncluded,
    loaded: loadedGames.length,
    regularSeason: regularSeasonGames.length,
    seasonId,
    seasonMatched: seasonMatchedGames.length,
    skipReasons: baseDataset.skipReasons,
    skipped: baseDataset.summary.gamesSkipped,
    validResult: validResultGames.length,
    validTeamIdentity: validTeamGames.length,
  }
}

const toScheduleReplayGame = ({ awayTeam, game, homeTeam, resultType }, seasonId) => {
  const timestamp = Date.parse(game?.startTimeUTC ?? game?.gameDate ?? '')
  const startTimeUTC = new Date(timestamp).toISOString()
  const homeScore = Number(game?.homeScore ?? game?.homeTeam?.score)
  const awayScore = Number(game?.awayScore ?? game?.awayTeam?.score)

  return {
    awayScore,
    awayTeam: {
      abbreviation: awayTeam.abbreviation,
      name: awayTeam.teamName,
      score: awayScore,
      teamId: awayTeam.teamId,
    },
    awayTeamId: awayTeam.teamId,
    gameDate: String(
      game?.__replayScheduleDate ??
      game?.gameDate ??
      startTimeUTC.slice(0, 10),
    ),
    gameId: String(game?.id ?? game?.gameId ?? ''),
    gameState: String(game?.gameState ?? 'FINAL').trim().toUpperCase(),
    gameType: 2,
    homeScore,
    homeTeam: {
      abbreviation: homeTeam.abbreviation,
      name: homeTeam.teamName,
      score: homeScore,
      teamId: homeTeam.teamId,
    },
    homeTeamId: homeTeam.teamId,
    resultType,
    seasonId,
    startTimeUTC,
    timestamp,
  }
}

const preparePhase3ReplayGames = (games, seasonId, teams) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)
  const season = getSeasonDefinition(normalizedSeasonId)
  const loadedGames = Array.isArray(games) ? games : []
  const seasonMatchedGames = loadedGames.filter(
    (game) => getHistoricalGameSeasonId(game) === normalizedSeasonId,
  )
  const teamsById = buildHistoricalTeamDirectory(teams)
  const baseDataset = prepareDataset({
    games: seasonMatchedGames,
    input: {
      dateFrom: season.startDate,
      dateFromTimestamp: Date.parse(`${season.startDate}T00:00:00.000Z`),
      dateTo: season.endDate,
      dateToTimestamp: Date.parse(`${season.endDate}T00:00:00.000Z`),
      seasonId: normalizedSeasonId,
    },
    teamsById,
  })
  const replayGames = baseDataset.includedGames
    .map((game) => toScheduleReplayGame(game, normalizedSeasonId))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.gameId.localeCompare(right.gameId),
    )

  return {
    eligibility: buildHistoricalEligibilityDiagnostics({
      baseDataset,
      loadedGames,
      seasonId: normalizedSeasonId,
      seasonMatchedGames,
      teamsById,
    }),
    games: replayGames,
  }
}

const buildReplayGames = (games, seasonId, teams) =>
  preparePhase3ReplayGames(games, seasonId, teams).games

const buildScheduleFacts = (
  games,
  quickRematchWindows = QUICK_REMATCH_WINDOWS,
) => {
  const factsByGameId = new Map()
  const normalizedScheduleGames = games.map(normalizeGame)
  const normalizedGamesById = new Map(
    normalizedScheduleGames.map((game) => [game.gameId, game]),
  )
  const detectionSettings = {
    ...DEFAULT_QUICK_REMATCH_SETTINGS,
    quickRematchEnabled: false,
    restFatigueEnabled: true,
  }

  games.forEach((game) => {
    const context = calculateGameContextForGame({
      awayScheduleGames: games,
      currentGame: game,
      homeScheduleGames: games,
      now: new Date(game.timestamp),
      quickRematchSettings: detectionSettings,
    })

    const quickRematchByWindow = Object.fromEntries(
      quickRematchWindows.map((windowDays) => {
        const settings = {
          ...DEFAULT_QUICK_REMATCH_SETTINGS,
          quickRematchEnabled: true,
          quickRematchLoserAdjustment: 1,
          quickRematchMaximumDays: windowDays,
          restFatigueEnabled: false,
        }
        const currentGame = {
          ...normalizedGamesById.get(game.gameId),
          gameState: 'FUT',
        }
        const now = new Date(currentGame.scheduledStart.getTime() - 1)
        const home = buildQuickRematchContext({
          currentGame,
          now,
          opponentAbbreviation: currentGame.awayTeam.abbreviation,
          scheduleGames: normalizedScheduleGames,
          settings,
          teamAbbreviation: currentGame.homeTeam.abbreviation,
        })
        const away = buildQuickRematchContext({
          currentGame,
          now,
          opponentAbbreviation: currentGame.homeTeam.abbreviation,
          scheduleGames: normalizedScheduleGames,
          settings,
          teamAbbreviation: currentGame.awayTeam.abbreviation,
        })

        return [
          windowDays,
          {
            awayEligible: away.quickRematch.eligible,
            awayPreviousGameId: away.quickRematch.previousGameId,
            awayPreviousLoser: away.quickRematch.previousLoserAbbreviation,
            homeEligible: home.quickRematch.eligible,
            homePreviousGameId: home.quickRematch.previousGameId,
            homePreviousLoser: home.quickRematch.previousLoserAbbreviation,
          },
        ]
      }),
    )

    factsByGameId.set(game.gameId, {
      awayCondition: context.awayContext.restFatigueCondition,
      awayDetectedConditions: context.awayContext.conditions,
      awayTravelBetweenGames: context.awayContext.travelBetweenGames,
      homeCondition: context.homeContext.restFatigueCondition,
      homeDetectedConditions: context.homeContext.conditions,
      homeTravelBetweenGames: context.homeContext.travelBetweenGames,
      quickRematchByWindow,
    })
  })

  return factsByGameId
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

const getAdjustment = (condition, configuration) =>
  Number(configuration?.[condition] ?? 0)

const createConditionCounts = () =>
  Object.fromEntries([
    ...RULE_ORDER.map((ruleId) => [ruleId, 0]),
    ['normal', 0],
  ])

const normalizeRestFatigueReplayConfiguration = (configuration = {}) => {
  const restFatigue = configuration?.restFatigue ?? configuration ?? {}
  const adjustments = restFatigue?.adjustments ?? restFatigue
  const hasExplicitWellRestedState = Object.hasOwn(
    restFatigue,
    'includeWellRested',
  )

  return {
    adjustments,
    includeWellRested: hasExplicitWellRestedState
      ? restFatigue.includeWellRested === true
      : Object.hasOwn(adjustments, RULE_IDS.WELL_RESTED) &&
        getAdjustment(RULE_IDS.WELL_RESTED, adjustments) !== 0,
  }
}

const getAppliedCondition = (condition, includeWellRested) =>
  condition === RULE_IDS.WELL_RESTED && !includeWellRested
    ? 'normal'
    : condition

const addMatchedConditions = (counts, detectedConditions, condition) => {
  const matched = new Set(
    (Array.isArray(detectedConditions) ? detectedConditions : []).filter(
      (ruleId) => RULE_BY_ID.has(ruleId),
    ),
  )

  if (RULE_BY_ID.has(condition)) {
    matched.add(condition)
  }

  if (matched.size === 0) {
    counts.normal += 1
    return
  }

  matched.forEach((ruleId) => {
    counts[ruleId] += 1
  })
}

const replaySeason = ({ configuration, factsByGameId, games, teams }) => {
  const restFatigueConfiguration =
    normalizeRestFatigueReplayConfiguration(configuration)
  const quickRematchConfiguration = {
    enabled: Boolean(configuration?.quickRematch?.enabled),
    loserAdjustment: Number(
      configuration?.quickRematch?.loserAdjustment ?? 0,
    ),
    maximumDays: Number(configuration?.quickRematch?.maximumDays ?? 0),
  }
  const ratingState = buildStartingRatingState(teams)
  const engineConfiguration = createRatingEngineConfiguration({
    kFactor: BASE_MODEL_V1.kFactor,
    overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
    regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
    shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  })
  const predictions = []
  const appliedCounts = createConditionCounts()
  const matchedCounts = createConditionCounts()
  const gamesAffectedByRule = Object.fromEntries(
    RULE_ORDER.map((ruleId) => [ruleId, new Set()]),
  )
  const quickRematchGameIds = new Set()
  let quickRematchOccurrences = 0
  let noContextAdjustmentOccurrences = 0

  games.forEach((game) => {
    const home = ratingState.get(game.homeTeamId)
    const away = ratingState.get(game.awayTeamId)
    const facts = factsByGameId.get(game.gameId)
    const homeCondition = RULE_BY_ID.has(facts?.homeCondition)
      ? facts.homeCondition
      : 'normal'
    const awayCondition = RULE_BY_ID.has(facts?.awayCondition)
      ? facts.awayCondition
      : 'normal'
    const homeAppliedCondition = getAppliedCondition(
      homeCondition,
      restFatigueConfiguration.includeWellRested,
    )
    const awayAppliedCondition = getAppliedCondition(
      awayCondition,
      restFatigueConfiguration.includeWellRested,
    )
    const quickFacts = quickRematchConfiguration.enabled
      ? facts?.quickRematchByWindow?.[quickRematchConfiguration.maximumDays]
      : null
    const homeQuickRematchEligible = Boolean(quickFacts?.homeEligible)
    const awayQuickRematchEligible = Boolean(quickFacts?.awayEligible)
    const homeRestFatigueAdjustment = getAdjustment(
      homeAppliedCondition,
      restFatigueConfiguration.adjustments,
    )
    const awayRestFatigueAdjustment = getAdjustment(
      awayAppliedCondition,
      restFatigueConfiguration.adjustments,
    )
    const homeQuickRematchAdjustment = homeQuickRematchEligible
      ? quickRematchConfiguration.loserAdjustment
      : 0
    const awayQuickRematchAdjustment = awayQuickRematchEligible
      ? quickRematchConfiguration.loserAdjustment
      : 0
    const homeAdjustment =
      homeRestFatigueAdjustment + homeQuickRematchAdjustment
    const awayAdjustment =
      awayRestFatigueAdjustment + awayQuickRematchAdjustment

    ;[
      {
        appliedCondition: homeAppliedCondition,
        condition: homeCondition,
        detectedConditions: facts?.homeDetectedConditions,
      },
      {
        appliedCondition: awayAppliedCondition,
        condition: awayCondition,
        detectedConditions: facts?.awayDetectedConditions,
      },
    ].forEach(({ appliedCondition, condition, detectedConditions }) => {
      addMatchedConditions(matchedCounts, detectedConditions, condition)
      appliedCounts[appliedCondition] += 1

      if (appliedCondition !== 'normal') {
        gamesAffectedByRule[appliedCondition].add(game.gameId)
      }
    })

    ;[
      { adjustment: homeAdjustment, eligible: homeQuickRematchEligible },
      { adjustment: awayAdjustment, eligible: awayQuickRematchEligible },
    ].forEach(({ adjustment, eligible }) => {
      if (eligible) {
        quickRematchOccurrences += 1
        quickRematchGameIds.add(game.gameId)
      }
      if (adjustment === 0) {
        noContextAdjustmentOccurrences += 1
      }
    })

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
      awayCondition,
      awayAppliedCondition,
      awayAdjustment,
      awayQuickRematchAdjustment,
      awayQuickRematchEligible,
      awayRestFatigueAdjustment,
      favoriteConfidence: Math.max(
        probability.homeProbability,
        probability.awayProbability,
      ),
      gameId: game.gameId,
      homeCondition,
      homeAppliedCondition,
      homeAdjustment,
      homeQuickRematchAdjustment,
      homeQuickRematchEligible,
      homeRestFatigueAdjustment,
      homeProbability: probability.homeProbability,
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
    appliedCounts,
    gamesAffectedByRule: Object.fromEntries(
      Object.entries(gamesAffectedByRule).map(([ruleId, gameIds]) => [
        ruleId,
        gameIds.size,
      ]),
    ),
    metrics: calculateMetrics(predictions),
    matchedCounts,
    predictions,
    priorityCounts: appliedCounts,
    quickRematchGamesAffected: quickRematchGameIds.size,
    quickRematchOccurrences,
    ratingState,
    noContextAdjustmentOccurrences,
  }
}

const calculateStability = (scores) => {
  if (scores.length < 2) {
    return { brierRange: null, brierStandardDeviation: null, level: 'not_assessed' }
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const range = Math.max(...scores) - Math.min(...scores)
  const standardDeviation = Math.sqrt(
    scores.reduce((sum, score) => sum + (score - average) ** 2, 0) /
      scores.length,
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

const buildComparison = ({
  configuration,
  quickRematchSample = false,
  replayContexts,
  ruleId = null,
}) => {
  const seasonResults = replayContexts.map((context) => {
    const replay = replaySeason({ ...context, configuration })
    const occurrences = quickRematchSample
      ? replay.quickRematchOccurrences
      : ruleId
        ? replay.matchedCounts[ruleId]
        : null
    const gamesAffected = quickRematchSample
      ? replay.quickRematchGamesAffected
      : ruleId
      ? replay.gamesAffectedByRule[ruleId]
      : replay.predictions.filter(
          (prediction) =>
            prediction.homeAdjustment !== 0 ||
            prediction.awayAdjustment !== 0,
        ).length

    return {
      games: replay.predictions.length,
      gamesAffected,
      metrics: {
        accuracy: replay.metrics.accuracy.rate,
        brierScore: replay.metrics.brierScore,
        expectedCalibrationError: replay.metrics.expectedCalibrationError,
        logLoss: replay.metrics.logLoss,
      },
      occurrences,
      predictions: replay.predictions,
      appliedCounts: replay.appliedCounts,
      matchedCounts: replay.matchedCounts,
      priorityCounts: replay.priorityCounts,
      quickRematchOccurrences: replay.quickRematchOccurrences,
      noContextAdjustmentOccurrences:
        replay.noContextAdjustmentOccurrences,
      seasonId: context.seasonId,
    }
  })
  const predictions = seasonResults.flatMap((season) => season.predictions)
  const metrics = calculateMetrics(predictions)
  const seasonBrierScores = seasonResults.map((season) => season.metrics.brierScore)
  const worstSeason = [...seasonResults].sort(
    (left, right) => right.metrics.brierScore - left.metrics.brierScore,
  )[0]
  const occurrences = ruleId || quickRematchSample
    ? seasonResults.reduce((sum, season) => sum + season.occurrences, 0)
    : null
  const gamesAffected = seasonResults.reduce(
    (sum, season) => sum + season.gamesAffected,
    0,
  )
  const aggregateCounts = (field) => seasonResults.reduce((totals, season) => {
    Object.entries(season[field]).forEach(([condition, count]) => {
      totals[condition] = (totals[condition] ?? 0) + count
    })
    return totals
  }, {})
  const appliedCounts = aggregateCounts('appliedCounts')
  const matchedCounts = aggregateCounts('matchedCounts')
  const quickRematchOccurrences = seasonResults.reduce(
    (sum, season) => sum + season.quickRematchOccurrences,
    0,
  )
  const noContextAdjustmentOccurrences = seasonResults.reduce(
    (sum, season) => sum + season.noContextAdjustmentOccurrences,
    0,
  )

  return {
    averageSeasonBrier: round(
      seasonBrierScores.reduce((sum, score) => sum + score, 0) /
        seasonBrierScores.length,
    ),
    configuration: { ...configuration },
    appliedRestFatigueCounts: appliedCounts,
    gamesAffected,
    gamesAffectedPercentage: round(gamesAffected / predictions.length),
    metrics: {
      accuracy: metrics.accuracy.rate,
      brierScore: metrics.brierScore,
      expectedCalibrationError: metrics.expectedCalibrationError,
      logLoss: metrics.logLoss,
    },
    occurrences,
    occurrenceRate:
      occurrences === null ? null : round(occurrences / (predictions.length * 2)),
    contextCounts: {
      ...appliedCounts,
      no_context_adjustment: noContextAdjustmentOccurrences,
      quick_rematch: quickRematchOccurrences,
    },
    matchedRestFatigueCounts: matchedCounts,
    seasonResults: seasonResults.map(({ predictions: _predictions, ...season }) => season),
    stability: calculateStability(seasonBrierScores),
    worstSeason: {
      brierScore: worstSeason.metrics.brierScore,
      seasonId: worstSeason.seasonId,
    },
  }
}

const compareRule = ({ candidates, replayContexts, rule }) => {
  const comparisons = candidates.map((adjustment) => ({
    adjustment,
    ...buildComparison({
      configuration: {
        restFatigue: {
          adjustments: { [rule.id]: adjustment },
          includeWellRested: rule.id === RULE_IDS.WELL_RESTED,
        },
      },
      replayContexts,
      ruleId: rule.id,
    }),
  }))
  const baseline = comparisons.find((comparison) => comparison.adjustment === 0)

  comparisons.forEach((comparison) => {
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
      }
    })
    comparison.seasonsBeatingBaseline = comparison.seasonResults.filter(
      (season) => season.delta.brierScore < 0,
    ).length
  })

  const best = [...comparisons].sort(
    (left, right) =>
      left.metrics.brierScore - right.metrics.brierScore ||
      Math.abs(left.adjustment) - Math.abs(right.adjustment),
  )[0]
  comparisons.forEach((comparison) => {
    comparison.best = comparison === best
  })

  return {
    comparisons,
    definition: rule.definition,
    label: rule.label,
    ruleId: rule.id,
  }
}

const applyBaselineDeltas = (comparisons, baseline) => {
  comparisons.forEach((comparison) => {
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
      }
    })
    comparison.seasonsBeatingBaseline = comparison.seasonResults.filter(
      (season) => season.delta.brierScore < 0,
    ).length
  })
}

const compareQuickRematchGrid = ({ adjustments, replayContexts, windows }) => {
  const baseline = {
    adjustment: 0,
    disabled: true,
    windowDays: null,
    ...buildComparison({
      configuration: {
        quickRematch: { enabled: false, loserAdjustment: 0, maximumDays: 0 },
        restFatigue: {},
      },
      quickRematchSample: true,
      replayContexts,
    }),
  }
  const comparisons = [
    baseline,
    ...windows.flatMap((windowDays) =>
      adjustments
        .filter((adjustment) => adjustment !== 0)
        .map((adjustment) => ({
          adjustment,
          disabled: false,
          windowDays,
          ...buildComparison({
            configuration: {
              quickRematch: {
                enabled: true,
                loserAdjustment: adjustment,
                maximumDays: windowDays,
              },
              restFatigue: {},
            },
            quickRematchSample: true,
            replayContexts,
          }),
        })),
    ),
  ]

  applyBaselineDeltas(comparisons, baseline)
  const ranked = [...comparisons].sort(
    (left, right) =>
      left.metrics.brierScore - right.metrics.brierScore ||
      Number(left.disabled) * -1 - Number(right.disabled) * -1 ||
      left.adjustment - right.adjustment ||
      (left.windowDays ?? 0) - (right.windowDays ?? 0),
  )
  ranked.forEach((comparison, index) => {
    comparison.best = index === 0
    comparison.rank = index + 1
  })
  const best = ranked[0]

  return {
    adjustments,
    bestTestedResult: {
      adjustment: best.adjustment,
      brierDelta: best.delta.brierScore,
      disabled: best.disabled,
      negligibleImprovement:
        best.delta.brierScore >= -0.0001,
      occurrences: best.occurrences ?? 0,
      occurrenceRate: best.occurrenceRate,
      seasonsBeatingBaseline: best.seasonsBeatingBaseline,
      smallSample: (best.occurrences ?? 0) < 100,
      windowDays: best.windowDays,
    },
    comparisons,
    definition:
      'The most recent earlier head-to-head in the loaded season must fall within Max Days × 24 elapsed hours. The rating adjustment applies once, only to the loser of that completed meeting; regulation, overtime, and shootout losses are treated equally.',
    standardCombinationCount:
      QUICK_REMATCH_WINDOWS.length * QUICK_REMATCH_ADJUSTMENTS.length,
    testedCombinationCount: windows.length * adjustments.length,
    windows,
    zeroAdjustmentRowsCollapsed: windows.length,
  }
}

const normalizeAdjustment = (value, field) => {
  const adjustment = Number(value)

  if (
    value === null ||
    value === '' ||
    !Number.isFinite(adjustment) ||
    adjustment < MIN_CUSTOM_ADJUSTMENT ||
    adjustment > MAX_CUSTOM_ADJUSTMENT
  ) {
    throw new ScheduleCalibrationError(
      `${field} must be a finite value between ${MIN_CUSTOM_ADJUSTMENT} and ${MAX_CUSTOM_ADJUSTMENT}.`,
      400,
      { field },
    )
  }

  return adjustment
}

const normalizeRunPayload = (payload = {}) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ScheduleCalibrationError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) =>
      ![
        'combinedConfiguration',
        'combinedScheduleContext',
        'customValues',
        'includeWellRested',
        'quickRematchGrid',
        'seasonIds',
      ].includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new ScheduleCalibrationError('Request contains unsupported fields.', 400, {
      unsupportedFields,
    })
  }

  if (payload.seasonIds !== undefined && !Array.isArray(payload.seasonIds)) {
    throw new ScheduleCalibrationError('seasonIds must be an array.', 400, {
      field: 'seasonIds',
    })
  }

  const seasonIds = [
    ...new Set(
      (payload.seasonIds ?? DEFAULT_SEASON_IDS).map((seasonId) =>
        normalizeSeasonId(seasonId),
      ),
    ),
  ]

  if (
    seasonIds.length === 0 ||
    seasonIds.some((seasonId) => !DEFAULT_SEASON_IDS.includes(seasonId))
  ) {
    throw new ScheduleCalibrationError(
      'Select at least one supported Phase 3A season.',
      400,
      { field: 'seasonIds' },
    )
  }

  const customValues = payload.customValues ?? {}
  const combinedScheduleContext = payload.combinedScheduleContext ?? {}
  const combinedInput =
    combinedScheduleContext?.restFatigue ?? payload.combinedConfiguration ?? {}
  const quickRematchGrid = payload.quickRematchGrid ?? {}
  const combinedQuickRematch = combinedScheduleContext?.quickRematch ?? {}

  if (
    customValues === null ||
    typeof customValues !== 'object' ||
    Array.isArray(customValues) ||
    combinedInput === null ||
    typeof combinedInput !== 'object' ||
    Array.isArray(combinedInput) ||
    combinedScheduleContext === null ||
    typeof combinedScheduleContext !== 'object' ||
    Array.isArray(combinedScheduleContext) ||
    quickRematchGrid === null ||
    typeof quickRematchGrid !== 'object' ||
    Array.isArray(quickRematchGrid) ||
    combinedQuickRematch === null ||
    typeof combinedQuickRematch !== 'object' ||
    Array.isArray(combinedQuickRematch)
  ) {
    throw new ScheduleCalibrationError(
      'Custom values and combined configuration must be objects.',
      400,
    )
  }

  const unsupportedRuleIds = [
    ...Object.keys(customValues),
    ...Object.keys(combinedInput),
  ].filter((ruleId) => !RULE_BY_ID.has(ruleId))

  if (unsupportedRuleIds.length > 0) {
    throw new ScheduleCalibrationError('Request contains unsupported schedule rules.', 400, {
      unsupportedFields: [...new Set(unsupportedRuleIds)],
    })
  }

  const unsupportedCombinedFields = Object.keys(combinedScheduleContext).filter(
    (field) => !['includeWellRested', 'quickRematch', 'restFatigue'].includes(field),
  )
  const unsupportedGridFields = Object.keys(quickRematchGrid).filter(
    (field) => !['customAdjustment', 'customWindow'].includes(field),
  )
  const unsupportedQuickFields = Object.keys(combinedQuickRematch).filter(
    (field) => !['enabled', 'loserAdjustment', 'maximumDays'].includes(field),
  )

  if (
    unsupportedCombinedFields.length > 0 ||
    unsupportedGridFields.length > 0 ||
    unsupportedQuickFields.length > 0
  ) {
    throw new ScheduleCalibrationError('Request contains unsupported Phase 3 fields.', 400, {
      unsupportedFields: [
        ...unsupportedCombinedFields,
        ...unsupportedGridFields,
        ...unsupportedQuickFields,
      ],
    })
  }

  const candidatesByRule = Object.fromEntries(
    RULES.map((rule) => {
      const customValue = customValues[rule.id]
      const candidates =
        customValue === undefined || customValue === ''
          ? [...rule.presetValues]
          : [
              ...new Set([
                ...rule.presetValues,
                normalizeAdjustment(customValue, `customValues.${rule.id}`),
              ]),
            ].sort((left, right) => left - right)

      return [rule.id, candidates]
    }),
  )
  const includeWellRested =
    combinedScheduleContext.includeWellRested ??
    payload.includeWellRested ??
    false

  if (typeof includeWellRested !== 'boolean') {
    throw new ScheduleCalibrationError(
      'includeWellRested must be true or false.',
      400,
      { field: 'includeWellRested' },
    )
  }

  const combinedConfiguration = Object.fromEntries(
    RULES.map((rule) => [
      rule.id,
      rule.id === RULE_IDS.WELL_RESTED && !includeWellRested
        ? 0
        : Object.hasOwn(combinedInput, rule.id)
        ? normalizeAdjustment(
            combinedInput[rule.id],
            `combinedConfiguration.${rule.id}`,
          )
        : rule.productionValue,
    ]),
  )

  const normalizeQuickWindow = (value, field) => {
    const windowDays = Number(value)
    if (
      value === null ||
      value === '' ||
      !Number.isInteger(windowDays) ||
      windowDays < 1 ||
      windowDays > MAX_CUSTOM_QUICK_REMATCH_WINDOW
    ) {
      throw new ScheduleCalibrationError(
        `${field} must be an integer from 1 to ${MAX_CUSTOM_QUICK_REMATCH_WINDOW}.`,
        400,
        { field },
      )
    }
    return windowDays
  }
  const normalizeQuickAdjustment = (value, field) => {
    const adjustment = Number(value)
    if (
      value === null ||
      value === '' ||
      !Number.isFinite(adjustment) ||
      adjustment < 0 ||
      adjustment > MAX_CUSTOM_QUICK_REMATCH_ADJUSTMENT
    ) {
      throw new ScheduleCalibrationError(
        `${field} must be between 0 and ${MAX_CUSTOM_QUICK_REMATCH_ADJUSTMENT}.`,
        400,
        { field },
      )
    }
    return adjustment
  }
  const quickRematchWindows = [...QUICK_REMATCH_WINDOWS]
  if (
    quickRematchGrid.customWindow !== undefined &&
    quickRematchGrid.customWindow !== ''
  ) {
    quickRematchWindows.push(
      normalizeQuickWindow(
        quickRematchGrid.customWindow,
        'quickRematchGrid.customWindow',
      ),
    )
  }
  const quickRematchAdjustments = [...QUICK_REMATCH_ADJUSTMENTS]
  if (
    quickRematchGrid.customAdjustment !== undefined &&
    quickRematchGrid.customAdjustment !== ''
  ) {
    quickRematchAdjustments.push(
      normalizeQuickAdjustment(
        quickRematchGrid.customAdjustment,
        'quickRematchGrid.customAdjustment',
      ),
    )
  }
  const normalizedQuickRematchWindows = [...new Set(quickRematchWindows)].sort(
    (left, right) => left - right,
  )
  const normalizedQuickRematchAdjustments = [
    ...new Set(quickRematchAdjustments),
  ].sort((left, right) => left - right)
  const combinedQuickRematchEnabled =
    combinedQuickRematch.enabled ??
    DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchEnabled

  if (typeof combinedQuickRematchEnabled !== 'boolean') {
    throw new ScheduleCalibrationError(
      'combinedScheduleContext.quickRematch.enabled must be true or false.',
      400,
      { field: 'combinedScheduleContext.quickRematch.enabled' },
    )
  }
  const combinedQuickRematchConfiguration = {
    enabled: combinedQuickRematchEnabled,
    loserAdjustment: Object.hasOwn(combinedQuickRematch, 'loserAdjustment')
      ? normalizeQuickAdjustment(
          combinedQuickRematch.loserAdjustment,
          'combinedScheduleContext.quickRematch.loserAdjustment',
        )
      : DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchLoserAdjustment,
    maximumDays: Object.hasOwn(combinedQuickRematch, 'maximumDays')
      ? normalizeQuickWindow(
          combinedQuickRematch.maximumDays,
          'combinedScheduleContext.quickRematch.maximumDays',
        )
      : DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.quickRematchMaximumDays,
  }

  const scheduleFactQuickRematchWindows = [
    ...new Set([
      ...normalizedQuickRematchWindows,
      combinedQuickRematchConfiguration.maximumDays,
    ]),
  ].sort((left, right) => left - right)

  return {
    candidatesByRule,
    combinedConfiguration,
    combinedRestFatigueConfiguration: {
      adjustments: { ...combinedConfiguration },
      includeWellRested,
    },
    combinedQuickRematchConfiguration,
    includeWellRested,
    quickRematchAdjustments: normalizedQuickRematchAdjustments,
    quickRematchWindows: normalizedQuickRematchWindows,
    scheduleFactQuickRematchWindows,
    seasonIds,
  }
}

const loadContext = async (
  seasonIds,
  quickRematchWindows = QUICK_REMATCH_WINDOWS,
  options = {},
) => {
  const teams = (await (options.teamsProvider ?? getSeedTeams)())
    .map(normalizeTeam)
    .filter(Boolean)
  const statuses = await (
    options.historicalStatusProvider ??
    historicalNhlDataService.getHistoricalSeasonStatuses
  )(getSeasonDefinitions(), { repository: options.historicalRepository })
  const statusById = new Map(statuses.map((status) => [status.seasonId, status]))
  const missingSeasonIds = seasonIds.filter(
    (seasonId) => statusById.get(seasonId)?.status !== 'ready',
  )

  if (missingSeasonIds.length > 0) {
    throw new ScheduleCalibrationError(
      'Selected seasons must be prepared before Phase 3A replay.',
      409,
      { missingSeasonIds },
    )
  }

  const loaded = await (
    options.historicalLoadProvider ?? historicalNhlDataService.loadPreparedSeasons
  )(seasonIds, { repository: options.historicalRepository })
  const historicalEligibility = {}
  const replayContexts = seasonIds.map((seasonId) => {
    const prepared = preparePhase3ReplayGames(
      loaded.gamesBySeason?.get(seasonId) ?? [],
      seasonId,
      teams,
    )
    const games = prepared.games
    historicalEligibility[seasonId] = prepared.eligibility

    if (games.length === 0) {
      throw new ScheduleCalibrationError(
        `No eligible historical games were available for ${seasonId}.`,
        409,
        {
          historicalEligibility: prepared.eligibility,
          seasonId,
        },
      )
    }

    return {
      factsByGameId: buildScheduleFacts(games, quickRematchWindows),
      games,
      seasonId,
      teams,
    }
  })

  return { historicalEligibility, replayContexts, statusById, teams }
}

const getScheduleCalibrationOptions = async (userId, options = {}) => {
  if (!userId) {
    throw new ScheduleCalibrationError('Authenticated userId is required.', 401)
  }

  const seasonDefinitions = getSeasonDefinitions()
  const statuses = await (
    options.historicalStatusProvider ??
    historicalNhlDataService.getHistoricalSeasonStatuses
  )(seasonDefinitions, { repository: options.historicalRepository })
  const statusById = new Map(statuses.map((status) => [status.seasonId, status]))
  const productionSettingsResult = await (
    options.quickRematchSettingsProvider ?? getQuickRematchSettings
  )(userId, options.quickRematchSettingsOptions ?? {})
  const productionSettings = productionSettingsResult.settings

  return {
    baseline: {
      baseHomeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      kFactor: BASE_MODEL_V1.kFactor,
      modelVersion: BASE_MODEL_V1.modelVersion,
      name: 'Base Model v1 (Team Home Advantage disabled)',
      overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
      probabilityScale: BASE_MODEL_V1.probabilityScale,
      regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
      shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
      startingRatings: BASE_MODEL_V1.startingRatings,
    },
    defaultSeasonIds: DEFAULT_SEASON_IDS,
    isolation: {
      historicalSource: 'HistoricalNhlGame / HistoricalSeasonDataset',
      providerCallsDuringReplay: false,
      productionSettingsReadForReference: true,
      productionSettingsWrites: false,
      productionWrites: false,
    },
    maxCustomAdjustment: MAX_CUSTOM_ADJUSTMENT,
    maxAbsoluteCustomAdjustment: MAX_ABSOLUTE_CUSTOM_ADJUSTMENT,
    maxCustomQuickRematchAdjustment: MAX_CUSTOM_QUICK_REMATCH_ADJUSTMENT,
    maxCustomQuickRematchWindow: MAX_CUSTOM_QUICK_REMATCH_WINDOW,
    minCustomAdjustment: MIN_CUSTOM_ADJUSTMENT,
    optionalRules: RULES.filter((rule) => OPTIONAL_RULE_IDS.includes(rule.id)),
    precedence: RULE_ORDER,
    primaryRules: RULES.filter((rule) => PRIMARY_RULE_IDS.includes(rule.id)),
    quickRematch: {
      adjustmentOptions: QUICK_REMATCH_ADJUSTMENTS,
      definition:
        'The most recent earlier head-to-head in the loaded season must fall within Max Days × 24 elapsed hours. The adjustment applies once, only to the loser of that completed meeting. Regulation, overtime, and shootout losses are treated equally.',
      productionReference: {
        enabled: productionSettings.quickRematchEnabled,
        loserAdjustment: productionSettings.quickRematchLoserAdjustment,
        maximumDays: productionSettings.quickRematchMaximumDays,
        usingDefaults: Boolean(productionSettingsResult.usingDefaults),
      },
      windowOptions: QUICK_REMATCH_WINDOWS,
    },
    rules: RULES,
    seasons: seasonDefinitions.map((season) => ({
      ...season,
      historicalDataset:
        statusById.get(season.id) ??
        historicalNhlDataService.makeDatasetStatus(null, season),
    })),
  }
}

const runScheduleCalibration = async (userId, payload, options = {}) => {
  if (!userId) {
    throw new ScheduleCalibrationError('Authenticated userId is required.', 401)
  }

  const input = normalizeRunPayload(payload)
  const { historicalEligibility, replayContexts } = await loadContext(
    input.seasonIds,
    input.scheduleFactQuickRematchWindows,
    options,
  )
  const individualResults = Object.fromEntries(
    RULES.map((rule) => [
      rule.id,
      compareRule({
        candidates: input.candidatesByRule[rule.id],
        replayContexts,
        rule,
      }),
    ]),
  )
  const noAdjustments = buildComparison({
    configuration: {
      quickRematch: { enabled: false },
      restFatigue: { adjustments: {}, includeWellRested: false },
    },
    replayContexts,
  })
  const selected = buildComparison({
    configuration: {
      quickRematch: { enabled: false },
      restFatigue: input.combinedRestFatigueConfiguration,
    },
    replayContexts,
  })
  applyBaselineDeltas([noAdjustments, selected], noAdjustments)
  const appliedCounts = Object.fromEntries(
    [...RULE_ORDER, 'normal'].map((condition) => [
      condition,
      selected.appliedRestFatigueCounts[condition] ?? 0,
    ]),
  )
  const matchedCounts = Object.fromEntries(
    [...RULE_ORDER, 'normal'].map((condition) => [
      condition,
      selected.matchedRestFatigueCounts[condition] ?? 0,
    ]),
  )
  const configurationSnapshot = {
    adjustments: { ...input.combinedConfiguration },
    includeWellRested: input.includeWellRested,
  }
  const combinedRestFatigueResult = {
    appliedCounts,
    configurationSnapshot,
    matchedCounts,
    noAdjustments,
    priorityCounts: appliedCounts,
    selected,
    teamGameCount: Object.values(appliedCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
  }
  const quickRematchResult = compareQuickRematchGrid({
    adjustments: input.quickRematchAdjustments,
    replayContexts,
    windows: input.quickRematchWindows,
  })
  const combinedScheduleControl = buildComparison({
    configuration: {
      quickRematch: { enabled: false },
      restFatigue: { adjustments: {}, includeWellRested: false },
    },
    replayContexts,
  })
  const combinedScheduleSelected = buildComparison({
    configuration: {
      quickRematch: input.combinedQuickRematchConfiguration,
      restFatigue: input.combinedRestFatigueConfiguration,
    },
    replayContexts,
  })
  applyBaselineDeltas(
    [combinedScheduleControl, combinedScheduleSelected],
    combinedScheduleControl,
  )
  const combinedScheduleContextResult = {
    appliedRestFatigueCounts:
      combinedScheduleSelected.appliedRestFatigueCounts,
    configurationSnapshot: {
      quickRematch: { ...input.combinedQuickRematchConfiguration },
      restFatigue: configurationSnapshot,
    },
    matchedRestFatigueCounts:
      combinedScheduleSelected.matchedRestFatigueCounts,
    noAdjustments: combinedScheduleControl,
    occurrenceCounts: combinedScheduleSelected.contextCounts,
    selected: combinedScheduleSelected,
    teamGameCount: combinedScheduleSelected.seasonResults.reduce(
      (sum, season) => sum + season.games * 2,
      0,
    ),
  }

  return {
    combinedRestFatigueResult,
    combinedResult: combinedRestFatigueResult,
    combinedScheduleContextResult,
    diagnostics: {
      chronologicalReplay: true,
      factsComputedBeforeCandidateReplay: true,
      historicalEligibility,
      individualRulesDisableOtherRules: true,
      effectivePrecedence: input.includeWellRested
        ? RULE_ORDER
        : RULE_ORDER.filter((ruleId) => ruleId !== RULE_IDS.WELL_RESTED),
      precedence: RULE_ORDER,
      productionScheduleUtility: 'gameContextRules.calculateGameContextForGame',
      productionQuickRematchUtility: 'gameContextRules.buildQuickRematchContext',
      productionWrites: false,
      providerCallsDuringReplay: false,
      individualWinnersAutoApplied: false,
      quickRematchIncluded: true,
      ratingResetBetweenSeasons: true,
      selectedSeasonIds: input.seasonIds,
      wellRestedIncludedInCombined: input.includeWellRested,
    },
    experimental: true,
    individualResults,
    modelVersion: BASE_MODEL_V1.modelVersion,
    quickRematchResult,
    selectedCombinedConfiguration: input.combinedConfiguration,
    selectedCombinedRestFatigueConfiguration: configurationSnapshot,
    selectedCombinedScheduleContext: {
      includeWellRested: input.includeWellRested,
      quickRematch: input.combinedQuickRematchConfiguration,
      restFatigue: input.combinedConfiguration,
    },
  }
}

const prepareScheduleCalibrationSeason = async (
  userId,
  seasonId,
  payload,
  options = {},
) => {
  if (!userId) {
    throw new ScheduleCalibrationError('Authenticated userId is required.', 401)
  }

  const season = getSeasonDefinition(seasonId)

  return (
    options.prepareProvider ?? historicalNhlDataService.prepareHistoricalSeason
  )(season.id, payload, { ...options, season })
}

module.exports = {
  DEFAULT_SEASON_IDS,
  MAX_ABSOLUTE_CUSTOM_ADJUSTMENT,
  MAX_CUSTOM_ADJUSTMENT,
  MAX_CUSTOM_QUICK_REMATCH_ADJUSTMENT,
  MAX_CUSTOM_QUICK_REMATCH_WINDOW,
  MIN_CUSTOM_ADJUSTMENT,
  OPTIONAL_RULE_IDS,
  PRIMARY_RULE_IDS,
  QUICK_REMATCH_ADJUSTMENTS,
  QUICK_REMATCH_WINDOWS,
  RULES,
  RULE_IDS,
  RULE_ORDER,
  ScheduleCalibrationError,
  buildComparison,
  buildReplayGames,
  buildScheduleFacts,
  compareRule,
  compareQuickRematchGrid,
  getScheduleCalibrationOptions,
  normalizeRunPayload,
  preparePhase3ReplayGames,
  prepareScheduleCalibrationSeason,
  replaySeason,
  runScheduleCalibration,
}
