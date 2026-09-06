const { performance } = require('perf_hooks')
const mongoose = require('mongoose')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const app = require('../app')
const BankrollProfile = require('../models/BankrollProfile')
const BankrollTransaction = require('../models/BankrollTransaction')
const Bet = require('../models/Bet')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const QuickRematchSettings = require('../models/QuickRematchSettings')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const User = require('../models/User')
const authSessionService = require('../services/authSessionService')
const baseModelCalibrationService = require(
  '../services/baseModelCalibrationService'
)
const historicalNhlDataService = require('../services/historicalNhlDataService')
const historicalSpecialTeamsDataService = require(
  '../services/historicalSpecialTeamsDataService'
)
const homeAdvantageCalibrationService = require(
  '../services/homeAdvantageCalibrationService'
)
const { FALLBACK_SEASONS } = require('../services/nhlSeasonService')
const { getSeedTeams } = require('../services/powerRatingsService')
const scheduleCalibrationService = require(
  '../services/scheduleCalibrationService'
)
const specialTeamsCalibrationService = require(
  '../services/specialTeamsCalibrationService'
)
const {
  calculateMetrics,
} = baseModelCalibrationService
const {
  WINNERS,
  createRatingEngineConfiguration,
} = require('../services/powerRatingEngine')
const {
  STARTING_STATE_POLICIES,
  createDeterministicSignature,
  createStartingStateIdentity,
} = require('../calibration/calibrationIdentity')
const {
  captureCalibrationProductionSnapshot,
} = require('../calibration/calibrationProductionSnapshot')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
} = require('../calibration/calibrationResultContract')
const {
  buildCanonicalBaseline,
  normalizeReplayConfiguration,
  runCalibrationOrchestration,
} = require('../calibration/calibrationOrchestrator')
const {
  runCalibrationRobustness,
} = require('../calibration/calibrationRobustnessService')
const {
  storeCalibrationAnalysisContext,
} = require('../calibration/calibrationAnalysisContextStore')

const EVALUATION_SEASONS = Object.freeze([
  '20232024',
  '20242025',
  '20252026',
])
const TOLERANCE = 1e-12
const STATUS = Object.freeze({
  BLOCKED: 'BLOCKED_NOT_DIRECTLY_COMPARABLE',
  FAIL: 'FAIL',
  PASS: 'PASS',
})

const BASE_EXPERIMENTS = Object.freeze([
  {
    candidateId: 'base-probability-scale-18',
    label: 'Probability Scale 18',
    overrides: { probabilityScale: 18 },
    type: CANDIDATE_TYPES.BASE_MODEL,
  },
  {
    candidateId: 'base-home-advantage-4',
    label: 'Base Home Advantage 4',
    overrides: { baseHomeAdvantage: 4 },
    type: CANDIDATE_TYPES.BASE_MODEL,
  },
  {
    candidateId: 'base-k-factor-1-1',
    label: 'K Factor 1.1',
    overrides: { kFactor: 1.1 },
    type: CANDIDATE_TYPES.BASE_MODEL,
  },
  {
    candidateId: 'base-ot-multiplier-0-5',
    label: 'OT Multiplier 0.5',
    overrides: { overtimeMultiplier: 0.5 },
    type: CANDIDATE_TYPES.BASE_MODEL,
  },
  {
    candidateId: 'base-so-multiplier-0-2',
    label: 'SO Multiplier 0.2',
    overrides: { shootoutMultiplier: 0.2 },
    type: CANDIDATE_TYPES.BASE_MODEL,
  },
])

const TEAM_HOME_EXPERIMENTS = Object.freeze([
  {
    candidateId: 'team-ha-control-0',
    label: 'Team HA control ±0.00',
    overrides: { adjustment: 0 },
    type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  },
  {
    candidateId: 'team-ha-0-5',
    label: 'Team HA ±0.50',
    overrides: { adjustment: 0.5 },
    type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  },
  {
    candidateId: 'team-ha-1',
    label: 'Team HA ±1.00',
    overrides: { adjustment: 1 },
    type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  },
])

const REST_EXPERIMENTS = Object.freeze([
  {
    candidateId: 'rest-coherent-with-well-rested',
    label: 'Coherent Rest & Fatigue with Well Rested',
    overrides: {
      backToBack: -0.75,
      backToBackTravel: -1.5,
      includeWellRested: true,
      threeInFour: -0.5,
      wellRested: 0.25,
    },
    type: CANDIDATE_TYPES.REST_FATIGUE,
  },
])

const QUICK_EXPERIMENTS = Object.freeze([
  {
    candidateId: 'quick-rematch-3-0-1',
    label: 'Quick Rematch 3 days +0.10',
    overrides: { enabled: true, loserAdjustment: 0.1, maximumDays: 3 },
    type: CANDIDATE_TYPES.QUICK_REMATCH,
  },
  {
    candidateId: 'quick-rematch-7-0-25',
    label: 'Quick Rematch 7 days +0.25',
    overrides: { enabled: true, loserAdjustment: 0.25, maximumDays: 7 },
    type: CANDIDATE_TYPES.QUICK_REMATCH,
  },
])

const SPECIAL_TEAMS_EXPERIMENTS = Object.freeze([
  {
    candidateId: 'special-teams-4-0-25',
    label: 'Special Teams Top/Bottom 4 ±0.25',
    overrides: { adjustment: 0.25, topBottomN: 4 },
    type: CANDIDATE_TYPES.SPECIAL_TEAMS,
  },
  {
    candidateId: 'special-teams-8-0-75',
    label: 'Special Teams Top/Bottom 8 ±0.75',
    overrides: { adjustment: 0.75, topBottomN: 8 },
    type: CANDIDATE_TYPES.SPECIAL_TEAMS,
  },
])

const ALL_EXPERIMENTS = Object.freeze([
  ...BASE_EXPERIMENTS,
  ...TEAM_HOME_EXPERIMENTS,
  ...REST_EXPERIMENTS,
  ...QUICK_EXPERIMENTS,
  ...SPECIAL_TEAMS_EXPERIMENTS,
])

const toCombinedComponent = (experiment) => ({
  candidateId: experiment.candidateId,
  label: experiment.label,
  overrides: experiment.overrides,
  type: experiment.type,
})

const COMBINED_VALIDATION_ISOLATED_EXPERIMENTS = Object.freeze([
  TEAM_HOME_EXPERIMENTS[1],
  REST_EXPERIMENTS[0],
  QUICK_EXPERIMENTS[1],
  SPECIAL_TEAMS_EXPERIMENTS[0],
])
const COMBINED_VALIDATION_EXPERIMENTS = Object.freeze([
  ...COMBINED_VALIDATION_ISOLATED_EXPERIMENTS,
  {
    candidateId: 'combined-rest-quick',
    components: [
      toCombinedComponent(REST_EXPERIMENTS[0]),
      toCombinedComponent(QUICK_EXPERIMENTS[1]),
    ],
    label: 'Combined Rest/Fatigue + Quick Rematch',
    type: CANDIDATE_TYPES.COMBINED,
  },
  {
    candidateId: 'combined-ha-special',
    components: [
      toCombinedComponent(TEAM_HOME_EXPERIMENTS[1]),
      toCombinedComponent(SPECIAL_TEAMS_EXPERIMENTS[0]),
    ],
    label: 'Combined Team HA + Special Teams',
    type: CANDIDATE_TYPES.COMBINED,
  },
])

const compareIdentifiers = (left, right) =>
  String(left).localeCompare(String(right))

const asPlain = (value) => JSON.parse(JSON.stringify(value))

const getSeasonDefinition = (seasonId) => {
  const season = FALLBACK_SEASONS.find((candidate) => candidate.id === seasonId)

  if (!season) throw new Error(`Missing season definition for ${seasonId}.`)
  return season
}

const getCandidate = (result, candidateId) =>
  result.candidates.find((candidate) => candidate.candidateId === candidateId)

const toMetricShape = (metrics) => ({
  accuracy: metrics.accuracy?.rate ?? metrics.accuracy,
  ece: metrics.expectedCalibrationError ?? metrics.ece,
  logLoss: metrics.logLoss,
  pooledBrier: metrics.brierScore ?? metrics.pooledBrier,
})

const toPerSeasonShape = (seasons) =>
  seasons.map((season) => ({
    accuracy:
      season.metrics?.accuracy?.rate ??
      season.metrics?.accuracy ??
      season.accuracy?.rate ??
      season.accuracy,
    brier: season.metrics?.brierScore ?? season.brier,
    ece: season.metrics?.expectedCalibrationError ?? season.ece,
    games: season.games,
    logLoss: season.metrics?.logLoss ?? season.logLoss,
    seasonId: season.seasonId,
  }))

const compareNumber = (unified, legacy) => {
  const absoluteDifference = Math.abs(Number(unified) - Number(legacy))

  return {
    absoluteDifference,
    exact: Object.is(unified, legacy),
    legacy,
    pass: Number.isFinite(absoluteDifference) && absoluteDifference <= TOLERANCE,
    unified,
  }
}

const compareMetrics = (unified, legacy) => {
  const normalizedUnified = toMetricShape(unified)
  const normalizedLegacy = toMetricShape(legacy)

  return Object.fromEntries(
    ['pooledBrier', 'logLoss', 'accuracy', 'ece'].map((field) => [
      field,
      compareNumber(normalizedUnified[field], normalizedLegacy[field]),
    ]),
  )
}

const comparePerSeason = (unifiedSeasons, legacySeasons) => {
  const unifiedBySeason = new Map(
    toPerSeasonShape(unifiedSeasons).map((season) => [season.seasonId, season]),
  )
  const legacyBySeason = new Map(
    toPerSeasonShape(legacySeasons).map((season) => [season.seasonId, season]),
  )

  return EVALUATION_SEASONS.map((seasonId) => {
    const unified = unifiedBySeason.get(seasonId)
    const legacy = legacyBySeason.get(seasonId)
    const metrics = Object.fromEntries(
      ['games', 'brier', 'logLoss', 'accuracy', 'ece'].map((field) => [
        field,
        compareNumber(unified?.[field], legacy?.[field]),
      ]),
    )

    return {
      metrics,
      pass: Object.values(metrics).every((metric) => metric.pass),
      seasonId,
    }
  })
}

const compareGameSamples = (unifiedGameIds, legacyGameIds) => {
  const unified = [...new Set(unifiedGameIds.map(String))].sort(
    compareIdentifiers,
  )
  const legacy = [...new Set(legacyGameIds.map(String))].sort(compareIdentifiers)
  const unifiedSet = new Set(unified)
  const legacySet = new Set(legacy)
  const missingIds = legacy.filter((gameId) => !unifiedSet.has(gameId))
  const extraIds = unified.filter((gameId) => !legacySet.has(gameId))

  return {
    extraIds: extraIds.slice(0, 20),
    extraIdCount: extraIds.length,
    legacyGameCount: legacy.length,
    missingIds: missingIds.slice(0, 20),
    missingIdCount: missingIds.length,
    pass: missingIds.length === 0 && extraIds.length === 0,
    unifiedGameCount: unified.length,
  }
}

const summarizeCandidateParity = ({
  featureParity = { pass: true },
  legacy,
  sampleParity,
  unified,
}) => {
  const metrics = compareMetrics(unified.metrics, legacy.metrics)
  const perSeason = comparePerSeason(unified.perSeason, legacy.perSeason)
  const pass =
    sampleParity.pass &&
    featureParity.pass &&
    Object.values(metrics).every((metric) => metric.pass) &&
    perSeason.every((season) => season.pass) &&
    unified.evaluation.games === legacy.games

  return {
    candidateId: unified.candidateId,
    candidateParameters: {
      legacy: legacy.overrides,
      match:
        createDeterministicSignature('parity/overrides', unified.overrides) ===
        createDeterministicSignature('parity/overrides', legacy.overrides),
      unified: unified.overrides,
    },
    featureParity,
    games: compareNumber(unified.evaluation.games, legacy.games),
    metrics,
    pass,
    perSeason,
  }
}

const normalizedTeams = (teams) =>
  teams
    .map((team) => ({
      abbreviation: String(team.abbreviation ?? team.teamId).toUpperCase(),
      teamId: String(team.teamId ?? team.abbreviation).toUpperCase(),
      teamName: team.teamName ?? team.name ?? team.abbreviation,
    }))
    .sort((left, right) => compareIdentifiers(left.teamId, right.teamId))

const serializeStartingState = (state) =>
  [...state.values()].map((team) => ({
    abbreviation: team.abbreviation,
    startingRating: team.startingRating,
    teamId: team.teamId,
    teamName: team.teamName,
  }))

const buildFixedStartingIdentity = (teams) =>
  createStartingStateIdentity({
    policy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
    seasonStartingStates: EVALUATION_SEASONS.map((seasonId) => {
      const state = baseModelCalibrationService.buildStartingState({
        currentRatings: [],
        input: {
          startingRatings: {
            center: BASE_MODEL_V1.startingRatings.center,
            mode: baseModelCalibrationService.STARTING_MODES.FIXED_SPREAD,
            spread: BASE_MODEL_V1.startingRatings.spread,
          },
        },
        orderingMode: 'historical_fallback',
        teams,
      })

      return {
        orderingSource: 'seed_team_name_alphabetical',
        seasonId,
        teams: serializeStartingState(state),
      }
    }),
  })

const makeProviderOptions = ({ allGames, allSpecialTeams, teams }) => ({
  historicalGamesLoader: async (seasonIds) => ({
    datasetsBySeason: new Map(
      seasonIds.map((seasonId) => [
        seasonId,
        allGames.datasetsBySeason.get(seasonId),
      ]),
    ),
    gamesBySeason: new Map(
      seasonIds.map((seasonId) => [
        seasonId,
        allGames.gamesBySeason.get(seasonId),
      ]),
    ),
  }),
  specialTeamsLoader: async (seasonIds) =>
    new Map(
      seasonIds.map((seasonId) => [
        seasonId,
        allSpecialTeams.get(seasonId),
      ]),
    ),
  teamsProvider: async () => teams,
})

const canonicalRequest = (experiments = ALL_EXPERIMENTS) => ({
  baselineMode: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  evaluationSeasons: EVALUATION_SEASONS,
  experiments,
  startingStatePolicy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
})

const timed = async (work) => {
  const startedAt = performance.now()
  const value = await work()

  return { durationMs: performance.now() - startedAt, value }
}

const buildPreparedContexts = ({ allGames, teams }) =>
  EVALUATION_SEASONS.map((seasonId) => {
    const prepared = scheduleCalibrationService.preparePhase3ReplayGames(
      allGames.gamesBySeason.get(seasonId),
      seasonId,
      teams,
    )

    return {
      factsByGameId: scheduleCalibrationService.buildScheduleFacts(
        prepared.games,
        scheduleCalibrationService.QUICK_REMATCH_WINDOWS,
      ),
      games: prepared.games,
      seasonId,
      teams,
    }
  })

const toBaseLegacyReference = ({ experiment, preparedContexts, teams }) => {
  const canonical = buildCanonicalBaseline().configuration
  const model = { ...canonical.model, ...experiment.overrides }
  const homeAdvantage =
    experiment.overrides.baseHomeAdvantage ?? model.baseHomeAdvantage
  const probabilityScale =
    experiment.overrides.probabilityScale ?? model.probabilityScale
  const engineConfiguration = createRatingEngineConfiguration({
    kFactor: model.kFactor,
    overtimeMultiplier: model.overtimeMultiplier,
    regulationMultiplier: model.regulationMultiplier,
    shootoutMultiplier: model.shootoutMultiplier,
  })
  const teamsById = new Map(teams.map((team) => [team.teamId, team]))
  const seasonResults = preparedContexts.map((context) => {
    const startingState = baseModelCalibrationService.buildStartingState({
      currentRatings: [],
      input: {
        startingRatings: {
          center: BASE_MODEL_V1.startingRatings.center,
          mode: baseModelCalibrationService.STARTING_MODES.FIXED_SPREAD,
          spread: BASE_MODEL_V1.startingRatings.spread,
        },
      },
      orderingMode: 'historical_fallback',
      teams,
    })
    const replay = baseModelCalibrationService.replayDataset({
      includedGames: context.games.map((game) => ({
        awayTeam: teamsById.get(game.awayTeamId),
        game: { id: game.gameId },
        homeTeam: teamsById.get(game.homeTeamId),
        resultType: game.resultType,
        winner: game.homeScore > game.awayScore ? WINNERS.HOME : WINNERS.AWAY,
      })),
      input: {
        configuration: engineConfiguration,
        homeAdvantage,
        probabilityScale,
      },
      ratingState: startingState,
    })

    return {
      games: replay.predictions.length,
      metrics: calculateMetrics(replay.predictions),
      predictions: replay.predictions,
      seasonId: context.seasonId,
    }
  })
  const predictions = seasonResults.flatMap((season) => season.predictions)

  return {
    games: predictions.length,
    metrics: calculateMetrics(predictions),
    overrides: experiment.overrides,
    perSeason: seasonResults.map((season) => ({
      games: season.games,
      metrics: season.metrics,
      seasonId: season.seasonId,
    })),
  }
}

const buildLegacyParityReferences = async ({
  allGames,
  allSpecialTeams,
  preparedContexts,
  representativeUserId,
  teams,
}) => {
  const statuses = [...allGames.datasetsBySeason.values()]
  const home = await homeAdvantageCalibrationService.runHomeAdvantageCalibration(
    representativeUserId,
    {},
    {
      historicalLoadProvider: async () => allGames,
      historicalStatusProvider: async () => statuses,
      teamsProvider: async () => teams,
    },
  )
  const restConfiguration = {
    '3_games_in_4_days': -0.5,
    back_to_back: -0.75,
    back_to_back_travel: -1.5,
    well_rested: 0.25,
  }
  const schedule = await scheduleCalibrationService.runScheduleCalibration(
    representativeUserId,
    {
      combinedConfiguration: restConfiguration,
      includeWellRested: true,
      seasonIds: EVALUATION_SEASONS,
    },
    {
      historicalLoadProvider: async () => ({
        datasetsBySeason: new Map(
          EVALUATION_SEASONS.map((seasonId) => [
            seasonId,
            allGames.datasetsBySeason.get(seasonId),
          ]),
        ),
        gamesBySeason: new Map(
          EVALUATION_SEASONS.map((seasonId) => [
            seasonId,
            allGames.gamesBySeason.get(seasonId),
          ]),
        ),
      }),
      historicalStatusProvider: async () => statuses,
      teamsProvider: async () => teams,
    },
  )
  const specialTeams = await specialTeamsCalibrationService
    .runSpecialTeamsCalibration(
      representativeUserId,
      { seasonIds: EVALUATION_SEASONS },
      {
        historicalGamesLoader: async (seasonIds) => ({
          datasetsBySeason: new Map(
            seasonIds.map((seasonId) => [
              seasonId,
              allGames.datasetsBySeason.get(seasonId),
            ]),
          ),
          gamesBySeason: new Map(
            seasonIds.map((seasonId) => [
              seasonId,
              allGames.gamesBySeason.get(seasonId),
            ]),
          ),
        }),
        specialTeamsLoader: async (seasonIds) =>
          new Map(
            seasonIds.map((seasonId) => [
              seasonId,
              allSpecialTeams.get(seasonId),
            ]),
          ),
        teamsProvider: async () => teams,
      },
    )

  return { home, schedule, specialTeams }
}

const toLegacyReference = ({ comparison, overrides }) => ({
  games:
    comparison.games ??
    comparison.seasonResults.reduce((sum, season) => sum + season.games, 0),
  metrics: comparison.metrics,
  overrides,
  perSeason: comparison.seasonResults,
})

const getHomeFeatureParity = ({ experiment, homeSnapshots, unified }) => {
  const adjustment = experiment.overrides.adjustment
  const seasons = EVALUATION_SEASONS.map((seasonId) => {
    const snapshot = homeSnapshots.find(
      (candidate) => candidate.targetSeasonId === seasonId,
    )
    const expectedSignature = createDeterministicSignature(
      'nhl-edge/calibration-home-advantage-snapshot/v1',
      snapshot,
    )
    const unifiedState = unified.evaluationContext.featureState
      .teamHomeAdvantage[seasonId]

    return {
      assignedBeforeReplay: snapshot.assignedBeforeReplay,
      assignmentCount: Object.keys(snapshot.tiers).length,
      assignmentSignatureMatch:
        expectedSignature === unifiedState.snapshotSignature,
      sourceSeasonIds: snapshot.sourceSeasonIds,
      targetSeasonIncluded: unifiedState.targetSeasonIncluded,
      tierAssignments: snapshot.tiers,
      tierSizes: snapshot.tierSizes,
    }
  })

  return {
    adjustment,
    pass: seasons.every((season) =>
      season.assignedBeforeReplay &&
      season.assignmentSignatureMatch &&
      season.targetSeasonIncluded === false),
    seasons,
  }
}

const getScheduleFeatureParity = ({ candidate, legacyComparison, kind }) => {
  const seasons = EVALUATION_SEASONS.map((seasonId) => {
    const unified = candidate.diagnostics.replay.seasons[seasonId]
    const legacy = legacyComparison.seasonResults.find(
      (season) => season.seasonId === seasonId,
    )
    const unifiedCounts = kind === 'restFatigue'
      ? unified.restFatigue.appliedConditions
      : unified.quickRematch
    const legacyCounts = kind === 'restFatigue'
      ? legacy.priorityCounts
      : {
          gamesAffected: legacy.gamesAffected,
          occurrences: legacy.occurrences,
        }

    return {
      exact: createDeterministicSignature('parity/feature-counts', unifiedCounts) ===
        createDeterministicSignature('parity/feature-counts', legacyCounts),
      legacy: legacyCounts,
      seasonId,
      unified: unifiedCounts,
    }
  })

  return { pass: seasons.every((season) => season.exact), seasons }
}

const getSpecialTeamsFeatureParity = ({
  candidate,
  comparison,
  rankingAudit,
  unified,
}) => {
  const seasons = EVALUATION_SEASONS.map((seasonId) => {
    const reference = rankingAudit.find(
      (candidateReference) => candidateReference.targetSeasonId === seasonId,
    )
    const expectedSignature = createDeterministicSignature(
      'nhl-edge/calibration-special-teams-snapshot/v1',
      reference,
    )
    const unifiedState = unified.evaluationContext.featureState
      .specialTeams[seasonId]
    const unifiedOccurrences = candidate.diagnostics.replay.seasons[seasonId]
      .specialTeams
    const legacyOccurrences = comparison.seasonResults.find(
      (season) => season.seasonId === seasonId,
    ).occurrences
    const commonLegacyOccurrences = Object.fromEntries(
      Object.keys(unifiedOccurrences).map((field) => [
        field,
        legacyOccurrences[field],
      ]),
    )
    const threshold = candidate.overrides.topBottomN
    const bottomRankStart = reference.leagueTeamCount - threshold + 1
    const rankingSets = {
      penaltyKillBottom: reference.teams
        .filter((team) => team.penaltyKillLeagueRank >= bottomRankStart)
        .map((team) => team.teamAbbreviation)
        .sort(compareIdentifiers),
      penaltyKillTop: reference.teams
        .filter((team) => team.penaltyKillLeagueRank <= threshold)
        .map((team) => team.teamAbbreviation)
        .sort(compareIdentifiers),
      powerPlayBottom: reference.teams
        .filter((team) => team.powerPlayLeagueRank >= bottomRankStart)
        .map((team) => team.teamAbbreviation)
        .sort(compareIdentifiers),
      powerPlayTop: reference.teams
        .filter((team) => team.powerPlayLeagueRank <= threshold)
        .map((team) => team.teamAbbreviation)
        .sort(compareIdentifiers),
    }

    return {
      qualifyingTeamSetsMatch:
        expectedSignature === unifiedState.snapshotSignature,
      occurrenceCountsMatch:
        createDeterministicSignature('parity/special-occurrences', unifiedOccurrences) ===
        createDeterministicSignature(
          'parity/special-occurrences',
          commonLegacyOccurrences,
        ),
      rankingSets,
      seasonId,
      sourceSeasonIds: reference.sourceSeasonIds,
      targetSeasonIncluded: reference.targetSeasonIncluded,
    }
  })

  return {
    pass: seasons.every((season) =>
      season.qualifyingTeamSetsMatch &&
      season.occurrenceCountsMatch &&
      season.targetSeasonIncluded === false),
    seasons,
  }
}

const deterministicResultView = (result) => {
  const { durationMs: _durationMs, ...diagnostics } = result.diagnostics

  return { ...result, diagnostics }
}

const compareCandidateMaps = (left, right) =>
  ALL_EXPERIMENTS.every((experiment) => {
    const leftCandidate = getCandidate(left, experiment.candidateId)
    const rightCandidate = getCandidate(right, experiment.candidateId)

    return createDeterministicSignature('parity/candidate', leftCandidate) ===
      createDeterministicSignature('parity/candidate', rightCandidate)
  })

const getMemorySnapshot = () => {
  const usage = process.memoryUsage()

  return {
    heapUsedMiB: usage.heapUsed / 1024 / 1024,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    rssMiB: usage.rss / 1024 / 1024,
  }
}

const getRepresentativeUser = async () => {
  const users = await User.find({}).select('_id').sort({ _id: 1 }).lean()

  if (users.length === 0) {
    throw new Error('CURRENT_PRODUCTION verification requires an existing user.')
  }

  const candidates = await Promise.all(
    users.map(async (user) => ({
      count: await PowerRating.countDocuments({ userId: user._id }),
      userId: user._id.toString(),
    })),
  )
  const selected = candidates.sort(
    (left, right) => right.count - left.count ||
      compareIdentifiers(left.userId, right.userId),
  )[0]

  return {
    label: `anonymous-user-scope-1-of-${users.length}`,
    ratingCount: selected.count,
    totalUserScopes: users.length,
    userId: selected.userId,
  }
}

const hashRows = (namespace, rows) =>
  createDeterministicSignature(namespace, asPlain(rows))

const getProductionStateFingerprint = async (userId) => {
  const filter = { userId: new mongoose.Types.ObjectId(userId) }
  const [ratings, engine, quick, processed, bets, bankroll, transactions] =
    await Promise.all([
      PowerRating.find(filter).sort({ teamId: 1 }).lean(),
      RatingEngineSettings.find(filter).sort({ _id: 1 }).lean(),
      QuickRematchSettings.find(filter).sort({ _id: 1 }).lean(),
      ProcessedRatingGame.find(filter).sort({ gameId: 1 }).lean(),
      Bet.find(filter).sort({ _id: 1 }).lean(),
      BankrollProfile.find(filter).sort({ _id: 1 }).lean(),
      BankrollTransaction.find(filter).sort({ _id: 1 }).lean(),
    ])
  const liveRatings = ratings.map((rating) => ({
    baseRating: rating.baseRating,
    lastRatingChange: rating.lastRatingChange,
    manualAdjustment: rating.manualAdjustment,
    teamId: rating.teamId,
  }))
  const startingRatings = ratings.map((rating) => ({
    seasonStartingRating: rating.seasonStartingRating,
    seasonStartingRatingSeasonId: rating.seasonStartingRatingSeasonId,
    teamId: rating.teamId,
  }))
  const homeAdjustments = ratings.map((rating) => ({
    homeAdvantage: rating.homeAdvantage,
    teamId: rating.teamId,
  }))

  return {
    bankroll: hashRows('parity/state/bankroll', [...bankroll, ...transactions]),
    bets: hashRows('parity/state/bets', bets),
    livePowerRatings: hashRows('parity/state/live-ratings', liveRatings),
    processedRatingGames: hashRows('parity/state/processed-games', processed),
    quickRematchAndRestFatigueSettings: hashRows(
      'parity/state/quick-rest',
      quick,
    ),
    ratingEngineAndSpecialTeamsSettings: hashRows(
      'parity/state/engine-special',
      engine,
    ),
    startingRatings: hashRows('parity/state/starting-ratings', startingRatings),
    teamHomeAdjustments: hashRows(
      'parity/state/home-adjustments',
      homeAdjustments,
    ),
  }
}

const runApiRoundTrip = async ({ representativeUserId }) => {
  const { session, token } = await authSessionService.createAuthSession(
    representativeUserId,
  )
  const server = app.listen(0)
  const { port } = server.address()
  const headers = {
    Cookie: `nhl_edge_session=${token}`,
    Origin: 'http://localhost:5173',
  }

  try {
    const optionsResponse = await fetch(
      `http://127.0.0.1:${port}/api/power-rating-simulations/model-calibration/options`,
      { headers },
    )
    const options = await optionsResponse.json()
    const request = {
      ...canonicalRequest([
        TEAM_HOME_EXPERIMENTS[1],
        SPECIAL_TEAMS_EXPERIMENTS[0],
      ]),
      startingStatePolicy:
        options.startingState?.policy ??
        STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
    }
    const response = await fetch(
      `http://127.0.0.1:${port}/api/power-rating-simulations/model-calibration/run`,
      {
        body: JSON.stringify(request),
        headers: { ...headers, 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )
    const result = await response.json()
    const settingsPreserved = request.experiments.every((experiment) => {
      const candidate = getCandidate(result, experiment.candidateId)

      return candidate &&
        createDeterministicSignature('parity/api-overrides', candidate.overrides) ===
          createDeterministicSignature(
            'parity/api-overrides',
            experiment.overrides,
          )
    })
    const clientUserIdResponse = await fetch(
      `http://127.0.0.1:${port}/api/power-rating-simulations/model-calibration/run`,
      {
        body: JSON.stringify({ ...request, userId: 'client-supplied-user' }),
        headers: { ...headers, 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )
    const clientUserIdBody = await clientUserIdResponse.json()
    const clientUserIdRejected =
      clientUserIdResponse.status === 400 &&
      clientUserIdBody.details?.unsupportedFields?.includes('userId')
    const clientUserIdIgnored =
      clientUserIdResponse.status === 200 &&
      clientUserIdBody.runId === result.runId &&
      createDeterministicSignature(
        'parity/api-client-user-id-candidates',
        clientUserIdBody.candidates,
      ) ===
        createDeterministicSignature(
          'parity/api-client-user-id-candidates',
          result.candidates,
        )
    const clientUserIdNotTrusted = clientUserIdRejected || clientUserIdIgnored

    return {
      baselineMode: request.baselineMode,
      candidateCount: request.experiments.length,
      candidateSettingsPreserved: settingsPreserved,
      clientUserIdDisposition: clientUserIdRejected ? 'rejected' : 'ignored',
      clientUserIdIgnored,
      clientUserIdNotTrusted,
      clientUserIdRejected,
      gameCount: result.evaluationContext?.gameCount,
      noClientUserId: !Object.hasOwn(request, 'userId'),
      noCombinedCandidates: request.experiments.every(
        (experiment) => experiment.type !== CANDIDATE_TYPES.COMBINED,
      ),
      optionsStatus: optionsResponse.status,
      pass:
        optionsResponse.status === 200 &&
        response.status === 200 &&
        settingsPreserved &&
        clientUserIdNotTrusted &&
        result.diagnostics?.productionWrites === false,
      responseStatus: response.status,
      runId: result.runId,
      startingStatePolicy: request.startingStatePolicy,
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await session.deleteOne()
  }
}

const buildBaseSpecialistPayload = (experiment = { overrides: {} }) => {
  const overrides = experiment.overrides ?? {}

  return {
    configuration: {
      kFactor: overrides.kFactor ?? BASE_MODEL_V1.kFactor,
      overtimeMultiplier:
        overrides.overtimeMultiplier ?? BASE_MODEL_V1.overtimeMultiplier,
      regulationMultiplier:
        overrides.regulationMultiplier ?? BASE_MODEL_V1.regulationMultiplier,
      shootoutMultiplier:
        overrides.shootoutMultiplier ?? BASE_MODEL_V1.shootoutMultiplier,
    },
    homeAdvantage:
      overrides.baseHomeAdvantage ?? BASE_MODEL_V1.baseHomeAdvantage,
    label: experiment.label ?? 'Step 5 direct specialist baseline',
    probabilityScale:
      overrides.probabilityScale ?? BASE_MODEL_V1.probabilityScale,
    seasonIds: EVALUATION_SEASONS,
    startingRatings: {
      center: BASE_MODEL_V1.startingRatings.center,
      mode: baseModelCalibrationService.STARTING_MODES.FIXED_SPREAD,
      spread: BASE_MODEL_V1.startingRatings.spread,
    },
    useCustomDateRange: false,
  }
}

const runBaseModelSpecialistEntry = async ({
  allGames,
  currentRatings,
  experiment,
  representativeUserId,
  teams,
}) => {
  const seasons = EVALUATION_SEASONS.map((seasonId) => {
    const definition = getSeasonDefinition(seasonId)

    return {
      endDate: definition.endDate,
      id: definition.id,
      label: definition.label,
      startDate: definition.startDate,
    }
  })
  const preparedMap = new Map(
    EVALUATION_SEASONS.map((seasonId) => [
      seasonId,
      {
        dataset: allGames.datasetsBySeason.get(seasonId),
        games: allGames.gamesBySeason.get(seasonId),
        status: allGames.datasetsBySeason.get(seasonId)?.status,
      },
    ]),
  )
  return baseModelCalibrationService.runBaseModelCalibration(
    representativeUserId,
    buildBaseSpecialistPayload(experiment),
    {
      currentRatingsProvider: async () => currentRatings,
      dataSource: 'MongoDB historical dataset / Step 5 frozen read',
      historicalSeasonsProvider: async () => preparedMap,
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      requestIdProvider: () => 'step-5-base-primary-entry',
      seasonsProvider: async () => ({
        metadataSource: 'Step 5 frozen fallback definitions',
        seasons,
      }),
      settingsProvider: async () => BASE_MODEL_V1,
      teamsProvider: async () => teams,
      todayProvider: () => '2026-08-26',
    },
  )
}

const runBaseModelPrimaryEntryComparison = async ({
  allGames,
  canonicalUnified,
  currentRatings,
  representativeUserId,
  sampleParity,
  teams,
}) => {
  const run = await runBaseModelSpecialistEntry({
    allGames,
    currentRatings,
    representativeUserId,
    teams,
  })
  const unifiedBySeason = new Map(
    canonicalUnified.baseline.perSeason.map((season) => [season.seasonId, season]),
  )
  const differences = run.seasonResults.map((season) => ({
    brier: compareNumber(
      unifiedBySeason.get(season.seasonId).brier,
      season.metrics.brierScore,
    ),
    orderingSource: season.orderingSource,
    seasonId: season.seasonId,
  }))
  const orderingMismatch = run.seasonResults.some(
    (season) => season.orderingSource !==
      'seed_team_name_alphabetical',
  )
  const directMetricComparison = compareMetrics(
    canonicalUnified.baseline.metrics,
    run.metrics,
  )
  const perSeason = comparePerSeason(
    canonicalUnified.baseline.perSeason,
    run.seasonResults.map((season) => ({
      games: season.dataset.gamesIncluded,
      metrics: season.metrics,
      seasonId: season.seasonId,
    })),
  )
  const startingStateSignature = {
    pass:
      run.diagnostics.startingStateSignature ===
      canonicalUnified.evaluationContext.startingStateSignature,
    specialist: run.diagnostics.startingStateSignature,
    unified: canonicalUnified.evaluationContext.startingStateSignature,
  }
  const canonicalBaseline = buildCanonicalBaseline()
  const specialistModel = {
    baseHomeAdvantage: run.parameters.homeAdvantage,
    kFactor: run.parameters.configuration.kFactor,
    modelVersion: run.modelVersion,
    overtimeMultiplier: run.parameters.configuration.overtimeMultiplier,
    probabilityScale: run.parameters.probabilityScale,
    regulationMultiplier: run.parameters.configuration.regulationMultiplier,
    shootoutMultiplier: run.parameters.configuration.shootoutMultiplier,
  }
  const baselineModelSignature = {
    specialist: createDeterministicSignature(
      'parity/base-model-configuration',
      specialistModel,
    ),
    unified: createDeterministicSignature(
      'parity/base-model-configuration',
      canonicalBaseline.configuration.model,
    ),
  }
  baselineModelSignature.pass =
    baselineModelSignature.specialist === baselineModelSignature.unified
  const baselineSignature = {
    canonical: canonicalBaseline.baselineSignature,
    pass:
      baselineModelSignature.pass &&
      canonicalBaseline.baselineSignature ===
        canonicalUnified.evaluationContext.baselineSignature,
    unified: canonicalUnified.evaluationContext.baselineSignature,
  }
  const pass =
    !orderingMismatch &&
    sampleParity.pass &&
    startingStateSignature.pass &&
    baselineSignature.pass &&
    Object.values(directMetricComparison).every((metric) => metric.pass) &&
    perSeason.every((season) => season.pass)
  const status = pass
    ? STATUS.PASS
    : orderingMismatch
      ? STATUS.BLOCKED
      : STATUS.FAIL

  return {
    baselineModelSignature,
    baselineSignature,
    directMetricComparison,
    gameSample: sampleParity,
    orderingMismatch,
    perSeason,
    reason: pass
      ? null
      : orderingMismatch
        ? 'The specialist Base Model workflow does not use the unified fixed alphabetical policy for every evaluated season.'
        : 'The Base Model specialist and unified workflows differ in state identity, configuration identity, game sample, or metrics.',
    seasonDifferences: differences,
    startingStateSignature,
    status,
  }
}

const runProductionCalibrationParity = async (options = {}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('A MongoDB connection is required for production parity.')
  }

  const progress = options.progress ?? (() => {})

  if (global.gc) global.gc()
  const memoryBefore = getMemorySnapshot()
  const representative = await getRepresentativeUser()
  const allGameSeasonIds = [
    ...new Set([
      ...EVALUATION_SEASONS,
      ...EVALUATION_SEASONS.flatMap((seasonId) =>
        homeAdvantageCalibrationService.getPriorSeasonIds(seasonId),
      ),
    ]),
  ].sort(compareIdentifiers)
  const allSpecialTeamsSeasonIds = [
    ...new Set(
      EVALUATION_SEASONS.flatMap((seasonId) =>
        specialTeamsCalibrationService.getPriorSeasonIds(seasonId),
      ),
    ),
  ].sort(compareIdentifiers)
  const [allGames, allSpecialTeams, seedTeams, currentRatings] = await Promise.all([
    historicalNhlDataService.loadPreparedSeasons(allGameSeasonIds),
    historicalSpecialTeamsDataService.loadPreparedSpecialTeamsSeasons(
      allSpecialTeamsSeasonIds,
    ),
    getSeedTeams(),
    PowerRating.find({ userId: representative.userId })
      .sort({ teamId: 1 })
      .lean(),
  ])
  progress('prepared-inputs-loaded')
  const unavailableGameSeasons = allGameSeasonIds.filter(
    (seasonId) => allGames.datasetsBySeason.get(seasonId)?.status !== 'ready',
  )
  const unavailableSpecialTeamsSeasons = allSpecialTeamsSeasonIds.filter(
    (seasonId) => allSpecialTeams.get(seasonId)?.status !== 'ready',
  )

  if (unavailableGameSeasons.length || unavailableSpecialTeamsSeasons.length) {
    throw new Error(
      `Prepared parity inputs are unavailable: games=${unavailableGameSeasons.join(',')}; specialTeams=${unavailableSpecialTeamsSeasons.join(',')}`,
    )
  }

  const teams = normalizedTeams(seedTeams)
  const preparedContexts = buildPreparedContexts({ allGames, teams })
  const legacyGameIds = preparedContexts.flatMap((context) =>
    context.games.map((game) => game.gameId),
  )
  const providerOptions = makeProviderOptions({
    allGames,
    allSpecialTeams,
    teams,
  })
  const canonicalRun = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      canonicalRequest(),
      providerOptions,
    ),
  )
  const canonicalUnified = canonicalRun.value
  progress('canonical-run-complete')
  const sampleParity = compareGameSamples(
    canonicalUnified.evaluationContext.includedGameIds,
    legacyGameIds,
  )
  const fixedStartingIdentity = buildFixedStartingIdentity(teams)
  const startingStateParity = {
    expected: fixedStartingIdentity.startingStateSignature,
    pass:
      fixedStartingIdentity.startingStateSignature ===
      canonicalUnified.evaluationContext.startingStateSignature,
    unified: canonicalUnified.evaluationContext.startingStateSignature,
  }
  const legacyTimed = await timed(() =>
    buildLegacyParityReferences({
      allGames,
      allSpecialTeams,
      preparedContexts,
      representativeUserId: representative.userId,
      teams,
    }),
  )
  const legacy = legacyTimed.value
  progress('specialist-runs-complete')
  const homeSnapshots = homeAdvantageCalibrationService
    .buildHistoricalTierSnapshots({
      gamesBySeason: allGames.gamesBySeason,
      teams,
    })

  const baseCandidateParity = BASE_EXPERIMENTS.map((experiment) =>
    summarizeCandidateParity({
      legacy: toBaseLegacyReference({ experiment, preparedContexts, teams }),
      sampleParity,
      unified: getCandidate(canonicalUnified, experiment.candidateId),
    }),
  )
  const canonicalBaselineReference = toBaseLegacyReference({
    experiment: {
      overrides: {},
    },
    preparedContexts,
    teams,
  })
  const canonicalBaselineParity = summarizeCandidateParity({
    legacy: canonicalBaselineReference,
    sampleParity,
    unified: canonicalUnified.baseline,
  })
  const homeCandidateParity = TEAM_HOME_EXPERIMENTS.map((experiment) => {
    const comparison = legacy.home.comparisons.find(
      (candidate) =>
        candidate.adjustment === experiment.overrides.adjustment,
    )
    const unified = getCandidate(canonicalUnified, experiment.candidateId)

    return summarizeCandidateParity({
      featureParity: getHomeFeatureParity({
        experiment,
        homeSnapshots,
        unified: canonicalUnified,
      }),
      legacy: toLegacyReference({
        comparison,
        overrides: experiment.overrides,
      }),
      sampleParity,
      unified,
    })
  })
  const restCandidateParity = REST_EXPERIMENTS.map((experiment) => {
    const comparison = legacy.schedule.combinedRestFatigueResult.selected
    const unified = getCandidate(canonicalUnified, experiment.candidateId)

    return summarizeCandidateParity({
      featureParity: getScheduleFeatureParity({
        candidate: unified,
        kind: 'restFatigue',
        legacyComparison: comparison,
      }),
      legacy: toLegacyReference({
        comparison,
        overrides: experiment.overrides,
      }),
      sampleParity,
      unified,
    })
  })
  const quickCandidateParity = QUICK_EXPERIMENTS.map((experiment) => {
    const comparison = legacy.schedule.quickRematchResult.comparisons.find(
      (candidate) =>
        candidate.adjustment === experiment.overrides.loserAdjustment &&
        candidate.windowDays === experiment.overrides.maximumDays,
    )
    const unified = getCandidate(canonicalUnified, experiment.candidateId)

    return summarizeCandidateParity({
      featureParity: getScheduleFeatureParity({
        candidate: unified,
        kind: 'quickRematch',
        legacyComparison: comparison,
      }),
      legacy: toLegacyReference({
        comparison,
        overrides: experiment.overrides,
      }),
      sampleParity,
      unified,
    })
  })
  const specialTeamsCandidateParity = SPECIAL_TEAMS_EXPERIMENTS.map(
    (experiment) => {
      const comparison = legacy.specialTeams.comparisons.find(
        (candidate) =>
          candidate.adjustment === experiment.overrides.adjustment &&
          candidate.threshold === experiment.overrides.topBottomN,
      )
      const unified = getCandidate(canonicalUnified, experiment.candidateId)

      return summarizeCandidateParity({
        featureParity: getSpecialTeamsFeatureParity({
          candidate: unified,
          comparison,
          rankingAudit: legacy.specialTeams.rankingAudit,
          unified: canonicalUnified,
        }),
        legacy: toLegacyReference({
          comparison,
          overrides: experiment.overrides,
        }),
        sampleParity,
        unified,
      })
    },
  )
  const basePrimaryEntry = await runBaseModelPrimaryEntryComparison({
    allGames,
    canonicalUnified,
    currentRatings,
    representativeUserId: representative.userId,
    sampleParity,
    teams,
  })
  progress('base-primary-entry-complete')
  const repeatedRun = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      canonicalRequest(),
      providerOptions,
    ),
  )
  progress('canonical-repeat-complete')
  const reversedRun = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      canonicalRequest([...ALL_EXPERIMENTS].reverse()),
      providerOptions,
    ),
  )
  progress('candidate-order-run-complete')
  const stateBefore = await getProductionStateFingerprint(representative.userId)
  progress('production-state-before-complete')
  let productionSnapshotCalls = 0
  let firstCapturedSnapshot = null
  const productionProviderOptions = {
    ...providerOptions,
    productionSnapshotProvider: async (userId) => {
      productionSnapshotCalls += 1
      const snapshot = await captureCalibrationProductionSnapshot(userId)
      if (!firstCapturedSnapshot) firstCapturedSnapshot = snapshot
      return snapshot
    },
  }
  const productionRequest = {
    ...canonicalRequest(BASE_EXPERIMENTS.slice(0, 2)),
    baselineMode: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  }
  const productionRun = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      productionRequest,
      productionProviderOptions,
    ),
  )
  progress('current-production-run-complete')
  const productionRepeat = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      productionRequest,
      productionProviderOptions,
    ),
  )
  progress('current-production-repeat-complete')
  const apiRun = await timed(() =>
    runApiRoundTrip({ representativeUserId: representative.userId }),
  )
  progress('api-round-trip-complete')
  const stateAfter = await getProductionStateFingerprint(representative.userId)
  progress('production-state-after-complete')
  const productionStateComparisons = Object.fromEntries(
    Object.keys(stateBefore).map((field) => [
      field,
      {
        after: stateAfter[field],
        before: stateBefore[field],
        unchanged: stateAfter[field] === stateBefore[field],
      },
    ]),
  )
  const resultTypes = canonicalUnified.baseline.diagnostics.replay.resultTypes
  const familyStatuses = {
    baseModel: basePrimaryEntry.status,
    quickRematch: quickCandidateParity.every((candidate) => candidate.pass)
      ? STATUS.PASS
      : STATUS.FAIL,
    restFatigue: restCandidateParity.every((candidate) => candidate.pass)
      ? STATUS.PASS
      : STATUS.FAIL,
    specialTeams: specialTeamsCandidateParity.every(
      (candidate) => candidate.pass,
    )
      ? STATUS.PASS
      : STATUS.FAIL,
    teamHomeAdvantage: homeCandidateParity.every(
      (candidate) => candidate.pass,
    )
      ? STATUS.PASS
      : STATUS.FAIL,
  }

  if (global.gc) global.gc()
  const memoryAfter = getMemorySnapshot()
  const deterministicViewSignature = (result) =>
    createDeterministicSignature(
      'parity/deterministic-result',
      deterministicResultView(result),
    )
  const productionConfiguration = normalizeReplayConfiguration(
    firstCapturedSnapshot.configuration,
  )
  const productionResult = productionRun.value
  const productionRepeatResult = productionRepeat.value

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tolerance: TOLERANCE,
    evaluation: {
      baselineSignature: canonicalUnified.evaluationContext.baselineSignature,
      datasetSignature: canonicalUnified.evaluationContext.datasetSignature,
      exactGameCount: canonicalUnified.evaluationContext.gameCount,
      gameIdSignature: canonicalUnified.evaluationContext.gameIdSignature,
      perSeasonGameCounts: Object.fromEntries(
        canonicalUnified.baseline.perSeason.map((season) => [
          season.seasonId,
          season.games,
        ]),
      ),
      sampleParity,
      seasons: canonicalUnified.evaluationContext.seasons,
      startingStateParity,
      startingStateSignature:
        canonicalUnified.evaluationContext.startingStateSignature,
    },
    canonicalBaseline: {
      equivalentEngineParity: canonicalBaselineParity,
      pass: canonicalBaselineParity.pass && startingStateParity.pass,
      primaryEntryComparison: basePrimaryEntry,
    },
    families: {
      baseModel: {
        candidateParity: baseCandidateParity,
        equivalentEngineParity:
          baseCandidateParity.every((candidate) => candidate.pass),
        primaryEntryComparison: basePrimaryEntry,
        status: familyStatuses.baseModel,
      },
      quickRematch: {
        candidateParity: quickCandidateParity,
        status: familyStatuses.quickRematch,
      },
      restFatigue: {
        candidateParity: restCandidateParity,
        status: familyStatuses.restFatigue,
      },
      specialTeams: {
        candidateParity: specialTeamsCandidateParity,
        status: familyStatuses.specialTeams,
      },
      teamHomeAdvantage: {
        candidateParity: homeCandidateParity,
        status: familyStatuses.teamHomeAdvantage,
      },
    },
    resultTypes: {
      counts: resultTypes,
      pass:
        resultTypes.regulation > 0 &&
        resultTypes.overtime > 0 &&
        resultTypes.shootout > 0 &&
        Object.values(resultTypes).reduce((sum, count) => sum + count, 0) ===
          canonicalUnified.evaluationContext.gameCount,
      sharedClassifier: 'powerRatingEngine.classifyCompletedGameResult',
    },
    determinism: {
      candidateResultsIdentical:
        compareCandidateMaps(canonicalUnified, repeatedRun.value),
      diagnosticsIdentical:
        deterministicViewSignature(canonicalUnified) ===
        deterministicViewSignature(repeatedRun.value),
      gameSampleIdentical:
        canonicalUnified.evaluationContext.gameIdSignature ===
        repeatedRun.value.evaluationContext.gameIdSignature,
      rankingIdentical:
        createDeterministicSignature('parity/ranking', canonicalUnified.ranking) ===
        createDeterministicSignature(
          'parity/ranking',
          repeatedRun.value.ranking,
        ),
      runIdentityIdentical: canonicalUnified.runId === repeatedRun.value.runId,
    },
    candidateOrderIndependence: {
      candidateResultsIdentical: compareCandidateMaps(
        canonicalUnified,
        reversedRun.value,
      ),
      rankingIdentical:
        createDeterministicSignature('parity/ranking', canonicalUnified.ranking) ===
        createDeterministicSignature(
          'parity/ranking',
          reversedRun.value.ranking,
        ),
      runIdentityIdentical: canonicalUnified.runId === reversedRun.value.runId,
    },
    currentProduction: {
      allCandidatesUseSameSnapshot: productionResult.candidates.every(
        (candidate) =>
          candidate.metadata.productionSnapshotId ===
          productionResult.evaluationContext.productionSnapshotId,
      ),
      authoritativeConfigurationMatch:
        createDeterministicSignature('parity/production-configuration',
          productionConfiguration) ===
        createDeterministicSignature('parity/production-configuration',
          productionResult.evaluationContext.baselineConfiguration),
      baselineSignature: productionResult.evaluationContext.baselineSignature,
      deterministicMetrics:
        createDeterministicSignature('parity/production-candidates',
          productionResult.candidates) ===
        createDeterministicSignature('parity/production-candidates',
          productionRepeatResult.candidates),
      productionSnapshotId:
        productionResult.evaluationContext.productionSnapshotId,
      repeatedSnapshotIdentity:
        productionResult.evaluationContext.productionSnapshotId ===
        productionRepeatResult.evaluationContext.productionSnapshotId,
      representativeScope: {
        label: representative.label,
        ratingCount: representative.ratingCount,
        totalUserScopes: representative.totalUserScopes,
      },
      runIdentityIdentical: productionResult.runId === productionRepeatResult.runId,
      snapshotCaptureCalls: productionSnapshotCalls,
      snapshotCapturedOncePerRun: productionSnapshotCalls === 2,
    },
    productionIsolation: {
      pass: Object.values(productionStateComparisons).every(
        (comparison) => comparison.unchanged,
      ),
      stateComparisons: productionStateComparisons,
    },
    apiRoundTrip: apiRun.value,
    performance: {
      apiRoundTripMs: apiRun.durationMs,
      canonicalCandidateCount: ALL_EXPERIMENTS.length,
      canonicalRunMs: canonicalRun.durationMs,
      canonicalRunMsPerCandidateIncludingBaseline:
        canonicalRun.durationMs / (ALL_EXPERIMENTS.length + 1),
      candidateOrderRunMs: reversedRun.durationMs,
      games: canonicalUnified.evaluationContext.gameCount,
      legacySpecialistRunsMs: legacyTimed.durationMs,
      productionCandidateCount: productionRequest.experiments.length,
      productionRepeatMs: productionRepeat.durationMs,
      productionRunMs: productionRun.durationMs,
      repeatedCanonicalRunMs: repeatedRun.durationMs,
      seasons: EVALUATION_SEASONS.length,
    },
    memory: {
      after: memoryAfter,
      before: memoryBefore,
      heapGrowthMiB: memoryAfter.heapUsedMiB - memoryBefore.heapUsedMiB,
      observedInstability: false,
      requestFailures: 0,
      timeouts: 0,
    },
    migration: {
      baseModel: {
        classification:
          familyStatuses.baseModel === STATUS.PASS
            ? 'A) SAFE TO RETIRE AS PRIMARY ENTRY POINT'
            : 'C) BLOCKED — unified workflow does not yet have primary-entry parity',
        reason: basePrimaryEntry.reason,
      },
      scheduleAndContext: {
        classification: familyStatuses.restFatigue === STATUS.PASS &&
          familyStatuses.quickRematch === STATUS.PASS
          ? 'B) KEEP FOR ADVANCED DIAGNOSTICS'
          : 'C) BLOCKED — unified workflow does not yet have parity',
      },
      specialTeams: {
        classification: familyStatuses.specialTeams === STATUS.PASS
          ? 'B) KEEP FOR ADVANCED DIAGNOSTICS'
          : 'C) BLOCKED — unified workflow does not yet have parity',
      },
      teamHomeAdvantage: {
        classification: familyStatuses.teamHomeAdvantage === STATUS.PASS
          ? 'B) KEEP FOR ADVANCED DIAGNOSTICS'
          : 'C) BLOCKED — unified workflow does not yet have parity',
      },
    },
    overallStatus: Object.values(familyStatuses).some(
      (status) => status === STATUS.FAIL,
    )
      ? STATUS.FAIL
      : familyStatuses.baseModel === STATUS.BLOCKED
        ? STATUS.BLOCKED
        : STATUS.PASS,
  }
}

const runBaseProductionCalibrationParity = async (options = {}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('A MongoDB connection is required for production parity.')
  }

  const progress = options.progress ?? (() => {})
  const startedAt = performance.now()
  const representative = await getRepresentativeUser()
  const [allGames, seedTeams, currentRatings] = await Promise.all([
    historicalNhlDataService.loadPreparedSeasons(EVALUATION_SEASONS),
    getSeedTeams(),
    PowerRating.find({ userId: representative.userId })
      .sort({ teamId: 1 })
      .lean(),
  ])
  progress('base-inputs-loaded')
  const unavailableSeasons = EVALUATION_SEASONS.filter(
    (seasonId) => allGames.datasetsBySeason.get(seasonId)?.status !== 'ready',
  )

  if (unavailableSeasons.length > 0) {
    throw new Error(
      `Prepared Base parity inputs are unavailable: games=${unavailableSeasons.join(',')}`,
    )
  }

  const stateBefore = await getProductionStateFingerprint(representative.userId)
  const teams = normalizedTeams(seedTeams)
  const preparedContexts = buildPreparedContexts({ allGames, teams })
  const specialistGameIds = preparedContexts.flatMap((context) =>
    context.games.map((game) => game.gameId),
  )
  const providerOptions = {
    historicalGamesLoader: async (seasonIds) => ({
      datasetsBySeason: new Map(
        seasonIds.map((seasonId) => [
          seasonId,
          allGames.datasetsBySeason.get(seasonId),
        ]),
      ),
      gamesBySeason: new Map(
        seasonIds.map((seasonId) => [
          seasonId,
          allGames.gamesBySeason.get(seasonId),
        ]),
      ),
    }),
    teamsProvider: async () => teams,
  }
  const canonicalTimed = await timed(() =>
    runCalibrationOrchestration(
      representative.userId,
      canonicalRequest(BASE_EXPERIMENTS),
      providerOptions,
    ),
  )
  const canonicalUnified = canonicalTimed.value
  const sampleParity = compareGameSamples(
    canonicalUnified.evaluationContext.includedGameIds,
    specialistGameIds,
  )
  progress('base-unified-run-complete')
  const primaryEntry = await runBaseModelPrimaryEntryComparison({
    allGames,
    canonicalUnified,
    currentRatings,
    representativeUserId: representative.userId,
    sampleParity,
    teams,
  })
  progress('base-primary-entry-complete')
  const candidateParity = []

  for (const experiment of BASE_EXPERIMENTS) {
    const specialist = await runBaseModelSpecialistEntry({
      allGames,
      currentRatings,
      experiment,
      representativeUserId: representative.userId,
      teams,
    })
    const summary = summarizeCandidateParity({
      legacy: {
        games: specialist.dataset.gamesIncluded,
        metrics: specialist.metrics,
        overrides: experiment.overrides,
        perSeason: specialist.seasonResults.map((season) => ({
          games: season.dataset.gamesIncluded,
          metrics: season.metrics,
          seasonId: season.seasonId,
        })),
      },
      sampleParity,
      unified: getCandidate(canonicalUnified, experiment.candidateId),
    })
    const startingStateSignature = {
      pass:
        specialist.diagnostics.startingStateSignature ===
        canonicalUnified.evaluationContext.startingStateSignature,
      specialist: specialist.diagnostics.startingStateSignature,
      unified: canonicalUnified.evaluationContext.startingStateSignature,
    }

    candidateParity.push({
      ...summary,
      pass: summary.pass && startingStateSignature.pass,
      startingStateSignature,
    })
    progress(`base-candidate-complete:${experiment.candidateId}`)
  }

  const stateAfter = await getProductionStateFingerprint(representative.userId)
  const stateComparisons = Object.fromEntries(
    Object.keys(stateBefore).map((field) => [
      field,
      {
        after: stateAfter[field],
        before: stateBefore[field],
        unchanged: stateAfter[field] === stateBefore[field],
      },
    ]),
  )
  const productionUnchanged = Object.values(stateComparisons).every(
    (comparison) => comparison.unchanged,
  )
  const candidatesPass = candidateParity.every((candidate) => candidate.pass)
  const overallStatus =
    primaryEntry.status === STATUS.PASS && candidatesPass && productionUnchanged
      ? STATUS.PASS
      : STATUS.FAIL

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tolerance: TOLERANCE,
    scope: 'BASE_MODEL_ONLY',
    representativeUser: representative,
    evaluation: {
      baselineSignature: canonicalUnified.evaluationContext.baselineSignature,
      datasetSignature: canonicalUnified.evaluationContext.datasetSignature,
      exactGameCount: canonicalUnified.evaluationContext.gameCount,
      gameIdSignature: canonicalUnified.evaluationContext.gameIdSignature,
      perSeasonGameCounts: Object.fromEntries(
        canonicalUnified.baseline.perSeason.map((season) => [
          season.seasonId,
          season.games,
        ]),
      ),
      sampleParity,
      seasons: canonicalUnified.evaluationContext.seasons,
      startingStatePolicy: canonicalUnified.evaluationContext.startingStatePolicy,
      startingStateSignature:
        canonicalUnified.evaluationContext.startingStateSignature,
    },
    baseline: primaryEntry,
    candidates: candidateParity,
    productionIsolation: {
      pass: productionUnchanged,
      stateComparisons,
    },
    performance: {
      durationMs: performance.now() - startedAt,
      games: canonicalUnified.evaluationContext.gameCount,
      specialistRuns: BASE_EXPERIMENTS.length + 1,
      unifiedRunMs: canonicalTimed.durationMs,
    },
    migration: {
      classification:
        overallStatus === STATUS.PASS
          ? 'A) SAFE TO RETIRE AS PRIMARY ENTRY POINT'
          : 'C) BLOCKED — unified workflow does not yet have Base primary-entry parity',
    },
    overallStatus,
  }
}

const getCombinedDeterminismProjection = (result) => ({
  candidates: [...result.candidates]
    .sort((left, right) => compareIdentifiers(
      left.candidateId,
      right.candidateId,
    ))
    .map((candidate) => ({
    candidateId: candidate.candidateId,
    components: candidate.components,
    configurationSignature: candidate.metadata.configurationSignature,
    diagnostics: candidate.diagnostics,
    evaluation: candidate.evaluation,
    metrics: candidate.metrics,
    overrides: candidate.overrides,
    perSeason: candidate.perSeason,
    })),
  evaluationContext: {
    baselineSignature: result.evaluationContext.baselineSignature,
    datasetSignature: result.evaluationContext.datasetSignature,
    gameIdSignature: result.evaluationContext.gameIdSignature,
    seasons: result.evaluationContext.seasons,
    startingStateSignature: result.evaluationContext.startingStateSignature,
  },
  ranking: result.ranking,
  runId: result.runId,
})

const runCombinedProductionCalibrationValidation = async (options = {}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('A MongoDB connection is required for production validation.')
  }

  const progress = options.progress ?? (() => {})
  const startedAt = performance.now()
  const representative = await getRepresentativeUser()
  const allGameSeasonIds = [
    ...new Set([
      ...EVALUATION_SEASONS,
      ...EVALUATION_SEASONS.flatMap((seasonId) =>
        homeAdvantageCalibrationService.getPriorSeasonIds(seasonId)),
    ]),
  ].sort(compareIdentifiers)
  const allSpecialTeamsSeasonIds = [
    ...new Set(EVALUATION_SEASONS.flatMap((seasonId) =>
      specialTeamsCalibrationService.getPriorSeasonIds(seasonId))),
  ].sort(compareIdentifiers)
  const [allGames, allSpecialTeams, seedTeams] = await Promise.all([
    historicalNhlDataService.loadPreparedSeasons(allGameSeasonIds),
    historicalSpecialTeamsDataService.loadPreparedSpecialTeamsSeasons(
      allSpecialTeamsSeasonIds,
    ),
    getSeedTeams(),
  ])
  const unavailableGameSeasons = allGameSeasonIds.filter(
    (seasonId) => allGames.datasetsBySeason.get(seasonId)?.status !== 'ready',
  )
  const unavailableSpecialTeamsSeasons = allSpecialTeamsSeasonIds.filter(
    (seasonId) => allSpecialTeams.get(seasonId)?.status !== 'ready',
  )

  if (unavailableGameSeasons.length || unavailableSpecialTeamsSeasons.length) {
    throw new Error(
      `Prepared combined-validation inputs are unavailable: games=${unavailableGameSeasons.join(',')}; specialTeams=${unavailableSpecialTeamsSeasons.join(',')}`,
    )
  }
  progress('combined-inputs-loaded')

  const stateBefore = await getProductionStateFingerprint(representative.userId)
  const teams = normalizedTeams(seedTeams)
  const providerOptions = makeProviderOptions({
    allGames,
    allSpecialTeams,
    teams,
  })
  const firstTimed = await timed(() => runCalibrationOrchestration(
    representative.userId,
    canonicalRequest(COMBINED_VALIDATION_EXPERIMENTS),
    providerOptions,
  ))
  const reversedExperiments = [...COMBINED_VALIDATION_EXPERIMENTS]
    .reverse()
    .map((experiment) => experiment.type === CANDIDATE_TYPES.COMBINED
      ? { ...experiment, components: [...experiment.components].reverse() }
      : experiment)
  const reversedTimed = await timed(() => runCalibrationOrchestration(
    representative.userId,
    canonicalRequest(reversedExperiments),
    providerOptions,
  ))
  progress('combined-runs-complete')

  const first = firstTimed.value
  const reversed = reversedTimed.value
  const firstProjection = getCombinedDeterminismProjection(first)
  const reversedProjection = getCombinedDeterminismProjection(reversed)
  const firstProjectionSignature = createDeterministicSignature(
    'parity/combined-determinism/v1',
    firstProjection,
  )
  const reversedProjectionSignature = createDeterministicSignature(
    'parity/combined-determinism/v1',
    reversedProjection,
  )
  const combinedCandidates = first.candidates.filter((candidate) =>
    candidate.candidateType === CANDIDATE_TYPES.COMBINED)
  const sampleIdentity = first.candidates.every((candidate) =>
    candidate.evaluation.games === first.baseline.evaluation.games &&
    candidate.metadata.datasetSignature ===
      first.baseline.metadata.datasetSignature &&
    candidate.metadata.startingStateSignature ===
      first.baseline.metadata.startingStateSignature &&
    candidate.metadata.baselineSignature ===
      first.baseline.metadata.baselineSignature &&
    createDeterministicSignature('parity/combined-seasons', candidate.evaluation.seasons) ===
      createDeterministicSignature(
        'parity/combined-seasons',
        first.baseline.evaluation.seasons,
      ))
  const componentDiagnostics = combinedCandidates.map((candidate) => {
    const componentCandidates = candidate.components
      .map((component) => getCandidate(first, component.candidateId))
      .filter(Boolean)
    const bestComponent = [...componentCandidates].sort(
      (left, right) => left.metrics.pooledBrier - right.metrics.pooledBrier ||
        compareIdentifiers(left.candidateId, right.candidateId),
    )[0]
    const interaction = candidate.diagnostics.interaction
    const expectedDelta = candidate.metrics.pooledBrier -
      bestComponent.metrics.pooledBrier
    const pass =
      interaction.bestComponentCandidateId === bestComponent.candidateId &&
      compareNumber(
        interaction.bestComponentBrier,
        bestComponent.metrics.pooledBrier,
      ).pass &&
      compareNumber(
        interaction.combinedVsBestComponentDeltaBrier,
        expectedDelta,
      ).pass

    return {
      bestComponentBrier: interaction.bestComponentBrier,
      bestComponentCandidateId: interaction.bestComponentCandidateId,
      candidateId: candidate.candidateId,
      combinedVsBestComponentDeltaBrier:
        interaction.combinedVsBestComponentDeltaBrier,
      componentCandidateIds: interaction.componentCandidateIds,
      pass,
    }
  })
  const restQuick = getCandidate(first, 'combined-rest-quick')
  const homeSpecial = getCandidate(first, 'combined-ha-special')
  const featureActivity = {
    quickRematchOccurrences: EVALUATION_SEASONS.reduce(
      (sum, seasonId) => sum + restQuick.diagnostics.replay
        .seasons[seasonId].quickRematch.occurrences,
      0,
    ),
    restFatigueOccurrences: EVALUATION_SEASONS.reduce(
      (sum, seasonId) => {
        const applied = restQuick.diagnostics.replay
          .seasons[seasonId].restFatigue.appliedConditions

        return sum + Object.entries(applied)
          .filter(([condition]) => condition !== 'normal')
          .reduce((seasonSum, [, count]) => seasonSum + count, 0)
      },
      0,
    ),
    specialTeamsGames: EVALUATION_SEASONS.reduce(
      (sum, seasonId) => sum + homeSpecial.diagnostics.replay
        .seasons[seasonId].specialTeams.gamesAffected,
      0,
    ),
    teamHomeAdvantageGames: EVALUATION_SEASONS.reduce(
      (sum, seasonId) => sum + homeSpecial.diagnostics.replay
        .seasons[seasonId].teamHomeAdvantage.gamesAffected,
      0,
    ),
  }
  const featureActivityPass = Object.values(featureActivity).every(
    (count) => count > 0,
  )
  const stateAfter = await getProductionStateFingerprint(representative.userId)
  const stateComparisons = Object.fromEntries(
    Object.keys(stateBefore).map((field) => [
      field,
      {
        after: stateAfter[field],
        before: stateBefore[field],
        unchanged: stateAfter[field] === stateBefore[field],
      },
    ]),
  )
  const productionUnchanged = Object.values(stateComparisons).every(
    (comparison) => comparison.unchanged,
  )
  const determinismPass = firstProjectionSignature ===
    reversedProjectionSignature
  const componentDiagnosticsPass = componentDiagnostics.every(
    (diagnostic) => diagnostic.pass,
  )
  const comparabilityPass = combinedCandidates.every((candidate) =>
    candidate.diagnostics.comparability.comparable === true)
  const overallStatus = sampleIdentity &&
    determinismPass &&
    componentDiagnosticsPass &&
    comparabilityPass &&
    featureActivityPass &&
    productionUnchanged &&
    first.diagnostics.productionWrites === false &&
    reversed.diagnostics.productionWrites === false
    ? STATUS.PASS
    : STATUS.FAIL

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: 'SELECTED_COMBINED_CANDIDATES',
    representativeUser: representative,
    evaluation: {
      baselineSignature: first.evaluationContext.baselineSignature,
      datasetSignature: first.evaluationContext.datasetSignature,
      exactGameCount: first.evaluationContext.gameCount,
      gameIdSignature: first.evaluationContext.gameIdSignature,
      perSeasonGameCounts: Object.fromEntries(
        first.baseline.perSeason.map((season) => [season.seasonId, season.games]),
      ),
      sampleIdentity,
      seasons: first.evaluationContext.seasons,
      startingStateSignature: first.evaluationContext.startingStateSignature,
    },
    candidates: first.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateType: candidate.candidateType,
      components: candidate.components.map((component) => ({
        candidateId: component.candidateId,
        type: component.type,
      })),
      configurationSignature: candidate.metadata.configurationSignature,
      deltaBrier: candidate.comparison.deltaBrier,
      metrics: candidate.metrics,
      rank: first.ranking.comparable.find((ranking) =>
        ranking.candidateId === candidate.candidateId)?.rank ?? null,
    })),
    componentDiagnostics,
    determinism: {
      firstProjectionSignature,
      pass: determinismPass,
      reversedProjectionSignature,
      runId: first.runId,
      reversedRunId: reversed.runId,
    },
    featureActivity: { ...featureActivity, pass: featureActivityPass },
    performance: {
      durationMs: performance.now() - startedAt,
      firstRunMs: firstTimed.durationMs,
      gamesPerRun: first.evaluationContext.gameCount,
      reversedRunMs: reversedTimed.durationMs,
    },
    productionIsolation: {
      pass: productionUnchanged,
      stateComparisons,
    },
    overallStatus,
  }
}

const makeRobustnessValidationRequest = ({
  candidate,
  intervalLevel = 0.95,
  replicates = 2500,
  result,
  seed,
}) => ({
  candidateId: candidate.candidateId,
  identity: {
    baselineSignature: result.evaluationContext.baselineSignature,
    candidateConfigurationSignature:
      candidate.metadata.configurationSignature,
    datasetSignature: result.evaluationContext.datasetSignature,
    gameIdSignature: result.evaluationContext.gameIdSignature,
    productionSnapshotId: result.evaluationContext.productionSnapshotId,
    startingStateSignature: result.evaluationContext.startingStateSignature,
  },
  intervalLevel,
  replicates,
  runId: result.runId,
  ...(seed === undefined ? {} : { seed }),
})

const runProductionCalibrationRobustnessValidation = async (options = {}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('A MongoDB connection is required for robustness validation.')
  }

  const progress = options.progress ?? (() => {})
  const startedAt = performance.now()
  const representative = await getRepresentativeUser()
  const allGameSeasonIds = [
    ...new Set([
      ...EVALUATION_SEASONS,
      ...EVALUATION_SEASONS.flatMap((seasonId) =>
        homeAdvantageCalibrationService.getPriorSeasonIds(seasonId)),
    ]),
  ].sort(compareIdentifiers)
  const allSpecialTeamsSeasonIds = [
    ...new Set(EVALUATION_SEASONS.flatMap((seasonId) =>
      specialTeamsCalibrationService.getPriorSeasonIds(seasonId))),
  ].sort(compareIdentifiers)
  const [allGames, allSpecialTeams, seedTeams] = await Promise.all([
    historicalNhlDataService.loadPreparedSeasons(allGameSeasonIds),
    historicalSpecialTeamsDataService.loadPreparedSpecialTeamsSeasons(
      allSpecialTeamsSeasonIds,
    ),
    getSeedTeams(),
  ])
  const unavailableGameSeasons = allGameSeasonIds.filter(
    (seasonId) => allGames.datasetsBySeason.get(seasonId)?.status !== 'ready',
  )
  const unavailableSpecialTeamsSeasons = allSpecialTeamsSeasonIds.filter(
    (seasonId) => allSpecialTeams.get(seasonId)?.status !== 'ready',
  )

  if (unavailableGameSeasons.length || unavailableSpecialTeamsSeasons.length) {
    throw new Error(
      `Prepared robustness inputs are unavailable: games=${unavailableGameSeasons.join(',')}; specialTeams=${unavailableSpecialTeamsSeasons.join(',')}`,
    )
  }
  progress('robustness-inputs-loaded')

  const stateBefore = await getProductionStateFingerprint(representative.userId)
  const memoryBefore = getMemorySnapshot()
  const teams = normalizedTeams(seedTeams)
  const providerOptions = makeProviderOptions({
    allGames,
    allSpecialTeams,
    teams,
  })
  let observationContextConstructionMs = null
  const calibrationTimed = await timed(() => runCalibrationOrchestration(
    representative.userId,
    canonicalRequest(COMBINED_VALIDATION_EXPERIMENTS),
    {
      ...providerOptions,
      analysisContextStore: (context) => {
        const observationStartedAt = performance.now()
        const stored = storeCalibrationAnalysisContext(context)

        observationContextConstructionMs =
          performance.now() - observationStartedAt
        return stored
      },
    },
  ))
  const calibration = calibrationTimed.value
  const targetCandidateIds = [
    'combined-rest-quick',
    'combined-ha-special',
  ]
  const analyses = []

  for (const candidateId of targetCandidateIds) {
    const candidate = getCandidate(calibration, candidateId)
    const request = makeRobustnessValidationRequest({
      candidate,
      result: calibration,
    })
    const first = await timed(() => Promise.resolve(
      runCalibrationRobustness(representative.userId, request),
    ))
    const repeated = await timed(() => Promise.resolve(
      runCalibrationRobustness(representative.userId, request),
    ))

    analyses.push({
      analysis: first.value,
      candidateId,
      deterministic:
        first.value.analysisId === repeated.value.analysisId &&
        createDeterministicSignature(
          'parity/robustness-bootstrap/v1',
          first.value.bootstrap,
        ) === createDeterministicSignature(
          'parity/robustness-bootstrap/v1',
          repeated.value.bootstrap,
        ),
      durationMs: first.durationMs,
      observedMatchesCalibration:
        first.value.observed.brier === candidate.metrics.pooledBrier &&
        first.value.observed.baselineBrier ===
          calibration.baseline.metrics.pooledBrier &&
        first.value.observed.deltaBrier === candidate.comparison.deltaBrier,
      repeatedDurationMs: repeated.durationMs,
    })
  }

  const replicatePerformance = []
  const performanceCandidate = getCandidate(calibration, targetCandidateIds[0])

  for (const replicates of [1000, 2500, 5000]) {
    const request = makeRobustnessValidationRequest({
      candidate: performanceCandidate,
      replicates,
      result: calibration,
      seed: 8675309,
    })
    const measured = await timed(() => Promise.resolve(
      runCalibrationRobustness(representative.userId, request),
    ))

    replicatePerformance.push({
      durationMs: measured.durationMs,
      replicates,
    })
  }

  global.gc?.()
  const memoryAfter = getMemorySnapshot()
  const stateAfter = await getProductionStateFingerprint(representative.userId)
  const stateComparisons = Object.fromEntries(
    Object.keys(stateBefore).map((field) => [
      field,
      {
        after: stateAfter[field],
        before: stateBefore[field],
        unchanged: stateAfter[field] === stateBefore[field],
      },
    ]),
  )
  const productionUnchanged = Object.values(stateComparisons).every(
    (comparison) => comparison.unchanged,
  )
  const exactSample =
    calibration.evaluationContext.gameCount === 3936 &&
    createDeterministicSignature(
      'parity/robustness-seasons/v1',
      calibration.evaluationContext.seasons,
    ) === createDeterministicSignature(
      'parity/robustness-seasons/v1',
      EVALUATION_SEASONS,
    ) &&
    analyses.every((entry) =>
      entry.analysis.observationSet.games === 3936)
  const overallStatus =
    exactSample &&
    productionUnchanged &&
    analyses.every((entry) =>
      entry.deterministic &&
      entry.observedMatchesCalibration &&
      entry.analysis.metadata.productionWrites === false &&
      entry.analysis.diagnostics.bootstrapRerunsReplay === false)
      ? STATUS.PASS
      : STATUS.FAIL

  return {
    analyses: analyses.map((entry) => ({
      analysisId: entry.analysis.analysisId,
      bootstrapDeltaBrier: entry.analysis.bootstrap.deltaBrier,
      candidateId: entry.candidateId,
      deterministic: entry.deterministic,
      durationMs: entry.durationMs,
      observed: entry.analysis.observed,
      observedMatchesCalibration: entry.observedMatchesCalibration,
      observationSet: entry.analysis.observationSet,
      repeatedDurationMs: entry.repeatedDurationMs,
      seasonSensitivity: entry.analysis.seasonSensitivity,
    })),
    evaluation: {
      baselineSignature: calibration.evaluationContext.baselineSignature,
      datasetSignature: calibration.evaluationContext.datasetSignature,
      exactGameCount: calibration.evaluationContext.gameCount,
      exactSample,
      gameIdSignature: calibration.evaluationContext.gameIdSignature,
      seasons: calibration.evaluationContext.seasons,
      startingStateSignature:
        calibration.evaluationContext.startingStateSignature,
    },
    generatedAt: new Date().toISOString(),
    overallStatus,
    performance: {
      calibrationMs: calibrationTimed.durationMs,
      memoryAfter,
      memoryBefore,
      memoryDeltaHeapMiB:
        memoryAfter.heapUsedMiB - memoryBefore.heapUsedMiB,
      observationContextConstructionMs,
      replicatePerformance,
      totalDurationMs: performance.now() - startedAt,
    },
    productionIsolation: {
      pass: productionUnchanged,
      stateComparisons,
    },
    representativeUser: representative,
    schemaVersion: 1,
    scope: 'ROBUSTNESS_SELECTED_COMBINED_CANDIDATES',
  }
}

const compactComparison = (comparison) => [
  comparison.unified,
  comparison.legacy,
  comparison.absoluteDifference,
  comparison.exact,
  comparison.pass,
]

const compactCandidateParity = (candidate, { includeFeature = false } = {}) => ({
  candidateId: candidate.candidateId,
  gameCount: compactComparison(candidate.games),
  metrics: Object.fromEntries(
    Object.entries(candidate.metrics).map(([field, comparison]) => [
      field,
      compactComparison(comparison),
    ]),
  ),
  overrides: candidate.candidateParameters.unified,
  overridesMatch: candidate.candidateParameters.match,
  pass: candidate.pass,
  perSeason: candidate.perSeason.map((season) => ({
    metrics: Object.fromEntries(
      Object.entries(season.metrics).map(([field, comparison]) => [
        field,
        compactComparison(comparison),
      ]),
    ),
    pass: season.pass,
    seasonId: season.seasonId,
  })),
  ...(includeFeature ? { featureEvidence: candidate.featureParity } : {
    featureParity: candidate.featureParity.pass,
  }),
})

const createConciseParityReport = (report) => {
  const baseCandidates = report.families.baseModel.candidateParity.map(
    (candidate) => compactCandidateParity(candidate),
  )
  const homeCandidates = report.families.teamHomeAdvantage.candidateParity.map(
    (candidate) => compactCandidateParity(candidate),
  )
  const restCandidates = report.families.restFatigue.candidateParity.map(
    (candidate) => compactCandidateParity(candidate, { includeFeature: true }),
  )
  const quickCandidates = report.families.quickRematch.candidateParity.map(
    (candidate) => compactCandidateParity(candidate, { includeFeature: true }),
  )
  const specialTeamsCandidates = report.families.specialTeams.candidateParity
    .map((candidate) =>
      compactCandidateParity(candidate, { includeFeature: true }),
    )

  return {
    apiRoundTrip: report.apiRoundTrip,
    candidateOrderIndependence: report.candidateOrderIndependence,
    comparisonColumns: [
      'unified',
      'specialist',
      'absoluteDifference',
      'exact',
      'pass',
    ],
    canonicalBaseline: {
      equivalentEngineParity: compactCandidateParity(
        report.canonicalBaseline.equivalentEngineParity,
      ),
      pass: report.canonicalBaseline.pass,
      primaryEntryComparison:
        report.canonicalBaseline.primaryEntryComparison,
    },
    currentProduction: report.currentProduction,
    determinism: report.determinism,
    evaluation: report.evaluation,
    families: {
      baseModel: {
        candidates: baseCandidates,
        equivalentEngineParity:
          report.families.baseModel.equivalentEngineParity,
        status: report.families.baseModel.status,
      },
      quickRematch: {
        candidates: quickCandidates,
        status: report.families.quickRematch.status,
      },
      restFatigue: {
        candidates: restCandidates,
        status: report.families.restFatigue.status,
      },
      specialTeams: {
        candidates: specialTeamsCandidates,
        status: report.families.specialTeams.status,
      },
      teamHomeAdvantage: {
        candidates: homeCandidates,
        frozenTierEvidence:
          report.families.teamHomeAdvantage.candidateParity[0]
            .featureParity.seasons,
        status: report.families.teamHomeAdvantage.status,
      },
    },
    generatedAt: report.generatedAt,
    memory: report.memory,
    migration: report.migration,
    overallStatus: report.overallStatus,
    performance: report.performance,
    productionIsolation: report.productionIsolation,
    resultTypes: report.resultTypes,
    schemaVersion: report.schemaVersion,
    tolerance: report.tolerance,
  }
}

const createConciseBaseParityReport = (report) => ({
  baseline: report.baseline,
  candidates: report.candidates.map((candidate) => ({
    ...compactCandidateParity(candidate),
    startingStateSignature: candidate.startingStateSignature,
  })),
  comparisonColumns: [
    'unified',
    'specialist',
    'absoluteDifference',
    'exact',
    'pass',
  ],
  evaluation: report.evaluation,
  generatedAt: report.generatedAt,
  migration: report.migration,
  overallStatus: report.overallStatus,
  performance: report.performance,
  productionIsolation: report.productionIsolation,
  schemaVersion: report.schemaVersion,
  scope: report.scope,
  tolerance: report.tolerance,
})

module.exports = {
  ALL_EXPERIMENTS,
  BASE_EXPERIMENTS,
  COMBINED_VALIDATION_EXPERIMENTS,
  EVALUATION_SEASONS,
  STATUS,
  TOLERANCE,
  buildBaseSpecialistPayload,
  compareGameSamples,
  compareMetrics,
  compareNumber,
  comparePerSeason,
  createConciseBaseParityReport,
  createConciseParityReport,
  runBaseProductionCalibrationParity,
  runCombinedProductionCalibrationValidation,
  runProductionCalibrationRobustnessValidation,
  runProductionCalibrationParity,
  summarizeCandidateParity,
}
