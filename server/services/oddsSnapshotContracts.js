const ODDS_SNAPSHOT_PROVIDER = 'the-odds-api-v4'
const ODDS_SNAPSHOT_MARKET = 'h2h'

const ODDS_SNAPSHOT_TYPES = Object.freeze({
  T24: 'T24',
  T6: 'T6',
  T2: 'T2',
  FINAL: 'FINAL',
})

const ODDS_SNAPSHOT_TYPE_VALUES = Object.freeze(
  Object.values(ODDS_SNAPSHOT_TYPES),
)

const CHECKPOINT_OFFSETS_MS = Object.freeze({
  [ODDS_SNAPSHOT_TYPES.T24]: 24 * 60 * 60 * 1000,
  [ODDS_SNAPSHOT_TYPES.T6]: 6 * 60 * 60 * 1000,
  [ODDS_SNAPSHOT_TYPES.T2]: 2 * 60 * 60 * 1000,
  [ODDS_SNAPSHOT_TYPES.FINAL]: 10 * 60 * 1000,
})

class OddsSnapshotContractError extends Error {
  constructor(message, details = undefined) {
    super(message)
    this.name = 'OddsSnapshotContractError'
    this.details = details
  }
}

const parseValidDate = (value, field) => {
  if (value === null || value === undefined || value === '') {
    throw new OddsSnapshotContractError(`${field} must be a valid date.`, {
      field,
    })
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new OddsSnapshotContractError(`${field} must be a valid date.`, {
      field,
    })
  }

  return date
}

const normalizeSnapshotType = (snapshotType) => {
  const normalized = String(snapshotType ?? '').trim().toUpperCase()

  if (!ODDS_SNAPSHOT_TYPE_VALUES.includes(normalized)) {
    throw new OddsSnapshotContractError('Unsupported odds snapshot type.', {
      field: 'snapshotType',
      supportedValues: ODDS_SNAPSHOT_TYPE_VALUES,
    })
  }

  return normalized
}

const buildOddsCheckpointKey = (snapshotType, scheduledStart) => {
  const normalizedType = normalizeSnapshotType(snapshotType)
  const normalizedStart = parseValidDate(scheduledStart, 'scheduledStart')

  return `${normalizedType}:${normalizedStart.getTime()}`
}

const createOddsCheckpoint = ({ scheduledStart, snapshotType }) => {
  const normalizedType = normalizeSnapshotType(snapshotType)
  const normalizedStart = parseValidDate(scheduledStart, 'scheduledStart')

  return {
    checkpointKey: buildOddsCheckpointKey(normalizedType, normalizedStart),
    snapshotType: normalizedType,
    targetAt: new Date(
      normalizedStart.getTime() - CHECKPOINT_OFFSETS_MS[normalizedType],
    ),
  }
}

module.exports = {
  CHECKPOINT_OFFSETS_MS,
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  ODDS_SNAPSHOT_TYPES,
  ODDS_SNAPSHOT_TYPE_VALUES,
  OddsSnapshotContractError,
  buildOddsCheckpointKey,
  createOddsCheckpoint,
  normalizeSnapshotType,
  parseValidDate,
}
