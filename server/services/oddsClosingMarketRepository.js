const OddsClosingMarket = require('../models/OddsClosingMarket')
const {
  CLOSING_MARKET_SCHEMA_VERSION,
  CLOSING_SAFETY_REASON,
  MAX_CLOSING_OBSERVATIONS,
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  buildBestFinal,
  buildClosingMarketKey,
  buildClosingMarketStateHash,
  normalizeClosingBookmakers,
  normalizeSelectedBookmakerKeys,
} = require('./oddsClosingMarketContracts')

const MAX_WRITE_ATTEMPTS = 4

const toPlainObject = (value) => {
  if (!value) return null
  return typeof value.toObject === 'function'
    ? value.toObject({ versionKey: false })
    : value
}

const executeLean = async (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const isDuplicateKeyError = (error) => Number(error?.code) === 11000

const mergeLatestSafeBookmakers = (existing = [], incoming = []) => {
  const byKey = new Map(
    (Array.isArray(existing) ? existing : []).map((row) => [row.key, row]),
  )

  incoming.forEach((row) => {
    const current = byKey.get(row.key)
    const currentTime = new Date(current?.observedAt ?? 0).getTime()
    const incomingTime = new Date(row.observedAt).getTime()

    if (!current || incomingTime >= currentTime) byKey.set(row.key, row)
  })

  return [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  )
}

const buildSafeRows = ({
  bookmakers,
  capturedAt,
  providerCommenceTime,
  providerEventId,
}) =>
  bookmakers.map((row) => ({
    ...row,
    lastUpdateMissing: !row.lastUpdate,
    observedAt: capturedAt,
    providerCommenceTime,
    providerEventId,
    safetyReason: CLOSING_SAFETY_REASON,
  }))

const createOddsClosingMarketRepository = ({
  closingModel = OddsClosingMarket,
} = {}) => {
  const getByKey = async (closingKey) =>
    executeLean(closingModel.findOne({ closingKey }))

  const recordObservation = async (candidate) => {
    const selectedBookmakerKeys = normalizeSelectedBookmakerKeys(
      candidate.selectedBookmakerKeys,
    )
    const bookmakers = normalizeClosingBookmakers(
      candidate.bookmakers,
      selectedBookmakerKeys,
    )
    const capturedAt = new Date(candidate.capturedAt)
    const providerCommenceTime = new Date(candidate.providerCommenceTime)
    const closingKey = buildClosingMarketKey({
      gameId: candidate.gameId,
      scheduledStart: candidate.scheduledStartAtCapture,
    })
    const marketStateHash = buildClosingMarketStateHash({
      bookmakers,
      selectedBookmakerKeys,
    })
    const observation = {
      bookmakers,
      capturedAt,
      marketStateHash,
      providerCommenceTime,
      providerEventId: candidate.providerEventId,
      selectedBookmakerKeys,
    }
    const safeRows = buildSafeRows({
      bookmakers,
      capturedAt,
      providerCommenceTime,
      providerEventId: candidate.providerEventId,
    })

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const existing = await getByKey(closingKey)

      if (!existing) {
        try {
          const created = await closingModel.create({
            awayTeamId: candidate.awayTeamId,
            closingKey,
            firstObservedAt: capturedAt,
            finalizedAt: null,
            gameId: candidate.gameId,
            gameType: candidate.gameType,
            homeTeamId: candidate.homeTeamId,
            lastMarketStateHash: marketStateHash,
            lastObservedAt: capturedAt,
            latestSafeBookmakers: safeRows,
            market: ODDS_SNAPSHOT_MARKET,
            observations: [observation],
            provider: ODDS_SNAPSHOT_PROVIDER,
            revision: 1,
            scheduledStartAtCapture: candidate.scheduledStartAtCapture,
            schemaVersion: CLOSING_MARKET_SCHEMA_VERSION,
            seasonId: candidate.seasonId,
            selectedBookmakerKeys,
          })

          return {
            closingMarket: toPlainObject(created),
            observationStored: true,
            status: 'CREATED',
          }
        } catch (error) {
          if (isDuplicateKeyError(error)) continue
          throw error
        }
      }

      if (existing.finalizedAt) {
        return {
          closingMarket: existing,
          observationStored: false,
          status: 'FINALIZED',
        }
      }

      if (
        Number.isFinite(new Date(existing.lastObservedAt).getTime()) &&
        new Date(existing.lastObservedAt).getTime() > capturedAt.getTime()
      ) {
        return {
          closingMarket: existing,
          observationStored: false,
          status: 'STALE',
        }
      }

      const stateChanged = existing.lastMarketStateHash !== marketStateHash
      const observations = Array.isArray(existing.observations)
        ? existing.observations
        : []

      if (stateChanged && observations.length >= MAX_CLOSING_OBSERVATIONS) {
        throw new Error('Closing market observation history limit was reached.')
      }

      const nextObservations = stateChanged
        ? [...observations, observation]
        : observations
      const updated = await closingModel.findOneAndUpdate(
        {
          _id: existing._id,
          finalizedAt: null,
          revision: existing.revision,
        },
        {
          $inc: { revision: 1 },
          $set: {
            lastMarketStateHash: marketStateHash,
            lastObservedAt: capturedAt,
            latestSafeBookmakers: mergeLatestSafeBookmakers(
              existing.latestSafeBookmakers,
              safeRows,
            ),
            observations: nextObservations,
            selectedBookmakerKeys,
          },
        },
        { new: true, runValidators: true },
      )

      if (updated) {
        return {
          closingMarket: toPlainObject(updated),
          observationStored: stateChanged,
          status: stateChanged ? 'CHANGED' : 'UNCHANGED',
        }
      }
    }

    throw new Error('Closing market observation could not acquire a write revision.')
  }

  const finalizeClosingMarket = async ({
    gameId,
    observedAt,
    reason,
    scheduledStart,
    selectedBookmakerKeys,
  }) => {
    const closingKey = buildClosingMarketKey({ gameId, scheduledStart })
    const finalizedAt = new Date(observedAt)
    const requestedBookmakerKeys = normalizeSelectedBookmakerKeys(
      selectedBookmakerKeys,
    )

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const existing = await getByKey(closingKey)

      if (!existing) return { status: 'NO_OBSERVATIONS' }
      if (existing.finalizedAt) {
        return { closingMarket: existing, status: 'EXISTING' }
      }

      const finalSelectedBookmakerKeys =
        requestedBookmakerKeys.length > 0
          ? requestedBookmakerKeys
          : normalizeSelectedBookmakerKeys(existing.selectedBookmakerKeys)
      const selected = new Set(finalSelectedBookmakerKeys)
      const finalBookmakers = (existing.latestSafeBookmakers ?? [])
        .filter((row) => selected.has(row.key))
        .sort((left, right) => left.key.localeCompare(right.key))
      const finalizationReason =
        finalBookmakers.length > 0 ? reason : 'NO_SAFE_ODDS'
      const updated = await closingModel.findOneAndUpdate(
        {
          _id: existing._id,
          finalizedAt: null,
          revision: existing.revision,
        },
        {
          $inc: { revision: 1 },
          $set: {
            bestFinal: buildBestFinal(finalBookmakers),
            finalBookmakers,
            finalizationReason,
            finalSelectedBookmakerKeys,
            finalizedAt,
          },
        },
        { new: true, runValidators: true },
      )

      if (updated) {
        return { closingMarket: toPlainObject(updated), status: 'FINALIZED' }
      }
    }

    throw new Error('Closing market finalization could not acquire a write revision.')
  }

  return { finalizeClosingMarket, getByKey, recordObservation }
}

const oddsClosingMarketRepository = createOddsClosingMarketRepository()

module.exports = {
  buildSafeRows,
  createOddsClosingMarketRepository,
  mergeLatestSafeBookmakers,
  oddsClosingMarketRepository,
}
