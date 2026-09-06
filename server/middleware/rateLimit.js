const DEFAULT_AUTH_RATE_LIMIT = 20
const DEFAULT_AUTH_RATE_WINDOW_MS = 15 * 60 * 1000
const MAX_TRACKED_KEYS = 10000

const toPositiveInteger = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const createRateLimiter = ({
  limit = DEFAULT_AUTH_RATE_LIMIT,
  now = Date.now,
  windowMs = DEFAULT_AUTH_RATE_WINDOW_MS,
} = {}) => {
  const attempts = new Map()

  const middleware = (request, response, next) => {
    const current = Number(now())
    const key = String(request.ip || request.socket?.remoteAddress || 'unknown')
    let record = attempts.get(key)

    if (!record || record.resetAt <= current) {
      record = { count: 0, resetAt: current + windowMs }
      attempts.delete(key)
      attempts.set(key, record)
    }

    record.count += 1
    response.set('RateLimit-Limit', String(limit))
    response.set('RateLimit-Remaining', String(Math.max(0, limit - record.count)))
    response.set('RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)))

    if (record.count > limit) {
      response.set('Retry-After', String(Math.ceil((record.resetAt - current) / 1000)))
      response.status(429).json({
        error: 'Too many authentication attempts. Try again later.',
        message: 'Too many authentication attempts. Try again later.',
      })
      return
    }

    while (attempts.size > MAX_TRACKED_KEYS) {
      attempts.delete(attempts.keys().next().value)
    }

    next()
  }

  middleware.clear = () => attempts.clear()
  return middleware
}

const authRateLimit = createRateLimiter({
  limit: toPositiveInteger(process.env.AUTH_RATE_LIMIT, DEFAULT_AUTH_RATE_LIMIT),
  windowMs: toPositiveInteger(
    process.env.AUTH_RATE_WINDOW_MS,
    DEFAULT_AUTH_RATE_WINDOW_MS,
  ),
})

module.exports = {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_AUTH_RATE_WINDOW_MS,
  authRateLimit,
  createRateLimiter,
}
