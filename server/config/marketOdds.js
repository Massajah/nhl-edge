const REQUESTED_BOOKMAKERS = Object.freeze([
  Object.freeze({ key: 'veikkaus_fi', title: 'Veikkaus' }),
  Object.freeze({ key: 'unibet_fi', title: 'Unibet FI' }),
  Object.freeze({ key: 'coolbet', title: 'Coolbet' }),
  Object.freeze({ key: 'pinnacle', title: 'Pinnacle' }),
  Object.freeze({ key: 'betsson', title: 'Betsson' }),
  Object.freeze({ key: 'nordicbet', title: 'NordicBet' }),
  Object.freeze({ key: 'leovegas_fi', title: 'LeoVegas FI' }),
  Object.freeze({ key: 'williamhill', title: 'William Hill' }),
  Object.freeze({ key: 'sport888', title: '888sport' }),
])

// Backward-compatible export for Phase 1 consumers. These are the fixed
// requested bookmakers, not a statement about current market availability.
const CANDIDATE_BOOKMAKERS = REQUESTED_BOOKMAKERS

const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.the-odds-api.com',
  cacheTtlMs: 10 * 60 * 1000,
  dateFormat: 'iso',
  lowCreditThreshold: 25,
  market: 'h2h',
  minimumRefreshIntervalMs: 30 * 1000,
  oddsFormat: 'decimal',
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
  bookmakers: REQUESTED_BOOKMAKERS,
  cacheTtlMs: getPositiveNumber(
    environment.MARKET_ODDS_CACHE_TTL_MS,
    DEFAULTS.cacheTtlMs,
  ),
  dateFormat: DEFAULTS.dateFormat,
  lowCreditThreshold: getPositiveNumber(
    environment.MARKET_ODDS_LOW_CREDIT_THRESHOLD,
    DEFAULTS.lowCreditThreshold,
  ),
  market: DEFAULTS.market,
  minimumRefreshIntervalMs: getPositiveNumber(
    environment.MARKET_ODDS_MIN_REFRESH_INTERVAL_MS,
    DEFAULTS.minimumRefreshIntervalMs,
  ),
  oddsFormat: DEFAULTS.oddsFormat,
  requestTimeoutMs: getPositiveNumber(
    environment.MARKET_ODDS_REQUEST_TIMEOUT_MS,
    DEFAULTS.requestTimeoutMs,
  ),
  sport: DEFAULTS.sport,
})

const getSafeMarketOddsConfiguration = (config = getMarketOddsConfig()) => ({
  bookmakers: config.bookmakers.map(({ key, title }) => ({ key, title })),
  cacheTtlMs: config.cacheTtlMs,
  configured: Boolean(config.apiKey),
  expectedRequestCredits: 1,
  market: 'Moneyline',
  provider: 'The Odds API',
  requestScope: 'Explicit bookmakers',
  sport: 'NHL',
})

module.exports = {
  CANDIDATE_BOOKMAKERS,
  DEFAULTS,
  REQUESTED_BOOKMAKERS,
  getMarketOddsConfig,
  getSafeMarketOddsConfiguration,
}
