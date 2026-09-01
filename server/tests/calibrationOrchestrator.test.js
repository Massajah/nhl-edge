const test = require('node:test')
const assert = require('node:assert/strict')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const {
  STARTING_MODES,
  buildStartingState,
  calculateMetrics,
  replayDataset,
} = require('../services/baseModelCalibrationService')
const homeAdvantageCalibrationService = require('../services/homeAdvantageCalibrationService')
const scheduleCalibrationService = require('../services/scheduleCalibrationService')
const specialTeamsCalibrationService = require('../services/specialTeamsCalibrationService')
const {
  WINNERS,
  createRatingEngineConfiguration,
} = require('../services/powerRatingEngine')
const {
  STARTING_STATE_POLICIES,
} = require('../calibration/calibrationIdentity')
const {
  captureCalibrationProductionSnapshot,
} = require('../calibration/calibrationProductionSnapshot')
const {
  BASELINE_IDENTITIES,
  CANDIDATE_TYPES,
} = require('../calibration/calibrationResultContract')
const {
  normalizeRequest,
  runCalibrationOrchestration,
} = require('../calibration/calibrationOrchestrator')
const {
  fixtureGames,
  fixtureTeams,
} = require('./fixtures/powerRatingReplayFixtures')

const EVALUATION_SEASON = '20242025'
const teamIds = [
  ...new Set(
    fixtureGames.flatMap((game) => [
      game.awayTeam.abbrev,
      game.homeTeam.abbrev,
    ]),
  ),
].sort()
const teams = teamIds.map((teamId) => ({
  abbreviation: teamId,
  teamId,
  teamName: fixtureTeams[teamId],
}))

const toSeasonGame = (game, seasonId, index) => ({
  ...game,
  awayTeam: { ...game.awayTeam },
  homeTeam: { ...game.homeTeam },
  id: `${seasonId}-${index + 1}`,
  season: Number(seasonId),
  startTimeUTC: `${Number(seasonId.slice(0, 4)) + 1}-01-${String(
    (index % 20) + 1,
  ).padStart(2, '0')}T${String(index % 12).padStart(2, '0')}:00:00.000Z`,
})

const evaluationGames = fixtureGames
  .slice(0, 24)
  .map((game, index) => toSeasonGame(game, EVALUATION_SEASON, index))

const makeHomeReferenceGames = (seasonId) => {
  let gameIndex = 0

  return teams.flatMap((home, homeIndex) =>
    Array.from({ length: 10 }, (_item, occurrence) => {
      const away = teams[(homeIndex + occurrence + 1) % teams.length]
      const homeWins = occurrence < homeIndex + 1
      const day = (gameIndex % 20) + 1
      const hour = gameIndex % 12
      const game = {
        awayTeam: {
          abbrev: away.teamId,
          name: { default: away.teamName },
          score: homeWins ? 1 : 3,
        },
        gameOutcome: { lastPeriodType: 'REG' },
        gameScheduleState: 'OK',
        gameState: 'OFF',
        gameType: 2,
        homeTeam: {
          abbrev: home.teamId,
          name: { default: home.teamName },
          score: homeWins ? 3 : 1,
        },
        id: `${seasonId}-ha-${gameIndex + 1}`,
        season: Number(seasonId),
        startTimeUTC: `${Number(seasonId.slice(0, 4)) + 1}-02-${String(
          day,
        ).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`,
      }

      gameIndex += 1
      return game
    }),
  )
}

const makeGameLoader = (targetGames = evaluationGames) => async (seasonIds) => {
  const gamesBySeason = new Map()
  const datasetsBySeason = new Map()

  seasonIds.forEach((seasonId) => {
    const games = seasonId === EVALUATION_SEASON
      ? targetGames
      : makeHomeReferenceGames(seasonId)

    gamesBySeason.set(seasonId, games)
    datasetsBySeason.set(seasonId, {
      completedGames: games.length,
      importedGames: games.length,
      seasonId,
      source: 'orchestrator-test',
      status: 'ready',
    })
  })

  return { datasetsBySeason, gamesBySeason }
}

const makeSpecialTeamsDataset = (seasonId, seasonIndex) => ({
  seasonId,
  status: 'ready',
  teamCount: teams.length,
  teams: teams.map((team, index) => ({
    rawPenaltyKillPercentage: 0.7 + (teams.length - index + seasonIndex) / 100,
    rawPowerPlayPercentage: 0.1 + (index + seasonIndex) / 100,
    sourceTeamAbbreviation: team.teamId,
    teamId: team.teamId,
    teamName: team.teamName,
  })),
})

const specialTeamsLoader = async (seasonIds) =>
  new Map(
    seasonIds.map((seasonId, index) => [
      seasonId,
      makeSpecialTeamsDataset(seasonId, index),
    ]),
  )

const orchestrationOptions = (overrides = {}) => ({
  historicalGamesLoader: makeGameLoader(),
  specialTeamsLoader,
  teamsProvider: async () => teams,
  ...overrides,
})

const canonicalRequest = (experiments, overrides = {}) => ({
  baselineMode: BASELINE_IDENTITIES.CANONICAL_BASE_MODEL_V1,
  evaluationSeasons: [EVALUATION_SEASON],
  experiments,
  startingStatePolicy:
    STARTING_STATE_POLICIES.FIXED_SPREAD_ALPHABETICAL,
  ...overrides,
})

const getCandidate = (result, candidateId) =>
  result.candidates.find((candidate) => candidate.candidateId === candidateId)

const getPreparedGames = () =>
  scheduleCalibrationService.preparePhase3ReplayGames(
    evaluationGames,
    EVALUATION_SEASON,
    teams,
  ).games

const getFixedStartingState = () =>
  buildStartingState({
    currentRatings: [],
    input: {
      startingRatings: {
        center: BASE_MODEL_V1.startingRatings.center,
        mode: STARTING_MODES.FIXED_SPREAD,
        spread: BASE_MODEL_V1.startingRatings.spread,
      },
    },
    orderingMode: 'historical_fallback',
    teams,
  })

const assertMetricParity = (candidate, referenceMetrics) => {
  assert.ok(
    Math.abs(candidate.metrics.pooledBrier - referenceMetrics.brierScore) <=
      1e-12,
  )
  assert.ok(
    Math.abs(candidate.metrics.logLoss - referenceMetrics.logLoss) <= 1e-12,
  )
  assert.ok(
    Math.abs(candidate.metrics.accuracy - referenceMetrics.accuracy.rate) <=
      1e-12,
  )
  assert.ok(
    Math.abs(
      candidate.metrics.ece - referenceMetrics.expectedCalibrationError,
    ) <= 1e-12,
  )
}

test('request contract requires explicit modes and normalizes explicit COMBINED components', () => {
  assert.throws(
    () => normalizeRequest({ evaluationSeasons: [EVALUATION_SEASON], experiments: [] }),
    /baselineMode must explicitly select/,
  )
  const normalized = normalizeRequest(
    canonicalRequest([
      {
        candidateId: 'combined',
        components: [
          {
            candidateId: 'special',
            overrides: { adjustment: 0.5, topBottomN: 2 },
            type: CANDIDATE_TYPES.SPECIAL_TEAMS,
          },
          {
            candidateId: 'ha',
            overrides: { adjustment: 0.5 },
            type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
          },
        ],
        type: CANDIDATE_TYPES.COMBINED,
      },
    ]),
  )

  assert.deepEqual(
    normalized.experiments[0].components.map((component) => component.type),
    [CANDIDATE_TYPES.SPECIAL_TEAMS, CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE],
  )
  assert.deepEqual(normalized.experiments[0].overrides, {
    SPECIAL_TEAMS: { adjustment: 0.5, topBottomN: 2 },
    TEAM_HOME_ADVANTAGE: { adjustment: 0.5 },
  })
  assert.throws(
    () =>
      normalizeRequest(
        canonicalRequest([
          {
            candidateId: 'combined',
            components: [{
              overrides: { adjustment: 0.5 },
              type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
            }],
            type: CANDIDATE_TYPES.COMBINED,
          },
        ]),
      ),
    /at least two feature components/,
  )
  assert.throws(
    () =>
      normalizeRequest(canonicalRequest([{
        candidateId: 'duplicate-family',
        components: [
          { overrides: { adjustment: 0.25 }, type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE },
          { overrides: { adjustment: 0.5 }, type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE },
        ],
        type: CANDIDATE_TYPES.COMBINED,
      }])),
    /unique feature-family component types/,
  )
  assert.throws(
    () =>
      normalizeRequest(canonicalRequest([{
        candidateId: 'nested',
        components: [
          { components: [], overrides: {}, type: CANDIDATE_TYPES.QUICK_REMATCH },
          { overrides: {}, type: CANDIDATE_TYPES.REST_FATIGUE },
        ],
        type: CANDIDATE_TYPES.COMBINED,
      }])),
    /Nested COMBINED components/,
  )
  assert.throws(
    () =>
      normalizeRequest(canonicalRequest([{
        candidateId: 'base-in-combined',
        components: [
          { overrides: { kFactor: 1.1 }, type: CANDIDATE_TYPES.BASE_MODEL },
          { overrides: {}, type: CANDIDATE_TYPES.REST_FATIGUE },
        ],
        type: CANDIDATE_TYPES.COMBINED,
      }])),
    /supported combinable feature family/,
  )
  assert.throws(
    () =>
      normalizeRequest(
        canonicalRequest([
          {
            candidateId: 'cross-feature',
            overrides: { maximumDays: 7 },
            type: CANDIDATE_TYPES.BASE_MODEL,
          },
        ]),
      ),
    /cross-feature overrides/,
  )
  assert.throws(
    () =>
      normalizeRequest(canonicalRequest([{
        candidateId: 'nested-cross-feature',
        components: [
          { overrides: { topBottomN: 2 }, type: CANDIDATE_TYPES.QUICK_REMATCH },
          { overrides: { adjustment: 0.5 }, type: CANDIDATE_TYPES.SPECIAL_TEAMS },
        ],
        type: CANDIDATE_TYPES.COMBINED,
      }])),
    /cross-feature overrides/,
  )
})

test('orchestrator matches all existing phase runners for representative isolated candidates', async () => {
  const experiments = [
    {
      candidateId: 'base-scale-17',
      label: 'Base scale 17',
      overrides: { probabilityScale: 17 },
      type: CANDIDATE_TYPES.BASE_MODEL,
    },
    {
      candidateId: 'ha-zero',
      label: 'HA zero control',
      overrides: { adjustment: 0 },
      type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
    },
    {
      candidateId: 'ha-half',
      label: 'HA symmetric 0.5',
      overrides: { adjustment: 0.5 },
      type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
    },
    {
      candidateId: 'rest-coherent',
      label: 'Rest coherent',
      overrides: {
        backToBack: -0.75,
        backToBackTravel: -1.25,
        threeInFour: -0.5,
        wellRested: 0,
      },
      type: CANDIDATE_TYPES.REST_FATIGUE,
    },
    {
      candidateId: 'quick-seven',
      label: 'Quick seven days',
      overrides: {
        enabled: true,
        loserAdjustment: 0.25,
        maximumDays: 7,
      },
      type: CANDIDATE_TYPES.QUICK_REMATCH,
    },
    {
      candidateId: 'special-two',
      label: 'Special Teams 2 / 0.5',
      overrides: { adjustment: 0.5, topBottomN: 2 },
      type: CANDIDATE_TYPES.SPECIAL_TEAMS,
    },
  ]
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest(experiments),
    orchestrationOptions(),
  )
  const preparedGames = getPreparedGames()
  const startingState = getFixedStartingState()
  const engineConfiguration = createRatingEngineConfiguration({
    kFactor: BASE_MODEL_V1.kFactor,
    overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
    regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
    shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  })
  const teamsById = new Map(teams.map((team) => [team.teamId, team]))
  const baseReplay = replayDataset({
    includedGames: preparedGames.map((game) => ({
      awayTeam: teamsById.get(game.awayTeamId),
      game: { id: game.gameId },
      homeTeam: teamsById.get(game.homeTeamId),
      resultType: game.resultType,
      winner: game.homeScore > game.awayScore ? WINNERS.HOME : WINNERS.AWAY,
    })),
    input: {
      configuration: engineConfiguration,
      homeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      probabilityScale: 17,
    },
    ratingState: startingState,
  })
  assertMetricParity(
    getCandidate(result, 'base-scale-17'),
    calculateMetrics(baseReplay.predictions),
  )

  const allGameSeasons = [
    EVALUATION_SEASON,
    ...homeAdvantageCalibrationService.getPriorSeasonIds(EVALUATION_SEASON),
  ]
  const { gamesBySeason } = await makeGameLoader()(allGameSeasons)
  const snapshots = homeAdvantageCalibrationService.buildHistoricalTierSnapshots({
    gamesBySeason,
    teams,
  })
  const snapshot = snapshots.find(
    (item) => item.targetSeasonId === EVALUATION_SEASON,
  )

  ;[0, 0.5].forEach((adjustment) => {
    const reference = homeAdvantageCalibrationService.replaySeasonWithTierAdjustment({
      adjustment,
      games: evaluationGames,
      snapshot,
      teams,
    })

    assertMetricParity(
      getCandidate(result, adjustment === 0 ? 'ha-zero' : 'ha-half'),
      reference.metrics,
    )
  })

  const scheduleFacts = scheduleCalibrationService.buildScheduleFacts(
    preparedGames,
    [7],
  )
  const restReference = scheduleCalibrationService.replaySeason({
    configuration: {
      quickRematch: { enabled: false },
      restFatigue: {
        adjustments: {
          '3_games_in_4_days': -0.5,
          back_to_back: -0.75,
          back_to_back_travel: -1.25,
          well_rested: 0,
        },
        includeWellRested: false,
      },
    },
    factsByGameId: scheduleFacts,
    games: preparedGames,
    teams,
  })
  const quickReference = scheduleCalibrationService.replaySeason({
    configuration: {
      quickRematch: {
        enabled: true,
        loserAdjustment: 0.25,
        maximumDays: 7,
      },
      restFatigue: { adjustments: {} },
    },
    factsByGameId: scheduleFacts,
    games: preparedGames,
    teams,
  })

  assertMetricParity(getCandidate(result, 'rest-coherent'), restReference.metrics)
  assertMetricParity(getCandidate(result, 'quick-seven'), quickReference.metrics)

  const referenceSeasonIds = specialTeamsCalibrationService.getPriorSeasonIds(
    EVALUATION_SEASON,
  )
  const specialTeamsDatasets = await specialTeamsLoader(referenceSeasonIds)
  const specialTeamsReference =
    specialTeamsCalibrationService.buildFrozenSpecialTeamsReference({
      seasonDatasets: specialTeamsDatasets,
      targetSeasonId: EVALUATION_SEASON,
      targetTeamIds: teamIds,
    })
  const specialFacts = specialTeamsCalibrationService.buildMatchupFacts(
    preparedGames,
    specialTeamsReference,
    [2],
  )
  const specialReference =
    specialTeamsCalibrationService.replaySpecialTeamsSeason({
      adjustment: 0.5,
      factsByGameId: specialFacts.get(2),
      games: preparedGames,
      teams,
    })

  assertMetricParity(getCandidate(result, 'special-two'), specialReference.metrics)
  assert.equal(result.baseline.candidateType, CANDIDATE_TYPES.BASELINE)
  const resultTypes = result.baseline.diagnostics.replay.resultTypes

  assert.ok(resultTypes.regulation > 0)
  assert.ok(resultTypes.overtime > 0)
  assert.ok(resultTypes.shootout > 0)
  assert.equal(
    resultTypes.regulation + resultTypes.overtime + resultTypes.shootout,
    result.evaluationContext.gameCount,
  )
  result.candidates.forEach((candidate) => {
    assert.equal(candidate.diagnostics.comparability.comparable, true)
    assert.equal(candidate.metadata.datasetSignature, result.evaluationContext.datasetSignature)
    assert.equal(candidate.evaluation.games, result.evaluationContext.gameCount)
    assert.deepEqual(candidate.evaluation.seasons, [EVALUATION_SEASON])
  })
})

test('COMBINED candidates compose shared features deterministically and expose descriptive component diagnostics', async () => {
  const isolated = [
    {
      candidateId: 'ha-half',
      label: 'HA half',
      overrides: { adjustment: 0.5 },
      type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
    },
    {
      candidateId: 'rest-coherent',
      label: 'Rest coherent',
      overrides: {
        backToBack: -0.75,
        backToBackTravel: -1.25,
        threeInFour: -0.5,
        wellRested: 0,
      },
      type: CANDIDATE_TYPES.REST_FATIGUE,
    },
    {
      candidateId: 'quick-seven',
      label: 'Quick seven',
      overrides: { loserAdjustment: 0.25, maximumDays: 7 },
      type: CANDIDATE_TYPES.QUICK_REMATCH,
    },
    {
      candidateId: 'special-two',
      label: 'Special two',
      overrides: { adjustment: 0.5, topBottomN: 2 },
      type: CANDIDATE_TYPES.SPECIAL_TEAMS,
    },
  ]
  const components = isolated.map((candidate) => ({
    candidateId: candidate.candidateId,
    label: candidate.label,
    overrides: candidate.overrides,
    type: candidate.type,
  }))
  const combined = {
    candidateId: 'combined-all',
    components: [...components].reverse(),
    label: 'All selected features',
    type: CANDIDATE_TYPES.COMBINED,
  }
  const missingReferences = {
    candidateId: 'combined-inline-only',
    components: components.slice(0, 2).map((component) => ({
      ...component,
      candidateId: undefined,
    })),
    type: CANDIDATE_TYPES.COMBINED,
  }
  const restSpecial = {
    candidateId: 'combined-rest-special',
    components: [components[1], components[3]],
    type: CANDIDATE_TYPES.COMBINED,
  }
  const first = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      ...isolated,
      combined,
      missingReferences,
      restSpecial,
    ]),
    orchestrationOptions(),
  )
  const reversed = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      missingReferences,
      { ...restSpecial, components: [...restSpecial.components].reverse() },
      { ...combined, components: [...components] },
      ...[...isolated].reverse(),
    ]),
    orchestrationOptions(),
  )
  const candidate = getCandidate(first, combined.candidateId)
  const reversedCandidate = getCandidate(reversed, combined.candidateId)
  const expectedTypes = [
    CANDIDATE_TYPES.QUICK_REMATCH,
    CANDIDATE_TYPES.REST_FATIGUE,
    CANDIDATE_TYPES.SPECIAL_TEAMS,
    CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
  ]

  assert.deepEqual(
    candidate.components.map((component) => component.type),
    expectedTypes,
  )
  assert.deepEqual(Object.keys(candidate.overrides), expectedTypes)
  assert.equal(candidate.configuration.features.quickRematch.enabled, true)
  assert.equal(candidate.configuration.features.restFatigue.enabled, true)
  assert.equal(candidate.configuration.features.specialTeams.enabled, true)
  assert.equal(candidate.configuration.features.teamHomeAdvantage.enabled, true)
  assert.ok(candidate.metadata.configurationSignature)
  assert.equal(
    candidate.metadata.configurationSignature,
    reversedCandidate.metadata.configurationSignature,
  )
  assert.deepEqual(candidate.metrics, reversedCandidate.metrics)
  assert.deepEqual(candidate.perSeason, reversedCandidate.perSeason)
  assert.deepEqual(candidate.components, reversedCandidate.components)
  assert.equal(first.runId, reversed.runId)
  assert.deepEqual(first.ranking, reversed.ranking)

  const seasonDiagnostics = candidate.diagnostics.replay
    .seasons[EVALUATION_SEASON]
  assert.equal(
    Object.values(seasonDiagnostics.restFatigue.appliedConditions)
      .reduce((sum, count) => sum + count, 0),
    first.evaluationContext.gameCount * 2,
  )
  assert.ok(seasonDiagnostics.quickRematch.occurrences >= 0)
  assert.equal(candidate.evaluation.games, first.baseline.evaluation.games)
  assert.deepEqual(candidate.evaluation.seasons, first.baseline.evaluation.seasons)
  assert.equal(
    candidate.metadata.datasetSignature,
    first.baseline.metadata.datasetSignature,
  )
  assert.equal(
    candidate.metadata.startingStateSignature,
    first.baseline.metadata.startingStateSignature,
  )
  assert.equal(
    candidate.metadata.baselineSignature,
    first.baseline.metadata.baselineSignature,
  )

  const availableComponents = isolated.map((experiment) =>
    getCandidate(first, experiment.candidateId))
  const expectedBest = [...availableComponents].sort(
    (left, right) => left.metrics.pooledBrier - right.metrics.pooledBrier,
  )[0]
  const interaction = candidate.diagnostics.interaction

  assert.deepEqual(
    interaction.componentCandidateIds,
    candidate.components.map((component) => component.candidateId),
  )
  assert.equal(interaction.bestComponentCandidateId, expectedBest.candidateId)
  assert.equal(interaction.bestComponentBrier, expectedBest.metrics.pooledBrier)
  assert.equal(
    interaction.combinedVsBestComponentDeltaBrier,
    candidate.metrics.pooledBrier - expectedBest.metrics.pooledBrier,
  )
  assert.match(interaction.interpretation, /descriptive_only/)

  const inlineOnly = getCandidate(first, 'combined-inline-only')

  assert.deepEqual(inlineOnly.diagnostics.interaction.componentCandidateIds, [])
  assert.equal(inlineOnly.diagnostics.interaction.bestComponentBrier, null)
  assert.equal(
    inlineOnly.diagnostics.interaction.combinedVsBestComponentDeltaBrier,
    null,
  )
  assert.equal(inlineOnly.configuration.features.teamHomeAdvantage.enabled, true)
  assert.equal(inlineOnly.configuration.features.restFatigue.enabled, true)
  assert.equal(first.diagnostics.productionWrites, false)
  const restSpecialCandidate = getCandidate(first, restSpecial.candidateId)

  assert.equal(restSpecialCandidate.configuration.features.restFatigue.enabled, true)
  assert.equal(restSpecialCandidate.configuration.features.specialTeams.enabled, true)
  assert.equal(restSpecialCandidate.evaluation.games, first.baseline.evaluation.games)
  assert.equal(restSpecialCandidate.diagnostics.comparability.comparable, true)
})

test('a disabled second component preserves exact single-family replay equivalence', async () => {
  const rest = {
    candidateId: 'rest-only',
    overrides: {
      backToBack: -0.75,
      backToBackTravel: -1.25,
      threeInFour: -0.5,
    },
    type: CANDIDATE_TYPES.REST_FATIGUE,
  }
  const combined = {
    candidateId: 'rest-plus-disabled-quick',
    components: [
      {
        candidateId: rest.candidateId,
        overrides: rest.overrides,
        type: rest.type,
      },
      {
        overrides: { enabled: false },
        type: CANDIDATE_TYPES.QUICK_REMATCH,
      },
    ],
    type: CANDIDATE_TYPES.COMBINED,
  }
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([rest, combined]),
    orchestrationOptions(),
  )
  const restCandidate = getCandidate(result, rest.candidateId)
  const combinedCandidate = getCandidate(result, combined.candidateId)

  assert.deepEqual(combinedCandidate.metrics, restCandidate.metrics)
  assert.deepEqual(combinedCandidate.perSeason, restCandidate.perSeason)
  assert.deepEqual(
    combinedCandidate.diagnostics.replay,
    restCandidate.diagnostics.replay,
  )
})

test('Rest/Fatigue stays mutually exclusive while Quick Rematch remains independently additive', async () => {
  const firstGame = toSeasonGame(fixtureGames[0], EVALUATION_SEASON, 0)
  const rematchGames = [
    firstGame,
    {
      ...firstGame,
      awayTeam: { ...firstGame.awayTeam },
      homeTeam: { ...firstGame.homeTeam },
      id: `${EVALUATION_SEASON}-rematch-2`,
      startTimeUTC: `${Number(EVALUATION_SEASON.slice(0, 4)) + 1}-01-02T01:00:00.000Z`,
    },
  ]
  const rest = {
    candidateId: 'rest-rematch',
    overrides: {
      backToBack: -0.75,
      backToBackTravel: -1.25,
      threeInFour: -0.5,
    },
    type: CANDIDATE_TYPES.REST_FATIGUE,
  }
  const quick = {
    candidateId: 'quick-rematch',
    overrides: { loserAdjustment: 0.5, maximumDays: 7 },
    type: CANDIDATE_TYPES.QUICK_REMATCH,
  }
  const combined = {
    candidateId: 'rest-and-quick-rematch',
    components: [
      { candidateId: rest.candidateId, overrides: rest.overrides, type: rest.type },
      { candidateId: quick.candidateId, overrides: quick.overrides, type: quick.type },
    ],
    type: CANDIDATE_TYPES.COMBINED,
  }
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([rest, quick, combined]),
    orchestrationOptions({ historicalGamesLoader: makeGameLoader(rematchGames) }),
  )
  const restDiagnostics = getCandidate(result, rest.candidateId)
    .diagnostics.replay.seasons[EVALUATION_SEASON]
  const quickDiagnostics = getCandidate(result, quick.candidateId)
    .diagnostics.replay.seasons[EVALUATION_SEASON]
  const combinedDiagnostics = getCandidate(result, combined.candidateId)
    .diagnostics.replay.seasons[EVALUATION_SEASON]

  assert.deepEqual(
    combinedDiagnostics.restFatigue,
    restDiagnostics.restFatigue,
  )
  assert.deepEqual(
    combinedDiagnostics.quickRematch,
    quickDiagnostics.quickRematch,
  )
  assert.ok(combinedDiagnostics.quickRematch.occurrences > 0)
  assert.equal(
    Object.values(combinedDiagnostics.restFatigue.appliedConditions)
      .reduce((sum, count) => sum + count, 0),
    rematchGames.length * 2,
  )
})

test('changing one COMBINED component changes its deterministic configuration identity', async () => {
  const makeCombined = (adjustment) => ({
    candidateId: `combined-ha-${adjustment}`,
    components: [
      {
        overrides: { adjustment },
        type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
      },
      {
        overrides: { enabled: false },
        type: CANDIDATE_TYPES.QUICK_REMATCH,
      },
    ],
    type: CANDIDATE_TYPES.COMBINED,
  })
  const first = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([makeCombined(0.25), makeCombined(0.5)]),
    orchestrationOptions(),
  )
  const repeated = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([makeCombined(0.25), makeCombined(0.5)]),
    orchestrationOptions(),
  )
  const lower = getCandidate(first, 'combined-ha-0.25')
  const higher = getCandidate(first, 'combined-ha-0.5')

  assert.notEqual(
    lower.metadata.configurationSignature,
    higher.metadata.configurationSignature,
  )
  assert.notDeepEqual(lower.metrics, higher.metrics)
  assert.equal(
    lower.metadata.configurationSignature,
    getCandidate(repeated, lower.candidateId).metadata.configurationSignature,
  )
  assert.deepEqual(lower.metrics, getCandidate(repeated, lower.candidateId).metrics)
})

test('frozen feature construction excludes target-season Team HA and Special Teams data', async () => {
  const experiments = [
    {
      candidateId: 'ha',
      overrides: { adjustment: 0.5 },
      type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
    },
    {
      candidateId: 'special',
      overrides: { adjustment: 0.5, topBottomN: 2 },
      type: CANDIDATE_TYPES.SPECIAL_TEAMS,
    },
    {
      candidateId: 'combined-ha-special',
      components: [
        {
          candidateId: 'ha',
          overrides: { adjustment: 0.5 },
          type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
        },
        {
          candidateId: 'special',
          overrides: { adjustment: 0.5, topBottomN: 2 },
          type: CANDIDATE_TYPES.SPECIAL_TEAMS,
        },
      ],
      type: CANDIDATE_TYPES.COMBINED,
    },
  ]
  const first = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest(experiments),
    orchestrationOptions(),
  )
  const flippedTargetGames = evaluationGames.map((game) => ({
    ...game,
    awayTeam: { ...game.awayTeam, score: game.homeTeam.score },
    homeTeam: { ...game.homeTeam, score: game.awayTeam.score },
  }))
  const second = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest(experiments),
    orchestrationOptions({
      historicalGamesLoader: makeGameLoader(flippedTargetGames),
    }),
  )
  const firstHa = first.evaluationContext.featureState.teamHomeAdvantage[EVALUATION_SEASON]
  const firstSpecial = first.evaluationContext.featureState.specialTeams[EVALUATION_SEASON]
  const secondHa = second.evaluationContext.featureState.teamHomeAdvantage[EVALUATION_SEASON]
  const secondSpecial = second.evaluationContext.featureState.specialTeams[EVALUATION_SEASON]

  assert.equal(firstHa.targetSeasonIncluded, false)
  assert.equal(firstSpecial.targetSeasonIncluded, false)
  assert.equal(firstHa.assignedBeforeReplay, true)
  assert.equal(firstSpecial.frozenBeforeTargetSeason, true)
  assert.equal(firstHa.sourceSeasonIds.includes(EVALUATION_SEASON), false)
  assert.equal(firstSpecial.sourceSeasonIds.includes(EVALUATION_SEASON), false)
  assert.equal(firstHa.snapshotSignature, secondHa.snapshotSignature)
  assert.equal(firstSpecial.snapshotSignature, secondSpecial.snapshotSignature)
  assert.equal(
    getCandidate(first, 'combined-ha-special').diagnostics.executionStatus,
    'completed',
  )
  assert.equal(
    getCandidate(first, 'combined-ha-special').metadata.configurationSignature,
    getCandidate(second, 'combined-ha-special').metadata.configurationSignature,
  )
})

test('Rest/Fatigue priority remains mutually exclusive in orchestration', async () => {
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      {
        candidateId: 'rest',
        overrides: {
          backToBack: -0.75,
          backToBackTravel: -1.25,
          threeInFour: -0.5,
          wellRested: 0.25,
        },
        type: CANDIDATE_TYPES.REST_FATIGUE,
      },
    ]),
    orchestrationOptions(),
  )
  const counts = getCandidate(result, 'rest').diagnostics.replay
    .seasons[EVALUATION_SEASON].restFatigue.appliedConditions

  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    result.evaluationContext.gameCount * 2,
  )
})

test('candidate configurations are isolated and candidate order cannot change results', async () => {
  const candidateA = {
    candidateId: 'a-rest',
    overrides: { backToBack: -1, backToBackTravel: -2, threeInFour: -0.5 },
    type: CANDIDATE_TYPES.REST_FATIGUE,
  }
  const candidateB = {
    candidateId: 'b-quick',
    overrides: { loserAdjustment: 0.5, maximumDays: 7 },
    type: CANDIDATE_TYPES.QUICK_REMATCH,
  }
  const first = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([candidateA, candidateB]),
    orchestrationOptions(),
  )
  const reversed = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([candidateB, candidateA]),
    orchestrationOptions(),
  )

  ;[candidateA.candidateId, candidateB.candidateId].forEach((candidateId) => {
    assert.deepEqual(
      getCandidate(first, candidateId).metrics,
      getCandidate(reversed, candidateId).metrics,
    )
    assert.deepEqual(
      getCandidate(first, candidateId).perSeason,
      getCandidate(reversed, candidateId).perSeason,
    )
  })
  assert.deepEqual(first.ranking, reversed.ranking)
  assert.equal(first.runId, reversed.runId)
  assert.deepEqual(
    first.ranking.comparable.map((candidate) => candidate.pooledBrier),
    [...first.ranking.comparable]
      .map((candidate) => candidate.pooledBrier)
      .sort((left, right) => left - right),
  )
})

test('historical retrieval order cannot change chronological replay results', async () => {
  const request = canonicalRequest([
    {
      candidateId: 'disabled-rest',
      overrides: {
        backToBack: -5,
        enabled: false,
        threeInFour: -5,
      },
      type: CANDIDATE_TYPES.REST_FATIGUE,
    },
  ])
  const chronological = await runCalibrationOrchestration(
    'user-1',
    request,
    orchestrationOptions(),
  )
  const reversed = await runCalibrationOrchestration(
    'user-1',
    request,
    orchestrationOptions({
      historicalGamesLoader: makeGameLoader([...evaluationGames].reverse()),
    }),
  )

  assert.deepEqual(chronological.baseline.metrics, reversed.baseline.metrics)
  assert.deepEqual(
    getCandidate(chronological, 'disabled-rest').metrics,
    chronological.baseline.metrics,
  )
  assert.deepEqual(
    getCandidate(chronological, 'disabled-rest').metrics,
    getCandidate(reversed, 'disabled-rest').metrics,
  )
  assert.equal(chronological.evaluationContext.gameIdSignature,
    reversed.evaluationContext.gameIdSignature)
  assert.equal(Object.isFrozen(chronological), true)
  assert.equal(Object.isFrozen(chronological.evaluationContext.includedGameIds), true)
})

test('team-map Home Advantage candidates do not prepare unused tier references', async () => {
  let requestedSeasonIds = null
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      {
        candidateId: 'team-map',
        overrides: { teamAdjustments: { BOS: 0.5, TOR: -0.25 } },
        type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
      },
    ]),
    orchestrationOptions({
      historicalGamesLoader: async (seasonIds) => {
        requestedSeasonIds = seasonIds
        return makeGameLoader()(seasonIds)
      },
    }),
  )

  assert.deepEqual(requestedSeasonIds, [EVALUATION_SEASON])
  assert.equal(getCandidate(result, 'team-map').diagnostics.executionStatus,
    'completed')
  assert.equal(
    result.evaluationContext.featureState.teamHomeAdvantage[EVALUATION_SEASON],
    null,
  )
})

test('CURRENT_PRODUCTION captures one immutable snapshot for the whole run', async () => {
  const repository = {
    engine: {
      ...BASE_MODEL_V1,
      maximumGoaliePenalty: -4,
      maximumPlayerInjuryPenalty: -2.5,
      specialTeamsAdjustment: 0.5,
      specialTeamsAlertsEnabled: false,
      specialTeamsMode: 'off',
      specialTeamsRankThreshold: 6,
    },
    ratings: teams.map((team, index) => ({
      baseRating: 50 - index,
      homeAdjustment: index === 0 ? 0.5 : 0,
      teamId: team.teamId,
    })),
    schedule: {
      backToBackAdjustment: -0.75,
      backToBackEnabled: true,
      backToBackTravelAdjustment: -1.25,
      backToBackTravelEnabled: true,
      quickRematchEnabled: true,
      quickRematchLoserAdjustment: 0.25,
      quickRematchMaximumDays: 7,
      restFatigueEnabled: true,
      threeInFourAdjustment: -0.5,
      threeInFourEnabled: true,
      wellRestedAdjustment: 0,
      wellRestedEnabled: false,
    },
  }
  const captured = await captureCalibrationProductionSnapshot('user-1', {
    clock: () => new Date('2026-08-26T00:00:00.000Z'),
    engineSettingsProvider: async () => repository.engine,
    powerRatingsProvider: async () => repository.ratings,
    scheduleSettingsProvider: async () => repository.schedule,
  })
  let snapshotCalls = 0
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest(
      [
        {
          candidateId: 'base-a',
          overrides: { kFactor: 1.1 },
          type: CANDIDATE_TYPES.BASE_MODEL,
        },
        {
          candidateId: 'base-b',
          overrides: { probabilityScale: 18 },
          type: CANDIDATE_TYPES.BASE_MODEL,
        },
        {
          candidateId: 'combined-frozen-snapshot',
          components: [
            {
              overrides: { adjustment: 0.5 },
              type: CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE,
            },
            {
              overrides: { loserAdjustment: 0.5, maximumDays: 7 },
              type: CANDIDATE_TYPES.QUICK_REMATCH,
            },
          ],
          type: CANDIDATE_TYPES.COMBINED,
        },
      ],
      { baselineMode: BASELINE_IDENTITIES.CURRENT_PRODUCTION },
    ),
    orchestrationOptions({
      productionSnapshotProvider: async () => {
        snapshotCalls += 1
        repository.engine.kFactor = 99
        repository.schedule.quickRematchLoserAdjustment = 99
        return captured
      },
    }),
  )

  assert.equal(snapshotCalls, 1)
  assert.equal(result.evaluationContext.productionSnapshotId, captured.productionSnapshotId)
  assert.equal(result.baseline.metadata.productionSnapshotId, captured.productionSnapshotId)
  result.candidates.forEach((candidate) => {
    assert.equal(candidate.metadata.productionSnapshotId, captured.productionSnapshotId)
    assert.equal(candidate.baseline.identity, BASELINE_IDENTITIES.CURRENT_PRODUCTION)
  })
  assert.equal(result.diagnostics.productionWrites, false)
})

test('starting-state changes are preserved as non-comparable and excluded from ranking', async () => {
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      {
        candidateId: 'different-start',
        overrides: { startingRatings: { center: 46, spread: 4 } },
        type: CANDIDATE_TYPES.BASE_MODEL,
      },
      {
        candidateId: 'same-start',
        overrides: { probabilityScale: 19 },
        type: CANDIDATE_TYPES.BASE_MODEL,
      },
    ]),
    orchestrationOptions(),
  )
  const different = getCandidate(result, 'different-start')

  assert.equal(different.diagnostics.executionStatus, 'completed')
  assert.equal(different.diagnostics.comparability.comparable, false)
  assert.equal(
    different.diagnostics.comparability.warnings.some(
      (warning) => warning.code === 'STARTING_STATE_SIGNATURE_MISMATCH',
    ),
    true,
  )
  assert.equal(
    result.ranking.comparable.some(
      (candidate) => candidate.candidateId === 'different-start',
    ),
    false,
  )
  assert.equal(
    result.ranking.unranked.some(
      (candidate) => candidate.candidateId === 'different-start',
    ),
    true,
  )
  assert.equal(
    result.ranking.comparable.some(
      (candidate) => candidate.candidateId === 'same-start',
    ),
    true,
  )
})

test('candidate-level failures remain explicit without omitting completed candidates', async () => {
  const result = await runCalibrationOrchestration(
    'user-1',
    canonicalRequest([
      {
        candidateId: 'valid',
        overrides: { probabilityScale: 18 },
        type: CANDIDATE_TYPES.BASE_MODEL,
      },
      {
        candidateId: 'invalid-window',
        overrides: { maximumDays: 2.5 },
        type: CANDIDATE_TYPES.QUICK_REMATCH,
      },
    ]),
    orchestrationOptions(),
  )
  const valid = getCandidate(result, 'valid')
  const invalid = getCandidate(result, 'invalid-window')

  assert.equal(valid.diagnostics.executionStatus, 'completed')
  assert.equal(invalid.diagnostics.executionStatus, 'failed')
  assert.equal(invalid.diagnostics.comparability.comparable, false)
  assert.equal(invalid.metrics.pooledBrier, null)
  assert.equal(
    result.ranking.unranked.some(
      (candidate) => candidate.candidateId === 'invalid-window',
    ),
    true,
  )
})
