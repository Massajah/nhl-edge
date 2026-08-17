const nhlApiService = require('./nhlApiService')
const standingsService = require('./standingsService')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const NHL_PLAYOFF_PROVIDER = 'NHL Web API'
const CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS = 2 * 60 * 1000
const PROJECTED_PLAYOFF_CACHE_TTL_MS = 10 * 60 * 1000
const HISTORICAL_PLAYOFF_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PLAYOFF_BEST_OF_COUNT = 7

const playoffCache = new Map()
const playoffInFlightRequests = new Map()

const SERIES_LETTER_CONFERENCES = Object.freeze({
  A: 'eastern',
  B: 'eastern',
  C: 'eastern',
  D: 'eastern',
  E: 'western',
  F: 'western',
  G: 'western',
  H: 'western',
  I: 'eastern',
  J: 'eastern',
  K: 'western',
  L: 'western',
  M: 'eastern',
  N: 'western',
})

const CONFERENCE_CONFIG = Object.freeze({
  eastern: Object.freeze({
    divisions: Object.freeze(['Atlantic', 'Metropolitan']),
    name: 'Eastern',
  }),
  western: Object.freeze({
    divisions: Object.freeze(['Central', 'Pacific']),
    name: 'Western',
  }),
})

const ROUND_CONFIG = Object.freeze([
  Object.freeze({ id: 'round1', label: 'Round 1', number: 1, slots: 4 }),
  Object.freeze({ id: 'round2', label: 'Round 2', number: 2, slots: 2 }),
  Object.freeze({
    id: 'conferenceFinal',
    label: 'Conference Final',
    number: 3,
    slots: 1,
  }),
])

const getLocalizedValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  return value?.default ?? ''
}

const toOptionalInteger = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isInteger(numberValue) ? numberValue : null
}

const normalizeProviderState = (result) => {
  if (result?.data && typeof result.data === 'object') {
    return result
  }

  return {
    data: result,
    fetchedAt: null,
    source: 'live',
    stale: false,
  }
}

const getPostseasonYear = (seasonId) => seasonId.slice(4)

const normalizeProviderTeam = ({
  isWinner,
  seed,
  team,
  wins,
}) => {
  if (!team || typeof team !== 'object') {
    return null
  }

  const abbreviation = String(team.abbrev ?? '').trim().toUpperCase()
  const name = getLocalizedValue(team.name) || abbreviation || 'Unknown Team'

  if (!abbreviation) {
    return null
  }

  return {
    abbreviation,
    isWinner: Boolean(isWinner),
    logo: String(team.logo ?? '').trim(),
    name,
    providerTeamId: toOptionalInteger(team.id),
    seed: String(seed ?? '').trim(),
    teamId: getNhlTeamIdentity(abbreviation, name) ?? abbreviation,
    wins: toOptionalInteger(wins),
  }
}

const getSeriesConference = (series = {}) => {
  const conferenceName = String(series.conferenceName ?? '').toLowerCase()

  if (conferenceName.startsWith('east')) {
    return 'eastern'
  }

  if (conferenceName.startsWith('west')) {
    return 'western'
  }

  return SERIES_LETTER_CONFERENCES[
    String(series.seriesLetter ?? '').trim().toUpperCase()
  ] ?? null
}

const getRoundLabel = (round) => {
  if (round === 4) {
    return 'Stanley Cup Final'
  }

  return ROUND_CONFIG.find((entry) => entry.number === round)?.label ??
    `Round ${round}`
}

const getSeriesStatus = ({ bottomTeam, series, topTeam }) => {
  if (toOptionalInteger(series.winningTeamId) !== null) {
    return 'complete'
  }

  if (!topTeam || !bottomTeam) {
    return 'pending'
  }

  if ((topTeam.wins ?? 0) > 0 || (bottomTeam.wins ?? 0) > 0) {
    return 'active'
  }

  return 'scheduled'
}

const normalizeActualSeries = (series = {}, seasonId, index = 0) => {
  const round = toOptionalInteger(series.playoffRound)
  const winningTeamId = toOptionalInteger(series.winningTeamId)
  const topProviderId = toOptionalInteger(series.topSeedTeam?.id)
  const bottomProviderId = toOptionalInteger(series.bottomSeedTeam?.id)
  const higherSeedTeam = normalizeProviderTeam({
    isWinner: winningTeamId !== null && winningTeamId === topProviderId,
    seed: series.topSeedRankAbbrev,
    team: series.topSeedTeam,
    wins: series.topSeedWins,
  })
  const lowerSeedTeam = normalizeProviderTeam({
    isWinner: winningTeamId !== null && winningTeamId === bottomProviderId,
    seed: series.bottomSeedRankAbbrev,
    team: series.bottomSeedTeam,
    wins: series.bottomSeedWins,
  })
  const seriesLetter = String(series.seriesLetter ?? '').trim().toUpperCase()
  const winner = higherSeedTeam?.isWinner
    ? higherSeedTeam
    : lowerSeedTeam?.isWinner
      ? lowerSeedTeam
      : null

  return {
    bestOf: PLAYOFF_BEST_OF_COUNT,
    conference: getSeriesConference(series),
    higherSeedTeam,
    id: `${seasonId}-${seriesLetter || `series-${index + 1}`}`,
    lowerSeedTeam,
    providerSeriesId: seriesLetter || null,
    round,
    roundName: getRoundLabel(round),
    status: getSeriesStatus({
      bottomTeam: lowerSeedTeam,
      series,
      topTeam: higherSeedTeam,
    }),
    winner,
    winnerTeamId: winner?.teamId ?? null,
  }
}

const createPendingSeries = ({ conference, id, round, roundName }) => ({
  bestOf: PLAYOFF_BEST_OF_COUNT,
  conference,
  higherSeedTeam: null,
  id,
  lowerSeedTeam: null,
  providerSeriesId: null,
  round,
  roundName,
  status: 'pending',
  winner: null,
  winnerTeamId: null,
})

const fillRoundSlots = ({ conference, round, seasonId, series }) => {
  const result = [...series]

  while (result.length < round.slots) {
    result.push(
      createPendingSeries({
        conference,
        id: `${seasonId}-${conference}-${round.id}-${result.length + 1}`,
        round: round.number,
        roundName: round.label,
      }),
    )
  }

  return result
}

const buildConference = ({ conference, seasonId, series }) => ({
  id: conference,
  name: CONFERENCE_CONFIG[conference].name,
  rounds: ROUND_CONFIG.map((round) => ({
    id: round.id,
    label: round.label,
    number: round.number,
    series: fillRoundSlots({
      conference,
      round,
      seasonId,
      series: series.filter(
        (matchup) =>
          matchup.conference === conference && matchup.round === round.number,
      ),
    }),
  })),
})

const normalizeActualBracket = (payload, season) => {
  const providerSeries = Array.isArray(payload?.series) ? payload.series : []

  if (providerSeries.length === 0) {
    return null
  }

  const series = providerSeries.map((matchup, index) =>
    normalizeActualSeries(matchup, season.id, index),
  )
  const final = series.find((matchup) => matchup.round === 4) ??
    createPendingSeries({
      conference: null,
      id: `${season.id}-stanley-cup-final`,
      round: 4,
      roundName: 'Stanley Cup Final',
    })

  return {
    champion: final.status === 'complete' ? final.winner : null,
    conferences: {
      eastern: buildConference({
        conference: 'eastern',
        seasonId: season.id,
        series,
      }),
      western: buildConference({
        conference: 'western',
        seasonId: season.id,
        series,
      }),
    },
    stanleyCupFinal: final,
  }
}

const compareConferenceOrder = (left, right) =>
  (left.conferenceRank ?? Number.POSITIVE_INFINITY) -
    (right.conferenceRank ?? Number.POSITIVE_INFINITY) ||
  (left.officialRank ?? Number.POSITIVE_INFINITY) -
    (right.officialRank ?? Number.POSITIVE_INFINITY)

const compareDivisionOrder = (left, right) =>
  (left.divisionRank ?? Number.POSITIVE_INFINITY) -
    (right.divisionRank ?? Number.POSITIVE_INFINITY) ||
  compareConferenceOrder(left, right)

const compareWildcardOrder = (left, right) =>
  (left.wildcardRank ?? Number.POSITIVE_INFINITY) -
    (right.wildcardRank ?? Number.POSITIVE_INFINITY) ||
  compareConferenceOrder(left, right)

const normalizeProjectedTeam = (standing, seed) => ({
  abbreviation: standing.teamAbbreviation,
  isWinner: false,
  logo: standing.teamLogo,
  name: standing.teamName,
  providerTeamId: null,
  seed,
  teamId: standing.teamId,
  wins: null,
})

const createProjectedSeries = ({
  conference,
  higherSeed,
  id,
  lowerSeed,
  seasonId,
}) => ({
  bestOf: PLAYOFF_BEST_OF_COUNT,
  conference,
  higherSeedTeam: normalizeProjectedTeam(higherSeed.team, higherSeed.seed),
  id: `${seasonId}-${id}`,
  lowerSeedTeam: normalizeProjectedTeam(lowerSeed.team, lowerSeed.seed),
  providerSeriesId: null,
  round: 1,
  roundName: 'Round 1',
  status: 'projected',
  winner: null,
  winnerTeamId: null,
})

const buildProjectedConference = ({ conference, season, standings }) => {
  const config = CONFERENCE_CONFIG[conference]
  const conferenceRows = standings.filter(
    (team) =>
      String(team.conference ?? '').toLowerCase() === config.name.toLowerCase(),
  )
  const divisionSeeds = new Map(
    config.divisions.map((division) => [
      division,
      conferenceRows
        .filter((team) => team.division === division)
        .sort(compareDivisionOrder)
        .slice(0, 3),
    ]),
  )
  const wildcards = conferenceRows
    .filter((team) => (team.wildcardRank ?? 0) > 0)
    .sort(compareWildcardOrder)
    .slice(0, 2)
  const divisionWinners = config.divisions
    .map((division) => divisionSeeds.get(division)?.[0])
    .filter(Boolean)
    .sort(compareConferenceOrder)

  if (
    divisionWinners.length !== 2 ||
    wildcards.length !== 2 ||
    [...divisionSeeds.values()].some((teams) => teams.length !== 3)
  ) {
    return null
  }

  const roundOne = config.divisions.flatMap((division) => {
    const [winner, second, third] = divisionSeeds.get(division)
    const winnerIndex = divisionWinners.findIndex(
      (team) => team.teamId === winner.teamId,
    )
    const wildcardIndex = winnerIndex === 0 ? 1 : 0

    return [
      createProjectedSeries({
        conference,
        higherSeed: { seed: 'D1', team: winner },
        id: `${conference}-${division.toLowerCase()}-division-winner`,
        lowerSeed: {
          seed: `WC${wildcardIndex + 1}`,
          team: wildcards[wildcardIndex],
        },
        seasonId: season.id,
      }),
      createProjectedSeries({
        conference,
        higherSeed: { seed: 'D2', team: second },
        id: `${conference}-${division.toLowerCase()}-second-third`,
        lowerSeed: { seed: 'D3', team: third },
        seasonId: season.id,
      }),
    ]
  })

  return {
    id: conference,
    name: config.name,
    rounds: ROUND_CONFIG.map((round) => ({
      id: round.id,
      label: round.label,
      number: round.number,
      series: fillRoundSlots({
        conference,
        round,
        seasonId: season.id,
        series: round.number === 1 ? roundOne : [],
      }),
    })),
  }
}

const buildProjectedBracket = (standings, season) => {
  const eastern = buildProjectedConference({
    conference: 'eastern',
    season,
    standings,
  })
  const western = buildProjectedConference({
    conference: 'western',
    season,
    standings,
  })

  if (!eastern || !western) {
    return null
  }

  return {
    champion: null,
    conferences: { eastern, western },
    stanleyCupFinal: createPendingSeries({
      conference: null,
      id: `${season.id}-stanley-cup-final`,
      round: 4,
      roundName: 'Stanley Cup Final',
    }),
  }
}

const buildProvider = ({ bracketState, endpoint, standingsResponse }) => ({
  endpoint,
  fetchedAt:
    bracketState?.fetchedAt ?? standingsResponse?.provider?.fetchedAt ?? null,
  name: NHL_PLAYOFF_PROVIDER,
  source: bracketState?.source ?? standingsResponse?.provider?.source ?? null,
  stale: Boolean(
    bracketState?.stale ?? standingsResponse?.provider?.stale,
  ),
})

const buildBaseResponse = (standingsResponse) => ({
  currentSeasonId: standingsResponse.currentSeasonId,
  season: standingsResponse.season,
  selectedSeasonId: standingsResponse.selectedSeasonId,
})

const buildUnavailableResponse = ({
  code,
  message,
  mode,
  provider,
  standingsResponse,
}) => ({
  ...buildBaseResponse(standingsResponse),
  champion: null,
  conferences: null,
  error: { code, message },
  mode,
  provider,
  stanleyCupFinal: null,
  status: code,
})

const isNotFoundError = (error) =>
  error?.upstreamStatus === 404 || error?.statusCode === 404

const loadPlayoffResponse = async ({ options, standingsResponse }) => {
  const season = standingsResponse.season
  const postseasonYear = getPostseasonYear(season.id)
  const endpoint = `/playoff-bracket/${postseasonYear}`
  const bracketProvider =
    options.bracketProvider ?? nhlApiService.getPlayoffBracket
  let bracketState = null

  try {
    bracketState = normalizeProviderState(
      await bracketProvider(postseasonYear),
    )
  } catch (error) {
    if (!isNotFoundError(error)) {
      return buildUnavailableResponse({
        code: 'provider_error',
        message: 'NHL playoff data is temporarily unavailable.',
        mode: season.isCurrent ? null : 'actual',
        provider: buildProvider({ endpoint, standingsResponse }),
        standingsResponse,
      })
    }
  }

  const actualBracket = normalizeActualBracket(bracketState?.data, season)

  if (actualBracket) {
    return {
      ...buildBaseResponse(standingsResponse),
      ...actualBracket,
      error: null,
      mode: 'actual',
      provider: buildProvider({
        bracketState,
        endpoint,
        standingsResponse,
      }),
      status: 'ready',
    }
  }

  if (!season.isCurrent) {
    return buildUnavailableResponse({
      code: 'unavailable',
      message: 'Playoff bracket is not available for this season.',
      mode: 'actual',
      provider: buildProvider({ endpoint, standingsResponse }),
      standingsResponse,
    })
  }

  if (standingsResponse.status === 'provider_error') {
    return buildUnavailableResponse({
      code: 'provider_error',
      message: 'NHL playoff data is temporarily unavailable.',
      mode: 'projected',
      provider: buildProvider({ endpoint, standingsResponse }),
      standingsResponse,
    })
  }

  const projectedBracket = buildProjectedBracket(
    standingsResponse.standings,
    season,
  )

  if (!projectedBracket) {
    return buildUnavailableResponse({
      code: 'projected_unavailable',
      message:
        'Projected matchups are unavailable until current standings are available.',
      mode: 'projected',
      provider: buildProvider({
        endpoint: standingsResponse.provider?.endpoint ?? '/standings/now',
        standingsResponse,
      }),
      standingsResponse,
    })
  }

  return {
    ...buildBaseResponse(standingsResponse),
    ...projectedBracket,
    error: null,
    mode: 'projected',
    provider: buildProvider({
      endpoint: standingsResponse.provider?.endpoint ?? '/standings/now',
      standingsResponse,
    }),
    status: 'ready',
  }
}

const getResponseCacheTtl = (response, season) => {
  if (response.mode === 'actual') {
    return season.isCurrent
      ? CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS
      : HISTORICAL_PLAYOFF_CACHE_TTL_MS
  }

  return PROJECTED_PLAYOFF_CACHE_TTL_MS
}

const getPlayoffs = async (query = {}, options = {}) => {
  const standingsResponseProvider =
    options.standingsResponseProvider ?? standingsService.getStandings
  const standingsResponse = await standingsResponseProvider(
    query,
    options.standingsOptions,
  )
  const cache = options.cache ?? playoffCache
  const inFlightRequests =
    options.inFlightRequests ?? playoffInFlightRequests
  const now = options.nowProvider ?? Date.now
  const cacheKey = `${standingsResponse.currentSeasonId}:${standingsResponse.selectedSeasonId}`
  const cached = cache.get(cacheKey)
  const nowMs = now()

  if (cached && cached.expiresAt > nowMs) {
    return cached.response
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)
  }

  const requestPromise = loadPlayoffResponse({
    options,
    standingsResponse,
  })
    .then((response) => {
      if (response.status !== 'provider_error') {
        cache.set(cacheKey, {
          expiresAt:
            now() + getResponseCacheTtl(response, standingsResponse.season),
          response,
        })
      }

      return response
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey)
    })

  inFlightRequests.set(cacheKey, requestPromise)

  return requestPromise
}

module.exports = {
  CURRENT_ACTUAL_PLAYOFF_CACHE_TTL_MS,
  HISTORICAL_PLAYOFF_CACHE_TTL_MS,
  NHL_PLAYOFF_PROVIDER,
  PLAYOFF_BEST_OF_COUNT,
  PROJECTED_PLAYOFF_CACHE_TTL_MS,
  buildProjectedBracket,
  getPlayoffs,
  normalizeActualBracket,
  normalizeActualSeries,
}
