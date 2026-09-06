const nhlApiService = require('./nhlApiService')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  MAX_CAPTURE_CHECKPOINTS,
  getCheckpointIdentity,
  isCheckpointWithinAcceptanceWindow,
} = require('./oddsCaptureContracts')
const { getGameBlockingReason } = require('./oddsCaptureEngine')
const {
  ODDS_SNAPSHOT_PROVIDER,
  createOddsCheckpoint,
} = require('./oddsSnapshotContracts')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const {
  AUTOMATIC_DAILY_SUCCESS_LIMIT,
  AUTOMATIC_POLICY_MODES,
  oddsQuotaLedgerService,
} = require('./oddsQuotaLedgerService')
const { oddsSnapshotRepository } = require('./oddsSnapshotRepository')
const {
  CLOSING_FINALIZATION_GRACE_MS,
  CLOSING_OBSERVATION_TYPE,
  CLOSING_WINDOW_MINIMUM_BEFORE_START_MS,
  buildClosingWorkKey,
  isWithinClosingObservationWindow,
} = require('./oddsClosingMarketContracts')
const {
  oddsCaptureBookmakerSelectionService,
} = require('./oddsCaptureBookmakerSelectionService')

const DAY_MS = 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const PROVIDER_WINDOW_PADDING_MS = 60 * 60 * 1000
const SCHEDULE_DATE_OFFSETS = Object.freeze([-1, 0, 1, 2])
const PLANNABLE_GAME_STATES = new Set(['FUT', 'PRE'])
const LONG_TERM_SNAPSHOT_TYPES = Object.freeze(['T24', 'T6', 'T2'])
const LONG_TERM_RETRY_INTERVALS_MS = Object.freeze({
  T24: 30 * 60 * 1000,
  T6: 15 * 60 * 1000,
  T2: 15 * 60 * 1000,
})
const CHECKPOINT_PRIORITY = Object.freeze({
  CLOSING: 0,
  FINAL: 0,
  T2: 1,
  T6: 2,
  T24: 3,
})

const normalizeDate = (value, field) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const formatUtcDate = (date) => normalizeDate(date, 'date').toISOString().slice(0, 10)

const getPlanningScheduleDates = (observedAt) => {
  const current = normalizeDate(observedAt, 'observedAt')
  const utcDay = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
    ),
  )

  return SCHEDULE_DATE_OFFSETS.map((offset) =>
    formatUtcDate(new Date(utcDay.getTime() + offset * DAY_MS)),
  )
}

const getGameId = (game) => String(game?.gameId ?? game?.id ?? '').trim()

const addReason = (counts, reason, amount = 1) => {
  if (amount > 0) {
    counts[reason] = (counts[reason] ?? 0) + amount
  }
}

const normalizePlanningGame = (
  game,
  observedAt,
  { allowStarted = false } = {},
) => {
  const gameId = getGameId(game)
  const seasonId = String(game?.season ?? '').trim()
  const gameType = Number(game?.gameType)
  const scheduledStart = new Date(game?.startTimeUTC)
  const homeTeamId = getNhlTeamIdentity(
    game?.homeTeam?.abbreviation,
    game?.homeTeam?.abbrev,
    game?.homeTeam?.name,
  )
  const awayTeamId = getNhlTeamIdentity(
    game?.awayTeam?.abbreviation,
    game?.awayTeam?.abbrev,
    game?.awayTeam?.name,
  )

  if (!/^\d{10}$/.test(gameId)) {
    return { reason: 'invalid_game_id' }
  }

  if (!/^\d{8}$/.test(seasonId)) {
    return { reason: 'invalid_season_id' }
  }

  if (!Number.isInteger(gameType) || gameType <= 0) {
    return { reason: 'invalid_game_type' }
  }

  if (!Number.isFinite(scheduledStart.getTime())) {
    return { reason: 'invalid_schedule_time' }
  }

  if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
    return { reason: 'unknown_team' }
  }

  const blockingReason = getGameBlockingReason(game, observedAt)

  if (blockingReason && !(allowStarted && blockingReason === 'game_started')) {
    return { reason: blockingReason }
  }

  const gameState = String(game?.gameState ?? '').toUpperCase()

  if (
    !PLANNABLE_GAME_STATES.has(gameState) &&
    !(allowStarted && blockingReason === 'game_started')
  ) {
    return { reason: 'invalid_game_state' }
  }

  return {
    game: {
      awayTeamId,
      gameId,
      gameType,
      homeTeamId,
      scheduledStart,
      seasonId,
      started: blockingReason === 'game_started',
    },
    reason: '',
  }
}

const compareCheckpoints = (left, right) =>
  CHECKPOINT_PRIORITY[left.snapshotType] -
    CHECKPOINT_PRIORITY[right.snapshotType] ||
  left.scheduledStart.getTime() - right.scheduledStart.getTime() ||
  left.gameId.localeCompare(right.gameId)

const isLongTermRetryTick = (checkpoint, observedAt) => {
  const intervalMs = LONG_TERM_RETRY_INTERVALS_MS[checkpoint.snapshotType]

  if (!intervalMs) return false

  const current = normalizeDate(observedAt, 'observedAt')
  const firstCronSlot =
    Math.ceil(checkpoint.targetAt.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS
  const currentCronSlot =
    Math.floor(current.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS

  return (
    currentCronSlot >= firstCronSlot &&
    (currentCronSlot - firstCronSlot) % intervalMs === 0
  )
}

const buildDueCheckpoints = (games, observedAt, selectedBookmakerKeys = []) => {
  const current = normalizeDate(observedAt, 'observedAt')
  const reasonCounts = {}
  const checkpoints = []

  games.forEach((game) => {
    const normalized = normalizePlanningGame(game, current)

    if (!normalized.game) {
      addReason(reasonCounts, normalized.reason)
      return
    }

    LONG_TERM_SNAPSHOT_TYPES.forEach((snapshotType) => {
      const checkpoint = {
        ...normalized.game,
        provider: ODDS_SNAPSHOT_PROVIDER,
        snapshotType,
        selectedBookmakerKeys,
        ...createOddsCheckpoint({
          scheduledStart: normalized.game.scheduledStart,
          snapshotType,
        }),
      }

      if (
        isCheckpointWithinAcceptanceWindow(checkpoint, current) &&
        isLongTermRetryTick(checkpoint, current)
      ) {
        checkpoints.push(checkpoint)
      }
    })
  })

  return { checkpoints: checkpoints.sort(compareCheckpoints), reasonCounts }
}

const buildClosingWork = (games, observedAt, selectedBookmakerKeys = []) => {
  const current = normalizeDate(observedAt, 'observedAt')
  const work = []
  const reasonCounts = {}

  games.forEach((game) => {
    const normalized = normalizePlanningGame(game, current)

    if (!normalized.game) return
    if (
      !isWithinClosingObservationWindow(
        normalized.game.scheduledStart,
        current,
      )
    ) {
      return
    }

    work.push({
      ...normalized.game,
      checkpointKey: buildClosingWorkKey({
        gameId: normalized.game.gameId,
        scheduledStart: normalized.game.scheduledStart,
      }),
      provider: ODDS_SNAPSHOT_PROVIDER,
      selectedBookmakerKeys,
      snapshotType: CLOSING_OBSERVATION_TYPE,
      targetAt: new Date(
        normalized.game.scheduledStart.getTime() - 10 * 60 * 1000,
      ),
    })
  })

  return { checkpoints: work.sort(compareCheckpoints), reasonCounts }
}

const buildFinalizationGames = (games, observedAt) => {
  const current = normalizeDate(observedAt, 'observedAt')

  return games
    .map((game) => normalizePlanningGame(game, current, { allowStarted: true }))
    .filter(({ game }) => game)
    .map(({ game }) => ({
      ...game,
      finalizationReason: game.started ? 'GAME_STARTED' : 'CLOSING_WINDOW_ENDED',
    }))
    .filter((game) => {
      const beforeStartMs = game.scheduledStart.getTime() - current.getTime()

      return (
        beforeStartMs >= -CLOSING_FINALIZATION_GRACE_MS &&
        (game.started ||
          beforeStartMs <= CLOSING_WINDOW_MINIMUM_BEFORE_START_MS)
      )
    })
}

const uniqueScheduleGames = (scheduleResults) => {
  const gamesById = new Map()

  scheduleResults.forEach((schedule) => {
    ;(Array.isArray(schedule?.games) ? schedule.games : []).forEach((game) => {
      const gameId = getGameId(game)

      if (gameId && !gamesById.has(gameId)) {
        gamesById.set(gameId, game)
      }
    })
  })

  return [...gamesById.values()]
}

const groupDueCheckpoints = (checkpoints) => {
  const remaining = [...checkpoints].sort(compareCheckpoints)
  const groups = []

  const isClosingPriority = ({ snapshotType }) =>
    ['CLOSING', 'FINAL'].includes(snapshotType)

  while (remaining.some(isClosingPriority)) {
    const finalCluster = remaining.filter(
      isClosingPriority,
    )
    const clusterStarts = finalCluster.map(({ scheduledStart }) =>
      scheduledStart.getTime(),
    )
    const providerFrom = Math.min(...clusterStarts) - PROVIDER_WINDOW_PADDING_MS
    const providerTo = Math.max(...clusterStarts) + PROVIDER_WINDOW_PADDING_MS
    const group = remaining.filter((checkpoint) => {
      const start = checkpoint.scheduledStart.getTime()

      return (
        finalCluster.includes(checkpoint) ||
        (!isClosingPriority(checkpoint) &&
          start >= providerFrom &&
          start <= providerTo)
      )
    })
    const identities = new Set(group.map(getCheckpointIdentity))

    groups.push(group.sort(compareCheckpoints))
    remaining.splice(
      0,
      remaining.length,
      ...remaining.filter(
        (checkpoint) => !identities.has(getCheckpointIdentity(checkpoint)),
      ),
    )
  }

  for (let index = 0; index < remaining.length; index += MAX_CAPTURE_CHECKPOINTS) {
    groups.push(
      remaining
        .slice(index, index + MAX_CAPTURE_CHECKPOINTS)
        .sort(compareCheckpoints),
    )
  }

  return groups
}

const createOddsCheckpointPlanner = ({
  getAutomaticPolicy = (request) =>
    oddsQuotaLedgerService.getAutomaticPolicy(request),
  getGamesForDate = nhlApiService.getGamesForDate,
  getSelectedBookmakerKeys = async () =>
    REQUESTED_BOOKMAKERS.map(({ key }) => key),
  snapshotRepository = oddsSnapshotRepository,
} = {}) => {
  const planDueCheckpoints = async ({ observedAt = new Date() } = {}) => {
    const current = normalizeDate(observedAt, 'observedAt')
    const policy = await getAutomaticPolicy({ observedAt: current })
    const reasonCounts = {}

    const scheduleDates = getPlanningScheduleDates(current)
    const settledSchedules = await Promise.allSettled(
      scheduleDates.map((date) => getGamesForDate(date)),
    )
    const schedules = settledSchedules
      .filter(({ status }) => status === 'fulfilled')
      .map(({ value }) => value)
    const scheduleFailureCount = settledSchedules.length - schedules.length

    if (schedules.length === 0) {
      addReason(reasonCounts, 'schedule_unavailable')
      return {
        dueCheckpointCount: 0,
        groups: [],
        policy,
        reasonCounts,
        scheduleDates,
        scheduleFailureCount,
        status: 'SCHEDULE_UNAVAILABLE',
      }
    }

    const games = uniqueScheduleGames(schedules)
    const selectedBookmakerKeys = await getSelectedBookmakerKeys()
    const due = buildDueCheckpoints(games, current, selectedBookmakerKeys)
    const closing = buildClosingWork(games, current, selectedBookmakerKeys)
    const finalizations = buildFinalizationGames(games, current)

    Object.entries(due.reasonCounts).forEach(([reason, count]) =>
      addReason(reasonCounts, reason, count),
    )

    if (due.checkpoints.length === 0 && closing.checkpoints.length === 0) {
      addReason(reasonCounts, games.length === 0 ? 'no_games' : 'no_due_checkpoints')
      if (!policy.allowed) {
        addReason(reasonCounts, policy.reason || 'quota_blocked')
      }
      return {
        dueCheckpointCount: 0,
        groups: [],
        finalizations,
        policy,
        reasonCounts,
        scheduleDates,
        selectedBookmakerKeys,
        scheduleFailureCount,
        status:
          finalizations.length > 0
            ? 'FINALIZE_ONLY'
            : policy.allowed
              ? 'NO_DUE_WORK'
              : 'BLOCKED',
      }
    }

    const existing = await snapshotRepository.findExistingCheckpoints(
      due.checkpoints,
    )
    let pending = due.checkpoints.filter((checkpoint) => {
      const persisted = existing.has(getCheckpointIdentity(checkpoint))

      if (persisted) {
        addReason(reasonCounts, 'already_persisted')
      }

      return !persisted
    })
    pending.push(...closing.checkpoints)

    if (policy.mode === AUTOMATIC_POLICY_MODES.FINAL_ONLY) {
      const before = pending.length
      pending = pending.filter(({ snapshotType }) =>
        ['CLOSING', 'FINAL'].includes(snapshotType),
      )
      addReason(reasonCounts, 'policy_intermediate_suppressed', before - pending.length)
    }

    if (!policy.allowed && policy.mode === AUTOMATIC_POLICY_MODES.DISABLED) {
      addReason(reasonCounts, policy.reason || 'quota_blocked')
      pending = []
    }

    let groups = groupDueCheckpoints(pending)
    const dailyBudget = Math.max(
      0,
      AUTOMATIC_DAILY_SUCCESS_LIMIT -
        (Number(policy.dailyAutomaticSuccessfulRequestCount) || 0),
    )
    const requestBudget =
      policy.mode === AUTOMATIC_POLICY_MODES.CONTROLLED_PROBE
        ? Math.min(1, dailyBudget)
        : policy.mode === AUTOMATIC_POLICY_MODES.FINAL_ONLY
          ? groups.length
          : dailyBudget

    if (groups.length > requestBudget) {
      addReason(
        reasonCounts,
        'deferred_by_request_budget',
        groups.slice(requestBudget).reduce((count, group) => count + group.length, 0),
      )
      groups = groups.slice(0, requestBudget)
    }

    if (groups.length === 0) {
      addReason(reasonCounts, policy.reason || 'no_permitted_due_checkpoints')
    }

    return {
      dueCheckpointCount: groups.reduce(
        (count, group) => count + group.length,
        0,
      ),
      groups,
      finalizations,
      policy,
      reasonCounts,
      scheduleDates,
      scheduleFailureCount,
      selectedBookmakerKeys,
      status:
        groups.length > 0
          ? 'READY'
          : finalizations.length > 0
            ? 'FINALIZE_ONLY'
            : policy.allowed
              ? 'NO_DUE_WORK'
              : 'BLOCKED',
    }
  }

  return { planDueCheckpoints }
}

const oddsCheckpointPlanner = createOddsCheckpointPlanner({
  getSelectedBookmakerKeys: () =>
    oddsCaptureBookmakerSelectionService.getSelectedBookmakerKeys(),
})

module.exports = {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  CHECKPOINT_PRIORITY,
  LONG_TERM_SNAPSHOT_TYPES,
  LONG_TERM_RETRY_INTERVALS_MS,
  PLANNABLE_GAME_STATES,
  SCHEDULE_DATE_OFFSETS,
  buildClosingWork,
  buildDueCheckpoints,
  buildFinalizationGames,
  compareCheckpoints,
  createOddsCheckpointPlanner,
  getPlanningScheduleDates,
  groupDueCheckpoints,
  isLongTermRetryTick,
  normalizePlanningGame,
  oddsCheckpointPlanner,
}
