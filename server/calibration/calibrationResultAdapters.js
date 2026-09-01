const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
  cloneValue,
  createCalibrationCandidate,
} = require('./calibrationResultContract')

// Every phase adapter accepts the current top-level service response and returns
// an array of normalized candidates. Base Model returns a one-item array; the
// grid-based phases return one item per existing candidate/control row.

const assertResultObject = (result, adapterName) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError(`${adapterName} requires an existing result object.`)
  }
}

const finiteOrNull = (value) =>
  Number.isFinite(value) ? value : null

const readAccuracy = (accuracy) => {
  if (Number.isFinite(accuracy)) {
    return accuracy
  }

  return finiteOrNull(accuracy?.rate)
}

const readMetrics = (source = {}) => {
  const metrics = source.metrics ?? source

  return {
    accuracy: readAccuracy(metrics.accuracy),
    averageSeasonBrier: finiteOrNull(
      source.averageSeasonBrier ?? source.aggregate?.averageSeasonBrier,
    ),
    ece: finiteOrNull(
      metrics.ece ?? metrics.expectedCalibrationError,
    ),
    logLoss: finiteOrNull(metrics.logLoss),
    pooledBrier: finiteOrNull(
      metrics.pooledBrier ?? metrics.brierScore,
    ),
    worstSeasonBrier: finiteOrNull(
      source.worstSeasonBrier ??
        source.worstSeason?.brierScore ??
        source.aggregate?.worstSeason?.brierScore,
    ),
  }
}

const readPerSeason = (seasonResults = []) =>
  (Array.isArray(seasonResults) ? seasonResults : []).map((season) => ({
    accuracy: readAccuracy(season.metrics?.accuracy),
    brier: finiteOrNull(
      season.metrics?.pooledBrier ?? season.metrics?.brierScore,
    ),
    ece: finiteOrNull(
      season.metrics?.ece ?? season.metrics?.expectedCalibrationError,
    ),
    games: finiteOrNull(
      season.games ?? season.dataset?.gamesIncluded,
    ),
    logLoss: finiteOrNull(season.metrics?.logLoss),
    seasonId: season.seasonId ?? null,
  }))

const sumKnownGames = (perSeason) => {
  if (perSeason.length === 0 || perSeason.some((season) => season.games === null)) {
    return null
  }

  return perSeason.reduce((sum, season) => sum + season.games, 0)
}

const roundDifference = (candidateValue, baselineValue) =>
  Number.isFinite(candidateValue) && Number.isFinite(baselineValue)
    ? Number((candidateValue - baselineValue).toFixed(12))
    : null

const buildComparison = (candidateMetrics, baselineMetrics) => ({
  deltaAccuracy: roundDifference(
    candidateMetrics.accuracy,
    baselineMetrics?.accuracy,
  ),
  // Direction is always candidate minus baseline. Negative Brier is better.
  deltaBrier: roundDifference(
    candidateMetrics.pooledBrier,
    baselineMetrics?.pooledBrier,
  ),
  deltaLogLoss: roundDifference(
    candidateMetrics.logLoss,
    baselineMetrics?.logLoss,
  ),
})

const readMetadataValue = (result, options, field) => {
  if (Object.hasOwn(options.metadata ?? {}, field)) {
    return options.metadata[field]
  }

  const explicitIdentityValues = {
    baselineSignature:
      options.baselineConfigurationIdentity?.baselineSignature ??
      options.productionSnapshot?.baselineSignature,
    datasetSignature: options.datasetContext?.datasetSignature,
    productionSnapshotId: options.productionSnapshot?.productionSnapshotId,
    startingStateSignature:
      options.startingStateIdentity?.startingStateSignature,
  }

  if (explicitIdentityValues[field] !== undefined) {
    return explicitIdentityValues[field]
  }

  if (Object.hasOwn(result.metadata ?? {}, field)) {
    return result.metadata[field]
  }

  return Object.hasOwn(result, field) ? result[field] : null
}

const buildMetadata = (result, options = {}) => ({
  baselineSignature: readMetadataValue(
    result,
    options,
    'baselineSignature',
  ),
  datasetSignature: readMetadataValue(result, options, 'datasetSignature'),
  modelVersion:
    options.metadata?.modelVersion ??
    options.modelVersion ??
    options.productionSnapshot?.configuration?.model?.modelVersion ??
    result.metadata?.modelVersion ??
    result.modelVersion ??
    null,
  productionSnapshotId: readMetadataValue(
    result,
    options,
    'productionSnapshotId',
  ),
  productionWrites: false,
  startingStateSignature: readMetadataValue(
    result,
    options,
    'startingStateSignature',
  ),
})

const buildBaseline = ({
  candidateId = null,
  identity,
  label = null,
  source = null,
}) => ({
  candidateId,
  identity,
  label,
  metrics: source ? readMetrics(source) : null,
})

const resolveBaselineIdentity = (options, fallback) =>
  options.baselineIdentity ??
  options.baselineConfigurationIdentity?.identity ??
  options.productionSnapshot?.baselineIdentity ??
  fallback

const buildEvaluation = ({
  excludedGames = null,
  games = null,
  includedGames = null,
  perSeason,
}) => ({
  excludedGames: finiteOrNull(excludedGames),
  games: finiteOrNull(games ?? sumKnownGames(perSeason)),
  includedGames: finiteOrNull(includedGames),
  seasons: perSeason.map((season) => season.seasonId),
})

const valueId = (value) =>
  value === null || value === undefined ? 'unknown' : String(value)

const homeAdvantageCandidateId = (comparison) =>
  `team-home-advantage:adjustment:${valueId(comparison.adjustment)}`

const scheduleRuleCandidateId = (ruleId, comparison) =>
  `rest-fatigue:${valueId(ruleId)}:adjustment:${valueId(comparison.adjustment)}`

const quickRematchCandidateId = (comparison) =>
  comparison.disabled
    ? 'quick-rematch:disabled'
    : `quick-rematch:days:${valueId(comparison.windowDays)}:adjustment:${valueId(
        comparison.adjustment,
      )}`

const specialTeamsCandidateId = (comparison) =>
  `special-teams:top-bottom:${valueId(
    comparison.threshold,
  )}:adjustment:${valueId(comparison.adjustment)}`

/**
 * Base Model produces one candidate. Its constant-probability sanity checks are
 * diagnostics, not a production or phase-control calibration baseline.
 */
const adaptBaseModelCalibrationResult = (result, options = {}) => {
  assertResultObject(result, 'adaptBaseModelCalibrationResult')

  const perSeason = readPerSeason(result.seasonResults)
  const metrics = readMetrics({
    ...result,
    averageSeasonBrier: result.aggregate?.averageSeasonBrier,
    worstSeason: result.aggregate?.worstSeason,
  })
  const suppliedBaseline = options.baseline ?? null
  const baseline = suppliedBaseline
    ? buildBaseline({
        candidateId: suppliedBaseline.candidateId,
        identity:
          suppliedBaseline.identity ?? BASELINE_IDENTITIES.UNKNOWN,
        label: suppliedBaseline.label,
        source: suppliedBaseline,
      })
    : buildBaseline({
        identity: resolveBaselineIdentity(
          options,
          BASELINE_IDENTITIES.UNKNOWN,
        ),
      })
  const label = options.label ?? result.displayLabel ?? result.label ?? null

  return [
    createCalibrationCandidate({
      baseline,
      candidateId:
        options.candidateId ??
        `base-model:${valueId(result.modelVersion)}:${valueId(label)}`,
      candidateType: CANDIDATE_TYPES.BASE_MODEL,
      comparison: buildComparison(metrics, baseline.metrics),
      diagnostics: {
        ...cloneValue(result.diagnostics ?? {}),
        baselineComparison: cloneValue(result.baselineComparison ?? null),
        sanityBaselines: cloneValue(result.sanityBaselines ?? null),
        stability: cloneValue(result.stability ?? null),
      },
      evaluation: buildEvaluation({
        excludedGames: result.dataset?.gamesSkipped,
        games: result.dataset?.gamesIncluded,
        includedGames: result.dataset?.gamesIncluded,
        perSeason,
      }),
      label,
      metadata: buildMetadata(result, options),
      metrics,
      overrides: result.parameters ?? {},
      perSeason,
    }),
  ]
}

const adaptHomeAdvantageCalibrationResult = (result, options = {}) => {
  assertResultObject(result, 'adaptHomeAdvantageCalibrationResult')

  const comparisons = Array.isArray(result.comparisons)
    ? result.comparisons
    : []
  const control = comparisons.find((comparison) => comparison.adjustment === 0)
  const baselineIdentity = control
    ? resolveBaselineIdentity(
        options,
        BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
      )
    : BASELINE_IDENTITIES.UNKNOWN
  const baseline = buildBaseline({
    candidateId: control ? homeAdvantageCandidateId(control) : null,
    identity: baselineIdentity,
    label: control ? 'Base Model v1 team-home-advantage control' : null,
    source: control,
  })

  return comparisons.map((comparison) => {
    const perSeason = readPerSeason(comparison.seasonResults)
    const metrics = readMetrics(comparison)

    return createCalibrationCandidate({
      baseline,
      candidateId: homeAdvantageCandidateId(comparison),
      candidateType: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
      comparison: buildComparison(metrics, baseline.metrics),
      diagnostics: {
        ...cloneValue(result.diagnostics ?? {}),
        adjustment: finiteOrNull(comparison.adjustment),
        currentAnalysis: cloneValue(result.currentAnalysis ?? null),
        effectiveHomeAdvantage: cloneValue(
          comparison.effectiveHomeAdvantage ?? null,
        ),
        seasonsBeatingBaseline:
          finiteOrNull(comparison.seasonsBeatingBaseline),
        snapshots: cloneValue(result.snapshots ?? []),
        stability: cloneValue(comparison.stability ?? null),
      },
      evaluation: buildEvaluation({
        games: sumKnownGames(perSeason),
        includedGames: sumKnownGames(perSeason),
        perSeason,
      }),
      label: `Team home advantage adjustment ${valueId(comparison.adjustment)}`,
      metadata: buildMetadata(result, options),
      metrics,
      overrides: {
        adjustment: finiteOrNull(comparison.adjustment),
        effectiveHomeAdvantage: comparison.effectiveHomeAdvantage ?? null,
      },
      perSeason,
    })
  })
}

const adaptScheduleRuleComparisons = (result, options) =>
  Object.entries(result.individualResults ?? {}).flatMap(
    ([resultKey, ruleResult]) => {
      const comparisons = Array.isArray(ruleResult?.comparisons)
        ? ruleResult.comparisons
        : []
      const ruleId = ruleResult?.ruleId ?? resultKey
      const control = comparisons.find(
        (comparison) => comparison.adjustment === 0,
      )
      const baseline = buildBaseline({
        candidateId: control
          ? scheduleRuleCandidateId(ruleId, control)
          : null,
        identity: control
          ? resolveBaselineIdentity(
              options,
              BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
            )
          : BASELINE_IDENTITIES.UNKNOWN,
        label: control ? `Base Model v1 ${ruleId} control` : null,
        source: control,
      })

      return comparisons.map((comparison) => {
        const perSeason = readPerSeason(comparison.seasonResults)
        const metrics = readMetrics(comparison)

        return createCalibrationCandidate({
          baseline,
          candidateId: scheduleRuleCandidateId(ruleId, comparison),
          candidateType: CANDIDATE_TYPES.REST_FATIGUE,
          comparison: buildComparison(metrics, baseline.metrics),
          diagnostics: {
            ...cloneValue(result.diagnostics ?? {}),
            appliedRestFatigueCounts: cloneValue(
              comparison.appliedRestFatigueCounts ?? {},
            ),
            definition: ruleResult?.definition ?? null,
            gamesAffected: finiteOrNull(comparison.gamesAffected),
            gamesAffectedPercentage: finiteOrNull(
              comparison.gamesAffectedPercentage,
            ),
            label: ruleResult?.label ?? null,
            matchedRestFatigueCounts: cloneValue(
              comparison.matchedRestFatigueCounts ?? {},
            ),
            occurrences: finiteOrNull(comparison.occurrences),
            priorityCounts: cloneValue(
              comparison.seasonResults?.map((season) =>
                season.priorityCounts ?? {},
              ) ?? [],
            ),
            ruleId,
            stability: cloneValue(comparison.stability ?? null),
          },
          evaluation: buildEvaluation({
            games: sumKnownGames(perSeason),
            includedGames: sumKnownGames(perSeason),
            perSeason,
          }),
          label: `${ruleResult?.label ?? ruleId} adjustment ${valueId(
            comparison.adjustment,
          )}`,
          metadata: buildMetadata(result, options),
          metrics,
          overrides: {
            adjustment: finiteOrNull(comparison.adjustment),
            configuration: comparison.configuration ?? null,
            ruleId,
          },
          perSeason,
        })
      })
    },
  )

const adaptCombinedRestFatigueSelection = (result, options) => {
  const combined = result.combinedRestFatigueResult
  const selected = combined?.selected
  const control = combined?.noAdjustments

  if (!selected || !control) {
    return []
  }

  const perSeason = readPerSeason(selected.seasonResults)
  const metrics = readMetrics(selected)
  const baseline = buildBaseline({
    candidateId: 'rest-fatigue:combined-control',
    identity: resolveBaselineIdentity(
      options,
      BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
    ),
    label: 'Base Model v1 combined rest/fatigue control',
    source: control,
  })

  return [
    createCalibrationCandidate({
      baseline,
      candidateId: 'rest-fatigue:combined-selection',
      candidateType: CANDIDATE_TYPES.REST_FATIGUE,
      comparison: buildComparison(metrics, baseline.metrics),
      diagnostics: {
        ...cloneValue(result.diagnostics ?? {}),
        appliedCounts: cloneValue(combined.appliedCounts ?? {}),
        gamesAffected: finiteOrNull(selected.gamesAffected),
        matchedCounts: cloneValue(combined.matchedCounts ?? {}),
        priorityCounts: cloneValue(combined.priorityCounts ?? {}),
        stability: cloneValue(selected.stability ?? null),
        variant: 'combined_rest_fatigue_selection',
      },
      evaluation: buildEvaluation({
        games: sumKnownGames(perSeason),
        includedGames: sumKnownGames(perSeason),
        perSeason,
      }),
      label: 'Combined rest/fatigue selection',
      metadata: buildMetadata(result, options),
      metrics,
      overrides: {
        configuration: selected.configuration ?? null,
        configurationSnapshot: combined.configurationSnapshot ?? null,
      },
      perSeason,
    }),
  ]
}

const adaptQuickRematchComparisons = (result, options) => {
  const quickRematchResult = result.quickRematchResult
  const comparisons = Array.isArray(quickRematchResult?.comparisons)
    ? quickRematchResult.comparisons
    : []
  const control = comparisons.find(
    (comparison) => comparison.disabled && comparison.adjustment === 0,
  ) ?? comparisons.find((comparison) => comparison.adjustment === 0)
  const baseline = buildBaseline({
    candidateId: control ? quickRematchCandidateId(control) : null,
    identity: control
      ? resolveBaselineIdentity(
          options,
          BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
        )
      : BASELINE_IDENTITIES.UNKNOWN,
    label: control ? 'Base Model v1 quick-rematch control' : null,
    source: control,
  })

  return comparisons.map((comparison) => {
    const perSeason = readPerSeason(comparison.seasonResults)
    const metrics = readMetrics(comparison)

    return createCalibrationCandidate({
      baseline,
      candidateId: quickRematchCandidateId(comparison),
      candidateType: CANDIDATE_TYPES.QUICK_REMATCH,
      comparison: buildComparison(metrics, baseline.metrics),
      diagnostics: {
        ...cloneValue(result.diagnostics ?? {}),
        definition: quickRematchResult?.definition ?? null,
        gamesAffected: finiteOrNull(comparison.gamesAffected),
        gamesAffectedPercentage: finiteOrNull(
          comparison.gamesAffectedPercentage,
        ),
        occurrenceRate: finiteOrNull(comparison.occurrenceRate),
        occurrences: finiteOrNull(comparison.occurrences),
        stability: cloneValue(comparison.stability ?? null),
      },
      evaluation: buildEvaluation({
        games: sumKnownGames(perSeason),
        includedGames: sumKnownGames(perSeason),
        perSeason,
      }),
      label: comparison.disabled
        ? 'Quick rematch disabled'
        : `Quick rematch ${valueId(comparison.windowDays)} days, adjustment ${valueId(
            comparison.adjustment,
          )}`,
      metadata: buildMetadata(result, options),
      metrics,
      overrides: {
        adjustment: finiteOrNull(comparison.adjustment),
        configuration: comparison.configuration ?? null,
        disabled: comparison.disabled === true,
        windowDays: finiteOrNull(comparison.windowDays),
      },
      perSeason,
    })
  })
}

const adaptScheduleCalibrationResult = (result, options = {}) => {
  assertResultObject(result, 'adaptScheduleCalibrationResult')

  // The rest/fatigue-only combined selection remains a REST_FATIGUE candidate.
  // The mixed rest/fatigue + quick-rematch result is intentionally not adapted;
  // COMBINED is reserved by the contract but is outside Step 1.
  return [
    ...adaptScheduleRuleComparisons(result, options),
    ...adaptCombinedRestFatigueSelection(result, options),
    ...adaptQuickRematchComparisons(result, options),
  ]
}

const adaptSpecialTeamsCalibrationResult = (result, options = {}) => {
  assertResultObject(result, 'adaptSpecialTeamsCalibrationResult')

  const comparisons = Array.isArray(result.comparisons)
    ? result.comparisons
    : []
  const controlThreshold = result.thresholds?.[0]
  const control = comparisons.find(
    (comparison) =>
      comparison.adjustment === 0 &&
      (controlThreshold === undefined ||
        comparison.threshold === controlThreshold),
  )
  const baseline = buildBaseline({
    candidateId: control ? specialTeamsCandidateId(control) : null,
    identity: control
      ? resolveBaselineIdentity(
          options,
          BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
        )
      : BASELINE_IDENTITIES.UNKNOWN,
    label: control ? 'Base Model v1 special-teams control' : null,
    source: control,
  })

  return comparisons.map((comparison) => {
    const perSeason = readPerSeason(comparison.seasonResults)
    const metrics = readMetrics(comparison)
    const thresholdDiagnostic = result.thresholdSummary?.find(
      (summary) => summary.threshold === comparison.threshold,
    )

    return createCalibrationCandidate({
      baseline,
      candidateId: specialTeamsCandidateId(comparison),
      candidateType: CANDIDATE_TYPES.SPECIAL_TEAMS,
      comparison: buildComparison(metrics, baseline.metrics),
      diagnostics: {
        ...cloneValue(result.diagnostics ?? {}),
        gamesAffectedPercentage: finiteOrNull(
          comparison.gamesAffectedPercentage,
        ),
        occurrences: cloneValue(comparison.occurrences ?? null),
        rankingAudit: cloneValue(result.rankingAudit ?? []),
        seasonsBeatingBaseline: finiteOrNull(
          comparison.seasonsBeatingBaseline,
        ),
        signalDiagnostics: cloneValue(
          thresholdDiagnostic?.signalDiagnostics ?? null,
        ),
        stability: cloneValue(comparison.stability ?? null),
        thresholdSummary: cloneValue(thresholdDiagnostic ?? null),
      },
      evaluation: buildEvaluation({
        games: comparison.games,
        includedGames: comparison.games,
        perSeason,
      }),
      label: `Special teams top/bottom ${valueId(
        comparison.threshold,
      )}, adjustment ${valueId(comparison.adjustment)}`,
      metadata: buildMetadata(result, options),
      metrics,
      overrides: {
        adjustment: finiteOrNull(comparison.adjustment),
        topBottomN: finiteOrNull(comparison.threshold),
      },
      perSeason,
    })
  })
}

module.exports = {
  adaptBaseModelCalibrationResult,
  adaptHomeAdvantageCalibrationResult,
  adaptScheduleCalibrationResult,
  adaptSpecialTeamsCalibrationResult,
}
