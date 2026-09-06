const {
  getMarketOddsConfig,
  getSafeMarketOddsConfiguration,
} = require('../config/marketOdds')
const nhlApiService = require('./nhlApiService')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const {
  MarketOddsProviderError,
  createMarketOddsProvider,
  normalizeQuotaMetadata,
} = require('./marketOddsProvider')
const { collectAvailableBookmakers } = require('./bookmakerOddsFilter')
const { oddsQuotaLedgerService } = require('./oddsQuotaLedgerService')

const MATCH_TOLERANCE_MS = 3 * 60 * 60 * 1000
const WINDOW_PADDING_MS = 12 * 60 * 60 * 1000
const STARTED_GAME_STATES = new Set([
  'CRIT',
  'FINAL',
  'LIVE',
  'OFF',
  'POST',
])
const PROVIDER_REQUEST_SOURCES = new Set([
  'MANUAL',
  'AUTOMATIC',
  'CONTROLLED_PROBE',
])

const normalizeProviderRequestSource = (value, fallback = 'MANUAL') => {
  const normalized = String(value ?? fallback).trim().toUpperCase()

  return PROVIDER_REQUEST_SOURCES.has(normalized) ? normalized : fallback
}

const buildCommenceTimeWindow = (date) => {
  if (!nhlApiService.isValidScheduleDate(date)) {
    return null
  }

  const dayStart = Date.parse(`${date}T00:00:00.000Z`)

  return {
    commenceTimeFrom: new Date(dayStart - WINDOW_PADDING_MS).toISOString(),
    commenceTimeTo: new Date(
      dayStart + 24 * 60 * 60 * 1000 + WINDOW_PADDING_MS,
    ).toISOString(),
  }
}

const getMarketOddsCacheKey = (config, window, bookmakerKeys) =>
  [
    config.sport,
    (Array.isArray(bookmakerKeys)
      ? [...bookmakerKeys].sort()
      : config.bookmakers.map(({ key }) => key)
    ).join(','),
    config.market,
    config.oddsFormat,
    window.commenceTimeFrom,
    window.commenceTimeTo,
  ].join('|')

const hasUsableMarketOdds = (events = []) =>
  events.some((event) => Array.isArray(event.bookmakers) && event.bookmakers.length > 0)

const countBookmakerRows = (events = []) =>
  events.reduce(
    (total, event) =>
      total + (Array.isArray(event.bookmakers) ? event.bookmakers.length : 0),
    0,
  )

const isGameStarted = (game, nowMs) => {
  if (STARTED_GAME_STATES.has(String(game.gameState ?? '').toUpperCase())) {
    return true
  }

  const status = String(game.status ?? '').toLowerCase()

  if (
    status.includes('live') ||
    status.includes('final') ||
    status.includes('progress')
  ) {
    return true
  }

  const startTimeMs = Date.parse(game.startTimeUTC)

  return Number.isFinite(startTimeMs) && startTimeMs <= nowMs
}

const getGameTeamIdentities = (game) => ({
  away: getNhlTeamIdentity(
    game.awayTeam?.abbreviation,
    game.awayTeam?.name,
  ),
  home: getNhlTeamIdentity(
    game.homeTeam?.abbreviation,
    game.homeTeam?.name,
  ),
})

const getTimeDifference = (game, event) =>
  Math.abs(Date.parse(game.startTimeUTC) - Date.parse(event.commenceTime))

const hasExactTeamOrder = (game, event) => {
  const identities = getGameTeamIdentities(game)

  return (
    identities.away === event.awayTeamIdentity &&
    identities.home === event.homeTeamIdentity
  )
}

const hasRelatedTeamPair = (game, event) => {
  const identities = getGameTeamIdentities(game)
  const gameTeams = new Set([identities.away, identities.home])

  return (
    gameTeams.has(event.awayTeamIdentity) &&
    gameTeams.has(event.homeTeamIdentity)
  )
}

const selectEventForGame = (game, events) => {
  const candidates = events
    .filter((event) => hasExactTeamOrder(game, event))
    .map((event) => ({ event, timeDifference: getTimeDifference(game, event) }))
    .filter(({ timeDifference }) => timeDifference <= MATCH_TOLERANCE_MS)
    .sort((left, right) => left.timeDifference - right.timeDifference)

  return candidates[0]?.event ?? null
}

const toClientEvent = (event) => ({
  awayTeamName: event.awayTeamName,
  bestAvailable: event.bestAvailable,
  bookmakers: event.bookmakers,
  commenceTime: event.commenceTime,
  homeTeamName: event.homeTeamName,
  providerEventId: event.providerEventId,
  providerFetchedAt: event.providerFetchedAt,
  sportKey: event.sportKey,
})

const matchEventsToGames = ({
  events,
  games,
  nowMs = Date.now(),
  providerAvailable = true,
}) => {
  const matchedEventIds = new Set()
  const matchedGames = games.map((game) => {
    const gameId = String(game.gameId ?? game.id ?? '')

    if (isGameStarted(game, nowMs)) {
      return { gameId, marketOdds: null, oddsStatus: 'started' }
    }

    if (!providerAvailable) {
      return { gameId, marketOdds: null, oddsStatus: 'provider_unavailable' }
    }

    const event = selectEventForGame(game, events)

    if (!event) {
      const hasUnmatchedRelatedEvent = events.some((candidate) =>
        hasRelatedTeamPair(game, candidate),
      )

      return {
        gameId,
        marketOdds: null,
        oddsStatus: hasUnmatchedRelatedEvent ? 'unmatched' : 'missing',
      }
    }

    matchedEventIds.add(event.providerEventId)

    return {
      gameId,
      marketOdds: {
        awayBest: event.bestAvailable.away,
        bookmakers: event.bookmakers,
        fetchedAt: event.providerFetchedAt,
        homeBest: event.bestAvailable.home,
        providerEventId: event.providerEventId,
        providerName: 'The Odds API',
        source: 'provider',
      },
      oddsStatus:
        event.bestAvailable.away || event.bestAvailable.home ? 'ready' : 'missing',
    }
  })

  return {
    games: matchedGames,
    matchedCount: matchedEventIds.size,
    unmatchedEvents: events
      .filter((event) => !matchedEventIds.has(event.providerEventId))
      .map(toClientEvent),
  }
}

const createDevelopmentLogger = (logger, now) => (message, metadata = {}) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NHL_EDGE_API_DEBUG !== 'true'
  ) {
    return
  }

  logger.debug?.(message, {
    ...metadata,
    observedAt: new Date(now()).toISOString(),
  })
}

const createMarketOddsService = ({
  cache = new Map(),
  getConfig = getMarketOddsConfig,
  getGamesForDate = nhlApiService.getGamesForDate,
  inFlightRequests = new Map(),
  logger = console,
  now = () => Date.now(),
  provider = createMarketOddsProvider({
    getConfig,
    now: () => new Date(now()),
  }),
  recordProviderRequest = async () => null,
} = {}) => {
  const lastForcedRefreshAt = new Map()
  const logDevelopment = createDevelopmentLogger(logger, now)
  let latestProviderState = {
    availableBookmakers: [],
    lastSuccessfulFetch: null,
    quota: null,
    status: getConfig().apiKey ? 'not_checked' : 'not_configured',
  }

  const getStatus = () => {
    const config = getConfig()
    const remaining = latestProviderState.quota?.remaining

    return {
      configuration: getSafeMarketOddsConfiguration(config),
      availableBookmakers: latestProviderState.availableBookmakers,
      lastSuccessfulFetch: latestProviderState.lastSuccessfulFetch,
      lowQuota:
        Number.isFinite(remaining) && remaining <= config.lowCreditThreshold,
      quota: normalizeQuotaMetadata(latestProviderState.quota),
      status: config.apiKey
        ? latestProviderState.status
        : 'not_configured',
    }
  }

  const getProviderData = async ({
    bookmakerKeys,
    config,
    key,
    refresh,
    requestSource,
    window,
  }) => {
    const nowMs = now()
    const cached = cache.get(key)
    const hasFreshCache = cached?.expiresAt > nowMs
    const remaining = latestProviderState.quota?.remaining
    const lowQuota =
      Number.isFinite(remaining) && remaining <= config.lowCreditThreshold
    const requestedRecently =
      nowMs - (lastForcedRefreshAt.get(key) ?? 0) <
      config.minimumRefreshIntervalMs
    const forcedRecently = refresh && requestedRecently

    if (hasFreshCache && (!refresh || forcedRecently || lowQuota)) {
      logDevelopment('Market odds cache hit', { key })
      const cacheStatus =
        latestProviderState.status === 'quota_exhausted'
          ? 'quota_exhausted'
          : hasUsableMarketOdds(cached.data.events)
            ? 'cached'
            : 'no_events'

      latestProviderState = {
        ...latestProviderState,
        status: cacheStatus,
      }

      return {
        ...cached.data,
        hasUsableData: true,
        requestAttempted: false,
        requestQuota: null,
        source: 'cache',
        status: cacheStatus,
      }
    }

    if (latestProviderState.status === 'quota_exhausted' && !hasFreshCache) {
      return {
        events: [],
        providerFetchedAt: null,
        requestAttempted: false,
        requestQuota: null,
        source: 'provider',
        status: 'quota_exhausted',
      }
    }

    if (inFlightRequests.has(key)) {
      logDevelopment('Market odds request reused', { key })
      return inFlightRequests.get(key)
    }

    const recentlyFailed =
      requestedRecently &&
      [
        'authentication_failed',
        'invalid_response',
        'rate_limited',
        'unavailable',
      ].includes(latestProviderState.status)

    if ((refresh && forcedRecently) || recentlyFailed) {
      return {
        events: [],
        providerFetchedAt: null,
        requestAttempted: false,
        requestQuota: null,
        source: 'cache',
        status: recentlyFailed ? latestProviderState.status : 'unavailable',
      }
    }

    lastForcedRefreshAt.set(key, nowMs)

    logDevelopment('Market odds provider request started', {
      cacheStatus: cached ? 'stale' : 'miss',
      commenceTimeFrom: window.commenceTimeFrom,
      commenceTimeTo: window.commenceTimeTo,
    })

    const fetchProviderOdds =
      provider.fetchNhlMoneylineOdds ?? provider.fetchNhlOdds
    const normalizedRequestSource = normalizeProviderRequestSource(
      requestSource,
    )
    let providerRequestRecorded = false
    const recordActualRequest = async ({ quota, successful }) => {
      try {
        await recordProviderRequest({
          observedAt: quota?.observedAt ?? new Date(now()).toISOString(),
          quota,
          source: normalizedRequestSource,
          successful,
        })
        providerRequestRecorded = true
      } catch (error) {
        error.marketOddsAccountingFailure = true
        throw error
      }
    }
    const request = Promise.resolve()
      .then(() => fetchProviderOdds.call(provider, { ...window, bookmakerKeys }))
      .then(async (result) => {
        await recordActualRequest({ quota: result.quota, successful: true })
        const availableBookmakers = collectAvailableBookmakers(result.events)
        const quota = normalizeQuotaMetadata(result.quota)
        const providerStatus =
          quota?.remaining === 0
            ? 'quota_exhausted'
            : hasUsableMarketOdds(result.events)
              ? 'ready'
              : 'no_events'

        latestProviderState = {
          availableBookmakers,
          lastSuccessfulFetch: result.providerFetchedAt,
          quota: quota ?? latestProviderState.quota,
          status: providerStatus,
        }
        const data = {
          ...result,
          hasUsableData: true,
          source: 'provider',
          status: providerStatus,
        }

        cache.set(key, {
          data,
          expiresAt: now() + config.cacheTtlMs,
        })
        logDevelopment('Market odds provider request completed', {
          bookmakerCount: countBookmakerRows(result.events),
          creditsRemaining: quota?.remaining ?? null,
          eventCount: result.events.length,
          requestCreditCost: quota?.lastCost ?? null,
          status: providerStatus,
        })

        if (result.diagnostics?.normalizationWarnings?.length > 0) {
          logDevelopment('Market odds normalization warnings', {
            warnings: result.diagnostics.normalizationWarnings,
          })
        }

        return {
          ...data,
          requestAttempted: true,
          requestQuota: quota,
        }
      })
      .catch(async (error) => {
        if (error.marketOddsAccountingFailure || providerRequestRecorded) {
          throw error
        }

        const status =
          error instanceof MarketOddsProviderError
            ? error.status
            : 'unavailable'
        const errorQuota = normalizeQuotaMetadata(error.quota)

        await recordActualRequest({ quota: errorQuota, successful: false })
        latestProviderState = {
          ...latestProviderState,
          quota:
            status === 'quota_exhausted'
              ? errorQuota
              : errorQuota ?? latestProviderState.quota,
          status,
        }

        if (
          hasFreshCache &&
          [
            'authentication_failed',
            'invalid_response',
            'quota_exhausted',
            'rate_limited',
            'unavailable',
          ].includes(status)
        ) {
          return {
            ...cached.data,
            hasUsableData: true,
            requestAttempted: true,
            requestQuota: errorQuota,
            source: 'cache',
            status,
          }
        }

        return {
          events: [],
          providerFetchedAt: null,
          requestAttempted: true,
          requestQuota: errorQuota,
          source: 'provider',
          status,
        }
      })
      .finally(() => {
        inFlightRequests.delete(key)
      })

    inFlightRequests.set(key, request)
    return request
  }

  const getNhlOddsCaptureData = async ({
    bookmakerKeys,
    commenceTimeFrom,
    commenceTimeTo,
    maximumProviderAgeMs,
    requestSource = 'AUTOMATIC',
  } = {}) => {
    const fromMs = Date.parse(commenceTimeFrom)
    const toMs = Date.parse(commenceTimeTo)

    if (
      !Number.isFinite(fromMs) ||
      !Number.isFinite(toMs) ||
      fromMs >= toMs ||
      !Number.isFinite(maximumProviderAgeMs) ||
      maximumProviderAgeMs < 0
    ) {
      throw new TypeError(
        'Capture provider window and maximum age must be valid.',
      )
    }

    const config = getConfig()

    if (!config.apiKey) {
      latestProviderState = {
        ...latestProviderState,
        status: 'not_configured',
      }

      return {
        events: [],
        hasUsableData: false,
        providerFetchedAt: null,
        quota: normalizeQuotaMetadata(latestProviderState.quota),
        requestAttempted: false,
        requestQuota: null,
        source: 'provider',
        status: 'not_configured',
      }
    }

    const window = { commenceTimeFrom, commenceTimeTo }
    const key = getMarketOddsCacheKey(config, window, bookmakerKeys)
    const cached = cache.get(key)
    const cachedFetchedAtMs = Date.parse(cached?.data?.providerFetchedAt)
    const cachedAgeMs = now() - cachedFetchedAtMs
    const cachedTooOld = Boolean(
      cached &&
      (!Number.isFinite(cachedFetchedAtMs) ||
        cachedAgeMs < 0 ||
        cachedAgeMs > maximumProviderAgeMs),
    )
    const providerData = await getProviderData({
      config,
      bookmakerKeys,
      key,
      refresh: cachedTooOld,
      requestSource,
      window,
    })

    return {
      diagnostics: providerData.diagnostics,
      events: Array.isArray(providerData.events) ? providerData.events : [],
      hasUsableData: Boolean(providerData.hasUsableData),
      providerFetchedAt: providerData.providerFetchedAt ?? null,
      quota: normalizeQuotaMetadata(latestProviderState.quota),
      requestAttempted: Boolean(providerData.requestAttempted),
      requestQuota: normalizeQuotaMetadata(providerData.requestQuota),
      source: providerData.source,
      status: providerData.status,
    }
  }

  const getNhlMarketOdds = async ({ date, refresh = false }) => {
    const window = buildCommenceTimeWindow(date)

    if (!window) {
      return {
        error: 'Date must use YYYY-MM-DD format.',
        status: 'invalid_response',
      }
    }

    const config = getConfig()
    const key = getMarketOddsCacheKey(config, window)
    let schedule

    try {
      schedule = await getGamesForDate(date)
    } catch {
      schedule = { date, games: [] }
    }

    let providerData

    if (!config.apiKey) {
      latestProviderState = {
        ...latestProviderState,
        status: 'not_configured',
      }
      providerData = {
        events: [],
        providerFetchedAt: null,
        source: 'provider',
        status: 'not_configured',
      }
    } else if (
      (schedule.games ?? []).length === 0 ||
      schedule.games.every((game) => isGameStarted(game, now()))
    ) {
      providerData = {
        events: [],
        providerFetchedAt: null,
        source: 'cache',
        status: 'no_events',
      }
    } else {
      providerData = await getProviderData({
        config,
        key,
        refresh,
        requestSource: 'MANUAL',
        window,
      })
    }

    const providerAvailable =
      providerData.hasUsableData ||
      ['cached', 'no_events', 'ready'].includes(providerData.status)
    const matchResult = matchEventsToGames({
      events: providerData.events,
      games: schedule.games ?? [],
      nowMs: now(),
      providerAvailable,
    })
    const publicStatus = getStatus()
    const response = {
      availableBookmakers: collectAvailableBookmakers(providerData.events),
      configuration: publicStatus.configuration,
      date: schedule.date ?? date,
      fetchedAt: providerData.providerFetchedAt,
      games: matchResult.games,
      lowQuota: publicStatus.lowQuota,
      matchedCount: matchResult.matchedCount,
      quota: publicStatus.quota,
      source: providerData.source,
      status: providerData.status,
      unmatchedCount: matchResult.unmatchedEvents.length,
    }

    if (process.env.NODE_ENV !== 'production') {
      response.diagnostics = {
        normalizationWarnings:
          providerData.diagnostics?.normalizationWarnings ?? [],
        unmatchedEvents: matchResult.unmatchedEvents,
      }
    }

    logDevelopment('Market odds matching completed', {
      matchedCount: matchResult.matchedCount,
      unmatchedCount: matchResult.unmatchedEvents.length,
    })

    return response
  }

  return {
    getNhlOddsCaptureData,
    getNhlMarketOdds,
    getStatus,
  }
}

const marketOddsService = createMarketOddsService({
  recordProviderRequest: (request) =>
    oddsQuotaLedgerService.recordProviderRequest(request),
})

module.exports = {
  MATCH_TOLERANCE_MS,
  buildCommenceTimeWindow,
  createMarketOddsService,
  getMarketOddsCacheKey,
  matchEventsToGames,
  marketOddsService,
}
