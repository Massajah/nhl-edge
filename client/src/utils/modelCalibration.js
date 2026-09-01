import { CALIBRATION_NUMBER_FIELDS } from './baseModelCalibration.js'

export const MODEL_CALIBRATION_BASELINES = Object.freeze({
  CANONICAL: 'CANONICAL_BASE_MODEL_V1',
  PRODUCTION: 'CURRENT_PRODUCTION',
})

export const MODEL_CALIBRATION_CANDIDATE_TYPES = Object.freeze({
  BASE_MODEL: 'BASE_MODEL',
  COMBINED: 'COMBINED',
  QUICK_REMATCH: 'QUICK_REMATCH',
  REST_FATIGUE: 'REST_FATIGUE',
  SPECIAL_TEAMS: 'SPECIAL_TEAMS',
  TEAM_HOME_ADVANTAGE: 'TEAM_HOME_ADVANTAGE',
})

export const MODEL_CALIBRATION_COMBINABLE_TYPES = Object.freeze([
  MODEL_CALIBRATION_CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  MODEL_CALIBRATION_CANDIDATE_TYPES.REST_FATIGUE,
  MODEL_CALIBRATION_CANDIDATE_TYPES.QUICK_REMATCH,
  MODEL_CALIBRATION_CANDIDATE_TYPES.SPECIAL_TEAMS,
])

export const MODEL_CALIBRATION_SHORTLIST_LIMIT = 5
export const MODEL_CALIBRATION_HIGHLIGHT_TOLERANCE = 1e-12
export const MODEL_CALIBRATION_ROBUSTNESS_REPLICATES = Object.freeze([
  1000,
  2500,
  5000,
])
export const MODEL_CALIBRATION_ROBUSTNESS_INTERVALS = Object.freeze([
  0.9,
  0.95,
  0.99,
])

export const MODEL_CALIBRATION_FAMILIES = Object.freeze([
  {
    key: 'baseModel',
    label: 'Base Model Parameters',
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.BASE_MODEL,
  },
  {
    key: 'teamHomeAdvantage',
    label: 'Team Home Advantage',
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  },
  {
    key: 'restFatigue',
    label: 'Rest & Fatigue',
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.REST_FATIGUE,
  },
  {
    key: 'quickRematch',
    label: 'Quick Rematch',
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.QUICK_REMATCH,
  },
  {
    key: 'specialTeams',
    label: 'Special Teams',
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.SPECIAL_TEAMS,
  },
])

const BASE_MODEL_OVERRIDE_KEYS = Object.freeze({
  homeAdvantage: 'baseHomeAdvantage',
  kFactor: 'kFactor',
  overtimeMultiplier: 'overtimeMultiplier',
  probabilityScale: 'probabilityScale',
  regulationMultiplier: 'regulationMultiplier',
  shootoutMultiplier: 'shootoutMultiplier',
})

const REST_OVERRIDE_KEYS = Object.freeze({
  '3_games_in_4_days': 'threeInFour',
  back_to_back: 'backToBack',
  back_to_back_travel: 'backToBackTravel',
  well_rested: 'wellRested',
})

const getBaselineOption = (options, baselineMode) =>
  options?.baselineModes?.find((baseline) => baseline.id === baselineMode) ??
  options?.baselineModes?.[0] ??
  null

const getModelValue = (configuration, field) => {
  const modelField = BASE_MODEL_OVERRIDE_KEYS[field]

  return configuration?.model?.[modelField] ?? ''
}

const getRuleDefault = (configuration, rule) =>
  configuration?.features?.restFatigue?.adjustments?.[rule.id] ??
  rule.productionValue ??
  0

const getFirstFinite = (values, fallback = 0) =>
  (values ?? []).find(Number.isFinite) ?? fallback

const getDefinedCandidateValue = (value, values, fallback = 0) => {
  const candidates = (values ?? []).map(Number).filter(Number.isFinite)
  const numericValue = Number(value)

  return candidates.includes(numericValue)
    ? numericValue
    : getFirstFinite(candidates, fallback)
}

export const createModelCalibrationForm = (options = {}) => {
  const baselineMode =
    options.defaultBaselineMode ?? MODEL_CALIBRATION_BASELINES.PRODUCTION
  const baseline = getBaselineOption(options, baselineMode)
  const configuration = baseline?.configuration ?? {}
  const definitions = options.candidateDefinitions ?? {}
  const specialTeamsAdjustments =
    definitions.specialTeams?.adjustmentOptions?.filter(
      (value) => Number(value) > 0,
    ) ?? []
  const baselineSpecialTeamsAdjustment =
    configuration.features?.specialTeams?.adjustmentMagnitude

  return {
    baselineMode,
    baseModel: Object.fromEntries(
      CALIBRATION_NUMBER_FIELDS.map((field) => [
        field.key,
        {
          enabled: false,
          value: getModelValue(configuration, field.key),
        },
      ]),
    ),
    evaluationSeasons: [...(options.defaultSeasonIds ?? [])],
    combinedCandidates: [],
    combinedDraftCandidateIds: [],
    quickRematch: {
      enabled: false,
      loserAdjustment: getDefinedCandidateValue(
        configuration.features?.quickRematch?.loserAdjustment,
        definitions.quickRematch?.adjustmentOptions,
      ),
      maximumDays: getDefinedCandidateValue(
        configuration.features?.quickRematch?.maximumDays,
        definitions.quickRematch?.windowOptions,
        7,
      ),
    },
    restFatigue: {
      adjustments: Object.fromEntries(
        (definitions.restFatigue?.rules ?? []).map((rule) => [
          rule.id,
          getRuleDefault(configuration, rule),
        ]),
      ),
      enabled: false,
    },
    specialTeams: {
      adjustment:
        Number(baselineSpecialTeamsAdjustment) > 0
          ? getDefinedCandidateValue(
              baselineSpecialTeamsAdjustment,
              specialTeamsAdjustments,
              0.5,
            )
          : getFirstFinite(specialTeamsAdjustments, 0.5),
      enabled: false,
      topBottomN: getDefinedCandidateValue(
        configuration.features?.specialTeams?.topBottomN,
        definitions.specialTeams?.thresholdOptions,
        6,
      ),
    },
    startingStatePolicy:
      options.startingState?.policy ?? 'FIXED_SPREAD_ALPHABETICAL',
    teamHomeAdvantage: {
      selectedAdjustments: [],
    },
  }
}

const toCandidateToken = (value) =>
  String(value).replace(/^-/, 'neg-').replace(/\./g, '-')

const makeBaseModelExperiments = (form) =>
  CALIBRATION_NUMBER_FIELDS.flatMap((field) => {
    const candidate = form.baseModel?.[field.key]

    if (!candidate?.enabled || !Number.isFinite(Number(candidate.value))) {
      return []
    }

    const value = Number(candidate.value)
    const overrideKey = BASE_MODEL_OVERRIDE_KEYS[field.key]

    return [{
      candidateId: `base-${overrideKey}-${toCandidateToken(value)}`,
      label: `${field.label} ${value}`,
      overrides: { [overrideKey]: value },
      type: MODEL_CALIBRATION_CANDIDATE_TYPES.BASE_MODEL,
    }]
  })

const makeTeamHomeAdvantageExperiments = (form) =>
  [...new Set(form.teamHomeAdvantage?.selectedAdjustments ?? [])]
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .map((adjustment) => ({
      candidateId: `team-ha-${toCandidateToken(adjustment)}`,
      label: `Team Home Advantage ±${adjustment.toFixed(2)}`,
      overrides: { adjustment },
      type: MODEL_CALIBRATION_CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
    }))

const makeRestFatigueExperiments = (form) => {
  if (!form.restFatigue?.enabled) return []

  const overrides = Object.fromEntries(
    Object.entries(form.restFatigue.adjustments ?? {})
      .filter(([ruleId, value]) =>
        REST_OVERRIDE_KEYS[ruleId] && Number.isFinite(Number(value)),
      )
      .map(([ruleId, value]) => [REST_OVERRIDE_KEYS[ruleId], Number(value)]),
  )

  return [{
    candidateId: 'rest-fatigue-coherent',
    label: 'Rest & Fatigue configuration',
    overrides,
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.REST_FATIGUE,
  }]
}

const makeQuickRematchExperiments = (form) => {
  if (!form.quickRematch?.enabled) return []

  return [{
    candidateId: `quick-rematch-${toCandidateToken(
      form.quickRematch.maximumDays,
    )}-${toCandidateToken(form.quickRematch.loserAdjustment)}`,
    label: `Quick Rematch · ${form.quickRematch.maximumDays} days · +${Number(
      form.quickRematch.loserAdjustment,
    ).toFixed(2)}`,
    overrides: {
      enabled: true,
      loserAdjustment: Number(form.quickRematch.loserAdjustment),
      maximumDays: Number(form.quickRematch.maximumDays),
    },
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.QUICK_REMATCH,
  }]
}

const makeSpecialTeamsExperiments = (form) => {
  if (!form.specialTeams?.enabled) return []

  return [{
    candidateId: `special-teams-${toCandidateToken(
      form.specialTeams.topBottomN,
    )}-${toCandidateToken(form.specialTeams.adjustment)}`,
    label: `Special Teams · Top/Bottom ${form.specialTeams.topBottomN} · ±${Number(
      form.specialTeams.adjustment,
    ).toFixed(2)}`,
    overrides: {
      adjustment: Number(form.specialTeams.adjustment),
      topBottomN: Number(form.specialTeams.topBottomN),
    },
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.SPECIAL_TEAMS,
  }]
}

export const createIsolatedModelCalibrationExperiments = (form) => [
  ...makeBaseModelExperiments(form),
  ...makeTeamHomeAdvantageExperiments(form),
  ...makeRestFatigueExperiments(form),
  ...makeQuickRematchExperiments(form),
  ...makeSpecialTeamsExperiments(form),
]

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

export const getCombinableModelCalibrationExperiments = (form) =>
  createIsolatedModelCalibrationExperiments(form).filter((experiment) =>
    MODEL_CALIBRATION_COMBINABLE_TYPES.includes(experiment.type))

const normalizeCombinedSelection = (componentCandidateIds, isolatedById) =>
  [...new Set(componentCandidateIds ?? [])]
    .map((candidateId) => isolatedById.get(candidateId))
    .filter(Boolean)
    .sort((left, right) =>
      compareIdentifiers(left.type, right.type) ||
      compareIdentifiers(left.candidateId, right.candidateId))

export const createCombinedModelCalibrationExperiment = (
  componentCandidateIds,
  isolatedExperiments,
) => {
  const isolatedById = new Map(
    isolatedExperiments.map((experiment) => [experiment.candidateId, experiment]),
  )
  const components = normalizeCombinedSelection(
    componentCandidateIds,
    isolatedById,
  )
  const componentTypes = components.map((component) => component.type)

  if (components.length < 2 ||
    new Set(componentTypes).size !== componentTypes.length) {
    return null
  }

  return {
    candidateId: `combined-${components
      .map((component) => component.candidateId)
      .join('__')}`,
    components: components.map((component) => ({
      candidateId: component.candidateId,
      label: component.label,
      overrides: component.overrides,
      type: component.type,
    })),
    label: `Combined · ${components
      .map((component) => component.label)
      .join(' + ')}`,
    type: MODEL_CALIBRATION_CANDIDATE_TYPES.COMBINED,
  }
}

export const addModelCalibrationCombinedSelection = (form) => {
  const isolated = createIsolatedModelCalibrationExperiments(form)
  const candidate = createCombinedModelCalibrationExperiment(
    form.combinedDraftCandidateIds,
    isolated,
  )
  const existing = makeCombinedExperiments(form, isolated)

  if (!candidate || existing.some((item) =>
    item.candidateId === candidate.candidateId)) {
    return form
  }

  return {
    ...form,
    combinedCandidates: [
      ...(form.combinedCandidates ?? []),
      { componentCandidateIds: [...form.combinedDraftCandidateIds] },
    ],
    combinedDraftCandidateIds: [],
  }
}

export const removeModelCalibrationCombinedSelection = (form, candidateId) => {
  const isolated = createIsolatedModelCalibrationExperiments(form)

  return {
    ...form,
    combinedCandidates: (form.combinedCandidates ?? []).filter((selection) =>
      createCombinedModelCalibrationExperiment(
        selection.componentCandidateIds,
        isolated,
      )?.candidateId !== candidateId),
  }
}

const makeCombinedExperiments = (form, isolatedExperiments) =>
  (form.combinedCandidates ?? [])
    .map((selection) => createCombinedModelCalibrationExperiment(
      selection.componentCandidateIds,
      isolatedExperiments,
    ))
    .filter(Boolean)

export const createModelCalibrationExperiments = (form) => {
  const isolated = createIsolatedModelCalibrationExperiments(form)

  return [...isolated, ...makeCombinedExperiments(form, isolated)]
}

export const createModelCalibrationRequest = (form) => ({
  baselineMode: form.baselineMode,
  evaluationSeasons: [...form.evaluationSeasons],
  experiments: createModelCalibrationExperiments(form),
  startingStatePolicy: form.startingStatePolicy,
})

const READINESS_KEY_BY_TYPE = Object.freeze({
  [MODEL_CALIBRATION_CANDIDATE_TYPES.BASE_MODEL]: 'baseModel',
  [MODEL_CALIBRATION_CANDIDATE_TYPES.QUICK_REMATCH]: 'quickRematch',
  [MODEL_CALIBRATION_CANDIDATE_TYPES.REST_FATIGUE]: 'restFatigue',
  [MODEL_CALIBRATION_CANDIDATE_TYPES.SPECIAL_TEAMS]: 'specialTeams',
  [MODEL_CALIBRATION_CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]:
    'teamHomeAdvantage',
})

export const getUnavailableModelCalibrationSelections = (
  options,
  form,
  experiments = createModelCalibrationExperiments(form),
) => {
  const requiredReadinessKeys = [
    ...new Set(experiments.flatMap((experiment) =>
      experiment.type === MODEL_CALIBRATION_CANDIDATE_TYPES.COMBINED
        ? experiment.components.map((component) =>
            READINESS_KEY_BY_TYPE[component.type])
        : [READINESS_KEY_BY_TYPE[experiment.type]])),
  ]

  return form.evaluationSeasons.flatMap((seasonId) => {
    const season = options?.seasons?.find((item) => item.id === seasonId)
    const unavailableFamilies = requiredReadinessKeys.filter(
      (key) => season?.readiness?.[key] !== true,
    )

    return season?.historicalDataset?.status !== 'ready' ||
      unavailableFamilies.length > 0
      ? [{
          families: unavailableFamilies,
          label: season?.label ?? seasonId,
          seasonId,
        }]
      : []
  })
}

export const validateModelCalibrationForm = (options, form) => {
  if (!options?.baselineModes?.some((baseline) =>
    baseline.id === form.baselineMode)) {
    return 'Choose an explicit baseline.'
  }
  if (!Array.isArray(form.evaluationSeasons) || form.evaluationSeasons.length === 0) {
    return 'Choose at least one evaluation season.'
  }

  if (form.startingStatePolicy !== options.startingState?.policy) {
    return 'Choose a supported starting-state policy.'
  }

  for (const field of CALIBRATION_NUMBER_FIELDS) {
    const candidate = form.baseModel?.[field.key]

    if (candidate?.enabled) {
      const value = Number(candidate.value)

      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        return `${field.label} must be between ${field.min} and ${field.max}.`
      }
    }
  }

  const includesCandidateValue = (value, values) =>
    (values ?? []).map(Number).includes(Number(value))
  const definitions = options.candidateDefinitions ?? {}

  if ((form.teamHomeAdvantage?.selectedAdjustments ?? []).some(
    (value) => !includesCandidateValue(
      value,
      definitions.teamHomeAdvantage?.adjustmentOptions,
    ),
  )) {
    return 'Choose a supported Team Home Advantage adjustment.'
  }

  if (form.restFatigue?.enabled &&
    (definitions.restFatigue?.rules ?? []).some((rule) =>
      !includesCandidateValue(
        form.restFatigue.adjustments?.[rule.id],
        rule.presetValues,
      ))) {
    return 'Choose a supported value for every Rest & Fatigue rule.'
  }

  if (form.quickRematch?.enabled &&
    (!includesCandidateValue(
      form.quickRematch.maximumDays,
      definitions.quickRematch?.windowOptions,
    ) || !includesCandidateValue(
      form.quickRematch.loserAdjustment,
      definitions.quickRematch?.adjustmentOptions,
    ))) {
    return 'Choose a supported Quick Rematch configuration.'
  }

  if (form.specialTeams?.enabled &&
    (!includesCandidateValue(
      form.specialTeams.topBottomN,
      definitions.specialTeams?.thresholdOptions,
    ) || !includesCandidateValue(
      form.specialTeams.adjustment,
      definitions.specialTeams?.adjustmentOptions,
    ))) {
    return 'Choose a supported Special Teams configuration.'
  }

  const experiments = createModelCalibrationExperiments(form)
  const isolatedExperiments = createIsolatedModelCalibrationExperiments(form)
  const isolatedIds = new Set(
    isolatedExperiments.map((experiment) => experiment.candidateId),
  )

  if ((form.combinedCandidates ?? []).some((selection) => {
    const ids = [...new Set(selection.componentCandidateIds ?? [])]
    const selected = isolatedExperiments.filter((experiment) =>
      ids.includes(experiment.candidateId))

    return ids.length < 2 ||
      ids.some((candidateId) => !isolatedIds.has(candidateId)) ||
      new Set(selected.map((candidate) => candidate.type)).size !== ids.length
  })) {
    return 'Every combined candidate needs at least two selected, unique feature families.'
  }

  if (experiments.length === 0) return 'Select at least one isolated candidate.'
  if (getUnavailableModelCalibrationSelections(options, form, experiments).length > 0) {
    return 'Prepare the selected historical datasets before running calibration.'
  }

  return ''
}

export const getOrderedModelCalibrationRows = (result) => {
  if (!result?.baseline) return []

  const candidatesById = new Map(
    (result.candidates ?? []).map((candidate) => [candidate.candidateId, candidate]),
  )
  const rankedCandidates = (result.ranking?.comparable ?? [])
    .map((ranking) => candidatesById.get(ranking.candidateId))
    .filter(Boolean)
  const rankedIds = new Set(rankedCandidates.map((candidate) => candidate.candidateId))
  const unrankedCandidates = (result.candidates ?? []).filter(
    (candidate) => !rankedIds.has(candidate.candidateId),
  )

  return [result.baseline, ...rankedCandidates, ...unrankedCandidates]
}

const isShortlistEligible = (candidate) =>
  candidate?.candidateType !== 'BASELINE' &&
  candidate?.diagnostics?.executionStatus === 'completed' &&
  candidate?.diagnostics?.comparability?.comparable === true

export const createModelCalibrationShortlistState = (
  result,
  candidateIds = [],
) => {
  const candidatesById = new Map(
    (result?.candidates ?? []).map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  )
  const eligibleIds = [...new Set(
    Array.isArray(candidateIds) ? candidateIds : [],
  )].filter((candidateId) =>
    isShortlistEligible(candidatesById.get(candidateId)))

  return {
    candidateIds: eligibleIds.slice(0, MODEL_CALIBRATION_SHORTLIST_LIMIT),
    runId: result?.runId ?? null,
  }
}

export const updateModelCalibrationShortlist = (
  result,
  shortlistState,
  candidateId,
  shouldShortlist,
) => {
  const current = shortlistState?.runId === (result?.runId ?? null)
    ? shortlistState
    : createModelCalibrationShortlistState(result)
  const candidateIds = [...current.candidateIds]

  if (candidateId === result?.baseline?.candidateId) {
    return { message: '', state: current }
  }

  if (!shouldShortlist) {
    return {
      message: '',
      state: {
        ...current,
        candidateIds: candidateIds.filter((id) => id !== candidateId),
      },
    }
  }

  if (candidateIds.includes(candidateId)) {
    return { message: '', state: current }
  }

  const candidate = (result?.candidates ?? []).find((item) =>
    item.candidateId === candidateId)

  if (!isShortlistEligible(candidate)) {
    return {
      message: 'Not directly comparable to this run baseline.',
      state: current,
    }
  }

  if (candidateIds.length >= MODEL_CALIBRATION_SHORTLIST_LIMIT) {
    return {
      message: `Shortlist supports up to ${MODEL_CALIBRATION_SHORTLIST_LIMIT} candidates.`,
      state: current,
    }
  }

  return {
    message: '',
    state: { ...current, candidateIds: [...candidateIds, candidateId] },
  }
}

export const getOrderedModelCalibrationShortlist = (
  result,
  shortlistState,
) => {
  if (!result?.baseline) return []

  const selectedIds = new Set(
    shortlistState?.runId === (result.runId ?? null)
      ? shortlistState.candidateIds
      : [],
  )

  return getOrderedModelCalibrationRows(result).filter((candidate) =>
    candidate.candidateType === 'BASELINE' ||
    (selectedIds.has(candidate.candidateId) && isShortlistEligible(candidate)))
}

export const createModelCalibrationRobustnessForm = (
  candidateId = '',
) => ({
  candidateId,
  intervalLevel: 0.95,
  replicates: 2500,
  seed: '',
})

export const validateModelCalibrationRobustnessForm = (
  result,
  shortlistState,
  form,
) => {
  const shortlistCandidates = getOrderedModelCalibrationShortlist(
    result,
    shortlistState,
  ).filter((candidate) => candidate.candidateType !== 'BASELINE')

  if (!shortlistCandidates.some((candidate) =>
    candidate.candidateId === form.candidateId)) {
    return 'Choose a shortlisted comparable candidate.'
  }
  if (!MODEL_CALIBRATION_ROBUSTNESS_REPLICATES.includes(
    Number(form.replicates),
  )) {
    return 'Choose a supported bootstrap sample count.'
  }
  if (!MODEL_CALIBRATION_ROBUSTNESS_INTERVALS.includes(
    Number(form.intervalLevel),
  )) {
    return 'Choose a supported bootstrap interval.'
  }
  if (
    form.seed !== '' &&
    (!/^\d+$/.test(String(form.seed)) ||
      Number(form.seed) > 0xFFFFFFFF)
  ) {
    return 'Seed must be an integer from 0 through 4294967295.'
  }

  return ''
}

export const createModelCalibrationRobustnessRequest = (
  result,
  form,
) => {
  const candidate = result?.candidates?.find((item) =>
    item.candidateId === form.candidateId)

  if (!candidate) return null

  return {
    candidateId: candidate.candidateId,
    identity: {
      baselineSignature: result.evaluationContext?.baselineSignature ?? null,
      candidateConfigurationSignature:
        candidate.metadata?.configurationSignature ?? null,
      datasetSignature: result.evaluationContext?.datasetSignature ?? null,
      gameIdSignature: result.evaluationContext?.gameIdSignature ?? null,
      productionSnapshotId:
        result.evaluationContext?.productionSnapshotId ?? null,
      startingStateSignature:
        result.evaluationContext?.startingStateSignature ?? null,
    },
    intervalLevel: Number(form.intervalLevel),
    replicates: Number(form.replicates),
    runId: result.runId,
    ...(form.seed === '' ? {} : { seed: Number(form.seed) }),
  }
}

export const getModelCalibrationFeatureCount = (candidate) => {
  if (candidate?.candidateType === 'BASELINE') return 0
  if (candidate?.candidateType === MODEL_CALIBRATION_CANDIDATE_TYPES.BASE_MODEL) {
    return null
  }
  if (candidate?.candidateType === MODEL_CALIBRATION_CANDIDATE_TYPES.COMBINED) {
    return candidate.components?.length ?? null
  }

  return candidate ? 1 : null
}

const getEffectivelyTiedIds = (
  candidates,
  getValue,
  selectBest,
  tolerance = MODEL_CALIBRATION_HIGHLIGHT_TOLERANCE,
) => {
  const available = (candidates ?? [])
    .map((candidate) => ({ candidate, value: getValue(candidate) }))
    .filter(({ value }) => Number.isFinite(value))

  if (available.length === 0) return []

  const bestValue = selectBest(available.map(({ value }) => value))

  return available
    .filter(({ value }) =>
      Math.abs(value - bestValue) <=
      tolerance * Math.max(1, Math.abs(value), Math.abs(bestValue)))
    .map(({ candidate }) => candidate.candidateId)
}

export const getModelCalibrationHighlights = (
  candidates,
  tolerance = MODEL_CALIBRATION_HIGHLIGHT_TOLERANCE,
) => {
  const minimum = (values) => Math.min(...values)
  const metricHighlights = [
    ['pooled-brier', 'Best Pooled Brier', (candidate) =>
      candidate.metrics?.pooledBrier],
    ['log-loss', 'Best Log Loss', (candidate) => candidate.metrics?.logLoss],
    ['ece', 'Lowest ECE', (candidate) => candidate.metrics?.ece],
    ['worst-season-brier', 'Best Worst-Season Brier', (candidate) =>
      candidate.metrics?.worstSeasonBrier],
  ].flatMap(([key, label, getValue]) => {
    const candidateIds = getEffectivelyTiedIds(
      candidates,
      getValue,
      minimum,
      tolerance,
    )

    return candidateIds.length > 0 ? [{ candidateIds, key, label }] : []
  })
  const nonBaselineCandidates = candidates.filter((candidate) =>
    candidate.candidateType !== 'BASELINE')
  const mostImprovedIds = getEffectivelyTiedIds(
    nonBaselineCandidates,
    (candidate) => candidate.diagnostics?.seasonConsistency?.seasonsImproved,
    (values) => Math.max(...values),
    tolerance,
  )

  return mostImprovedIds.length > 0
    ? [
        ...metricHighlights,
        {
          candidateIds: mostImprovedIds,
          key: 'seasons-improved',
          label: 'Most Seasons Improved',
        },
      ]
    : metricHighlights
}

export const getModelCalibrationReviewFlags = (candidate, highlights) => {
  const flags = (highlights ?? []).flatMap((highlight) =>
    highlight.candidateIds.includes(candidate.candidateId)
      ? [{
          key: highlight.key,
          label: highlight.candidateIds.length > 1
            ? `Tied · ${highlight.label}`
            : highlight.label,
        }]
      : [])
  const consistency = candidate?.diagnostics?.seasonConsistency

  if (candidate?.candidateType !== 'BASELINE' && consistency?.seasonCount > 0) {
    if (consistency.seasonsImproved === consistency.seasonCount) {
      flags.push({
        key: 'all-seasons-improved',
        label: 'Improved all evaluated seasons',
      })
    } else if (
      consistency.seasonsWorse === 0 &&
      consistency.seasonsImproved > 0
    ) {
      flags.push({
        key: 'no-season-worse',
        label: 'No evaluated season worse',
      })
    }
  }

  return flags
}

export const getShortlistSeasonComparisonRows = (candidates) => {
  const baseline = candidates.find((candidate) =>
    candidate.candidateType === 'BASELINE')
  const seasonIds = [
    ...new Set(candidates.flatMap((candidate) =>
      (candidate.perSeason ?? []).map((season) => season.seasonId))),
  ]
  const baselineBySeason = new Map(
    (baseline?.perSeason ?? []).map((season) => [season.seasonId, season]),
  )

  return seasonIds.map((seasonId) => ({
    candidates: candidates.map((candidate) => {
      const season = (candidate.perSeason ?? []).find((item) =>
        item.seasonId === seasonId)
      const baselineBrier = baselineBySeason.get(seasonId)?.brier

      return {
        brier: Number.isFinite(season?.brier) ? season.brier : null,
        candidateId: candidate.candidateId,
        deltaBrier:
          candidate.candidateType !== 'BASELINE' &&
          Number.isFinite(season?.brier) &&
          Number.isFinite(baselineBrier)
            ? season.brier - baselineBrier
            : null,
      }
    }),
    seasonId,
  }))
}

export const getModelCalibrationDeltaPresentation = (
  value,
  metric = 'brier',
  decimals = 6,
) => {
  if (!Number.isFinite(value)) {
    return { direction: 'unavailable', symbol: '', text: '—' }
  }

  const roundedMagnitude = Number(Math.abs(value).toFixed(decimals))

  if (roundedMagnitude === 0) {
    return {
      direction: 'equal',
      symbol: '↔',
      text: `↔ ${Number(0).toFixed(decimals)} equal`,
    }
  }

  const higherIsBetter = metric === 'accuracy'
  const better = higherIsBetter ? value > 0 : value < 0
  const symbol = value > 0 ? '↑' : '↓'
  const direction = better ? 'better' : 'worse'

  return {
    direction,
    symbol,
    text: `${symbol} ${roundedMagnitude.toFixed(decimals)} ${direction}`,
  }
}

export const getModelCalibrationCandidateStatus = (candidate) => {
  if (candidate?.candidateType === 'BASELINE') return 'Baseline'
  if (candidate?.diagnostics?.executionStatus === 'failed') return 'Failed'
  if (candidate?.diagnostics?.comparability?.comparable === false) {
    return 'Not directly comparable'
  }

  return 'Comparable'
}

export const getBestComparableCandidateId = (result) =>
  result?.ranking?.comparable?.[0]?.candidateId ?? null

export const getPerSeasonComparisonRows = (candidate, baseline) => {
  const baselineBySeason = new Map(
    (baseline?.perSeason ?? []).map((season) => [season.seasonId, season]),
  )

  return (candidate?.perSeason ?? []).map((season) => ({
    ...season,
    deltaBrier:
      Number.isFinite(season.brier) &&
      Number.isFinite(baselineBySeason.get(season.seasonId)?.brier)
        ? season.brier - baselineBySeason.get(season.seasonId).brier
        : null,
  }))
}

export const getOverrideEntries = (candidate) =>
  Object.entries(candidate?.overrides ?? {}).flatMap(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value).map(([nestedKey, nestedValue]) => ({
        key: `${key}.${nestedKey}`,
        value: nestedValue,
      }))
    }

    return [{ key, value }]
  })

export const MODEL_CALIBRATION_PROMOTABLE_TYPES = Object.freeze([
  MODEL_CALIBRATION_CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  MODEL_CALIBRATION_CANDIDATE_TYPES.REST_FATIGUE,
  MODEL_CALIBRATION_CANDIDATE_TYPES.QUICK_REMATCH,
  MODEL_CALIBRATION_CANDIDATE_TYPES.SPECIAL_TEAMS,
])

export const getModelCalibrationPromotionEligibility = (
  result,
  candidate,
) => {
  if (candidate?.candidateType === MODEL_CALIBRATION_CANDIDATE_TYPES.BASE_MODEL) {
    return {
      eligible: false,
      families: [],
      reason: 'Base Model promotion is not supported in this workflow.',
    }
  }
  if (
    candidate?.diagnostics?.executionStatus !== 'completed' ||
    candidate?.diagnostics?.comparability?.comparable !== true
  ) {
    return {
      eligible: false,
      families: [],
      reason: 'Only completed, directly comparable candidates can be reviewed.',
    }
  }
  if (result?.baselineMode !== 'CURRENT_PRODUCTION') {
    return {
      eligible: false,
      families: [],
      reason: 'Promotion requires a run evaluated against Current Production.',
    }
  }
  if (
    !candidate?.metadata?.configurationSignature ||
    !result?.evaluationContext?.productionSnapshotId
  ) {
    return {
      eligible: false,
      families: [],
      reason: 'Frozen candidate or production identity is unavailable.',
    }
  }

  const families = candidate.candidateType ===
    MODEL_CALIBRATION_CANDIDATE_TYPES.COMBINED
    ? (candidate.components ?? []).map((component) => component.type)
    : [candidate.candidateType]
  const uniqueFamilies = [...new Set(families)]

  if (
    uniqueFamilies.length !== families.length ||
    uniqueFamilies.length === 0 ||
    uniqueFamilies.some((type) =>
      !MODEL_CALIBRATION_PROMOTABLE_TYPES.includes(type))
  ) {
    return {
      eligible: false,
      families: uniqueFamilies,
      reason: 'Candidate includes a feature family outside promotion scope.',
    }
  }

  return { eligible: true, families: uniqueFamilies, reason: '' }
}

export const createModelCalibrationPromotionPreviewRequest = (
  result,
  candidateId,
) => ({
  candidateId,
  runId: result?.runId ?? null,
})

export const BASE_MODEL_CALIBRATION_FIELDS = CALIBRATION_NUMBER_FIELDS
