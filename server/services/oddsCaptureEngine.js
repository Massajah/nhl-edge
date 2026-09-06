const nhlApiService = require('./nhlApiService')
const OddsSnapshot = require('../models/OddsSnapshot')
const {
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
} = require('./oddsSnapshotContracts')
const {
  MAX_PROVIDER_RESPONSE_AGE_MS,
  OddsCaptureInputError,
  buildCaptureProviderWindow,
  buildOddsCaptureRunIdentity,
  getCheckpointIdentity,
  getFinalSafeCutoff,
  isCheckpointWithinAcceptanceWindow,
  isProviderFreshForCheckpoint,
  validateCheckpointBatch,
} = require('./oddsCaptureContracts')
const { oddsCaptureRunService } = require('./oddsCaptureRunService')
const { oddsSnapshotRepository } = require('./oddsSnapshotRepository')
const { marketOddsService } = require('./marketOddsService')
const { oddsQuotaLedgerService } = require('./oddsQuotaLedgerService')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const {
  STRICT_MATCH_STATUSES,
  matchOddsEventsToNhlGames,
} = require('./strictMarketOddsMatcher')
const {
  CLOSING_OBSERVATION_TYPE,
  buildClosingWorkKey,
  isWithinClosingObservationWindow,
  normalizeSelectedBookmakerKeys,
} = require('./oddsClosingMarketContracts')
const {
  oddsClosingMarketRepository,
} = require('./oddsClosingMarketRepository')

const STARTED_GAME_STATES = new Set(['CRIT', 'FINAL', 'LIVE', 'OFF', 'POST'])
const supportedBookmakerKeys = new Set(OddsSnapshot.SUPPORTED_BOOKMAKER_KEYS)

const normalizeDate = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

const normalizeNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : null
}

const normalizeQuotaForRun = (quota) => {
  if (!quota || typeof quota !== 'object') {
    return null
  }

  const normalized = {
    lastCost: normalizeNonNegativeNumber(quota.lastCost),
    observedAt: normalizeDate(quota.observedAt),
    remaining: normalizeNonNegativeNumber(quota.remaining),
    used: normalizeNonNegativeNumber(quota.used),
  }

  return Object.values(normalized).some((value) => value !== null)
    ? normalized
    : null
}

const normalizeReasonCode = (value, fallback = '') => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)

  return normalized || fallback
}

const toCheckpointResult = (checkpoint, status, reason = '') => ({
  checkpointKey: checkpoint.checkpointKey,
  gameId: checkpoint.gameId,
  reason: normalizeReasonCode(reason),
  snapshotType: checkpoint.snapshotType,
  status,
})

const normalizeClosingGame = (work, index = 0) => {
  const scheduledStart = normalizeDate(work?.scheduledStart)
  const expectedKey = scheduledStart
    ? buildClosingWorkKey({ gameId: work?.gameId, scheduledStart })
    : ''

  if (
    !work ||
    typeof work !== 'object' ||
    Array.isArray(work) ||
    work.snapshotType !== CLOSING_OBSERVATION_TYPE ||
    work.checkpointKey !== expectedKey
  ) {
    throw new OddsCaptureInputError('Invalid closing observation work.', {
      code: 'invalid_closing_work',
      index,
    })
  }

  const legacyShape = {
    ...work,
    checkpointKey: `FINAL:${scheduledStart.getTime()}`,
    snapshotType: 'FINAL',
    targetAt: new Date(scheduledStart.getTime() - 10 * 60 * 1000),
  }
  const normalized = validateCheckpointBatch([legacyShape])[0]

  return {
    ...normalized,
    checkpointKey: expectedKey,
    snapshotType: CLOSING_OBSERVATION_TYPE,
  }
}

const getGameId = (game) => String(game?.gameId ?? game?.id ?? '').trim()

const getGameStart = (game) => normalizeDate(
  game?.startTimeUTC ?? game?.scheduledStart ?? game?.gameDate,
)

const getGameTeamIds = (game) => ({
  awayTeamId: getNhlTeamIdentity(
    game?.awayTeam?.abbreviation,
    game?.awayTeam?.abbrev,
    game?.awayTeam?.name,
  ),
  homeTeamId: getNhlTeamIdentity(
    game?.homeTeam?.abbreviation,
    game?.homeTeam?.abbrev,
    game?.homeTeam?.name,
  ),
})

const getGameBlockingReason = (game, referenceAt) => {
  const gameState = String(game?.gameState ?? '').trim().toUpperCase()
  const gameScheduleState = String(
    game?.gameScheduleState ?? '',
  ).trim().toUpperCase()
  const status = String(game?.status ?? '').trim().toLowerCase()

  if (
    gameScheduleState === 'PPD' ||
    gameState === 'PPD' ||
    status.includes('postpon')
  ) {
    return 'postponed'
  }

  if (
    STARTED_GAME_STATES.has(gameState) ||
    status.includes('live') ||
    status.includes('final') ||
    status.includes('progress')
  ) {
    return 'game_started'
  }

  const start = getGameStart(game)

  return start && start.getTime() <= referenceAt.getTime()
    ? 'game_started'
    : null
}

const validateAuthoritativeGame = (checkpoint, game, referenceAt) => {
  if (!game) {
    return 'schedule_game_missing'
  }

  const scheduledStart = getGameStart(game)

  if (!scheduledStart) {
    return 'invalid_schedule_time'
  }

  if (scheduledStart.getTime() !== checkpoint.scheduledStart.getTime()) {
    return 'rescheduled'
  }

  if (String(game?.season ?? '').trim() !== checkpoint.seasonId) {
    return 'schedule_season_mismatch'
  }

  if (Number(game?.gameType) !== checkpoint.gameType) {
    return 'schedule_game_type_mismatch'
  }

  const teams = getGameTeamIds(game)

  if (!teams.homeTeamId || !teams.awayTeamId) {
    return 'unknown_team'
  }

  if (
    teams.homeTeamId !== checkpoint.homeTeamId ||
    teams.awayTeamId !== checkpoint.awayTeamId
  ) {
    return 'schedule_team_mismatch'
  }

  return getGameBlockingReason(game, referenceAt)
}

const getUtcScheduleDates = (checkpoints) => {
  const dates = new Set()

  checkpoints.forEach(({ scheduledStart }) => {
    const startMs = scheduledStart.getTime()
    dates.add(new Date(startMs).toISOString().slice(0, 10))
    dates.add(new Date(startMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  })

  return [...dates].sort()
}

const loadScheduleGames = async (checkpoints) => {
  const schedules = await Promise.all(
    getUtcScheduleDates(checkpoints).map((date) =>
      nhlApiService.getGamesForDate(date),
    ),
  )
  const gamesById = new Map()

  schedules.forEach((schedule) => {
    ;(Array.isArray(schedule?.games) ? schedule.games : []).forEach((game) => {
      const gameId = getGameId(game)

      if (gameId && !gamesById.has(gameId)) {
        gamesById.set(gameId, game)
      }
    })
  })

  return { games: [...gamesById.values()] }
}

const recheckFinalGames = async (gameIds) => {
  const results = await Promise.allSettled(
    gameIds.map((gameId) => nhlApiService.getGameLanding(gameId)),
  )
  const games = []
  const failedGameIds = []

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      games.push(result.value)
    } else {
      failedGameIds.push(gameIds[index])
    }
  })

  return { failedGameIds, games }
}

const normalizeScheduleResult = (result) => {
  if (Array.isArray(result)) {
    return { failedGameIds: [], games: result }
  }

  return {
    failedGameIds: Array.isArray(result?.failedGameIds)
      ? result.failedGameIds.map(String)
      : [],
    games: Array.isArray(result?.games) ? result.games : [],
  }
}

const filterBookmakerRows = ({
  bookmakers,
  capturedAt,
  finalSafeCutoff,
  selectedBookmakerKeys,
  snapshotType,
}) => {
  const rows = Array.isArray(bookmakers) ? bookmakers : []
  const selected = new Set(
    normalizeSelectedBookmakerKeys(
      selectedBookmakerKeys ?? [...supportedBookmakerKeys],
    ),
  )
  const keyCounts = rows.reduce((counts, row) => {
    const key = String(row?.key ?? row?.bookmakerKey ?? '').trim()

    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    return counts
  }, new Map())
  const usable = []
  let rejectedCount = 0

  rows.forEach((row) => {
    const key = String(row?.key ?? row?.bookmakerKey ?? '').trim()
    const homeOdds = Number(row?.homeOdds)
    const awayOdds = Number(row?.awayOdds)

    if (
      !supportedBookmakerKeys.has(key) ||
      !selected.has(key) ||
      keyCounts.get(key) !== 1 ||
      !Number.isFinite(homeOdds) ||
      homeOdds <= 1 ||
      !Number.isFinite(awayOdds) ||
      awayOdds <= 1
    ) {
      rejectedCount += 1
      return
    }

    const rawLastUpdate = row?.lastUpdate
    let lastUpdate = null

    if (rawLastUpdate !== null && rawLastUpdate !== undefined && rawLastUpdate !== '') {
      lastUpdate = normalizeDate(rawLastUpdate)

      if (!lastUpdate) {
        rejectedCount += 1
        return
      }

      if (
        lastUpdate.getTime() > capturedAt.getTime() ||
        (snapshotType === 'FINAL' &&
          lastUpdate.getTime() > finalSafeCutoff.getTime())
      ) {
        rejectedCount += 1
        return
      }
    }

    usable.push({ awayOdds, homeOdds, key, lastUpdate })
  })

  return { bookmakers: usable, rejectedCount }
}

const buildSnapshotCandidate = ({ checkpoint, event, runId }) => {
  const capturedAt = normalizeDate(event?.providerFetchedAt)
  const providerCommenceTime = normalizeDate(event?.commenceTime)

  if (!capturedAt || !providerCommenceTime) {
    return { candidate: null, reason: 'invalid_provider_timestamp' }
  }

  const finalSafeCutoff = getFinalSafeCutoff(
    checkpoint.scheduledStart,
    providerCommenceTime,
  )

  if (
    checkpoint.snapshotType === 'FINAL' &&
    (capturedAt.getTime() <
      checkpoint.scheduledStart.getTime() - 30 * 60 * 1000 ||
      capturedAt.getTime() > finalSafeCutoff.getTime())
  ) {
    return { candidate: null, reason: 'final_leakage_cutoff' }
  }

  const filtered = filterBookmakerRows({
    bookmakers: event.bookmakers,
    capturedAt,
    finalSafeCutoff,
    selectedBookmakerKeys: checkpoint.selectedBookmakerKeys,
    snapshotType: checkpoint.snapshotType,
  })

  if (filtered.bookmakers.length === 0) {
    return {
      candidate: null,
      reason: 'no_usable_bookmakers',
      rejectedBookmakerRows: filtered.rejectedCount,
    }
  }

  return {
    candidate: {
      awayTeamId: checkpoint.awayTeamId,
      bookmakers: filtered.bookmakers,
      captureRunId: runId,
      capturedAt,
      checkpointKey: checkpoint.checkpointKey,
      gameId: checkpoint.gameId,
      gameType: checkpoint.gameType,
      homeTeamId: checkpoint.homeTeamId,
      market: ODDS_SNAPSHOT_MARKET,
      provider: ODDS_SNAPSHOT_PROVIDER,
      providerCommenceTime,
      providerEventId: event.providerEventId,
      scheduledStartAtCapture: checkpoint.scheduledStart,
      schemaVersion: checkpoint.snapshotType === 'FINAL' ? 1 : 2,
      ...(checkpoint.snapshotType === 'FINAL'
        ? {}
        : { selectedBookmakerKeys: checkpoint.selectedBookmakerKeys }),
      seasonId: checkpoint.seasonId,
      snapshotType: checkpoint.snapshotType,
      targetAt: checkpoint.targetAt,
    },
    reason: filtered.rejectedCount > 0 ? 'bookmaker_rows_filtered' : '',
    rejectedBookmakerRows: filtered.rejectedCount,
  }
}

const buildClosingObservationCandidate = ({ checkpoint, event }) => {
  const capturedAt = normalizeDate(event?.providerFetchedAt)
  const providerCommenceTime = normalizeDate(event?.commenceTime)

  if (!capturedAt || !providerCommenceTime) {
    return { candidate: null, reason: 'invalid_provider_timestamp' }
  }

  const finalSafeCutoff = getFinalSafeCutoff(
    checkpoint.scheduledStart,
    providerCommenceTime,
  )

  if (
    capturedAt.getTime() <
      checkpoint.scheduledStart.getTime() - 30 * 60 * 1000 ||
    capturedAt.getTime() > finalSafeCutoff.getTime()
  ) {
    return { candidate: null, reason: 'final_leakage_cutoff' }
  }

  const filtered = filterBookmakerRows({
    bookmakers: event.bookmakers,
    capturedAt,
    finalSafeCutoff,
    selectedBookmakerKeys: checkpoint.selectedBookmakerKeys,
    snapshotType: 'FINAL',
  })

  return {
    candidate: {
      awayTeamId: checkpoint.awayTeamId,
      bookmakers: filtered.bookmakers,
      capturedAt,
      gameId: checkpoint.gameId,
      gameType: checkpoint.gameType,
      homeTeamId: checkpoint.homeTeamId,
      providerCommenceTime,
      providerEventId: event.providerEventId,
      scheduledStartAtCapture: checkpoint.scheduledStart,
      seasonId: checkpoint.seasonId,
      selectedBookmakerKeys: checkpoint.selectedBookmakerKeys,
    },
    reason: filtered.rejectedCount > 0 ? 'bookmaker_rows_filtered' : '',
    rejectedBookmakerRows: filtered.rejectedCount,
  }
}

const buildReasonCounts = (checkpointResults, additional = {}) => {
  const counts = { ...additional }

  checkpointResults.forEach(({ reason }) => {
    if (reason) {
      counts[reason] = (counts[reason] ?? 0) + 1
    }
  })

  return counts
}

const defaultCanSpendCredit = ({ quotaBefore }) => ({
  allowed: quotaBefore?.remaining !== 0,
  reason: quotaBefore?.remaining === 0 ? 'quota_exhausted' : '',
})

const normalizeQuotaDecision = (decision) => {
  if (typeof decision === 'boolean') {
    return {
      allowed: decision,
      quota: null,
      reason: decision ? '' : 'quota_blocked',
      requestSource: 'AUTOMATIC',
    }
  }

  return {
    allowed: decision?.allowed !== false,
    quota: decision?.quota ?? null,
    reason: normalizeReasonCode(decision?.reason, 'quota_blocked'),
    requestSource: ['AUTOMATIC', 'CONTROLLED_PROBE'].includes(
      decision?.requestSource,
    )
      ? decision.requestSource
      : 'AUTOMATIC',
  }
}

const isDuplicateKeyError = (error) => Number(error?.code) === 11000

const createOddsCaptureEngine = ({
  canSpendCredit = defaultCanSpendCredit,
  captureRunService = oddsCaptureRunService,
  closingRepository = oddsClosingMarketRepository,
  fetchOdds = (request) => marketOddsService.getNhlOddsCaptureData(request),
  getProviderStatus = () => marketOddsService.getStatus(),
  loadSchedule = loadScheduleGames,
  matcher = matchOddsEventsToNhlGames,
  now = () => new Date(),
  recheckFinalSchedule = recheckFinalGames,
  snapshotRepository = oddsSnapshotRepository,
} = {}) => {
  const executeOddsCapture = async ({
    checkpoints = [],
    closingGames = [],
    intendedAt,
    triggerSource,
  } = {}) => {
    const startedAt = normalizeDate(now())

    if (!startedAt) {
      throw new TypeError('Capture engine clock returned an invalid date.')
    }

    let normalizedCheckpoints
    let normalizedClosingGames
    let validationError

    try {
      normalizedCheckpoints = validateCheckpointBatch(checkpoints)
      normalizedClosingGames = closingGames.map(normalizeClosingGame)
    } catch (error) {
      validationError = error
    }
    const normalizedWork =
      normalizedCheckpoints && normalizedClosingGames
        ? [...normalizedCheckpoints, ...normalizedClosingGames]
        : null

    const identity = buildOddsCaptureRunIdentity({
      checkpoints: normalizedWork ?? [...checkpoints, ...closingGames],
      intendedAt: intendedAt ?? startedAt,
      triggerSource,
    })
    let startedRun

    try {
      startedRun = await captureRunService.startRun({
        ...identity,
        startedAt,
      })
    } catch (error) {
      if (!isDuplicateKeyError(error) || !captureRunService.getRunByKey) {
        throw error
      }

      const existingRun = await captureRunService.getRunByKey(identity.runKey)

      if (!existingRun) {
        throw error
      }

      const existingResults = Array.isArray(existingRun.checkpointResults)
        ? existingRun.checkpointResults
        : []

      return {
        actualCreditCost: 0,
        checkpointResults: existingResults,
        existingCount: existingResults.filter(({ status }) =>
          ['EXISTING', 'STORED'].includes(status),
        ).length,
        insertedCount: 0,
        providerRequestCount: 0,
        reusedRun: true,
        runId: existingRun.runId,
        runKey: existingRun.runKey,
        status: existingRun.status,
      }
    }

    const resultsByIdentity = new Map()
    const additionalReasonCounts = {}
    let providerRequestCount = 0
    let actualCreditCost = 0
    let quotaBefore = null
    let quotaAfter = null
    let eventsReceived = 0
    let gamesMatched = 0
    let insertedCount = 0
    let existingCount = 0
    let providerStageStarted = false
    let forcePartial = false

    const complete = async (status, extraReasonCounts = {}) => {
      const checkpointResults = normalizedWork
        ? normalizedWork
            .map((checkpoint) => resultsByIdentity.get(getCheckpointIdentity(checkpoint)))
            .filter(Boolean)
        : []
      const reasonCounts = buildReasonCounts(checkpointResults, {
        ...additionalReasonCounts,
        ...extraReasonCounts,
      })
      const gamesSkipped = checkpointResults.filter(({ status: resultStatus }) =>
        ['BLOCKED', 'FAILED', 'SKIPPED'].includes(resultStatus),
      ).length
      const completedRun = await captureRunService.completeRun(
        identity.runKey,
        {
          actualCreditCost,
          checkpointResults,
          eventsReceived,
          gamesConsidered: normalizedWork?.length ?? 0,
          gamesMatched,
          gamesSkipped,
          providerRequestCount,
          quotaAfter,
          quotaBefore,
          reasonCounts,
          snapshotsStored: insertedCount,
          status,
        },
      )

      return {
        actualCreditCost,
        checkpointResults,
        completedAt: completedRun.completedAt,
        existingCount,
        insertedCount,
        providerRequestCount,
        reasonCounts,
        reusedRun: false,
        runId: startedRun.runId,
        runKey: startedRun.runKey,
        status,
      }
    }

    if (validationError) {
      const validationReasonCounts = (
        validationError.details?.errors ?? [validationError.details]
      )
        .filter(Boolean)
        .reduce((counts, detail) => {
          const code = detail.code ?? 'invalid_checkpoint'
          counts[code] = (counts[code] ?? 0) + 1
          return counts
        }, {})

      return complete('FAILED', validationReasonCounts)
    }

    if (normalizedWork.length === 0) {
      return complete('COMPLETED')
    }

    let persistedIdentities

    try {
      persistedIdentities = await snapshotRepository.findExistingCheckpoints(
        normalizedCheckpoints,
      )
    } catch {
      return complete('FAILED', { persistence_read_failed: 1 })
    }

    const notPersisted = normalizedCheckpoints.filter((checkpoint) => {
      const identityKey = getCheckpointIdentity(checkpoint)

      if (!persistedIdentities.has(identityKey)) {
        return true
      }

      existingCount += 1
      resultsByIdentity.set(
        identityKey,
        toCheckpointResult(checkpoint, 'EXISTING'),
      )
      return false
    })
    notPersisted.push(...normalizedClosingGames)
    const withinWindow = notPersisted.filter((checkpoint) => {
      const within =
        checkpoint.snapshotType === CLOSING_OBSERVATION_TYPE
          ? isWithinClosingObservationWindow(checkpoint.scheduledStart, startedAt)
          : isCheckpointWithinAcceptanceWindow(checkpoint, startedAt)

      if (within) {
        return true
      }

      resultsByIdentity.set(
        getCheckpointIdentity(checkpoint),
        toCheckpointResult(checkpoint, 'SKIPPED', 'outside_acceptance_window'),
      )
      return false
    })

    if (withinWindow.length === 0) {
      return complete('COMPLETED')
    }

    let scheduleResult

    try {
      scheduleResult = normalizeScheduleResult(await loadSchedule(withinWindow))
    } catch {
      withinWindow.forEach((checkpoint) => {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'FAILED', 'schedule_unavailable'),
        )
      })
      return complete('FAILED')
    }

    const scheduleById = new Map(
      scheduleResult.games.map((game) => [getGameId(game), game]),
    )
    const eligible = withinWindow.filter((checkpoint) => {
      const reason = validateAuthoritativeGame(
        checkpoint,
        scheduleById.get(checkpoint.gameId),
        startedAt,
      )

      if (!reason) {
        return true
      }

      resultsByIdentity.set(
        getCheckpointIdentity(checkpoint),
        toCheckpointResult(checkpoint, 'SKIPPED', reason),
      )
      return false
    })

    if (eligible.length === 0) {
      return complete('COMPLETED')
    }

    try {
      quotaBefore = normalizeQuotaForRun(getProviderStatus()?.quota)
    } catch {
      quotaBefore = null
    }

    const quotaDecision = normalizeQuotaDecision(
      await canSpendCredit({
        checkpoints: eligible,
        expectedCreditCost: 1,
        quotaBefore,
      }),
    )
    quotaBefore =
      normalizeQuotaForRun(quotaDecision.quota) ?? quotaBefore

    if (!quotaDecision.allowed) {
      eligible.forEach((checkpoint) => {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'BLOCKED', quotaDecision.reason),
        )
      })
      return complete('QUOTA_BLOCKED')
    }

    providerStageStarted = true
    const maximumProviderAgeMs = Math.min(
      ...eligible.map(
        ({ snapshotType }) => MAX_PROVIDER_RESPONSE_AGE_MS[snapshotType],
      ),
    )
    let providerData

    try {
      const bookmakerKeys = normalizeSelectedBookmakerKeys(
        eligible.flatMap(({ selectedBookmakerKeys = [] }) =>
          selectedBookmakerKeys,
        ),
      )
      providerData = await fetchOdds({
        ...buildCaptureProviderWindow(eligible),
        bookmakerKeys,
        maximumProviderAgeMs,
        requestSource: quotaDecision.requestSource,
      })
    } catch {
      eligible.forEach((checkpoint) => {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'FAILED', 'provider_unavailable'),
        )
      })
      return complete('FAILED')
    }

    providerRequestCount = providerData.requestAttempted ? 1 : 0
    quotaAfter = normalizeQuotaForRun(providerData.quota)
    actualCreditCost = providerData.requestAttempted
      ? normalizeQuotaForRun(providerData.requestQuota)?.lastCost ?? null
      : 0
    const providerEvents = Array.isArray(providerData.events)
      ? providerData.events
      : []
    eventsReceived = providerEvents.length
    const capturedAt = normalizeDate(providerData.providerFetchedAt)
    const providerFailureReason =
      providerData.status === 'no_events'
        ? 'provider_no_events'
        : `provider_${String(providerData.status ?? 'unavailable')}`
    const usableCacheFallback =
      providerData.source === 'cache' &&
      providerData.hasUsableData &&
      providerEvents.length > 0 &&
      capturedAt
    const closingMarketUnavailableResponse =
      eligible.some(
        ({ snapshotType }) => snapshotType === CLOSING_OBSERVATION_TYPE,
      ) &&
      providerData.status === 'no_events' &&
      providerEvents.length > 0 &&
      capturedAt
    const providerReady =
      ['cached', 'ready'].includes(providerData.status) ||
      closingMarketUnavailableResponse ||
      usableCacheFallback ||
      (providerData.source === 'provider' &&
        providerData.status === 'quota_exhausted' &&
        providerData.hasUsableData &&
        providerEvents.length > 0 &&
        capturedAt)

    if (!providerReady || providerEvents.length === 0 || !capturedAt) {
      eligible.forEach((checkpoint) => {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'FAILED', providerFailureReason),
        )
      })

      return complete(
        providerData.status === 'quota_exhausted'
          ? 'QUOTA_BLOCKED'
          : 'FAILED',
      )
    }

    if (
      providerData.source === 'cache' &&
      !['cached', 'ready'].includes(providerData.status)
    ) {
      forcePartial = true
      additionalReasonCounts.provider_cache_fallback = 1
    }

    const providerReferenceAt = normalizeDate(now()) ?? startedAt
    const freshCheckpoints = eligible.filter((checkpoint) => {
      const capturedWithinWindow =
        checkpoint.snapshotType === CLOSING_OBSERVATION_TYPE
          ? isWithinClosingObservationWindow(checkpoint.scheduledStart, capturedAt)
          : isCheckpointWithinAcceptanceWindow(checkpoint, capturedAt)

      if (!capturedWithinWindow) {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(
            checkpoint,
            'SKIPPED',
            'outside_acceptance_window',
          ),
        )
        return false
      }

      if (
        !isProviderFreshForCheckpoint(
          checkpoint,
          capturedAt,
          providerReferenceAt,
        )
      ) {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'SKIPPED', 'stale_provider_response'),
        )
        return false
      }

      return true
    })

    if (freshCheckpoints.length === 0) {
      return complete('FAILED')
    }

    const gamesForMatching = [
      ...new Map(
        freshCheckpoints.map((checkpoint) => [
          checkpoint.gameId,
          scheduleById.get(checkpoint.gameId),
        ]),
      ).values(),
    ]
    const matchResult = matcher({
      events: providerEvents,
      games: gamesForMatching,
    })
    const gameResultsById = new Map(
      matchResult.gameResults.map((result) => [result.gameId, result]),
    )
    const matchesByGameId = new Map(
      matchResult.matches.map((match) => [match.gameId, match]),
    )
    const matchedCheckpoints = freshCheckpoints.filter((checkpoint) => {
      const gameResult = gameResultsById.get(checkpoint.gameId)

      if (gameResult?.status === STRICT_MATCH_STATUSES.MATCHED) {
        return true
      }

      const reason = String(
        gameResult?.status ?? STRICT_MATCH_STATUSES.NO_MATCH,
      ).toLowerCase()
      resultsByIdentity.set(
        getCheckpointIdentity(checkpoint),
        toCheckpointResult(checkpoint, 'SKIPPED', reason),
      )
      return false
    })
    gamesMatched = new Set(
      matchedCheckpoints.map(({ gameId }) => gameId),
    ).size

    const finalGameIds = [
      ...new Set(
        matchedCheckpoints
          .filter(({ snapshotType }) =>
            ['FINAL', CLOSING_OBSERVATION_TYPE].includes(snapshotType),
          )
          .map(({ gameId }) => gameId),
      ),
    ]
    let recheckedById = new Map()
    let failedRecheckIds = new Set()

    if (finalGameIds.length > 0) {
      try {
        const recheck = normalizeScheduleResult(
          await recheckFinalSchedule(finalGameIds),
        )
        recheckedById = new Map(
          recheck.games.map((game) => [getGameId(game), game]),
        )
        failedRecheckIds = new Set(recheck.failedGameIds)
      } catch {
        failedRecheckIds = new Set(finalGameIds)
      }
    }

    const postChecked = matchedCheckpoints.filter((checkpoint) => {
      if (
        !['FINAL', CLOSING_OBSERVATION_TYPE].includes(
          checkpoint.snapshotType,
        )
      ) {
        return true
      }

      if (failedRecheckIds.has(checkpoint.gameId)) {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(
            checkpoint,
            'SKIPPED',
            'schedule_recheck_failed',
          ),
        )
        return false
      }

      const recheckedGame = recheckedById.get(checkpoint.gameId)
      const postFetchNow = normalizeDate(now()) ?? startedAt
      const reason = validateAuthoritativeGame(
        checkpoint,
        recheckedGame,
        postFetchNow,
      )

      if (!reason) {
        return true
      }

      resultsByIdentity.set(
        getCheckpointIdentity(checkpoint),
        toCheckpointResult(checkpoint, 'SKIPPED', reason),
      )
      return false
    })
    const candidates = []
    const closingCandidates = []
    const checkpointByCandidateIdentity = new Map()

    postChecked.forEach((checkpoint) => {
      const match = matchesByGameId.get(checkpoint.gameId)
      const event = {
        ...match.event,
        providerFetchedAt: providerData.providerFetchedAt,
      }
      const transformed =
        checkpoint.snapshotType === CLOSING_OBSERVATION_TYPE
          ? buildClosingObservationCandidate({ checkpoint, event })
          : buildSnapshotCandidate({
              checkpoint,
              event,
              runId: startedRun.runId,
            })

      if (!transformed.candidate) {
        resultsByIdentity.set(
          getCheckpointIdentity(checkpoint),
          toCheckpointResult(checkpoint, 'SKIPPED', transformed.reason),
        )
        return
      }

      const identityKey = getCheckpointIdentity(checkpoint)

      if (checkpoint.snapshotType === CLOSING_OBSERVATION_TYPE) {
        closingCandidates.push({
          candidate: transformed.candidate,
          checkpoint,
          identityKey,
          reason: transformed.reason,
        })
      } else {
        candidates.push(transformed.candidate)
        checkpointByCandidateIdentity.set(identityKey, {
          checkpoint,
          reason: transformed.reason,
        })
      }
    })

    if (candidates.length > 0) {
      try {
        const writeResult = await snapshotRepository.insertSnapshots(
          candidates,
          { includeOutcomes: true },
        )
        insertedCount = writeResult.insertedCount
        existingCount += writeResult.existingCount

        writeResult.outcomes.forEach((outcome) => {
          const source = checkpointByCandidateIdentity.get(outcome.identity)

          if (!source) {
            return
          }

          resultsByIdentity.set(
            outcome.identity,
            toCheckpointResult(
              source.checkpoint,
              outcome.status === 'INSERTED' ? 'STORED' : 'EXISTING',
              source.reason,
            ),
          )
        })
      } catch (error) {
        insertedCount = error.snapshotWriteSummary?.insertedCount ?? 0
        existingCount += error.snapshotWriteSummary?.existingCount ?? 0
        const partialOutcomes = new Map(
          (error.snapshotWriteSummary?.outcomes ?? []).map((outcome) => [
            outcome.identity,
            outcome.status,
          ]),
        )
        candidates.forEach((candidate) => {
          const identityKey = getCheckpointIdentity(candidate)
          const source = checkpointByCandidateIdentity.get(identityKey)
          const inserted = partialOutcomes.get(identityKey) === 'INSERTED'

          resultsByIdentity.set(
            identityKey,
            toCheckpointResult(
              source.checkpoint,
              inserted ? 'STORED' : 'FAILED',
              inserted ? source.reason : 'persistence_failed',
            ),
          )
        })
        return complete(insertedCount > 0 ? 'PARTIAL' : 'FAILED')
      }
    }

    for (const closing of closingCandidates) {
      try {
        const outcome = await closingRepository.recordObservation(
          closing.candidate,
        )
        const stored = outcome.observationStored

        if (stored) insertedCount += 1
        else existingCount += 1
        resultsByIdentity.set(
          closing.identityKey,
          toCheckpointResult(
            closing.checkpoint,
            stored ? 'STORED' : 'EXISTING',
            closing.reason,
          ),
        )
      } catch {
        resultsByIdentity.set(
          closing.identityKey,
          toCheckpointResult(
            closing.checkpoint,
            'FAILED',
            'closing_persistence_failed',
          ),
        )
      }
    }

    const checkpointResults = normalizedWork
      .map((checkpoint) => resultsByIdentity.get(getCheckpointIdentity(checkpoint)))
      .filter(Boolean)
    const satisfiedCount = checkpointResults.filter(({ status }) =>
      ['EXISTING', 'STORED'].includes(status),
    ).length
    const unsuccessfulCount = checkpointResults.length - satisfiedCount
    const status = forcePartial
      ? 'PARTIAL'
      : unsuccessfulCount === 0
        ? 'COMPLETED'
        : satisfiedCount > 0
          ? 'PARTIAL'
          : providerStageStarted
            ? 'FAILED'
            : 'COMPLETED'

    return complete(status)
  }

  const finalizeClosingMarkets = async ({
    games = [],
    observedAt = now(),
    selectedBookmakerKeys = [],
  } = {}) => {
    const finalizedAt = normalizeDate(observedAt)

    if (!finalizedAt) {
      throw new TypeError('Closing finalization clock returned an invalid date.')
    }

    const results = []

    for (const game of games) {
      try {
        const result = await closingRepository.finalizeClosingMarket({
          gameId: game.gameId,
          observedAt: finalizedAt,
          reason:
            game.finalizationReason === 'GAME_STARTED'
              ? 'GAME_STARTED'
              : 'CLOSING_WINDOW_ENDED',
          scheduledStart: game.scheduledStart,
          selectedBookmakerKeys,
        })
        results.push({ gameId: game.gameId, status: result.status })
      } catch {
        results.push({ gameId: game.gameId, status: 'FAILED' })
      }
    }

    return {
      failedCount: results.filter(({ status }) => status === 'FAILED').length,
      finalizedCount: results.filter(({ status }) => status === 'FINALIZED')
        .length,
      results,
    }
  }

  return { executeOddsCapture, finalizeClosingMarkets }
}

const oddsCaptureEngine = createOddsCaptureEngine({
  canSpendCredit: (request) =>
    oddsQuotaLedgerService.getAutomaticPolicy(request),
})

module.exports = {
  STARTED_GAME_STATES,
  buildClosingObservationCandidate,
  buildSnapshotCandidate,
  createOddsCaptureEngine,
  defaultCanSpendCredit,
  filterBookmakerRows,
  getGameBlockingReason,
  loadScheduleGames,
  normalizeQuotaForRun,
  oddsCaptureEngine,
  recheckFinalGames,
  validateAuthoritativeGame,
}
