import { getMockSchedule } from '../data/mockSchedule.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''
const USE_MOCK_GAMES =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_GAMES === 'true'

export const isUsingMockGames = USE_MOCK_GAMES

async function fetchSchedule(path) {
  const response = await fetch(`${API_BASE_URL}${path}`)

  if (!response.ok) {
    let message = 'Unable to load the NHL schedule.'

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
