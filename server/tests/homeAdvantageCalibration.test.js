process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const baseCalibrationService = require('../services/baseModelCalibrationService')
const homeCalibrationService = require('../services/homeAdvantageCalibrationService')
const {
  WINNERS,
  createRatingEngineConfiguration,
} = require('../services/powerRatingEngine')

const teams = [
  { abbreviation: 'BOS', teamId: 'BOS', teamName: 'Alpha' },
  { abbreviation: 'TOR', teamId: 'TOR', teamName: 'Beta' },
  { abbreviation: 'NYR', teamId: 'NYR', teamName: 'Gamma' },
]

const makeGame = ({
  away = 'TOR',
  awayScore = 2,
  gameType = 2,
  home = 'BOS',
  homeScore = 3,
  id = '1',
  resultType = 'regulation',
  seasonId = '20232024',
  startTimeUTC = '2023-10-10T23:00:00.000Z',
} = {}) => ({
  awayScore,
  awayTeamAbbreviation: away,
  awayTeamId: away,
  gameId: id,
  gameState: 'OFF',
  gameType,
  homeScore,
  homeTeamAbbreviation: home,
  homeTeamId: home,
  resultType,
  seasonId,
  startTimeUTC,
})

const makeSeasonGames = (seasonId, winner = 'home') => [
  makeGame({
    awayScore: winner === 'home' ? 1 : 3,
    homeScore: winner === 'home' ? 3 : 1,
    id: `${seasonId}-1`,
    seasonId,
    startTimeUTC: `${seasonId.slice(0, 4)}-10-10T23:00:00.000Z`,
  }),
]

const makeStatusProvider = (missingIds = []) => async (definitions) =>
  definitions.map((season) => ({
    completedGames: missingIds.includes(season.id) ? 0 : 1312,
    seasonId: season.id,
    status: missingIds.includes(season.id) ? 'not_imported' : 'ready',
  }))

const makeRankRows = (values) => values.map((homePointsAdvantage, index) => ({
  homePointsAdvantage,
  homeWinAdvantage: index % 2 === 0 ? -1 : 1,
  teamId: `T${String(index + 1).padStart(2, '0')}`,
  teamName: `Team ${String(index + 1).padStart(2, '0')}`,
}))

const makeValuesFromGaps = (teamCount, customGaps = {}, startingValue = 0.4) => {
  const values = [startingValue]

  for (let cutIndex = 1; cutIndex < teamCount; cutIndex += 1) {
    values.push(values[cutIndex - 1] - (customGaps[cutIndex] ?? 0.002))
  }

  return values
}

test('home and away points, wins, OTL and percentage-point advantages are calculated from games', () => {
  const analysis = homeCalibrationService.aggregateHomePerformance({
    games: [
      makeGame({ id: '1' }),
      makeGame({
        awayScore: 3,
        homeScore: 2,
        id: '2',
        resultType: 'overtime',
      }),
      makeGame({
        away: 'BOS',
        awayScore: 4,
        home: 'TOR',
        homeScore: 1,
        id: '3',
      }),
    ],
    seasonIds: ['20232024'],
    teams,
  })
  const alpha = analysis.teams.find((team) => team.teamId === 'BOS')

  assert.deepEqual(alpha.home, {
    gamesPlayed: 2,
    losses: 0,
    overtimeLosses: 1,
    points: 3,
    pointsPercentage: 0.75,
    winPercentage: 0.5,
    wins: 1,
  })
  assert.equal(alpha.away.pointsPercentage, 1)
  assert.equal(alpha.away.winPercentage, 1)
  assert.equal(alpha.homePointsAdvantage, -0.25)
  assert.equal(alpha.homeWinAdvantage, -0.5)
})

test('three-season aggregation pools points and possible points instead of averaging yearly rates', () => {
  const games = [
    makeGame({ id: 's1', seasonId: '20232024' }),
    ...Array.from({ length: 3 }, (_item, index) =>
      makeGame({
        awayScore: 3,
        homeScore: 1,
        id: `s2-${index}`,
        seasonId: '20242025',
      })),
  ]
  const analysis = homeCalibrationService.aggregateHomePerformance({
    games,
    seasonIds: ['20232024', '20242025'],
    teams,
  })
  const alpha = analysis.teams.find((team) => team.teamId === 'BOS')

  assert.equal(alpha.home.gamesPlayed, 4)
  assert.equal(alpha.home.pointsPercentage, 0.25)
  assert.notEqual(alpha.home.pointsPercentage, (1 + 0) / 2)
  assert.match(analysis.aggregationMethod, /pooled across seasons/i)
})

test('Home Points Advantage keeps the full unrounded internal proportion', () => {
  const analysis = homeCalibrationService.aggregateHomePerformance({
    games: [
      makeGame({ id: 'home-win' }),
      makeGame({ awayScore: 3, homeScore: 1, id: 'home-loss-1' }),
      makeGame({ awayScore: 3, homeScore: 1, id: 'home-loss-2' }),
      makeGame({ away: 'BOS', home: 'NYR', id: 'away-loss' }),
    ],
    seasonIds: ['20232024'],
    teams,
  })
  const alpha = analysis.teams.find((team) => team.teamId === 'BOS')

  assert.equal(alpha.home.pointsPercentage, 1 / 3)
  assert.equal(alpha.homePointsAdvantage, 1 / 3)
  assert.notEqual(alpha.homePointsAdvantage, 0.33333333)
})

test('ranking uses full-precision Home Points Advantage and diagnostic wins do not rank teams', () => {
  const ranked = homeCalibrationService.classifyHomeAdvantageTiers([
    { homePointsAdvantage: 0.2, homeWinAdvantage: -1, teamId: 'Z', teamName: 'Zulu' },
    { homePointsAdvantage: 0.2, homeWinAdvantage: 1, teamId: 'A', teamName: 'Alpha' },
    ...makeRankRows(makeValuesFromGaps(7, {}, 0.19)),
  ]).teams

  assert.equal(ranked[0].teamName, 'Alpha')
  assert.equal(ranked[1].teamName, 'Zulu')
  assert.equal(homeCalibrationService.TIER_BOUNDARY_CONFIG.effectiveTieTolerance, 0.001)
  assert.equal(homeCalibrationService.TIER_BOUNDARY_CONFIG.searchRadius, 3)
  assert.equal(homeCalibrationService.getMinimumTierSize(32), 6)
})

test('exact tied values at a boundary stay together around the realistic +11.8/+10.6 fixture', () => {
  const values = makeValuesFromGaps(32, {
    9: 0.012,
    10: 0,
    11: 0,
    12: 0,
    22: 0.015,
  }, 0.136)
  values[8] = 0.118
  values[9] = 0.106
  values[10] = 0.106
  values[11] = 0.106
  values[12] = 0.106
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(values),
  )
  const tiedTiers = classification.teams
    .filter((team) => team.homePointsAdvantage === 0.106)
    .map((team) => team.tier)

  assert.deepEqual([...new Set(tiedTiers)], ['Normal'])
  assert.equal(classification.tierBoundaries.strongNormal.boundaryAfterRank, 9)
  assert.ok(
    Math.abs(classification.tierBoundaries.strongNormal.gap - 0.012) < 1e-12,
  )
})

test('near-tied values within tolerance are never split across tiers', () => {
  const values = makeValuesFromGaps(32, { 10: 0.02, 11: 0.0003, 12: 0.0003, 22: 0.02 })
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(values),
  )
  const boundaryCluster = classification.teams.slice(10, 13)

  assert.equal(new Set(boundaryCluster.map((team) => team.tier)).size, 1)
  assert.notEqual(classification.tierBoundaries.strongNormal.boundaryAfterRank, 11)
  assert.notEqual(classification.tierBoundaries.strongNormal.boundaryAfterRank, 12)
})

test('largest meaningful local gap before the approximate tercile becomes the boundary', () => {
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(makeValuesFromGaps(30, { 8: 0.03, 20: 0.03 })),
  )

  assert.equal(classification.tierBoundaries.strongNormal.boundaryAfterRank, 8)
  assert.equal(classification.tierBoundaries.strongNormal.selection, 'largest_meaningful_local_gap')
})

test('largest meaningful local gap after the approximate tercile becomes the boundary', () => {
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(makeValuesFromGaps(30, { 12: 0.03, 22: 0.03 })),
  )

  assert.equal(classification.tierBoundaries.strongNormal.boundaryAfterRank, 12)
})

test('deterministic fallback preserves a local tie cluster and chooses the closest valid cut', () => {
  const values = [
    ...Array(14).fill(0.2),
    ...Array(6).fill(0.1),
    ...Array(10).fill(0),
  ]
  const rows = makeRankRows(values)
  const first = homeCalibrationService.classifyHomeAdvantageTiers(rows)
  const second = homeCalibrationService.classifyHomeAdvantageTiers([...rows].reverse())

  assert.equal(first.tierBoundaries.strongNormal.boundaryAfterRank, 14)
  assert.equal(first.tierBoundaries.strongNormal.selection, 'closest_valid_fallback')
  assert.deepEqual(first.tierSizes, second.tierSizes)
  assert.deepEqual(
    first.teams.map(({ teamId, tier }) => ({ teamId, tier })),
    second.teams.map(({ teamId, tier }) => ({ teamId, tier })),
  )
})

test('minimum tier safeguard rejects a larger gap that would make Normal too small', () => {
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(makeValuesFromGaps(32, { 14: 0.04, 19: 0.08, 20: 0.02 })),
  )

  assert.equal(classification.tierSizes.strong, 14)
  assert.equal(classification.tierSizes.normal, 6)
  assert.equal(classification.tierBoundaries.normalWeak.boundaryAfterRank, 20)
  assert.ok(Object.values(classification.tierSizes).every((size) => size >= 6))
})

test('alphabetical or input ordering cannot split an effective-tie cluster', () => {
  const values = makeValuesFromGaps(32, { 9: 0.02, 10: 0, 11: 0, 12: 0, 22: 0.02 })
  const rows = makeRankRows(values).map((row, index) => ({
    ...row,
    teamName: index >= 9 && index <= 12 ? ['Zulu', 'Alpha', 'Mike', 'Bravo'][index - 9] : row.teamName,
  }))
  const classifications = [rows, [...rows].reverse()].map((input) =>
    homeCalibrationService.classifyHomeAdvantageTiers(input))

  classifications.forEach((classification) => {
    const tiedTeams = classification.teams.filter(
      (team) => team.homePointsAdvantage === values[9],
    )
    assert.equal(new Set(tiedTeams.map((team) => team.tier)).size, 1)
  })
})

test('realistic 32-team gaps allow variable 9/14/9 tier sizes', () => {
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(makeValuesFromGaps(32, { 9: 0.03, 23: 0.03 })),
  )

  assert.deepEqual(classification.tierSizes, { normal: 14, strong: 9, weak: 9 })
})

test('gap-aware boundaries and generic minimum safeguards support future team counts', () => {
  const classification = homeCalibrationService.classifyHomeAdvantageTiers(
    makeRankRows(makeValuesFromGaps(40, { 12: 0.03, 29: 0.03 })),
  )

  assert.deepEqual(classification.tierSizes, { normal: 17, strong: 12, weak: 11 })
  assert.equal(homeCalibrationService.getMinimumTierSize(40), 6)
  assert.equal(homeCalibrationService.getMinimumTierSize(12), 4)
})

test('Arizona history is explicitly aggregated into current Utah and playoffs are excluded', () => {
  const analysis = homeCalibrationService.aggregateHomePerformance({
    games: [
      makeGame({ home: 'ARI', id: 'ari' }),
      makeGame({ gameType: 3, home: 'ARI', id: 'playoff' }),
    ],
    seasonIds: ['20232024'],
    teams: [
      { abbreviation: 'UTA', teamId: 'UTA', teamName: 'Utah Mammoth' },
      { abbreviation: 'TOR', teamId: 'TOR', teamName: 'Beta' },
      { abbreviation: 'NYR', teamId: 'NYR', teamName: 'Gamma' },
    ],
  })
  const utah = analysis.teams.find((team) => team.teamId === 'UTA')

  assert.equal(utah.home.gamesPlayed, 1)
  assert.equal(analysis.gamesIncluded, 1)
  assert.equal(analysis.gamesSkipped, 1)
})

test('2025-26 tiers use only three completed prior seasons and freeze before replay', () => {
  const gamesBySeason = new Map([
    ['20222023', makeSeasonGames('20222023', 'home')],
    ['20232024', makeSeasonGames('20232024', 'home')],
    ['20242025', makeSeasonGames('20242025', 'away')],
    ['20252026', makeSeasonGames('20252026', 'home')],
    ['20262027', makeSeasonGames('20262027', 'away')],
  ])
  const snapshots = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason,
    teams,
  })
  const snapshot = snapshots.find((item) => item.targetSeasonId === '20252026')

  assert.deepEqual(snapshot.sourceSeasonIds, [
    '20222023',
    '20232024',
    '20242025',
  ])
  assert.equal(snapshot.sourceSeasonIds.includes(snapshot.targetSeasonId), false)
  assert.equal(snapshot.sourceSeasonIds.includes('20262027'), false)
  assert.equal(snapshot.assignedBeforeReplay, true)
  assert.equal(Object.isFrozen(snapshot.tiers), true)
})

test('changing target-season results cannot change that target season tier snapshot', () => {
  const sourceGames = new Map([
    ['20202021', makeSeasonGames('20202021')],
    ['20212022', makeSeasonGames('20212022')],
    ['20222023', makeSeasonGames('20222023')],
    ['20232024', makeSeasonGames('20232024', 'home')],
    ['20242025', makeSeasonGames('20242025')],
  ])
  const changedTargetGames = new Map(sourceGames)
  changedTargetGames.set('20232024', makeSeasonGames('20232024', 'away'))
  const first = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason: sourceGames,
    teams,
  })[0]
  const second = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason: changedTargetGames,
    teams,
  })[0]

  assert.deepEqual(first.tiers, second.tiers)
})

test('every historical target independently calculates gap-aware boundaries from its prior window', () => {
  const gamesBySeason = new Map(
    homeCalibrationService.REQUIRED_SEASON_IDS.map((seasonId, index) => [
      seasonId,
      makeSeasonGames(seasonId, index % 2 === 0 ? 'home' : 'away'),
    ]),
  )
  const snapshots = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason,
    teams,
  })

  assert.equal(snapshots.length, 3)
  snapshots.forEach((snapshot) => {
    assert.deepEqual(
      snapshot.sourceSeasonIds,
      homeCalibrationService.getPriorSeasonIds(snapshot.targetSeasonId),
    )
    assert.equal(snapshot.sourceSeasonIds.includes(snapshot.targetSeasonId), false)
    assert.equal(snapshot.tierBoundaries.method, 'local_gap_aware')
    assert.equal(
      snapshot.tierBoundaries.version,
      homeCalibrationService.TIER_BOUNDARY_CONFIG.version,
    )
  })
  assert.notEqual(snapshots[0].tierBoundaries, snapshots[1].tierBoundaries)
})

test('changing a season affects no historical snapshot whose prior window excludes it', () => {
  const gamesBySeason = new Map(
    homeCalibrationService.REQUIRED_SEASON_IDS.map((seasonId) => [
      seasonId,
      makeSeasonGames(seasonId, 'home'),
    ]),
  )
  const changedGamesBySeason = new Map(gamesBySeason)
  changedGamesBySeason.set('20202021', makeSeasonGames('20202021', 'away'))
  const original = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason,
    teams,
  })
  const changed = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason: changedGamesBySeason,
    teams,
  })

  assert.deepEqual(changed[1].tiers, original[1].tiers)
  assert.deepEqual(changed[1].tierBoundaries, original[1].tierBoundaries)
  assert.deepEqual(changed[2].tiers, original[2].tiers)
  assert.deepEqual(changed[2].tierBoundaries, original[2].tierBoundaries)
})

test('historical tier assignments remain frozen and unchanged throughout replay', () => {
  const gamesBySeason = new Map(
    homeCalibrationService.REQUIRED_SEASON_IDS.map((seasonId) => [
      seasonId,
      makeSeasonGames(seasonId),
    ]),
  )
  const snapshot = homeCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason,
    teams,
  })[0]
  const tiersBeforeReplay = { ...snapshot.tiers }

  homeCalibrationService.replaySeasonWithTierAdjustment({
    adjustment: 0.5,
    games: gamesBySeason.get(snapshot.targetSeasonId),
    snapshot,
    teams,
  })

  assert.equal(Object.isFrozen(snapshot.tiers), true)
  assert.deepEqual(snapshot.tiers, tiersBeforeReplay)
})

test('insufficient prior data reports the exact additional seasons required', async () => {
  await assert.rejects(
    () => homeCalibrationService.runHomeAdvantageCalibration('user-1', {}, {
      historicalLoadProvider: async () => ({ gamesBySeason: new Map() }),
      historicalStatusProvider: makeStatusProvider(['20202021', '20212022']),
      teamsProvider: async () => teams,
    }),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.deepEqual(error.details.missingSeasonIds, ['20202021', '20212022'])
      return true
    },
  )
})

test('options reuse prepared Mongo season loads for current ranking and stability', async () => {
  const gamesBySeason = new Map(
    homeCalibrationService.REQUIRED_SEASON_IDS.map((seasonId, index) => [
      seasonId,
      [makeGame({
        id: `${seasonId}-options`,
        seasonId,
        startTimeUTC: `${2020 + index}-10-10T23:00:00.000Z`,
      })],
    ]),
  )
  let loadedSeasonIds = []
  const options = await homeCalibrationService.getHomeAdvantageCalibrationOptions(
    'user-1',
    {
      historicalLoadProvider: async (seasonIds) => {
        loadedSeasonIds = seasonIds
        return { gamesBySeason }
      },
      historicalStatusProvider: makeStatusProvider(),
      teamsProvider: async () => teams,
    },
  )

  assert.deepEqual(loadedSeasonIds, homeCalibrationService.REQUIRED_SEASON_IDS)
  assert.equal(options.readiness.currentRankingReady, true)
  assert.equal(options.readiness.backtestReady, true)
  assert.deepEqual(options.currentAnalysis.seasonIds, [
    '20232024',
    '20242025',
    '20252026',
  ])
  assert.equal(options.currentAnalysis.gamesIncluded, 3)
  assert.equal(options.stability.teams.length, teams.length)
  assert.equal(options.isolation.productionWrites, false)
  assert.equal(options.tierBoundaries.method, 'local_gap_aware')
  assert.equal(
    options.defaults.tierBoundaryConfig.version,
    homeCalibrationService.TIER_BOUNDARY_CONFIG.version,
  )
})

test('tier adjustment applies only to the home team with fixed base HA 3.5', () => {
  const snapshot = {
    targetSeasonId: '20232024',
    tiers: { BOS: 'Strong', TOR: 'Normal', NYR: 'Weak' },
  }
  const games = [
    makeGame({ away: 'TOR', home: 'BOS', id: 'strong' }),
    makeGame({ away: 'BOS', home: 'TOR', id: 'normal', startTimeUTC: '2023-10-11T23:00:00.000Z' }),
    makeGame({ away: 'BOS', home: 'NYR', id: 'weak', startTimeUTC: '2023-10-12T23:00:00.000Z' }),
  ]
  const replay = homeCalibrationService.replaySeasonWithTierAdjustment({
    adjustment: 0.5,
    games,
    snapshot,
    teams,
  })
  const byGame = new Map(replay.predictions.map((prediction) => [prediction.gameId, prediction]))

  assert.equal(byGame.get('strong').effectiveHomeAdvantage, 4)
  assert.equal(byGame.get('normal').effectiveHomeAdvantage, 3.5)
  assert.equal(byGame.get('weak').effectiveHomeAdvantage, 3)
  assert.equal(byGame.get('normal').homeTier, 'Normal')

  const changedAwayTier = homeCalibrationService.replaySeasonWithTierAdjustment({
    adjustment: 0.5,
    games: [games[0]],
    snapshot: {
      ...snapshot,
      tiers: { ...snapshot.tiers, TOR: 'Strong' },
    },
    teams,
  })
  assert.equal(
    changedAwayTier.predictions[0].homeProbability,
    byGame.get('strong').homeProbability,
  )
})

test('X=0 exactly reproduces Base Model v1 replay probabilities', () => {
  const snapshot = {
    targetSeasonId: '20232024',
    tiers: { BOS: 'Strong', TOR: 'Weak', NYR: 'Normal' },
  }
  const games = [makeGame()]
  const tierReplay = homeCalibrationService.replaySeasonWithTierAdjustment({
    adjustment: 0,
    games,
    snapshot,
    teams,
  })
  const input = {
    configuration: createRatingEngineConfiguration({
      kFactor: BASE_MODEL_V1.kFactor,
      overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
      regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
      shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
    }),
    homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
    probabilityScale: BASE_MODEL_V1.probabilityScale,
    startingRatings: {
      center: 46,
      mode: baseCalibrationService.STARTING_MODES.FIXED_SPREAD,
      spread: 8,
    },
  }
  const baseState = baseCalibrationService.buildStartingState({
    currentRatings: [],
    input,
    orderingMode: 'historical_fallback',
    teams,
  })
  const baseReplay = baseCalibrationService.replayDataset({
    includedGames: [{
      awayTeam: teams[1],
      game: { id: '1' },
      homeTeam: teams[0],
      resultType: 'regulation',
      winner: WINNERS.HOME,
    }],
    input,
    ratingState: baseState,
  })

  assert.equal(
    tierReplay.predictions[0].homeProbability,
    baseReplay.predictions[0].homeProbability,
  )
})

test('comparison pools metrics, isolates seasons, calculates deltas and season results', () => {
  const targetIds = homeCalibrationService.BACKTEST_TARGET_SEASON_IDS
  const gamesBySeason = new Map(targetIds.map((seasonId, index) => [
    seasonId,
    [makeGame({
      id: `${seasonId}-game`,
      seasonId,
      startTimeUTC: `${2023 + index}-10-10T23:00:00.000Z`,
    })],
  ]))
  const snapshots = targetIds.map((targetSeasonId) => ({
    targetSeasonId,
    tierSizes: { normal: 1, strong: 1, weak: 1 },
    tiers: { BOS: 'Strong', TOR: 'Weak', NYR: 'Normal' },
  }))
  const comparisons = homeCalibrationService.compareAdjustments({
    adjustments: [0, 0.5],
    gamesBySeason,
    snapshots,
    teams,
  })

  assert.equal(comparisons.length, 2)
  assert.equal(comparisons[0].seasonResults.length, 3)
  assert.equal(comparisons[0].delta.brierScore, 0)
  assert.equal(comparisons[0].delta.logLoss, 0)
  assert.equal(comparisons[0].seasonResults[0].metrics.brierScore, comparisons[0].seasonResults[1].metrics.brierScore)
  assert.deepEqual(comparisons[0].seasonResults[0].tierSizes, {
    normal: 1,
    strong: 1,
    weak: 1,
  })
  assert.equal(Number.isFinite(comparisons[1].metrics.expectedCalibrationError), true)
  assert.equal(Number.isFinite(comparisons[1].averageSeasonBrier), true)
})

test('custom adjustment validation retains all initial symmetric test values', () => {
  assert.deepEqual(homeCalibrationService.normalizeAdjustmentPayload({}), [0, 0.25, 0.5, 0.75, 1])
  assert.deepEqual(homeCalibrationService.normalizeAdjustmentPayload({ customAdjustment: 0.6 }), [0, 0.25, 0.5, 0.6, 0.75, 1])
  assert.throws(
    () => homeCalibrationService.normalizeAdjustmentPayload({ customAdjustment: -1 }),
    /between 0 and 5/,
  )
})

test('shortened 2020-21 preparation uses the shared historical system with a plausible threshold', async () => {
  let captured = null
  await homeCalibrationService.prepareHomeAdvantageHistoricalSeason(
    'user-1',
    '20202021',
    { refresh: false },
    {
      prepareProvider: async (seasonId, payload, options) => {
        captured = { options, payload, seasonId }
        return { status: 'partial' }
      },
    },
  )

  assert.equal(captured.seasonId, '20202021')
  assert.equal(captured.options.minimumPlausibleGames, 800)
  assert.equal(captured.options.season.expectedApproximateGames, 868)
})

test('full multi-season calibration leaves production settings, ratings and history untouched', async () => {
  const originals = [
    [PowerRating, 'findOneAndUpdate', PowerRating.findOneAndUpdate],
    [ProcessedRatingGame, 'create', ProcessedRatingGame.create],
    [RatingEngineSettings, 'findOneAndUpdate', RatingEngineSettings.findOneAndUpdate],
  ]
  let productionWriteAttempts = 0
  originals.forEach(([model, method]) => {
    model[method] = () => {
      productionWriteAttempts += 1
      throw new Error('Production write attempted')
    }
  })
  const gamesBySeason = new Map(
    homeCalibrationService.REQUIRED_SEASON_IDS.map((seasonId, index) => [
      seasonId,
      [makeGame({
        id: `${seasonId}-isolation`,
        seasonId,
        startTimeUTC: `${2020 + index}-10-10T23:00:00.000Z`,
      })],
    ]),
  )

  try {
    const calibration = await homeCalibrationService.runHomeAdvantageCalibration(
      'user-1',
      { customAdjustment: 0.6 },
      {
        historicalLoadProvider: async () => ({ gamesBySeason }),
        historicalStatusProvider: makeStatusProvider(),
        teamsProvider: async () => teams,
      },
    )

    assert.equal(calibration.diagnostics.productionWrites, false)
    assert.equal(calibration.diagnostics.ratingResetBetweenSeasons, true)
    assert.equal(
      calibration.diagnostics.tierAlgorithmVersion,
      homeCalibrationService.TIER_BOUNDARY_CONFIG.version,
    )
    assert.equal(calibration.comparisons.length, 6)
    assert.equal(calibration.snapshots.length, 3)
    assert.ok(
      calibration.snapshots.every(
        (snapshot) => snapshot.tierBoundaries.method === 'local_gap_aware',
      ),
    )
    assert.equal(productionWriteAttempts, 0)
  } finally {
    originals.forEach(([model, method, original]) => {
      model[method] = original
    })
  }
})

test('Team Home Advantage routes require authentication', async () => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    for (const [path, method] of [
      ['/api/power-rating-simulations/home-advantage/options', 'GET'],
      ['/api/power-rating-simulations/home-advantage/run', 'POST'],
      ['/api/power-rating-simulations/home-advantage/historical-seasons/20202021/prepare', 'POST'],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        method,
        ...(method === 'POST' ? { body: '{}' } : {}),
      })
      assert.equal(response.status, 401)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
