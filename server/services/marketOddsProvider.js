const { getMarketOddsConfig } = require('../config/marketOdds')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const VALID_STATUS_VALUES = new Set([
  'invalid_response',
  'not_configured',
  'quota_exhausted',
  'rate_limited',
  'unavailable',
])

class MarketOddsProviderError extends Error {
  constructor(status, message, options = {}) {
    super(message)
    this.name = 'MarketOddsProviderError'
    this.quota = options.quota ?? null
    this.status = VALID_STATUS_VALUES.has(status) ? status : 'unavailable'
    this.upstreamStatus = options.upstreamStatus ?? null
  }
}

const getHeaderValue = (headers, name) => {
  if (!headers) {
    return null
  }

  return typeof headers.get === 'function'
    ? headers.get(name)
    : headers[name] ?? headers[name.toLowerCase()] ?? null
}

const toQuotaNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const normalizeQuotaHeaders = (headers, observedAt = new Date().toISOString()) => {
  const quota = {
    lastCost: toQuotaNumber(getHeaderValue(headers, 'x-requests-last')),
    observedAt,
    remaining: toQuotaNumber(getHeaderValue(headers, 'x-requests-remaining')),
    used: toQuotaNumber(getHeaderValue(headers, 'x-requests-used')),
  }

  return Object.values(quota).some((value, index) => index < 3 && value !== null)
    ? quota
    : null
}

const isValidDecimalOdds = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 1
}

const normalizeBookmaker = (bookmaker, eventIdentities) => {
  if (!bookmaker || typeof bookmaker !== 'object') {
    return null
  }

  const market = Array.isArray(bookmaker.markets)
    ? bookmaker.markets.find((candidate) => candidate?.key === 'h2h')
    : null

  if (!market || !Array.isArray(market.outcomes)) {
    return null
  }

  const prices = {}

  market.outcomes.forEach((outcome) => {
    const identity = getNhlTeamIdentity(outcome?.name)

    if (
      identity &&
      eventIdentities.has(identity) &&
      isValidDecimalOdds(outcome?.price)
    ) {
      prices[identity] = Number(outcome.price)
    }
  })

  const homeOdds = prices[eventIdentities.home]
  const awayOdds = prices[eventIdentities.away]

  if (!isValidDecimalOdds(homeOdds) || !isValidDecimalOdds(awayOdds)) {
    return null
  }

  return {
    awayOdds,
    bookmakerKey: String(bookmaker.key ?? '').trim(),
    bookmakerTitle: String(bookmaker.title ?? bookmaker.key ?? '').trim(),
    homeOdds,
    lastUpdate: market.last_update ?? bookmaker.last_update ?? null,
  }
}

const selectBestOdds = (bookmakers, side) => {
  const oddsKey = side === 'home' ? 'homeOdds' : 'awayOdds'
  const best = bookmakers.reduce((currentBest, bookmaker) => {
    if (!currentBest || bookmaker[oddsKey] > currentBest[oddsKey]) {
      return bookmaker
    }

    return currentBest
  }, null)

  return best
    ? {
        bookmakerKey: best.bookmakerKey,
        bookmakerTitle: best.bookmakerTitle,
        lastUpdate: best.lastUpdate,
        odds: best[oddsKey],
      }
    : null
}

const normalizeProviderEvent = (event, providerFetchedAt) => {
  if (!event || typeof event !== 'object') {
    return null
  }

  const homeIdentity = getNhlTeamIdentity(event.home_team)
  const awayIdentity = getNhlTeamIdentity(event.away_team)
  const commenceTimeMs = Date.parse(event.commence_time)

  if (!homeIdentity || !awayIdentity || !Number.isFinite(commenceTimeMs)) {
    return null
  }

  const eventIdentities = new Set([homeIdentity, awayIdentity])
  eventIdentities.home = homeIdentity
  eventIdentities.away = awayIdentity
  const bookmakers = (Array.isArray(event.bookmakers) ? event.bookmakers : [])
    .map((bookmaker) => normalizeBookmaker(bookmaker, eventIdentities))
    .filter(Boolean)

  return {
    awayTeamIdentity: awayIdentity,
    awayTeamName: String(event.away_team),
    bestAvailable: {
      away: selectBestOdds(bookmakers, 'away'),
      home: selectBestOdds(bookmakers, 'home'),
    },
    bookmakers,
    commenceTime: new Date(commenceTimeMs).toISOString(),
    homeTeamIdentity: homeIdentity,
    homeTeamName: String(event.home_team),
    providerEventId: String(event.id ?? '').trim(),
    providerFetchedAt,
    sportKey: String(event.sport_key ?? 'icehockey_nhl'),
  }
}

const normalizeProviderEvents = (body, providerFetchedAt) => {
  if (!Array.isArray(body)) {
    throw new MarketOddsProviderError(
      'invalid_response',
      'The market odds provider returned an invalid response.',
    )
  }

  return body
    .map((event) => normalizeProviderEvent(event, providerFetchedAt))
    .filter(Boolean)
}

const parseResponseBody = async (response) => {
  try {
    if (typeof response.text === 'function') {
      const text = await response.text()

      return text ? JSON.parse(text) : null
    }

    return await response.json()
  } catch {
    throw new MarketOddsProviderError(
      'invalid_response',
      'The market odds provider returned invalid JSON.',
    )
  }
}

const getProviderFailureStatus = (response, body) => {
  const errorCode = String(body?.error_code ?? '').toUpperCase()
  const message = String(body?.message ?? '').toUpperCase()

  if (
    errorCode === 'OUT_OF_USAGE_CREDITS' ||
    message.includes('OUT_OF_USAGE_CREDITS') ||
    message.includes('USAGE CREDITS')
  ) {
    return 'quota_exhausted'
  }

  if (response.status === 429) {
    return 'rate_limited'
  }

  if (response.status === 401 || response.status === 403) {
    return 'not_configured'
  }

  return 'unavailable'
}

const createMarketOddsProvider = ({
  fetchImpl = fetch,
  getConfig = getMarketOddsConfig,
  now = () => new Date(),
} = {}) => ({
  async fetchNhlOdds({ commenceTimeFrom, commenceTimeTo }) {
    const config = getConfig()

    if (!config.apiKey) {
      return {
        events: [],
        providerFetchedAt: null,
        quota: null,
        status: 'not_configured',
      }
    }

    const url = new URL(
      `/v4/sports/${encodeURIComponent(config.sport)}/odds`,
      config.baseUrl,
    )
    url.searchParams.set('apiKey', config.apiKey)
    url.searchParams.set('regions', config.region)
    url.searchParams.set('markets', config.market)
    url.searchParams.set('oddsFormat', config.oddsFormat)
    url.searchParams.set('dateFormat', config.dateFormat)
    url.searchParams.set('commenceTimeFrom', commenceTimeFrom)
    url.searchParams.set('commenceTimeTo', commenceTimeTo)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      const providerFetchedAt = now().toISOString()
      const quota = normalizeQuotaHeaders(response.headers, providerFetchedAt)
      let body

      try {
        body = await parseResponseBody(response)
      } catch (error) {
        if (!response.ok) {
          throw new MarketOddsProviderError(
            getProviderFailureStatus(response, null),
            'The market odds provider request was unsuccessful.',
            { quota, upstreamStatus: response.status },
          )
        }

        error.quota = quota
        throw error
      }

      if (!response.ok) {
        throw new MarketOddsProviderError(
          getProviderFailureStatus(response, body),
          'The market odds provider request was unsuccessful.',
          { quota, upstreamStatus: response.status },
        )
      }

      let events

      try {
        events = normalizeProviderEvents(body, providerFetchedAt)
      } catch (error) {
        error.quota = quota
        throw error
      }

      return {
        events,
        providerFetchedAt,
        quota,
        status: 'ready',
      }
    } catch (error) {
      if (error instanceof MarketOddsProviderError) {
        throw error
      }

      throw new MarketOddsProviderError(
        'unavailable',
        error?.name === 'AbortError'
          ? 'The market odds provider request timed out.'
          : 'The market odds provider is unavailable.',
      )
    } finally {
      clearTimeout(timeout)
    }
  },
})

module.exports = {
  MarketOddsProviderError,
  createMarketOddsProvider,
  isValidDecimalOdds,
  normalizeProviderEvent,
  normalizeProviderEvents,
  normalizeQuotaHeaders,
  selectBestOdds,
}
