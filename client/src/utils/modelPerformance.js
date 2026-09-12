export const MODEL_PERFORMANCE_TABS = Object.freeze([
  { id: 'forward', label: 'Forward Model' },
  { id: 'bets', label: 'Bets & CLV' },
  { id: 'games', label: 'Games' },
])

export const GAME_STATUS_OPTIONS = Object.freeze([
  { value: 'all', label: 'All games' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'pending', label: 'Pending' },
  { value: 'missing_market', label: 'Missing market' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'missed_official_t2', label: 'Missed Official T2' },
  { value: 'missing_t24', label: 'Missing T24' },
  { value: 'missing_t6', label: 'Missing T6' },
  { value: 'missing_t2', label: 'Missing T2' },
  { value: 'missing_final', label: 'Missing FINAL' },
])

export const CAPTURE_HEALTH_FILTER_BY_CHECKPOINT = Object.freeze({
  FINAL: 'missing_final',
  OFFICIAL_T2: 'missed_official_t2',
  T2: 'missing_t2',
  T6: 'missing_t6',
  T24: 'missing_t24',
})

export const createModelPerformanceFilters = () => ({
  from: '',
  modelVersion: '',
  season: '',
  to: '',
})

export const buildModelPerformanceQueryString = (
  filters = {},
  { games = false } = {},
) => {
  const search = new URLSearchParams()
  const keys = games
    ? ['season', 'from', 'to', 'modelVersion', 'status', 'page', 'limit']
    : ['season', 'from', 'to', 'modelVersion']

  keys.forEach((key) => {
    const value = filters[key]

    if (value !== null && value !== undefined && String(value).trim() !== '') {
      search.set(key, String(value).trim())
    }
  })

  const query = search.toString()

  return query ? `?${query}` : ''
}

export const isAvailableNumber = (value) =>
  value !== null && value !== undefined && Number.isFinite(Number(value))

export const formatNumber = (value, digits = 3) =>
  isAvailableNumber(value) ? Number(value).toFixed(digits) : '—'

export const formatProbability = (value, digits = 1) =>
  isAvailableNumber(value) ? `${(Number(value) * 100).toFixed(digits)}%` : '—'

export const formatPercent = (value, digits = 1) =>
  isAvailableNumber(value) ? `${Number(value).toFixed(digits)}%` : '—'

export const formatSignedNumber = (value, digits = 3, suffix = '') => {
  if (!isAvailableNumber(value)) return '—'

  const number = Number(value)
  const prefix = number > 0 ? '+' : ''

  return `${prefix}${number.toFixed(digits)}${suffix}`
}

export const formatOdds = (value) =>
  isAvailableNumber(value) && Number(value) > 1
    ? Number(value).toFixed(2)
    : '—'

export const formatUnits = (value) =>
  isAvailableNumber(value)
    ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}u`
    : '—'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

export const formatGameDate = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : '—'
}

export const formatTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)

  return Number.isFinite(date.getTime())
    ? `${timestampFormatter.format(date)} UTC`
    : '—'
}

export const getSampleState = (sampleSize = 0) => {
  const count = Math.max(0, Number(sampleSize) || 0)

  if (count === 0) return { id: 'empty', label: 'No forward performance data yet' }
  if (count < 10) return { id: 'exploratory', label: 'Exploratory sample' }
  if (count < 50) return { id: 'very-small', label: 'Very small sample' }
  if (count < 200) return { id: 'developing', label: 'Developing sample' }
  return { id: 'normal', label: 'Normal presentation' }
}

export const getMetricTone = (
  value,
  sampleSize,
  { positiveIsGood = true } = {},
) => {
  if (!isAvailableNumber(value) || Number(sampleSize) < 50 || Number(value) === 0) {
    return 'neutral'
  }

  const positive = Number(value) > 0

  return positive === positiveIsGood ? 'positive' : 'negative'
}

export const getCalibrationPointState = (sampleSize) => {
  if (Number(sampleSize) < 10) return 'sparse'
  if (Number(sampleSize) < 25) return 'cautious'
  return 'normal'
}

export const getCalibrationChartPoint = (bucket) => {
  if (
    !isAvailableNumber(bucket?.averagePredictedProbability) ||
    !isAvailableNumber(bucket?.actualWinRate)
  ) {
    return null
  }

  const predicted = Number(bucket.averagePredictedProbability)
  const actual = Number(bucket.actualWinRate)

  return {
    state: getCalibrationPointState(bucket.sampleSize),
    x: 48 + ((predicted - 0.5) / 0.5) * 332,
    y: 210 - actual * 176,
  }
}

export const formatCalibrationBucket = ({ lowerBound, upperBound }) =>
  `${Math.round(Number(lowerBound) * 100)}–${Math.round(Number(upperBound) * 100)}%`

export const shortenFingerprint = (value) => {
  const fingerprint = String(value ?? '')

  return fingerprint.length > 12
    ? `${fingerprint.slice(0, 8)}…${fingerprint.slice(-4)}`
    : fingerprint || '—'
}

const REASON_LABELS = Object.freeze({
  BET_AFTER_START: 'Bet was saved after puck drop',
  CAPTURE_DATA_UNAVAILABLE: 'Capture data unavailable',
  GAME_POSTPONED: 'Game postponed',
  GAME_UNAVAILABLE: 'Game unavailable',
  INCOMPLETE_TWO_SIDED_ODDS: 'Two-sided market unavailable',
  INVALID_BET_ODDS: 'Bet odds invalid',
  INVALID_BET_SIDE: 'Bet side could not be linked safely',
  INVALID_FINAL_RESULT: 'Final result invalid',
  INVALID_OFFICIAL_PREDICTION: 'Official prediction invalid',
  MANUAL_ODDS: 'Manual odds are not CLV eligible',
  MISSING_FINAL_MARKET: 'FINAL market unavailable',
  MISSING_T2_MARKET: 'T2 market unavailable',
  MODEL_VERSION_MISSING: 'Model version missing',
  MISSING_T24_MARKET: 'T24 market checkpoint missed',
  MISSING_T6_MARKET: 'T6 market checkpoint missed',
  NO_LATER_SAME_BOOK_FINAL: 'No later same-book FINAL price',
  NO_OFFICIAL_PREDICTION: 'No official prediction',
  NO_RELEVANT_BET: 'No relevant saved bet',
  NO_SETTLED_BET: 'No settled bet',
  NO_SETTLED_STAKE: 'No settled stake',
  OFFICIAL_T2_CAPTURE_MISSED: 'Official T2 capture missed',
  PREDICTION_AFTER_START: 'Prediction was generated after start',
  RESULT_PENDING: 'Result pending',
  RESULT_UNAVAILABLE: 'Result unavailable',
  SCHEDULE_IDENTITY_MISMATCH: 'Scheduled-start identity mismatch',
  SCHEDULE_UNAVAILABLE: 'Canonical schedule unavailable',
  UNKNOWN_BOOKMAKER: 'Bookmaker is not recognized',
})

export const formatPerformanceReason = (reason) =>
  REASON_LABELS[reason] ??
  String(reason ?? '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase())

export const getSelectedModel = (row) => {
  if (!row?.model) return null
  if (row.model.pick === 'NO_PICK') {
    return {
      fairOdds: row.model.homeFairOdds,
      label: 'No pick',
      probability: row.model.homeWinProbability,
    }
  }

  const home = row.model.pick === 'home'

  return {
    fairOdds: home ? row.model.homeFairOdds : row.model.awayFairOdds,
    label: home ? row.homeTeamId : row.awayTeamId,
    probability: home
      ? row.model.homeWinProbability
      : row.model.awayWinProbability,
  }
}

export const getResultSummary = (row) => {
  if (row?.result?.status !== 'FINAL') {
    return row?.result?.reason ? formatPerformanceReason(row.result.reason) : 'Pending'
  }

  const winner = row.result.homeWon ? row.homeTeamId : row.awayTeamId
  const suffix =
    row.result.resultType === 'OVERTIME'
      ? ' OT'
      : row.result.resultType === 'SHOOTOUT'
        ? ' SO'
        : ''

  return `${winner} ${row.result.awayScore}–${row.result.homeScore}${suffix}`
}

export const buildPriceTimelinePoints = (bet) => {
  const timeline = bet?.priceTimeline ?? {}

  return [
    ['earliestCaptured', 'Earliest captured market'],
    ['t6', 'T6'],
    ['t2', 'T2'],
    ['bet', 'Bet'],
    ['final', 'Same-book FINAL'],
  ]
    .map(([key, label]) => ({ key, label, ...timeline[key] }))
    .filter(({ odds }) => isAvailableNumber(odds) && Number(odds) > 1)
}

export const isCaptureHealthStatusFilter = (value) =>
  Object.values(CAPTURE_HEALTH_FILTER_BY_CHECKPOINT).includes(value)

export const getCaptureHealthLabel = (captureHealth = {}) => {
  if (captureHealth.status === 'MISSED') return 'Capture gaps detected'
  if (captureHealth.status === 'CAPTURED') return 'Capture health OK'
  if (captureHealth.status === 'NOT_DUE') return 'No checkpoints due yet'
  return 'Capture health unavailable'
}

export const formatCaptureCoverage = (captured, expected) =>
  isAvailableNumber(captured) && isAvailableNumber(expected)
    ? `${Number(captured)} / ${Number(expected)}`
    : '—'
