const DEFAULT_DEMO_SANDBOX_TTL_HOURS = 4
const DEFAULT_DEMO_CLEANUP_BATCH_SIZE = 100

const parsePositiveNumber = (value, fallback, field) => {
  if (value === undefined || value === null || value === '') return fallback

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number.`)
  }

  return parsed
}

const parsePositiveInteger = (value, fallback, field) => {
  const parsed = parsePositiveNumber(value, fallback, field)

  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be a positive integer.`)
  }

  return parsed
}

const getDemoSandboxTtlMs = (environment = process.env) =>
  parsePositiveNumber(
    environment.DEMO_SANDBOX_TTL_HOURS,
    DEFAULT_DEMO_SANDBOX_TTL_HOURS,
    'DEMO_SANDBOX_TTL_HOURS',
  ) * 60 * 60 * 1000

const getDemoCleanupBatchSize = (environment = process.env) =>
  parsePositiveInteger(
    environment.DEMO_CLEANUP_BATCH_SIZE,
    DEFAULT_DEMO_CLEANUP_BATCH_SIZE,
    'DEMO_CLEANUP_BATCH_SIZE',
  )

const assertDemoSandboxConfig = (environment = process.env) => {
  getDemoSandboxTtlMs(environment)
  getDemoCleanupBatchSize(environment)
}

module.exports = {
  DEFAULT_DEMO_CLEANUP_BATCH_SIZE,
  DEFAULT_DEMO_SANDBOX_TTL_HOURS,
  assertDemoSandboxConfig,
  getDemoCleanupBatchSize,
  getDemoSandboxTtlMs,
}
