process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const HistoricalSpecialTeamsSeason = require('../models/HistoricalSpecialTeamsSeason')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const specialTeamsMatchups = require('../../shared/specialTeamsMatchups')
const {
  calculatePenaltyKillPercentage,
  calculatePowerPlayPercentage,
  normalizeSeasonRows,
  prepareHistoricalSpecialTeamsSeason,
} = require('../services/historicalSpecialTeamsDataService')
const {
  STANDARD_ADJUSTMENTS,
  STANDARD_THRESHOLDS,
  buildComparison,
  buildFrozenSpecialTeamsReference,
  buildMatchupFacts,
  getPriorSeasonIds,
  normalizeRunPayload,
  rankSpecialTeamsRows,
  replaySpecialTeamsSeason,
  runSpecialTeamsCalibration,
} = require('../services/specialTeamsCalibrationService')
const { TEAM_IDENTITIES } = require('../services/nhlTeamIdentity')

const teamIds = TEAM_IDENTITIES.map(([teamId]) => teamId)
const teams = teamIds.map((teamId) => ({
  abbreviation: teamId,
  teamId,
  teamName: teamId,
}))

const makeSpecialTeamsRow = ({
  penaltyKillSituations = 200,
  powerPlayGoals = 40,
  powerPlayGoalsAllowed = 40,
  powerPlayOpportunities = 200,
  sourceTeamAbbreviation,
  teamId = sourceTeamAbbreviation,
  teamName = sourceTeamAbbreviation,
} = {}) => ({
  gamesPlayed: 82,
  penaltyKillSituations,
  powerPlayGoals,
  powerPlayGoalsAllowed,
  powerPlayOpportunities,
  rawPenaltyKillPercentage:
    1 - powerPlayGoalsAllowed / penaltyKillSituations,
  rawPowerPlayPercentage: powerPlayGoals / powerPlayOpportunities,
  sourceTeamAbbreviation,
  teamId,
  teamName,
})

const makeReferenceDataset = (seasonId, seasonIndex = 0) => ({
  seasonId,
  status: 'ready',
  teamCount: teamIds.length,
  teams: teamIds.map((teamId, teamIndex) =>
    makeSpecialTeamsRow({
      penaltyKillSituations: 300,
      powerPlayGoals: 20 + teamIndex + seasonIndex,
      powerPlayGoalsAllowed: 20 + teamIndex + seasonIndex,
      powerPlayOpportunities: 300,
      sourceTeamAbbreviation:
        teamId === 'UTA' && seasonId < '20242025' ? 'ARI' : teamId,
      teamId,
      teamName: teamId === 'UTA' ? 'Arizona Coyotes' : teamId,
    }),
  ),
})

const makeGame = ({
  away,
  awayScore = 1,
  date = '2023-10-10',
  home,
  homeScore = 3,
  id = `${away}-${home}`,
  seasonId = '20232024',
}) => ({
  __replayScheduleDate: date,
  awayScore,
  awayTeam: { abbreviation: away, name: away, score: awayScore, teamId: away },
  awayTeamAbbreviation: away,
  awayTeamId: away,
  gameDate: date,
  gameId: id,
  gameOutcome: { lastPeriodType: 'REG' },
  gameState: 'FINAL',
  gameType: 2,
  homeScore,
  homeTeam: { abbreviation: home, name: home, score: homeScore, teamId: home },
  homeTeamAbbreviation: home,
  homeTeamId: home,
  resultType: 'regulation',
  season: Number(seasonId),
  seasonId,
  startTimeUTC: `${date}T23:00:00.000Z`,
  timestamp: Date.parse(`${date}T23:00:00.000Z`),
})

const toPreparedShape = (game) => ({
  __replayScheduleDate: game.gameDate,
  awayTeam: {
    abbrev: game.awayTeamId,
    abbreviation: game.awayTeamId,
    score: game.awayScore,
  },
  gameId: game.gameId,
  gameOutcome: game.gameOutcome,
  gameState: game.gameState,
  gameType: game.gameType,
  homeTeam: {
    abbrev: game.homeTeamId,
    abbreviation: game.homeTeamId,
    score: game.homeScore,
  },
  season: Number(game.seasonId),
  startTimeUTC: game.startTimeUTC,
})

test('historical PP and PK percentages use production conventions', () => {
  assert.equal(calculatePowerPlayPercentage(45, 200), 0.225)
  assert.equal(
    Math.abs(calculatePenaltyKillPercentage(36, 200) - 0.82) < 1e-12,
    true,
  )
  assert.equal(calculatePowerPlayPercentage(1, 0), null)
  assert.equal(calculatePenaltyKillPercentage(201, 200), null)
})

test('historical Special Teams storage is shared and season-unique', () => {
  const indexes = HistoricalSpecialTeamsSeason.schema.indexes()

  assert.equal(HistoricalSpecialTeamsSeason.schema.paths.userId, undefined)
  assert.equal(
    HistoricalSpecialTeamsSeason.schema.paths.seasonId.options.unique,
    true,
  )
  assert.equal(
    indexes.some(([fields]) => fields.status === 1 && fields.seasonId === -1),
    true,
  )
})

test('historical rows canonicalize Arizona to Utah and reject partial seasons', () => {
  const normalized = normalizeSeasonRows(
    '20232024',
    [
      makeSpecialTeamsRow({
        sourceTeamAbbreviation: 'ARI',
        teamId: 53,
        teamName: 'Arizona Coyotes',
      }),
      makeSpecialTeamsRow({ sourceTeamAbbreviation: 'BOS' }),
    ],
    { expectedTeamCount: 2 },
  )

  assert.deepEqual(normalized.map((row) => row.teamId), ['BOS', 'UTA'])
  assert.throws(
    () =>
      normalizeSeasonRows(
        '20232024',
        [makeSpecialTeamsRow({ sourceTeamAbbreviation: 'BOS' })],
        { expectedTeamCount: 2 },
      ),
    (error) =>
      error.statusCode === 409 && error.details.actualTeamCount === 1,
  )
})

test('historical preparation is cached, retryable and makes one season provider load', async () => {
  let dataset = null
  let providerCalls = 0
  const repository = {
    async getDataset() {
      return dataset
    },
    async upsertDataset(seasonId, values) {
      dataset = { ...(dataset ?? {}), ...values, seasonId }
      return dataset
    },
  }
  const options = {
    expectedTeamCount: 2,
    repository,
    rowsProvider: async () => {
      providerCalls += 1
      return [
        makeSpecialTeamsRow({ sourceTeamAbbreviation: 'BOS' }),
        makeSpecialTeamsRow({ sourceTeamAbbreviation: 'NYR' }),
      ]
    },
  }

  const first = await prepareHistoricalSpecialTeamsSeason(
    '20222023',
    {},
    options,
  )
  const second = await prepareHistoricalSpecialTeamsSeason(
    '20222023',
    {},
    options,
  )

  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.equal(providerCalls, 1)
  assert.equal(dataset.teams.length, 2)
})

test('league ranking is deterministic and gives exact ties the same rank', () => {
  const rows = [
    { teamId: 'TOR', value: 0.2 },
    { teamId: 'BOS', value: 0.25 },
    { teamId: 'NYR', value: 0.25 },
    { teamId: 'MTL', value: 0.1 },
  ]
  const ranks = rankSpecialTeamsRows(rows, 'value')

  assert.deepEqual(
    Object.fromEntries(ranks),
    { BOS: 1, MTL: 4, NYR: 1, TOR: 3 },
  )
})

test('frozen ranking uses only S-3 through S-1 and preserves ARI/UTA identity', () => {
  const targetSeasonId = '20252026'
  const sourceSeasonIds = getPriorSeasonIds(targetSeasonId)
  const datasets = new Map(
    sourceSeasonIds.map((seasonId, index) => [
      seasonId,
      makeReferenceDataset(seasonId, index),
    ]),
  )
  datasets.set('20252026', {
    ...makeReferenceDataset('20252026', 100),
    teams: makeReferenceDataset('20252026', 100).teams.map((row) => ({
      ...row,
      rawPowerPlayPercentage: 0.99,
    })),
  })
  const reference = buildFrozenSpecialTeamsReference({
    seasonDatasets: datasets,
    targetSeasonId,
    targetTeamIds: teamIds,
  })
  const utah = reference.teams.find(
    (team) => team.teamAbbreviation === 'UTA',
  )

  assert.deepEqual(reference.sourceSeasonIds, [
    '20222023',
    '20232024',
    '20242025',
  ])
  assert.equal(reference.targetSeasonIncluded, false)
  assert.equal(reference.frozenBeforeTargetSeason, true)
  assert.equal(
    utah.seasonValues.some(
      (season) => season.sourceTeamAbbreviation === 'ARI',
    ),
    true,
  )
  assert.notEqual(utah.averagePowerPlayPercentage, 0.99)
})

test('missing or partial prior season is rejected instead of leaking target data', () => {
  const sourceSeasonIds = getPriorSeasonIds('20242025')
  const datasets = new Map(
    sourceSeasonIds.map((seasonId) => [seasonId, makeReferenceDataset(seasonId)]),
  )
  datasets.get(sourceSeasonIds[1]).status = 'error'

  assert.throws(
    () =>
      buildFrozenSpecialTeamsReference({
        seasonDatasets: datasets,
        targetSeasonId: '20242025',
        targetTeamIds: teamIds,
      }),
    (error) =>
      error.statusCode === 409 &&
      error.details.missingReferenceSeasonIds.includes(sourceSeasonIds[1]),
  )
})

test('shared matchup detector covers every standard threshold and dynamic league size', () => {
  STANDARD_THRESHOLDS.forEach((threshold) => {
    const positive = specialTeamsMatchups.calculateSpecialTeamsMatchup({
      awayTeamSpecialTeams: { powerPlayLeagueRank: threshold },
      homeTeamSpecialTeams: { penaltyKillLeagueRank: 33 - threshold },
      leagueTeamCount: 32,
      threshold,
    })
    const negative = specialTeamsMatchups.calculateSpecialTeamsMatchup({
      awayTeamSpecialTeams: { powerPlayLeagueRank: 33 - threshold },
      homeTeamSpecialTeams: { penaltyKillLeagueRank: threshold },
      leagueTeamCount: 32,
      threshold,
    })

    assert.equal(positive.away.status, 'positive')
    assert.equal(negative.away.status, 'negative')
  })

  const dynamic = specialTeamsMatchups.calculateSpecialTeamsMatchup({
    awayTeamSpecialTeams: { powerPlayLeagueRank: 4 },
    homeTeamSpecialTeams: { penaltyKillLeagueRank: 28 },
    leagueTeamCount: 31,
    threshold: 4,
  })
  assert.equal(dynamic.away.status, 'positive')
  assert.equal(dynamic.away.bottomRankStart, 28)

  const neutral = specialTeamsMatchups.calculateSpecialTeamsMatchup({
    awayTeamSpecialTeams: { powerPlayLeagueRank: 16 },
    homeTeamSpecialTeams: { penaltyKillLeagueRank: 16 },
    leagueTeamCount: 32,
    threshold: 6,
  })
  const unavailable = specialTeamsMatchups.calculateSpecialTeamsMatchup({
    awayTeamSpecialTeams: {},
    homeTeamSpecialTeams: { penaltyKillLeagueRank: 32 },
    leagueTeamCount: 32,
    threshold: 6,
  })

  assert.equal(neutral.away.status, 'neutral')
  assert.equal(unavailable.away.status, 'unavailable')
})

test('both teams can trigger while each team remains one classification', () => {
  const specialTeams = {
    leagueTeamCount: 32,
    teams: [
      { teamAbbreviation: 'BOS', powerPlayLeagueRank: 1, penaltyKillLeagueRank: 1 },
      { teamAbbreviation: 'NYR', powerPlayLeagueRank: 32, penaltyKillLeagueRank: 32 },
    ],
  }
  const facts = buildMatchupFacts(
    [makeGame({ away: 'NYR', home: 'BOS' })],
    specialTeams,
    [6],
  ).get(6).values().next().value

  assert.equal(facts.home.status, 'positive')
  assert.equal(facts.away.status, 'negative')
  assert.equal(typeof facts.home.status, 'string')
  assert.equal(typeof facts.away.status, 'string')
})

test('replay applies symmetric team adjustments and X=0 exactly reproduces control', () => {
  const game = makeGame({ away: 'NYR', home: 'BOS' })
  const factsByGameId = new Map([
    [
      game.gameId,
      {
        away: { rankGap: 31, status: 'negative' },
        home: { rankGap: 31, status: 'positive' },
      },
    ],
  ])
  const control = replaySpecialTeamsSeason({
    adjustment: 0,
    factsByGameId,
    games: [game],
    teams,
  })
  const adjusted = replaySpecialTeamsSeason({
    adjustment: 0.5,
    factsByGameId,
    games: [game],
    teams,
  })

  assert.equal(control.predictions[0].homeAdjustment, 0)
  assert.equal(control.predictions[0].awayAdjustment, 0)
  assert.equal(adjusted.predictions[0].homeAdjustment, 0.5)
  assert.equal(adjusted.predictions[0].awayAdjustment, -0.5)
  assert.equal(
    adjusted.predictions[0].homeAdjustment -
      adjusted.predictions[0].awayAdjustment,
    1,
  )
  assert.equal(
    adjusted.predictions[0].homeProbability >
      control.predictions[0].homeProbability,
    true,
  )
  assert.deepEqual(control.metrics, replaySpecialTeamsSeason({
    adjustment: 0,
    factsByGameId,
    games: [game],
    teams,
  }).metrics)
  assert.deepEqual(adjusted.occurrences, {
    bothTeamsSignal: 1,
    gamesAffected: 1,
    negativeOccurrences: 1,
    neutralOccurrences: 0,
    positiveOccurrences: 1,
    unavailableOccurrences: 0,
  })
})

test('comparison pools metrics, per-season metrics and occurrence totals exactly', () => {
  const firstGame = makeGame({ away: 'NYR', home: 'BOS', id: 'pool-1' })
  const secondGame = makeGame({
    away: 'TOR',
    date: '2024-10-10',
    home: 'MTL',
    id: 'pool-2',
    seasonId: '20242025',
  })
  const makeFacts = (game) => new Map([[game.gameId, {
    away: { rankGap: 20, status: 'negative' },
    home: { rankGap: 20, status: 'positive' },
  }]])
  const comparison = buildComparison({
    adjustment: 0.25,
    replayContexts: [
      {
        factsByThreshold: new Map([[6, makeFacts(firstGame)]]),
        games: [firstGame],
        seasonId: '20232024',
        teams,
      },
      {
        factsByThreshold: new Map([[6, makeFacts(secondGame)]]),
        games: [secondGame],
        seasonId: '20242025',
        teams,
      },
    ],
    threshold: 6,
  })

  assert.equal(comparison.games, 2)
  assert.equal(comparison.seasonResults.length, 2)
  assert.equal(comparison.occurrences.positiveOccurrences, 2)
  assert.equal(comparison.occurrences.negativeOccurrences, 2)
  assert.equal(comparison.occurrences.gamesAffected, 2)
  assert.equal(comparison.occurrences.bothTeamsSignal, 2)
  assert.equal(
    comparison.averageSeasonBrier,
    Number(
      (
        comparison.seasonResults.reduce(
          (sum, season) => sum + season.metrics.brierScore,
          0,
        ) / 2
      ).toFixed(8),
    ),
  )
})

test('run payload validates one optional custom threshold from 2 through 12', () => {
  assert.deepEqual(normalizeRunPayload({ customThreshold: 2 }).thresholds, [
    2,
    4,
    6,
    8,
    10,
  ])
  assert.deepEqual(normalizeRunPayload({ customThreshold: 12 }).thresholds, [
    4,
    6,
    8,
    10,
    12,
  ])
  ;[1, 13, 4.5, 'x'].forEach((value) => {
    assert.throws(
      () => normalizeRunPayload({ customThreshold: value }),
      (error) => error.statusCode === 400,
    )
  })
})

test('prepared replay runs the full grid without provider, rating or Settings writes', async () => {
  const seasonId = '20232024'
  const games = teamIds.slice(0, 16).map((home, index) =>
    toPreparedShape(
      makeGame({
        away: teamIds[index + 16],
        date: `2023-10-${String(10 + index).padStart(2, '0')}`,
        home,
        id: `grid-${index}`,
        seasonId,
      }),
    ),
  )
  const sourceSeasonIds = getPriorSeasonIds(seasonId)
  const referenceDatasets = new Map(
    sourceSeasonIds.map((sourceSeasonId, index) => [
      sourceSeasonId,
      makeReferenceDataset(sourceSeasonId, index),
    ]),
  )
  let historicalLoads = 0
  let specialTeamsLoads = 0
  let teamLoads = 0
  let productionWriteAttempts = 0
  const patchedMethods = []

  ;[
    [PowerRating, ['bulkWrite', 'findOneAndUpdate', 'updateMany', 'updateOne']],
    [ProcessedRatingGame, ['bulkWrite', 'create', 'findOneAndUpdate']],
    [RatingEngineSettings, ['findOneAndUpdate', 'updateMany', 'updateOne']],
  ].forEach(([model, methods]) => {
    methods.forEach((method) => {
      if (typeof model[method] !== 'function') return
      patchedMethods.push([model, method, model[method]])
      model[method] = async () => {
        productionWriteAttempts += 1
        throw new Error('Production write attempted')
      }
    })
  })

  let result

  try {
    result = await runSpecialTeamsCalibration(
      'user-1',
      { seasonIds: [seasonId] },
      {
        historicalGamesLoader: async () => {
          historicalLoads += 1
          return {
            datasetsBySeason: new Map([[seasonId, { seasonId, status: 'ready' }]]),
            gamesBySeason: new Map([[seasonId, games]]),
          }
        },
        specialTeamsLoader: async () => {
          specialTeamsLoads += 1
          return referenceDatasets
        },
        teamsProvider: async () => {
          teamLoads += 1
          return teams
        },
      },
    )
  } finally {
    patchedMethods.reverse().forEach(([model, method, original]) => {
      model[method] = original
    })
  }

  assert.equal(historicalLoads, 1)
  assert.equal(specialTeamsLoads, 1)
  assert.equal(teamLoads, 1)
  assert.equal(productionWriteAttempts, 0)
  assert.equal(result.comparisons.length, 20)
  assert.equal(result.standardCombinationCount, 20)
  assert.equal(result.thresholdSummary.length, 4)
  assert.equal(result.diagnostics.providerCallsDuringReplay, false)
  assert.equal(result.diagnostics.productionWrites, false)
  assert.equal(result.diagnostics.targetSeasonDataIncludedInReference, false)
  const controlBriers = result.comparisons
    .filter((comparison) => comparison.adjustment === 0)
    .map((comparison) => comparison.metrics.brierScore)
  assert.equal(new Set(controlBriers).size, 1)
  assert.deepEqual(result.adjustmentOptions, STANDARD_ADJUSTMENTS)
})

test('Phase 4 routes require authentication', async () => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    for (const [path, method] of [
      ['/api/power-rating-simulations/special-teams/options', 'GET'],
      ['/api/power-rating-simulations/special-teams/run', 'POST'],
      ['/api/power-rating-simulations/special-teams/historical-seasons/20232024/prepare', 'POST'],
      ['/api/power-rating-simulations/special-teams/reference-seasons/20202021/prepare', 'POST'],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        body: method === 'POST' ? '{}' : undefined,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        method,
      })

      assert.equal(response.status, 401)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
