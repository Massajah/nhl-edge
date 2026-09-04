const OddsSnapshot = require('../models/OddsSnapshot')

class OddsSnapshotPersistenceError extends Error {
  constructor(message, details = undefined) {
    super(message)
    this.name = 'OddsSnapshotPersistenceError'
    this.details = details
  }
}

const getSnapshotIdentity = (snapshot) =>
  [snapshot.gameId, snapshot.provider, snapshot.checkpointKey].join('|')

const toSnapshotIdentityFilter = (snapshot) => ({
  checkpointKey: String(snapshot.checkpointKey ?? '').trim(),
  gameId: String(snapshot.gameId ?? '').trim(),
  provider: String(snapshot.provider ?? '').trim(),
})

const prepareMongooseSnapshot = async (snapshotModel, candidate) => {
  const document = new snapshotModel(candidate)

  await document.validate()

  return document.toObject({ depopulate: true, versionKey: false })
}

const assertNoDuplicateCandidates = (snapshots) => {
  const identities = new Set()
  const duplicates = new Set()

  snapshots.forEach((snapshot) => {
    const identity = getSnapshotIdentity(snapshot)

    if (identities.has(identity)) {
      duplicates.add(identity)
    }

    identities.add(identity)
  })

  if (duplicates.size > 0) {
    throw new OddsSnapshotPersistenceError(
      'Snapshot candidates contain duplicate logical checkpoints.',
      { duplicateIdentities: [...duplicates].sort() },
    )
  }
}

const summarizeBulkResult = (
  result,
  attemptedCount,
  { completed = true } = {},
) => {
  const insertedCount = Number(result?.upsertedCount) || 0
  const matchedCount = Number(result?.matchedCount) || 0
  const resolvedCount = insertedCount + matchedCount

  return {
    attemptedCount,
    existingCount: completed ? attemptedCount - insertedCount : matchedCount,
    insertedCount,
    ...(completed
      ? {}
      : { unresolvedCount: Math.max(0, attemptedCount - resolvedCount) }),
  }
}

const getUpsertedIndexes = (result) => {
  if (result?.upsertedIds instanceof Map) {
    return new Set(
      [...result.upsertedIds.keys()]
        .map(Number)
        .filter(Number.isInteger),
    )
  }

  if (result?.upsertedIds && typeof result.upsertedIds === 'object') {
    const indexes = new Set(
      Object.keys(result.upsertedIds)
        .map(Number)
        .filter(Number.isInteger),
    )

    if (indexes.size > 0 || Number(result.upsertedCount) === 0) {
      return indexes
    }
  }

  if (typeof result?.getUpsertedIds === 'function') {
    return new Set(
      result
        .getUpsertedIds()
        .map(({ index }) => Number(index))
        .filter(Number.isInteger),
    )
  }

  return new Set()
}

const createOddsSnapshotRepository = ({
  prepareCandidate,
  snapshotModel = OddsSnapshot,
} = {}) => {
  const prepare =
    prepareCandidate ??
    ((candidate) => prepareMongooseSnapshot(snapshotModel, candidate))

  const findExistingCheckpoints = async (checkpoints = []) => {
    if (!Array.isArray(checkpoints)) {
      throw new OddsSnapshotPersistenceError(
        'Snapshot checkpoint identities must be an array.',
      )
    }

    if (checkpoints.length === 0) {
      return new Set()
    }

    const filters = checkpoints.map(toSnapshotIdentityFilter)
    const query = snapshotModel.find(
      { $or: filters },
      { _id: 0, checkpointKey: 1, gameId: 1, provider: 1 },
    )
    const documents =
      typeof query?.lean === 'function' ? await query.lean() : await query

    return new Set(documents.map(getSnapshotIdentity))
  }

  const insertSnapshots = async (
    candidates = [],
    { includeOutcomes = false } = {},
  ) => {
    if (!Array.isArray(candidates)) {
      throw new OddsSnapshotPersistenceError(
        'Snapshot candidates must be an array.',
      )
    }

    if (candidates.length === 0) {
      return { attemptedCount: 0, existingCount: 0, insertedCount: 0 }
    }

    const snapshots = await Promise.all(candidates.map(prepare))

    assertNoDuplicateCandidates(snapshots)

    const operations = snapshots.map((snapshot) => ({
      updateOne: {
        filter: {
          checkpointKey: snapshot.checkpointKey,
          gameId: snapshot.gameId,
          provider: snapshot.provider,
        },
        update: { $setOnInsert: snapshot },
        upsert: true,
      },
    }))

    try {
      const result = await snapshotModel.bulkWrite(operations, {
        ordered: false,
      })
      const summary = summarizeBulkResult(result, snapshots.length)

      if (!includeOutcomes) {
        return summary
      }

      const upsertedIndexes = getUpsertedIndexes(result)
      const allInsertedWithoutIndexes =
        upsertedIndexes.size === 0 &&
        summary.insertedCount === snapshots.length

      return {
        ...summary,
        outcomes: snapshots.map((snapshot, index) => ({
          identity: getSnapshotIdentity(snapshot),
          status:
            allInsertedWithoutIndexes || upsertedIndexes.has(index)
              ? 'INSERTED'
              : 'EXISTING',
        })),
      }
    } catch (error) {
      const writeResult = error.result ?? error.writeResult
      const summary = summarizeBulkResult(
        writeResult,
        snapshots.length,
        { completed: false },
      )
      const upsertedIndexes = getUpsertedIndexes(writeResult)

      error.snapshotWriteSummary = {
        ...summary,
        ...(upsertedIndexes.size > 0
          ? {
              outcomes: snapshots.map((snapshot, index) => ({
                identity: getSnapshotIdentity(snapshot),
                status: upsertedIndexes.has(index)
                  ? 'INSERTED'
                  : 'UNRESOLVED',
              })),
            }
          : {}),
      }
      throw error
    }
  }

  return { findExistingCheckpoints, insertSnapshots }
}

const oddsSnapshotRepository = createOddsSnapshotRepository()

module.exports = {
  OddsSnapshotPersistenceError,
  assertNoDuplicateCandidates,
  createOddsSnapshotRepository,
  getSnapshotIdentity,
  getUpsertedIndexes,
  oddsSnapshotRepository,
  prepareMongooseSnapshot,
  summarizeBulkResult,
  toSnapshotIdentityFilter,
}
