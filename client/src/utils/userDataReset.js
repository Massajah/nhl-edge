import { DASHBOARD_MARKET_ODDS_STORAGE_KEY } from './marketOdds.js'
import { POWER_RATINGS_STORAGE_KEY } from './powerRatings.js'
import { SAVED_ANALYSES_STORAGE_KEY } from './savedAnalyses.js'

export const SEASON_OPERATIONAL_STORAGE_KEYS = Object.freeze([
  DASHBOARD_MARKET_ODDS_STORAGE_KEY,
  POWER_RATINGS_STORAGE_KEY,
  SAVED_ANALYSES_STORAGE_KEY,
])

export const clearSeasonOperationalStorage = () => {
  if (typeof window === 'undefined') {
    return 0
  }

  let clearedCount = 0

  SEASON_OPERATIONAL_STORAGE_KEYS.forEach((key) => {
    if (window.localStorage.getItem(key) !== null) {
      clearedCount += 1
    }

    window.localStorage.removeItem(key)
  })

  return clearedCount
}
