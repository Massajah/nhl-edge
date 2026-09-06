const DEFAULT_SESSION_COOKIE_NAME = 'nhl_edge_session'
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_COOKIE_PATH = '/api'
const VALID_SAME_SITE_VALUES = new Set(['lax', 'none', 'strict'])

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback

  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false

  throw new Error('Boolean authentication configuration must be true or false.')
}

const getSessionTtlMs = (environment = process.env) => {
  if (
    environment.SESSION_TTL_MS === undefined ||
    environment.SESSION_TTL_MS === null ||
    environment.SESSION_TTL_MS === ''
  ) {
    return DEFAULT_SESSION_TTL_MS
  }

  const configured = Number(environment.SESSION_TTL_MS)

  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error('SESSION_TTL_MS must be a positive number.')
  }

  return configured
}

const getSessionCookieConfig = (environment = process.env) => {
  const production = environment.NODE_ENV === 'production'
  const sameSite = String(
    environment.SESSION_COOKIE_SAME_SITE || (production ? 'none' : 'lax'),
  ).toLowerCase()

  if (!VALID_SAME_SITE_VALUES.has(sameSite)) {
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax, none or strict.')
  }

  const secure = parseBoolean(environment.SESSION_COOKIE_SECURE, production)

  if (sameSite === 'none' && !secure) {
    throw new Error('SameSite=None session cookies must also be Secure.')
  }

  const name = String(
    environment.SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME,
  ).trim()

  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('SESSION_COOKIE_NAME contains unsupported characters.')
  }

  return {
    name,
    options: {
      httpOnly: true,
      path: SESSION_COOKIE_PATH,
      sameSite,
      secure,
    },
    ttlMs: getSessionTtlMs(environment),
  }
}

const isLocalAuthEnabled = (environment = process.env) =>
  parseBoolean(environment.LOCAL_AUTH_ENABLED, false)

const assertAuthConfig = (environment = process.env) => {
  getSessionCookieConfig(environment)

  if (
    environment.NODE_ENV === 'production' &&
    !String(environment.GOOGLE_CLIENT_ID ?? '').trim()
  ) {
    throw new Error('GOOGLE_CLIENT_ID is required in production.')
  }
}

module.exports = {
  DEFAULT_SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
  SESSION_COOKIE_PATH,
  assertAuthConfig,
  getSessionCookieConfig,
  getSessionTtlMs,
  isLocalAuthEnabled,
}
