process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const GameContext = require('../models/GameContext')
const PowerRating = require('../models/PowerRating')
const ProcessedRatingGame = require('../models/ProcessedRatingGame')
const QuickRematchSettings = require('../models/QuickRematchSettings')
const RatingEngineSettings = require('../models/RatingEngineSettings')
const {
  RULES,
  RULE_IDS,
  QUICK_REMATCH_ADJUSTMENTS,
  QUICK_REMATCH_WINDOWS,
  buildReplayGames,
  buildScheduleFacts,
  compareQuickRematchGrid,
  getScheduleCalibrationOptions,
  normalizeRunPayload,
  preparePhase3ReplayGames,
  replaySeason,
  runScheduleCalibration,
} = require('../services/scheduleCalibrationService')
const { prepareDataset } = require('../services/baseModelCalibrationService')
const {
  DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS,
  normalizeSettingsPayload,
} = require('../services/quickRematchSettingsService')
const {
  EXPECTED_APPROXIMATE_GAMES,
} = require('../services/historicalNhlDataService')

const teams = ['BOS', 'NYR', 'TOR', 'MTL'].map((teamId) => ({
  abbreviation: teamId,
  teamId,
  teamName: teamId,
}))

const withPatches = async (patches, callback) => {
  const originals = patches.map(([target, property, replacement]) => {
    const original = target[property]
    target[property] = replacement

    return [target, property, original]
  })

  try {
    return await callback()
  } finally {
    originals.reverse().forEach(([target, property, original]) => {
      target[property] = original
    })
  }
}

const makeGame = ({
  away = 'NYR',
  awayScore = 1,
  date,
  home = 'BOS',
  homeScore = 3,
  id = date,
  resultType = 'regulation',
  seasonId = '20232024',
}) => {
  const startTimeUTC = `${date}T23:00:00.000Z`
  const lastPeriodType = {
    overtime: 'OT',
    regulation: 'REG',
    shootout: 'SO',
  }[resultType]
  return {
    __replayScheduleDate: date,
    awayScore,
    awayTeam: { abbreviation: away, name: away, score: awayScore, teamId: away },
    awayTeamAbbreviation: away,
    awayTeamId: away,
    gameDate: date,
    gameId: id,
    gameOutcome: { lastPeriodType },
    gameState: 'FINAL',
    gameType: 2,
    homeScore,
    homeTeam: { abbreviation: home, name: home, score: homeScore, teamId: home },
    homeTeamAbbreviation: home,
    homeTeamId: home,
    resultType,
    season: Number(seasonId),
    seasonId,
    startTimeUTC,
    timestamp: Date.parse(startTimeUTC),
  }
}

const toPreparedReplayShape = (game) => ({
  __replayScheduleDate: game.gameDate,
  awayTeam: {
    abbrev: game.awayTeam.abbreviation,
    abbreviation: game.awayTeam.abbreviation,
    score: game.awayScore,
  },
  gameId: game.gameId,
  gameOutcome: game.gameOutcome,
  gameState: game.gameState,
  gameType: game.gameType,
  homeTeam: {
    abbrev: game.homeTeam.abbreviation,
    abbreviation: game.homeTeam.abbreviation,
    score: game.homeScore,
  },
  season: Number(game.seasonId),
  startTimeUTC: game.startTimeUTC,
})

const toStoredHistoricalDocument = (game) => ({
  awayScore: game.awayScore,
  awayTeamAbbreviation: game.awayTeamAbbreviation,
  awayTeamId: game.awayTeamId,
  gameDate: game.gameDate,
  gameId: game.gameId,
  gameState: game.gameState,
  gameType: game.gameType,
  homeScore: game.homeScore,
  homeTeamAbbreviation: game.homeTeamAbbreviation,
  homeTeamId: game.homeTeamId,
  resultType: game.resultType,
  seasonId: game.seasonId,
  startTimeUTC: new Date(game.startTimeUTC),
})

const seasonFixtures = [
  { canonical: '20232024', display: '2023-24', startDate: '2023-10-10' },
  { canonical: '20242025', display: '2024-25', startDate: '2024-10-04' },
  { canonical: '20252026', display: '2025-26', startDate: '2025-10-07' },
]

const makePreparedSeasonFixture = ({ canonical, startDate }) =>
  Array.from({ length: EXPECTED_APPROXIMATE_GAMES }, (_, index) => {
    const date = new Date(`${startDate}T23:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + (index % 30))

    return toPreparedReplayShape(makeGame({
      away: index % 2 === 0 ? 'NYR' : 'MTL',
      date: date.toISOString().slice(0, 10),
      home: index % 2 === 0 ? 'BOS' : 'TOR',
      id: `${canonical}-${index}`,
      seasonId: canonical,
    }))
  })

const getCondition = (games, gameId, side = 'homeCondition') =>
  buildScheduleFacts(games).get(gameId)[side]

test('production schedule definitions detect Well Rested and season openings', () => {
  const opening = makeGame({ date: '2023-10-01', id: 'opening' })
  const rested = makeGame({ date: '2023-10-04', id: 'rested' })
  const games = [opening, rested]

  assert.equal(getCondition(games, 'opening'), 'normal')
  assert.equal(getCondition(games, 'rested'), RULE_IDS.WELL_RESTED)
})

test('production schedule definitions detect 3-in-4 without double application', () => {
  const games = [
    makeGame({ date: '2023-10-01', id: 'one' }),
    makeGame({ away: 'TOR', date: '2023-10-02', id: 'two' }),
    makeGame({ away: 'MTL', date: '2023-10-04', id: 'three' }),
  ]

  assert.equal(getCondition(games, 'three'), RULE_IDS.THREE_IN_FOUR)
})

test('Back-to-Back and Back-to-Back + Travel use production transition logic', () => {
  const homeStand = [
    makeGame({ date: '2023-10-01', id: 'home-1' }),
    makeGame({ away: 'TOR', date: '2023-10-02', id: 'home-2' }),
  ]
  const travel = [
    makeGame({ date: '2023-10-01', id: 'travel-1' }),
    makeGame({ away: 'BOS', date: '2023-10-02', home: 'TOR', id: 'travel-2' }),
  ]

  assert.equal(getCondition(homeStand, 'home-2'), RULE_IDS.BACK_TO_BACK)
  assert.equal(
    getCondition(travel, 'travel-2', 'awayCondition'),
    RULE_IDS.BACK_TO_BACK_TRAVEL,
  )
})

test('exclusive precedence selects B2B over overlapping 3-in-4', () => {
  const games = [
    makeGame({ date: '2023-10-01', id: 'p1' }),
    makeGame({ away: 'TOR', date: '2023-10-02', id: 'p2' }),
    makeGame({ away: 'MTL', date: '2023-10-03', id: 'p3' }),
  ]
  const facts = buildScheduleFacts(games).get('p3')

  assert.equal(facts.homeCondition, RULE_IDS.BACK_TO_BACK)
  assert.equal(
    facts.homeDetectedConditions.includes(RULE_IDS.THREE_IN_FOUR),
    true,
  )
})

test('schedule facts are chronological-only and handle UTC year boundaries', () => {
  const first = makeGame({ date: '2023-12-31', id: 'year-1' })
  const second = makeGame({ away: 'TOR', date: '2024-01-01', id: 'year-2' })
  const future = makeGame({ away: 'MTL', date: '2024-01-02', id: 'future' })
  const withoutFuture = buildScheduleFacts([first, second]).get('year-2')
  const withFuture = buildScheduleFacts([first, second, future]).get('year-2')

  assert.equal(withFuture.homeCondition, RULE_IDS.BACK_TO_BACK)
  assert.deepEqual(withFuture, withoutFuture)
})

test('run input always includes zero controls and does not create a grid search', () => {
  const input = normalizeRunPayload({
    customValues: { [RULE_IDS.WELL_RESTED]: 0.33 },
    seasonIds: ['20232024'],
  })

  assert.equal(input.candidatesByRule[RULE_IDS.WELL_RESTED].includes(0), true)
  assert.equal(input.candidatesByRule[RULE_IDS.WELL_RESTED].includes(0.33), true)
  assert.equal(input.candidatesByRule[RULE_IDS.BACK_TO_BACK].includes(0.33), false)
})

test('Rating Lab custom adjustment validation accepts -6 through +3 only', () => {
  ;[-3, -3.5, -5, -6, 3].forEach((adjustment) => {
    const input = normalizeRunPayload({
      customValues: { [RULE_IDS.BACK_TO_BACK_TRAVEL]: adjustment },
      seasonIds: ['20232024'],
    })

    assert.equal(
      input.candidatesByRule[RULE_IDS.BACK_TO_BACK_TRAVEL].includes(adjustment),
      true,
    )
  })

  ;[-6.01, 3.01].forEach((adjustment) => {
    assert.throws(
      () => normalizeRunPayload({
        customValues: { [RULE_IDS.BACK_TO_BACK_TRAVEL]: adjustment },
        seasonIds: ['20232024'],
      }),
      (error) =>
        error.statusCode === 400 &&
        error.message.includes('between -6 and 3'),
    )
  })
})

test('only Back-to-Back + Travel receives the extended standard sweep', () => {
  const presetsByRule = Object.fromEntries(
    RULES.map((rule) => [rule.id, [...rule.presetValues]]),
  )

  assert.deepEqual(presetsByRule[RULE_IDS.BACK_TO_BACK_TRAVEL], [
    0,
    -0.5,
    -1,
    -1.5,
    -2,
    -2.5,
    -3,
    -3.5,
    -4,
    -4.5,
    -5,
  ])
  assert.deepEqual(presetsByRule[RULE_IDS.THREE_IN_FOUR], [
    0,
    -0.25,
    -0.5,
    -0.75,
    -1,
  ])
  assert.deepEqual(presetsByRule[RULE_IDS.BACK_TO_BACK], [
    0,
    -0.25,
    -0.5,
    -0.75,
    -1,
    -1.25,
  ])
  assert.deepEqual(presetsByRule[RULE_IDS.WELL_RESTED], [
    0,
    0.1,
    0.25,
    0.5,
    0.75,
  ])
})

test('production Settings validation and default remain unchanged', () => {
  assert.equal(
    DEFAULT_SCHEDULE_ADJUSTMENT_SETTINGS.backToBackTravelAdjustment,
    -1.25,
  )
  assert.equal(
    normalizeSettingsPayload({ backToBackTravelAdjustment: -3 })
      .backToBackTravelAdjustment,
    -3,
  )

  ;[-3.5, -5, -6, 0.05].forEach((adjustment) => {
    assert.throws(
      () => normalizeSettingsPayload({
        backToBackTravelAdjustment: adjustment,
      }),
      (error) =>
        error.statusCode === 400 &&
        error.details.fieldErrors.backToBackTravelAdjustment.includes(
          'at least -3 and no more than 0',
        ),
    )
  })
})

seasonFixtures.forEach(({ canonical, display }) => {
  test(`${display} and ${canonical} use the canonical Rating Lab season identity`, () => {
    assert.deepEqual(
      normalizeRunPayload({ seasonIds: [display] }).seasonIds,
      [canonical],
    )
    assert.deepEqual(
      normalizeRunPayload({ seasonIds: [canonical] }).seasonIds,
      [canonical],
    )
  })
})

test('prepared season eligibility matches the Base Model filter for all Phase 3 seasons', () => {
  const teamsById = new Map(
    teams.flatMap((team) => [
      [team.teamId, team],
      [team.abbreviation, team],
    ]),
  )

  seasonFixtures.forEach(({ canonical, startDate }) => {
    const games = makePreparedSeasonFixture({ canonical, startDate })
    const end = new Date(`${startDate}T00:00:00.000Z`)
    end.setUTCDate(end.getUTCDate() + 29)
    const endDate = end.toISOString().slice(0, 10)
    const baseDataset = prepareDataset({
      games,
      input: {
        dateFrom: startDate,
        dateFromTimestamp: Date.parse(`${startDate}T00:00:00.000Z`),
        dateTo: endDate,
        dateToTimestamp: Date.parse(`${endDate}T00:00:00.000Z`),
        seasonId: canonical,
      },
      teamsById,
    })
    const phase3 = preparePhase3ReplayGames(games, canonical, teams)

    assert.equal(baseDataset.summary.gamesIncluded, EXPECTED_APPROXIMATE_GAMES)
    assert.equal(phase3.eligibility.loaded, EXPECTED_APPROXIMATE_GAMES)
    assert.equal(
      phase3.eligibility.eligible,
      baseDataset.summary.gamesIncluded,
    )
    assert.equal(phase3.games.length, baseDataset.summary.gamesIncluded)
  })
})

test('stored games need no precomputed context fields and derive schedule facts during replay', () => {
  const storedGames = [
    makeGame({ date: '2023-10-10', id: 'stored-1' }),
    makeGame({ away: 'TOR', date: '2023-10-11', id: 'stored-2' }),
  ].map(toPreparedReplayShape)
  const prepared = preparePhase3ReplayGames(storedGames, '2023-24', teams)
  const facts = buildScheduleFacts(prepared.games).get('stored-2')

  assert.equal(storedGames[0].seasonId, undefined)
  assert.equal(storedGames[0].resultType, undefined)
  assert.equal(storedGames[0].restDays, undefined)
  assert.equal(prepared.eligibility.eligible, 2)
  assert.equal(prepared.games.length, 2)
  assert.equal(facts.homeCondition, RULE_IDS.BACK_TO_BACK)
})

test('options separate primary and optional rules and report the persisted Quick Rematch reference', async () => {
  let requestedUserId = null
  const options = await getScheduleCalibrationOptions('user-a', {
    historicalStatusProvider: async (seasons) =>
      seasons.map((season) => ({ seasonId: season.id, status: 'ready' })),
    quickRematchSettingsProvider: async (userId) => {
      requestedUserId = userId
      return {
        settings: {
          quickRematchEnabled: false,
          quickRematchLoserAdjustment: 0.4,
          quickRematchMaximumDays: 7,
        },
        usingDefaults: false,
      }
    },
  })

  assert.equal(requestedUserId, 'user-a')
  assert.deepEqual(
    options.primaryRules.map((rule) => rule.id),
    [
      RULE_IDS.THREE_IN_FOUR,
      RULE_IDS.BACK_TO_BACK,
      RULE_IDS.BACK_TO_BACK_TRAVEL,
    ],
  )
  assert.deepEqual(
    options.optionalRules.map((rule) => rule.id),
    [RULE_IDS.WELL_RESTED],
  )
  assert.deepEqual(options.quickRematch.productionReference, {
    enabled: false,
    loserAdjustment: 0.4,
    maximumDays: 7,
    usingDefaults: false,
  })
  assert.equal(options.minCustomAdjustment, -6)
  assert.equal(options.maxCustomAdjustment, 3)
  assert.equal(options.maxAbsoluteCustomAdjustment, 3)
})

test('candidate replay changes probability only for the detected exclusive rule', () => {
  const rawGames = [
    makeGame({ date: '2023-10-10', id: 'r1' }),
    makeGame({ away: 'TOR', date: '2023-10-13', id: 'r2' }),
  ]
  const games = buildReplayGames(rawGames, '20232024', teams)
  const factsByGameId = buildScheduleFacts(games)
  const baseline = replaySeason({ configuration: {}, factsByGameId, games, teams })
  const adjusted = replaySeason({
    configuration: { [RULE_IDS.WELL_RESTED]: 0.75 },
    factsByGameId,
    games,
    teams,
  })

  assert.equal(
    baseline.predictions[0].homeProbability,
    adjusted.predictions[0].homeProbability,
  )
  assert.notEqual(
    baseline.predictions[1].homeProbability,
    adjusted.predictions[1].homeProbability,
  )
  assert.equal(adjusted.predictions[1].homeAdjustment, 0.75)
  assert.equal(adjusted.predictions[1].awayAdjustment, 0)
  assert.equal(adjusted.ratingState.get('BOS').gamesProcessed, 2)
})

test('prepared-season calibration aggregates samples and stays production-isolated', async () => {
  const games = [
    makeGame({ date: '2023-10-10', id: 'c1' }),
    makeGame({ away: 'TOR', date: '2023-10-11', id: 'c2' }),
    makeGame({ away: 'MTL', date: '2023-10-13', id: 'c3' }),
    makeGame({ away: 'NYR', date: '2023-10-16', home: 'TOR', id: 'c4' }),
  ]
  let loadCalls = 0
  let productionWriteAttempts = 0
  const guardedModels = [
    GameContext,
    PowerRating,
    ProcessedRatingGame,
    QuickRematchSettings,
    RatingEngineSettings,
  ]
  const writeMethods = [
    'bulkWrite',
    'create',
    'deleteMany',
    'deleteOne',
    'findOneAndUpdate',
    'insertMany',
    'updateMany',
    'updateOne',
  ]
  const writeGuards = guardedModels.flatMap((model) =>
    writeMethods.map((method) => [
      model,
      method,
      async () => {
        productionWriteAttempts += 1
        throw new Error(`${model.modelName}.${method} must not be called`)
      },
    ]),
  )
  const result = await withPatches(writeGuards, () =>
    runScheduleCalibration(
      'user-a',
      {
        combinedConfiguration: {
          [RULE_IDS.BACK_TO_BACK]: -0.25,
          [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4,
          [RULE_IDS.THREE_IN_FOUR]: -0.5,
          [RULE_IDS.WELL_RESTED]: 0.75,
        },
        customValues: {
          [RULE_IDS.BACK_TO_BACK_TRAVEL]: -6,
        },
        includeWellRested: false,
        seasonIds: ['20232024'],
      },
      {
        historicalLoadProvider: async () => {
          loadCalls += 1
          return {
            gamesBySeason: new Map([
              ['20232024', games.map(toPreparedReplayShape)],
            ]),
          }
        },
        historicalStatusProvider: async () => [
          { seasonId: '20232024', status: 'ready' },
          { seasonId: '20242025', status: 'ready' },
          { seasonId: '20252026', status: 'ready' },
        ],
        teamsProvider: async () => teams,
      },
    ),
  )

  const zeroResults = Object.values(result.individualResults).map(
    (rule) => rule.comparisons.find((comparison) => comparison.adjustment === 0),
  )
  assert.equal(loadCalls, 1)
  assert.equal(productionWriteAttempts, 0)
  assert.equal(
    zeroResults.every(
      (comparison) =>
        comparison.metrics.brierScore === zeroResults[0].metrics.brierScore,
    ),
    true,
  )
  assert.equal(result.diagnostics.productionWrites, false)
  assert.equal(result.diagnostics.providerCallsDuringReplay, false)
  assert.equal(result.diagnostics.quickRematchIncluded, true)
  assert.deepEqual(result.diagnostics.historicalEligibility['20232024'], {
    completed: 4,
    eligible: 4,
    loaded: 4,
    regularSeason: 4,
    seasonId: '20232024',
    seasonMatched: 4,
    skipReasons: {},
    skipped: 0,
    validResult: 4,
    validTeamIdentity: 4,
  })
  assert.equal(result.diagnostics.individualWinnersAutoApplied, false)
  assert.equal(result.diagnostics.wellRestedIncludedInCombined, false)
  assert.equal(result.selectedCombinedConfiguration[RULE_IDS.WELL_RESTED], 0)
  assert.equal(
    result.selectedCombinedConfiguration[RULE_IDS.BACK_TO_BACK_TRAVEL],
    -4,
  )
  assert.deepEqual(result.combinedResult.configurationSnapshot, {
    adjustments: {
      [RULE_IDS.BACK_TO_BACK]: -0.25,
      [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4,
      [RULE_IDS.THREE_IN_FOUR]: -0.5,
      [RULE_IDS.WELL_RESTED]: 0,
    },
    includeWellRested: false,
  })
  assert.equal(result.combinedResult.appliedCounts[RULE_IDS.WELL_RESTED], 0)
  assert.equal(result.combinedResult.matchedCounts[RULE_IDS.WELL_RESTED], 2)
  assert.deepEqual(result.diagnostics.effectivePrecedence, [
    RULE_IDS.BACK_TO_BACK_TRAVEL,
    RULE_IDS.BACK_TO_BACK,
    RULE_IDS.THREE_IN_FOUR,
  ])
  assert.deepEqual(
    result.individualResults[RULE_IDS.BACK_TO_BACK_TRAVEL].comparisons
      .map((comparison) => comparison.adjustment)
      .sort((left, right) => right - left),
    [0, -0.5, -1, -1.5, -2, -2.5, -3, -3.5, -4, -4.5, -5, -6],
  )
  assert.equal(result.quickRematchResult.standardCombinationCount, 20)
  assert.equal(result.quickRematchResult.comparisons.length, 16)
  assert.equal(
    result.quickRematchResult.comparisons.every(
      (comparison) => comparison.occurrences === 0,
    ),
    true,
  )
  assert.equal(
    Object.values(result.combinedResult.priorityCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    games.length * 2,
  )
  assert.equal(result.combinedResult.teamGameCount, games.length * 2)
  assert.equal(result.combinedResult.noAdjustments.gamesAffected, 0)
  assert.equal(
    result.combinedResult.priorityCounts[RULE_IDS.BACK_TO_BACK],
    1,
  )
  assert.equal(
    result.combinedResult.priorityCounts[RULE_IDS.THREE_IN_FOUR],
    1,
  )
  assert.equal(
    result.individualResults[RULE_IDS.BACK_TO_BACK].comparisons[0]
      .occurrences,
    1,
  )
  assert.equal(
    result.individualResults[RULE_IDS.BACK_TO_BACK].comparisons[0]
      .seasonResults.length,
    1,
  )
})

test('zero eligible games return structured historical eligibility diagnostics', async () => {
  const unresolved = toPreparedReplayShape(
    makeGame({ date: '2023-10-10', id: 'unresolved' }),
  )
  delete unresolved.gameOutcome

  await assert.rejects(
    runScheduleCalibration(
      'user-a',
      { seasonIds: ['2023-24'] },
      {
        historicalLoadProvider: async () => ({
          gamesBySeason: new Map([['20232024', [unresolved]]]),
        }),
        historicalStatusProvider: async () => [
          { seasonId: '20232024', status: 'ready' },
          { seasonId: '20242025', status: 'ready' },
          { seasonId: '20252026', status: 'ready' },
        ],
        teamsProvider: async () => teams,
      },
    ),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.deepEqual(error.details.historicalEligibility, {
        completed: 1,
        eligible: 0,
        loaded: 1,
        regularSeason: 1,
        seasonId: '20232024',
        seasonMatched: 1,
        skipReasons: { UNRESOLVED_RESULT_TYPE: 1 },
        skipped: 1,
        validResult: 0,
        validTeamIdentity: 1,
      })
      return true
    },
  )
})

test('Phase 3 reads the shared prepared repository without NHL calls or historical writes', async () => {
  const storedGame = toStoredHistoricalDocument(
    makeGame({ date: '2023-10-10', id: 'repository-game' }),
  )
  let datasetReads = 0
  let gameReads = 0
  let writes = 0
  const historicalRepository = {
    getDatasets: async (seasonIds) => {
      datasetReads += 1
      return seasonIds.map((seasonId) => ({ seasonId, status: 'ready' }))
    },
    getGamesBySeasons: async () => {
      gameReads += 1
      return [storedGame]
    },
    upsertDataset: async () => {
      writes += 1
      throw new Error('Historical writes are not allowed during Phase 3.')
    },
    upsertGames: async () => {
      writes += 1
      throw new Error('Historical writes are not allowed during Phase 3.')
    },
  }

  const result = await runScheduleCalibration(
    'user-a',
    { seasonIds: ['20232024'] },
    {
      historicalRepository,
      teamsProvider: async () => teams,
    },
  )

  assert.equal(datasetReads, 2)
  assert.equal(gameReads, 1)
  assert.equal(writes, 0)
  assert.equal(result.diagnostics.providerCallsDuringReplay, false)
  assert.equal(result.diagnostics.productionWrites, false)
  assert.equal(result.diagnostics.historicalEligibility['20232024'].eligible, 1)
  assert.equal(result.quickRematchResult.comparisons[0].occurrences, 0)
})

test('Quick Rematch uses the most recent prior meeting and the correct loser', () => {
  const games = [
    makeGame({ away: 'NYR', awayScore: 3, date: '2023-10-01', home: 'BOS', homeScore: 1, id: 'meeting-1' }),
    makeGame({ away: 'NYR', awayScore: 2, date: '2023-10-04', home: 'BOS', homeScore: 4, id: 'meeting-2' }),
  ]
  const facts = buildScheduleFacts(games, [3]).get('meeting-2')

  assert.equal(facts.quickRematchByWindow[3].homeEligible, true)
  assert.equal(facts.quickRematchByWindow[3].awayEligible, false)
  assert.equal(facts.quickRematchByWindow[3].homePreviousLoser, 'BOS')
  assert.equal(facts.quickRematchByWindow[3].homePreviousGameId, 'meeting-1')
})

test('Quick Rematch includes exact tested boundaries and excludes games outside them', () => {
  QUICK_REMATCH_WINDOWS.forEach((windowDays) => {
    const start = makeGame({ awayScore: 3, date: '2023-10-01', homeScore: 1, id: `start-${windowDays}` })
    const boundaryDate = new Date(Date.UTC(2023, 9, 1 + windowDays, 23))
      .toISOString()
      .slice(0, 10)
    const boundary = makeGame({ date: boundaryDate, id: `boundary-${windowDays}` })
    const facts = buildScheduleFacts([start, boundary], [windowDays])
      .get(`boundary-${windowDays}`)

    assert.equal(facts.quickRematchByWindow[windowDays].homeEligible, true)
  })

  const outside = [
    makeGame({ awayScore: 3, date: '2023-10-01', homeScore: 1, id: 'outside-start' }),
    makeGame({ date: '2023-10-05', id: 'outside-target' }),
  ]
  assert.equal(
    buildScheduleFacts(outside, [3]).get('outside-target')
      .quickRematchByWindow[3].homeEligible,
    false,
  )
})

test('Quick Rematch ignores future games, target results, and absent meetings', () => {
  const previous = makeGame({ awayScore: 3, date: '2023-11-28', homeScore: 1, id: 'prior' })
  const target = makeGame({ awayScore: 1, date: '2023-12-02', homeScore: 5, id: 'target' })
  const changedTarget = { ...target, awayScore: 9, homeScore: 0, awayTeam: { ...target.awayTeam, score: 9 }, homeTeam: { ...target.homeTeam, score: 0 } }
  const future = makeGame({ date: '2023-12-03', id: 'future' })
  const baseline = buildScheduleFacts([previous, target], [5]).get('target')
  const changed = buildScheduleFacts([previous, changedTarget, future], [5]).get('target')
  const noMeeting = makeGame({ away: 'TOR', date: '2023-12-02', id: 'no-meeting' })

  assert.deepEqual(changed.quickRematchByWindow, baseline.quickRematchByWindow)
  assert.equal(
    buildScheduleFacts([previous, noMeeting], [5]).get('no-meeting')
      .quickRematchByWindow[5].homeEligible,
    false,
  )
})

test('Quick Rematch selects the most recent prior meeting across month and year boundaries', () => {
  const games = [
    makeGame({ awayScore: 3, date: '2023-12-20', homeScore: 1, id: 'older' }),
    makeGame({ awayScore: 4, date: '2023-12-31', homeScore: 2, id: 'latest' }),
    makeGame({ date: '2024-01-03', id: 'new-year-target', seasonId: '20232024' }),
  ]
  const facts = buildScheduleFacts(games, [3]).get('new-year-target')

  assert.equal(facts.quickRematchByWindow[3].homeEligible, true)
  assert.equal(facts.quickRematchByWindow[3].homePreviousGameId, 'latest')
})

test('Quick Rematch adjustment applies once only to the previous loser and zero reproduces control', () => {
  const rawGames = [
    makeGame({ awayScore: 3, date: '2023-10-10', homeScore: 1, id: 'q1' }),
    makeGame({ date: '2023-10-13', id: 'q2' }),
  ]
  const games = buildReplayGames(rawGames, '20232024', teams)
  const factsByGameId = buildScheduleFacts(games, [3])
  const disabled = replaySeason({ configuration: { quickRematch: { enabled: false }, restFatigue: {} }, factsByGameId, games, teams })
  const zero = replaySeason({ configuration: { quickRematch: { enabled: true, loserAdjustment: 0, maximumDays: 3 }, restFatigue: {} }, factsByGameId, games, teams })
  const adjusted = replaySeason({ configuration: { quickRematch: { enabled: true, loserAdjustment: 0.25, maximumDays: 3 }, restFatigue: {} }, factsByGameId, games, teams })

  assert.deepEqual(
    zero.predictions.map((prediction) => prediction.homeProbability),
    disabled.predictions.map((prediction) => prediction.homeProbability),
  )
  assert.equal(adjusted.predictions[1].homeQuickRematchAdjustment, 0.25)
  assert.equal(adjusted.predictions[1].awayQuickRematchAdjustment, 0)
  assert.equal(adjusted.quickRematchOccurrences, 1)
  assert.equal(adjusted.quickRematchGamesAffected, 1)
})

test('Quick Rematch grid has 20 standard combinations, one zero row, custom values and deterministic ranking', () => {
  const rawGames = [
    makeGame({ awayScore: 3, date: '2023-10-10', homeScore: 1, id: 'g1' }),
    makeGame({ date: '2023-10-13', id: 'g2' }),
  ]
  const games = buildReplayGames(rawGames, '20232024', teams)
  const replayContexts = [{ factsByGameId: buildScheduleFacts(games), games, seasonId: '20232024', teams }]
  const first = compareQuickRematchGrid({ adjustments: QUICK_REMATCH_ADJUSTMENTS, replayContexts, windows: QUICK_REMATCH_WINDOWS })
  const second = compareQuickRematchGrid({ adjustments: QUICK_REMATCH_ADJUSTMENTS, replayContexts, windows: QUICK_REMATCH_WINDOWS })
  const custom = normalizeRunPayload({ quickRematchGrid: { customAdjustment: 0.33, customWindow: 21 }, seasonIds: ['20232024'] })
  const combinedOnlyWindow = normalizeRunPayload({
    combinedScheduleContext: {
      quickRematch: { enabled: true, loserAdjustment: 0.25, maximumDays: 21 },
    },
    seasonIds: ['20232024'],
  })

  assert.equal(first.standardCombinationCount, 20)
  assert.equal(first.testedCombinationCount, 20)
  assert.equal(first.comparisons.length, 16)
  assert.equal(first.comparisons.filter((comparison) => comparison.adjustment === 0).length, 1)
  assert.equal(first.comparisons[0].occurrences, 0)
  assert.equal(first.comparisons[0].occurrenceRate, 0)
  assert.equal(
    first.comparisons.find((comparison) => comparison.windowDays === 3).occurrenceRate,
    0.25,
  )
  assert.deepEqual(
    first.comparisons.map((comparison) => comparison.rank),
    second.comparisons.map((comparison) => comparison.rank),
  )
  assert.equal(custom.quickRematchWindows.includes(21), true)
  assert.equal(custom.quickRematchAdjustments.includes(0.33), true)
  assert.deepEqual(combinedOnlyWindow.quickRematchWindows, QUICK_REMATCH_WINDOWS)
  assert.equal(combinedOnlyWindow.scheduleFactQuickRematchWindows.includes(21), true)
})

test('combined context keeps fatigue exclusive, Quick Rematch additive, and Well Rested opt-in only', () => {
  const rawGames = [
    makeGame({ awayScore: 3, date: '2023-10-10', homeScore: 1, id: 'a1' }),
    makeGame({ date: '2023-10-11', id: 'a2' }),
  ]
  const games = buildReplayGames(rawGames, '20232024', teams)
  const factsByGameId = buildScheduleFacts(games, [3])
  const replay = replaySeason({
    configuration: {
      quickRematch: { enabled: true, loserAdjustment: 0.25, maximumDays: 3 },
      restFatigue: {
        adjustments: {
          [RULE_IDS.BACK_TO_BACK]: -0.75,
          [RULE_IDS.THREE_IN_FOUR]: -1,
        },
        includeWellRested: false,
      },
    },
    factsByGameId,
    games,
    teams,
  })
  const defaultInput = normalizeRunPayload({ seasonIds: ['20232024'] })
  const enabledInput = normalizeRunPayload({ includeWellRested: true, seasonIds: ['20232024'] })

  assert.equal(replay.predictions[1].homeCondition, RULE_IDS.BACK_TO_BACK)
  assert.equal(replay.predictions[1].homeAppliedCondition, RULE_IDS.BACK_TO_BACK)
  assert.equal(replay.predictions[1].homeRestFatigueAdjustment, -0.75)
  assert.equal(replay.predictions[1].homeQuickRematchAdjustment, 0.25)
  assert.equal(replay.predictions[1].homeAdjustment, -0.5)
  assert.equal(defaultInput.combinedConfiguration[RULE_IDS.WELL_RESTED], 0)
  assert.equal(enabledInput.combinedConfiguration[RULE_IDS.WELL_RESTED], 0.25)
  assert.equal(defaultInput.combinedRestFatigueConfiguration.includeWellRested, false)
  assert.equal(
    defaultInput.combinedRestFatigueConfiguration.adjustments[
      RULE_IDS.WELL_RESTED
    ],
    0,
  )
  assert.equal(enabledInput.combinedRestFatigueConfiguration.includeWellRested, true)
})

test('disabled Well Rested remains detected but never applied or defaulted', () => {
  const rawGames = [
    makeGame({ date: '2023-10-10', id: 'rest-1' }),
    makeGame({ away: 'MTL', date: '2023-10-12', home: 'TOR', id: 'rest-2' }),
    makeGame({ away: 'TOR', date: '2023-10-13', id: 'rest-target' }),
  ]
  const games = buildReplayGames(rawGames, '20232024', teams)
  const factsByGameId = buildScheduleFacts(games)
  const disabled = replaySeason({
    configuration: {
      restFatigue: {
        adjustments: {
          [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4,
          [RULE_IDS.WELL_RESTED]: 0.25,
        },
        includeWellRested: false,
      },
    },
    factsByGameId,
    games,
    teams,
  })
  const omitted = replaySeason({
    configuration: {
      restFatigue: {
        adjustments: { [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4 },
        includeWellRested: false,
      },
    },
    factsByGameId,
    games,
    teams,
  })
  const legacyZeroOnly = replaySeason({
    configuration: {
      restFatigue: {
        [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4,
        [RULE_IDS.WELL_RESTED]: 0,
      },
    },
    factsByGameId,
    games,
    teams,
  })
  const enabled = replaySeason({
    configuration: {
      restFatigue: {
        adjustments: {
          [RULE_IDS.BACK_TO_BACK_TRAVEL]: -4,
          [RULE_IDS.WELL_RESTED]: 0.5,
        },
        includeWellRested: true,
      },
    },
    factsByGameId,
    games,
    teams,
  })
  const disabledTarget = disabled.predictions[2]
  const enabledTarget = enabled.predictions[2]

  assert.equal(disabledTarget.homeCondition, RULE_IDS.WELL_RESTED)
  assert.equal(disabledTarget.homeAppliedCondition, 'normal')
  assert.equal(disabledTarget.homeRestFatigueAdjustment, 0)
  assert.equal(
    disabledTarget.awayAppliedCondition,
    RULE_IDS.BACK_TO_BACK_TRAVEL,
  )
  assert.equal(disabledTarget.awayRestFatigueAdjustment, -4)
  assert.deepEqual(
    disabled.predictions.map((prediction) => prediction.homeProbability),
    omitted.predictions.map((prediction) => prediction.homeProbability),
  )
  assert.deepEqual(disabled.metrics, omitted.metrics)
  assert.deepEqual(disabled.metrics, legacyZeroOnly.metrics)
  assert.equal(
    legacyZeroOnly.appliedCounts[RULE_IDS.WELL_RESTED],
    0,
  )
  assert.equal(disabled.matchedCounts[RULE_IDS.WELL_RESTED], 1)
  assert.equal(disabled.appliedCounts[RULE_IDS.WELL_RESTED], 0)
  assert.equal(
    Object.values(disabled.appliedCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    games.length * 2,
  )
  assert.equal(enabledTarget.homeAppliedCondition, RULE_IDS.WELL_RESTED)
  assert.equal(enabledTarget.homeRestFatigueAdjustment, 0.5)
  assert.equal(enabledTarget.awayRestFatigueAdjustment, -4)
  assert.equal(enabled.appliedCounts[RULE_IDS.WELL_RESTED], 1)
  assert.notEqual(enabledTarget.homeProbability, disabledTarget.homeProbability)
})
