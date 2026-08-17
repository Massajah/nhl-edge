import { apiRequest } from './apiClient.js'

export const fetchStandings = async (seasonId = '') => {
  const query = seasonId
    ? `?season=${encodeURIComponent(seasonId)}`
    : ''

  return apiRequest(`/api/standings${query}`, {}, {
    fallbackMessage: 'Unable to load NHL standings.',
  })
}

export const fetchPlayoffs = async (seasonId = '') => {
  const query = seasonId
    ? `?season=${encodeURIComponent(seasonId)}`
    : ''

  return apiRequest(`/api/standings/playoffs${query}`, {}, {
    fallbackMessage: 'Unable to load NHL playoff data.',
  })
}
