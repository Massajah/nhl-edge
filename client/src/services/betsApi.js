import { apiRequest } from './apiClient.js'

const requestBets = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load bets.',
  })
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
