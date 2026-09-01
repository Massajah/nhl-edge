const { createHash } = require('crypto')
const {
  BASELINE_IDENTITIES,
} = require('./calibrationResultContract')

const STARTING_STATE_POLICIES = Object.freeze({
  CURRENT_PRODUCTION_ORDER: 'CURRENT_PRODUCTION_ORDER',
  EQUAL_RATINGS: 'EQUAL_RATINGS',
  FIXED_SPREAD_ALPHABETICAL: 'FIXED_SPREAD_ALPHABETICAL',
  FIXED_SPREAD_HISTORICAL_ORDER: 'FIXED_SPREAD_HISTORICAL_ORDER',
  UNKNOWN: 'UNKNOWN',
})

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }

  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const canonicalize = (value, path = 'value') => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers.`)
    }

    return Object.is(value, -0) ? 0 : value
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError(`${path} contains an invalid date.`)
    }

    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] === undefined) {
          throw new TypeError(`${path}.${key} must not be undefined.`)
        }

        result[key] = canonicalize(value[key], `${path}.${key}`)
        return result
      }, {})
  }

  throw new TypeError(`${path} contains an unsupported value.`)
}

const stableSerialize = (value) => JSON.stringify(canonicalize(value))

const createDeterministicSignature = (namespace, value) => {
  const hash = createHash('sha256')
    .update(`${namespace}\n${stableSerialize(value)}`, 'utf8')
    .digest('hex')

  return `sha256:${hash}`
}

const normalizeIdentifier = (value, field) => {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    throw new TypeError(`${field} requires a non-empty identifier.`)
  }

  return normalized
}

const normalizeSortedIdentifiers = (values, field) => {
  if (!Array.isArray(values)) {
    throw new TypeError(`${field} must be an array.`)
  }

  const normalized = values.map((value, index) =>
    normalizeIdentifier(value, `${field}[${index}]`),
  )
  const duplicates = normalized.filter(
    (value, index) => normalized.indexOf(value) !== index,
  )

  if (duplicates.length > 0) {
    throw new TypeError(`${field} must not contain duplicate identifiers.`)
  }

  return normalized.sort(compareIdentifiers)
}

const createGameIdSignature = (gameIds) =>
  createDeterministicSignature(
    'nhl-edge/calibration-game-ids/v1',
    normalizeSortedIdentifiers(gameIds, 'gameIds'),
  )

const getTeamStateEntries = (teamStates) => {
  if (teamStates instanceof Map) {
    return [...teamStates.entries()].map(([teamId, state]) => ({
      ...(state && typeof state === 'object' ? state : { startingRating: state }),
      teamId: state?.teamId ?? teamId,
    }))
  }

  if (Array.isArray(teamStates)) {
    return teamStates
  }

  if (teamStates && typeof teamStates === 'object') {
    return Object.entries(teamStates).map(([teamId, state]) => ({
      ...(state && typeof state === 'object' ? state : { startingRating: state }),
      teamId: state?.teamId ?? teamId,
    }))
  }

  throw new TypeError('Each season starting state requires team values.')
}

const normalizeTeamStartingStates = (teamStates) => {
  const normalized = getTeamStateEntries(teamStates).map((state, index) => {
    const teamId = normalizeIdentifier(
      state.teamId ?? state.abbreviation,
      `teamStates[${index}].teamId`,
    ).toUpperCase()
    const startingRating = Number(
      state.startingRating ??
        state.rating ??
        state.baseRating ??
        state.finalRating,
    )

    if (!Number.isFinite(startingRating)) {
      throw new TypeError(
        `teamStates[${index}].startingRating must be a finite number.`,
      )
    }

    return { startingRating, teamId }
  })
  const teamIds = normalized.map((state) => state.teamId)

  if (new Set(teamIds).size !== teamIds.length) {
    throw new TypeError('Each season starting state requires unique team IDs.')
  }

  return normalized.sort((left, right) =>
    compareIdentifiers(left.teamId, right.teamId),
  )
}

const normalizeStartingStatePolicy = (policy) => {
  const normalized = policy ?? STARTING_STATE_POLICIES.UNKNOWN

  if (!Object.values(STARTING_STATE_POLICIES).includes(normalized)) {
    throw new TypeError(`Unsupported starting-state policy: ${normalized}`)
  }

  return normalized
}

const createStartingStateIdentity = ({
  policy = STARTING_STATE_POLICIES.UNKNOWN,
  seasonStartingStates,
} = {}) => {
  if (!Array.isArray(seasonStartingStates) || seasonStartingStates.length === 0) {
    throw new TypeError(
      'Starting-state identity requires at least one season starting state.',
    )
  }

  const defaultPolicy = normalizeStartingStatePolicy(policy)
  const seasons = seasonStartingStates
    .map((season, index) => ({
      orderingSource: season.orderingSource ?? null,
      policy: normalizeStartingStatePolicy(season.policy ?? defaultPolicy),
      seasonId: normalizeIdentifier(
        season.seasonId,
        `seasonStartingStates[${index}].seasonId`,
      ),
      teams: normalizeTeamStartingStates(
        season.teams ?? season.ratings ?? season.startingRatings,
      ),
    }))
    .sort((left, right) =>
      compareIdentifiers(left.seasonId, right.seasonId),
    )
  const seasonIds = seasons.map((season) => season.seasonId)

  if (new Set(seasonIds).size !== seasonIds.length) {
    throw new TypeError('Starting-state identity requires unique season IDs.')
  }

  const signatureInput = { policy: defaultPolicy, seasons }

  return deepFreeze({
    policy: defaultPolicy,
    seasons,
    startingStateSignature: createDeterministicSignature(
      'nhl-edge/calibration-starting-state/v1',
      signatureInput,
    ),
  })
}

const explicitBooleanOrNull = (value) =>
  typeof value === 'boolean' ? value : null

const normalizeFeatureConfiguration = (feature = {}) => {
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
    throw new TypeError('Baseline feature configuration must be an object.')
  }

  return canonicalize({
    ...feature,
    enabled: explicitBooleanOrNull(feature.enabled),
  })
}

const createBaselineConfiguration = ({ features = {}, model = {} } = {}) =>
  canonicalize({
    features: {
      quickRematch: normalizeFeatureConfiguration(features.quickRematch),
      restFatigue: normalizeFeatureConfiguration(features.restFatigue),
      specialTeams: normalizeFeatureConfiguration(features.specialTeams),
      teamHomeAdvantage: normalizeFeatureConfiguration(
        features.teamHomeAdvantage,
      ),
    },
    model: {
      baseHomeAdvantage: model.baseHomeAdvantage ?? null,
      kFactor: model.kFactor ?? null,
      modelVersion: model.modelVersion ?? null,
      overtimeMultiplier: model.overtimeMultiplier ?? null,
      probabilityScale: model.probabilityScale ?? null,
      regulationMultiplier: model.regulationMultiplier ?? null,
      shootoutMultiplier: model.shootoutMultiplier ?? null,
    },
  })

const createBaselineSignature = (configuration) =>
  createDeterministicSignature(
    'nhl-edge/calibration-baseline/v1',
    configuration,
  )

const createBaselineConfigurationIdentity = ({
  configuration,
  identity = BASELINE_IDENTITIES.UNKNOWN,
} = {}) => {
  if (!Object.values(BASELINE_IDENTITIES).includes(identity)) {
    throw new TypeError(`Unsupported calibration baseline identity: ${identity}`)
  }

  const normalizedConfiguration = createBaselineConfiguration(configuration)

  return deepFreeze({
    baselineSignature: createBaselineSignature(normalizedConfiguration),
    configuration: normalizedConfiguration,
    identity,
  })
}

const createProductionConfigurationSignature = (configuration) =>
  createDeterministicSignature(
    'nhl-edge/calibration-production-configuration/v1',
    configuration,
  )

module.exports = {
  STARTING_STATE_POLICIES,
  canonicalize,
  createBaselineConfiguration,
  createBaselineConfigurationIdentity,
  createBaselineSignature,
  createDeterministicSignature,
  createGameIdSignature,
  createProductionConfigurationSignature,
  createStartingStateIdentity,
  deepFreeze,
  stableSerialize,
}
