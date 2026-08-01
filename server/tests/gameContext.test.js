process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.GOOGLE_CLIENT_ID = 'google-client-id'

const assert = require('node:assert/strict')
const test = require('node:test')
const GameContext = require('../models/GameContext')
const {
  DEFAULT_QUICK_REMATCH_SETTINGS,
  getQuickRematchSettings,
  normalizeSettingsPayload,
  resetQuickRematchSettings,
  updateQuickRematchSettings,
} = require('../services/quickRematchSettingsService')
const {
  WINDOW_BOUNDARY_MODE,
  calculateGameContextForGame,
  createScheduleWindowDiagnostics,
  deriveSeasonIdFromDate,
} = require('../services/gameContextRules')
const {
  buildGameContextMutableUpdate,
  buildContextsForGames,
  getGameContexts,
  updateGameContextOverrides,
} = require('../services/gameContextService')

const queryOf = (value) => ({
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject)
  },
})

const clone = (value) => JSON.parse(JSON.stringify(value))

const scheduleGame = ({
  away,
  awayScore = null,
  gameId,
  gameState = 'FINAL',
  home,
  homeScore = null,
  startTimeUTC,
  venueCity = '',
}) => ({
  awayTeam: {
    abbrev: away,
    score: awayScore,
  },
  gameState,
  homeTeam: {
    abbrev: home,
    score: homeScore,
  },
  id: gameId,
  startTimeUTC,
  venueCity,
})

const createSettingsStore = () => {
  const settingsByUser = new Map()

  return {
    model: {
      deleteOne: async (filter) => {
        settingsByUser.delete(String(filter.userId))

        return { deletedCount: 1 }
      },
      findOne: (filter) =>
        queryOf(settingsByUser.get(String(filter.userId)) ?? null),
      findOneAndUpdate: (filter, update) => {
        const userKey = String(filter.userId)
        const document = {
          ...(settingsByUser.get(userKey) ?? {}),
          ...(update.$setOnInsert ?? {}),
          ...(update.$set ?? {}),
          userId: filter.userId,
        }

        settingsByUser.set(userKey, document)

        return queryOf(document)
      },
    },
    settingsByUser,
  }
}

const setPath = (target, path, value) => {
  const parts = path.split('.')
  let current = target

  parts.slice(0, -1).forEach((part) => {
    current[part] = current[part] ?? {}
    current = current[part]
  })

  current[parts.at(-1)] = value
}

const getUpdateOperatorPaths = (update = {}) =>
  Object.entries(update)
    .filter(([operator, payload]) => operator.startsWith('$') && payload)
    .flatMap(([operator, payload]) =>
      Object.keys(payload).map((path) => ({ operator, path })),
    )

const pathsConflict = (leftPath, rightPath) =>
  leftPath === rightPath ||
  leftPath.startsWith(`${rightPath}.`) ||
  rightPath.startsWith(`${leftPath}.`)

const assertNoMongoUpdatePathConflicts = (update) => {
  const paths = getUpdateOperatorPaths(update)

  paths.forEach((left, leftIndex) => {
    paths.slice(leftIndex + 1).forEach((right) => {
      if (left.operator !== right.operator && pathsConflict(left.path, right.path)) {
        throw new Error(
          `Updating the path '${left.path}' would create a conflict at '${right.path}'`,
        )
      }
    })
  })
}

const createContextStore = () => {
  const contexts = new Map()
  const operations = []
  const getKey = (userId, gameId) => `${userId}:${gameId}`

  return {
    contexts,
    model: {
      find: (filter) =>
        queryOf(
          [...contexts.values()].filter(
            (context) =>
              String(context.userId) === String(filter.userId) &&
              filter.gameId.$in.includes(context.gameId),
          ),
        ),
      findOneAndUpdate: (filter, update) => {
        assertNoMongoUpdatePathConflicts(update)
        operations.push({
          filter: clone(filter),
          update: clone(update),
        })

        const key = getKey(filter.userId, filter.gameId)
        const existingContext = contexts.get(key)
        const document = {
          ...(existingContext ?? {}),
          ...(existingContext ? {} : (update.$setOnInsert ?? {})),
          userId: filter.userId,
          gameId: filter.gameId,
        }

        Object.entries(update.$set ?? {}).forEach(([field, value]) => {
          setPath(document, field, value)
        })

        contexts.set(key, document)

        return queryOf(document)
      },
    },
    operations,
  }
}

const currentGame = Object.freeze({
  gameId: '2026020001',
  gameState: 'FUT',
  homeTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
    score: null,
  },
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    score: null,
  },
  startTimeUTC: '2026-01-05T00:00:00Z',
  status: 'Scheduled',
})

const torSchedule = Object.freeze([
  {
    id: '2026020000',
    awayTeam: {
      abbrev: 'OTT',
      score: 1,
    },
    homeTeam: {
      abbrev: 'TOR',
      score: 3,
    },
    startTimeUTC: '2026-01-04T00:00:00Z',
  },
  {
    id: '2026019999',
    awayTeam: {
      abbrev: 'BOS',
      score: 4,
    },
    homeTeam: {
      abbrev: 'TOR',
      score: 2,
    },
    startTimeUTC: '2026-01-01T00:00:00Z',
  },
])

const bosSchedule = Object.freeze([
  {
    id: '2026019999',
    awayTeam: {
      abbrev: 'BOS',
      score: 4,
    },
    homeTeam: {
      abbrev: 'TOR',
      score: 2,
    },
    startTimeUTC: '2026-01-01T00:00:00Z',
  },
])

const historicalGame = Object.freeze({
  gameId: '2025020002',
  gameState: 'FINAL',
  homeTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
    score: 3,
  },
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    score: 1,
  },
  startTimeUTC: '2025-12-01T00:00:00Z',
  status: 'Final',
})

const getTeamContext = (context, teamAbbreviation) =>
  context.awayTeam.abbreviation === teamAbbreviation
    ? context.awayContext
    : context.homeContext

test('game context rules add rest modifiers and quick rematch to the previous loser only', () => {
  const context = calculateGameContextForGame({
    awayScheduleGames: torSchedule,
    currentGame,
    homeScheduleGames: bosSchedule,
    now: new Date('2026-01-04T12:00:00Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 4,
    },
  })

  assert.equal(context.awayContext.restFatigueCondition, 'back_to_back_travel')
  assert.deepEqual(context.awayContext.conditions, [
    'back_to_back_travel',
  ])
  assert.deepEqual(context.awayContext.adjustmentBreakdown, [
    {
      adjustment: -1.25,
      category: 'restFatigue',
      condition: 'back_to_back_travel',
    },
    {
      adjustment: 0.25,
      category: 'quickRematch',
      condition: 'quick_rematch',
    },
  ])
  assert.equal(context.awayContext.automaticRestFatigueAdjustment, -1.25)
  assert.equal(context.awayContext.effectiveRestFatigueAdjustment, -1.25)
  assert.equal(context.awayContext.quickRematch.eligible, true)
  assert.equal(context.awayContext.effectiveQuickRematchAdjustment, 0.25)
  assert.equal(context.awayContext.totalGameContextAdjustment, -1)
  assert.equal(context.awayContext.travelBetweenGames, true)
  assert.equal(
    context.awayContext.travelClassificationSource,
    'schedule_structure',
  )
  assert.equal(context.homeContext.quickRematch.eligible, false)
  assert.equal(context.homeContext.effectiveQuickRematchAdjustment, 0)
  assert.equal(context.homeContext.effectiveRestFatigueAdjustment, 0)
})

test('manual overrides win when enabled while disabled manual values persist', () => {
  const context = calculateGameContextForGame({
    awayScheduleGames: torSchedule,
    currentGame,
    existingContext: {
      awayContext: {
        manualQuickRematchAdjustment: -0.5,
        manualRestFatigueAdjustment: 0.5,
        quickRematchOverrideEnabled: false,
        restFatigueOverrideEnabled: true,
      },
    },
    homeScheduleGames: bosSchedule,
    now: new Date('2026-01-04T12:00:00Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 4,
    },
  })

  assert.equal(context.awayContext.manualQuickRematchAdjustment, -0.5)
  assert.equal(context.awayContext.effectiveQuickRematchAdjustment, 0.25)
  assert.equal(context.awayContext.effectiveRestFatigueAdjustment, 0.5)
  assert.equal(context.awayContext.totalGameContextAdjustment, 0.75)
})

test('manual quick rematch override replaces only Quick Rematch', () => {
  const context = calculateGameContextForGame({
    awayScheduleGames: torSchedule,
    currentGame,
    existingContext: {
      awayContext: {
        manualQuickRematchAdjustment: -0.5,
        manualRestFatigueAdjustment: 0.5,
        quickRematchOverrideEnabled: true,
        restFatigueOverrideEnabled: false,
      },
    },
    homeScheduleGames: bosSchedule,
    now: new Date('2026-01-04T12:00:00Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 4,
    },
  })

  assert.equal(context.awayContext.automaticRestFatigueAdjustment, -1.25)
  assert.equal(context.awayContext.effectiveRestFatigueAdjustment, -1.25)
  assert.equal(context.awayContext.automaticQuickRematchAdjustment, 0.25)
  assert.equal(context.awayContext.effectiveQuickRematchAdjustment, -0.5)
  assert.equal(context.awayContext.totalGameContextAdjustment, -1.75)
})

test('schedule windows count the target team once and ignore future games', () => {
  const current = {
    gameId: 'current-det-pit',
    homeTeam: {
      abbreviation: 'PIT',
    },
    awayTeam: {
      abbreviation: 'DET',
    },
    scheduledStart: new Date('2026-01-02T00:00:00.000Z'),
  }
  const diagnostics = createScheduleWindowDiagnostics({
    currentGame: current,
    scheduleGames: [
      scheduleGame({
        away: 'DET',
        gameId: 'inside-window',
        home: 'WPG',
        startTimeUTC: '2025-12-31T00:00:00.000Z',
      }),
      scheduleGame({
        away: 'TOR',
        gameId: 'opponent-only',
        home: 'BOS',
        startTimeUTC: '2025-12-31T00:00:00.000Z',
      }),
      scheduleGame({
        away: 'DET',
        gameId: 'future-det-game',
        home: 'OTT',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      }),
      scheduleGame({
        away: 'DET',
        gameId: current.gameId,
        home: 'PIT',
        startTimeUTC: '2026-01-02T00:00:00.000Z',
      }),
    ],
    teamAbbreviation: 'DET',
    windowDays: 4,
  })

  assert.equal(diagnostics.boundaryMode, WINDOW_BOUNDARY_MODE)
  assert.deepEqual(
    diagnostics.countedGames.map((game) => game.gameId),
    ['inside-window', 'current-det-pit'],
  )
  assert.equal(diagnostics.count, 2)
})

test('schedule windows exclude the exact lower boundary and include weekends by elapsed UTC time', () => {
  const current = {
    gameId: 'monday-current',
    homeTeam: {
      abbreviation: 'BOS',
    },
    awayTeam: {
      abbreviation: 'TOR',
    },
    scheduledStart: new Date('2026-01-05T00:00:00.000Z'),
  }
  const diagnostics = createScheduleWindowDiagnostics({
    currentGame: current,
    scheduleGames: [
      scheduleGame({
        away: 'TOR',
        gameId: 'exact-boundary',
        home: 'OTT',
        startTimeUTC: '2026-01-01T00:00:00.000Z',
      }),
      scheduleGame({
        away: 'TOR',
        gameId: 'friday-inside',
        home: 'MTL',
        startTimeUTC: '2026-01-02T00:00:01.000Z',
      }),
      scheduleGame({
        away: 'TOR',
        gameId: 'saturday-inside',
        home: 'NYR',
        startTimeUTC: '2026-01-03T23:00:00.000Z',
      }),
      scheduleGame({
        away: 'CAR',
        gameId: 'sunday-inside',
        home: 'TOR',
        startTimeUTC: '2026-01-04T23:00:00.000Z',
      }),
    ],
    teamAbbreviation: 'TOR',
    windowDays: 4,
  })

  assert.deepEqual(
    diagnostics.countedGames.map((game) => game.gameId),
    [
      'friday-inside',
      'saturday-inside',
      'sunday-inside',
      'monday-current',
    ],
  )
  assert.equal(diagnostics.windowStart, '2026-01-01T00:00:00.000Z')
  assert.equal(diagnostics.windowEnd, '2026-01-05T00:00:00.000Z')
})

test('Detroit and Pittsburgh Jan 1 fixture classifies 3-in-4 separately by team', () => {
  const detPitGame = scheduleGame({
    away: 'DET',
    awayScore: 3,
    gameId: '2025020635',
    gameState: 'FINAL',
    home: 'PIT',
    homeScore: 4,
    startTimeUTC: '2026-01-02T00:00:00.000Z',
  })
  const fixtureSchedule = [
    scheduleGame({
      away: 'TOR',
      awayScore: 2,
      gameId: '2025020601',
      home: 'DET',
      homeScore: 3,
      startTimeUTC: '2025-12-29T00:00:00.000Z',
    }),
    scheduleGame({
      away: 'PIT',
      awayScore: 7,
      gameId: '2025020604',
      home: 'CHI',
      homeScore: 3,
      startTimeUTC: '2025-12-29T01:00:00.000Z',
    }),
    scheduleGame({
      away: 'CAR',
      awayScore: 1,
      gameId: '2025020619',
      home: 'PIT',
      homeScore: 5,
      startTimeUTC: '2025-12-31T00:00:00.000Z',
    }),
    scheduleGame({
      away: 'WPG',
      awayScore: 1,
      gameId: '2025020626',
      home: 'DET',
      homeScore: 2,
      startTimeUTC: '2025-12-31T23:30:00.000Z',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: fixtureSchedule,
    currentGame: detPitGame,
    homeScheduleGames: fixtureSchedule,
    now: new Date('2026-01-01T18:00:00.000Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 4,
    },
  })

  assert.deepEqual(
    context.awayContext.scheduleWindowDiagnostics.fourDayWindow.countedGames.map(
      (game) => game.gameId,
    ),
    ['2025020626', '2025020635'],
  )
  assert.equal(context.awayContext.gamesInFourDays, 2)
  assert.equal(context.awayContext.restFatigueCondition, 'normal')
  assert.deepEqual(
    context.homeContext.scheduleWindowDiagnostics.fourDayWindow.countedGames.map(
      (game) => game.gameId,
    ),
    ['2025020604', '2025020619', '2025020635'],
  )
  assert.equal(context.homeContext.gamesInFourDays, 3)
  assert.equal(context.homeContext.restFatigueCondition, '3_games_in_4_days')
  assert.deepEqual(context.homeContext.adjustmentBreakdown, [
    {
      adjustment: -0.5,
      category: 'restFatigue',
      condition: '3_games_in_4_days',
    },
  ])
  assert.equal(context.homeContext.automaticRestFatigueAdjustment, -0.5)
})

test('rest fatigue composition applies 3-in-4 only when no higher priority condition is detected', () => {
  const current = scheduleGame({
    away: 'BOS',
    gameId: 'composition-three-current',
    gameState: 'FUT',
    home: 'TOR',
    startTimeUTC: '2026-01-04T00:00:00.000Z',
    venueCity: 'Toronto',
  })
  const schedule = [
    scheduleGame({
      away: 'BOS',
      gameId: 'composition-three-first',
      home: 'MTL',
      startTimeUTC: '2026-01-01T00:00:00.000Z',
      venueCity: 'Montreal',
    }),
    scheduleGame({
      away: 'OTT',
      gameId: 'composition-three-second',
      home: 'BOS',
      startTimeUTC: '2026-01-02T00:00:00.000Z',
      venueCity: 'Boston',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: schedule,
    currentGame: current,
    homeScheduleGames: schedule,
    now: new Date('2026-01-03T12:00:00.000Z'),
    quickRematchSettings: DEFAULT_QUICK_REMATCH_SETTINGS,
  })
  const teamContext = getTeamContext(context, 'BOS')

  assert.equal(teamContext.restFatigueCondition, '3_games_in_4_days')
  assert.deepEqual(teamContext.adjustmentBreakdown, [
    {
      adjustment: -0.5,
      category: 'restFatigue',
      condition: '3_games_in_4_days',
    },
  ])
  assert.equal(teamContext.automaticRestFatigueAdjustment, -0.5)
})

test('rest fatigue composition applies B2B over 3-in-4 without double-counting', () => {
  const current = scheduleGame({
    away: 'BOS',
    gameId: 'composition-b2b-current',
    gameState: 'FUT',
    home: 'NYI',
    startTimeUTC: '2026-01-04T00:00:00.000Z',
    venueCity: 'New York',
  })
  const schedule = [
    scheduleGame({
      away: 'OTT',
      gameId: 'composition-b2b-first',
      home: 'BOS',
      startTimeUTC: '2026-01-01T00:00:00.000Z',
      venueCity: 'Boston',
    }),
    scheduleGame({
      away: 'BOS',
      gameId: 'composition-b2b-previous',
      home: 'NYI',
      startTimeUTC: '2026-01-03T00:00:00.000Z',
      venueCity: 'New York',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: schedule,
    currentGame: current,
    homeScheduleGames: schedule,
    now: new Date('2026-01-03T12:00:00.000Z'),
    quickRematchSettings: DEFAULT_QUICK_REMATCH_SETTINGS,
  })
  const teamContext = getTeamContext(context, 'BOS')

  assert.deepEqual(teamContext.conditions, [
    '3_games_in_4_days',
    'back_to_back',
  ])
  assert.deepEqual(teamContext.adjustmentBreakdown, [
    {
      adjustment: -0.75,
      category: 'restFatigue',
      condition: 'back_to_back',
    },
  ])
  assert.equal(teamContext.automaticRestFatigueAdjustment, -0.75)
  assert.equal(teamContext.travelBetweenGames, false)
})

test('rest fatigue composition applies B2B travel over 3-in-4 without double-counting', () => {
  const current = scheduleGame({
    away: 'BOS',
    gameId: 'composition-travel-current',
    gameState: 'FUT',
    home: 'TOR',
    startTimeUTC: '2026-01-04T00:00:00.000Z',
    venueCity: 'Toronto',
  })
  const schedule = [
    scheduleGame({
      away: 'OTT',
      gameId: 'composition-travel-first',
      home: 'BOS',
      startTimeUTC: '2026-01-01T00:00:00.000Z',
      venueCity: 'Boston',
    }),
    scheduleGame({
      away: 'BOS',
      gameId: 'composition-travel-previous',
      home: 'MTL',
      startTimeUTC: '2026-01-03T00:00:00.000Z',
      venueCity: 'Montreal',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: schedule,
    currentGame: current,
    homeScheduleGames: schedule,
    now: new Date('2026-01-03T12:00:00.000Z'),
    quickRematchSettings: DEFAULT_QUICK_REMATCH_SETTINGS,
  })
  const teamContext = getTeamContext(context, 'BOS')

  assert.deepEqual(teamContext.conditions, [
    '3_games_in_4_days',
    'back_to_back_travel',
  ])
  assert.deepEqual(teamContext.adjustmentBreakdown, [
    {
      adjustment: -1.25,
      category: 'restFatigue',
      condition: 'back_to_back_travel',
    },
  ])
  assert.equal(teamContext.automaticRestFatigueAdjustment, -1.25)
  assert.equal(teamContext.travelBetweenGames, true)
})

test('disabled selected rest fatigue rule does not fall through to lower priority modifiers', () => {
  const current = scheduleGame({
    away: 'BOS',
    gameId: 'composition-disabled-current',
    gameState: 'FUT',
    home: 'NYI',
    startTimeUTC: '2026-01-04T00:00:00.000Z',
    venueCity: 'New York',
  })
  const schedule = [
    scheduleGame({
      away: 'OTT',
      gameId: 'composition-disabled-first',
      home: 'BOS',
      startTimeUTC: '2026-01-01T00:00:00.000Z',
      venueCity: 'Boston',
    }),
    scheduleGame({
      away: 'BOS',
      gameId: 'composition-disabled-previous',
      home: 'NYI',
      startTimeUTC: '2026-01-03T00:00:00.000Z',
      venueCity: 'New York',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: schedule,
    currentGame: current,
    homeScheduleGames: schedule,
    now: new Date('2026-01-03T12:00:00.000Z'),
    quickRematchSettings: {
      ...DEFAULT_QUICK_REMATCH_SETTINGS,
      backToBackEnabled: false,
    },
  })
  const teamContext = getTeamContext(context, 'BOS')

  assert.equal(teamContext.restFatigueCondition, 'back_to_back')
  assert.deepEqual(teamContext.adjustmentBreakdown, [])
  assert.equal(teamContext.automaticRestFatigueAdjustment, 0)
})

test('back-to-back classification uses schedule structure and conservative fallbacks', () => {
  const cases = [
    {
      current: scheduleGame({
        away: 'TOR',
        gameId: 'b2b-home-home-current',
        gameState: 'FUT',
        home: 'BOS',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
      }),
      expectedAdjustment: -0.75,
      expectedCondition: 'back_to_back',
      expectedCurrentHomeTeamId: 'BOS',
      expectedCurrentTeamSide: 'home',
      expectedPreviousHomeTeamId: 'BOS',
      expectedPreviousTeamSide: 'home',
      expectedSameAwayHomeTeam: null,
      expectedSource: 'schedule_structure',
      expectedTravel: false,
      previous: scheduleGame({
        away: 'MTL',
        gameId: 'b2b-home-home-previous',
        home: 'BOS',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      }),
      title: 'Home -> Home',
    },
    {
      current: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-same-home-current',
        gameState: 'FUT',
        home: 'VAN',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
      }),
      expectedAdjustment: -0.75,
      expectedCondition: 'back_to_back',
      expectedCurrentHomeTeamId: 'VAN',
      expectedCurrentTeamSide: 'away',
      expectedPreviousHomeTeamId: 'VAN',
      expectedPreviousTeamSide: 'away',
      expectedSameAwayHomeTeam: true,
      expectedSource: 'schedule_structure',
      expectedTravel: false,
      previous: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-same-home-previous',
        home: 'VAN',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      }),
      title: 'Away -> Away same home team',
    },
    {
      current: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-home-away-current',
        gameState: 'FUT',
        home: 'TOR',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
      }),
      expectedAdjustment: -1.25,
      expectedCondition: 'back_to_back_travel',
      expectedCurrentHomeTeamId: 'TOR',
      expectedCurrentTeamSide: 'away',
      expectedPreviousHomeTeamId: 'BOS',
      expectedPreviousTeamSide: 'home',
      expectedSameAwayHomeTeam: null,
      expectedSource: 'schedule_structure',
      expectedTravel: true,
      previous: scheduleGame({
        away: 'MTL',
        gameId: 'b2b-home-away-previous',
        home: 'BOS',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      }),
      title: 'Home -> Away',
    },
    {
      current: scheduleGame({
        away: 'TOR',
        gameId: 'b2b-away-home-current',
        gameState: 'FUT',
        home: 'BOS',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
      }),
      expectedAdjustment: -1.25,
      expectedCondition: 'back_to_back_travel',
      expectedCurrentHomeTeamId: 'BOS',
      expectedCurrentTeamSide: 'home',
      expectedPreviousHomeTeamId: 'MTL',
      expectedPreviousTeamSide: 'away',
      expectedSameAwayHomeTeam: null,
      expectedSource: 'schedule_structure',
      expectedTravel: true,
      previous: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-home-previous',
        home: 'MTL',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      }),
      title: 'Away -> Home',
    },
    {
      current: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-away-current',
        gameState: 'FUT',
        home: 'NYR',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
        venueCity: 'New York',
      }),
      expectedAdjustment: -1.25,
      expectedCondition: 'back_to_back_travel',
      expectedCurrentHomeTeamId: 'NYR',
      expectedCurrentTeamSide: 'away',
      expectedPreviousHomeTeamId: 'NYI',
      expectedPreviousTeamSide: 'away',
      expectedSameAwayHomeTeam: false,
      expectedSource: 'schedule_structure',
      expectedTravel: true,
      previous: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-away-previous',
        home: 'NYI',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
        venueCity: 'New York',
      }),
      title: 'Away -> Away different home teams with same venue city',
    },
    {
      current: scheduleGame({
        away: 'BOS',
        gameId: 'b2b-away-away-unknown-current',
        gameState: 'FUT',
        home: 'TOR',
        startTimeUTC: '2026-01-04T00:00:00.000Z',
      }),
      expectedAdjustment: -0.75,
      expectedCondition: 'back_to_back',
      expectedCurrentHomeTeamId: 'TOR',
      expectedCurrentTeamSide: 'away',
      expectedPreviousHomeTeamId: null,
      expectedPreviousTeamSide: 'away',
      expectedSameAwayHomeTeam: null,
      expectedSource: 'insufficient_schedule_identity',
      expectedTravel: null,
      previous: {
        awayTeam: {
          abbrev: 'BOS',
        },
        gameState: 'FINAL',
        homeTeam: {},
        id: 'b2b-away-away-unknown-previous',
        startTimeUTC: '2026-01-03T00:00:00.000Z',
      },
      title: 'Away -> Away missing previous home team identity',
    },
  ]

  cases.forEach((scenario) => {
    const context = calculateGameContextForGame({
      awayScheduleGames: [scenario.previous],
      currentGame: scenario.current,
      homeScheduleGames: [scenario.previous],
      now: new Date('2026-01-03T12:00:00.000Z'),
      quickRematchSettings: DEFAULT_QUICK_REMATCH_SETTINGS,
    })
    const teamContext = getTeamContext(context, 'BOS')

    assert.equal(
      teamContext.restFatigueCondition,
      scenario.expectedCondition,
      scenario.title,
    )
    assert.equal(
      teamContext.travelBetweenGames,
      scenario.expectedTravel,
      scenario.title,
    )
    assert.equal(
      teamContext.travelClassificationSource,
      scenario.expectedSource,
      scenario.title,
    )
    assert.equal(
      teamContext.previousTeamSide,
      scenario.expectedPreviousTeamSide,
      scenario.title,
    )
    assert.equal(
      teamContext.currentTeamSide,
      scenario.expectedCurrentTeamSide,
      scenario.title,
    )
    assert.equal(
      teamContext.previousHomeTeamId,
      scenario.expectedPreviousHomeTeamId,
      scenario.title,
    )
    assert.equal(
      teamContext.currentHomeTeamId,
      scenario.expectedCurrentHomeTeamId,
      scenario.title,
    )
    assert.equal(
      teamContext.sameAwayHomeTeam,
      scenario.expectedSameAwayHomeTeam,
      scenario.title,
    )
    assert.equal(
      teamContext.adjustmentBreakdown[0]?.condition,
      scenario.expectedCondition,
      scenario.title,
    )
    assert.equal(
      teamContext.automaticRestFatigueAdjustment,
      scenario.expectedAdjustment,
      scenario.title,
    )
    assert.equal(
      Number.isFinite(teamContext.automaticRestFatigueAdjustment),
      true,
      scenario.title,
    )
  })
})

test('Anaheim and Montreal regressions use schedule structure without venue city data', () => {
  const current = scheduleGame({
    away: 'ANA',
    gameId: '2025021100',
    gameState: 'FUT',
    home: 'MTL',
    startTimeUTC: '2026-03-15T23:00:00.000Z',
  })
  const schedule = [
    scheduleGame({
      away: 'ANA',
      gameId: '2025021080',
      home: 'OTT',
      startTimeUTC: '2026-03-14T23:00:00.000Z',
    }),
    scheduleGame({
      away: 'NYR',
      gameId: '2025021081',
      home: 'MTL',
      startTimeUTC: '2026-03-14T23:30:00.000Z',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: schedule,
    currentGame: current,
    homeScheduleGames: schedule,
    now: new Date('2026-03-15T12:00:00.000Z'),
    quickRematchSettings: {
      ...DEFAULT_QUICK_REMATCH_SETTINGS,
      backToBackAdjustment: -0.65,
      backToBackTravelAdjustment: -1.4,
    },
  })
  const anaheimContext = getTeamContext(context, 'ANA')
  const montrealContext = getTeamContext(context, 'MTL')

  assert.equal(anaheimContext.previousTeamSide, 'away')
  assert.equal(anaheimContext.currentTeamSide, 'away')
  assert.equal(anaheimContext.previousHomeTeamId, 'OTT')
  assert.equal(anaheimContext.currentHomeTeamId, 'MTL')
  assert.equal(anaheimContext.sameAwayHomeTeam, false)
  assert.equal(anaheimContext.travelBetweenGames, true)
  assert.equal(anaheimContext.travelClassificationSource, 'schedule_structure')
  assert.equal(anaheimContext.restFatigueCondition, 'back_to_back_travel')
  assert.equal(anaheimContext.adjustmentBreakdown[0]?.condition, 'back_to_back_travel')
  assert.equal(anaheimContext.automaticRestFatigueAdjustment, -1.4)

  assert.equal(montrealContext.previousTeamSide, 'home')
  assert.equal(montrealContext.currentTeamSide, 'home')
  assert.equal(montrealContext.previousHomeTeamId, 'MTL')
  assert.equal(montrealContext.currentHomeTeamId, 'MTL')
  assert.equal(montrealContext.sameAwayHomeTeam, null)
  assert.equal(montrealContext.travelBetweenGames, false)
  assert.equal(montrealContext.travelClassificationSource, 'schedule_structure')
  assert.equal(montrealContext.restFatigueCondition, 'back_to_back')
  assert.equal(montrealContext.adjustmentBreakdown[0]?.condition, 'back_to_back')
  assert.equal(montrealContext.automaticRestFatigueAdjustment, -0.65)
})

test('LAK at NYI Mar 13 default settings detect but do not apply informational modifiers', () => {
  const lakNyiGame = scheduleGame({
    away: 'LAK',
    gameId: '2025021044',
    gameState: 'FUT',
    home: 'NYI',
    startTimeUTC: '2026-03-13T23:30:00.000Z',
  })
  const lakSchedule = [
    scheduleGame({
      away: 'LAK',
      gameId: '2025021012',
      home: 'VGK',
      startTimeUTC: '2026-03-08T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'LAK',
      gameId: '2025021020',
      home: 'SJS',
      startTimeUTC: '2026-03-09T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'WSH',
      gameId: '2025021028',
      home: 'LAK',
      startTimeUTC: '2026-03-10T03:30:00.000Z',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: lakSchedule,
    currentGame: lakNyiGame,
    homeScheduleGames: [],
    now: new Date('2026-03-13T12:00:00.000Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 5,
    },
  })

  assert.equal(context.awayContext.restDays, 2)
  assert.equal(context.awayContext.conditions.includes('well_rested'), true)
  assert.equal(
    context.awayContext.conditions.includes('4_games_in_6_days'),
    true,
  )
  assert.equal(context.awayContext.restFatigueCondition, 'well_rested')
  assert.deepEqual(context.awayContext.adjustmentBreakdown, [])
  assert.equal(context.awayContext.automaticRestFatigueAdjustment, 0)
  assert.equal(context.awayContext.effectiveRestFatigueAdjustment, 0)
})

test('LAK at NYI Mar 13 applies Well Rested only when enabled', () => {
  const lakNyiGame = scheduleGame({
    away: 'LAK',
    gameId: '2025021044',
    gameState: 'FUT',
    home: 'NYI',
    startTimeUTC: '2026-03-13T23:30:00.000Z',
  })
  const lakSchedule = [
    scheduleGame({
      away: 'LAK',
      gameId: '2025021012',
      home: 'VGK',
      startTimeUTC: '2026-03-08T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'LAK',
      gameId: '2025021020',
      home: 'SJS',
      startTimeUTC: '2026-03-09T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'WSH',
      gameId: '2025021028',
      home: 'LAK',
      startTimeUTC: '2026-03-10T03:30:00.000Z',
    }),
  ]

  const context = calculateGameContextForGame({
    awayScheduleGames: lakSchedule,
    currentGame: lakNyiGame,
    homeScheduleGames: [],
    now: new Date('2026-03-13T12:00:00.000Z'),
    quickRematchSettings: {
      enabled: true,
      loserAdjustment: 0.25,
      maxDaysSincePreviousMeeting: 5,
      wellRestedAdjustment: 0.25,
      wellRestedAdjustmentEnabled: true,
    },
  })

  assert.equal(context.awayContext.restDays, 2)
  assert.equal(context.awayContext.conditions.includes('well_rested'), true)
  assert.equal(
    context.awayContext.conditions.includes('4_games_in_6_days'),
    true,
  )
  assert.deepEqual(context.awayContext.adjustmentBreakdown, [
    {
      adjustment: 0.25,
      category: 'restFatigue',
      condition: 'well_rested',
    },
  ])
  assert.equal(context.awayContext.automaticRestFatigueAdjustment, 0.25)
  assert.equal(context.awayContext.effectiveRestFatigueAdjustment, 0.25)
})

test('game context recalculation removes stale informational rest modifiers while preserving manual overrides', async () => {
  const store = createContextStore()
  const lakNyiGame = {
    gameId: '2025021044',
    gameState: 'FUT',
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      score: null,
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      score: null,
    },
    startTimeUTC: '2026-03-13T23:30:00.000Z',
    status: 'Scheduled',
  }
  const lakSchedule = [
    scheduleGame({
      away: 'LAK',
      gameId: '2025021012',
      home: 'VGK',
      startTimeUTC: '2026-03-08T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'LAK',
      gameId: '2025021020',
      home: 'SJS',
      startTimeUTC: '2026-03-09T03:00:00.000Z',
    }),
    scheduleGame({
      away: 'WSH',
      gameId: '2025021028',
      home: 'LAK',
      startTimeUTC: '2026-03-10T03:30:00.000Z',
    }),
  ]

  store.contexts.set('user-a:2025021044', {
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: 0.25,
          condition: 'well_rested',
        },
        {
          adjustment: -0.5,
          condition: '4_games_in_6_days',
        },
      ],
      automaticRestFatigueAdjustment: -0.25,
      effectiveRestFatigueAdjustment: 0.75,
      manualRestFatigueAdjustment: 0.75,
      restFatigueOverrideEnabled: true,
    },
    gameId: '2025021044',
    userId: 'user-a',
  })

  const result = await getGameContexts(
    'user-a',
    { games: [lakNyiGame] },
    {
      contextModel: store.model,
      getScheduleGamesForDateRange: async () => lakSchedule,
      getQuickRematchSettings: async () => ({
        settings: DEFAULT_QUICK_REMATCH_SETTINGS,
      }),
      now: new Date('2026-03-13T12:00:00.000Z'),
    },
  )
  const awayContext = result.contexts[0].awayContext

  assert.deepEqual(awayContext.adjustmentBreakdown, [])
  assert.equal(awayContext.automaticRestFatigueAdjustment, 0)
  assert.equal(awayContext.effectiveRestFatigueAdjustment, 0.75)
  assert.equal(awayContext.restFatigueOverrideEnabled, true)
})

test('quick rematch settings validate defaults, ranges and per-user saves', async () => {
  const store = createSettingsStore()
  const defaults = await getQuickRematchSettings('user-a', {
    settingsModel: store.model,
  })

  assert.deepEqual(defaults.settings, DEFAULT_QUICK_REMATCH_SETTINGS)
  assert.throws(
    () =>
      normalizeSettingsPayload({
        enabled: true,
        loserAdjustment: 1.25,
        maxDaysSincePreviousMeeting: 15,
        threeInFourAdjustment: 0.25,
        wellRestedAdjustment: 1.25,
        wellRestedAdjustmentEnabled: 'yes',
      }),
    (error) =>
      error.statusCode === 400 &&
      error.details.fieldErrors.quickRematchLoserAdjustment.includes(
        'no more than 1',
      ) &&
      error.details.fieldErrors.quickRematchMaximumDays.includes('1 to 14') &&
      error.details.fieldErrors.threeInFourAdjustment.includes(
        'no more than 0',
      ) &&
      error.details.fieldErrors.wellRestedAdjustment.includes('no more than 1') &&
      error.details.fieldErrors.wellRestedEnabled.includes(
        'true or false',
      ),
  )

  await updateQuickRematchSettings(
    'user-a',
    {
      enabled: false,
      loserAdjustment: 0.4,
      maxDaysSincePreviousMeeting: 7,
      wellRestedAdjustment: 0.3,
      wellRestedAdjustmentEnabled: true,
    },
    { settingsModel: store.model },
  )

  const userA = await getQuickRematchSettings('user-a', {
    settingsModel: store.model,
  })
  const userB = await getQuickRematchSettings('user-b', {
    settingsModel: store.model,
  })

  assert.equal(userA.settings.enabled, false)
  assert.equal(userA.settings.quickRematchEnabled, false)
  assert.equal(userA.settings.maxDaysSincePreviousMeeting, 7)
  assert.equal(userA.settings.quickRematchMaximumDays, 7)
  assert.equal(userA.settings.wellRestedAdjustment, 0.3)
  assert.equal(userA.settings.wellRestedAdjustmentEnabled, true)
  assert.equal(userA.settings.wellRestedEnabled, true)
  assert.deepEqual(userB.settings, DEFAULT_QUICK_REMATCH_SETTINGS)

  await resetQuickRematchSettings('user-a', { settingsModel: store.model })
  assert.deepEqual(
    (await getQuickRematchSettings('user-a', { settingsModel: store.model }))
      .settings,
    DEFAULT_QUICK_REMATCH_SETTINGS,
  )
})

test('old persisted schedule adjustment settings normalize safely', async () => {
  const store = createSettingsStore()

  store.settingsByUser.set('user-old', {
    backToBackAwayAdjustment: -0.95,
    backToBackHomeAdjustment: -0.65,
    backToBackTravelAdjustment: -1.4,
    enabled: false,
    fourInSixAdjustment: -0.8,
    loserAdjustment: 0.35,
    maxDaysSincePreviousMeeting: 6,
    userId: 'user-old',
    wellRestedAdjustment: 0.3,
  })

  const result = await getQuickRematchSettings('user-old', {
    settingsModel: store.model,
  })

  assert.equal(result.settings.backToBackAdjustment, -0.65)
  assert.equal(result.settings.backToBackTravelAdjustment, -1.4)
  assert.equal(result.settings.fourInSixAdjustment, undefined)
  assert.equal(result.settings.quickRematchEnabled, false)
  assert.equal(result.settings.quickRematchLoserAdjustment, 0.35)
  assert.equal(result.settings.quickRematchMaximumDays, 6)
  assert.equal(result.settings.threeInFourAdjustment, -0.5)
  assert.equal(result.settings.threeInFourEnabled, true)
  assert.equal(result.settings.wellRestedEnabled, false)
})

test('GameContext uses a unique userId and gameId index', () => {
  assert.ok(
    GameContext.schema.indexes().some(
      ([indexDefinition, options]) =>
        indexDefinition.userId === 1 &&
        indexDefinition.gameId === 1 &&
        options.unique === true,
    ),
  )
})

test('game context mutable update excludes immutable Mongo identity fields', () => {
  const update = buildGameContextMutableUpdate({
    __v: 3,
    _id: 'mongo-id',
    awayContext: {
      totalGameContextAdjustment: -1,
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    gameId: 'context-game',
    homeContext: {
      totalGameContextAdjustment: 0.25,
    },
    sourceVersion: 'game-context-v1',
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    userId: 'user-a',
  })

  assert.equal(update.gameId, undefined)
  assert.equal(update.userId, undefined)
  assert.equal(update._id, undefined)
  assert.equal(update.__v, undefined)
  assert.equal(update.createdAt, undefined)
  assert.equal(update.updatedAt, undefined)
  assert.equal(update.sourceVersion, 'game-context-v1')
  assert.equal(update.awayContext.totalGameContextAdjustment, -1)
})

test('game context bulk inserts, updates and preserves overrides without path conflicts', async () => {
  const store = createContextStore()
  const schedulesByTeam = {
    BOS: { games: clone(bosSchedule) },
    TOR: { games: clone(torSchedule) },
  }
  const options = {
    contextModel: store.model,
    getScheduleGamesForDateRange: async () => [
      ...clone(schedulesByTeam.BOS.games),
      ...clone(schedulesByTeam.TOR.games),
    ],
    getQuickRematchSettings: async () => ({
      settings: {
        enabled: true,
        loserAdjustment: 0.25,
        maxDaysSincePreviousMeeting: 4,
      },
    }),
    now: new Date('2026-01-04T12:00:00Z'),
  }

  const inserted = await getGameContexts(
    'user-a',
    { games: [currentGame] },
    options,
  )

  assert.equal(inserted.contexts.length, 1)
  assert.equal(store.contexts.size, 1)
  assert.equal(store.operations[0].filter.userId, 'user-a')
  assert.equal(store.operations[0].filter.gameId, currentGame.gameId)
  assert.equal(store.operations[0].update.$set.gameId, undefined)
  assert.equal(store.operations[0].update.$set.userId, undefined)
  assert.equal(store.operations[0].update.$setOnInsert.gameId, currentGame.gameId)
  assert.equal(store.operations[0].update.$setOnInsert.userId, 'user-a')

  await updateGameContextOverrides(
    'user-a',
    currentGame.gameId,
    {
      awayContext: {
        manualRestFatigueAdjustment: 0.5,
        restFatigueOverrideEnabled: true,
      },
    },
    options,
  )

  const userA = await getGameContexts(
    'user-a',
    { games: [currentGame] },
    {
      ...options,
      now: new Date('2026-01-04T13:00:00Z'),
    },
  )
  const userB = await getGameContexts('user-b', { games: [currentGame] }, options)

  assert.equal(userA.contexts[0].awayContext.effectiveRestFatigueAdjustment, 0.5)
  assert.equal(userA.contexts[0].awayContext.effectiveQuickRematchAdjustment, 0.25)
  assert.equal(userA.contexts[0].awayContext.manualRestFatigueAdjustment, 0.5)
  assert.equal(userA.contexts[0].awayContext.restFatigueOverrideEnabled, true)
  assert.equal(userB.contexts[0].awayContext.effectiveRestFatigueAdjustment, -1.25)
  assert.equal(userB.contexts[0].awayContext.restFatigueOverrideEnabled, false)
  assert.equal(store.contexts.size, 2)
  assert.equal(
    store.contexts.get(`user-a:${currentGame.gameId}`).lastCalculatedAt.toISOString(),
    '2026-01-04T13:00:00.000Z',
  )
})

test('game context bulk handles historical and repeated games idempotently', async () => {
  const store = createContextStore()
  const schedulesByTeam = {
    BOS: { games: clone(bosSchedule) },
    TOR: { games: clone(torSchedule) },
  }
  const options = {
    contextModel: store.model,
    getScheduleGamesForDateRange: async () => [
      ...clone(schedulesByTeam.BOS.games),
      ...clone(schedulesByTeam.TOR.games),
    ],
    getQuickRematchSettings: async () => ({
      settings: {
        enabled: true,
        loserAdjustment: 0.25,
        maxDaysSincePreviousMeeting: 4,
      },
    }),
    now: new Date('2026-01-04T12:00:00Z'),
  }
  const firstBulk = await getGameContexts(
    'user-a',
    { games: [currentGame, historicalGame] },
    options,
  )
  const secondBulk = await getGameContexts(
    'user-a',
    { games: [currentGame, historicalGame] },
    options,
  )

  assert.equal(firstBulk.contexts.length, 2)
  assert.equal(secondBulk.contexts.length, 2)
  assert.equal(store.contexts.size, 2)
  assert.equal(
    store.operations.every((operation) => operation.update.$set.gameId === undefined),
    true,
  )
  assert.equal(
    store.operations.every((operation) => operation.update.$set.userId === undefined),
    true,
  )
  assert.equal(
    secondBulk.contexts.find((context) => context.gameId === historicalGame.gameId)
      .gameState,
    'FINAL',
  )
})

test('game context bulk batches multiple games into one schedule range request', async () => {
  const store = createContextStore()
  const rangeRequests = []
  const secondGame = {
    gameId: '2026020003',
    gameState: 'FUT',
    homeTeam: {
      abbreviation: 'NYR',
      name: 'New York Rangers',
      score: null,
    },
    awayTeam: {
      abbreviation: 'CAR',
      name: 'Carolina Hurricanes',
      score: null,
    },
    startTimeUTC: '2026-01-06T00:00:00.000Z',
    status: 'Scheduled',
  }
  const options = {
    contextModel: store.model,
    getScheduleGamesForDateRange: async (dateFrom, dateTo) => {
      rangeRequests.push({ dateFrom, dateTo })

      return [...clone(torSchedule), ...clone(bosSchedule)]
    },
    getQuickRematchSettings: async () => ({
      settings: {
        enabled: true,
        loserAdjustment: 0.25,
        maxDaysSincePreviousMeeting: 7,
      },
    }),
    now: new Date('2026-01-04T12:00:00Z'),
  }
  const bulk = await getGameContexts(
    'user-a',
    { games: [currentGame, secondGame] },
    options,
  )

  assert.equal(bulk.contexts.length, 2)
  assert.equal(store.contexts.size, 2)
  assert.deepEqual(rangeRequests, [
    {
      dateFrom: '2025-12-28',
      dateTo: '2026-01-07',
    },
  ])
})

test('game context bulk saves per-game rate-limited contexts without throwing', async () => {
  const store = createContextStore()
  const rateLimitError = new Error('Too Many Requests')

  rateLimitError.upstreamStatus = 429

  const bulk = await getGameContexts(
    'user-a',
    { games: [currentGame, historicalGame] },
    {
      contextModel: store.model,
      getScheduleGamesForDateRange: async () => {
        throw rateLimitError
      },
      getQuickRematchSettings: async () => ({
        settings: {
          enabled: true,
          loserAdjustment: 0.25,
          maxDaysSincePreviousMeeting: 4,
        },
      }),
      now: new Date('2026-01-04T12:00:00Z'),
    },
  )

  assert.equal(bulk.contexts.length, 2)
  assert.equal(store.contexts.size, 2)
  assert.equal(bulk.contexts[0].awayContext.dataStatus, 'rate_limited')
  assert.equal(bulk.contexts[0].homeContext.dataStatus, 'rate_limited')
  assert.match(
    bulk.contexts[0].awayContext.reasons.join(' '),
    /rate limit reached/,
  )
})

test('season id is derived from NHL season start year', () => {
  assert.equal(deriveSeasonIdFromDate('2026-07-15T00:00:00Z'), '20262027')
  assert.equal(deriveSeasonIdFromDate('2026-06-30T00:00:00Z'), '20252026')
})
