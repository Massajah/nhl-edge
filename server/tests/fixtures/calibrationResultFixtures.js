const makeSeason = ({ accuracy, brierScore, ece, games, logLoss, seasonId }) => ({
  games,
  metrics: {
    accuracy,
    brierScore,
    expectedCalibrationError: ece,
    logLoss,
  },
  seasonId,
})

const baseModelResultFixture = {
  aggregate: {
    averageSeasonBrier: 0.214,
    worstSeason: { brierScore: 0.218, seasonId: '20242025' },
  },
  baselineComparison: {
    constant50: 'better',
    historicalHomeRate: 'better',
  },
  dataset: {
    gamesFound: 204,
    gamesIncluded: 200,
    gamesSkipped: 4,
  },
  diagnostics: {
    centerInvariance: { passed: true },
    productionWrites: false,
    ratingResetBetweenSeasons: true,
  },
  displayLabel: 'Aggregate · 2 seasons · Fixed spread · Scale 24',
  metrics: {
    accuracy: { correct: 121, rate: 0.605 },
    brierScore: 0.2135,
    expectedCalibrationError: 0.028,
    logLoss: 0.617,
  },
  modelVersion: 'base-model-v1',
  parameters: {
    configuration: {
      kFactor: 1.2,
      overtimeMultiplier: 0.7,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
    homeAdvantage: 4,
    probabilityScale: 24,
    startingRatings: {
      center: 50,
      mode: 'fixed_spread',
      spread: 10,
    },
  },
  sanityBaselines: {
    constant50: { brierScore: 0.25, logLoss: 0.693147 },
    historicalHomeRate: { brierScore: 0.2475, logLoss: 0.688139 },
  },
  seasonResults: [
    {
      dataset: { gamesIncluded: 95 },
      metrics: {
        accuracy: { correct: 58, rate: 0.610526 },
        brierScore: 0.21,
        expectedCalibrationError: 0.025,
        logLoss: 0.61,
      },
      seasonId: '20232024',
    },
    {
      dataset: { gamesIncluded: 105 },
      metrics: {
        accuracy: { correct: 63, rate: 0.6 },
        brierScore: 0.218,
        expectedCalibrationError: 0.031,
        logLoss: 0.624,
      },
      seasonId: '20242025',
    },
  ],
  stability: { level: 'stable' },
}

const homeAdvantageResultFixture = {
  comparisons: [
    {
      adjustment: 0,
      averageSeasonBrier: 0.22,
      delta: { brierScore: 0, logLoss: 0 },
      effectiveHomeAdvantage: { normal: 4, strong: 4, weak: 4 },
      metrics: {
        accuracy: 0.59,
        brierScore: 0.221,
        expectedCalibrationError: 0.034,
        logLoss: 0.638,
      },
      seasonResults: [
        makeSeason({
          accuracy: 0.58,
          brierScore: 0.218,
          ece: 0.03,
          games: 100,
          logLoss: 0.63,
          seasonId: '20232024',
        }),
        makeSeason({
          accuracy: 0.6,
          brierScore: 0.222,
          ece: 0.038,
          games: 110,
          logLoss: 0.645,
          seasonId: '20242025',
        }),
      ],
      seasonsBeatingBaseline: 0,
      stability: { level: 'stable' },
      worstSeason: { brierScore: 0.222, seasonId: '20242025' },
    },
    {
      adjustment: 2,
      averageSeasonBrier: 0.216,
      delta: { brierScore: -0.005, logLoss: -0.008 },
      effectiveHomeAdvantage: { normal: 4, strong: 6, weak: 2 },
      metrics: {
        accuracy: 0.61,
        brierScore: 0.216,
        expectedCalibrationError: 0.027,
        logLoss: 0.63,
      },
      seasonResults: [
        makeSeason({
          accuracy: 0.6,
          brierScore: 0.214,
          ece: 0.026,
          games: 100,
          logLoss: 0.625,
          seasonId: '20232024',
        }),
        makeSeason({
          accuracy: 0.62,
          brierScore: 0.218,
          ece: 0.028,
          games: 110,
          logLoss: 0.635,
          seasonId: '20242025',
        }),
      ],
      seasonsBeatingBaseline: 2,
      stability: { level: 'stable' },
      worstSeason: { brierScore: 0.218, seasonId: '20242025' },
    },
  ],
  currentAnalysis: {
    tierSizes: { normal: 16, strong: 8, weak: 8 },
    tiers: { BOS: 'strong', SJS: 'weak' },
  },
  diagnostics: {
    baseHomeAdvantage: 4,
    classificationFrozenBeforeReplay: true,
    productionWrites: false,
    testedAdjustments: [0, 2],
  },
  modelVersion: 'base-model-v1',
  snapshots: [
    {
      sourceSeasonIds: ['20202021', '20212022', '20222023'],
      targetSeasonId: '20232024',
      tierSizes: { normal: 16, strong: 8, weak: 8 },
    },
  ],
}

const scheduleControl = {
  adjustment: 0,
  appliedRestFatigueCounts: { road_back_to_back: 0 },
  averageSeasonBrier: 0.225,
  configuration: {
    restFatigue: { adjustments: { road_back_to_back: 0 } },
  },
  gamesAffected: 0,
  gamesAffectedPercentage: 0,
  matchedRestFatigueCounts: { road_back_to_back: 24 },
  metrics: {
    accuracy: 0.58,
    brierScore: 0.225,
    expectedCalibrationError: 0.04,
    logLoss: 0.65,
  },
  occurrences: 24,
  seasonResults: [
    {
      ...makeSeason({
        accuracy: 0.58,
        brierScore: 0.225,
        ece: 0.04,
        games: 120,
        logLoss: 0.65,
        seasonId: '20242025',
      }),
      priorityCounts: { road_back_to_back: 0 },
    },
  ],
  stability: { level: 'not_assessed' },
  worstSeason: { brierScore: 0.225, seasonId: '20242025' },
}

const scheduleSelected = {
  ...scheduleControl,
  adjustment: -2,
  appliedRestFatigueCounts: { road_back_to_back: 24 },
  averageSeasonBrier: 0.219,
  configuration: {
    restFatigue: { adjustments: { road_back_to_back: -2 } },
  },
  delta: { brierScore: -0.006, logLoss: -0.01 },
  gamesAffected: 24,
  gamesAffectedPercentage: 0.2,
  metrics: {
    accuracy: 0.6,
    brierScore: 0.219,
    expectedCalibrationError: 0.032,
    logLoss: 0.64,
  },
  seasonResults: [
    {
      ...makeSeason({
        accuracy: 0.6,
        brierScore: 0.219,
        ece: 0.032,
        games: 120,
        logLoss: 0.64,
        seasonId: '20242025',
      }),
      priorityCounts: { road_back_to_back: 24 },
    },
  ],
  worstSeason: { brierScore: 0.219, seasonId: '20242025' },
}

const quickRematchControl = {
  ...scheduleControl,
  adjustment: 0,
  configuration: { quickRematch: { enabled: false } },
  disabled: true,
  occurrenceRate: 0.1,
  occurrences: 12,
  windowDays: null,
}

const quickRematchSelected = {
  ...scheduleSelected,
  adjustment: -1,
  configuration: {
    quickRematch: { enabled: true, loserAdjustment: -1, maximumDays: 14 },
  },
  disabled: false,
  occurrenceRate: 0.1,
  occurrences: 12,
  windowDays: 14,
}

const scheduleResultFixture = {
  combinedRestFatigueResult: {
    appliedCounts: { road_back_to_back: 24 },
    configurationSnapshot: {
      adjustments: { road_back_to_back: -2 },
      includeWellRested: false,
    },
    matchedCounts: { road_back_to_back: 24 },
    noAdjustments: scheduleControl,
    priorityCounts: { road_back_to_back: 24 },
    selected: scheduleSelected,
  },
  diagnostics: {
    precedence: ['road_back_to_back'],
    productionWrites: false,
    selectedSeasonIds: ['20242025'],
  },
  individualResults: {
    road_back_to_back: {
      comparisons: [scheduleControl, scheduleSelected],
      definition: 'Road games on zero rest.',
      label: 'Road back-to-back',
      ruleId: 'road_back_to_back',
    },
  },
  modelVersion: 'base-model-v1',
  quickRematchResult: {
    comparisons: [quickRematchControl, quickRematchSelected],
    definition: 'A recent rematch adjustment for the prior loser.',
  },
}

const specialTeamsResultFixture = {
  baseline: {
    metrics: {
      accuracy: 0.57,
      brierScore: 0.23,
      expectedCalibrationError: 0.045,
      logLoss: 0.66,
    },
    model: 'Base Model v1 only',
  },
  comparisons: [
    {
      adjustment: 0,
      averageSeasonBrier: 0.23,
      games: 130,
      gamesAffectedPercentage: 0.18,
      metrics: {
        accuracy: 0.57,
        brierScore: 0.23,
        expectedCalibrationError: 0.045,
        logLoss: 0.66,
      },
      occurrences: {
        gamesAffected: 23,
        negativeOccurrences: 11,
        positiveOccurrences: 12,
      },
      seasonResults: [
        makeSeason({
          accuracy: 0.57,
          brierScore: 0.23,
          ece: 0.045,
          games: 130,
          logLoss: 0.66,
          seasonId: '20242025',
        }),
      ],
      seasonsBeatingBaseline: 0,
      stability: { level: 'not_assessed' },
      threshold: 5,
      worstSeason: { brierScore: 0.23, seasonId: '20242025' },
    },
    {
      adjustment: 2,
      averageSeasonBrier: 0.222,
      delta: { brierScore: -0.008, logLoss: -0.015 },
      games: 130,
      gamesAffectedPercentage: 0.18,
      metrics: {
        accuracy: 0.6,
        brierScore: 0.222,
        expectedCalibrationError: 0.035,
        logLoss: 0.645,
      },
      occurrences: {
        gamesAffected: 23,
        negativeOccurrences: 11,
        positiveOccurrences: 12,
      },
      seasonResults: [
        makeSeason({
          accuracy: 0.6,
          brierScore: 0.222,
          ece: 0.035,
          games: 130,
          logLoss: 0.645,
          seasonId: '20242025',
        }),
      ],
      seasonsBeatingBaseline: 1,
      stability: { level: 'not_assessed' },
      threshold: 5,
      worstSeason: { brierScore: 0.222, seasonId: '20242025' },
    },
  ],
  diagnostics: {
    productionWrites: false,
    referenceSeasonIds: ['20212022', '20222023', '20232024'],
    selectedSeasonIds: ['20242025'],
  },
  modelVersion: 'base-model-v1',
  rankingAudit: [{ frozenBeforeTargetSeason: true }],
  thresholdSummary: [
    {
      occurrences: { gamesAffected: 23 },
      signalDiagnostics: {
        negative: { count: 11 },
        positive: { count: 12 },
      },
      threshold: 5,
    },
  ],
  thresholds: [5],
}

module.exports = {
  baseModelResultFixture,
  homeAdvantageResultFixture,
  scheduleResultFixture,
  specialTeamsResultFixture,
}
