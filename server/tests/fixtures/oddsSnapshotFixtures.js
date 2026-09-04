const { REQUESTED_BOOKMAKERS } = require('../../config/marketOdds')
const {
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  createOddsCheckpoint,
} = require('../../services/oddsSnapshotContracts')

const GAME_ID = '2026020001'
const PROVIDER_EVENT_ID = 'provider-event-2026020001'
const SCHEDULED_START = '2026-10-08T23:00:00.000Z'

const makeBookmakers = () =>
  REQUESTED_BOOKMAKERS.map(({ key }, index) => ({
    awayOdds: Number((2.05 + index * 0.01).toFixed(2)),
    homeOdds: Number((1.78 + index * 0.01).toFixed(2)),
    key,
    lastUpdate: new Date(
      Date.parse(SCHEDULED_START) - (12 - index) * 60 * 1000,
    ),
  }))

const makeScheduleGame = (overrides = {}) => ({
  awayTeam: {
    abbreviation: 'MTL',
    name: 'Montréal Canadiens',
  },
  gameId: GAME_ID,
  gameState: 'FUT',
  gameType: 2,
  homeTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
  },
  season: 20262027,
  startTimeUTC: SCHEDULED_START,
  ...overrides,
})

const makeProviderEvent = (overrides = {}) => ({
  awayTeamIdentity: 'MTL',
  awayTeamName: 'Montreal Canadiens',
  bookmakers: makeBookmakers(),
  commenceTime: SCHEDULED_START,
  homeTeamIdentity: 'TOR',
  homeTeamName: 'Toronto Maple Leafs',
  providerEventId: PROVIDER_EVENT_ID,
  providerFetchedAt: '2026-10-08T20:59:00.000Z',
  sportKey: 'icehockey_nhl',
  ...overrides,
})

const makeOddsSnapshot = (overrides = {}) => {
  const scheduledStartAtCapture =
    overrides.scheduledStartAtCapture ?? new Date(SCHEDULED_START)
  const snapshotType = overrides.snapshotType ?? 'T2'
  const checkpoint = createOddsCheckpoint({
    scheduledStart: scheduledStartAtCapture,
    snapshotType,
  })

  return {
    awayTeamId: 'MTL',
    bookmakers: makeBookmakers(),
    captureRunId: 'capture-run-2026-10-08-t2',
    capturedAt: new Date('2026-10-08T21:00:05.000Z'),
    gameId: GAME_ID,
    gameType: 2,
    homeTeamId: 'TOR',
    market: ODDS_SNAPSHOT_MARKET,
    provider: ODDS_SNAPSHOT_PROVIDER,
    providerCommenceTime: new Date(SCHEDULED_START),
    providerEventId: PROVIDER_EVENT_ID,
    scheduledStartAtCapture,
    schemaVersion: 1,
    seasonId: '20262027',
    ...checkpoint,
    ...overrides,
  }
}

module.exports = {
  GAME_ID,
  PROVIDER_EVENT_ID,
  SCHEDULED_START,
  makeBookmakers,
  makeOddsSnapshot,
  makeProviderEvent,
  makeScheduleGame,
}
