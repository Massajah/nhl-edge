import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateGame } from '../utils/calculateGame.js'
import {
  applyGameContextToInputs,
  createGameContextSnapshot,
  formatRestFatigueConditionLabel,
  normalizeGameContext,
} from '../utils/gameContext.js'
import {
  createBetPayloadFromGameAnalysis,
} from '../utils/savedAnalyses.js'
import {
  calculatePreliminaryAnalysis,
  createInputsForTeams,
} from '../utils/modelAnalysis.js'
import {
  DEFAULT_QUICK_REMATCH_SETTINGS,
  createQuickRematchSettingsDraft,
  normalizeQuickRematchSettings,
  parseQuickRematchSettingsDraft,
} from '../utils/quickRematchSettings.js'
import { createLatestRequestTracker } from '../utils/requestTracker.js'

const gameContext = {
  awayContext: {
    adjustmentBreakdown: [
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
    ],
    effectiveQuickRematchAdjustment: 0.25,
    effectiveRestFatigueAdjustment: -1.25,
    quickRematch: {
      eligible: true,
      previousGameId: 'previous-game',
      reason: 'Lost the previous head-to-head meeting.',
    },
    totalGameContextAdjustment: -1,
  },
  awayTeam: {
    abbreviation: 'TOR',
    name: 'Toronto Maple Leafs',
    teamId: 'TOR',
  },
  gameId: 'context-game',
  homeContext: {
    adjustmentBreakdown: [
      {
        adjustment: 0.25,
        category: 'restFatigue',
        condition: 'well_rested',
      },
    ],
    effectiveQuickRematchAdjustment: 0,
    effectiveRestFatigueAdjustment: 0.25,
    quickRematch: {
      eligible: false,
      reason: 'Won the previous head-to-head meeting.',
    },
    totalGameContextAdjustment: 0.25,
  },
  homeTeam: {
    abbreviation: 'BOS',
    name: 'Boston Bruins',
    teamId: 'BOS',
  },
  lastCalculatedAt: '2026-01-04T12:00:00.000Z',
  sourceVersion: 'game-context-v1',
}

const teams = {
  away: 'TOR',
  home: 'BOS',
}

const powerRatings = {
  BOS: {
    baseRating: 52,
    teamId: 'BOS',
  },
  TOR: {
    baseRating: 50,
    teamId: 'TOR',
  },
}

const teamPayload = {
  away: {
    abbreviation: 'TOR',
    id: 'TOR',
    name: 'Toronto Maple Leafs',
  },
  home: {
    abbreviation: 'BOS',
    id: 'BOS',
    name: 'Boston Bruins',
  },
}

test('calculateGame includes quick rematch in effective ratings', () => {
  const result = calculateGame(
    {
      baseRating: 50,
      homeAdvantage: 0,
      quickRematchAdjustment: 0.25,
    },
    {
      baseRating: 50,
      quickRematchAdjustment: -0.5,
    },
  )

  assert.equal(result.homeFinalRating, 50.25)
  assert.equal(result.awayFinalRating, 49.5)
  assert.equal(result.ratingDifference, 0.75)
})

test('game context utility applies effective rest and quick rematch inputs', () => {
  const inputs = createInputsForTeams(powerRatings, teams, {}, {}, 4, gameContext)

  assert.equal(inputs.away.restFatigue, -1.25)
  assert.equal(inputs.away.quickRematchAdjustment, 0.25)
  assert.equal(inputs.home.restFatigue, 0.25)
  assert.equal(inputs.home.quickRematchAdjustment, 0)
})

test('preliminary analysis uses game context instead of unknown rest inputs', () => {
  const analysis = calculatePreliminaryAnalysis({
    awayTeamId: 'TOR',
    baseHomeAdvantage: 4,
    gameContext,
    homeTeamId: 'BOS',
    marketOdds: {
      away: 2.2,
      home: 1.8,
    },
    powerRatings,
  })

  assert.equal(analysis.available, true)
  assert.equal(analysis.inputs.away.restFatigue, -1.25)
  assert.equal(analysis.inputs.away.quickRematchAdjustment, 0.25)
  assert.equal(
    analysis.defaultedInputFields.includes('away.quickRematchAdjustment'),
    false,
  )
  assert.equal(analysis.defaultedInputFields.includes('home.restFatigue'), false)
})

test('game context utility preserves schedule-structure travel diagnostics', () => {
  const context = normalizeGameContext({
    awayContext: {
      currentHomeTeamId: 'MTL',
      currentTeamSide: 'away',
      previousHomeTeamId: 'OTT',
      previousTeamSide: 'away',
      restFatigueCondition: 'back_to_back_travel',
      sameAwayHomeTeam: false,
      travelBetweenGames: true,
      travelClassificationSource: 'schedule_structure',
    },
    awayTeam: {
      abbreviation: 'ANA',
      name: 'Anaheim Ducks',
      teamId: 'ANA',
    },
    gameId: 'ana-mtl',
    homeContext: {
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'MTL',
      name: 'Montreal Canadiens',
      teamId: 'MTL',
    },
  })
  const awayContext = context.awayContext

  assert.equal(awayContext.previousTeamSide, 'away')
  assert.equal(awayContext.currentTeamSide, 'away')
  assert.equal(awayContext.previousHomeTeamId, 'OTT')
  assert.equal(awayContext.currentHomeTeamId, 'MTL')
  assert.equal(awayContext.sameAwayHomeTeam, false)
  assert.equal(awayContext.travelBetweenGames, true)
  assert.equal(awayContext.travelClassificationSource, 'schedule_structure')
})

test('saved bet payload includes a normalized game context snapshot', () => {
  const inputs = applyGameContextToInputs(
    createInputsForTeams(powerRatings, teams, { home: 1.9 }, {}, 4),
    gameContext,
  )
  const result = calculateGame(inputs.home, inputs.away)
  const payload = createBetPayloadFromGameAnalysis({
    awayTeam: teamPayload.away,
    gameContextSnapshot: gameContext,
    gameId: 'context-game',
    homeTeam: teamPayload.home,
    inputs,
    result,
    selectedSide: 'away',
    stake: 1,
  })

  assert.equal(payload.adjustments.awayQuickRematch, 0.25)
  assert.equal(payload.quickRematchAdjustment, 0.25)
  assert.equal(payload.gameContextSnapshot.gameId, 'context-game')
  assert.equal(
    payload.gameContextSnapshot.awayContext.totalGameContextAdjustment,
    -1,
  )
})

test('quick rematch settings normalize drafts to supported bounds', () => {
  const settings = normalizeQuickRematchSettings({
    backToBackAdjustment: -0.76,
    backToBackTravelAdjustment: -1.26,
    enabled: false,
    loserAdjustment: 0.26,
    maxDaysSincePreviousMeeting: 18,
    threeInFourAdjustment: -0.52,
    wellRestedAdjustment: 0.31,
    wellRestedAdjustmentEnabled: true,
  })
  const draft = createQuickRematchSettingsDraft(settings)
  const parsed = parseQuickRematchSettingsDraft(draft)

  assert.equal(settings.enabled, false)
  assert.equal(settings.loserAdjustment, 0.25)
  assert.equal(settings.maxDaysSincePreviousMeeting, 14)
  assert.equal(settings.backToBackAdjustment, -0.75)
  assert.equal(settings.backToBackTravelAdjustment, -1.25)
  assert.equal(settings.threeInFourAdjustment, -0.5)
  assert.equal(settings.wellRestedAdjustment, 0.3)
  assert.equal(settings.wellRestedAdjustmentEnabled, true)
  assert.deepEqual(
    normalizeGameContext(null),
    null,
  )
  assert.equal(parsed.enabled, false)
  assert.equal(parsed.quickRematchEnabled, false)
  assert.equal(parsed.backToBackAdjustment, -0.75)
  assert.equal(parsed.wellRestedAdjustment, 0.3)
  assert.equal(parsed.wellRestedAdjustmentEnabled, true)
  assert.notDeepEqual(parsed, DEFAULT_QUICK_REMATCH_SETTINGS)

  const legacySettings = normalizeQuickRematchSettings({
    backToBackAwayAdjustment: -0.95,
    backToBackHomeAdjustment: -0.65,
    backToBackTravelAdjustment: -1.4,
    fourInSixAdjustment: -0.8,
  })

  assert.equal(legacySettings.backToBackAdjustment, -0.65)
  assert.equal(legacySettings.backToBackTravelAdjustment, -1.4)
  assert.equal(legacySettings.fourInSixAdjustment, undefined)
  assert.equal(legacySettings.wellRestedEnabled, false)
})

test('latest request tracker rejects stale dashboard schedule results', () => {
  const tracker = createLatestRequestTracker()
  const firstRequest = tracker.start()
  const secondRequest = tracker.start()

  assert.equal(firstRequest.isLatest(), false)
  assert.equal(secondRequest.isLatest(), true)
  assert.equal(tracker.isLatest(firstRequest.requestId), false)
  assert.equal(tracker.isLatest(secondRequest.requestId), true)

  tracker.invalidate()

  assert.equal(secondRequest.isLatest(), false)
})

test('LAK at NYI default settings keep detected rest conditions informational', () => {
  const context = normalizeGameContext({
    awayContext: {
      adjustmentBreakdown: [],
      automaticRestFatigueAdjustment: 0,
      conditions: ['well_rested', '4_games_in_6_days'],
      effectiveRestFatigueAdjustment: 0,
      restDays: 2,
      restFatigueCondition: 'fourInSix',
      totalGameContextAdjustment: 0,
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      teamId: 'LAK',
    },
    gameId: '2025021044',
    homeContext: {
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      teamId: 'NYI',
    },
    scheduledStart: '2026-03-13T23:30:00.000Z',
  })
  const awayContext = context.awayContext

  assert.equal(awayContext.restDays, 2)
  assert.equal(awayContext.conditions.includes('well_rested'), true)
  assert.equal(awayContext.conditions.includes('4_games_in_6_days'), true)
  assert.equal(awayContext.restFatigueCondition, '4_games_in_6_days')
  assert.deepEqual(awayContext.adjustmentBreakdown, [])
  assert.equal(
    formatRestFatigueConditionLabel(awayContext.restFatigueCondition),
    '4 Games in 6 Days',
  )
  assert.equal(awayContext.automaticRestFatigueAdjustment, 0)
  assert.equal(awayContext.effectiveRestFatigueAdjustment, 0)
})

test('LAK at NYI normalizes enabled Well Rested as the only applied modifier', () => {
  const context = normalizeGameContext({
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: 0.25,
          condition: 'well_rested',
        },
      ],
      automaticRestFatigueAdjustment: 0.25,
      conditions: ['well_rested', '4_games_in_6_days'],
      effectiveRestFatigueAdjustment: 0.25,
      restDays: 2,
      restFatigueCondition: 'well_rested',
      totalGameContextAdjustment: 0.25,
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      teamId: 'LAK',
    },
    gameId: '2025021044',
    homeContext: {
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      teamId: 'NYI',
    },
  })

  assert.deepEqual(context.awayContext.adjustmentBreakdown, [
    {
      adjustment: 0.25,
      category: 'restFatigue',
      condition: 'well_rested',
    },
  ])
  assert.equal(context.awayContext.automaticRestFatigueAdjustment, 0.25)
})

test('empty game context breakdown with no overrides normalizes schedule adjustment to zero', () => {
  const context = normalizeGameContext({
    awayContext: {
      adjustmentBreakdown: [],
      automaticQuickRematchAdjustment: 0.25,
      automaticRestFatigueAdjustment: -1.25,
      effectiveQuickRematchAdjustment: 0.25,
      effectiveRestFatigueAdjustment: -1.25,
      quickRematch: {
        reason: 'Legacy automatic field should not drive totals.',
      },
      restFatigueCondition: 'backToBackTravel',
      totalGameContextAdjustment: -1,
    },
    awayTeam: {
      abbreviation: 'TOR',
      name: 'Toronto Maple Leafs',
      teamId: 'TOR',
    },
    gameId: 'legacy-empty-breakdown',
    homeContext: {
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'BOS',
      name: 'Boston Bruins',
      teamId: 'BOS',
    },
  })
  const awayContext = context.awayContext

  assert.equal(awayContext.automaticRestFatigueAdjustment, 0)
  assert.equal(awayContext.automaticQuickRematchAdjustment, 0)
  assert.equal(awayContext.effectiveRestFatigueAdjustment, 0)
  assert.equal(awayContext.effectiveQuickRematchAdjustment, 0)
  assert.equal(awayContext.totalGameContextAdjustment, 0)
})

test('client normalization removes stale four-in-six applied modifiers', () => {
  const context = normalizeGameContext({
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: -0.5,
          condition: '4_games_in_6_days',
        },
        {
          adjustment: 0.25,
          condition: 'quick_rematch',
        },
      ],
      conditions: ['4_games_in_6_days'],
      quickRematch: {
        eligible: true,
      },
      restFatigueCondition: 'fourInSix',
      totalGameContextAdjustment: -0.25,
    },
    awayTeam: {
      abbreviation: 'LAK',
      name: 'Los Angeles Kings',
      teamId: 'LAK',
    },
    gameId: 'legacy-four-in-six',
    homeContext: {
      restFatigueCondition: 'normal',
    },
    homeTeam: {
      abbreviation: 'NYI',
      name: 'New York Islanders',
      teamId: 'NYI',
    },
  })
  const awayContext = context.awayContext

  assert.deepEqual(awayContext.adjustmentBreakdown, [
    {
      adjustment: 0.25,
      category: 'quickRematch',
      condition: 'quick_rematch',
    },
  ])
  assert.equal(awayContext.automaticRestFatigueAdjustment, 0)
  assert.equal(awayContext.automaticQuickRematchAdjustment, 0.25)
  assert.equal(awayContext.totalGameContextAdjustment, 0.25)
})
