import {
  fetchTeamGoalieSummariesState,
  fetchLeagueSpecialTeamsState,
  fetchTeamRosterState,
  fetchTeamStatsState,
  fetchTeams,
} from './teamsApi.js'

const normalizeKey = (value) => String(value ?? '').trim().toUpperCase()

export const createTeamsDataCoordinator = ({
  cacheTtlMs = 60 * 1000,
  loadGoalieSummaries = fetchTeamGoalieSummariesState,
  loadLeagueSpecialTeams = fetchLeagueSpecialTeamsState,
  loadRoster = fetchTeamRosterState,
  loadStats = fetchTeamStatsState,
  loadTeamsList = fetchTeams,
  now = () => Date.now(),
} = {}) => {
  const cacheByDomain = new Map()
  const inFlightByDomain = new Map()

  const getDomainMap = (store, domain) => {
    if (!store.has(domain)) {
      store.set(domain, new Map())
    }

    return store.get(domain)
  }

  const logDevelopment = (message, details) => {
    if (!import.meta.env.DEV) {
      return
    }

    console.debug(message, details)
  }

  const request = (domain, teamAbbreviation, loader, { force = false } = {}) => {
    const teamKey = normalizeKey(teamAbbreviation)
    const cache = getDomainMap(cacheByDomain, domain)
    const inFlight = getDomainMap(inFlightByDomain, domain)

    const cachedEntry = cache.get(teamKey)

    if (
      !force &&
      cachedEntry &&
      now() - cachedEntry.cachedAt < cacheTtlMs
    ) {
      logDevelopment('Teams provider cache hit', { domain, teamKey })
      return Promise.resolve(cachedEntry.result)
    }

    if (inFlight.has(teamKey)) {
      logDevelopment('Teams provider in-flight dedupe', { domain, teamKey })
      return inFlight.get(teamKey)
    }

    logDevelopment('Teams provider request start', { domain, teamKey })
    const requestPromise = Promise.resolve()
      .then(() => loader(teamKey))
      .then((result) => {
        if (result?.data) {
          cache.set(teamKey, {
            cachedAt: now(),
            result,
          })
        }

        return result
      })
      .finally(() => {
        inFlight.delete(teamKey)
      })

    inFlight.set(teamKey, requestPromise)
    return requestPromise
  }

  return {
    loadTeams(options) {
      return request(
        'teams',
        'league',
        async () => ({
          data: await loadTeamsList(),
          provider: { status: 'ready' },
        }),
        options,
      )
    },
    loadGoalieSummaries(teamAbbreviation, options) {
      return request(
        'goalie_summaries',
        teamAbbreviation,
        loadGoalieSummaries,
        options,
      )
    },
    loadLeagueSpecialTeams(options) {
      return request(
        'special_teams_league',
        'league',
        loadLeagueSpecialTeams,
        options,
      )
    },
    loadRoster(teamAbbreviation, options) {
      return request('roster', teamAbbreviation, loadRoster, options)
    },
    loadStats(teamAbbreviation, options) {
      return request('special_teams', teamAbbreviation, loadStats, options)
    },
  }
}

export const teamsDataCoordinator = createTeamsDataCoordinator()
