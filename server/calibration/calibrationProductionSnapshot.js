const {
  BASELINE_IDENTITIES,
} = require('./calibrationResultContract')
const {
  createBaselineConfigurationIdentity,
  createProductionConfigurationSignature,
  deepFreeze,
} = require('./calibrationIdentity')
const {
  SPECIAL_TEAMS_MODES,
} = require('../config/baseModel')
const {
  getRatingHomeAdjustment,
} = require('../services/homeAdvantageService')
const {
  getProductionRatingEngineSettings,
} = require('../services/ratingEngineSettingsService')
const {
  getRatingsForUser,
} = require('../services/powerRatingsService')
const {
  getQuickRematchSettings,
} = require('../services/quickRematchSettingsService')
const {
  REST_FATIGUE_PRECEDENCE,
} = require('../services/gameContextRules')

const SPECIAL_TEAMS_HISTORICAL_WINDOW = Object.freeze({
  completedSeasonCount: 3,
  methodology: 'previous_three_completed_regular_seasons_average',
})

const PRODUCTION_CONFIGURATION_SOURCES = Object.freeze({
  modelAndSpecialTeams: 'RatingEngineSettings',
  scheduleAndQuickRematch: 'QuickRematchSettings',
  teamHomeAdjustments:
    'PowerRating.homeAdvantage (serialized as homeAdjustment)',
})

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

class CalibrationProductionSnapshotError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'CalibrationProductionSnapshotError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const normalizeTeamId = (rating, index) => {
  const teamId = String(
    rating?.teamId ?? rating?.abbreviation ?? '',
  )
    .trim()
    .toUpperCase()

  if (!teamId) {
    throw new CalibrationProductionSnapshotError(
      'Production Home Adjustment snapshot contains a rating without a team identity.',
      500,
      { index },
    )
  }

  return teamId
}

const normalizeTeamHomeAdjustments = (ratings) => {
  const rows = Array.isArray(ratings?.ratings)
    ? ratings.ratings
    : Array.isArray(ratings)
      ? ratings
      : []
  const normalized = rows
    .map((rating, index) => ({
      adjustment: getRatingHomeAdjustment(rating),
      teamId: normalizeTeamId(rating, index),
    }))
    .sort((left, right) =>
      compareIdentifiers(left.teamId, right.teamId),
    )
  const teamIds = normalized.map((rating) => rating.teamId)

  if (new Set(teamIds).size !== teamIds.length) {
    throw new CalibrationProductionSnapshotError(
      'Production Home Adjustment snapshot contains duplicate team identities.',
      500,
    )
  }

  return normalized
}

const getSpecialTeamsMode = (settings) => {
  const mode = settings.specialTeamsMode

  if (Object.values(SPECIAL_TEAMS_MODES).includes(mode)) {
    return mode
  }

  return settings.specialTeamsAlertsEnabled === false
    ? SPECIAL_TEAMS_MODES.OFF
    : SPECIAL_TEAMS_MODES.ALERT_ONLY
}

const buildProductionConfiguration = ({
  engineSettings,
  scheduleSettings,
  teamHomeAdjustments,
}) => {
  const specialTeamsMode = getSpecialTeamsMode(engineSettings)
  const baseline = createBaselineConfigurationIdentity({
    configuration: {
      features: {
        quickRematch: {
          enabled: scheduleSettings.quickRematchEnabled,
          loserAdjustment: scheduleSettings.quickRematchLoserAdjustment,
          maximumDays: scheduleSettings.quickRematchMaximumDays,
        },
        restFatigue: {
          enabled: scheduleSettings.restFatigueEnabled,
          precedence: REST_FATIGUE_PRECEDENCE,
          rules: {
            backToBack: {
              adjustment: scheduleSettings.backToBackAdjustment,
              enabled: scheduleSettings.backToBackEnabled,
            },
            backToBackTravel: {
              adjustment: scheduleSettings.backToBackTravelAdjustment,
              enabled: scheduleSettings.backToBackTravelEnabled,
            },
            threeInFour: {
              adjustment: scheduleSettings.threeInFourAdjustment,
              enabled: scheduleSettings.threeInFourEnabled,
            },
            wellRested: {
              adjustment: scheduleSettings.wellRestedAdjustment,
              enabled: scheduleSettings.wellRestedEnabled,
            },
          },
        },
        specialTeams: {
          adjustmentMagnitude: engineSettings.specialTeamsAdjustment,
          alertsEnabled: engineSettings.specialTeamsAlertsEnabled,
          automaticAdjustmentEnabled:
            specialTeamsMode === SPECIAL_TEAMS_MODES.AUTOMATIC,
          enabled: specialTeamsMode !== SPECIAL_TEAMS_MODES.OFF,
          historicalWindow: SPECIAL_TEAMS_HISTORICAL_WINDOW,
          mode: specialTeamsMode,
          topBottomN: engineSettings.specialTeamsRankThreshold,
        },
        teamHomeAdvantage: {
          adjustments: teamHomeAdjustments,
          enabled: true,
          storageField: 'PowerRating.homeAdvantage',
        },
      },
      model: {
        baseHomeAdvantage: engineSettings.homeAdvantage,
        kFactor: engineSettings.kFactor,
        modelVersion: engineSettings.modelVersion,
        overtimeMultiplier: engineSettings.overtimeMultiplier,
        probabilityScale: engineSettings.probabilityScale,
        regulationMultiplier: engineSettings.regulationMultiplier,
        shootoutMultiplier: engineSettings.shootoutMultiplier,
      },
    },
    identity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  })
  const configuration = {
    ...baseline.configuration,
    modelAdjustmentGuardrails: {
      maximumGoaliePenalty: engineSettings.maximumGoaliePenalty,
      maximumPlayerInjuryPenalty:
        engineSettings.maximumPlayerInjuryPenalty,
    },
  }

  return {
    baselineSignature: baseline.baselineSignature,
    configuration,
  }
}

const getCapturedAt = (clock) => {
  const value = clock()
  const capturedAt = value instanceof Date ? value : new Date(value)

  if (!Number.isFinite(capturedAt.getTime())) {
    throw new CalibrationProductionSnapshotError(
      'Production snapshot clock returned an invalid date.',
      500,
    )
  }

  return capturedAt.toISOString()
}

/**
 * Reads each user-scoped production source once and freezes the exact result.
 * capturedAt is diagnostic only and is excluded from both deterministic hashes.
 */
const captureCalibrationProductionSnapshot = async (
  userId,
  options = {},
) => {
  if (!userId) {
    throw new CalibrationProductionSnapshotError(
      'Authenticated userId is required.',
      401,
    )
  }

  const engineSettingsProvider =
    options.engineSettingsProvider ?? getProductionRatingEngineSettings
  const scheduleSettingsProvider =
    options.scheduleSettingsProvider ?? getQuickRematchSettings
  const powerRatingsProvider =
    options.powerRatingsProvider ?? getRatingsForUser
  const [engineSettings, scheduleResult, ratings] = await Promise.all([
    engineSettingsProvider(userId, options.engineSettingsOptions ?? {}),
    scheduleSettingsProvider(userId, options.scheduleSettingsOptions ?? {}),
    powerRatingsProvider(userId, options.powerRatingsOptions ?? {}),
  ])
  const scheduleSettings = scheduleResult?.settings ?? scheduleResult
  const teamHomeAdjustments = normalizeTeamHomeAdjustments(ratings)
  const { baselineSignature, configuration } = buildProductionConfiguration({
    engineSettings,
    scheduleSettings,
    teamHomeAdjustments,
  })

  return deepFreeze({
    baselineIdentity: BASELINE_IDENTITIES.CURRENT_PRODUCTION,
    baselineSignature,
    capturedAt: getCapturedAt(options.clock ?? (() => new Date())),
    configuration,
    productionSnapshotId: createProductionConfigurationSignature(configuration),
    sources: PRODUCTION_CONFIGURATION_SOURCES,
  })
}

module.exports = {
  CalibrationProductionSnapshotError,
  PRODUCTION_CONFIGURATION_SOURCES,
  SPECIAL_TEAMS_HISTORICAL_WINDOW,
  buildProductionConfiguration,
  captureCalibrationProductionSnapshot,
  normalizeTeamHomeAdjustments,
}
