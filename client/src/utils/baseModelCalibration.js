import { BASE_MODEL_V1 } from '../config/baseModel.js'

export const CALIBRATION_STARTING_PRESETS = Object.freeze([
  {
    center: null,
    key: 'current',
    label: 'Current',
    mode: 'current',
    spread: null,
  },
  {
    center: 46,
    key: '37-55',
    label: '37–55',
    mode: 'fixed_spread',
    spread: 18,
  },
  {
    center: 46,
    key: '40-52',
    label: '40–52',
    mode: 'fixed_spread',
    spread: 12,
  },
  {
    center: 46,
    key: '42-50',
    label: '42–50',
    mode: 'fixed_spread',
    spread: 8,
  },
])

export const DEFAULT_SELECTED_CALIBRATION_PRESETS = Object.freeze([
  'current',
  '42-50',
])

export const CALIBRATION_NUMBER_FIELDS = Object.freeze([
  {
    key: 'probabilityScale',
    label: 'Probability scale',
    max: 50,
    min: 0.01,
    step: 0.01,
  },
  {
    key: 'homeAdvantage',
    label: 'Home advantage',
    max: 15,
    min: 0,
    step: 0.01,
  },
  {
    configuration: true,
    key: 'kFactor',
    label: 'K factor',
    max: 10,
    min: 0.01,
    step: 0.01,
  },
  {
    configuration: true,
    key: 'regulationMultiplier',
    label: 'Regulation multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
  {
    configuration: true,
    key: 'overtimeMultiplier',
    label: 'OT multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
  {
    configuration: true,
    key: 'shootoutMultiplier',
    label: 'Shootout multiplier',
    max: 2,
    min: 0,
    step: 0.01,
  },
])

const fallbackDefaults = Object.freeze({
  configuration: Object.freeze({
    kFactor: BASE_MODEL_V1.kFactor,
    overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
    regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
    shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  }),
  dateFrom: '',
  dateTo: '',
  homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
  probabilityScale: BASE_MODEL_V1.probabilityScale,
  seasonId: '',
  startingRatings: Object.freeze({
    center: BASE_MODEL_V1.startingRatings.center,
    mode: 'current',
    spread: BASE_MODEL_V1.startingRatings.spread,
  }),
})

const asInputValue = (value) =>
  value === null || value === undefined ? '' : String(value)

const asFixedInputValue = (value, fallback) => {
  const numberValue = Number(value ?? fallback)

  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : ''
}

export const parseCalibrationNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

export const createCalibrationForm = (options = {}) => {
  const defaults = options.defaults ?? fallbackDefaults

  return {
    configuration: {
      kFactor: asFixedInputValue(
        defaults.configuration?.kFactor,
        BASE_MODEL_V1.kFactor,
      ),
      overtimeMultiplier: asFixedInputValue(
        defaults.configuration?.overtimeMultiplier,
        BASE_MODEL_V1.overtimeMultiplier,
      ),
      regulationMultiplier: asFixedInputValue(
        defaults.configuration?.regulationMultiplier,
        BASE_MODEL_V1.regulationMultiplier,
      ),
      shootoutMultiplier: asFixedInputValue(
        defaults.configuration?.shootoutMultiplier,
        BASE_MODEL_V1.shootoutMultiplier,
      ),
    },
    dateFrom: defaults.dateFrom ?? '',
    dateTo: defaults.dateTo ?? '',
    homeAdvantage: asFixedInputValue(
      defaults.homeAdvantage,
      BASE_MODEL_V1.baseHomeAdvantage,
    ),
    probabilityScale: asFixedInputValue(
      defaults.probabilityScale,
      BASE_MODEL_V1.probabilityScale,
    ),
    seasonIds: defaults.seasonId ? [defaults.seasonId] : [],
    startingRatings: {
      center: asInputValue(
        defaults.startingRatings?.center ?? BASE_MODEL_V1.startingRatings.center,
      ),
      mode: defaults.startingRatings?.mode ?? 'current',
      spread: asInputValue(
        defaults.startingRatings?.spread ?? BASE_MODEL_V1.startingRatings.spread,
      ),
    },
    useCustomDateRange: false,
  }
}

export const toggleCalibrationSeason = (seasonIds = [], seasonId) =>
  seasonIds.includes(seasonId)
    ? seasonIds.filter((id) => id !== seasonId)
    : [...seasonIds, seasonId]

export const selectAllCalibrationSeasons = (seasons = []) =>
  [...new Set(seasons.map((season) => season.id))]

export const clearCalibrationSeasons = () => []

export const isLatestCalibrationRequest = (requestSequence, activeSequence) =>
  requestSequence === activeSequence

export const estimateCalibrationGames = (seasonIds = []) =>
  seasonIds.length * 1312

export const calculateCalibrationProbability = ({
  homeAdvantage,
  probabilityScale,
  ratingDifference,
}) => {
  const scale = Number(probabilityScale)
  const adjustedDifference = Number(ratingDifference) + Number(homeAdvantage)

  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(adjustedDifference)) {
    return null
  }

  const scaledDifference = adjustedDifference / scale

  if (scaledDifference >= 0) {
    const exponent = Math.exp(-scaledDifference)

    return 1 / (1 + exponent)
  }

  const exponent = Math.exp(scaledDifference)

  return exponent / (1 + exponent)
}

export const buildProbabilityReferenceRows = (form) =>
  [0, 1, 2, 4, 6, 8, 10].map((ratingDifference) => ({
    appliedHomeProbability: calculateCalibrationProbability({
      homeAdvantage: form.homeAdvantage,
      probabilityScale: form.probabilityScale,
      ratingDifference,
    }),
    neutralHomeProbability: calculateCalibrationProbability({
      homeAdvantage: 0,
      probabilityScale: form.probabilityScale,
      ratingDifference,
    }),
    ratingDifference,
  }))

export const validateCalibrationForm = (form, selectedPresetKeys = []) => {
  if (!Array.isArray(form.seasonIds) || form.seasonIds.length === 0) {
    return 'Select at least one historical season.'
  }

  if (form.useCustomDateRange && form.seasonIds.length !== 1) {
    return 'A custom date range can only be used with one historical season.'
  }

  if (form.useCustomDateRange && (!form.dateFrom || !form.dateTo)) {
    return 'Choose a calibration start date and end date.'
  }

  if (form.useCustomDateRange && form.dateFrom > form.dateTo) {
    return 'Calibration start date must be on or before the end date.'
  }

  if (
    form.seasonIds.length > 1 &&
    (selectedPresetKeys.includes('current') ||
      (selectedPresetKeys.includes('custom') &&
        form.startingRatings.mode === 'current'))
  ) {
    return 'Current production ratings cannot be used across multiple seasons.'
  }

  if (selectedPresetKeys.length < 2) {
    return 'Select at least two runs for comparison.'
  }

  for (const field of CALIBRATION_NUMBER_FIELDS) {
    const rawValue = field.configuration
      ? form.configuration[field.key]
      : form[field.key]
    const value = parseCalibrationNumber(rawValue)

    if (value === null || value < field.min || value > field.max) {
      return `${field.label} must be between ${field.min} and ${field.max}.`
    }
  }

  const center = Number(form.startingRatings.center)
  const spread = Number(form.startingRatings.spread)

  if (!Number.isFinite(center) || center < -1000 || center > 1000) {
    return 'Starting center must be between -1000 and 1000.'
  }

  if (!Number.isFinite(spread) || spread <= 0 || spread > 100) {
    return 'Starting spread must be greater than 0 and no more than 100.'
  }

  return ''
}

export const createCalibrationPayload = (form, preset) => {
  const payload = {
    configuration: {
      kFactor: parseCalibrationNumber(form.configuration.kFactor),
      overtimeMultiplier: parseCalibrationNumber(
        form.configuration.overtimeMultiplier,
      ),
      regulationMultiplier: parseCalibrationNumber(
        form.configuration.regulationMultiplier,
      ),
      shootoutMultiplier: parseCalibrationNumber(
        form.configuration.shootoutMultiplier,
      ),
    },
    homeAdvantage: parseCalibrationNumber(form.homeAdvantage),
    label: preset.label,
    probabilityScale: parseCalibrationNumber(form.probabilityScale),
    seasonIds: [...form.seasonIds],
    startingRatings: {
      center:
        preset.mode === 'fixed_spread'
          ? preset.center
          : parseCalibrationNumber(form.startingRatings.center),
      mode: preset.mode,
      spread:
        preset.mode === 'fixed_spread'
          ? preset.spread
          : parseCalibrationNumber(form.startingRatings.spread),
    },
    useCustomDateRange: form.useCustomDateRange === true,
  }

  if (payload.useCustomDateRange) {
    payload.dateFrom = form.dateFrom
    payload.dateTo = form.dateTo
  }

  return payload
}

export const sortCalibrationRuns = (runs = [], sortKey = 'brierScore') =>
  [...runs].sort((left, right) => {
    const getValue = (run) => {
      if (sortKey === 'logLoss') {
        return Number(run.metrics?.logLoss)
      }

      if (sortKey === 'expectedCalibrationError') {
        return Number(run.metrics?.expectedCalibrationError)
      }

      if (sortKey === 'accuracy') {
        return -Number(run.metrics?.accuracy?.rate)
      }

      if (sortKey === 'averageSeasonBrier') {
        return Number(run.aggregate?.averageSeasonBrier)
      }

      if (sortKey === 'worstSeasonBrier') {
        return Number(run.aggregate?.worstSeason?.brierScore)
      }

      return Number(run.metrics?.brierScore)
    }
    const leftValue = getValue(left)
    const rightValue = getValue(right)
    const difference =
      (Number.isFinite(leftValue) ? leftValue : Number.POSITIVE_INFINITY) -
      (Number.isFinite(rightValue) ? rightValue : Number.POSITIVE_INFINITY)

    return difference !== 0
      ? difference
      : String(left.label).localeCompare(String(right.label))
  })

const getRequestedSeasonIds = (run) =>
  run.coverage?.requestedSeasonIds ?? run.filters?.seasonIds ?? []

const getCompletedSeasonIds = (run) =>
  run.coverage?.completedSeasonIds ??
  run.seasonResults?.map((season) => season.seasonId) ??
  []

const getCoverageSignature = (run, includeCompleted) =>
  [
    [...getRequestedSeasonIds(run)].sort().join(','),
    includeCompleted ? [...getCompletedSeasonIds(run)].sort().join(',') : '',
  ].join('|')

const selectLargestCoverageGroup = (runs, includeCompleted) => {
  const groups = new Map()

  runs.forEach((run) => {
    const signature = getCoverageSignature(run, includeCompleted)
    const group = groups.get(signature) ?? []

    group.push(run)
    groups.set(signature, group)
  })

  return [...groups.values()].sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length
    }

    const rightCompleted = getCompletedSeasonIds(right[0]).length
    const leftCompleted = getCompletedSeasonIds(left[0]).length

    return rightCompleted - leftCompleted
  })[0] ?? []
}

export const buildCalibrationRanking = (runs = [], sortKey = 'brierScore') => {
  const completeRuns = runs.filter((run) => run.coverage?.incomplete !== true)
  const rankingKind = completeRuns.length > 0 ? 'complete' : 'partial'
  const candidates = rankingKind === 'complete' ? completeRuns : runs
  const eligibleRuns = selectLargestCoverageGroup(
    candidates,
    rankingKind === 'partial',
  )
  const eligibleSet = new Set(eligibleRuns)
  const excludedRuns = runs.filter((run) => !eligibleSet.has(run))

  return {
    eligibleRuns: sortCalibrationRuns(eligibleRuns, sortKey),
    excludedRuns: sortCalibrationRuns(excludedRuns, sortKey),
    kind: rankingKind,
    orderedRuns: [
      ...sortCalibrationRuns(eligibleRuns, sortKey),
      ...sortCalibrationRuns(excludedRuns, sortKey),
    ],
  }
}

export const formatCalibrationScore = (value, decimals = 4) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue.toFixed(decimals) : '--'
}

export const formatCalibrationPercent = (value, decimals = 1) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue)
    ? `${(numberValue * 100).toFixed(decimals)}%`
    : '--'
}

export const buildCalibrationSummary = (runs = []) => {
  const ranking = buildCalibrationRanking(runs)
  const rankedRuns = ranking.eligibleRuns
  const best = rankedRuns[0]
  const runnerUp = rankedRuns[1]

  if (!best) {
    return ''
  }

  if (!runnerUp) {
    return ranking.kind === 'partial'
      ? `${best.label} is the only comparable partial result; complete the same season set before drawing a global comparison.`
      : `${best.label} is the only completed run; add another run before drawing a comparison.`
  }

  const brierGap = runnerUp.metrics.brierScore - best.metrics.brierScore

  const qualifier = ranking.kind === 'partial'
    ? ' has the lowest pooled Brier score among partial results'
    : ' has the lowest pooled Brier score'

  return `${best.label}${qualifier} (${formatCalibrationScore(
    best.metrics.brierScore,
  )}), ahead of ${runnerUp.label} by ${formatCalibrationScore(
    brierGap,
  )}. Lower Brier, log loss, and ECE are better; accuracy is context only.`
}
