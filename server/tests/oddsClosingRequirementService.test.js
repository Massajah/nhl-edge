process.env.NODE_ENV = 'test'
const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createOddsClosingRequirementService,
  hasSafeClosingRow,
} = require('../services/oddsClosingRequirementService')
const { CLOSING_SAFETY_REASON } = require('../services/oddsClosingMarketContracts')

const start = new Date('2026-10-08T19:00:00Z')
const game = {
  gameId: '2026020001', scheduledStart: start, homeTeamId: 'TOR', awayTeamId: 'MTL',
}
const bet = (overrides = {}) => ({
  userId: 'active-user', gameId: game.gameId, scheduledStart: start,
  createdAt: new Date('2026-10-08T18:00:00Z'),
  marketOddsSource: 'provider', bookmakerKey: 'coolbet', providerMarketKey: 'h2h_ot',
  marketOdds: 2.05, selectedSide: { homeAway: 'home', teamId: 'TOR' },
  selectedTeam: { teamId: 'TOR' }, ...overrides,
})
const serviceFor = (bets) => createOddsClosingRequirementService({
  userModel: { find() { return [{ _id: 'active-user' }] } },
  betModel: { find() { return bets } },
})

test('only saved eligible production-user provider bets create requirements', async () => {
  const rows = [
    bet(),
    bet({ userId: 'other-user', bookmakerKey: 'pinnacle', providerMarketKey: 'h2h' }),
    bet({ marketOddsSource: 'manual', bookmakerKey: 'pinnacle' }),
    bet({ scheduledStart: new Date(+start + 60_000) }),
    bet({ createdAt: start }),
    bet({ selectedSide: { homeAway: 'away', teamId: 'TOR' } }),
    bet({ providerMarketKey: 'h2h' }),
  ]
  const result = await serviceFor(rows).findForGames([game])
  assert.deepEqual(result.get(game.gameId), [{
    bookmakerKey: 'coolbet', providerMarketKey: 'h2h_ot',
    betCreatedAt: Date.parse('2026-10-08T18:00:00Z'),
  }])
})

test('same-game same-book bets deduplicate using the latest bet creation time', async () => {
  const later = new Date('2026-10-08T18:48:00Z')
  const result = await serviceFor([
    bet(), bet({ createdAt: later }),
    bet({ bookmakerKey: 'veikkaus_fi', providerMarketKey: 'h2h' }),
  ]).findForGames([game])
  assert.equal(result.get(game.gameId).length, 2)
  assert.equal(result.get(game.gameId)[0].betCreatedAt, +later)
  assert.equal(result.get(game.gameId)[1].providerMarketKey, 'h2h')
})

test('manual odds and incomplete bookmaker identity create no closing requirement', async () => {
  const result = await serviceFor([
    bet({ marketOddsSource: 'manual' }),
    bet({ bookmakerKey: null }),
    bet({ bookmakerKey: 'unibet_fi', providerMarketKey: 'h2h_ot' }),
  ]).findForGames([game])
  assert.deepEqual(result.get(game.gameId), [])
})

test('a provider start shifted from the NHL schedule cannot suppress a CLV retry', () => {
  const requirement = {
    bookmakerKey: 'coolbet', providerMarketKey: 'h2h_ot',
    betCreatedAt: Date.parse('2026-10-08T18:00:00Z'),
  }
  const closing = {
    gameId: game.gameId, scheduledStartAtCapture: start,
    homeTeamId: 'TOR', awayTeamId: 'MTL',
    latestSafeBookmakers: [{
      key: 'coolbet', providerMarketKey: 'h2h_ot',
      observedAt: new Date('2026-10-08T18:45:00Z'),
      providerCommenceTime: start,
      homeOdds: 2.05, awayOdds: 1.85, safetyReason: CLOSING_SAFETY_REASON,
    }],
  }
  assert.equal(hasSafeClosingRow(closing, requirement, game), true)
  closing.latestSafeBookmakers[0].providerCommenceTime = new Date('2026-10-08T19:15:00Z')
  assert.equal(hasSafeClosingRow(closing, requirement, game), false)
})
