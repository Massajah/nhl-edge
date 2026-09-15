const nhlApiService = require('./nhlApiService')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  isCheckpointWithinAcceptanceWindow,
} = require('./oddsCaptureContracts')
const {
  CLOSE_BEFORE_MS,
  OPEN_BEFORE_MS,
  getGameIdentity,
  isForwardPredictionGameBlocked,
} = require('./forwardPredictionContracts')
const {
  PERFORMANCE_REASON_CODES,
  PERFORMANCE_STATUSES,
  calculateNoVigConsensus,
} = require('./modelPerformanceContracts')
const { ODDS_SNAPSHOT_TYPES } = require('./oddsSnapshotContracts')

const DAY_MS = 24 * 60 * 60 * 1000
const CAPTURE_HEALTH_GAME_STATES = new Set([
  'CRIT',
  'FINAL',
  'FUT',
  'LIVE',
  'OFF',
  'POST',
  'PRE',
])
const CAPTURE_HEALTH_STATUSES = Object.freeze({
  // Legacy constant aliases keep callers source-compatible; response values
  // use the aggregate HEALTHY/GAPS vocabulary.
  CAPTURED: 'HEALTHY',
  GAPS: 'GAPS',
  HEALTHY: 'HEALTHY',
  MISSED: 'GAPS',
  NOT_DUE: 'NOT_DUE',
  UNAVAILABLE: 'UNAVAILABLE',
})
const CAPTURE_HEALTH_OBSERVATION_STATES = Object.freeze({
  CAPTURED: 'CAPTURED',
  MISSED: 'MISSED',
  NOT_DUE: 'NOT_DUE',
  UNAVAILABLE: 'UNAVAILABLE',
})
const CAPTURE_HEALTH_REASONS = Object.freeze({
  CAPTURE_DATA_UNAVAILABLE: 'CAPTURE_DATA_UNAVAILABLE',
  MISSING_FINAL_MARKET: PERFORMANCE_REASON_CODES.MISSING_FINAL_MARKET,
  MISSING_T2_MARKET: PERFORMANCE_REASON_CODES.MISSING_T2_MARKET,
  OFFICIAL_T2_CAPTURE_MISSED: 'OFFICIAL_T2_CAPTURE_MISSED',
  SCHEDULE_IDENTITY_MISMATCH:
    PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH,
  MISSING_T24_MARKET: 'MISSING_T24_MARKET',
  MISSING_T6_MARKET: 'MISSING_T6_MARKET',
  PRODUCTION_ACCOUNT_INELIGIBLE: 'PRODUCTION_ACCOUNT_INELIGIBLE',
  SCHEDULE_UNAVAILABLE: 'SCHEDULE_UNAVAILABLE',
})
const CAPTURE_HEALTH_FILTERS = Object.freeze({
  officialT2Missing: Object.freeze({
    checkpoint: 'OFFICIAL_T2',
    detailKey: 'officialT2',
  }),
  t24Missing: Object.freeze({ checkpoint: 'T24', detailKey: 'T24' }),
  t6Missing: Object.freeze({ checkpoint: 'T6', detailKey: 'T6' }),
  t2Missing: Object.freeze({ checkpoint: 'T2', detailKey: 'T2' }),
  finalMissing: Object.freeze({ checkpoint: 'FINAL', detailKey: 'FINAL' }),
})
const LEGACY_CAPTURE_HEALTH_STATUS_FILTERS = Object.freeze({
  missed_official_t2: CAPTURE_HEALTH_FILTERS.officialT2Missing,
  missing_t24: CAPTURE_HEALTH_FILTERS.t24Missing,
  missing_t6: CAPTURE_HEALTH_FILTERS.t6Missing,
  missing_t2: CAPTURE_HEALTH_FILTERS.t2Missing,
  missing_final: CAPTURE_HEALTH_FILTERS.finalMissing,
})

const normalizeDate = (value) => {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

const percentage = (numerator, denominator) =>
  denominator > 0 ? (numerator / denominator) * 100 : null

const identityKey = (value = {}) => {
  const scheduledStart = normalizeDate(
    value.scheduledStartAtCapture ?? value.scheduledStart ?? value.startTimeUTC,
  )

  if (!scheduledStart) return ''

  return [
    String(value.gameId ?? ''),
    String(value.seasonId ?? value.season ?? ''),
    Number(value.gameType),
    String(value.homeTeamId ?? ''),
    String(value.awayTeamId ?? ''),
    scheduledStart.getTime(),
  ].join('|')
}

const scheduleQueryBounds = (normalized) => ({
  from: new Date(normalized.start.getTime() - DAY_MS)
    .toISOString()
    .slice(0, 10),
  // endExclusive is already the day immediately after the inclusive UI range.
  // Querying it provides the one-day reschedule/UTC cushion without a second
  // unnecessary day of provider work.
  to: normalized.endExclusive.toISOString().slice(0, 10),
})

const normalizeScheduleCohort = (games, normalized) => {
  const byGameId = new Map()

  ;(Array.isArray(games) ? games : []).forEach((game) => {
    const identity = getGameIdentity(game)
    const gameState = String(game?.gameState ?? '').trim().toUpperCase()

    if (
      !identity ||
      identity.seasonId !== normalized.season.id ||
      !CAPTURE_HEALTH_GAME_STATES.has(gameState) ||
      isForwardPredictionGameBlocked(game)
    ) {
      return
    }

    // The canonical NHL schedule is game-scoped. If a provider response contains
    // both a stale and a current reschedule row, the last canonical row replaces
    // the earlier identity instead of creating two expected observations.
    byGameId.set(identity.gameId, {
      ...identity,
      scheduledStart: identity.scheduledStartAtCapture,
    })
  })

  return [...byGameId.values()].filter(
    ({ scheduledStart }) =>
      scheduledStart >= normalized.start &&
      scheduledStart < normalized.endExclusive,
  ).sort(
    (left, right) =>
      left.scheduledStart.getTime() - right.scheduledStart.getTime() ||
      left.gameId.localeCompare(right.gameId),
  )
}

const isPotentiallyApplicableScheduleGame = (game, normalized) => {
  const seasonId = String(game?.season ?? game?.seasonId ?? '')
  const rawGameType = game?.gameType
  const gameType = Number(rawGameType)
  const gameState = String(game?.gameState ?? '').trim().toUpperCase()

  if (
    !CAPTURE_HEALTH_GAME_STATES.has(gameState) ||
    isForwardPredictionGameBlocked(game)
  ) {
    return false
  }

  const start = normalizeDate(
    game?.startTimeUTC ?? game?.scheduledStartAtCapture,
  )
  const scheduleDate = String(game?.__replayScheduleDate ?? '')
  const scheduleDay = /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)
    ? normalizeDate(`${scheduleDate}T00:00:00.000Z`)
    : null
  const isInRange = start
    ? start >= normalized.start && start < normalized.endExclusive
    : scheduleDay
      ? scheduleDay >= normalized.start && scheduleDay < normalized.endExclusive
      : true

  if (!isInRange) return false
  if (seasonId && seasonId !== normalized.season.id) return false
  if (
    rawGameType !== null &&
    rawGameType !== undefined &&
    rawGameType !== '' &&
    Number.isInteger(gameType) &&
    ![2, 3].includes(gameType)
  ) {
    return false
  }

  // The provider was queried only for the selected (padded) schedule range. A
  // potentially selected game with an incomplete identity cannot be excluded
  // safely, so its denominator must be unavailable rather than zero.
  return true
}

const hasUnsafeScheduleIdentity = (games, normalized) =>
  (Array.isArray(games) ? games : []).some(
    (game) =>
      isPotentiallyApplicableScheduleGame(game, normalized) &&
      !getGameIdentity(game),
  )

const isWindowFullyElapsed = (scheduledStart, closeBeforeStartMs, observedAt) =>
  observedAt.getTime() > scheduledStart.getTime() - closeBeforeStartMs

const isOfficialPredictionCapture = (prediction) => {
  const start = normalizeDate(prediction?.scheduledStartAtCapture)
  const generatedAt = normalizeDate(prediction?.generatedAt)

  if (!start || !generatedAt) return false

  const beforeStartMs = start.getTime() - generatedAt.getTime()

  return (
    beforeStartMs >= CLOSE_BEFORE_MS &&
    beforeStartMs <= OPEN_BEFORE_MS
  )
}

const isAcceptedCheckpointSnapshot = (snapshot) => {
  const scheduledStart = normalizeDate(snapshot?.scheduledStartAtCapture)
  const capturedAt = normalizeDate(snapshot?.capturedAt)

  if (!scheduledStart || !capturedAt) return false

  try {
    return isCheckpointWithinAcceptanceWindow(
      {
        scheduledStart,
        snapshotType: snapshot.snapshotType,
      },
      capturedAt,
    )
  } catch {
    return false
  }
}

const isAcceptedFinalMarket = (market) =>
  Boolean(market?.finalizedAt) &&
  calculateNoVigConsensus(market?.finalBookmakers).status ===
    PERFORMANCE_STATUSES.AVAILABLE

const getCaptureStatus = (expectedCount, missedCount) => {
  if (expectedCount === 0) return CAPTURE_HEALTH_STATUSES.NOT_DUE
  if (missedCount > 0) return CAPTURE_HEALTH_STATUSES.GAPS
  return CAPTURE_HEALTH_STATUSES.HEALTHY
}

const buildCoverage = ({ capturedCount, expectedCount }) => {
  const missedCount = Math.max(0, expectedCount - capturedCount)

  return {
    capturedCount,
    coveragePercent: percentage(capturedCount, expectedCount),
    expectedCount,
    missingCount: missedCount,
    status: getCaptureStatus(expectedCount, missedCount),
  }
}

const toMissingGame = (game, checkpoint, reason) => ({
  awayTeam: game.awayTeamId,
  awayTeamId: game.awayTeamId,
  checkpoint,
  captureCheckpoint: checkpoint,
  captureStatus: CAPTURE_HEALTH_OBSERVATION_STATES.MISSED,
  gameId: game.gameId,
  homeTeam: game.homeTeamId,
  homeTeamId: game.homeTeamId,
  reason,
  scheduledStart: game.scheduledStart,
  season: game.seasonId,
  seasonId: game.seasonId,
  state: CAPTURE_HEALTH_OBSERVATION_STATES.MISSED,
})

const hasMismatchedIdentityForGame = (game, documents = []) => {
  const expectedKey = identityKey(game)

  return documents.some(
    (document) =>
      String(document?.gameId ?? '') === String(game.gameId) &&
      identityKey(document) !== expectedKey,
  )
}

const buildUnavailableCoverage = () => ({
  capturedCount: null,
  coveragePercent: null,
  expectedCount: null,
  missingCount: null,
  status: CAPTURE_HEALTH_STATUSES.UNAVAILABLE,
})

const buildUnavailableCaptureHealth = (
  reason = CAPTURE_HEALTH_REASONS.SCHEDULE_UNAVAILABLE,
  { observedAt = null, scheduleSource = null, stale = null } = {},
) => ({
  marketCheckpoints: {
    FINAL: buildUnavailableCoverage(),
    T2: buildUnavailableCoverage(),
    T6: buildUnavailableCoverage(),
    T24: buildUnavailableCoverage(),
  },
  missingGames: { FINAL: [], T2: [], T6: [], T24: [], officialT2: [] },
  observedAt,
  officialT2: {
    capturedCount: null,
    capturedOfficialT2: null,
    coveragePercent: null,
    expectedCount: null,
    expectedOfficialT2: null,
    missedCount: null,
    missedOfficialT2: null,
    missingCount: null,
    officialT2CoveragePercent: null,
    status: CAPTURE_HEALTH_STATUSES.UNAVAILABLE,
  },
  reason,
  schedule: { source: scheduleSource, stale },
  status: CAPTURE_HEALTH_STATUSES.UNAVAILABLE,
})

const calculateCaptureHealth = ({
  closingMarkets = [],
  normalized,
  observedAt,
  predictions = [],
  scheduleGames = [],
  scheduleSource = null,
  snapshots = [],
}) => {
  const current = normalizeDate(observedAt)
  if (!current) throw new TypeError('observedAt must be a valid date.')

  if (hasUnsafeScheduleIdentity(scheduleGames, normalized)) {
    return buildUnavailableCaptureHealth(
      CAPTURE_HEALTH_REASONS.SCHEDULE_UNAVAILABLE,
      { observedAt: current, scheduleSource, stale: false },
    )
  }

  const cohort = normalizeScheduleCohort(scheduleGames, normalized)
  const officialDue = cohort.filter((game) =>
    isWindowFullyElapsed(game.scheduledStart, CLOSE_BEFORE_MS, current),
  )
  const capturedPredictionKeys = new Set(
    predictions
      .filter(isOfficialPredictionCapture)
      .map(identityKey)
      .filter(Boolean),
  )
  const missedOfficial = officialDue.filter(
    (game) => !capturedPredictionKeys.has(identityKey(game)),
  )
  const capturedOfficialT2 = officialDue.length - missedOfficial.length
  const officialCoverage = buildCoverage({
    capturedCount: capturedOfficialT2,
    expectedCount: officialDue.length,
  })
  const officialT2 = {
    ...officialCoverage,
    // These aliases preserve the Phase 0-3 response while the generic count
    // fields provide the same contract as every market checkpoint.
    capturedOfficialT2,
    expectedOfficialT2: officialDue.length,
    missedCount: missedOfficial.length,
    missedOfficialT2: missedOfficial.length,
    officialT2CoveragePercent: officialCoverage.coveragePercent,
  }
  const acceptedSnapshotKeys = new Set(
    snapshots
      .filter(isAcceptedCheckpointSnapshot)
      .map((snapshot) => `${snapshot.snapshotType}|${identityKey(snapshot)}`)
      .filter((key) => !key.endsWith('|')),
  )
  const acceptedFinalKeys = new Set(
    closingMarkets
      .filter(isAcceptedFinalMarket)
      .map(identityKey)
      .filter(Boolean),
  )
  const missingGames = {
    officialT2: missedOfficial.map((game) =>
      toMissingGame(
        game,
        'OFFICIAL_T2',
        hasMismatchedIdentityForGame(game, predictions)
          ? CAPTURE_HEALTH_REASONS.SCHEDULE_IDENTITY_MISMATCH
          : CAPTURE_HEALTH_REASONS.OFFICIAL_T2_CAPTURE_MISSED,
      ),
    ),
  }
  const marketCheckpoints = {}

  Object.values(ODDS_SNAPSHOT_TYPES).forEach((snapshotType) => {
    const window = CHECKPOINT_ACCEPTANCE_WINDOWS_MS[snapshotType]
    const due = cohort.filter((game) =>
      isWindowFullyElapsed(
        game.scheduledStart,
        window.minimumBeforeStartMs,
        current,
      ),
    )
    const captured = due.filter((game) =>
      snapshotType === ODDS_SNAPSHOT_TYPES.FINAL
        ? acceptedFinalKeys.has(identityKey(game))
        : acceptedSnapshotKeys.has(`${snapshotType}|${identityKey(game)}`),
    )
    const capturedKeys = new Set(captured.map(identityKey))
    const missing = due.filter((game) => !capturedKeys.has(identityKey(game)))
    const reason =
      snapshotType === ODDS_SNAPSHOT_TYPES.T24
        ? CAPTURE_HEALTH_REASONS.MISSING_T24_MARKET
        : snapshotType === ODDS_SNAPSHOT_TYPES.T6
          ? CAPTURE_HEALTH_REASONS.MISSING_T6_MARKET
          : snapshotType === ODDS_SNAPSHOT_TYPES.T2
            ? CAPTURE_HEALTH_REASONS.MISSING_T2_MARKET
            : CAPTURE_HEALTH_REASONS.MISSING_FINAL_MARKET
    const checkpointDocuments =
      snapshotType === ODDS_SNAPSHOT_TYPES.FINAL
        ? closingMarkets
        : snapshots.filter(
            (snapshot) => snapshot.snapshotType === snapshotType,
          )

    marketCheckpoints[snapshotType] = buildCoverage({
      capturedCount: captured.length,
      expectedCount: due.length,
    })
    missingGames[snapshotType] = missing.map((game) =>
      toMissingGame(
        game,
        snapshotType,
        hasMismatchedIdentityForGame(game, checkpointDocuments)
          ? CAPTURE_HEALTH_REASONS.SCHEDULE_IDENTITY_MISMATCH
          : reason,
      ),
    )
  })

  const sections = [officialT2, ...Object.values(marketCheckpoints)]
  const status = sections.some(
    (section) => section.status === CAPTURE_HEALTH_STATUSES.GAPS,
  )
    ? CAPTURE_HEALTH_STATUSES.GAPS
    : sections.some(
          (section) => section.status === CAPTURE_HEALTH_STATUSES.HEALTHY,
        )
      ? CAPTURE_HEALTH_STATUSES.HEALTHY
      : CAPTURE_HEALTH_STATUSES.NOT_DUE

  return {
    marketCheckpoints,
    missingGames,
    observedAt: current,
    officialT2,
    reason: null,
    schedule: { source: scheduleSource, stale: false },
    status,
  }
}

const getObservedAt = (value) => {
  const candidate = typeof value === 'function' ? value() : value

  return normalizeDate(candidate ?? new Date())
}

const loadCaptureHealth = async ({
  normalized,
  now,
  predictions,
  repository,
  scheduleProvider = nhlApiService.getScheduleGamesForDateRange,
}) => {
  const observedAt = getObservedAt(now)
  const bounds = scheduleQueryBounds(normalized)
  let scheduleState

  try {
    const response = await scheduleProvider(bounds.from, bounds.to, {
      allowStale: false,
      includeProviderState: true,
      seasonId: normalized.season.id,
    })
    scheduleState = Array.isArray(response)
      ? { games: response, source: 'schedule', stale: false }
      : response
  } catch {
    return buildUnavailableCaptureHealth()
  }

  if (
    !observedAt ||
    !Array.isArray(scheduleState?.games) ||
    scheduleState.stale === true ||
    typeof repository?.findCaptureHealthSnapshots !== 'function' ||
    typeof repository?.findCaptureHealthClosingMarkets !== 'function'
  ) {
    return buildUnavailableCaptureHealth(
      CAPTURE_HEALTH_REASONS.SCHEDULE_UNAVAILABLE,
      {
        observedAt,
        scheduleSource: scheduleState?.source ?? null,
        stale: scheduleState?.stale ?? null,
      },
    )
  }

  const scheduleGames = normalizeScheduleCohort(
    scheduleState.games,
    normalized,
  )
  const gameIds = [...new Set(scheduleGames.map(({ gameId }) => gameId))]
  let snapshots
  let closingMarkets

  try {
    ;[snapshots, closingMarkets] = await Promise.all([
      repository.findCaptureHealthSnapshots(gameIds, normalized.season.id),
      repository.findCaptureHealthClosingMarkets(gameIds, normalized.season.id),
    ])
  } catch {
    return buildUnavailableCaptureHealth(
      CAPTURE_HEALTH_REASONS.CAPTURE_DATA_UNAVAILABLE,
      {
        observedAt,
        scheduleSource: scheduleState.source ?? null,
        stale: false,
      },
    )
  }

  return calculateCaptureHealth({
    closingMarkets,
    normalized,
    observedAt,
    predictions,
    scheduleGames: scheduleState.games,
    scheduleSource: scheduleState.source ?? null,
    snapshots,
  })
}

const serializeCaptureHealth = (captureHealth) => {
  const { missingGames: _missingGames, ...publicHealth } =
    captureHealth ?? buildUnavailableCaptureHealth()

  return publicHealth
}

module.exports = {
  CAPTURE_HEALTH_FILTERS,
  CAPTURE_HEALTH_GAME_STATES,
  CAPTURE_HEALTH_OBSERVATION_STATES,
  CAPTURE_HEALTH_REASONS,
  CAPTURE_HEALTH_STATUSES,
  LEGACY_CAPTURE_HEALTH_STATUS_FILTERS,
  buildUnavailableCaptureHealth,
  calculateCaptureHealth,
  identityKey,
  hasUnsafeScheduleIdentity,
  isWindowFullyElapsed,
  loadCaptureHealth,
  normalizeScheduleCohort,
  scheduleQueryBounds,
  serializeCaptureHealth,
}
