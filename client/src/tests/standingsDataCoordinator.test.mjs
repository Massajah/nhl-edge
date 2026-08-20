import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let createStandingsDataCoordinator
let vite

const createResponse = () => ({
  clinchIndicators: [],
  currentSeasonId: '20252026',
  error: null,
  provider: { name: 'NHL Web API' },
  season: {
    id: '20252026',
    isCurrent: true,
    label: '2025–26',
  },
  seasons: [
    {
      id: '20252026',
      isCurrent: true,
      label: '2025–26',
    },
  ],
  selectedSeasonId: '20252026',
  standings: [
    {
      conference: 'Western',
      conferenceRank: 10,
      division: 'Pacific',
      divisionRank: 3,
      gamesPlayed: 82,
      last10Record: '6-3-1',
      losses: 33,
      overtimeLosses: 6,
      points: 92,
      teamAbbreviation: 'ana',
      teamId: 'ANA',
      teamName: 'Anaheim Ducks',
      wins: 43,
    },
  ],
  status: 'ready',
})

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  ;({ createStandingsDataCoordinator } = await vite.ssrLoadModule(
    '/src/services/standingsDataCoordinator.js',
  ))
})

after(async () => {
  await vite?.close()
})

test('shared standings coordinator normalizes, deduplicates, and caches one season lookup', async () => {
  let providerCalls = 0
  const coordinator = createStandingsDataCoordinator({
    loadStandings: async () => {
      providerCalls += 1
      return createResponse()
    },
  })

  const [teamsResult, standingsPageResult] = await Promise.all([
    coordinator.loadSeason(),
    coordinator.loadSeason(),
  ])
  const selectedSeasonAlias = await coordinator.loadSeason('20252026')

  assert.equal(providerCalls, 1)
  assert.equal(teamsResult, standingsPageResult)
  assert.equal(selectedSeasonAlias, teamsResult)
  assert.equal(teamsResult.standings[0].teamAbbreviation, 'ANA')
  assert.equal(teamsResult.standings[0].conferenceRank, 10)
  assert.equal(teamsResult.standings[0].divisionRank, 3)
})
