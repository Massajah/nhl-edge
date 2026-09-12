const test = require('node:test')
const assert = require('node:assert/strict')
const { createForwardPredictionInputsService } = require('../services/forwardPredictionInputsService')
const { calculateAutomaticPrediction } = require('../services/automaticPredictionService')
const { getGameIdentity } = require('../services/forwardPredictionContracts')
const { runOddsCaptureCron } = require('../scripts/runOddsCaptureCron')
const { NOW, START, USER_ID, OTHER_USER_ID, game } = require('./fixtures/forwardPredictionFixtures')

const makeLoader = (overrides = {}) => {
  const calls = []
  const match = game()
  const previous = { id: 2026020000, gameType: 2, gameState: 'OFF',
    startTimeUTC: new Date(+START - 86400000).toISOString(), venueCity: 'Toronto',
    homeTeam: { abbrev: 'TOR', score: 3 }, awayTeam: { abbrev: 'BOS', score: 2 } }
  const service = createForwardPredictionInputsService({
    ratingModel: { find(filter) { calls.push(['ratings', filter]); return { lean: async () => [
      { teamId: 'BOS', baseRating: 46 }, { teamId: 'TOR', baseRating: 46 },
    ] } } },
    contextModel: { find(filter) { calls.push(['contexts', filter]); return { lean: async () => [{
      userId: USER_ID, gameId: String(match.id), scheduledStart: START,
      homeContext: { restFatigueOverrideEnabled: true, manualRestFatigueAdjustment: 3 },
      goalieSelections: { home: { selectionType: 'provider_goalie', teamId: 'BOS', nhlPlayerId: 123,
        confirmationStatus: 'expected', teamDefaultAdjustment: -1, effectiveAdjustment: -4, overrideEnabled: true } },
    }] } } },
    getSettings: async (owner) => { calls.push(['settings', owner]); return { settings: { homeAdvantage: 3.5, specialTeamsMode: 'automatic' } } },
    getScheduleSettings: async (owner) => { calls.push(['scheduleSettings', owner]); return { settings: {} } },
    getInjuries: async (owner) => { calls.push(['injuries', owner]); return [{ teamId: 'BOS', totalImpact: -2 }, { teamId: 'TOR', totalImpact: 0 }] },
    provider: {
      async getScheduleGamesForDateRange() { calls.push(['providerSchedule']); return { stale: false, games: [previous, { ...match, venueCity: 'Boston' }] } },
      async getLeagueSpecialTeamsMatchupData() { calls.push(['providerSpecialTeams']); return null },
    },
    ...overrides,
  })
  return { service, calls, match: { ...match, venueCity: 'Boston' } }
}

test('server inputs reuse schedule travel/rematch rules, injury summaries and private goalie defaults', async () => {
  const { service, calls, match } = makeLoader()
  const value = await service.loadUserInputs(USER_ID, [match], NOW)
  const context = value.contexts.get(String(match.id))
  const result = calculateAutomaticPrediction({ ...value, identity: getGameIdentity(match), gameContext: context })
  assert.equal(result.adjustments.home.restFatigue, -1.25)
  assert.equal(result.adjustments.home.quickRematch, 0.25)
  assert.equal(result.adjustments.home.injuries, -2)
  assert.equal(result.adjustments.home.goalie, -1)
  assert.equal(result.completeness.goalies.home, 'expected')
  assert.equal(context.homeContext.effectiveRestFatigueAdjustment, 3)
  for (const [domain, filter] of calls.filter(([name]) => ['ratings', 'contexts'].includes(name))) {
    assert.equal(filter.userId, USER_ID, domain)
  }
  await service.loadUserInputs(OTHER_USER_ID, [match], NOW)
  assert.equal(calls.filter(([name]) => name === 'providerSchedule').length, 1)
  assert.equal(calls.filter(([name]) => name === 'providerSpecialTeams').length, 1)
  assert.equal(calls.filter(([name]) => name === 'ratings').length, 2)
})

test('reschedule discards old goalie selection; schedule/special-teams outages stay explicit', async () => {
  const { service, match } = makeLoader({ provider: {
    async getScheduleGamesForDateRange() { throw new Error('offline') },
    async getLeagueSpecialTeamsMatchupData() { throw new Error('offline') },
  } })
  match.startTimeUTC = new Date(+START + 86400000).toISOString()
  const value = await service.loadUserInputs(USER_ID, [match], NOW)
  const result = calculateAutomaticPrediction({ ...value, identity: getGameIdentity(match), gameContext: value.contexts.get(String(match.id)) })
  assert.equal(result.available, true)
  assert.equal(result.completeness.schedule.home, 'unavailable')
  assert.equal(result.completeness.specialTeams.home, 'unavailable')
  assert.equal(result.completeness.goalies.home, 'unknown')
})

test('private database read failures retry instead of fabricating injury or settings values', async () => {
  const { service, match } = makeLoader({ getInjuries: async () => { throw new Error('database offline') } })
  await assert.rejects(() => service.loadUserInputs(USER_ID, [match], NOW), /database offline/)
  await assert.rejects(() => service.loadUserInputs(null, [match], NOW), /owner/)
})

test('uninitialized accounts do not seed ratings or load expensive provider inputs', async () => {
  const { service, calls, match } = makeLoader({ ratingModel: { find() { return { lean: async () => [] } } } })
  const result = await service.loadUserInputs(USER_ID, [match], NOW)
  assert.deepEqual(result.ratings, [])
  assert.equal(calls.length, 0)
})

test('stale optional provider responses are marked unavailable', async () => {
  const { service, match } = makeLoader({ provider: {
    async getScheduleGamesForDateRange() { return { games: [game()], stale: true } },
    async getLeagueSpecialTeamsMatchupData() { return { data: {}, stale: true } },
  } })
  const value = await service.loadUserInputs(USER_ID, [match], NOW)
  const result = calculateAutomaticPrediction({ ...value, identity: getGameIdentity(match), gameContext: value.contexts.get(String(match.id)) })
  assert.equal(result.completeness.schedule.home, 'unavailable')
  assert.equal(result.completeness.specialTeams.home, 'unavailable')
})

for (const odds of ['unconfigured', 'quota blocked', 'failed']) {
  test(`prediction job runs independently with odds ${odds}`, async () => {
    const calls = []
    const run = runOddsCaptureCron({
      connectDatabase: async () => calls.push('connect'), closeDatabase: async () => calls.push('close'),
      environment: { MONGODB_URI: 'mock', ...(odds === 'unconfigured' ? {} : { THE_ODDS_API_KEY: 'mock' }) },
      predictionService: { async runScheduledCapture() { calls.push('prediction'); return { captured: 1 } } },
      service: { async runScheduledCapture() {
        calls.push('odds')
        if (odds === 'failed') throw new Error('provider failed')
        return { outcome: 'QUOTA_BLOCKED', providerRequestCount: 0 }
      } },
    })
    if (odds === 'failed') await assert.rejects(() => run, /Scheduled capture failed/)
    else assert.equal((await run).forwardPredictions.captured, 1)
    assert.ok(calls.includes('prediction'))
    assert.equal(calls.at(-1), 'close')
    if (odds === 'unconfigured') assert.equal(calls.includes('odds'), false)
  })
}

test('prediction failure still permits odds capture and always closes the database', async () => {
  const calls = []
  await assert.rejects(() => runOddsCaptureCron({
    environment: { MONGODB_URI: 'mock', THE_ODDS_API_KEY: 'mock' },
    connectDatabase: async () => {}, closeDatabase: async () => calls.push('close'),
    predictionService: { async runScheduledCapture() { throw new Error('prediction failed') } },
    service: { async runScheduledCapture() { calls.push('odds'); return {} } },
  }), /Scheduled capture failed/)
  assert.deepEqual(calls, ['odds', 'close'])
})
