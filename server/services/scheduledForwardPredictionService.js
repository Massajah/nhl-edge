const User = require('../models/User')
const nhl = require('./nhlApiService')
const { createForwardPredictionInputsService } = require('./forwardPredictionInputsService')
const { calculateAutomaticPrediction } = require('./automaticPredictionService')
const { forwardPredictionRepository } = require('./forwardPredictionRepository')
const { getCronSlot, scheduledJobLeaseService } = require('./scheduledJobLeaseService')
const { PREDICTION_DEFINITION, OPEN_BEFORE_MS, getGameIdentity, getT2Eligibility } = require('./forwardPredictionContracts')

const ACTIVE_USER_FILTER = { $or: [{ status: 'active' }, { status: { $exists: false } }] }
const JOB_NAME = 'nhl-edge-forward-prediction-t2'
const getScheduleDates = (now) => [-1, 0, 1].map((offset) =>
  new Date(+now + offset * 86400000).toISOString().slice(0, 10))
const scheduleGames = (state, now) => {
  // Do not accept stale fallback schedules as authoritative pregame evidence.
  if (state?.stale || !state?.data || !Number.isFinite(Date.parse(state.fetchedAt)) ||
      +now - Date.parse(state.fetchedAt) > 5 * 60 * 1000 || Date.parse(state.fetchedAt) > +now) {
    throw new Error('Fresh NHL schedule is required for official predictions.')
  }
  return (state.data.gameWeek ?? []).flatMap((day) => day.games ?? [])
}

const createScheduledForwardPredictionService = ({ userModel = User, provider = nhl,
  repository = forwardPredictionRepository, leaseService = scheduledJobLeaseService,
  createInputs = () => createForwardPredictionInputsService({ provider }),
  calculate = calculateAutomaticPrediction, now = () => new Date(), logger = console } = {}) => ({
  async runScheduledCapture() {
    const observedAt = now()
    const intendedAt = getCronSlot(observedAt)
    const leaseResult = await leaseService.acquireLease({ jobName: JOB_NAME, intendedAt, observedAt })
    if (!leaseResult.acquired) return { outcome: 'LEASE_NOT_ACQUIRED', captured: 0 }
    const summary = { outcome: 'COMPLETED', intendedAt: intendedAt.toISOString(), attempted: 0,
      captured: 0, users: 0, reasonCounts: {}, failed: 0 }
    const reason = (code) => { summary.reasonCounts[code] = (summary.reasonCounts[code] ?? 0) + 1 }
    try {
      await repository.ensureReady?.()
      const candidates = new Map()
      for (const date of getScheduleDates(observedAt)) {
        try {
          const state = await provider.getScheduleForDate(date, { includeMetadata: true })
          for (const game of scheduleGames(state, now())) {
            const identity = getGameIdentity(game)
            if (identity) candidates.set(identity.gameId, { game, identity, date })
          }
        } catch (error) {
          summary.failed += 1
          reason('SCHEDULE_UNAVAILABLE')
          logger.warn?.('Forward schedule unavailable.', { date, errorName: error.name })
        }
      }
      const due = [...candidates.values()].filter(({ game }) => {
        const skipped = getT2Eligibility(game, now())
        if (skipped) reason(skipped)
        return !skipped
      })
      if (due.length) {
        const inputsService = createInputs()
        // Stream accounts; expensive provider data is shared within this run, private data is not.
        for await (const user of userModel.find(ACTIVE_USER_FILTER, { _id: 1 }).lean().cursor()) {
          const userId = user._id
          summary.users += 1
          try {
            const missing = []
            for (const item of due) {
              if (await repository.exists({ userId, ...item.identity })) reason('ALREADY_CAPTURED')
              else missing.push(item)
            }
            if (!missing.length) continue
            summary.attempted += missing.length
            logger.info?.('Official T2 prediction attempt.', { userId: String(userId), gameCount: missing.length })
            const loaded = await inputsService.loadUserInputs(userId, missing.map(({ game }) => game), now())
            for (const { identity, date } of missing) {
              try {
                // Re-read provider state after loading inputs. A changed start/state aborts this identity.
                const state = await provider.getScheduleForDate(date, { includeMetadata: true })
                const current = scheduleGames(state, now()).find((game) => String(game.gameId ?? game.id) === identity.gameId)
                const currentIdentity = getGameIdentity(current)
                if (!currentIdentity || Object.keys(identity).some((key) =>
                  String(identity[key]) !== String(currentIdentity[key]))) { reason('SCHEDULE_IDENTITY_CHANGED'); continue }
                const generatedAt = now()
                const skipped = getT2Eligibility(current, generatedAt)
                if (skipped) { reason(skipped); continue }
                if (!await userModel.exists({ _id: userId, ...ACTIVE_USER_FILTER })) { reason('USER_INACTIVE'); continue }
                const prediction = calculate({ ...loaded, identity, gameContext: loaded.contexts.get(identity.gameId) })
                if (!prediction.available) { reason(prediction.reason); continue }
                // Time spent checking account state must not allow a late official observation.
                const writeAt = now()
                const writeSkipped = getT2Eligibility(current, writeAt)
                if (writeSkipped) { reason(writeSkipped); continue }
                const { available: _available, ...data } = prediction
                const result = await repository.insertOnce({ ...identity, ...data, userId,
                  predictionDefinition: PREDICTION_DEFINITION, generatedAt: writeAt,
                  targetAt: new Date(+identity.scheduledStartAtCapture - OPEN_BEFORE_MS) })
                if (result.inserted) summary.captured += 1
                else reason('ALREADY_CAPTURED')
              } catch (error) {
                summary.failed += 1
                reason('CAPTURE_FAILED')
                logger.warn?.('Official T2 capture failed.', { userId: String(userId), gameId: identity.gameId, errorName: error.name })
              }
            }
          } catch (error) {
            summary.failed += 1
            reason('USER_INPUTS_UNAVAILABLE')
            logger.warn?.('Official T2 user inputs unavailable.', { userId: String(userId), errorName: error.name })
          }
        }
      }
      if (summary.failed) summary.outcome = 'PARTIAL_FAILURE'
      return summary
    } catch (error) {
      summary.outcome = 'FAILED'
      throw error
    } finally {
      const { lease } = leaseResult
      await leaseService.finishLease(lease.slotKey, lease.leaseToken, {
        completedAt: now(), outcome: summary.outcome, status: summary.outcome === 'FAILED' ? 'FAILED' : 'COMPLETED',
      })
      logger.info?.('Official T2 prediction capture completed.', summary)
    }
  },
})

module.exports = { ACTIVE_USER_FILTER, JOB_NAME, createScheduledForwardPredictionService,
  scheduledForwardPredictionService: createScheduledForwardPredictionService() }
