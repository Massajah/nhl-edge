const parseAllowedOrigins = () => {
  const configuredOrigins =
    process.env.CLIENT_ORIGIN || process.env.CLIENT_URL || 'http://localhost:5173'

  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

const getCorsOptions = () => {
  const allowedOrigins = parseAllowedOrigins()

  return {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  }
}

module.exports = {
  getCorsOptions,
  parseAllowedOrigins,
}
