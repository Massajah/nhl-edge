const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

const requestBets = async (path, options = {}) => {
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
    let message = 'Unable to load bets.'

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

export const fetchBets = async () => {
  const data = await requestBets('/api/bets')

  return data.bets ?? []
}

export const createBet = async (bet) => {
  const data = await requestBets('/api/bets', {
    body: JSON.stringify(bet),
    method: 'POST',
  })

  return data.bet
}

export const updateBet = async (id, updates) => {
  const data = await requestBets(`/api/bets/${encodeURIComponent(id)}`, {
    body: JSON.stringify(updates),
    method: 'PUT',
  })

  return data.bet
}

export const deleteBet = async (id) => {
  const data = await requestBets(`/api/bets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  return data.bet
}
