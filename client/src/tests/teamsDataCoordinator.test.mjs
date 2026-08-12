import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let createTeamsDataCoordinator
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  ;({ createTeamsDataCoordinator } = await vite.ssrLoadModule(
    '/src/services/teamsDataCoordinator.js',
  ))
})

after(async () => {
  await vite?.close()
})

test('one shared roster request supplies every player section', async () => {
  let providerCalls = 0
  let resolveRoster
  const rosterResult = {
    data: {
      defensemen: [{ id: 2 }],
      forwards: [{ id: 1 }],
      goalies: [{ id: 3 }],
    },
    provider: { status: 'ready' },
  }
  const coordinator = createTeamsDataCoordinator({
    loadRoster: async () => {
      providerCalls += 1
      await new Promise((resolve) => {
        resolveRoster = resolve
      })
      return rosterResult
    },
  })

  const first = coordinator.loadRoster('DAL')
  const strictModeDuplicate = coordinator.loadRoster('dal')

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(providerCalls, 1)
  resolveRoster()

  const [firstResult, duplicateResult] = await Promise.all([
    first,
    strictModeDuplicate,
  ])

  assert.equal(firstResult, duplicateResult)
  assert.equal(firstResult.data.forwards.length, 1)
  assert.equal(firstResult.data.defensemen.length, 1)
  assert.equal(firstResult.data.goalies.length, 1)
})

test('coordinator reuses cached provider data and force still dedupes in flight', async () => {
  let providerCalls = 0
  const coordinator = createTeamsDataCoordinator({
    loadStats: async () => {
      providerCalls += 1
      return {
        data: { currentSeason: { powerPlayPercentage: 25 } },
        provider: { status: 'ready' },
      }
    },
  })

  const first = await coordinator.loadStats('BOS')
  const cached = await coordinator.loadStats('BOS')
  const [forced, forcedDuplicate] = await Promise.all([
    coordinator.loadStats('BOS', { force: true }),
    coordinator.loadStats('BOS', { force: true }),
  ])

  assert.equal(cached, first)
  assert.equal(forcedDuplicate, forced)
  assert.equal(providerCalls, 2)
})

test('league Special Teams data is loaded once and shared across consumers', async () => {
  let providerCalls = 0
  const leagueResult = {
    data: {
      leagueTeamCount: 32,
      teams: [{ teamAbbreviation: 'BOS', powerPlayLeagueRank: 5 }],
    },
    provider: { status: 'ready' },
  }
  const coordinator = createTeamsDataCoordinator({
    loadLeagueSpecialTeams: async () => {
      providerCalls += 1
      return leagueResult
    },
  })

  const [dashboard, analyzer] = await Promise.all([
    coordinator.loadLeagueSpecialTeams(),
    coordinator.loadLeagueSpecialTeams(),
  ])
  const cached = await coordinator.loadLeagueSpecialTeams()

  assert.equal(providerCalls, 1)
  assert.equal(dashboard, analyzer)
  assert.equal(cached, dashboard)
})

test('client cache expiry permits a server-coordinated background refresh', async () => {
  let currentTime = 1000
  let providerCalls = 0
  const coordinator = createTeamsDataCoordinator({
    cacheTtlMs: 100,
    loadRoster: async () => ({
      data: { revision: ++providerCalls },
      provider: { status: 'ready' },
    }),
    now: () => currentTime,
  })

  const first = await coordinator.loadRoster('DAL')
  currentTime += 101
  const refreshed = await coordinator.loadRoster('DAL')

  assert.equal(first.data.revision, 1)
  assert.equal(refreshed.data.revision, 2)
  assert.equal(providerCalls, 2)
})

test('different teams keep independent responses when navigation races', async () => {
  const resolvers = new Map()
  const coordinator = createTeamsDataCoordinator({
    loadRoster: (teamKey) => new Promise((resolve) => {
      resolvers.set(teamKey, resolve)
    }),
  })
  const dallas = coordinator.loadRoster('DAL')
  const boston = coordinator.loadRoster('BOS')

  await new Promise((resolve) => setImmediate(resolve))
  resolvers.get('BOS')({
    data: { teamAbbreviation: 'BOS' },
    provider: { status: 'ready' },
  })
  resolvers.get('DAL')({
    data: { teamAbbreviation: 'DAL' },
    provider: { status: 'ready' },
  })

  assert.equal((await boston).data.teamAbbreviation, 'BOS')
  assert.equal((await dallas).data.teamAbbreviation, 'DAL')
})
