import { normalizeStandingsResponse } from '../utils/standings.js'
import { fetchStandings } from './standingsApi.js'

const CURRENT_SEASON_KEY = 'current'

const normalizeSeasonKey = (seasonId) =>
  String(seasonId ?? '').trim() || CURRENT_SEASON_KEY

export const createStandingsDataCoordinator = ({
  cacheTtlMs = 60 * 1000,
  loadStandings = fetchStandings,
  now = () => Date.now(),
} = {}) => {
  const cacheBySeason = new Map()
  const inFlightBySeason = new Map()

  const loadSeason = (seasonId = '', { force = false } = {}) => {
    const seasonKey = normalizeSeasonKey(seasonId)
    const cachedEntry = cacheBySeason.get(seasonKey)

    if (
      !force &&
      cachedEntry &&
      now() - cachedEntry.cachedAt < cacheTtlMs
    ) {
      return Promise.resolve(cachedEntry.result)
    }

    if (inFlightBySeason.has(seasonKey)) {
      return inFlightBySeason.get(seasonKey)
    }

    const requestPromise = Promise.resolve()
      .then(() => loadStandings(seasonId))
      .then(normalizeStandingsResponse)
      .then((result) => {
        const cacheEntry = {
          cachedAt: now(),
          result,
        }

        cacheBySeason.set(seasonKey, cacheEntry)

        if (result.selectedSeasonId) {
          cacheBySeason.set(normalizeSeasonKey(result.selectedSeasonId), cacheEntry)
        }

        return result
      })
      .finally(() => {
        inFlightBySeason.delete(seasonKey)
      })

    inFlightBySeason.set(seasonKey, requestPromise)
    return requestPromise
  }

  return { loadSeason }
}

export const standingsDataCoordinator = createStandingsDataCoordinator()
