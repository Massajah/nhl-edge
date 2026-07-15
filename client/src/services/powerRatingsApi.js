const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

const requestPowerRatings = async (path, options = {}) => {
  const headers = options.body
    ? {
        'Content-Type': 'application/json',
        ...options.headers,
      }
    : options.headers

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let message = 'Unable to load power ratings.'

    try {
      const data = await response.json()
      message = data.error ?? message
    } catch {
      // Keep the default message when the server cannot return JSON.
    }

    throw new Error(message)
  }

  return response.json()
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
