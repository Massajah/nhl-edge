process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const nhlApiService = require('../services/nhlApiService')
const {
  getLeagueSpecialTeams,
  getUnavailableProviderState,
} = require('../controllers/teamsController')

test('provider 429 maps to a structured secret-free section state', () => {
  const state = getUnavailableProviderState({
    message: 'raw upstream response must not escape',
    upstreamStatus: 429,
  })

  assert.deepEqual(state, {
    errorCode: 'NHL_RATE_LIMITED',
    fetchedAt: null,
    source: null,
    stale: false,
    status: 'rate_limited',
  })
  assert.equal(JSON.stringify(state).includes('raw upstream'), false)
})

test('other provider failures degrade only the requested section', () => {
  const state = getUnavailableProviderState({ upstreamStatus: 503 })

  assert.equal(state.status, 'unavailable')
  assert.equal(state.errorCode, 'NHL_PROVIDER_UNAVAILABLE')
})

test('league Special Teams endpoint returns the shared cached dataset shape', async () => {
  const originalProvider = nhlApiService.getLeagueSpecialTeamsMatchupData
  let providerCalls = 0
  let responseBody = null

  nhlApiService.getLeagueSpecialTeamsMatchupData = async (options) => {
    providerCalls += 1
    assert.equal(options.includeProviderState, true)

    return {
      data: {
        leagueTeamCount: 32,
        previousThreeSeasonIds: [20222023, 20232024, 20242025],
        teams: [
          {
            penaltyKillLeagueRank: 29,
            powerPlayLeagueRank: 5,
            teamAbbreviation: 'BOS',
          },
        ],
      },
      source: 'cache',
      stale: false,
      status: 'ready',
    }
  }

  try {
    await getLeagueSpecialTeams(
      {},
      {
        json(body) {
          responseBody = body
        },
      },
      (error) => {
        throw error
      },
    )
  } finally {
    nhlApiService.getLeagueSpecialTeamsMatchupData = originalProvider
  }

  assert.equal(providerCalls, 1)
  assert.equal(responseBody.specialTeams.leagueTeamCount, 32)
  assert.equal(responseBody.specialTeams.teams[0].teamAbbreviation, 'BOS')
  assert.equal(responseBody.provider.source, 'cache')
})
