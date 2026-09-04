process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  STRICT_MATCH_STATUSES,
  STRICT_MATCH_TOLERANCE_MS,
  matchOddsEventsToNhlGames,
} = require('../services/strictMarketOddsMatcher')
const {
  PROVIDER_EVENT_ID,
  SCHEDULED_START,
  makeProviderEvent,
  makeScheduleGame,
} = require('./fixtures/oddsSnapshotFixtures')

const matchOne = (game, event, options = {}) =>
  matchOddsEventsToNhlGames({
    events: event ? [event] : [],
    games: [game],
    ...options,
  }).gameResults[0]

test('strict matcher returns an exact ordered team/time match', () => {
  const result = matchOddsEventsToNhlGames({
    events: [makeProviderEvent()],
    games: [makeScheduleGame()],
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].gameId, '2026020001')
  assert.equal(result.matches[0].providerEventId, PROVIDER_EVENT_ID)
  assert.equal(result.gameResults[0].status, STRICT_MATCH_STATUSES.MATCHED)
})

test('strict matcher includes both exact 60-minute boundaries', () => {
  for (const direction of [-1, 1]) {
    const commenceTime = new Date(
      Date.parse(SCHEDULED_START) + direction * STRICT_MATCH_TOLERANCE_MS,
    ).toISOString()
    const result = matchOne(
      makeScheduleGame(),
      makeProviderEvent({ commenceTime }),
    )

    assert.equal(result.status, STRICT_MATCH_STATUSES.MATCHED)
    assert.equal(result.timeDifferenceMs, STRICT_MATCH_TOLERANCE_MS)
  }
})

test('strict matcher rejects a commence time just outside tolerance', () => {
  const commenceTime = new Date(
    Date.parse(SCHEDULED_START) + STRICT_MATCH_TOLERANCE_MS + 1,
  ).toISOString()
  const result = matchOne(
    makeScheduleGame(),
    makeProviderEvent({ commenceTime }),
  )

  assert.equal(result.status, STRICT_MATCH_STATUSES.TIME_MISMATCH)
})

test('strict matcher reports reversed teams without using them as fallback', () => {
  const result = matchOne(
    makeScheduleGame(),
    makeProviderEvent({
      awayTeamIdentity: 'TOR',
      homeTeamIdentity: 'MTL',
    }),
  )

  assert.equal(result.status, STRICT_MATCH_STATUSES.REVERSED_TEAMS)
})

test('strict matcher reports unknown schedule and provider teams', () => {
  const scheduleResult = matchOne(
    makeScheduleGame({
      homeTeam: { abbreviation: 'XXX', name: 'Unknown Team' },
    }),
    makeProviderEvent(),
  )
  const providerResult = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({
        awayTeamIdentity: null,
        awayTeamName: 'Imaginary NHL Team',
      }),
    ],
    games: [makeScheduleGame()],
  })

  assert.equal(scheduleResult.status, STRICT_MATCH_STATUSES.UNKNOWN_TEAM)
  assert.equal(
    providerResult.eventResults[0].status,
    STRICT_MATCH_STATUSES.UNKNOWN_TEAM,
  )
  assert.equal(providerResult.gameResults[0].status, STRICT_MATCH_STATUSES.NO_MATCH)
})

test('strict matcher reports no candidate without date-only or fuzzy matching', () => {
  const result = matchOne(
    makeScheduleGame(),
    makeProviderEvent({
      awayTeamIdentity: 'BOS',
      awayTeamName: 'Boston Bruins',
    }),
  )

  assert.equal(result.status, STRICT_MATCH_STATUSES.NO_MATCH)
})

test('strict matcher rejects multiple matching provider events as ambiguous', () => {
  const result = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({ providerEventId: 'event-a' }),
      makeProviderEvent({ providerEventId: 'event-b' }),
    ],
    games: [makeScheduleGame()],
  })

  assert.equal(result.matches.length, 0)
  assert.equal(
    result.gameResults[0].status,
    STRICT_MATCH_STATUSES.AMBIGUOUS_MATCH,
  )
})

test('strict matcher rejects one provider event matching multiple schedule games', () => {
  const result = matchOddsEventsToNhlGames({
    events: [makeProviderEvent()],
    games: [
      makeScheduleGame({ gameId: '2026020001' }),
      makeScheduleGame({ gameId: '2026020002' }),
    ],
  })

  assert.equal(result.matches.length, 0)
  assert.deepEqual(
    result.gameResults.map(({ status }) => status),
    [
      STRICT_MATCH_STATUSES.AMBIGUOUS_MATCH,
      STRICT_MATCH_STATUSES.AMBIGUOUS_MATCH,
    ],
  )
})

test('strict matcher rejects duplicate provider event IDs', () => {
  const result = matchOddsEventsToNhlGames({
    events: [makeProviderEvent(), makeProviderEvent()],
    games: [makeScheduleGame()],
  })

  assert.equal(result.matches.length, 0)
  assert.equal(
    result.gameResults[0].status,
    STRICT_MATCH_STATUSES.DUPLICATE_PROVIDER_EVENT,
  )
  assert.equal(
    result.eventResults.every(
      ({ status }) => status === STRICT_MATCH_STATUSES.DUPLICATE_PROVIDER_EVENT,
    ),
    true,
  )
})

test('strict matcher prefers a still-valid prior provider event ID', () => {
  const result = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({ providerEventId: 'new-event' }),
      makeProviderEvent({ providerEventId: 'linked-event' }),
    ],
    games: [makeScheduleGame()],
    priorProviderEventIdsByGameId: {
      '2026020001': 'linked-event',
    },
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].providerEventId, 'linked-event')
})

test('strict matcher normalizes numeric game IDs at prior-linkage boundaries', () => {
  const result = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({ providerEventId: 'new-event' }),
      makeProviderEvent({ providerEventId: 'linked-event' }),
    ],
    games: [makeScheduleGame({ gameId: 2026020001 })],
    priorProviderEventIdsByGameId: new Map([
      [2026020001, 'linked-event'],
    ]),
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].gameId, '2026020001')
  assert.equal(result.matches[0].providerEventId, 'linked-event')
})

test('prior provider event linkage never bypasses team or time validation', () => {
  const timeMismatch = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({
        commenceTime: '2026-10-09T02:00:00.000Z',
        providerEventId: 'linked-event',
      }),
    ],
    games: [makeScheduleGame()],
    priorProviderEventIdsByGameId: new Map([
      ['2026020001', 'linked-event'],
    ]),
  })
  const teamMismatch = matchOddsEventsToNhlGames({
    events: [
      makeProviderEvent({
        awayTeamIdentity: 'BOS',
        providerEventId: 'linked-event',
      }),
    ],
    games: [makeScheduleGame()],
    priorProviderEventIdsByGameId: {
      '2026020001': 'linked-event',
    },
  })

  assert.equal(
    timeMismatch.gameResults[0].status,
    STRICT_MATCH_STATUSES.TIME_MISMATCH,
  )
  assert.equal(teamMismatch.gameResults[0].status, STRICT_MATCH_STATUSES.NO_MATCH)
})

test('strict matcher reuses punctuation and diacritic aliases from team identity', () => {
  const result = matchOne(
    makeScheduleGame({
      awayTeam: { abbreviation: '', name: 'Montréal Canadiens' },
      homeTeam: { abbreviation: '', name: 'St. Louis Blues' },
    }),
    makeProviderEvent({
      awayTeamIdentity: null,
      awayTeamName: 'Montreal Canadiens',
      homeTeamIdentity: null,
      homeTeamName: 'St Louis Blues',
    }),
  )

  assert.equal(result.status, STRICT_MATCH_STATUSES.MATCHED)
})
