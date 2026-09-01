const BASELINE_IDENTITIES = Object.freeze({
  CANONICAL_BASE_MODEL_V1: 'CANONICAL_BASE_MODEL_V1',
  CURRENT_PRODUCTION: 'CURRENT_PRODUCTION',
  PHASE_CONTROL: 'PHASE_CONTROL',
  UNKNOWN: 'UNKNOWN',
})

const CANDIDATE_TYPES = Object.freeze({
  BASELINE: 'BASELINE',
  BASE_MODEL: 'BASE_MODEL',
  COMBINED: 'COMBINED',
  QUICK_REMATCH: 'QUICK_REMATCH',
  REST_FATIGUE: 'REST_FATIGUE',
  SPECIAL_TEAMS: 'SPECIAL_TEAMS',
  TEAM_HOME_ADVANTAGE: 'TEAM_HOME_ADVANTAGE',
})

const DELTA_BRIER_DIRECTION = 'candidate_minus_baseline'

const cloneValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneValue)
  }

  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneValue(nestedValue),
      ]),
    )
  }

  return value
}

const numberOrNull = (value) =>
  Number.isFinite(value) ? value : null

const normalizeMetrics = (metrics = {}) => ({
  accuracy: numberOrNull(metrics.accuracy),
  averageSeasonBrier: numberOrNull(metrics.averageSeasonBrier),
  ece: numberOrNull(metrics.ece),
  logLoss: numberOrNull(metrics.logLoss),
  pooledBrier: numberOrNull(metrics.pooledBrier),
  worstSeasonBrier: numberOrNull(metrics.worstSeasonBrier),
})

const normalizeBaseline = (baseline = {}) => {
  const identity = baseline.identity ?? BASELINE_IDENTITIES.UNKNOWN

  if (!Object.values(BASELINE_IDENTITIES).includes(identity)) {
    throw new TypeError(`Unsupported calibration baseline identity: ${identity}`)
  }

  return {
    candidateId: baseline.candidateId ?? null,
    identity,
    label: baseline.label ?? null,
    metrics: baseline.metrics
      ? normalizeMetrics(baseline.metrics)
      : null,
  }
}

const normalizePerSeason = (perSeason = []) =>
  perSeason.map((season) => ({
    accuracy: numberOrNull(season.accuracy),
    brier: numberOrNull(season.brier),
    ece: numberOrNull(season.ece),
    games: numberOrNull(season.games),
    logLoss: numberOrNull(season.logLoss),
    seasonId: season.seasonId ?? null,
  }))

/**
 * Creates the phase-neutral candidate result shape. Missing source information is
 * represented by null. Adapters are responsible for supplying only values exposed
 * by their source phase.
 */
const createCalibrationCandidate = (candidate = {}) => {
  if (!candidate.candidateId) {
    throw new TypeError('A normalized calibration candidate requires candidateId.')
  }

  if (!Object.values(CANDIDATE_TYPES).includes(candidate.candidateType)) {
    throw new TypeError(
      `Unsupported calibration candidate type: ${candidate.candidateType}`,
    )
  }

  const metadata = candidate.metadata ?? {}

  return {
    baseline: normalizeBaseline(candidate.baseline),
    candidateId: candidate.candidateId,
    candidateType: candidate.candidateType,
    comparison: {
      deltaAccuracy: numberOrNull(candidate.comparison?.deltaAccuracy),
      deltaBrier: numberOrNull(candidate.comparison?.deltaBrier),
      deltaLogLoss: numberOrNull(candidate.comparison?.deltaLogLoss),
    },
    components: Array.isArray(candidate.components)
      ? cloneValue(candidate.components)
      : [],
    configuration: candidate.configuration
      ? cloneValue(candidate.configuration)
      : null,
    diagnostics: cloneValue(candidate.diagnostics ?? {}),
    evaluation: {
      excludedGames: numberOrNull(candidate.evaluation?.excludedGames),
      games: numberOrNull(candidate.evaluation?.games),
      includedGames: numberOrNull(candidate.evaluation?.includedGames),
      seasons: Array.isArray(candidate.evaluation?.seasons)
        ? [...candidate.evaluation.seasons]
        : null,
    },
    label: candidate.label ?? null,
    metadata: {
      baselineSignature: metadata.baselineSignature ?? null,
      configurationSignature: metadata.configurationSignature ?? null,
      datasetSignature: metadata.datasetSignature ?? null,
      modelVersion: metadata.modelVersion ?? null,
      productionSnapshotId: metadata.productionSnapshotId ?? null,
      productionWrites: false,
      startingStateSignature: metadata.startingStateSignature ?? null,
    },
    metrics: normalizeMetrics(candidate.metrics),
    overrides: cloneValue(candidate.overrides ?? {}),
    perSeason: normalizePerSeason(candidate.perSeason),
  }
}

const sameStringSet = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false
  }

  const normalizedLeft = [...new Set(left.map(String))].sort()
  const normalizedRight = [...new Set(right.map(String))].sort()

  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
}

const compareCalibrationCandidates = (left, right) => {
  const warnings = []
  let comparable = true
  const addWarning = (code, field, message, details = undefined) => {
    comparable = false
    warnings.push({
      code,
      field,
      message,
      ...(details ? { details } : {}),
    })
  }
  const compareRequiredSignature = (field) => {
    const leftValue = left?.metadata?.[field] ?? null
    const rightValue = right?.metadata?.[field] ?? null

    if (!leftValue || !rightValue) {
      addWarning(
        `MISSING_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
        `metadata.${field}`,
        `Both candidates require ${field} before their comparison can be verified as safe.`,
      )
      return
    }

    if (leftValue !== rightValue) {
      const isDatasetSignature = field === 'datasetSignature'

      addWarning(
        `${field.replace(/([A-Z])/g, '_$1').toUpperCase()}_MISMATCH`,
        `metadata.${field}`,
        isDatasetSignature
          ? 'Candidates use different exact game-set dataset signatures.'
          : `Candidates use different ${field} values.`,
        { left: leftValue, right: rightValue },
      )
    }
  }

  const leftSeasons = left?.evaluation?.seasons
  const rightSeasons = right?.evaluation?.seasons
  const hasExplicitSeasons = (seasons) =>
    Array.isArray(seasons) &&
    seasons.length > 0 &&
    seasons.every((seasonId) => seasonId !== null && seasonId !== undefined)

  if (!hasExplicitSeasons(leftSeasons) || !hasExplicitSeasons(rightSeasons)) {
    addWarning(
      'MISSING_SEASONS',
      'evaluation.seasons',
      'Both candidates require at least one explicit evaluated season.',
    )
  } else if (!sameStringSet(leftSeasons, rightSeasons)) {
    addWarning(
      'SEASONS_MISMATCH',
      'evaluation.seasons',
      'Candidates must cover the same explicit set of seasons.',
      { left: leftSeasons, right: rightSeasons },
    )
  }

  const leftGames = left?.evaluation?.games
  const rightGames = right?.evaluation?.games

  if (!Number.isFinite(leftGames) || !Number.isFinite(rightGames)) {
    addWarning(
      'MISSING_GAME_COUNT',
      'evaluation.games',
      'Both candidates require an evaluated game count.',
    )
  } else if (leftGames !== rightGames) {
    addWarning(
      'GAME_COUNT_MISMATCH',
      'evaluation.games',
      'Candidates evaluated different numbers of games.',
      { left: leftGames, right: rightGames },
    )
  }

  const optionalGameCountFields = ['includedGames', 'excludedGames']

  optionalGameCountFields.forEach((field) => {
    const leftValue = left?.evaluation?.[field]
    const rightValue = right?.evaluation?.[field]

    if (
      Number.isFinite(leftValue) &&
      Number.isFinite(rightValue) &&
      leftValue !== rightValue
    ) {
      addWarning(
        `${field.replace(/([A-Z])/g, '_$1').toUpperCase()}_MISMATCH`,
        `evaluation.${field}`,
        `Candidates expose different ${field} values.`,
        { left: leftValue, right: rightValue },
      )
    } else if (Number.isFinite(leftValue) !== Number.isFinite(rightValue)) {
      addWarning(
        `PARTIAL_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
        `evaluation.${field}`,
        `Only one candidate exposes ${field}; comparison safety cannot verify that count.`,
      )
    }
  })

  compareRequiredSignature('datasetSignature')
  compareRequiredSignature('startingStateSignature')
  compareRequiredSignature('baselineSignature')

  if (left?.baseline?.identity !== right?.baseline?.identity) {
    addWarning(
      'BASELINE_IDENTITY_MISMATCH',
      'baseline.identity',
      'Candidates use different baseline identity classes.',
      { left: left?.baseline?.identity, right: right?.baseline?.identity },
    )
  }

  const usesProductionBaseline = [left, right].some(
    (candidate) =>
      candidate?.baseline?.identity === BASELINE_IDENTITIES.CURRENT_PRODUCTION,
  )

  if (usesProductionBaseline) {
    const leftSnapshot = left?.metadata?.productionSnapshotId ?? null
    const rightSnapshot = right?.metadata?.productionSnapshotId ?? null

    if (!leftSnapshot || !rightSnapshot) {
      addWarning(
        'MISSING_PRODUCTION_SNAPSHOT_ID',
        'metadata.productionSnapshotId',
        'Current-production comparisons require production snapshot identities.',
      )
    } else if (leftSnapshot !== rightSnapshot) {
      addWarning(
        'PRODUCTION_SNAPSHOT_ID_MISMATCH',
        'metadata.productionSnapshotId',
        'Candidates reference different production snapshots.',
        { left: leftSnapshot, right: rightSnapshot },
      )
    }
  }

  return { comparable, warnings }
}

module.exports = {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
  DELTA_BRIER_DIRECTION,
  cloneValue,
  compareCalibrationCandidates,
  createCalibrationCandidate,
}
