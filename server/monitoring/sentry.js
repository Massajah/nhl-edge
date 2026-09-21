const Sentry = require('@sentry/node')

const SENTRY_FLUSH_TIMEOUT_MS = 2_000
const DISABLED_DEFAULT_INTEGRATIONS = new Set([
  'ChildProcess',
  'Console',
  'ConversationId',
  'Http',
  'LocalVariablesAsync',
  'NodeFetch',
  'ProcessSession',
  'RequestData',
])

let initialized = false

const cleanEnvironmentValue = (value) => {
  const cleaned = String(value ?? '').trim()
  return cleaned || undefined
}

const getErrorStatusCode = (error) => {
  const value =
    error?.statusCode ??
    error?.status ??
    error?.status_code ??
    error?.output?.statusCode
  const statusCode = Number(value)

  return Number.isFinite(statusCode) ? statusCode : null
}

const shouldCaptureExpressError = (error) => {
  const statusCode = getErrorStatusCode(error)

  return statusCode === null || statusCode >= 500
}

const scrubSentryEvent = (event) => {
  const scrubbed = { ...event }

  delete scrubbed.breadcrumbs
  delete scrubbed.contexts
  delete scrubbed.extra
  delete scrubbed.request
  delete scrubbed.tags
  delete scrubbed.user

  return scrubbed
}

const createServerSentryOptions = (
  environment = process.env,
  sdk = Sentry,
) => {
  const dsn = cleanEnvironmentValue(environment.SENTRY_DSN)

  if (!dsn) return null

  const sentryEnvironment = cleanEnvironmentValue(
    environment.SENTRY_ENVIRONMENT ?? environment.NODE_ENV,
  )
  const release = cleanEnvironmentValue(environment.SENTRY_RELEASE)

  return {
    beforeSend: scrubSentryEvent,
    dsn,
    enableLogs: false,
    environment: sentryEnvironment,
    integrations: (defaultIntegrations) => [
      ...defaultIntegrations.filter(
        ({ name }) => !DISABLED_DEFAULT_INTEGRATIONS.has(name),
      ),
      sdk.expressIntegration({
        shouldHandleError: shouldCaptureExpressError,
      }),
    ],
    release,
    sendDefaultPii: false,
  }
}

const initializeServerSentry = ({
  environment = process.env,
  sdk = Sentry,
} = {}) => {
  const options = createServerSentryOptions(environment, sdk)

  if (!options) return false

  sdk.init(options)
  initialized = true
  return true
}

const setupExpressMonitoring = (app, sdk = Sentry) => {
  if (!initialized) return false

  sdk.setupExpressErrorHandler(app)
  return true
}

const captureExceptionAndFlush = async (
  error,
  {
    enabled = initialized,
    flushTimeoutMs = SENTRY_FLUSH_TIMEOUT_MS,
    sdk = Sentry,
  } = {},
) => {
  if (!enabled) return false

  try {
    sdk.captureException(error)
    return await sdk.flush(flushTimeoutMs)
  } catch {
    return false
  }
}

module.exports = {
  SENTRY_FLUSH_TIMEOUT_MS,
  captureExceptionAndFlush,
  createServerSentryOptions,
  initializeServerSentry,
  scrubSentryEvent,
  setupExpressMonitoring,
  shouldCaptureExpressError,
}
