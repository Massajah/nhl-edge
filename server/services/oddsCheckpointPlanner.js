const nhlApiService = require('./nhlApiService')
const {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  MAX_CAPTURE_CHECKPOINTS,
  getCheckpointIdentity,
  isCheckpointWithinAcceptanceWindow,
} = require('./oddsCaptureContracts')
const { getGameBlockingReason } = require('./oddsCaptureEngine')
const {
  ODDS_SNAPSHOT_PROVIDER,
  ODDS_SNAPSHOT_TYPE_VALUES,
  createOddsCheckpoint,
} = require('./oddsSnapshotContracts')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const {
  AUTOMATIC_DAILY_SUCCESS_LIMIT,
  AUTOMATIC_POLICY_MODES,
  oddsQuotaLedgerService,
} = require('./oddsQuotaLedgerService')
const { oddsSnapshotRepository } = require('./oddsSnapshotRepository')

const DAY_MS = 24 * 60 * 60 * 1000
const FINAL_GROUP_WINDOW_MS = 15 * 60 * 1000
const PROVIDER_WINDOW_PADDING_MS = 60 * 60 * 1000
const SCHEDULE_DATE_OFFSETS = Object.freeze([-1, 0, 1, 2])
const PLANNABLE_GAME_STATES = new Set(['FUT', 'PRE'])
const CHECKPOINT_PRIORITY = Object.freeze({
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

const normalizePlanningGame = (game, observedAt) => {
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

  if (blockingReason) {
    return { reason: blockingReason }
  }

  if (!PLANNABLE_GAME_STATES.has(String(game?.gameState ?? '').toUpperCase())) {
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
    },
    reason: '',
  }
}

const compareCheckpoints = (left, right) =>
  CHECKPOINT_PRIORITY[left.snapshotType] -
    CHECKPOINT_PRIORITY[right.snapshotType] ||
  left.scheduledStart.getTime() - right.scheduledStart.getTime() ||
  left.gameId.localeCompare(right.gameId)

const buildDueCheckpoints = (games, observedAt) => {
  const reasonCounts = {}
  const checkpoints = []

  games.forEach((game) => {
    const normalized = normalizePlanningGame(game, observedAt)

    if (!normalized.game) {
      addReason(reasonCounts, normalized.reason)
      return
    }

    ODDS_SNAPSHOT_TYPE_VALUES.forEach((snapshotType) => {
      const checkpoint = {
        ...normalized.game,
        provider: ODDS_SNAPSHOT_PROVIDER,
        snapshotType,
        ...createOddsCheckpoint({
          scheduledStart: normalized.game.scheduledStart,
          snapshotType,
        }),
      }

      if (isCheckpointWithinAcceptanceWindow(checkpoint, observedAt)) {
        checkpoints.push(checkpoint)
      }
    })
  })

  return { checkpoints: checkpoints.sort(compareCheckpoints), reasonCounts }
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

  while (remaining.some(({ snapshotType }) => snapshotType === 'FINAL')) {
    const firstFinal = remaining.find(
      ({ snapshotType }) => snapshotType === 'FINAL',
    )
    const firstStart = firstFinal.scheduledStart.getTime()
    const finalCluster = remaining.filter(
      (checkpoint) =>
        checkpoint.snapshotType === 'FINAL' &&
        checkpoint.scheduledStart.getTime() >= firstStart &&
        checkpoint.scheduledStart.getTime() <=
          firstStart + FINAL_GROUP_WINDOW_MS,
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
        (checkpoint.snapshotType !== 'FINAL' &&
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
  snapshotRepository = oddsSnapshotRepository,
} = {}) => {
  const planDueCheckpoints = async ({ observedAt = new Date() } = {}) => {
    const current = normalizeDate(observedAt, 'observedAt')
    const policy = await getAutomaticPolicy({ observedAt: current })
    const reasonCounts = {}

    if (!policy.allowed && policy.mode === AUTOMATIC_POLICY_MODES.DISABLED) {
      addReason(reasonCounts, policy.reason || 'quota_blocked')
      return {
        dueCheckpointCount: 0,
        groups: [],
        policy,
        reasonCounts,
        scheduleDates: [],
        scheduleFailureCount: 0,
        status: 'BLOCKED',
      }
    }

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
    const due = buildDueCheckpoints(games, current)

    Object.entries(due.reasonCounts).forEach(([reason, count]) =>
      addReason(reasonCounts, reason, count),
    )

    if (due.checkpoints.length === 0) {
      addReason(reasonCounts, games.length === 0 ? 'no_games' : 'no_due_checkpoints')
      return {
        dueCheckpointCount: 0,
        groups: [],
        policy,
        reasonCounts,
        scheduleDates,
        scheduleFailureCount,
        status: 'NO_DUE_WORK',
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

    if (policy.mode === AUTOMATIC_POLICY_MODES.FINAL_ONLY) {
      const before = pending.length
      pending = pending.filter(({ snapshotType }) => snapshotType === 'FINAL')
      addReason(reasonCounts, 'policy_intermediate_suppressed', before - pending.length)
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
      policy,
      reasonCounts,
      scheduleDates,
      scheduleFailureCount,
      status: groups.length > 0 ? 'READY' : 'NO_DUE_WORK',
    }
  }

  return { planDueCheckpoints }
}

const oddsCheckpointPlanner = createOddsCheckpointPlanner()

module.exports = {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  CHECKPOINT_PRIORITY,
  FINAL_GROUP_WINDOW_MS,
  PLANNABLE_GAME_STATES,
  SCHEDULE_DATE_OFFSETS,
  buildDueCheckpoints,
  compareCheckpoints,
  createOddsCheckpointPlanner,
  getPlanningScheduleDates,
  groupDueCheckpoints,
  normalizePlanningGame,
  oddsCheckpointPlanner,
}
