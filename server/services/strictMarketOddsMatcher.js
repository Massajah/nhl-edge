const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const STRICT_MATCH_TOLERANCE_MS = 60 * 60 * 1000

const STRICT_MATCH_STATUSES = Object.freeze({
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
  DUPLICATE_PROVIDER_EVENT: 'DUPLICATE_PROVIDER_EVENT',
  MATCHED: 'MATCHED',
  NO_MATCH: 'NO_MATCH',
  REVERSED_TEAMS: 'REVERSED_TEAMS',
  TIME_MISMATCH: 'TIME_MISMATCH',
  UNKNOWN_TEAM: 'UNKNOWN_TEAM',
})

const normalizeGameId = (game) =>
  String(game?.gameId ?? game?.id ?? '').trim()

const normalizeProviderEventId = (event) =>
  String(event?.providerEventId ?? event?.id ?? '').trim()

const normalizeScheduleGame = (game) => ({
  awayTeamIdentity: getNhlTeamIdentity(
    game?.awayTeam?.abbreviation,
    game?.awayTeam?.abbrev,
    game?.awayTeam?.name,
  ),
  game,
  gameId: normalizeGameId(game),
  homeTeamIdentity: getNhlTeamIdentity(
    game?.homeTeam?.abbreviation,
    game?.homeTeam?.abbrev,
    game?.homeTeam?.name,
  ),
  startTimeMs: Date.parse(
    game?.startTimeUTC ?? game?.scheduledStart ?? game?.gameDate,
  ),
})

const normalizeProviderEvent = (event) => ({
  awayTeamIdentity: getNhlTeamIdentity(
    event?.awayTeamIdentity,
    event?.awayTeam,
    event?.awayTeamName,
    event?.away_team,
  ),
  commenceTimeMs: Date.parse(event?.commenceTime ?? event?.commence_time),
  event,
  homeTeamIdentity: getNhlTeamIdentity(
    event?.homeTeamIdentity,
    event?.homeTeam,
    event?.homeTeamName,
    event?.home_team,
  ),
  providerEventId: normalizeProviderEventId(event),
})

const hasKnownTeams = (candidate) =>
  Boolean(
    candidate.homeTeamIdentity &&
    candidate.awayTeamIdentity &&
    candidate.homeTeamIdentity !== candidate.awayTeamIdentity,
  )

const isWithinTolerance = (game, event, toleranceMs) =>
  Number.isFinite(game.startTimeMs) &&
  Number.isFinite(event.commenceTimeMs) &&
  Math.abs(game.startTimeMs - event.commenceTimeMs) <= toleranceMs

const hasOrderedTeams = (game, event) =>
  game.homeTeamIdentity === event.homeTeamIdentity &&
  game.awayTeamIdentity === event.awayTeamIdentity

const hasReversedTeams = (game, event) =>
  game.homeTeamIdentity === event.awayTeamIdentity &&
  game.awayTeamIdentity === event.homeTeamIdentity

const normalizePriorLinkages = (linkages = {}) => {
  const entries = linkages instanceof Map
    ? [...linkages.entries()]
    : Object.entries(linkages ?? {})

  return new Map(
    entries.map(([gameId, providerEventId]) => [
      String(gameId ?? '').trim(),
      String(providerEventId ?? '').trim(),
    ]),
  )
}

const buildEventDiagnostics = (events, duplicateEventIds) =>
  events.map((event) => {
    if (!hasKnownTeams(event)) {
      return {
        providerEventId: event.providerEventId,
        reason: 'Provider event contains an unknown or invalid NHL team.',
        status: STRICT_MATCH_STATUSES.UNKNOWN_TEAM,
      }
    }

    if (!event.providerEventId || duplicateEventIds.has(event.providerEventId)) {
      return {
        providerEventId: event.providerEventId,
        reason: 'Provider event ID is missing or duplicated in this batch.',
        status: STRICT_MATCH_STATUSES.DUPLICATE_PROVIDER_EVENT,
      }
    }

    return {
      providerEventId: event.providerEventId,
      reason: '',
      status: STRICT_MATCH_STATUSES.NO_MATCH,
    }
  })

const selectGameCandidate = ({
  duplicateEventIds,
  events,
  game,
  priorProviderEventId,
  toleranceMs,
}) => {
  if (!hasKnownTeams(game)) {
    return {
      gameId: game.gameId,
      reason: 'Schedule game contains an unknown or invalid NHL team.',
      status: STRICT_MATCH_STATUSES.UNKNOWN_TEAM,
    }
  }

  const orderedEvents = events.filter((event) => hasOrderedTeams(game, event))
  const validOrderedEvents = orderedEvents.filter(
    (event) =>
      event.providerEventId &&
      !duplicateEventIds.has(event.providerEventId) &&
      isWithinTolerance(game, event, toleranceMs),
  )
  const validPrior = validOrderedEvents.find(
    (event) => event.providerEventId === priorProviderEventId,
  )

  if (validPrior) {
    return {
      event: validPrior,
      game,
      gameId: game.gameId,
      providerEventId: validPrior.providerEventId,
      status: STRICT_MATCH_STATUSES.MATCHED,
      timeDifferenceMs: Math.abs(
        game.startTimeMs - validPrior.commenceTimeMs,
      ),
    }
  }

  if (validOrderedEvents.length > 1) {
    return {
      gameId: game.gameId,
      providerEventIds: validOrderedEvents.map(
        ({ providerEventId }) => providerEventId,
      ),
      reason: 'Multiple provider events satisfy the strict match rule.',
      status: STRICT_MATCH_STATUSES.AMBIGUOUS_MATCH,
    }
  }

  if (validOrderedEvents.length === 1) {
    const [event] = validOrderedEvents

    return {
      event,
      game,
      gameId: game.gameId,
      providerEventId: event.providerEventId,
      status: STRICT_MATCH_STATUSES.MATCHED,
      timeDifferenceMs: Math.abs(game.startTimeMs - event.commenceTimeMs),
    }
  }

  const duplicateOrderedEvents = orderedEvents.filter(
    (event) =>
      duplicateEventIds.has(event.providerEventId) &&
      isWithinTolerance(game, event, toleranceMs),
  )

  if (duplicateOrderedEvents.length > 0) {
    return {
      gameId: game.gameId,
      providerEventIds: duplicateOrderedEvents.map(
        ({ providerEventId }) => providerEventId,
      ),
      reason: 'Matching provider event ID is duplicated in this batch.',
      status: STRICT_MATCH_STATUSES.DUPLICATE_PROVIDER_EVENT,
    }
  }

  if (orderedEvents.length > 0) {
    return {
      gameId: game.gameId,
      reason: 'Ordered team pair exists only outside the strict time tolerance.',
      status: STRICT_MATCH_STATUSES.TIME_MISMATCH,
    }
  }

  const reversedEvent = events.find(
    (event) =>
      hasKnownTeams(event) &&
      hasReversedTeams(game, event) &&
      isWithinTolerance(game, event, toleranceMs),
  )

  if (reversedEvent) {
    return {
      gameId: game.gameId,
      providerEventId: reversedEvent.providerEventId,
      reason: 'Provider home and away teams are reversed.',
      status: STRICT_MATCH_STATUSES.REVERSED_TEAMS,
    }
  }

  return {
    gameId: game.gameId,
    reason: 'No provider event satisfies the strict team and time rule.',
    status: STRICT_MATCH_STATUSES.NO_MATCH,
  }
}

const matchOddsEventsToNhlGames = ({
  events = [],
  games = [],
  priorProviderEventIdsByGameId = {},
  toleranceMs = STRICT_MATCH_TOLERANCE_MS,
} = {}) => {
  if (!Array.isArray(games) || !Array.isArray(events)) {
    throw new TypeError('games and events must be arrays.')
  }

  if (!Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new TypeError('toleranceMs must be a non-negative finite number.')
  }

  const normalizedGames = games.map(normalizeScheduleGame)
  const normalizedEvents = events.map(normalizeProviderEvent)
  const eventIdCounts = normalizedEvents.reduce((counts, event) => {
    if (event.providerEventId) {
      counts.set(
        event.providerEventId,
        (counts.get(event.providerEventId) ?? 0) + 1,
      )
    }

    return counts
  }, new Map())
  const duplicateEventIds = new Set(
    [...eventIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([providerEventId]) => providerEventId),
  )
  const priorLinkages = normalizePriorLinkages(
    priorProviderEventIdsByGameId,
  )
  const gameResults = normalizedGames.map((game) =>
    selectGameCandidate({
      duplicateEventIds,
      events: normalizedEvents,
      game,
      priorProviderEventId: priorLinkages.get(game.gameId),
      toleranceMs,
    }),
  )
  const selectedByEventId = new Map()

  gameResults.forEach((result, index) => {
    if (result.status !== STRICT_MATCH_STATUSES.MATCHED) {
      return
    }

    const selected = selectedByEventId.get(result.providerEventId) ?? []
    selected.push(index)
    selectedByEventId.set(result.providerEventId, selected)
  })

  selectedByEventId.forEach((resultIndexes, providerEventId) => {
    if (resultIndexes.length < 2) {
      return
    }

    resultIndexes.forEach((index) => {
      gameResults[index] = {
        gameId: gameResults[index].gameId,
        providerEventId,
        reason: 'One provider event matches multiple schedule games.',
        status: STRICT_MATCH_STATUSES.AMBIGUOUS_MATCH,
      }
    })
  })

  const matches = gameResults
    .filter(({ status }) => status === STRICT_MATCH_STATUSES.MATCHED)
    .map((result) => ({
      event: result.event.event,
      game: result.game.game,
      gameId: result.gameId,
      providerEventId: result.providerEventId,
      status: result.status,
      timeDifferenceMs: result.timeDifferenceMs,
    }))
  const matchedEventIds = new Set(
    matches.map(({ providerEventId }) => providerEventId),
  )
  const eventResults = buildEventDiagnostics(
    normalizedEvents,
    duplicateEventIds,
  ).map((result) =>
    matchedEventIds.has(result.providerEventId)
      ? { ...result, status: STRICT_MATCH_STATUSES.MATCHED }
      : result,
  )

  return {
    eventResults,
    gameResults: gameResults.map(({ event, game, ...result }) => result),
    matches,
  }
}

module.exports = {
  STRICT_MATCH_STATUSES,
  STRICT_MATCH_TOLERANCE_MS,
  matchOddsEventsToNhlGames,
  normalizeProviderEvent,
  normalizeScheduleGame,
}
