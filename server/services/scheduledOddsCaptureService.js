const { oddsCaptureEngine } = require('./oddsCaptureEngine')
const { oddsCaptureRunService } = require('./oddsCaptureRunService')
const { oddsCheckpointPlanner } = require('./oddsCheckpointPlanner')
const {
  getCronSlot,
  scheduledJobLeaseService,
} = require('./scheduledJobLeaseService')

const ODDS_CAPTURE_JOB_NAME = 'nhl-edge-odds-capture'

const normalizeDate = (value, field) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date.`)
  }

  return date
}

const createScheduledOddsCaptureService = ({
  captureEngine = oddsCaptureEngine,
  captureRunService = oddsCaptureRunService,
  jobName = ODDS_CAPTURE_JOB_NAME,
  leaseService = scheduledJobLeaseService,
  logger = console,
  now = () => new Date(),
  planner = oddsCheckpointPlanner,
} = {}) => {
  const runScheduledCapture = async () => {
    const observedAt = normalizeDate(now(), 'clock')
    const intendedAt = getCronSlot(observedAt)
    const leaseResult = await leaseService.acquireLease({
      intendedAt,
      jobName,
      observedAt,
    })

    if (!leaseResult.acquired) {
      const result = {
        intendedAt: intendedAt.toISOString(),
        outcome: 'LEASE_NOT_ACQUIRED',
        providerRequestCount: 0,
        snapshotsStored: 0,
      }

      logger.info?.('Odds capture cron completed.', result)
      return result
    }

    const { lease } = leaseResult
    let leaseFinalized = false

    try {
      const recoveredRunCount =
        await captureRunService.recoverStaleStartedRuns({ observedAt })
      const plan = await planner.planDueCheckpoints({ observedAt })
      const runResults = []

      for (const workGroup of plan.groups) {
        const checkpoints = workGroup.filter(
          ({ snapshotType }) => snapshotType !== 'CLOSING',
        )
        const closingGames = workGroup.filter(
          ({ snapshotType }) => snapshotType === 'CLOSING',
        )
        const result = await captureEngine.executeOddsCapture({
          checkpoints,
          closingGames,
          intendedAt,
          triggerSource: 'SCHEDULED',
        })

        runResults.push(result)

        if (['FAILED', 'QUOTA_BLOCKED'].includes(result.status)) {
          break
        }
      }
      const finalizationResult = captureEngine.finalizeClosingMarkets
        ? await captureEngine.finalizeClosingMarkets({
            games: plan.finalizations ?? [],
            observedAt: normalizeDate(now(), 'clock'),
            selectedBookmakerKeys: plan.selectedBookmakerKeys ?? [],
          })
        : { failedCount: 0, finalizedCount: 0, results: [] }

      const providerRequestCount = runResults.reduce(
        (count, result) => count + (Number(result.providerRequestCount) || 0),
        0,
      )
      const snapshotsStored = runResults.reduce(
        (count, result) => count + (Number(result.insertedCount) || 0),
        0,
      )
      const hasUnknownCreditCost = runResults.some(
        (result) =>
          Number(result.providerRequestCount) > 0 &&
          !Number.isFinite(result.actualCreditCost),
      )
      const actualCreditCost = hasUnknownCreditCost
        ? null
        : runResults.reduce(
            (cost, result) => cost + (Number(result.actualCreditCost) || 0),
            0,
          )
      const quotaBlocked = runResults.some(
        ({ status }) => status === 'QUOTA_BLOCKED',
      )
      const failed =
        runResults.some(({ status }) => status === 'FAILED') ||
        Number(finalizationResult.failedCount) > 0
      const outcome = quotaBlocked
        ? 'QUOTA_BLOCKED'
        : failed
          ? 'HANDLED_CAPTURE_FAILURE'
          : plan.status === 'READY'
            ? 'CAPTURED'
            : plan.status
      const result = {
        actualCreditCost,
        automaticCreditSpend: plan.policy.automaticCreditSpend ?? null,
        dailyAutomaticSuccessfulRequestCount:
          plan.policy.dailyAutomaticSuccessfulRequestCount ?? null,
        dueCheckpointCount: plan.dueCheckpointCount,
        failedClosingMarketFinalizationCount:
          finalizationResult.failedCount ?? 0,
        finalizedClosingMarketCount: finalizationResult.finalizedCount,
        intendedAt: intendedAt.toISOString(),
        leaseRecovered: leaseResult.recovered,
        outcome,
        plannedGroupCount: plan.groups.length,
        policyMode: plan.policy.mode,
        providerRequestCount,
        quotaRemaining: plan.policy.quota?.remaining ?? null,
        reasonCounts: plan.reasonCounts,
        recoveredRunCount,
        runCount: runResults.length,
        scheduleFailureCount: plan.scheduleFailureCount,
        snapshotsStored,
      }

      await leaseService.finishLease(lease.slotKey, lease.leaseToken, {
        completedAt: normalizeDate(now(), 'clock'),
        outcome,
        status: 'COMPLETED',
      })
      leaseFinalized = true
      logger.info?.('Odds capture cron completed.', result)

      return result
    } catch (error) {
      if (!leaseFinalized) {
        try {
          await leaseService.finishLease(lease.slotKey, lease.leaseToken, {
            completedAt: normalizeDate(now(), 'clock'),
            outcome: 'FATAL_ERROR',
            status: 'FAILED',
          })
        } catch (leaseError) {
          logger.error?.('Odds capture cron lease finalization failed.', {
            errorName: leaseError.name,
          })
        }
      }

      throw error
    }
  }

  return { runScheduledCapture }
}

const scheduledOddsCaptureService = createScheduledOddsCaptureService()

module.exports = {
  ODDS_CAPTURE_JOB_NAME,
  createScheduledOddsCaptureService,
  scheduledOddsCaptureService,
}
