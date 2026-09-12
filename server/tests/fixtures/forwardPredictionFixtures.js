const USER_ID = '507f1f77bcf86cd799439011'
const OTHER_USER_ID = '507f1f77bcf86cd799439012'
const START = new Date('2026-10-08T19:00:00.000Z')
const NOW = new Date('2026-10-08T17:15:00.000Z')
const game = () => ({ id: 2026020001, season: 20262027, gameType: 2,
  startTimeUTC: START.toISOString(), gameState: 'FUT',
  homeTeam: { abbrev: 'BOS' }, awayTeam: { abbrev: 'TOR' } })
const sideContext = (rest = 0, rematch = 0) => ({
  dataStatus: 'available', automaticRestFatigueAdjustment: rest, automaticQuickRematchAdjustment: rematch,
  restFatigueCondition: rest === -1.25 ? 'back_to_back_travel' : rest === -0.75 ? 'back_to_back' :
    rest === -0.5 ? '3_games_in_4_days' : 'normal',
  adjustmentBreakdown: [
    { category: 'restFatigue', condition: 'back_to_back', adjustment: rest },
    { category: 'quickRematch', condition: 'quick_rematch', adjustment: rematch },
  ],
})
const specialTeams = { leagueTeamCount: 32, teams: [
  { teamAbbreviation: 'BOS', powerPlayLeagueRank: 1, penaltyKillLeagueRank: 16 },
  { teamAbbreviation: 'TOR', powerPlayLeagueRank: 16, penaltyKillLeagueRank: 32 },
] }
const inputs = (overrides = {}) => ({
  identity: { gameId: '2026020001', seasonId: '20262027', gameType: 2, scheduledStartAtCapture: START,
    homeTeamId: 'BOS', awayTeamId: 'TOR' },
  ratings: [{ teamId: 'BOS', baseRating: 46 }, { teamId: 'TOR', baseRating: 46 }],
  settings: { homeAdvantage: 3.5, probabilityScale: 20 }, scheduleSettings: {},
  injurySummaries: { BOS: { totalImpact: 0 }, TOR: { totalImpact: 0 } },
  gameContext: { gameId: '2026020001', scheduledStart: START, homeContext: sideContext(), awayContext: sideContext() },
  ...overrides,
})
// Frozen baseline probabilities from the pre-extraction calculateGame implementation (git HEAD).
const parityScenarios = [
  { name: 'neutral', homeAdvantage: 0, expected: 0.5 },
  { name: 'home advantage', expected: 0.5436386872370789 },
  { name: 'B2B', rest: -0.75, expected: 0.5343209436693046 },
  { name: 'B2B travel', rest: -1.25, expected: 0.528095374408387 },
  { name: '3 in 4', rest: -0.5, expected: 0.5374298453437496 },
  { name: 'quick rematch', rematch: 0.25, expected: 0.5467381519846138 },
  { name: 'injury', injury: -2, expected: 0.5187412158785352 },
  { name: 'confirmed goalie', goalie: -1.5, expected: 0.52497918747894 },
  { name: 'unconfirmed goalie', expected: 0.5436386872370789 },
  { name: 'special teams', special: true, expected: 0.549833997312478 },
  { name: 'combined', homeAdjustment: 0.5, rest: -1.25, rematch: 0.25, injury: -2,
    goalie: -1.5, special: true, expected: 0.5 },
]
const scenarioInputs = (scenario) => {
  const value = inputs()
  value.settings.homeAdvantage = scenario.homeAdvantage ?? 3.5
  value.ratings[0].homeAdjustment = scenario.homeAdjustment ?? 0
  value.gameContext.homeContext = sideContext(scenario.rest, scenario.rematch)
  value.injurySummaries.BOS.totalImpact = scenario.injury ?? 0
  if (scenario.goalie !== undefined) value.gameContext.goalieSelections = { home: {
    selectionType: 'provider_goalie', teamId: 'BOS', nhlPlayerId: 123,
    teamDefaultAdjustment: scenario.goalie, effectiveAdjustment: scenario.goalie, confirmationStatus: 'confirmed',
  } }
  if (scenario.special) { value.settings.specialTeamsMode = 'automatic'; value.specialTeams = specialTeams }
  return value
}

module.exports = { NOW, START, USER_ID, OTHER_USER_ID, game, inputs, parityScenarios, scenarioInputs, sideContext, specialTeams }
