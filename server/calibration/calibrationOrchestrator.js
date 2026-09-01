const { BASE_MODEL_V1 } = require('../config/baseModel')
const {
  STARTING_MODES,
  buildStartingState,
} = require('../services/baseModelCalibrationService')
const historicalNhlDataService = require('../services/historicalNhlDataService')
const historicalSpecialTeamsDataService = require('../services/historicalSpecialTeamsDataService')
const homeAdvantageCalibrationService = require('../services/homeAdvantageCalibrationService')
const { normalizeSeasonId } = require('../services/nhlSeasonIdentity')
const {
  getRatingsForUser,
  getSeedTeams,
} = require('../services/powerRatingsService')
const scheduleCalibrationService = require('../services/scheduleCalibrationService')
const specialTeamsCalibrationService = require('../services/specialTeamsCalibrationService')
const {
  createCalibrationDatasetContext,
} = require('./calibrationDatasetContext')
const {
  STARTING_STATE_POLICIES,
  canonicalize,
  createBaselineConfigurationIdentity,
  createDeterministicSignature,
  createStartingStateIdentity,
  deepFreeze,
} = require('./calibrationIdentity')
const {
  captureCalibrationProductionSnapshot,
} = require('./calibrationProductionSnapshot')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
  compareCalibrationCandidates,
  createCalibrationCandidate,
} = require('./calibrationResultContract')
const {
  replayCalibrationRun,
} = require('./calibrationReplayEngine')
const {
  storeCalibrationAnalysisContext,
} = require('./calibrationAnalysisContextStore')

const BASELINE_CANDIDATE_ID = 'baseline'
const SUPPORTED_BASELINE_MODES = Object.freeze([
  BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  BASELINE_IDENTITIES.CURRENT_PRODUCTION,
])
const SUPPORTED_EXPERIMENT_TYPES = Object.freeze([
  CANDIDATE_TYPES.BASE_MODEL,
  CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  CANDIDATE_TYPES.REST_FATIGUE,
  CANDIDATE_TYPES.QUICK_REMATCH,
  CANDIDATE_TYPES.SPECIAL_TEAMS,
  CANDIDATE_TYPES.COMBINED,
])
const COMBINED_COMPONENT_TYPES = Object.freeze([
  CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  CANDIDATE_TYPES.REST_FATIGUE,
  CANDIDATE_TYPES.QUICK_REMATCH,
  CANDIDATE_TYPES.SPECIAL_TEAMS,
])
const ALLOWED_OVERRIDE_FIELDS = Object.freeze({
  [CANDIDATE_TYPES.BASE_MODEL]: new Set([
    'baseHomeAdvantage',
    'kFactor',
    'overtimeMultiplier',
    'probabilityScale',
    'regulationMultiplier',
    'shootoutMultiplier',
    'startingRatings',
  ]),
  [CANDIDATE_TYPES.QUICK_REMATCH]: new Set([
    'enabled',
    'loserAdjustment',
    'maximumDays',
  ]),
  [CANDIDATE_TYPES.REST_FATIGUE]: new Set([
    'adjustments',
    'backToBack',
    'backToBackTravel',
    'enabled',
    'includeWellRested',
    'threeInFour',
    'wellRested',
  ]),
  [CANDIDATE_TYPES.SPECIAL_TEAMS]: new Set([
    'adjustment',
    'adjustmentMagnitude',
    'automaticAdjustmentEnabled',
    'enabled',
    'topBottomN',
  ]),
  [CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]: new Set([
    'adjustment',
    'adjustments',
    'enabled',
    'teamAdjustments',
  ]),
})
const REST_RULE_FIELDS = Object.freeze({
  backToBack: 'back_to_back',
  backToBackTravel: 'back_to_back_travel',
  threeInFour: '3_games_in_4_days',
  wellRested: 'well_rested',
})

class CalibrationOrchestrationError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'CalibrationOrchestrationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

const requireFiniteNumber = (value, field) => {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new CalibrationOrchestrationError(
      `${field} must be a finite number.`,
      400,
      { field },
    )
  }

  return number
}

const requireBoolean = (value, field) => {
  if (typeof value !== 'boolean') {
    throw new CalibrationOrchestrationError(
      `${field} must be a boolean.`,
      400,
      { field },
    )
  }

  return value
}

const validateOverrideKeys = (type, overrides) => {
  const unsupportedFields = Object.keys(overrides).filter(
    (field) => !ALLOWED_OVERRIDE_FIELDS[type].has(field),
  )

  if (unsupportedFields.length > 0) {
    throw new CalibrationOrchestrationError(
      `${type} contains unsupported or cross-feature overrides.`,
      400,
      { candidateType: type, unsupportedFields },
    )
  }
}

const normalizeCombinedComponents = (components, experimentIndex) => {
  if (!Array.isArray(components) || components.length < 2) {
    throw new CalibrationOrchestrationError(
      `experiments[${experimentIndex}].components must contain at least two feature components.`,
      400,
    )
  }

  const normalized = components.map((component, componentIndex) => {
    const field = `experiments[${experimentIndex}].components[${componentIndex}]`

    if (!isPlainObject(component)) {
      throw new CalibrationOrchestrationError(`${field} must be an object.`, 400)
    }
    if (!COMBINED_COMPONENT_TYPES.includes(component.type)) {
      throw new CalibrationOrchestrationError(
        `${field}.type must be a supported combinable feature family.`,
        400,
        {
          candidateType: component.type,
          supportedComponentTypes: COMBINED_COMPONENT_TYPES,
        },
      )
    }
    if (component.components !== undefined) {
      throw new CalibrationOrchestrationError(
        'Nested COMBINED components are not supported.',
        400,
        { field: `${field}.components` },
      )
    }

    const overrides = component.overrides ?? {}

    if (!isPlainObject(overrides)) {
      throw new CalibrationOrchestrationError(
        `${field}.overrides must be an object.`,
        400,
      )
    }
    validateOverrideKeys(component.type, overrides)

    const candidateId = component.candidateId === undefined
      ? null
      : String(component.candidateId).trim()

    if (candidateId === BASELINE_CANDIDATE_ID ||
      (component.candidateId !== undefined && !candidateId)) {
      throw new CalibrationOrchestrationError(
        `${field}.candidateId is invalid or reserved.`,
        400,
      )
    }

    return {
      candidateId,
      label: component.label ?? candidateId,
      overrides: canonicalize(overrides),
      type: component.type,
    }
  })
  const componentTypes = normalized.map((component) => component.type)

  if (new Set(componentTypes).size !== componentTypes.length) {
    throw new CalibrationOrchestrationError(
      'COMBINED candidates require unique feature-family component types.',
      400,
      { componentTypes },
    )
  }

  return normalized.sort((left, right) =>
    compareIdentifiers(left.type, right.type) ||
    compareIdentifiers(left.candidateId ?? '', right.candidateId ?? ''),
  )
}

const normalizeRequest = (request = {}) => {
  if (!isPlainObject(request)) {
    throw new CalibrationOrchestrationError(
      'Calibration orchestration request must be an object.',
      400,
    )
  }

  if (!SUPPORTED_BASELINE_MODES.includes(request.baselineMode)) {
    throw new CalibrationOrchestrationError(
      'baselineMode must explicitly select a supported baseline.',
      400,
      { supportedBaselineModes: SUPPORTED_BASELINE_MODES },
    )
  }

  if (!Object.values(STARTING_STATE_POLICIES).includes(request.startingStatePolicy) ||
    request.startingStatePolicy === STARTING_STATE_POLICIES.UNKNOWN) {
    throw new CalibrationOrchestrationError(
      'startingStatePolicy must explicitly select a supported policy.',
      400,
      {
        supportedStartingStatePolicies: Object.values(
          STARTING_STATE_POLICIES,
        ).filter((policy) => policy !== STARTING_STATE_POLICIES.UNKNOWN),
      },
    )
  }

  if (!Array.isArray(request.evaluationSeasons) ||
    request.evaluationSeasons.length === 0) {
    throw new CalibrationOrchestrationError(
      'evaluationSeasons must contain at least one season.',
      400,
    )
  }

  const evaluationSeasons = request.evaluationSeasons.map((seasonId, index) => {
    const normalized = normalizeSeasonId(seasonId)

    if (!scheduleCalibrationService.DEFAULT_SEASON_IDS.includes(normalized)) {
      throw new CalibrationOrchestrationError(
        'Evaluation season is outside the currently shared replay window.',
        400,
        { field: `evaluationSeasons[${index}]`, seasonId },
      )
    }

    return normalized
  })

  if (new Set(evaluationSeasons).size !== evaluationSeasons.length) {
    throw new CalibrationOrchestrationError(
      'evaluationSeasons must not contain duplicates.',
      400,
    )
  }

  if (!Array.isArray(request.experiments)) {
    throw new CalibrationOrchestrationError(
      'experiments must be an explicit array.',
      400,
    )
  }

  const experiments = request.experiments.map((experiment, index) => {
    if (!isPlainObject(experiment)) {
      throw new CalibrationOrchestrationError(
        `experiments[${index}] must be an object.`,
        400,
      )
    }

    if (!SUPPORTED_EXPERIMENT_TYPES.includes(experiment.type)) {
      throw new CalibrationOrchestrationError(
        'Experiment type is not supported for calibration orchestration.',
        400,
        {
          candidateType: experiment.type,
          supportedExperimentTypes: SUPPORTED_EXPERIMENT_TYPES,
        },
      )
    }

    const candidateId = String(experiment.candidateId ?? '').trim()

    if (!candidateId || candidateId === BASELINE_CANDIDATE_ID) {
      throw new CalibrationOrchestrationError(
        `experiments[${index}].candidateId is invalid or reserved.`,
        400,
      )
    }

    const overrides = experiment.overrides ?? {}

    if (!isPlainObject(overrides)) {
      throw new CalibrationOrchestrationError(
        `experiments[${index}].overrides must be an object.`,
        400,
      )
    }

    if (experiment.type === CANDIDATE_TYPES.COMBINED) {
      if (Object.keys(overrides).length > 0) {
        throw new CalibrationOrchestrationError(
          'COMBINED candidates must place overrides inside components.',
          400,
        )
      }
      const components = normalizeCombinedComponents(
        experiment.components,
        index,
      )

      return {
        candidateId,
        components,
        label: experiment.label ?? candidateId,
        overrides: canonicalize(Object.fromEntries(
          components.map((component) => [
            component.type,
            component.overrides,
          ]),
        )),
        type: experiment.type,
      }
    }

    validateOverrideKeys(experiment.type, overrides)

    return {
      candidateId,
      label: experiment.label ?? candidateId,
      overrides: canonicalize(overrides),
      type: experiment.type,
    }
  })
  const candidateIds = experiments.map((experiment) => experiment.candidateId)

  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new CalibrationOrchestrationError(
      'Candidate IDs must be unique within one run.',
      400,
    )
  }

  return deepFreeze({
    baselineMode: request.baselineMode,
    evaluationSeasons: [...evaluationSeasons].sort(compareIdentifiers),
    experiments,
    startingStatePolicy: request.startingStatePolicy,
  })
}

const expandFeatureExperiments = (experiments) =>
  experiments.flatMap((experiment) =>
    experiment.type === CANDIDATE_TYPES.COMBINED
      ? experiment.components
      : [experiment],
  )

const buildCanonicalBaseline = () =>
  createBaselineConfigurationIdentity({
    configuration: {
      features: {
        quickRematch: {
          enabled: false,
          loserAdjustment: 0,
          maximumDays: 7,
        },
        restFatigue: {
          adjustments: {
            '3_games_in_4_days': 0,
            back_to_back: 0,
            back_to_back_travel: 0,
            well_rested: 0,
          },
          enabled: false,
          includeWellRested: false,
        },
        specialTeams: {
          adjustmentMagnitude: 0,
          automaticAdjustmentEnabled: false,
          enabled: false,
          topBottomN: 6,
        },
        teamHomeAdvantage: {
          adjustments: [],
          enabled: false,
          mode: 'disabled',
        },
      },
      model: BASE_MODEL_V1,
    },
    identity: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  })

const getProductionRestAdjustments = (feature) =>
  Object.fromEntries(
    Object.entries(REST_RULE_FIELDS).map(([field, ruleId]) => {
      const rule = feature?.rules?.[field]

      return [
        ruleId,
        feature?.enabled === true && rule?.enabled === true
          ? Number(rule.adjustment) || 0
          : 0,
      ]
    }),
  )

const normalizeReplayConfiguration = (configuration) => {
  const features = configuration.features
  const restFatigue = features.restFatigue
  const normalized = {
    features: {
      quickRematch: {
        enabled: features.quickRematch.enabled === true,
        loserAdjustment: Number(features.quickRematch.loserAdjustment) || 0,
        maximumDays: Number(features.quickRematch.maximumDays) || 0,
      },
      restFatigue: Object.hasOwn(restFatigue, 'rules')
        ? {
            adjustments: getProductionRestAdjustments(restFatigue),
            enabled: restFatigue.enabled === true,
            includeWellRested:
              restFatigue.enabled === true &&
              restFatigue.rules?.wellRested?.enabled === true,
          }
        : {
            adjustments: { ...restFatigue.adjustments },
            enabled: restFatigue.enabled === true,
            includeWellRested: restFatigue.includeWellRested === true,
          },
      specialTeams: {
        adjustmentMagnitude:
          Number(features.specialTeams.adjustmentMagnitude) || 0,
        automaticAdjustmentEnabled:
          features.specialTeams.automaticAdjustmentEnabled === true,
        enabled: features.specialTeams.enabled === true,
        topBottomN: Number(features.specialTeams.topBottomN) || 0,
      },
      teamHomeAdvantage: {
        adjustments: Array.isArray(features.teamHomeAdvantage.adjustments)
          ? features.teamHomeAdvantage.adjustments.map((adjustment) => ({
              adjustment: Number(adjustment.adjustment) || 0,
              teamId: adjustment.teamId,
            }))
          : [],
        enabled: features.teamHomeAdvantage.enabled === true,
        mode: features.teamHomeAdvantage.mode ?? 'team_map',
      },
    },
    model: { ...configuration.model },
  }

  if (normalized.features.restFatigue.enabled !== true) {
    normalized.features.restFatigue.adjustments = Object.fromEntries(
      Object.values(REST_RULE_FIELDS).map((ruleId) => [ruleId, 0]),
    )
    normalized.features.restFatigue.includeWellRested = false
  }

  return deepFreeze(canonicalize(normalized))
}

const getRows = (ratings) =>
  Array.isArray(ratings?.ratings)
    ? ratings.ratings
    : Array.isArray(ratings)
      ? ratings
      : []

const getSeasonValue = (collection, seasonId) => {
  if (collection instanceof Map) return collection.get(seasonId)
  return collection?.[seasonId]
}

const serializeStartingState = (ratingState) =>
  [...ratingState.values()].map((team) => ({
    abbreviation: team.abbreviation,
    startingRating: team.startingRating,
    teamId: team.teamId,
    teamName: team.teamName,
  }))

const buildStartingStateForPolicy = ({
  center = BASE_MODEL_V1.startingRatings.center,
  currentRatings,
  historicalStartingRatingsBySeason,
  policy,
  seasonId,
  spread = BASE_MODEL_V1.startingRatings.spread,
  teams,
}) => {
  if (policy === STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL) {
    return {
      orderingSource: 'seed_team_name_alphabetical',
      state: buildStartingState({
        currentRatings: [],
        input: {
          startingRatings: {
            center,
            mode: STARTING_MODES.FIXED_SPREAD,
            spread,
          },
        },
        orderingMode: 'historical_fallback',
        teams,
      }),
    }
  }

  if (policy === STARTING_STATE_POLICIES.EQUAL_RATINGS) {
    return {
      orderingSource: 'equal_ratings',
      state: buildStartingState({
        currentRatings: [],
        input: {
          startingRatings: {
            center,
            mode: STARTING_MODES.FIXED_SPREAD,
            spread: 0,
          },
        },
        orderingMode: 'historical_fallback',
        teams,
      }),
    }
  }

  const ratings = policy === STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER
    ? currentRatings
    : getSeasonValue(historicalStartingRatingsBySeason, seasonId)

  if (!Array.isArray(getRows(ratings)) || getRows(ratings).length === 0) {
    throw new CalibrationOrchestrationError(
      'The selected starting-state policy requires a complete rating order.',
      409,
      { policy, seasonId },
    )
  }

  return {
    orderingSource:
      policy === STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER
        ? 'current_production_power_ratings'
        : `historical_starting_ratings:${seasonId}`,
    state: buildStartingState({
      currentRatings: getRows(ratings),
      input: {
        startingRatings: {
          center,
          mode:
            policy === STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER
              ? STARTING_MODES.CURRENT
              : STARTING_MODES.FIXED_SPREAD,
          spread,
        },
      },
      orderingMode: 'current_ratings',
      teams,
    }),
  }
}

const buildRunStartingStateIdentity = ({
  center,
  currentRatings,
  evaluationSeasons,
  historicalStartingRatingsBySeason,
  policy,
  spread,
  teams,
}) =>
  createStartingStateIdentity({
    policy,
    seasonStartingStates: evaluationSeasons.map((seasonId) => {
      const { orderingSource, state } = buildStartingStateForPolicy({
        center,
        currentRatings,
        historicalStartingRatingsBySeason,
        policy,
        seasonId,
        spread,
        teams,
      })

      return {
        orderingSource,
        seasonId,
        teams: serializeStartingState(state),
      }
    }),
  })

const assertPreparedGameSeasons = ({
  datasetsBySeason,
  gamesBySeason,
  seasonIds,
  usage,
}) => {
  const unavailable = seasonIds.filter((seasonId) => {
    const dataset = datasetsBySeason.get(seasonId)
    const games = gamesBySeason.get(seasonId)

    return !Array.isArray(games) || games.length === 0 ||
      (dataset && dataset.status !== 'ready')
  })

  if (unavailable.length > 0) {
    throw new CalibrationOrchestrationError(
      `Required ${usage} historical seasons are not ready.`,
      409,
      { unavailableSeasonIds: unavailable },
    )
  }
}

const normalizeTeams = (teams) =>
  teams
    .map((team) => ({
      abbreviation: String(team.abbreviation ?? team.teamId ?? team.id)
        .trim()
        .toUpperCase(),
      teamId: String(team.teamId ?? team.id ?? team.abbreviation)
        .trim()
        .toUpperCase(),
      teamName: team.teamName ?? team.name ?? team.abbreviation,
    }))
    .sort((left, right) => compareIdentifiers(left.teamId, right.teamId))

const getQuickRematchWindows = (baselineConfiguration, experiments) => {
  const windows = new Set()
  const baselineQuick = baselineConfiguration.features.quickRematch

  if (baselineQuick.enabled && baselineQuick.maximumDays > 0) {
    windows.add(baselineQuick.maximumDays)
  }

  expandFeatureExperiments(experiments)
    .filter((experiment) => experiment.type === CANDIDATE_TYPES.QUICK_REMATCH)
    .forEach((experiment) => {
      if (experiment.overrides.enabled === false) return

      const maximumDays = experiment.overrides.maximumDays ??
        baselineQuick.maximumDays

      if (Number.isInteger(Number(maximumDays)) && Number(maximumDays) > 0) {
        windows.add(Number(maximumDays))
      }
    })

  return [...windows].sort((left, right) => left - right)
}

const getSpecialTeamsThresholds = (baselineConfiguration, experiments) => {
  const thresholds = new Set()
  const baselineSpecialTeams = baselineConfiguration.features.specialTeams

  if (baselineSpecialTeams.automaticAdjustmentEnabled) {
    thresholds.add(baselineSpecialTeams.topBottomN)
  }

  expandFeatureExperiments(experiments)
    .filter((experiment) => experiment.type === CANDIDATE_TYPES.SPECIAL_TEAMS)
    .forEach((experiment) => {
      if (experiment.overrides.enabled === false ||
        experiment.overrides.automaticAdjustmentEnabled === false) return

      thresholds.add(
        Number(
          experiment.overrides.topBottomN ?? baselineSpecialTeams.topBottomN,
        ),
      )
    })

  return [...thresholds].sort((left, right) => left - right)
}

const buildFrozenEvaluationContext = async ({
  baselineConfiguration,
  currentRatings,
  normalizedRequest,
  options,
  teams,
}) => {
  const needsHomeSnapshots = expandFeatureExperiments(
    normalizedRequest.experiments,
  ).some(
    (experiment) => {
      const overrides = experiment.overrides

      return experiment.type === CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE &&
        overrides.enabled !== false &&
        overrides.teamAdjustments === undefined &&
        overrides.adjustments === undefined
    },
  )
  const specialTeamsThresholds = getSpecialTeamsThresholds(
    baselineConfiguration,
    normalizedRequest.experiments,
  )
  const needsSpecialTeamsSnapshots = specialTeamsThresholds.length > 0
  const homeReferenceSeasonIds = needsHomeSnapshots
    ? [
        ...new Set(
          normalizedRequest.evaluationSeasons.flatMap((seasonId) =>
            homeAdvantageCalibrationService.getPriorSeasonIds(seasonId),
          ),
        ),
      ]
    : []
  const gameSeasonIds = [
    ...new Set([
      ...normalizedRequest.evaluationSeasons,
      ...homeReferenceSeasonIds,
    ]),
  ]
  const historicalGamesLoader = options.historicalGamesLoader ??
    historicalNhlDataService.loadPreparedSeasons
  const loaded = await historicalGamesLoader(
    gameSeasonIds,
    options.historicalGamesOptions ?? {},
  )
  const datasetsBySeason = loaded?.datasetsBySeason instanceof Map
    ? loaded.datasetsBySeason
    : new Map()
  const gamesBySeason = loaded?.gamesBySeason instanceof Map
    ? loaded.gamesBySeason
    : new Map()

  assertPreparedGameSeasons({
    datasetsBySeason,
    gamesBySeason,
    seasonIds: normalizedRequest.evaluationSeasons,
    usage: 'evaluation',
  })

  if (needsHomeSnapshots) {
    assertPreparedGameSeasons({
      datasetsBySeason,
      gamesBySeason,
      seasonIds: homeReferenceSeasonIds,
      usage: 'Team Home Advantage reference',
    })
  }

  const quickRematchWindows = getQuickRematchWindows(
    baselineConfiguration,
    normalizedRequest.experiments,
  )
  const preparedBySeason = new Map(
    normalizedRequest.evaluationSeasons.map((seasonId) => {
      const prepared = scheduleCalibrationService.preparePhase3ReplayGames(
        gamesBySeason.get(seasonId),
        seasonId,
        teams,
      )

      return [seasonId, prepared]
    }),
  )
  const homeSnapshots = needsHomeSnapshots
    ? homeAdvantageCalibrationService.buildHistoricalTierSnapshots({
        gamesBySeason,
        teams,
      })
    : []
  const homeSnapshotsBySeason = new Map(
    homeSnapshots.map((snapshot) => [snapshot.targetSeasonId, snapshot]),
  )
  let specialTeamsDatasets = new Map()

  if (needsSpecialTeamsSnapshots) {
    const referenceSeasonIds = [
      ...new Set(
        normalizedRequest.evaluationSeasons.flatMap((seasonId) =>
          specialTeamsCalibrationService.getPriorSeasonIds(seasonId),
        ),
      ),
    ]
    const specialTeamsLoader = options.specialTeamsLoader ??
      historicalSpecialTeamsDataService.loadPreparedSpecialTeamsSeasons

    specialTeamsDatasets = await specialTeamsLoader(
      referenceSeasonIds,
      options.specialTeamsOptions ?? {},
    )
  }

  const seasonContexts = normalizedRequest.evaluationSeasons.map((seasonId) => {
    const games = preparedBySeason.get(seasonId).games
    const specialTeamsReference = needsSpecialTeamsSnapshots
      ? specialTeamsCalibrationService.buildFrozenSpecialTeamsReference({
          seasonDatasets: specialTeamsDatasets,
          targetSeasonId: seasonId,
          targetTeamIds: teams.map((team) => team.teamId),
        })
      : null

    return {
      games,
      homeAdvantageSnapshot: homeSnapshotsBySeason.get(seasonId) ?? null,
      scheduleFacts: scheduleCalibrationService.buildScheduleFacts(
        games,
        quickRematchWindows,
      ),
      seasonId,
      specialTeamsFactsByThreshold: specialTeamsReference
        ? specialTeamsCalibrationService.buildMatchupFacts(
            games,
            specialTeamsReference,
            specialTeamsThresholds,
          )
        : new Map(),
      specialTeamsReference,
    }
  })
  const includedGameIds = seasonContexts.flatMap((season) =>
    season.games.map((game) => game.gameId),
  )
  const datasetContext = createCalibrationDatasetContext({
    includedGameIds,
    preparationMetadata: normalizedRequest.evaluationSeasons.map(
      (seasonId) => ({
        dataset: datasetsBySeason.get(seasonId) ?? { seasonId },
        seasonId,
      }),
    ),
    seasons: normalizedRequest.evaluationSeasons,
  })
  const startingStateIdentity = buildRunStartingStateIdentity({
    currentRatings,
    evaluationSeasons: normalizedRequest.evaluationSeasons,
    historicalStartingRatingsBySeason:
      options.historicalStartingRatingsBySeason,
    policy: normalizedRequest.startingStatePolicy,
    teams,
  })

  return {
    datasetContext,
    eligibility: Object.fromEntries(
      normalizedRequest.evaluationSeasons.map((seasonId) => [
        seasonId,
        preparedBySeason.get(seasonId).eligibility,
      ]),
    ),
    featureState: {
      specialTeams: Object.fromEntries(
        seasonContexts.map((season) => [
          season.seasonId,
          season.specialTeamsReference
            ? {
                frozenBeforeTargetSeason:
                  season.specialTeamsReference.frozenBeforeTargetSeason,
                sourceSeasonIds:
                  season.specialTeamsReference.sourceSeasonIds,
                snapshotSignature: createDeterministicSignature(
                  'nhl-edge/calibration-special-teams-snapshot/v1',
                  season.specialTeamsReference,
                ),
                targetSeasonIncluded:
                  season.specialTeamsReference.targetSeasonIncluded,
              }
            : null,
        ]),
      ),
      teamHomeAdvantage: Object.fromEntries(
        seasonContexts.map((season) => [
          season.seasonId,
          season.homeAdvantageSnapshot
            ? {
                assignedBeforeReplay:
                  season.homeAdvantageSnapshot.assignedBeforeReplay,
                sourceSeasonIds:
                  season.homeAdvantageSnapshot.sourceSeasonIds,
                snapshotSignature: createDeterministicSignature(
                  'nhl-edge/calibration-home-advantage-snapshot/v1',
                  season.homeAdvantageSnapshot,
                ),
                targetSeasonIncluded:
                  season.homeAdvantageSnapshot.sourceSeasonIds.includes(
                    season.seasonId,
                  ),
              }
            : null,
        ]),
      ),
    },
    seasonContexts,
    startingStateIdentity,
  }
}

const normalizeTeamAdjustmentRows = (value, field) => {
  const rows = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? Object.entries(value).map(([teamId, adjustment]) => ({
          adjustment,
          teamId,
        }))
      : null

  if (!rows) {
    throw new CalibrationOrchestrationError(
      `${field} must be an array or team-keyed object.`,
      400,
      { field },
    )
  }

  const normalized = rows.map((row, index) => ({
    adjustment: requireFiniteNumber(
      row?.adjustment,
      `${field}[${index}].adjustment`,
    ),
    teamId: String(row?.teamId ?? '').trim().toUpperCase(),
  }))

  if (normalized.some((row) => !row.teamId) ||
    new Set(normalized.map((row) => row.teamId)).size !== normalized.length) {
    throw new CalibrationOrchestrationError(
      `${field} requires unique non-empty team IDs.`,
      400,
      { field },
    )
  }

  return normalized.sort((left, right) =>
    compareIdentifiers(left.teamId, right.teamId),
  )
}

const applyIsolatedExperimentOverrides = (baselineConfiguration, experiment) => {
  const configuration = canonicalize(baselineConfiguration)
  const overrides = experiment.overrides

  if (experiment.type === CANDIDATE_TYPES.BASE_MODEL) {
    Object.entries(overrides).forEach(([field, value]) => {
      if (field !== 'startingRatings') {
        configuration.model[field] = requireFiniteNumber(
          value,
          `overrides.${field}`,
        )
      }
    })
  } else if (experiment.type === CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE) {
    const map = overrides.teamAdjustments ?? overrides.adjustments

    configuration.features.teamHomeAdvantage = map !== undefined
      ? {
          adjustments: normalizeTeamAdjustmentRows(
            map,
            'overrides.teamAdjustments',
          ),
          enabled: overrides.enabled === undefined
            ? true
            : requireBoolean(overrides.enabled, 'overrides.enabled'),
          mode: 'team_map',
        }
      : {
          adjustment: requireFiniteNumber(
            overrides.adjustment ?? 0,
            'overrides.adjustment',
          ),
          adjustments: [],
          enabled: overrides.enabled === undefined
            ? true
            : requireBoolean(overrides.enabled, 'overrides.enabled'),
          mode: 'tier',
        }
  } else if (experiment.type === CANDIDATE_TYPES.REST_FATIGUE) {
    const adjustments = {
      ...configuration.features.restFatigue.adjustments,
    }
    const nested = overrides.adjustments ?? {}

    if (!isPlainObject(nested)) {
      throw new CalibrationOrchestrationError(
        'overrides.adjustments must be an object.',
        400,
      )
    }

    const allowedNestedFields = new Set([
      ...Object.keys(REST_RULE_FIELDS),
      ...Object.values(REST_RULE_FIELDS),
    ])
    const unsupportedNestedFields = Object.keys(nested).filter(
      (field) => !allowedNestedFields.has(field),
    )

    if (unsupportedNestedFields.length > 0) {
      throw new CalibrationOrchestrationError(
        'overrides.adjustments contains unsupported Rest/Fatigue rules.',
        400,
        { unsupportedFields: unsupportedNestedFields },
      )
    }

    Object.entries(REST_RULE_FIELDS).forEach(([field, ruleId]) => {
      const value = overrides[field] ?? nested[field] ?? nested[ruleId]

      if (value !== undefined) {
        adjustments[ruleId] = requireFiniteNumber(
          value,
          `overrides.${field}`,
        )
      }
    })
    configuration.features.restFatigue = {
      adjustments,
      enabled: overrides.enabled === undefined
        ? true
        : requireBoolean(overrides.enabled, 'overrides.enabled'),
      includeWellRested: overrides.includeWellRested === undefined
        ? adjustments.well_rested !== 0
        : requireBoolean(
            overrides.includeWellRested,
            'overrides.includeWellRested',
          ),
    }

    if (configuration.features.restFatigue.enabled !== true) {
      configuration.features.restFatigue.adjustments = Object.fromEntries(
        Object.values(REST_RULE_FIELDS).map((ruleId) => [ruleId, 0]),
      )
      configuration.features.restFatigue.includeWellRested = false
    }
  } else if (experiment.type === CANDIDATE_TYPES.QUICK_REMATCH) {
    const feature = configuration.features.quickRematch

    const maximumDays = requireFiniteNumber(
      overrides.maximumDays ?? feature.maximumDays,
      'overrides.maximumDays',
    )

    if (!Number.isInteger(maximumDays) || maximumDays < 1 ||
      maximumDays > scheduleCalibrationService.MAX_CUSTOM_QUICK_REMATCH_WINDOW) {
      throw new CalibrationOrchestrationError(
        `overrides.maximumDays must be an integer from 1 through ${scheduleCalibrationService.MAX_CUSTOM_QUICK_REMATCH_WINDOW}.`,
        400,
      )
    }

    configuration.features.quickRematch = {
      enabled: overrides.enabled === undefined
        ? true
        : requireBoolean(overrides.enabled, 'overrides.enabled'),
      loserAdjustment: requireFiniteNumber(
        overrides.loserAdjustment ?? feature.loserAdjustment,
        'overrides.loserAdjustment',
      ),
      maximumDays,
    }
  } else if (experiment.type === CANDIDATE_TYPES.SPECIAL_TEAMS) {
    const feature = configuration.features.specialTeams
    const topBottomN = requireFiniteNumber(
      overrides.topBottomN ?? feature.topBottomN,
      'overrides.topBottomN',
    )

    if (!Number.isInteger(topBottomN) ||
      topBottomN < specialTeamsCalibrationService.CUSTOM_THRESHOLD_LIMITS.min ||
      topBottomN > specialTeamsCalibrationService.CUSTOM_THRESHOLD_LIMITS.max) {
      throw new CalibrationOrchestrationError(
        `overrides.topBottomN must be an integer from ${specialTeamsCalibrationService.CUSTOM_THRESHOLD_LIMITS.min} through ${specialTeamsCalibrationService.CUSTOM_THRESHOLD_LIMITS.max}.`,
        400,
      )
    }

    configuration.features.specialTeams = {
      adjustmentMagnitude: requireFiniteNumber(
        overrides.adjustmentMagnitude ??
          overrides.adjustment ??
          feature.adjustmentMagnitude,
        'overrides.adjustmentMagnitude',
      ),
      automaticAdjustmentEnabled:
        overrides.automaticAdjustmentEnabled === undefined
          ? true
          : requireBoolean(
              overrides.automaticAdjustmentEnabled,
              'overrides.automaticAdjustmentEnabled',
            ),
      enabled: overrides.enabled === undefined
        ? true
        : requireBoolean(overrides.enabled, 'overrides.enabled'),
      topBottomN,
    }
  }

  if (configuration.model.probabilityScale <= 0) {
    throw new CalibrationOrchestrationError(
      'Model probabilityScale must be greater than zero.',
      400,
    )
  }

  return deepFreeze(configuration)
}

const applyExperimentOverrides = (baselineConfiguration, experiment) => {
  if (experiment.type !== CANDIDATE_TYPES.COMBINED) {
    return applyIsolatedExperimentOverrides(baselineConfiguration, experiment)
  }

  return [...experiment.components]
    .sort((left, right) => compareIdentifiers(left.type, right.type))
    .reduce(
      (configuration, component) =>
        applyIsolatedExperimentOverrides(configuration, component),
      baselineConfiguration,
    )
}

const getCandidateStartingStateIdentity = ({
  commonStartingStateIdentity,
  currentRatings,
  experiment,
  normalizedRequest,
  options,
  teams,
}) => {
  const override = experiment.type === CANDIDATE_TYPES.BASE_MODEL
    ? experiment.overrides.startingRatings
    : null

  if (override === null || override === undefined) {
    return commonStartingStateIdentity
  }

  if (!isPlainObject(override)) {
    throw new CalibrationOrchestrationError(
      'overrides.startingRatings must be an object.',
      400,
    )
  }

  const unsupportedFields = Object.keys(override).filter(
    (field) => !['center', 'spread'].includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new CalibrationOrchestrationError(
      'overrides.startingRatings contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  if (normalizedRequest.startingStatePolicy ===
    STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER) {
    throw new CalibrationOrchestrationError(
      'Starting-rating presets cannot override CURRENT_PRODUCTION_ORDER.',
      400,
    )
  }

  const center = requireFiniteNumber(
    override.center ?? BASE_MODEL_V1.startingRatings.center,
    'overrides.startingRatings.center',
  )
  const spread = requireFiniteNumber(
    override.spread ??
      (normalizedRequest.startingStatePolicy ===
        STARTING_STATE_POLICIES.EQUAL_RATINGS
        ? 0
        : BASE_MODEL_V1.startingRatings.spread),
    'overrides.startingRatings.spread',
  )

  if (normalizedRequest.startingStatePolicy ===
    STARTING_STATE_POLICIES.EQUAL_RATINGS && spread !== 0) {
    throw new CalibrationOrchestrationError(
      'EQUAL_RATINGS candidates require a zero starting spread.',
      400,
    )
  }

  return buildRunStartingStateIdentity({
    center,
    currentRatings,
    evaluationSeasons: normalizedRequest.evaluationSeasons,
    historicalStartingRatingsBySeason:
      options.historicalStartingRatingsBySeason,
    policy: normalizedRequest.startingStatePolicy,
    spread,
    teams,
  })
}

const buildMetricDeltas = (metrics, baselineMetrics) => ({
  deltaAccuracy: metrics.accuracy - baselineMetrics.accuracy,
  deltaBrier: metrics.pooledBrier - baselineMetrics.pooledBrier,
  deltaLogLoss: metrics.logLoss - baselineMetrics.logLoss,
})

const buildSeasonConsistency = (perSeason, baselinePerSeason) => {
  const baselineBySeason = new Map(
    baselinePerSeason.map((season) => [season.seasonId, season]),
  )

  return perSeason.reduce(
    (diagnostic, season) => {
      const delta = season.brier - baselineBySeason.get(season.seasonId).brier

      if (Math.abs(delta) <= 1e-12) diagnostic.seasonsEqual += 1
      else if (delta < 0) diagnostic.seasonsImproved += 1
      else diagnostic.seasonsWorse += 1

      return diagnostic
    },
    {
      seasonCount: perSeason.length,
      seasonsEqual: 0,
      seasonsImproved: 0,
      seasonsWorse: 0,
    },
  )
}

const getEvaluationCounts = (frozenContext) => {
  const includedGames = frozenContext.datasetContext.gameCount
  const excludedGames = Object.values(frozenContext.eligibility).reduce(
    (sum, eligibility) => sum + (eligibility.skipped ?? 0),
    0,
  )

  return { excludedGames, includedGames }
}

const createCandidateEnvelope = ({
  baselineCandidate,
  baselineMode,
  baselineSignature,
  configuration,
  datasetContext,
  experiment,
  frozenContext,
  productionSnapshotId,
  replay,
  startingStateIdentity,
}) => {
  const counts = getEvaluationCounts(frozenContext)
  const candidate = createCalibrationCandidate({
    baseline: {
      candidateId: baselineCandidate.candidateId,
      identity: baselineMode,
      label: baselineCandidate.label,
      metrics: baselineCandidate.metrics,
    },
    candidateId: experiment.candidateId,
    candidateType: experiment.type,
    comparison: buildMetricDeltas(replay.metrics, baselineCandidate.metrics),
    components: experiment.components,
    configuration,
    diagnostics: {
      executionStatus: 'completed',
      replay: replay.diagnostics,
      seasonConsistency: buildSeasonConsistency(
        replay.perSeason,
        baselineCandidate.perSeason,
      ),
    },
    evaluation: {
      excludedGames: counts.excludedGames,
      games: replay.predictions.length,
      includedGames: counts.includedGames,
      seasons: datasetContext.seasons,
    },
    label: experiment.label,
    metadata: {
      baselineSignature,
      configurationSignature: createDeterministicSignature(
        'nhl-edge/calibration-candidate-configuration/v1',
        configuration,
      ),
      datasetSignature: datasetContext.datasetSignature,
      modelVersion: configuration.model.modelVersion,
      productionSnapshotId,
      startingStateSignature:
        startingStateIdentity.startingStateSignature,
    },
    metrics: replay.metrics,
    overrides: experiment.overrides,
    perSeason: replay.perSeason,
  })
  const comparison = compareCalibrationCandidates(
    baselineCandidate,
    candidate,
  )

  candidate.diagnostics.comparability = comparison
  return candidate
}

const createFailedCandidate = ({
  baselineCandidate,
  baselineMode,
  baselineSignature,
  datasetContext,
  error,
  experiment,
  frozenContext,
  productionSnapshotId,
  startingStateSignature,
}) => {
  const counts = getEvaluationCounts(frozenContext)

  return createCalibrationCandidate({
    baseline: {
      candidateId: baselineCandidate.candidateId,
      identity: baselineMode,
      label: baselineCandidate.label,
      metrics: baselineCandidate.metrics,
    },
    candidateId: experiment.candidateId,
    candidateType: experiment.type,
    components: experiment.components,
    diagnostics: {
      comparability: {
        comparable: false,
        warnings: [
          {
            code: 'CANDIDATE_EXECUTION_FAILED',
            field: 'diagnostics.executionStatus',
            message: 'Candidate failed and is not eligible for direct ranking.',
          },
        ],
      },
      error: {
        code: error.name ?? 'Error',
        details: error.details ?? null,
        message: error.publicMessage ?? error.message,
      },
      executionStatus: 'failed',
    },
    evaluation: {
      excludedGames: counts.excludedGames,
      games: 0,
      includedGames: counts.includedGames,
      seasons: datasetContext.seasons,
    },
    label: experiment.label,
    metadata: {
      baselineSignature,
      configurationSignature: null,
      datasetSignature: datasetContext.datasetSignature,
      modelVersion: null,
      productionSnapshotId,
      startingStateSignature,
    },
    overrides: experiment.overrides,
  })
}

const addCombinedInteractionDiagnostics = (candidates) => {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  )

  candidates
    .filter((candidate) => candidate.candidateType === CANDIDATE_TYPES.COMBINED)
    .forEach((candidate) => {
      const componentCandidateIds = candidate.components
        .map((component) => component.candidateId)
        .filter(Boolean)
      const availableComponents = candidate.components.flatMap((component) => {
        if (!component.candidateId) return []

        const isolated = candidatesById.get(component.candidateId)

        return isolated &&
          isolated.candidateType === component.type &&
          isolated.diagnostics.executionStatus === 'completed' &&
          isolated.diagnostics.comparability.comparable &&
          Number.isFinite(isolated.metrics.pooledBrier)
          ? [isolated]
          : []
      })
      const bestComponent = availableComponents.sort(
        (left, right) =>
          left.metrics.pooledBrier - right.metrics.pooledBrier ||
          compareIdentifiers(left.candidateId, right.candidateId),
      )[0] ?? null

      candidate.diagnostics.interaction = {
        availableComponentCandidateIds: availableComponents.map(
          (component) => component.candidateId,
        ).sort(compareIdentifiers),
        bestComponentBrier: bestComponent?.metrics.pooledBrier ?? null,
        bestComponentCandidateId: bestComponent?.candidateId ?? null,
        combinedVsBestComponentDeltaBrier:
          bestComponent && Number.isFinite(candidate.metrics.pooledBrier)
            ? candidate.metrics.pooledBrier - bestComponent.metrics.pooledBrier
            : null,
        componentCandidateIds,
        interpretation:
          'descriptive_only_not_a_statistical_interaction_estimate',
      }
    })
}

const buildRanking = (candidates) => {
  const ranked = candidates
    .filter(
      (candidate) =>
        candidate.diagnostics.executionStatus === 'completed' &&
        candidate.diagnostics.comparability.comparable &&
        Number.isFinite(candidate.metrics.pooledBrier),
    )
    .sort(
      (left, right) =>
        left.metrics.pooledBrier - right.metrics.pooledBrier ||
        compareIdentifiers(left.candidateId, right.candidateId),
    )
    .map((candidate, index) => ({
      candidateId: candidate.candidateId,
      deltaBrier: candidate.comparison.deltaBrier,
      pooledBrier: candidate.metrics.pooledBrier,
      rank: index + 1,
      seasonsEqual: candidate.diagnostics.seasonConsistency.seasonsEqual,
      seasonsImproved:
        candidate.diagnostics.seasonConsistency.seasonsImproved,
      seasonsWorse: candidate.diagnostics.seasonConsistency.seasonsWorse,
    }))
  const rankedIds = new Set(ranked.map((candidate) => candidate.candidateId))

  return {
    comparable: ranked,
    unranked: candidates
      .filter((candidate) => !rankedIds.has(candidate.candidateId))
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        reasons: candidate.diagnostics.comparability.warnings.map(
          (warning) => warning.code,
        ),
      }))
      .sort((left, right) =>
        compareIdentifiers(left.candidateId, right.candidateId),
      ),
  }
}

const getRunId = ({
  baselineSignature,
  datasetSignature,
  normalizedRequest,
  productionSnapshotId,
  startingStateSignature,
}) =>
  createDeterministicSignature('nhl-edge/calibration-orchestration-run/v1', {
    baselineSignature,
    datasetSignature,
    experiments: [...normalizedRequest.experiments].sort((left, right) =>
      compareIdentifiers(left.candidateId, right.candidateId),
    ),
    productionSnapshotId,
    startingStateSignature,
  })

const captureBaseline = async ({ currentRatings, normalizedRequest, options, userId }) => {
  if (normalizedRequest.baselineMode ===
    BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1) {
    const baseline = buildCanonicalBaseline()

    return {
      baselineSignature: baseline.baselineSignature,
      configuration: normalizeReplayConfiguration(baseline.configuration),
      productionSnapshot: null,
    }
  }

  const productionSnapshot = options.productionSnapshotProvider
    ? await options.productionSnapshotProvider(userId)
    : await captureCalibrationProductionSnapshot(userId, {
        ...(options.productionSnapshotOptions ?? {}),
        ...(currentRatings
          ? { powerRatingsProvider: async () => currentRatings }
          : {}),
      })

  if (productionSnapshot?.baselineIdentity !==
    BASELINE_IDENTITIES.CURRENT_PRODUCTION ||
    !productionSnapshot.baselineSignature ||
    !productionSnapshot.productionSnapshotId) {
    throw new CalibrationOrchestrationError(
      'Production snapshot provider returned an incomplete snapshot.',
      500,
    )
  }

  return {
    baselineSignature: productionSnapshot.baselineSignature,
    configuration: normalizeReplayConfiguration(
      productionSnapshot.configuration,
    ),
    productionSnapshot: deepFreeze(canonicalize(productionSnapshot)),
  }
}

const runCalibrationOrchestration = async (userId, request, options = {}) => {
  if (!userId) {
    throw new CalibrationOrchestrationError(
      'Authenticated userId is required.',
      401,
    )
  }

  const startedAt = Date.now()
  const normalizedRequest = normalizeRequest(request)
  const teams = normalizeTeams(
    await (options.teamsProvider ?? getSeedTeams)(),
  )
  const needsCurrentRatings = normalizedRequest.startingStatePolicy ===
    STARTING_STATE_POLICIES.CURRENT_PRODUCTION_ORDER
  const currentRatings = needsCurrentRatings
    ? await (options.currentRatingsProvider ?? getRatingsForUser)(userId)
    : null
  const baseline = await captureBaseline({
    currentRatings,
    normalizedRequest,
    options,
    userId,
  })
  const frozenContext = await buildFrozenEvaluationContext({
    baselineConfiguration: baseline.configuration,
    currentRatings,
    normalizedRequest,
    options,
    teams,
  })
  const productionSnapshotId =
    baseline.productionSnapshot?.productionSnapshotId ?? null
  const baselineReplay = replayCalibrationRun({
    configuration: baseline.configuration,
    seasonContexts: frozenContext.seasonContexts,
    startingStateIdentity: frozenContext.startingStateIdentity,
  })
  const counts = getEvaluationCounts(frozenContext)
  const baselineCandidate = createCalibrationCandidate({
    baseline: {
      candidateId: BASELINE_CANDIDATE_ID,
      identity: normalizedRequest.baselineMode,
      label: normalizedRequest.baselineMode,
      metrics: baselineReplay.metrics,
    },
    candidateId: BASELINE_CANDIDATE_ID,
    candidateType: CANDIDATE_TYPES.BASELINE,
    comparison: {
      deltaAccuracy: 0,
      deltaBrier: 0,
      deltaLogLoss: 0,
    },
    configuration: baseline.configuration,
    diagnostics: {
      comparability: { comparable: true, warnings: [] },
      executionStatus: 'completed',
      replay: baselineReplay.diagnostics,
      seasonConsistency: {
        seasonCount: baselineReplay.perSeason.length,
        seasonsEqual: baselineReplay.perSeason.length,
        seasonsImproved: 0,
        seasonsWorse: 0,
      },
    },
    evaluation: {
      excludedGames: counts.excludedGames,
      games: baselineReplay.predictions.length,
      includedGames: counts.includedGames,
      seasons: frozenContext.datasetContext.seasons,
    },
    label: normalizedRequest.baselineMode,
    metadata: {
      baselineSignature: baseline.baselineSignature,
      configurationSignature: createDeterministicSignature(
        'nhl-edge/calibration-candidate-configuration/v1',
        baseline.configuration,
      ),
      datasetSignature: frozenContext.datasetContext.datasetSignature,
      modelVersion: baseline.configuration.model.modelVersion,
      productionSnapshotId,
      startingStateSignature:
        frozenContext.startingStateIdentity.startingStateSignature,
    },
    metrics: baselineReplay.metrics,
    perSeason: baselineReplay.perSeason,
  })
  const candidateReplays = new Map()
  const candidates = normalizedRequest.experiments.map((experiment) => {
    let candidateStartingStateIdentity = frozenContext.startingStateIdentity

    try {
      const configuration = applyExperimentOverrides(
        baseline.configuration,
        experiment,
      )
      candidateStartingStateIdentity = getCandidateStartingStateIdentity({
        commonStartingStateIdentity: frozenContext.startingStateIdentity,
        currentRatings,
        experiment,
        normalizedRequest,
        options,
        teams,
      })
      const replay = replayCalibrationRun({
        configuration,
        seasonContexts: frozenContext.seasonContexts,
        startingStateIdentity: candidateStartingStateIdentity,
      })

      candidateReplays.set(experiment.candidateId, replay)

      return createCandidateEnvelope({
        baselineCandidate,
        baselineMode: normalizedRequest.baselineMode,
        baselineSignature: baseline.baselineSignature,
        configuration,
        datasetContext: frozenContext.datasetContext,
        experiment,
        frozenContext,
        productionSnapshotId,
        replay,
        startingStateIdentity: candidateStartingStateIdentity,
      })
    } catch (error) {
      return createFailedCandidate({
        baselineCandidate,
        baselineMode: normalizedRequest.baselineMode,
        baselineSignature: baseline.baselineSignature,
        datasetContext: frozenContext.datasetContext,
        error,
        experiment,
        frozenContext,
        productionSnapshotId,
        startingStateSignature:
          candidateStartingStateIdentity.startingStateSignature,
      })
    }
  })
  addCombinedInteractionDiagnostics(candidates)
  const ranking = buildRanking(candidates)
  const warnings = []

  if (normalizedRequest.baselineMode ===
    BASELINE_IDENTITIES.CURRENT_PRODUCTION) {
    warnings.push({
      code: 'GAME_SPECIFIC_FEATURES_NEUTRAL_IN_HISTORICAL_REPLAY',
      message:
        'Injuries, goalie status, motivation and manual Analyzer inputs have no historical calibration source and remain neutral for every result in this run.',
    })
  }

  if (ranking.unranked.length > 0) {
    warnings.push({
      code: 'UNRANKED_CANDIDATES_PRESENT',
      message: `${ranking.unranked.length} candidate(s) were preserved outside the comparable ranking.`,
    })
  }

  const result = {
    baseline: baselineCandidate,
    baselineMode: normalizedRequest.baselineMode,
    candidates,
    diagnostics: {
      candidateFailurePolicy:
        'candidate_level_error_preserves_successful_candidates',
      durationMs: Date.now() - startedAt,
      productionWrites: false,
    },
    evaluationContext: {
      baselineConfiguration: canonicalize(baseline.configuration),
      baselineSignature: baseline.baselineSignature,
      datasetRevision: frozenContext.datasetContext.datasetRevision,
      datasetSignature: frozenContext.datasetContext.datasetSignature,
      featureState: frozenContext.featureState,
      gameCount: frozenContext.datasetContext.gameCount,
      gameIdSignature: frozenContext.datasetContext.gameIdSignature,
      includedGameIds: frozenContext.datasetContext.includedGameIds,
      productionSnapshotId,
      seasons: frozenContext.datasetContext.seasons,
      startingStatePolicy: frozenContext.startingStateIdentity.policy,
      startingStateSignature:
        frozenContext.startingStateIdentity.startingStateSignature,
    },
    ranking,
    runId: getRunId({
      baselineSignature: baseline.baselineSignature,
      datasetSignature: frozenContext.datasetContext.datasetSignature,
      normalizedRequest,
      productionSnapshotId,
      startingStateSignature:
        frozenContext.startingStateIdentity.startingStateSignature,
    }),
    warnings,
  }

  const latestHomeAdvantageContext = [...frozenContext.seasonContexts]
    .sort((left, right) => compareIdentifiers(right.seasonId, left.seasonId))
    .find((season) => season.homeAdvantageSnapshot?.tiers)

  ;(options.analysisContextStore ?? storeCalibrationAnalysisContext)({
    baselineReplay,
    candidateReplays,
    promotionContext: latestHomeAdvantageContext
      ? {
          teamHomeAdvantageSnapshot: {
            seasonId: latestHomeAdvantageContext.seasonId,
            tiers: latestHomeAdvantageContext.homeAdvantageSnapshot.tiers,
          },
        }
      : null,
    result,
    userId,
  })

  options.logger?.info?.('Calibration orchestration completed.', {
    baselineMode: normalizedRequest.baselineMode,
    candidateCount: candidates.length,
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    durationMs: result.diagnostics.durationMs,
    errorCandidateIds: candidates
      .filter((candidate) => candidate.diagnostics.executionStatus === 'failed')
      .map((candidate) => candidate.candidateId),
    runId: result.runId,
    seasons: normalizedRequest.evaluationSeasons,
  })

  return deepFreeze(result)
}

module.exports = {
  BASELINE_CANDIDATE_ID,
  CalibrationOrchestrationError,
  SUPPORTED_BASELINE_MODES,
  COMBINED_COMPONENT_TYPES,
  SUPPORTED_EXPERIMENT_TYPES,
  applyExperimentOverrides,
  buildCanonicalBaseline,
  normalizeRequest,
  normalizeReplayConfiguration,
  runCalibrationOrchestration,
}
