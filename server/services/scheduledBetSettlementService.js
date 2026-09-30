const Bet = require('../models/Bet')
const User = require('../models/User')
const { getProductionAccountFilter } = require('../config/accountTypes')
const { settlePendingMoneylineBets } = require('./betSettlementService')
const {
  getCronSlot,
  scheduledJobLeaseService,
} = require('./scheduledJobLeaseService')

const JOB_NAME = 'nhl-edge-bet-settlement'
const RECENT_GAME_MS = 48 * 60 * 60 * 1000
const RECENT_RETRY_MS = 15 * 60 * 1000
const OLD_RETRY_MS = 12 * 60 * 60 * 1000
const MAX_GAME_AGE_MS = 60 * 24 * 60 * 60 * 1000
const NHL_GAME_ID_PATTERN = /^\d{10}$/

const asRows = async (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const shouldCheckBet = (bet, now) => {
  if (!bet.scheduledStart) return false
  const start = new Date(bet.scheduledStart).getTime()
  if (
    !Number.isFinite(start) ||
    start > now.getTime() ||
    start < now.getTime() - MAX_GAME_AGE_MS
  ) {
    return false
  }

  const lastCheck = bet.lastSettlementCheckAt
    ? new Date(bet.lastSettlementCheckAt).getTime()
    : null
  if (!Number.isFinite(lastCheck)) return true

  const retryMs = now.getTime() - start <= RECENT_GAME_MS
    ? RECENT_RETRY_MS
    : OLD_RETRY_MS
  return lastCheck <= now.getTime() - retryMs
}

const createScheduledBetSettlementService = ({
  betModel = Bet,
  userModel = User,
  settleOwner = settlePendingMoneylineBets,
  leaseService = scheduledJobLeaseService,
  now = () => new Date(),
  logger = console,
} = {}) => ({
  async runScheduledSettlement() {
    const observedAt = now()
    const intendedAt = getCronSlot(observedAt)
    const leaseResult = await leaseService.acquireLease({
      jobName: JOB_NAME,
      intendedAt,
      observedAt,
    })
    if (!leaseResult.acquired) {
      return { outcome: 'LEASE_NOT_ACQUIRED', ownersConsidered: 0,
        pendingCandidatesConsidered: 0, wins: 0, losses: 0,
        stillNotFinal: 0, skippedInvalidOrUnlinked: 0, failures: 0 }
    }

    const summary = {
      outcome: 'COMPLETED',
      intendedAt: intendedAt.toISOString(),
      ownersConsidered: 0,
      pendingCandidatesConsidered: 0,
      wins: 0,
      losses: 0,
      stillNotFinal: 0,
      skippedInvalidOrUnlinked: 0,
      failures: 0,
    }
    const { lease } = leaseResult

    try {
      const pending = await asRows(betModel.find({
        result: 'pending',
        scheduledStart: {
          $gte: new Date(observedAt.getTime() - MAX_GAME_AGE_MS),
          $lte: observedAt,
        },
      }, {
        _id: 1,
        gameId: 1,
        lastSettlementCheckAt: 1,
        scheduledStart: 1,
        userId: 1,
      }))
      const due = (pending ?? []).filter((bet) => shouldCheckBet(bet, observedAt))
      const ownerIds = [...new Map(due.map((bet) => [String(bet.userId), bet.userId])).values()]
      const owners = ownerIds.length
        ? await asRows(userModel.find({
            _id: { $in: ownerIds },
            $and: [
              { $or: [{ status: 'active' }, { status: { $exists: false } }] },
              getProductionAccountFilter(),
            ],
          }, { _id: 1 }))
        : []
      const eligibleOwners = new Set((owners ?? []).map(({ _id }) => String(_id)))
      const byOwner = new Map()

      for (const bet of due) {
        const ownerId = String(bet.userId)
        if (!eligibleOwners.has(ownerId)) continue
        if (!NHL_GAME_ID_PATTERN.test(String(bet.gameId ?? ''))) {
          summary.skippedInvalidOrUnlinked += 1
          continue
        }
        if (!byOwner.has(ownerId)) byOwner.set(ownerId, [])
        byOwner.get(ownerId).push(bet._id)
      }

      summary.ownersConsidered = eligibleOwners.size
      summary.pendingCandidatesConsidered = [...byOwner.values()]
        .reduce((count, ids) => count + ids.length, 0)

      for (const [ownerId, pendingBetIds] of byOwner) {
        try {
          const result = await settleOwner(ownerId, { pendingBetIds })
          summary.wins += result.wins ?? 0
          summary.losses += result.losses ?? 0
          summary.stillNotFinal += (result.results ?? []).filter(
            (item) => item.reason === 'game_not_final',
          ).length
          summary.skippedInvalidOrUnlinked += (result.results ?? []).filter(
            (item) => item.reason && ![
              'game_not_final', 'final_score_unavailable', 'game_unavailable',
              'provider_error',
            ].includes(item.reason),
          ).length
          summary.failures += result.errors ?? 0
        } catch (error) {
          summary.failures += 1
          logger.warn?.('Scheduled bet settlement owner failed.', {
            errorName: error.name,
          })
        }
      }

      if (summary.failures) summary.outcome = 'PARTIAL_FAILURE'
      await leaseService.finishLease(lease.slotKey, lease.leaseToken, {
        completedAt: now(),
        outcome: summary.outcome,
        status: 'COMPLETED',
      })
      logger.info?.('Scheduled bet settlement completed.', summary)
      return summary
    } catch (error) {
      await leaseService.finishLease(lease.slotKey, lease.leaseToken, {
        completedAt: now(),
        outcome: 'FAILED',
        status: 'FAILED',
      }).catch(() => {})
      logger.error?.('Scheduled bet settlement failed.', { errorName: error.name })
      throw error
    }
  },
})

module.exports = {
  JOB_NAME,
  createScheduledBetSettlementService,
  scheduledBetSettlementService: createScheduledBetSettlementService(),
  shouldCheckBet,
}
