const MEBIBYTE = 1024 ** 2

const DEFAULT_ATLAS_FREE_LIMIT_BYTES = 512 * MEBIBYTE
const DEFAULT_STORAGE_CACHE_TTL_MS = 3 * 60 * 1000

const getPositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10)

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback
}

const environmentLimitBytes = Number.parseInt(
  process.env.MONGODB_STORAGE_LIMIT_BYTES,
  10,
)
const hasValidEnvironmentLimit =
  Number.isSafeInteger(environmentLimitBytes) && environmentLimitBytes > 0
const configuredLimitBytes = hasValidEnvironmentLimit
  ? environmentLimitBytes
  : DEFAULT_ATLAS_FREE_LIMIT_BYTES

const databaseStorageConfig = Object.freeze({
  cacheTtlMs: getPositiveInteger(
    process.env.MONGODB_STORAGE_CACHE_TTL_MS,
    DEFAULT_STORAGE_CACHE_TTL_MS,
  ),
  limitBytes: configuredLimitBytes,
  limitSource: hasValidEnvironmentLimit
    ? 'deployment_environment'
    : 'configured_atlas_free_tier',
})

module.exports = {
  DEFAULT_ATLAS_FREE_LIMIT_BYTES,
  DEFAULT_STORAGE_CACHE_TTL_MS,
  databaseStorageConfig,
}
