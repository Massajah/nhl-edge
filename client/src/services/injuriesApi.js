const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

const requestInjuries = async (path, options = {}) => {
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
    let message = 'Unable to load injuries.'

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

export const fetchInjuries = async () => {
  const data = await requestInjuries('/api/injuries')

  return data.injuries ?? []
}

export const fetchTeamInjurySummary = async () => {
  const data = await requestInjuries('/api/injuries/summary')

  return data.summary ?? []
}

export const createInjury = async (injury) => {
  const data = await requestInjuries('/api/injuries', {
    body: JSON.stringify(injury),
    method: 'POST',
  })

  return data.injury
}

export const updateInjury = async (id, updates) => {
  const data = await requestInjuries(`/api/injuries/${encodeURIComponent(id)}`, {
    body: JSON.stringify(updates),
    method: 'PUT',
  })

  return data.injury
}

export const deleteInjury = async (id) => {
  const data = await requestInjuries(`/api/injuries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  return data.injury
}
