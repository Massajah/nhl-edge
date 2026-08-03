import { apiRequest } from './apiClient.js'

export const fetchNhlMarketOdds = (date, { refresh = false } = {}) => {
  const query = new URLSearchParams({ date })

  if (refresh) {
    query.set('refresh', 'true')
  }

  return apiRequest(`/api/market-odds/nhl?${query.toString()}`, {}, {
    fallbackMessage: 'Unable to load market odds.',
  })
}

export const fetchMarketOddsStatus = () =>
  apiRequest('/api/market-odds/status', {}, {
    fallbackMessage: 'Unable to load market odds status.',
  })

export const fetchBookmakerPreferences = () =>
  apiRequest('/api/settings/bookmakers', {}, {
    fallbackMessage: 'Unable to load bookmaker preferences.',
  })

export const updateBookmakerPreferences = (enabledBookmakerKeys) =>
  apiRequest('/api/settings/bookmakers', {
    body: JSON.stringify({ enabledBookmakerKeys }),
    method: 'PUT',
  }, {
    fallbackMessage: 'Unable to save bookmaker preferences.',
  })
