const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.the-odds-api.com',
  cacheTtlMs: 10 * 60 * 1000,
  dateFormat: 'iso',
  lowCreditThreshold: 25,
  market: 'h2h',
  minimumRefreshIntervalMs: 30 * 1000,
  oddsFormat: 'decimal',
  region: 'eu',
  requestTimeoutMs: 8000,
  sport: 'icehockey_nhl',
})

const getPositiveNumber = (value, fallback) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : fallback
}

const getMarketOddsConfig = (environment = process.env) => ({
  apiKey: String(environment.THE_ODDS_API_KEY ?? '').trim(),
  baseUrl: String(
    environment.THE_ODDS_API_BASE_URL ?? DEFAULTS.baseUrl,
  ).replace(/\/$/, ''),
  cacheTtlMs: getPositiveNumber(
    environment.MARKET_ODDS_CACHE_TTL_MS,
    DEFAULTS.cacheTtlMs,
  ),
  dateFormat: DEFAULTS.dateFormat,
  lowCreditThreshold: getPositiveNumber(
    environment.MARKET_ODDS_LOW_CREDIT_THRESHOLD,
    DEFAULTS.lowCreditThreshold,
  ),
  market: String(environment.THE_ODDS_API_MARKET ?? DEFAULTS.market),
  minimumRefreshIntervalMs: getPositiveNumber(
    environment.MARKET_ODDS_MIN_REFRESH_INTERVAL_MS,
    DEFAULTS.minimumRefreshIntervalMs,
  ),
  oddsFormat: String(
    environment.THE_ODDS_API_ODDS_FORMAT ?? DEFAULTS.oddsFormat,
  ),
  region: String(environment.THE_ODDS_API_REGION ?? DEFAULTS.region),
  requestTimeoutMs: getPositiveNumber(
    environment.MARKET_ODDS_REQUEST_TIMEOUT_MS,
    DEFAULTS.requestTimeoutMs,
  ),
  sport: String(environment.THE_ODDS_API_SPORT ?? DEFAULTS.sport),
})

const getSafeMarketOddsConfiguration = (config = getMarketOddsConfig()) => ({
  cacheTtlMs: config.cacheTtlMs,
  configured: Boolean(config.apiKey),
  market: 'Moneyline',
  provider: 'The Odds API',
  region: config.region.toUpperCase(),
  sport: 'NHL',
})

module.exports = {
  DEFAULTS,
  getMarketOddsConfig,
  getSafeMarketOddsConfiguration,
}
