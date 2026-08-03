export const DASHBOARD_MARKET_ODDS_STORAGE_KEY =
  'nhl-edge-dashboard-market-odds'

const normalizeOddsValue = (value) => {
  if (value === undefined || value === null) {
    return ''
  }

  return String(value)
}

export const normalizeDashboardMarketOdds = (storedOdds = {}) =>
  Object.entries(storedOdds).reduce((normalizedOdds, [gameId, odds]) => {
    normalizedOdds[gameId] = {
      away: normalizeOddsValue(odds?.away),
      home: normalizeOddsValue(odds?.home),
    }

    return normalizedOdds
  }, {})

const normalizeProviderBest = (best) => {
  const odds = Number(best?.odds)

  if (!Number.isFinite(odds) || odds <= 1) {
    return null
  }

  return {
    bookmakerKey: String(best.bookmakerKey ?? ''),
    bookmakerTitle: String(best.bookmakerTitle ?? ''),
    lastUpdate: best.lastUpdate ?? null,
    odds,
  }
}

const normalizeBookmakerRow = (bookmaker) => ({
  awayOdds: Number(bookmaker?.awayOdds),
  bookmakerKey: String(bookmaker?.bookmakerKey ?? ''),
  bookmakerTitle: String(
    bookmaker?.bookmakerTitle ?? bookmaker?.bookmakerKey ?? '',
  ),
  enabled: bookmaker?.enabled !== false,
  homeOdds: Number(bookmaker?.homeOdds),
  lastUpdate: bookmaker?.lastUpdate ?? null,
})

export const indexProviderMarketOdds = (games = []) =>
  (Array.isArray(games) ? games : []).reduce((indexedGames, game) => {
    const gameId = String(game?.gameId ?? '')

    if (!gameId) {
      return indexedGames
    }

    indexedGames[gameId] = {
      marketOdds: game.marketOdds
        ? {
            awayBest: normalizeProviderBest(game.marketOdds.awayBest),
            allBookmakers: Array.isArray(game.marketOdds.allBookmakers)
              ? game.marketOdds.allBookmakers.map(normalizeBookmakerRow)
              : (game.marketOdds.bookmakers ?? []).map(normalizeBookmakerRow),
            bookmakers: Array.isArray(game.marketOdds.bookmakers)
              ? game.marketOdds.bookmakers.map(normalizeBookmakerRow)
              : [],
            fetchedAt: game.marketOdds.fetchedAt ?? null,
            homeBest: normalizeProviderBest(game.marketOdds.homeBest),
            providerEventId: String(game.marketOdds.providerEventId ?? ''),
            providerName: String(
              game.marketOdds.providerName ?? 'The Odds API',
            ),
            source: 'provider',
          }
        : null,
      oddsStatus: String(game.oddsStatus ?? 'missing'),
    }

    return indexedGames
  }, {})

const hasManualValue = (value) =>
  value !== '' && value !== null && value !== undefined

const getProviderSideMetadata = (providerGame, side) => {
  const best = providerGame?.marketOdds?.[
    side === 'away' ? 'awayBest' : 'homeBest'
  ]

  if (!best) {
    return null
  }

  return {
    bookmakerKey: best.bookmakerKey,
    bookmakerLastUpdate: best.lastUpdate,
    bookmakerTitle: best.bookmakerTitle,
    offeredOdds: best.odds,
    providerEventId: providerGame.marketOdds.providerEventId,
    providerFetchedAt: providerGame.marketOdds.fetchedAt,
    providerName: providerGame.marketOdds.providerName,
    source: 'provider',
  }
}

export const resolveGameMarketOdds = ({
  gameId,
  manualOddsByGame = {},
  providerOddsByGame = {},
}) => {
  const manualOdds = manualOddsByGame[gameId] ?? {}
  const providerGame = providerOddsByGame[gameId] ?? null
  const result = {
    away: '',
    allBookmakers: providerGame?.marketOdds?.allBookmakers ?? [],
    bookmakers: providerGame?.marketOdds?.bookmakers ?? [],
    home: '',
    latestProvider: { away: null, home: null },
    metadata: { away: null, home: null },
    oddsStatus: providerGame?.oddsStatus ?? 'missing',
    providerEventId: providerGame?.marketOdds?.providerEventId ?? '',
    providerFetchedAt: providerGame?.marketOdds?.fetchedAt ?? null,
  }

  ;['away', 'home'].forEach((side) => {
    const manualValue = manualOdds[side]
    const providerMetadata = getProviderSideMetadata(providerGame, side)

    result.latestProvider[side] = providerMetadata

    if (hasManualValue(manualValue)) {
      result[side] = normalizeOddsValue(manualValue)
      result.metadata[side] = {
        offeredOdds: Number(manualValue),
        source: 'manual',
      }
      return
    }

    if (providerMetadata) {
      result[side] = normalizeOddsValue(providerMetadata.offeredOdds)
      result.metadata[side] = providerMetadata
    }
  })

  return result
}

export const markOddsAsManual = (_metadata, value) => ({
  offeredOdds: Number(value),
  source: 'manual',
})

export const MARKET_ODDS_STATUS_LABELS = Object.freeze({
  cached: 'Cached',
  invalid_response: 'Provider unavailable',
  no_events: 'No markets available yet',
  not_configured: 'Provider unavailable',
  quota_exhausted: 'Quota exhausted',
  rate_limited: 'Rate limited',
  ready: 'Ready',
  unavailable: 'Provider unavailable',
})

export const getMarketOddsStatusLabel = (status, requestStatus = 'success') => {
  if (requestStatus === 'loading') {
    return 'Loading...'
  }

  if (requestStatus === 'error') {
    return 'Provider unavailable'
  }

  return MARKET_ODDS_STATUS_LABELS[status] ?? 'Connected'
}

const compareOddsDescending = (left, right, field) => {
  const leftValue = Number(left?.[field])
  const rightValue = Number(right?.[field])
  const safeLeft = Number.isFinite(leftValue) ? leftValue : -Infinity
  const safeRight = Number.isFinite(rightValue) ? rightValue : -Infinity

  return safeRight - safeLeft
}

export const sortBookmakerOdds = (bookmakers = [], sortBy = 'home') =>
  [...(Array.isArray(bookmakers) ? bookmakers : [])].sort((left, right) => {
    if (sortBy === 'bookmaker') {
      return String(left?.bookmakerTitle ?? '').localeCompare(
        String(right?.bookmakerTitle ?? ''),
      )
    }

    return compareOddsDescending(
      left,
      right,
      sortBy === 'away' ? 'awayOdds' : 'homeOdds',
    )
  })

export const loadDashboardMarketOdds = () => {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const storedOdds = window.localStorage.getItem(
      DASHBOARD_MARKET_ODDS_STORAGE_KEY,
    )

    return normalizeDashboardMarketOdds(
      storedOdds ? JSON.parse(storedOdds) : {},
    )
  } catch {
    return {}
  }
}

export const saveDashboardMarketOdds = (marketOdds) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    DASHBOARD_MARKET_ODDS_STORAGE_KEY,
    JSON.stringify(normalizeDashboardMarketOdds(marketOdds)),
  )
}
