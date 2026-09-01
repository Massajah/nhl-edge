const historicalNhlDataService = require('../services/historicalNhlDataService')
const historicalSpecialTeamsDataService = require('../services/historicalSpecialTeamsDataService')
const homeAdvantageCalibrationService = require('../services/homeAdvantageCalibrationService')
const {
  FALLBACK_SEASONS,
  getSeasonLabel,
} = require('../services/nhlSeasonService')
const scheduleCalibrationService = require('../services/scheduleCalibrationService')
const specialTeamsCalibrationService = require('../services/specialTeamsCalibrationService')
const {
  STARTING_STATE_POLICIES,
  deepFreeze,
} = require('./calibrationIdentity')
const {
  captureCalibrationProductionSnapshot,
} = require('./calibrationProductionSnapshot')
const {
  BASELINE_IDENTITIES,
} = require('./calibrationResultContract')
const {
  buildCanonicalBaseline,
  normalizeReplayConfiguration,
} = require('./calibrationOrchestrator')

class CalibrationOrchestrationOptionsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'CalibrationOrchestrationOptionsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const getSeasonDefinition = (seasonId) => {
  const season = FALLBACK_SEASONS.find((candidate) => candidate.id === seasonId)

  if (!season) {
    throw new CalibrationOrchestrationOptionsError(
      'A shared replay season is missing NHL season metadata.',
      500,
      { seasonId },
    )
  }

  return {
    endDate: season.endDate,
    expectedApproximateGames: seasonId === '20202021' ? 868 : 1312,
    id: seasonId,
    label: getSeasonLabel(seasonId),
    startDate: season.startDate,
  }
}

const toStatusMap = (statuses) =>
  new Map((statuses ?? []).map((status) => [status.seasonId, status]))

const getCalibrationOrchestrationOptions = async (userId, options = {}) => {
  if (!userId) {
    throw new CalibrationOrchestrationOptionsError(
      'Authenticated userId is required.',
      401,
    )
  }

  const evaluationSeasonIds = scheduleCalibrationService.DEFAULT_SEASON_IDS
  const homeReferenceSeasonIds = [
    ...new Set(
      evaluationSeasonIds.flatMap((seasonId) =>
        homeAdvantageCalibrationService.getPriorSeasonIds(seasonId),
      ),
    ),
  ]
  const specialTeamsReferenceSeasonIds = [
    ...new Set(
      evaluationSeasonIds.flatMap((seasonId) =>
        specialTeamsCalibrationService.getPriorSeasonIds(seasonId),
      ),
    ),
  ]
  const gameSeasonIds = [
    ...new Set([...evaluationSeasonIds, ...homeReferenceSeasonIds]),
  ]
  const gameDefinitions = gameSeasonIds.map(getSeasonDefinition)
  const gameStatusProvider = options.gameStatusProvider ??
    historicalNhlDataService.getHistoricalSeasonStatuses
  const specialTeamsStatusProvider = options.specialTeamsStatusProvider ??
    historicalSpecialTeamsDataService.getHistoricalSpecialTeamsStatuses
  const productionSnapshotProvider = options.productionSnapshotProvider ??
    captureCalibrationProductionSnapshot
  const [gameStatuses, specialTeamsStatuses, productionSnapshot] =
    await Promise.all([
      gameStatusProvider(gameDefinitions, options.gameStatusOptions ?? {}),
      specialTeamsStatusProvider(
        specialTeamsReferenceSeasonIds,
        options.specialTeamsStatusOptions ?? {},
      ),
      productionSnapshotProvider(
        userId,
        options.productionSnapshotOptions ?? {},
      ),
    ])
  const gameStatusById = toStatusMap(gameStatuses)
  const specialTeamsStatusById = toStatusMap(specialTeamsStatuses)
  const canonicalBaseline = buildCanonicalBaseline()
  const productionConfiguration = normalizeReplayConfiguration(
    productionSnapshot.configuration,
  )
  const canonicalConfiguration = normalizeReplayConfiguration(
    canonicalBaseline.configuration,
  )
  const seasons = evaluationSeasonIds.map((seasonId) => {
    const definition = getSeasonDefinition(seasonId)
    const historicalDataset = gameStatusById.get(seasonId) ??
      historicalNhlDataService.makeDatasetStatus(null, definition)
    const homeSourceSeasonIds =
      homeAdvantageCalibrationService.getPriorSeasonIds(seasonId)
    const specialTeamsSourceSeasonIds =
      specialTeamsCalibrationService.getPriorSeasonIds(seasonId)
    const missingHomeReferenceSeasonIds = homeSourceSeasonIds.filter(
      (sourceSeasonId) =>
        gameStatusById.get(sourceSeasonId)?.status !== 'ready',
    )
    const missingSpecialTeamsReferenceSeasonIds =
      specialTeamsSourceSeasonIds.filter(
        (sourceSeasonId) =>
          specialTeamsStatusById.get(sourceSeasonId)?.status !== 'ready',
      )

    return {
      ...definition,
      historicalDataset,
      readiness: {
        baseModel: historicalDataset.status === 'ready',
        quickRematch: historicalDataset.status === 'ready',
        restFatigue: historicalDataset.status === 'ready',
        specialTeams:
          historicalDataset.status === 'ready' &&
          missingSpecialTeamsReferenceSeasonIds.length === 0,
        specialTeamsReference: {
          missingSeasonIds: missingSpecialTeamsReferenceSeasonIds,
          sourceSeasonIds: specialTeamsSourceSeasonIds,
        },
        teamHomeAdvantage:
          historicalDataset.status === 'ready' &&
          missingHomeReferenceSeasonIds.length === 0,
        teamHomeAdvantageReference: {
          missingSeasonIds: missingHomeReferenceSeasonIds,
          sourceSeasonIds: homeSourceSeasonIds,
        },
      },
    }
  })

  return deepFreeze({
    baselineModes: [
      {
        configuration: productionConfiguration,
        description: 'Current user-scoped model configuration.',
        id: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
        label: 'Current Production',
        productionSnapshotId: productionSnapshot.productionSnapshotId,
      },
      {
        configuration: canonicalConfiguration,
        description: 'Fixed calibration reference.',
        id: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
        label: 'Canonical Base Model v1',
        productionSnapshotId: null,
      },
    ],
    candidateDefinitions: {
      quickRematch: {
        adjustmentOptions:
          scheduleCalibrationService.QUICK_REMATCH_ADJUSTMENTS,
        windowOptions: scheduleCalibrationService.QUICK_REMATCH_WINDOWS,
      },
      restFatigue: {
        precedence: scheduleCalibrationService.RULE_ORDER,
        rules: scheduleCalibrationService.RULES,
      },
      specialTeams: {
        adjustmentOptions:
          specialTeamsCalibrationService.STANDARD_ADJUSTMENTS,
        thresholdOptions: specialTeamsCalibrationService.STANDARD_THRESHOLDS,
      },
      teamHomeAdvantage: {
        adjustmentOptions:
          homeAdvantageCalibrationService.DEFAULT_ADJUSTMENTS,
      },
    },
    defaultBaselineMode: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
    defaultSeasonIds: seasons
      .filter((season) => season.historicalDataset.status === 'ready')
      .map((season) => season.id),
    isolation: {
      productionWrites: false,
      readOnly: true,
    },
    seasons,
    startingState: {
      description:
        'Each season starts from the fixed 42–50 Base Model spread in seed-team name order.',
      label: 'Fixed 42–50 historical ordering',
      policy: STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
    },
  })
}

module.exports = {
  CalibrationOrchestrationOptionsError,
  getCalibrationOrchestrationOptions,
}
