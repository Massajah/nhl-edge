import { apiRequest } from './apiClient.js'
import {
  buildBetHistoryQueryString,
  normalizeBetHistoryResponse,
} from '../utils/betHistory.js'

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

export const fetchBetsPage = async (params = {}) => {
  const data = await requestBets(
    `/api/bets${buildBetHistoryQueryString(params)}`,
  )

  return normalizeBetHistoryResponse(data)
}

export const settleCompletedBets = async () => {
  const data = await requestBets('/api/bets/settle', {
    method: 'POST',
  })

  return data.summary ?? {
    checked: 0,
    losses: 0,
    results: [],
    settled: 0,
    stillPending: 0,
    wins: 0,
  }
}
