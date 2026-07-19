import { apiRequest } from './apiClient.js'

const requestPowerRatings = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load power ratings.',
  })
}

export const fetchPowerRatings = async () => {
  const data = await requestPowerRatings('/api/power-ratings')

  return data.ratings ?? []
}

export const seedPowerRatings = async () =>
  requestPowerRatings('/api/power-ratings/seed', {
    method: 'POST',
  })

export const updatePowerRating = async (teamId, values) => {
  const data = await requestPowerRatings(
    `/api/power-ratings/${encodeURIComponent(teamId)}`,
    {
      body: JSON.stringify(values),
      method: 'PUT',
    },
  )

  return data.rating
}
