const { NHL_TEAMS } = require('../../shared/nhlTeams')
const { MODEL_PERFORMANCE_DATA_MODES } = require('../config/modelPerformanceDataModes')
const { ODDS_SNAPSHOT_TYPES } = require('./oddsSnapshotContracts')
const { CLOSING_SAFETY_REASON } = require('./oddsClosingMarketContracts')
const {
  PERFORMANCE_REASON_CODES,
} = require('./modelPerformanceContracts')

const DEMO_PERFORMANCE_DATASET_VERSION = 1
const DEMO_PERFORMANCE_MODEL_VERSION = 'DEMO_SAMPLE_V1'
const DEMO_PERFORMANCE_PREDICTION_DEFINITION =
  'DEMO_SAMPLE_MODEL_PERFORMANCE_V1'
const DEMO_PERFORMANCE_CALCULATION_CONTRACT =
  'demo-sample-performance-v1'
const DEMO_PERFORMANCE_SEASON_ID = '20242025'
const DEMO_PERFORMANCE_GAME_COUNT = 150
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const BOOKMAKERS = Object.freeze([
  { key: 'pinnacle', title: 'Pinnacle' },
  { key: 'coolbet', title: 'Coolbet' },
  { key: 'unibet_fi', title: 'Unibet FI' },
])

const DEMO_PERFORMANCE_SEASON_METADATA = Object.freeze({
  currentSeasonId: DEMO_PERFORMANCE_SEASON_ID,
  seasons: Object.freeze([
    Object.freeze({
      endDate: '2025-03-03',
      id: DEMO_PERFORMANCE_SEASON_ID,
      isCurrent: false,
      label: '2024–25 Sample',
      startDate: '2024-10-05',
    }),
  ]),
})

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value))

// Fixed-seed Mulberry32. Changing either this seed or the generator is a
// deliberate dataset-version change because screenshot and metric stability
// depend on its sequence.
const createPrng = (seed) => {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const probabilityToOdds = (probability, margin = 1.045) =>
  Number((1 / (probability * margin)).toFixed(3))

const createBookmakers = (
  probability,
  { closing = false, observedAt = null, scheduledStart = null } = {},
) =>
  BOOKMAKERS.map((bookmaker, index) => {
    const adjustedProbability = clamp(
      probability + (index - 1) * 0.004,
      0.16,
      0.84,
    )
    const row = {
      awayOdds: probabilityToOdds(1 - adjustedProbability),
      homeOdds: probabilityToOdds(adjustedProbability),
      key: bookmaker.key,
    }

    return closing
      ? {
          ...row,
          observedAt,
          providerCommenceTime: scheduledStart,
          safetyReason: CLOSING_SAFETY_REASON,
        }
      : row
  })

const createSnapshot = (game, snapshotType, probability, hoursBeforeStart) => ({
  awayTeamId: game.awayTeamId,
  bookmakers: createBookmakers(probability),
  capturedAt: new Date(game.scheduledStart.getTime() - hoursBeforeStart * HOUR_MS),
  gameId: game.gameId,
  gameType: 2,
  homeTeamId: game.homeTeamId,
  scheduledStartAtCapture: game.scheduledStart,
  seasonId: DEMO_PERFORMANCE_SEASON_ID,
  snapshotType,
})

const createClosing = (game, probability) => {
  const observedAt = new Date(game.scheduledStart.getTime() - 5 * 60 * 1000)
  const finalBookmakers = createBookmakers(probability, {
    closing: true,
    observedAt,
    scheduledStart: game.scheduledStart,
  })
  const best = (side) => {
    const oddsField = side === 'home' ? 'homeOdds' : 'awayOdds'
    const row = [...finalBookmakers].sort(
      (left, right) => right[oddsField] - left[oddsField],
    )[0]

    return {
      bookmakerKey: row.key,
      observedAt,
      odds: row[oddsField],
    }
  }

  return {
    awayTeamId: game.awayTeamId,
    bestFinal: { away: best('away'), home: best('home') },
    finalBookmakers,
    finalizedAt: new Date(game.scheduledStart.getTime() + HOUR_MS),
    gameId: game.gameId,
    gameType: 2,
    homeTeamId: game.homeTeamId,
    scheduledStartAtCapture: game.scheduledStart,
    seasonId: DEMO_PERFORMANCE_SEASON_ID,
  }
}

const createPrediction = (game) => ({
  adjustments: {
    away: { injuries: game.index % 9 === 0 ? -0.5 : 0, specialTeams: 0 },
    home: { homeAdvantage: 3.5, quickRematch: game.index % 17 === 0 ? 0.5 : 0 },
  },
  awayFairOdds: Number((1 / (1 - game.modelProbability)).toFixed(3)),
  awayTeamId: game.awayTeamId,
  awayWinProbability: 1 - game.modelProbability,
  calculationContractVersion: DEMO_PERFORMANCE_CALCULATION_CONTRACT,
  completeness: {
    goalies: { away: 'AVAILABLE', home: 'AVAILABLE' },
    injuries: { away: 'AVAILABLE', home: 'AVAILABLE' },
    ratings: 'AVAILABLE',
    schedule: { away: 'AVAILABLE', home: 'AVAILABLE' },
    specialTeams: { away: 'AVAILABLE', home: 'AVAILABLE' },
  },
  gameId: game.gameId,
  gameType: 2,
  generatedAt: new Date(game.scheduledStart.getTime() - 90 * 60 * 1000),
  homeFairOdds: Number((1 / game.modelProbability).toFixed(3)),
  homeTeamId: game.homeTeamId,
  homeWinProbability: game.modelProbability,
  modelState: {
    away: { baseRating: 48 + (game.index % 9) * 0.5, effectiveRating: 48.25 },
    home: { baseRating: 49 + (game.index % 8) * 0.5, effectiveRating: 52.5 },
  },
  modelVersion: DEMO_PERFORMANCE_MODEL_VERSION,
  predictionDefinition: DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  scheduledStartAtCapture: game.scheduledStart,
  seasonId: DEMO_PERFORMANCE_SEASON_ID,
  settingsFingerprint: 'd'.repeat(64),
  targetAt: new Date(game.scheduledStart.getTime() - 2 * HOUR_MS),
})

const createBet = (game, closing, betIndex) => {
  const selectedHome = game.modelProbability >= 0.5
  const bookmakerKey =
    betIndex % 9 === 0
      ? 'veikkaus_fi'
      : betIndex % 11 === 0
        ? 'unknown_demo_book'
        : 'pinnacle'
  const source = betIndex % 7 === 0 ? 'manual' : 'provider'
  const selectedTeamId = selectedHome ? game.homeTeamId : game.awayTeamId
  const finalRow = closing?.finalBookmakers.find(
    ({ key }) => key === bookmakerKey,
  )
  const finalOdds = finalRow?.[selectedHome ? 'homeOdds' : 'awayOdds']
  const clvTargets = [-3, -1.5, -0.5, 0.5, 1.5, 3]
  const fallbackOdds = probabilityToOdds(
    selectedHome ? game.t2Probability : 1 - game.t2Probability,
    1.035,
  )
  const marketOdds = Number(
    ((finalOdds ?? fallbackOdds) * (1 + clvTargets[betIndex % 6] / 100)).toFixed(2),
  )
  const stake = [8, 10, 12, 14][betIndex % 4]
  const selectedWon = selectedHome ? game.homeWon : !game.homeWon
  let result

  if (betIndex % 23 === 0) result = 'pending'
  else if (betIndex % 17 === 0) result = 'void'
  else if (betIndex % 13 === 0) result = 'push'
  else result = selectedWon ? 'win' : 'loss'

  const profit =
    result === 'win'
      ? Number(((marketOdds - 1) * stake).toFixed(2))
      : result === 'loss'
        ? -stake
        : 0

  return {
    _id: `demo-performance-bet-${String(betIndex + 1).padStart(2, '0')}`,
    analyzedAt: new Date(game.scheduledStart.getTime() - 65 * 60 * 1000),
    bookmakerKey,
    bookmakerTitle:
      BOOKMAKERS.find(({ key }) => key === bookmakerKey)?.title ??
      'Sample Book',
    createdAt: new Date(game.scheduledStart.getTime() - HOUR_MS),
    expectedValue: Number(
      ((selectedHome ? game.modelProbability : 1 - game.modelProbability) * marketOdds * 100 - 100).toFixed(2),
    ),
    fairOdds: Number(
      (1 / (selectedHome ? game.modelProbability : 1 - game.modelProbability)).toFixed(3),
    ),
    gameId: game.gameId,
    marketOdds,
    marketOddsSource: source,
    modelProbability: selectedHome
      ? game.modelProbability
      : 1 - game.modelProbability,
    probabilityEdge: Number(
      ((selectedHome ? game.modelProbability : 1 - game.modelProbability) - 1 / marketOdds).toFixed(4),
    ),
    profit,
    result,
    scheduledStart: game.scheduledStart,
    selectedSide: { homeAway: selectedHome ? 'home' : 'away', teamId: selectedTeamId },
    selectedTeam: { abbreviation: selectedTeamId, teamId: selectedTeamId },
    stake,
  }
}

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const generateDataset = () => {
  const random = createPrng(0x4e484c32)
  const start = Date.parse('2024-10-05T23:00:00.000Z')
  const favoriteProbabilities = [0.525, 0.575, 0.625, 0.675, 0.725, 0.775, 0.825]
  const favoriteWinTargets = [12, 13, 14, 14, 15, 16, 17]
  const t2Offsets = [-0.045, -0.03, -0.015, 0.015, 0.03, 0.045, 0]
  const games = Array.from({ length: DEMO_PERFORMANCE_GAME_COUNT }, (_, index) => {
    const favoriteProbability = favoriteProbabilities[index % favoriteProbabilities.length]
    const modelProbability = index % 2 === 0
      ? favoriteProbability
      : 1 - favoriteProbability
    const t2Probability = clamp(
      modelProbability + t2Offsets[(index * 3) % t2Offsets.length],
      0.17,
      0.83,
    )
    const direction = Math.sign(t2Probability - modelProbability) || (index % 2 ? -1 : 1)
    const movementPattern = index % 5
    const finalProbability = clamp(
      movementPattern <= 1
        ? modelProbability + (t2Probability - modelProbability) * 0.45
        : movementPattern === 2
          ? t2Probability + direction * 0.025
          : movementPattern === 3
            ? t2Probability + direction * 0.0002
            : modelProbability + (t2Probability - modelProbability) * 0.75,
      0.16,
      0.84,
    )
    const bucketIndex = index % favoriteProbabilities.length
    const bucketObservation = Math.floor(index / favoriteProbabilities.length)
    const bucketSize = bucketIndex < 3 ? 22 : 21
    const targetWins = favoriteWinTargets[bucketIndex]
    const favoriteWon =
      Math.floor(((bucketObservation + 1) * targetWins) / bucketSize) >
      Math.floor((bucketObservation * targetWins) / bucketSize)
    const homeIsFavorite = modelProbability >= 0.5
    const homeWon = homeIsFavorite ? favoriteWon : !favoriteWon
    const extraGoal = random() < 0.35 ? 1 : 0
    const homeScore = homeWon ? 3 + extraGoal : 1 + (index % 2)
    const awayScore = homeWon ? 1 + (index % 2) : 3 + extraGoal
    const homeTeam = NHL_TEAMS[(index * 7 + 3) % NHL_TEAMS.length]
    let awayTeam = NHL_TEAMS[(index * 11 + 14) % NHL_TEAMS.length]
    if (awayTeam.id === homeTeam.id) {
      awayTeam = NHL_TEAMS[(index * 11 + 15) % NHL_TEAMS.length]
    }

    return {
      awayScore,
      awayTeamId: awayTeam.id,
      finalProbability,
      gameId: String(2024020001 + index),
      homeScore,
      homeTeamId: homeTeam.id,
      homeWon,
      index,
      modelProbability,
      scheduledStart: new Date(start + index * DAY_MS),
      t2Probability,
    }
  })
  const predictions = games.map(createPrediction)
  const historicalGames = games.map((game) => ({
    awayScore: game.awayScore,
    awayTeamAbbreviation: game.awayTeamId,
    awayTeamId: game.awayTeamId,
    gameId: game.gameId,
    gameState: 'FINAL',
    gameType: 2,
    homeScore: game.homeScore,
    homeTeamAbbreviation: game.homeTeamId,
    homeTeamId: game.homeTeamId,
    resultType: game.index % 12 === 0 ? 'OVERTIME' : 'REGULATION',
    seasonId: DEMO_PERFORMANCE_SEASON_ID,
    startTimeUTC: game.scheduledStart,
  }))
  const timelineSnapshots = games.flatMap((game) => {
    const snapshots = []
    if (game.index % 13 !== 0) {
      snapshots.push(
        createSnapshot(
          game,
          ODDS_SNAPSHOT_TYPES.T24,
          clamp(game.t2Probability + (game.index % 2 ? 0.018 : -0.018), 0.16, 0.84),
          24,
        ),
      )
    }
    if (game.index % 19 !== 0) {
      snapshots.push(
        createSnapshot(
          game,
          ODDS_SNAPSHOT_TYPES.T6,
          (game.t2Probability + game.finalProbability) / 2,
          6,
        ),
      )
    }
    if (game.index % 31 !== 0) {
      snapshots.push(
        createSnapshot(game, ODDS_SNAPSHOT_TYPES.T2, game.t2Probability, 2),
      )
    }
    return snapshots
  })
  const closingMarkets = games
    .filter(({ index }) => index % 37 !== 0)
    .map((game) => createClosing(game, game.finalProbability))
  const closingByGameId = new Map(
    closingMarkets.map((closing) => [closing.gameId, closing]),
  )
  const bets = Array.from({ length: 50 }, (_, betIndex) =>
    games[(betIndex * 11) % games.length],
  ).map((game, betIndex) =>
      createBet(game, closingByGameId.get(game.gameId), betIndex),
    )

  return deepFreeze({
    bets,
    closingMarkets,
    dataMode: MODEL_PERFORMANCE_DATA_MODES.DEMO_SAMPLE,
    games,
    historicalGames,
    predictions,
    timelineSnapshots,
  })
}

const DEMO_MODEL_PERFORMANCE_DATASET = generateDataset()

const validateDemoSamplePrediction = (prediction = {}) => {
  const scheduledStart = new Date(prediction.scheduledStartAtCapture).getTime()
  const generatedAt = new Date(prediction.generatedAt).getTime()
  const valid =
    prediction.predictionDefinition ===
      DEMO_PERFORMANCE_PREDICTION_DEFINITION &&
    prediction.calculationContractVersion ===
      DEMO_PERFORMANCE_CALCULATION_CONTRACT &&
    prediction.modelVersion === DEMO_PERFORMANCE_MODEL_VERSION &&
    /^\d{10}$/.test(String(prediction.gameId ?? '')) &&
    /^[a-f0-9]{64}$/.test(String(prediction.settingsFingerprint ?? '')) &&
    Number.isFinite(scheduledStart) &&
    Number.isFinite(generatedAt) &&
    generatedAt < scheduledStart &&
    Number(prediction.homeWinProbability) > 0 &&
    Number(prediction.homeWinProbability) < 1 &&
    Math.abs(
      Number(prediction.homeWinProbability) +
        Number(prediction.awayWinProbability) -
        1,
    ) <= 1e-12

  return valid ? null : PERFORMANCE_REASON_CODES.INVALID_OFFICIAL_PREDICTION
}

module.exports = {
  DEMO_MODEL_PERFORMANCE_DATASET,
  DEMO_PERFORMANCE_CALCULATION_CONTRACT,
  DEMO_PERFORMANCE_DATASET_VERSION,
  DEMO_PERFORMANCE_GAME_COUNT,
  DEMO_PERFORMANCE_MODEL_VERSION,
  DEMO_PERFORMANCE_PREDICTION_DEFINITION,
  DEMO_PERFORMANCE_SEASON_ID,
  DEMO_PERFORMANCE_SEASON_METADATA,
  validateDemoSamplePrediction,
}
