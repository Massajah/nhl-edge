const DEVELOPMENT_ORIGIN = 'http://localhost:5173'
const PRODUCTION_ORIGIN = 'https://nhl-edge-rouge.vercel.app'

const normalizeOrigin = (origin) => String(origin ?? '').trim().replace(/\/$/, '')

const parseAllowedOrigins = (environment = process.env) => {
  const configuredOrigins = environment.CLIENT_ORIGIN || environment.CLIENT_URL
  const candidates = configuredOrigins
    ? String(configuredOrigins).split(',')
    : [
        environment.NODE_ENV === 'production'
          ? PRODUCTION_ORIGIN
          : DEVELOPMENT_ORIGIN,
      ]

  return [...new Set(candidates.map(normalizeOrigin).filter(Boolean))]
}

const isAllowedOrigin = (origin, environment = process.env) =>
  parseAllowedOrigins(environment).includes(normalizeOrigin(origin))

const getCorsOptions = (environment = process.env) => ({
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin, environment)) {
      callback(null, true)
      return
    }

    const error = new Error('Origin is not allowed.')
    error.statusCode = 403
    callback(error)
  },
})

module.exports = {
  DEVELOPMENT_ORIGIN,
  PRODUCTION_ORIGIN,
  getCorsOptions,
  isAllowedOrigin,
  normalizeOrigin,
  parseAllowedOrigins,
}
