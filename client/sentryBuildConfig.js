const cleanEnvironmentValue = (value) => String(value ?? '').trim()

export const resolveSentryRelease = (environment = {}) =>
  cleanEnvironmentValue(environment.VITE_SENTRY_RELEASE) ||
  cleanEnvironmentValue(environment.SENTRY_RELEASE) ||
  cleanEnvironmentValue(environment.VERCEL_GIT_COMMIT_SHA) ||
  ''
