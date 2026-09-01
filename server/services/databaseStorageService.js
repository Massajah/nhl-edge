const mongoose = require('mongoose')
const { databaseStorageConfig } = require('../config/databaseStorage')

const STORAGE_USAGE_SOURCE = 'mongodb_atlas_atlasSize'

let cachedStorageResult = null
let cacheExpiresAt = 0

const toNonNegativeNumber = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null
}

const calculateCapacity = (usedBytes, limitBytes) => {
  const normalizedUsedBytes = toNonNegativeNumber(usedBytes)
  const normalizedLimitBytes = toNonNegativeNumber(limitBytes)

  if (normalizedUsedBytes === null || !normalizedLimitBytes) {
    return null
  }

  return {
    percentUsed: Math.min(
      100,
      Math.max(
        0,
        Math.round((normalizedUsedBytes / normalizedLimitBytes) * 10000) / 100,
      ),
    ),
    remainingBytes: Math.max(0, normalizedLimitBytes - normalizedUsedBytes),
  }
}

const buildUnavailableResult = ({ checkedAt, limitBytes, limitSource, reason }) => ({
  available: false,
  checkedAt,
  dataBytes: null,
  indexBytes: null,
  limitBytes,
  message:
    reason === 'unsupported'
      ? 'MongoDB Atlas does not expose a reliable quota-usage value through the current database connection.'
      : 'Database storage usage is temporarily unavailable.',
  percentUsed: null,
  reason,
  remainingBytes: null,
  source: {
    limit: limitSource,
    usage: 'unavailable',
  },
  usedBytes: null,
})

const buildStorageResult = (
  commandResult,
  {
    checkedAt = new Date().toISOString(),
    limitBytes = databaseStorageConfig.limitBytes,
    limitSource = databaseStorageConfig.limitSource,
  } = {},
) => {
  const usedBytes = toNonNegativeNumber(commandResult?.atlasSize)
  const capacity = calculateCapacity(usedBytes, limitBytes)

  if (usedBytes === null || !capacity) {
    return buildUnavailableResult({
      checkedAt,
      limitBytes,
      limitSource,
      reason: 'invalid_measurement',
    })
  }

  return {
    available: true,
    checkedAt,
    dataBytes: toNonNegativeNumber(commandResult?.totals?.dataSize),
    indexBytes: toNonNegativeNumber(commandResult?.totals?.indexSize),
    limitBytes,
    percentUsed: capacity.percentUsed,
    remainingBytes: capacity.remainingBytes,
    source: {
      limit: limitSource,
      usage: STORAGE_USAGE_SOURCE,
    },
    usedBytes,
  }
}

const runAtlasSizeCommand = async () => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    const error = new Error('MongoDB connection is unavailable.')
    error.code = 'DATABASE_UNAVAILABLE'
    throw error
  }

  return mongoose.connection.db.command({ atlasSize: 1 })
}

const isUnsupportedCommandError = (error) =>
  error?.code === 59 ||
  error?.codeName === 'CommandNotFound' ||
  /atlasSize.+(?:not allowed|not supported)|no such command/i.test(
    String(error?.message ?? ''),
  )

const withCacheMetadata = (result, cached) => ({
  ...result,
  cached,
})

const getDatabaseStorageStatus = async ({
  cacheTtlMs = databaseStorageConfig.cacheTtlMs,
  command = runAtlasSizeCommand,
  limitBytes = databaseStorageConfig.limitBytes,
  limitSource = databaseStorageConfig.limitSource,
  now = () => Date.now(),
  refresh = false,
} = {}) => {
  const currentTime = now()

  if (!refresh && cachedStorageResult && currentTime < cacheExpiresAt) {
    return withCacheMetadata(cachedStorageResult, true)
  }

  const checkedAt = new Date(currentTime).toISOString()
  let result

  try {
    const commandResult = await command()
    result = buildStorageResult(commandResult, {
      checkedAt,
      limitBytes,
      limitSource,
    })
  } catch (error) {
    result = buildUnavailableResult({
      checkedAt,
      limitBytes,
      limitSource,
      reason: isUnsupportedCommandError(error)
        ? 'unsupported'
        : 'measurement_failed',
    })
  }

  cachedStorageResult = result
  cacheExpiresAt = currentTime + cacheTtlMs

  return withCacheMetadata(result, false)
}

const clearDatabaseStorageCache = () => {
  cachedStorageResult = null
  cacheExpiresAt = 0
}

module.exports = {
  STORAGE_USAGE_SOURCE,
  buildStorageResult,
  calculateCapacity,
  clearDatabaseStorageCache,
  getDatabaseStorageStatus,
  isUnsupportedCommandError,
  runAtlasSizeCommand,
}
