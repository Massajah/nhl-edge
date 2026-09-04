const crypto = require('node:crypto')
const OddsSnapshot = require('../models/OddsSnapshot')
const {
  CAPTURE_TRIGGER_SOURCES,
  MAX_CHECKPOINT_RESULTS,
} = require('../models/OddsCaptureRun')
const {
  ODDS_SNAPSHOT_PROVIDER,
  createOddsCheckpoint,
  normalizeSnapshotType,
  parseValidDate,
} = require('./oddsSnapshotContracts')

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const FINAL_SAFE_BUFFER_MS = 5 * MINUTE_MS
const STRICT_PROVIDER_WINDOW_PADDING_MS = 60 * MINUTE_MS
const MAX_CAPTURE_CHECKPOINTS = MAX_CHECKPOINT_RESULTS

const CHECKPOINT_ACCEPTANCE_WINDOWS_MS = Object.freeze({
  T24: Object.freeze({
    maximumBeforeStartMs: 30 * HOUR_MS,
    minimumBeforeStartMs: 18 * HOUR_MS,
  }),
  T6: Object.freeze({
    maximumBeforeStartMs: 8 * HOUR_MS,
    minimumBeforeStartMs: 4 * HOUR_MS,
  }),
  T2: Object.freeze({
    maximumBeforeStartMs: 165 * MINUTE_MS,
    minimumBeforeStartMs: 75 * MINUTE_MS,
  }),
  FINAL: Object.freeze({
    maximumBeforeStartMs: 30 * MINUTE_MS,
    minimumBeforeStartMs: 5 * MINUTE_MS,
  }),
})

const MAX_PROVIDER_RESPONSE_AGE_MS = Object.freeze({
  T24: 60 * MINUTE_MS,
  T6: 30 * MINUTE_MS,
  T2: 20 * MINUTE_MS,
  FINAL: 10 * MINUTE_MS,
})

const supportedTeamIds = new Set(OddsSnapshot.SUPPORTED_TEAM_IDS)

class OddsCaptureInputError extends Error {
  constructor(message, details = undefined) {
    super(message)
    this.name = 'OddsCaptureInputError'
    this.details = details
  }
}

const normalizeDate = (value, field) => {
  try {
    return parseValidDate(value, field)
  } catch {
    throw new OddsCaptureInputError(`${field} must be a valid date.`, {
      code: `invalid_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
      field,
    })
  }
}

const normalizeCheckpoint = (checkpoint, index = 0) => {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new OddsCaptureInputError('Checkpoint work must be an object.', {
      code: 'invalid_checkpoint',
      index,
    })
  }

  const gameId = String(checkpoint.gameId ?? '').trim()
  const seasonId = String(checkpoint.seasonId ?? '').trim()
  const gameType = Number(checkpoint.gameType)
  const homeTeamId = String(checkpoint.homeTeamId ?? '').trim().toUpperCase()
  const awayTeamId = String(checkpoint.awayTeamId ?? '').trim().toUpperCase()

  if (!/^\d{10}$/.test(gameId)) {
    throw new OddsCaptureInputError('gameId must use 10 digits.', {
      code: 'invalid_game_id',
      index,
    })
  }

  if (!/^\d{8}$/.test(seasonId)) {
    throw new OddsCaptureInputError('seasonId must use 8 digits.', {
      code: 'invalid_season_id',
      index,
    })
  }

  if (!Number.isInteger(gameType) || gameType <= 0) {
    throw new OddsCaptureInputError(
      'gameType must be a positive integer NHL game type.',
      { code: 'invalid_game_type', index },
    )
  }

  if (!supportedTeamIds.has(homeTeamId) || !supportedTeamIds.has(awayTeamId)) {
    throw new OddsCaptureInputError(
      'Checkpoint teams must use canonical NHL identifiers.',
      { code: 'invalid_team', index },
    )
  }

  if (homeTeamId === awayTeamId) {
    throw new OddsCaptureInputError('Checkpoint teams must differ.', {
      code: 'same_team',
      index,
    })
  }

  let snapshotType

  try {
    snapshotType = normalizeSnapshotType(checkpoint.snapshotType)
  } catch {
    throw new OddsCaptureInputError('Unsupported checkpoint snapshot type.', {
      code: 'invalid_snapshot_type',
      index,
    })
  }

  const scheduledStart = normalizeDate(
    checkpoint.scheduledStart,
    'scheduledStart',
  )
  const targetAt = normalizeDate(checkpoint.targetAt, 'targetAt')
  const expected = createOddsCheckpoint({ scheduledStart, snapshotType })
  const checkpointKey = String(checkpoint.checkpointKey ?? '').trim()

  if (checkpointKey !== expected.checkpointKey) {
    throw new OddsCaptureInputError(
      'checkpointKey is inconsistent with snapshot type and scheduled start.',
      { code: 'checkpoint_key_mismatch', index },
    )
  }

  if (targetAt.getTime() !== expected.targetAt.getTime()) {
    throw new OddsCaptureInputError(
      'targetAt is inconsistent with snapshot type and scheduled start.',
      { code: 'checkpoint_target_mismatch', index },
    )
  }

  return {
    awayTeamId,
    checkpointKey,
    gameId,
    gameType,
    homeTeamId,
    provider: ODDS_SNAPSHOT_PROVIDER,
    scheduledStart,
    seasonId,
    snapshotType,
    targetAt,
  }
}

const getCheckpointIdentity = (checkpoint) =>
  [checkpoint.gameId, ODDS_SNAPSHOT_PROVIDER, checkpoint.checkpointKey].join('|')

const validateCheckpointBatch = (checkpoints) => {
  if (!Array.isArray(checkpoints)) {
    throw new OddsCaptureInputError('checkpoints must be an array.', {
      code: 'invalid_batch',
    })
  }

  if (checkpoints.length > MAX_CAPTURE_CHECKPOINTS) {
    throw new OddsCaptureInputError(
      `Capture batches cannot exceed ${MAX_CAPTURE_CHECKPOINTS} checkpoints.`,
      { code: 'batch_too_large' },
    )
  }

  const errors = []
  const normalized = checkpoints.map((checkpoint, index) => {
    try {
      return normalizeCheckpoint(checkpoint, index)
    } catch (error) {
      errors.push({
        code: error.details?.code ?? 'invalid_checkpoint',
        index,
        message: error.message,
      })
      return null
    }
  })
  const indexesByIdentity = new Map()

  normalized.forEach((checkpoint, index) => {
    if (!checkpoint) {
      return
    }

    const identity = getCheckpointIdentity(checkpoint)
    const indexes = indexesByIdentity.get(identity) ?? []
    indexes.push(index)
    indexesByIdentity.set(identity, indexes)
  })

  indexesByIdentity.forEach((indexes) => {
    if (indexes.length < 2) {
      return
    }

    indexes.forEach((index) => {
      errors.push({
        code: 'duplicate_checkpoint',
        index,
        message: 'Duplicate logical checkpoint in capture batch.',
      })
    })
  })

  if (errors.length > 0) {
    throw new OddsCaptureInputError(
      'Capture batch contains structurally invalid checkpoint work.',
      { errors },
    )
  }

  return normalized
}

const isCheckpointWithinAcceptanceWindow = (checkpoint, observedAt) => {
  const observation = normalizeDate(observedAt, 'observedAt')
  const window = CHECKPOINT_ACCEPTANCE_WINDOWS_MS[checkpoint.snapshotType]
  const beforeStartMs =
    checkpoint.scheduledStart.getTime() - observation.getTime()

  return (
    beforeStartMs >= window.minimumBeforeStartMs &&
    beforeStartMs <= window.maximumBeforeStartMs
  )
}

const isProviderFreshForCheckpoint = (
  checkpoint,
  providerFetchedAt,
  referenceAt,
) => {
  const fetchedAt = normalizeDate(providerFetchedAt, 'providerFetchedAt')
  const reference = normalizeDate(referenceAt, 'referenceAt')
  const ageMs = reference.getTime() - fetchedAt.getTime()

  return (
    ageMs >= 0 &&
    ageMs <= MAX_PROVIDER_RESPONSE_AGE_MS[checkpoint.snapshotType]
  )
}

const getFinalSafeCutoff = (scheduledStart, providerCommenceTime) => {
  const scheduled = normalizeDate(scheduledStart, 'scheduledStart')
  const provider = normalizeDate(
    providerCommenceTime,
    'providerCommenceTime',
  )

  return new Date(
    Math.min(scheduled.getTime(), provider.getTime()) - FINAL_SAFE_BUFFER_MS,
  )
}

const buildCaptureProviderWindow = (checkpoints) => {
  const starts = checkpoints.map(({ scheduledStart }) => scheduledStart.getTime())

  if (starts.length === 0) {
    throw new OddsCaptureInputError(
      'At least one eligible checkpoint is required for a provider window.',
      { code: 'empty_provider_window' },
    )
  }

  return {
    commenceTimeFrom: new Date(
      Math.min(...starts) - STRICT_PROVIDER_WINDOW_PADDING_MS,
    ).toISOString(),
    commenceTimeTo: new Date(
      Math.max(...starts) + STRICT_PROVIDER_WINDOW_PADDING_MS,
    ).toISOString(),
  }
}

const stringifyIdentityValue = (value) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  return String(value ?? '').trim()
}

const buildOddsCaptureRunIdentity = ({
  checkpoints,
  intendedAt,
  triggerSource,
}) => {
  const normalizedTrigger = String(triggerSource ?? '').trim().toUpperCase()

  if (!CAPTURE_TRIGGER_SOURCES.includes(normalizedTrigger)) {
    throw new OddsCaptureInputError('Unsupported capture trigger source.', {
      code: 'invalid_trigger_source',
    })
  }

  const normalizedIntendedAt = normalizeDate(intendedAt, 'intendedAt')
  const workIdentity = (Array.isArray(checkpoints) ? checkpoints : [])
    .map((checkpoint) =>
      [
        stringifyIdentityValue(checkpoint?.gameId),
        stringifyIdentityValue(checkpoint?.seasonId),
        stringifyIdentityValue(checkpoint?.gameType),
        stringifyIdentityValue(checkpoint?.homeTeamId),
        stringifyIdentityValue(checkpoint?.awayTeamId),
        stringifyIdentityValue(checkpoint?.checkpointKey),
        stringifyIdentityValue(checkpoint?.snapshotType),
        stringifyIdentityValue(checkpoint?.scheduledStart),
        stringifyIdentityValue(checkpoint?.targetAt),
      ].join('|'),
    )
    .sort()
    .join(';')
  const workHash = crypto
    .createHash('sha256')
    .update(workIdentity)
    .digest('hex')
    .slice(0, 20)
  const intendedEpoch = normalizedIntendedAt.getTime()

  return {
    intendedAt: normalizedIntendedAt,
    runId: `odds-capture-${intendedEpoch}-${workHash}`,
    runKey: `ODDS_CAPTURE:${normalizedTrigger}:${intendedEpoch}:${workHash}`,
    triggerSource: normalizedTrigger,
  }
}

module.exports = {
  CHECKPOINT_ACCEPTANCE_WINDOWS_MS,
  FINAL_SAFE_BUFFER_MS,
  MAX_CAPTURE_CHECKPOINTS,
  MAX_PROVIDER_RESPONSE_AGE_MS,
  OddsCaptureInputError,
  STRICT_PROVIDER_WINDOW_PADDING_MS,
  buildCaptureProviderWindow,
  buildOddsCaptureRunIdentity,
  getCheckpointIdentity,
  getFinalSafeCutoff,
  isCheckpointWithinAcceptanceWindow,
  isProviderFreshForCheckpoint,
  normalizeCheckpoint,
  validateCheckpointBatch,
}
