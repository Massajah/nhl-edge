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
