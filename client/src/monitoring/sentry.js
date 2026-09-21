const DISABLED_DEFAULT_INTEGRATIONS = new Set([
  'Breadcrumbs',
  'BrowserSession',
  'ConversationId',
  'CultureContext',
  'HttpContext',
])

const cleanEnvironmentValue = (value) => {
  const cleaned = String(value ?? '').trim()
  return cleaned || undefined
}

export const scrubSentryEvent = (event) => {
  const scrubbed = { ...event }

  delete scrubbed.breadcrumbs
  delete scrubbed.contexts
  delete scrubbed.extra
  delete scrubbed.request
  delete scrubbed.tags
  delete scrubbed.user

  return scrubbed
}

export const createClientSentryOptions = (environment = {}) => {
  const dsn = cleanEnvironmentValue(environment.VITE_SENTRY_DSN)

  if (!dsn) return null

  const sentryEnvironment = cleanEnvironmentValue(
    environment.VITE_SENTRY_ENVIRONMENT ?? environment.MODE,
  )
  const release = cleanEnvironmentValue(environment.VITE_SENTRY_RELEASE)

  return {
    beforeSend: scrubSentryEvent,
    dsn,
    enableLogs: false,
    environment: sentryEnvironment,
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter(
        ({ name }) => !DISABLED_DEFAULT_INTEGRATIONS.has(name),
      ),
    release,
    sendDefaultPii: false,
  }
}

export const initializeClientSentry = (sdk, environment = {}) => {
  const options = createClientSentryOptions(environment)

  if (!options) return false

  sdk.init(options)
  return true
}
