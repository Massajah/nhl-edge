import { getMockSchedule } from '../data/mockSchedule.js'
import { apiRequest } from './apiClient.js'

const USE_MOCK_GAMES =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_GAMES === 'true'

export const isUsingMockGames = USE_MOCK_GAMES

async function fetchSchedule(path) {
  return apiRequest(path, undefined, {
    fallbackMessage: 'Unable to load the NHL schedule.',
  })
}

export async function fetchTodaysGames() {
  if (USE_MOCK_GAMES) {
    return getMockSchedule()
  }

  return fetchSchedule('/api/schedule/today')
}

export async function fetchGamesForDate(date) {
  if (USE_MOCK_GAMES) {
    return getMockSchedule(date)
  }

  return fetchSchedule(`/api/schedule/${encodeURIComponent(date)}`)
}
