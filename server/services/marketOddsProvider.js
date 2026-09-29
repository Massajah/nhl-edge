const { getMarketOddsConfig } = require('../config/marketOdds')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

// Verified for NHL: Coolbet's h2h is a regulation three-way market, while
// its event-level h2h_ot is the full-game two-way moneyline.
const COMPATIBLE_MARKET_BY_BOOKMAKER = Object.freeze({ coolbet: 'h2h_ot' })
const compatibleMarketKey = (bookmakerKey) =>
  COMPATIBLE_MARKET_BY_BOOKMAKER[bookmakerKey] ?? 'h2h'
const isCompatibleBookmakerRow = (row) => {
  const key = String(row?.key ?? row?.bookmakerKey ?? '').trim()
  const market = String(row?.providerMarketKey ?? '').trim()
  return key !== 'coolbet'
    ? !market || market === 'h2h'
    : market === 'h2h_ot'
}

const VALID_STATUS_VALUES = new Set([
  'authentication_failed',
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

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null
}

const getQuotaRemainingLevel = (remaining, remainingPercent) => {
  if (!Number.isFinite(remaining) || !Number.isFinite(remainingPercent)) {
    return 'unknown'
  }

  if (remaining === 0) {
    return 'exhausted'
  }

  if (remainingPercent <= 10) {
    return 'high'
  }

  if (remainingPercent <= 30) {
    return 'warning'
  }

  return 'healthy'
}

const normalizeQuotaMetadata = (quota, observedAt = null) => {
  if (!quota || typeof quota !== 'object') {
    return null
  }

  const lastCost = toQuotaNumber(quota.lastCost)
  const remaining = toQuotaNumber(quota.remaining)
  const used = toQuotaNumber(quota.used)
  const total =
    Number.isFinite(remaining) && Number.isFinite(used)
      ? remaining + used
      : null
  const remainingPercent =
    Number.isFinite(total) && total > 0
      ? Math.min(100, Math.max(0, (remaining / total) * 100))
      : total === 0 && remaining === 0
        ? 0
        : null

  if (lastCost === null && remaining === null && used === null) {
    return null
  }

  return {
    lastCost,
    observedAt: quota.observedAt ?? observedAt,
    remaining,
    remainingLevel: getQuotaRemainingLevel(remaining, remainingPercent),
    remainingPercent,
    total,
    used,
  }
}

const normalizeQuotaHeaders = (headers, observedAt = new Date().toISOString()) => {
  const quota = {
    lastCost: toQuotaNumber(getHeaderValue(headers, 'x-requests-last')),
    observedAt,
    remaining: toQuotaNumber(getHeaderValue(headers, 'x-requests-remaining')),
    used: toQuotaNumber(getHeaderValue(headers, 'x-requests-used')),
  }

  return normalizeQuotaMetadata(quota, observedAt)
}

const isValidDecimalOdds = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 1
}

const reportNormalizationWarning = (onWarning, code, details = {}) => {
  if (typeof onWarning === 'function') {
    onWarning({ code, ...details })
  }
}

const normalizeBookmaker = (
  bookmaker,
  eventIdentities,
  { onWarning, providerEventId } = {},
) => {
  if (!bookmaker || typeof bookmaker !== 'object') {
    reportNormalizationWarning(onWarning, 'invalid_bookmaker', {
      providerEventId,
    })
    return null
  }

  const bookmakerKey = String(bookmaker.key ?? '').trim()

  if (!bookmakerKey) {
    reportNormalizationWarning(onWarning, 'missing_bookmaker_key', {
      providerEventId,
    })
    return null
  }

  const providerMarketKey = compatibleMarketKey(bookmakerKey)
  const market = Array.isArray(bookmaker.markets)
    ? bookmaker.markets.find((candidate) => candidate?.key === providerMarketKey)
    : null

  if (!market || !Array.isArray(market.outcomes)) {
    reportNormalizationWarning(onWarning, 'missing_h2h_market', {
      bookmakerKey,
      providerEventId,
    })
    return null
  }

  if (market.outcomes.length !== 2) {
    reportNormalizationWarning(onWarning, 'invalid_h2h_outcome_count', {
      bookmakerKey,
      providerEventId,
    })
    return null
  }

  const prices = {}

  for (const outcome of market.outcomes) {
    const teamName = String(outcome?.name ?? '').trim()
    const identity = getNhlTeamIdentity(teamName)

    if (!identity) {
      reportNormalizationWarning(onWarning, 'unknown_team', {
        bookmakerKey,
        providerEventId,
        teamName,
      })
      return null
    }

    if (!eventIdentities.allowed.has(identity)) {
      reportNormalizationWarning(onWarning, 'unexpected_h2h_outcome', {
        bookmakerKey,
        providerEventId,
        teamName,
      })
      return null
    }

    if (Object.hasOwn(prices, identity)) {
      reportNormalizationWarning(onWarning, 'duplicate_h2h_outcome', {
        bookmakerKey,
        providerEventId,
      })
      return null
    }

    if (
      typeof outcome?.price !== 'number' ||
      !isValidDecimalOdds(outcome.price)
    ) {
      reportNormalizationWarning(onWarning, 'invalid_h2h_price', {
        bookmakerKey,
        providerEventId,
      })
      return null
    }

    prices[identity] = Number(outcome.price)
  }

  const homeOdds = prices[eventIdentities.home]
  const awayOdds = prices[eventIdentities.away]

  if (!isValidDecimalOdds(homeOdds) || !isValidDecimalOdds(awayOdds)) {
    reportNormalizationWarning(onWarning, 'incomplete_h2h_market', {
      bookmakerKey,
      providerEventId,
    })
    return null
  }

  const bookmakerTitle = String(bookmaker.title ?? bookmakerKey).trim()
  const lastUpdate = bookmaker.last_update ?? market.last_update ?? null

  return {
    awayOdds,
    bookmakerKey,
    bookmakerTitle,
    homeOdds,
    key: bookmakerKey,
    lastUpdate,
    providerMarketKey,
    title: bookmakerTitle,
  }
}

const selectBestOdds = (bookmakers, side) => {
  const oddsKey = side === 'home' ? 'homeOdds' : 'awayOdds'
  const best = (Array.isArray(bookmakers) ? bookmakers : []).reduce(
    (currentBest, bookmaker) => {
      if (
        !isValidDecimalOdds(bookmaker?.awayOdds) ||
        !isValidDecimalOdds(bookmaker?.homeOdds)
      ) {
        return currentBest
      }

      if (
        !currentBest ||
        Number(bookmaker[oddsKey]) > Number(currentBest[oddsKey])
      ) {
        return bookmaker
      }

      if (Number(bookmaker[oddsKey]) === Number(currentBest[oddsKey])) {
        const bookmakerIdentity = `${bookmaker.bookmakerKey ?? ''}|${bookmaker.bookmakerTitle ?? ''}`
        const currentIdentity = `${currentBest.bookmakerKey ?? ''}|${currentBest.bookmakerTitle ?? ''}`

        return bookmakerIdentity < currentIdentity ? bookmaker : currentBest
      }

      return currentBest
    },
    null,
  )

  return best
    ? {
        bookmakerKey: best.bookmakerKey,
        bookmakerTitle: best.bookmakerTitle,
        lastUpdate: best.lastUpdate,
        odds: Number(best[oddsKey]),
        providerMarketKey: best.providerMarketKey,
        providerFetchedAt: best.providerFetchedAt ?? null,
      }
    : null
}

const normalizeProviderEvent = (
  event,
  providerFetchedAt,
  { onWarning } = {},
) => {
  if (!event || typeof event !== 'object') {
    reportNormalizationWarning(onWarning, 'invalid_event')
    return null
  }

  const providerEventId = String(event.id ?? '').trim()
  const homeIdentity = getNhlTeamIdentity(event.home_team)
  const awayIdentity = getNhlTeamIdentity(event.away_team)
  const commenceTimeMs = Date.parse(event.commence_time)
  const sportKey = String(event.sport_key ?? 'icehockey_nhl')

  if (
    !providerEventId ||
    !homeIdentity ||
    !awayIdentity ||
    homeIdentity === awayIdentity ||
    !Number.isFinite(commenceTimeMs) ||
    sportKey !== 'icehockey_nhl'
  ) {
    if (!homeIdentity) {
      reportNormalizationWarning(onWarning, 'unknown_team', {
        providerEventId,
        side: 'home',
        teamName: String(event.home_team ?? '').trim(),
      })
    }

    if (!awayIdentity) {
      reportNormalizationWarning(onWarning, 'unknown_team', {
        providerEventId,
        side: 'away',
        teamName: String(event.away_team ?? '').trim(),
      })
    }

    reportNormalizationWarning(onWarning, 'invalid_event', {
      providerEventId,
    })
    return null
  }

  const eventIdentities = {
    allowed: new Set([homeIdentity, awayIdentity]),
    away: awayIdentity,
    home: homeIdentity,
  }
  const bookmakers = (Array.isArray(event.bookmakers) ? event.bookmakers : [])
    .map((bookmaker) =>
      normalizeBookmaker(bookmaker, eventIdentities, {
        onWarning,
        providerEventId,
      }),
    )
    .filter(Boolean)

  if (bookmakers.length === 0) {
    reportNormalizationWarning(onWarning, 'no_usable_bookmakers', {
      providerEventId,
    })
  }

  const awayTeamName = String(event.away_team)
  const homeTeamName = String(event.home_team)

  return {
    awayTeam: awayTeamName,
    awayTeamIdentity: awayIdentity,
    awayTeamName,
    bestAvailable: {
      away: selectBestOdds(bookmakers, 'away'),
      home: selectBestOdds(bookmakers, 'home'),
    },
    bookmakers,
    commenceTime: new Date(commenceTimeMs).toISOString(),
    homeTeam: homeTeamName,
    homeTeamIdentity: homeIdentity,
    homeTeamName,
    providerEventId,
    providerFetchedAt,
    sportKey,
  }
}

const normalizeProviderEvents = (body, providerFetchedAt, options = {}) => {
  if (!Array.isArray(body)) {
    throw new MarketOddsProviderError(
      'invalid_response',
      'The market odds provider returned an invalid response.',
    )
  }

  return body
    .map((event) => normalizeProviderEvent(event, providerFetchedAt, options))
    .filter(Boolean)
}

const normalizeProviderResponse = (body, providerFetchedAt) => {
  const normalizationWarnings = []
  const onWarning = (warning) => {
    if (normalizationWarnings.length < 50) {
      normalizationWarnings.push(warning)
    }
  }

  return {
    events: normalizeProviderEvents(body, providerFetchedAt, { onWarning }),
    normalizationWarnings,
  }
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

  if (
    response.status === 401 ||
    response.status === 403 ||
    ['DEACTIVATED_KEY', 'INVALID_KEY', 'MISSING_KEY'].includes(errorCode)
  ) {
    return 'authentication_failed'
  }

  return 'unavailable'
}

const parseCommenceTime = (value) => {
  const timeMs = Date.parse(value)

  if (!Number.isFinite(timeMs)) {
    throw new MarketOddsProviderError(
      'invalid_response',
      'The market odds provider request has an invalid commence time.',
    )
  }

  return timeMs
}

const formatWholeSecondUtc = (timeMs) =>
  new Date(timeMs).toISOString().replace('.000Z', 'Z')

const createMarketOddsProvider = ({
  fetchImpl = fetch,
  getConfig = getMarketOddsConfig,
  now = () => new Date(),
} = {}) => {
  const fetchNhlMoneylineOdds = async ({
    bookmakerKeys,
    commenceTimeFrom,
    commenceTimeTo,
  } = {}) => {
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
    const supportedBookmakerKeys = new Set(
      config.bookmakers.map(({ key }) => key),
    )
    const requestedBookmakerKeys = [
      ...new Set(
        (Array.isArray(bookmakerKeys) ? bookmakerKeys : config.bookmakers.map(({ key }) => key))
          .map((key) => String(key ?? '').trim())
          .filter((key) => supportedBookmakerKeys.has(key)),
      ),
    ]

    if (requestedBookmakerKeys.length === 0) {
      return {
        events: [],
        providerFetchedAt: null,
        quota: null,
        status: 'no_events',
      }
    }

    url.searchParams.set('apiKey', config.apiKey)
    url.searchParams.set(
      'bookmakers',
      requestedBookmakerKeys.join(','),
    )
    url.searchParams.set('markets', config.market)
    url.searchParams.set('oddsFormat', config.oddsFormat)
    url.searchParams.set('dateFormat', config.dateFormat)

    if (commenceTimeFrom) {
      const fromMs = parseCommenceTime(commenceTimeFrom)

      if (fromMs >= now().getTime()) {
        // Round outwards to retain the original inclusive interval.
        url.searchParams.set(
          'commenceTimeFrom',
          formatWholeSecondUtc(Math.floor(fromMs / 1000) * 1000),
        )
      }
    }

    if (commenceTimeTo) {
      const toMs = parseCommenceTime(commenceTimeTo)
      url.searchParams.set(
        'commenceTimeTo',
        formatWholeSecondUtc(Math.ceil(toMs / 1000) * 1000),
      )
    }

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

      let normalized

      try {
        normalized = normalizeProviderResponse(body, providerFetchedAt)
      } catch (error) {
        error.quota = quota
        throw error
      }

      return {
        diagnostics: {
          normalizationWarnings: normalized.normalizationWarnings,
        },
        events: normalized.events,
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
  }

  const fetchCoolbetMoneylineOdds = async ({ event }) => {
    const config = getConfig()
    const eventId = String(event?.providerEventId ?? '').trim()

    if (!config.apiKey || !/^[a-zA-Z0-9_-]+$/.test(eventId)) {
      return { bookmaker: null, providerFetchedAt: null, quota: null }
    }

    const url = new URL(
      `/v4/sports/${encodeURIComponent(config.sport)}/events/${encodeURIComponent(eventId)}/odds`,
      config.baseUrl,
    )
    url.searchParams.set('apiKey', config.apiKey)
    url.searchParams.set('bookmakers', 'coolbet')
    url.searchParams.set('markets', 'h2h_ot')
    url.searchParams.set('oddsFormat', config.oddsFormat)
    url.searchParams.set('dateFormat', config.dateFormat)

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

      const normalized = normalizeProviderEvent(body, providerFetchedAt)
      const sameEvent =
        normalized?.providerEventId === eventId &&
        normalized.homeTeamIdentity === event.homeTeamIdentity &&
        normalized.awayTeamIdentity === event.awayTeamIdentity &&
        normalized.commenceTime === event.commenceTime
      const rawCoolbetCount = (Array.isArray(body?.bookmakers) ? body.bookmakers : [])
        .filter((row) => row?.key === 'coolbet').length
      const compatibleRows = normalized?.bookmakers.filter(
        (row) => row.bookmakerKey === 'coolbet' && row.providerMarketKey === 'h2h_ot',
      ) ?? []

      return {
        bookmaker: sameEvent && rawCoolbetCount === 1 && compatibleRows.length === 1
          ? compatibleRows[0]
          : null,
        providerFetchedAt,
        quota,
      }
    } catch (error) {
      if (error instanceof MarketOddsProviderError) throw error
      throw new MarketOddsProviderError(
        'unavailable',
        error?.name === 'AbortError'
          ? 'The market odds provider request timed out.'
          : 'The market odds provider is unavailable.',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    fetchCoolbetMoneylineOdds,
    fetchNhlMoneylineOdds,
    fetchNhlOdds: fetchNhlMoneylineOdds,
  }
}

module.exports = {
  MarketOddsProviderError,
  createMarketOddsProvider,
  compatibleMarketKey,
  isCompatibleBookmakerRow,
  isValidDecimalOdds,
  normalizeProviderEvent,
  normalizeProviderEvents,
  normalizeProviderResponse,
  normalizeQuotaHeaders,
  normalizeQuotaMetadata,
  selectBestOdds,
}
