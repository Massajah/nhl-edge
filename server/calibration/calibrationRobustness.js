const {
  LOG_LOSS_EPSILON,
} = require('../services/baseModelCalibrationService')
const {
  createDeterministicSignature,
  deepFreeze,
} = require('./calibrationIdentity')

const RESAMPLING_METHOD = 'season_stratified_temporal_block_bootstrap'
const INTERVAL_METHOD = 'percentile'
const DEFAULT_BLOCK_SIZE_DAYS = 7
const DEFAULT_REPLICATES = 2500
const DEFAULT_INTERVAL_LEVEL = 0.95
const SUPPORTED_REPLICATES = Object.freeze([1000, 2500, 5000])
const SUPPORTED_INTERVAL_LEVELS = Object.freeze([0.9, 0.95, 0.99])
const COMPARISON_TOLERANCE = 1e-12
const DAY_MS = 24 * 60 * 60 * 1000

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

const normalizeNumber = (value) => {
  if (!Number.isFinite(value)) return null

  const rounded = Number(value.toFixed(12))

  return Object.is(rounded, -0) ? 0 : rounded
}

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const quantile = (sortedValues, probability) => {
  if (sortedValues.length === 0) return null
  if (sortedValues.length === 1) return sortedValues[0]

  const position = (sortedValues.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const weight = position - lowerIndex

  return sortedValues[lowerIndex] * (1 - weight) +
    sortedValues[upperIndex] * weight
}

const calculateBrierLoss = (probability, outcome) =>
  (probability - outcome) ** 2

const calculateLogLoss = (probability, outcome) => {
  const clipped = Math.min(
    1 - LOG_LOSS_EPSILON,
    Math.max(LOG_LOSS_EPSILON, probability),
  )

  return -(
    outcome * Math.log(clipped) +
    (1 - outcome) * Math.log(1 - clipped)
  )
}

const getPredictionTimestamp = (prediction) => {
  const timestamp = Number(prediction?.timestamp)

  if (Number.isFinite(timestamp)) return timestamp

  const parsed = Date.parse(
    prediction?.gameDate
      ? `${prediction.gameDate}T00:00:00.000Z`
      : prediction?.startTimeUTC,
  )

  return Number.isFinite(parsed) ? parsed : null
}

const normalizePrediction = (prediction, field) => {
  const gameId = String(prediction?.gameId ?? '').trim()
  const seasonId = String(prediction?.seasonId ?? '').trim()
  const actualOutcome = Number(prediction?.actualHomeWin)
  const probability = Number(prediction?.homeProbability)
  const timestamp = getPredictionTimestamp(prediction)
  const gameDate = String(
    prediction?.gameDate ??
      (Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString().slice(0, 10)
        : ''),
  )

  if (!gameId || !seasonId) {
    throw new TypeError(`${field} requires gameId and seasonId.`)
  }
  if (actualOutcome !== 0 && actualOutcome !== 1) {
    throw new TypeError(`${field}.actualHomeWin must be zero or one.`)
  }
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError(`${field}.homeProbability must be between zero and one.`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate) || !Number.isFinite(timestamp)) {
    throw new TypeError(`${field} requires a valid chronological game date.`)
  }

  return {
    actualOutcome,
    awayTeamId: prediction.awayTeamId ?? null,
    gameDate,
    gameId,
    homeTeamId: prediction.homeTeamId ?? null,
    probability,
    resultType: prediction.resultType ?? null,
    seasonId,
    timestamp,
  }
}

const createObservationSetSignature = (observations) =>
  createDeterministicSignature(
    'nhl-edge/calibration-robustness-observations/v1',
    observations.map((observation) => ({
      actualOutcome: observation.actualOutcome,
      baselineProbability: observation.baselineProbability,
      candidateProbability: observation.candidateProbability,
      gameDate: observation.gameDate,
      gameId: observation.gameId,
      seasonId: observation.seasonId,
    })),
  )

const buildPairedCalibrationObservations = ({
  baselinePredictions,
  candidatePredictions,
}) => {
  if (
    !Array.isArray(baselinePredictions) ||
    !Array.isArray(candidatePredictions) ||
    baselinePredictions.length === 0 ||
    baselinePredictions.length !== candidatePredictions.length
  ) {
    throw new TypeError(
      'Paired robustness observations require equal non-empty prediction sets.',
    )
  }

  const candidatesByGameId = new Map()

  candidatePredictions.forEach((prediction, index) => {
    const normalized = normalizePrediction(
      prediction,
      `candidatePredictions[${index}]`,
    )

    if (candidatesByGameId.has(normalized.gameId)) {
      throw new TypeError('Candidate predictions contain duplicate game IDs.')
    }
    candidatesByGameId.set(normalized.gameId, normalized)
  })

  const seenBaselineIds = new Set()
  const observations = baselinePredictions.map((prediction, index) => {
    const baseline = normalizePrediction(
      prediction,
      `baselinePredictions[${index}]`,
    )
    const candidate = candidatesByGameId.get(baseline.gameId)

    if (seenBaselineIds.has(baseline.gameId)) {
      throw new TypeError('Baseline predictions contain duplicate game IDs.')
    }
    seenBaselineIds.add(baseline.gameId)

    if (!candidate) {
      throw new TypeError(
        `Candidate prediction is missing game ${baseline.gameId}.`,
      )
    }
    if (
      candidate.seasonId !== baseline.seasonId ||
      candidate.actualOutcome !== baseline.actualOutcome
    ) {
      throw new TypeError(
        `Paired prediction identity differs for game ${baseline.gameId}.`,
      )
    }

    const baselineBrierLoss = calculateBrierLoss(
      baseline.probability,
      baseline.actualOutcome,
    )
    const candidateBrierLoss = calculateBrierLoss(
      candidate.probability,
      candidate.actualOutcome,
    )
    const baselineLogLoss = calculateLogLoss(
      baseline.probability,
      baseline.actualOutcome,
    )
    const candidateLogLoss = calculateLogLoss(
      candidate.probability,
      candidate.actualOutcome,
    )

    return {
      actualOutcome: baseline.actualOutcome,
      awayTeamId: baseline.awayTeamId,
      baselineBrierLoss,
      baselineLogLoss,
      baselineProbability: baseline.probability,
      candidateBrierLoss,
      candidateLogLoss,
      candidateProbability: candidate.probability,
      deltaBrierLoss: candidateBrierLoss - baselineBrierLoss,
      deltaLogLoss: candidateLogLoss - baselineLogLoss,
      gameDate: baseline.gameDate,
      gameId: baseline.gameId,
      homeTeamId: baseline.homeTeamId,
      resultType: baseline.resultType,
      seasonId: baseline.seasonId,
      timestamp: baseline.timestamp,
    }
  }).sort(
    (left, right) =>
      compareIdentifiers(left.seasonId, right.seasonId) ||
      left.timestamp - right.timestamp ||
      compareIdentifiers(left.gameId, right.gameId),
  )

  if (candidatesByGameId.size !== observations.length) {
    throw new TypeError('Candidate predictions contain unmatched game IDs.')
  }

  const seasons = [...new Set(observations.map((item) => item.seasonId))]

  return deepFreeze({
    games: observations.length,
    observations,
    seasons,
    signature: createObservationSetSignature(observations),
  })
}

const summarizeBlock = (seasonId, blockIndex, observations) => ({
  blockId: `${seasonId}:${blockIndex}`,
  blockIndex,
  brierDeltaSum: observations.reduce(
    (sum, observation) => sum + observation.deltaBrierLoss,
    0,
  ),
  count: observations.length,
  endDate: observations.at(-1).gameDate,
  logLossDeltaSum: observations.reduce(
    (sum, observation) => sum + observation.deltaLogLoss,
    0,
  ),
  observationIds: observations.map((observation) => observation.gameId),
  observations,
  seasonId,
  startDate: observations[0].gameDate,
})

const buildSeasonTemporalBlocks = (
  observations,
  blockSizeDays = DEFAULT_BLOCK_SIZE_DAYS,
) => {
  if (!Number.isInteger(blockSizeDays) || blockSizeDays < 1 || blockSizeDays > 31) {
    throw new TypeError('blockSizeDays must be an integer from 1 through 31.')
  }

  const bySeason = new Map()

  observations.forEach((observation) => {
    if (!bySeason.has(observation.seasonId)) {
      bySeason.set(observation.seasonId, [])
    }
    bySeason.get(observation.seasonId).push(observation)
  })

  const seasons = [...bySeason.keys()].sort(compareIdentifiers)
  const blocksBySeason = Object.fromEntries(seasons.map((seasonId) => {
    const seasonObservations = bySeason.get(seasonId).sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        compareIdentifiers(left.gameId, right.gameId),
    )
    const anchor = Date.parse(`${seasonObservations[0].gameDate}T00:00:00.000Z`)
    const grouped = new Map()

    seasonObservations.forEach((observation) => {
      const day = Date.parse(`${observation.gameDate}T00:00:00.000Z`)
      const blockIndex = Math.floor(
        (day - anchor) / (blockSizeDays * DAY_MS),
      )

      if (!grouped.has(blockIndex)) grouped.set(blockIndex, [])
      grouped.get(blockIndex).push(observation)
    })

    return [
      seasonId,
      [...grouped.entries()]
        .sort(([left], [right]) => left - right)
        .map(([blockIndex, blockObservations]) =>
          summarizeBlock(seasonId, blockIndex, blockObservations)),
    ]
  }))

  return deepFreeze({
    blockDefinition:
      `${blockSizeDays}-day fixed chronological calendar blocks anchored to each season's first included game`,
    blockSizeDays,
    blocksBySeason,
    seasons,
    totalBlocks: seasons.reduce(
      (sum, seasonId) => sum + blocksBySeason[seasonId].length,
      0,
    ),
  })
}

const createSeededRandom = (seed) => {
  let state = Number(seed) >>> 0

  return () => {
    state += 0x6D2B79F5
    let value = state

    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const sampleSeasonStratifiedBlocks = (blockDesign, random) => {
  const sampledBlocks = blockDesign.seasons.flatMap((seasonId) => {
    const blocks = blockDesign.blocksBySeason[seasonId]

    return Array.from({ length: blocks.length }, () =>
      blocks[Math.floor(random() * blocks.length)])
  })

  return {
    observationIds: sampledBlocks.flatMap((block) => block.observationIds),
    observations: sampledBlocks.flatMap((block) => block.observations),
    sampledBlockIds: sampledBlocks.map((block) => block.blockId),
    sampledBlocks,
    sampledSeasons: [...new Set(sampledBlocks.map((block) => block.seasonId))],
  }
}

const summarizeBootstrapMetric = (values, intervalLevel) => {
  const sorted = [...values].sort((left, right) => left - right)
  const tail = (1 - intervalLevel) / 2
  const better = values.filter((value) => value < -COMPARISON_TOLERANCE).length
  const worse = values.filter((value) => value > COMPARISON_TOLERANCE).length
  const equal = values.length - better - worse
  const lower = quantile(sorted, tail)
  const upper = quantile(sorted, 1 - tail)

  return {
    intervalCrossesZero: lower <= 0 && upper >= 0,
    lower: normalizeNumber(lower),
    mean: normalizeNumber(mean(values)),
    median: normalizeNumber(quantile(sorted, 0.5)),
    proportionBetter: normalizeNumber(better / values.length),
    proportionEqual: normalizeNumber(equal / values.length),
    proportionWorse: normalizeNumber(worse / values.length),
    upper: normalizeNumber(upper),
  }
}

const runPairedBlockBootstrap = ({
  blockDesign,
  intervalLevel,
  replicates,
  seed,
}) => {
  const random = createSeededRandom(seed)
  const brierDeltas = []
  const logLossDeltas = []

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let brierDeltaSum = 0
    let count = 0
    let logLossDeltaSum = 0

    blockDesign.seasons.forEach((seasonId) => {
      const blocks = blockDesign.blocksBySeason[seasonId]

      for (let draw = 0; draw < blocks.length; draw += 1) {
        const block = blocks[Math.floor(random() * blocks.length)]

        brierDeltaSum += block.brierDeltaSum
        count += block.count
        logLossDeltaSum += block.logLossDeltaSum
      }
    })

    brierDeltas.push(brierDeltaSum / count)
    logLossDeltas.push(logLossDeltaSum / count)
  }

  return {
    deltaBrier: summarizeBootstrapMetric(brierDeltas, intervalLevel),
    deltaLogLoss: summarizeBootstrapMetric(logLossDeltas, intervalLevel),
  }
}

const summarizeObserved = (observations) => ({
  baselineBrier: normalizeNumber(mean(
    observations.map((observation) => observation.baselineBrierLoss),
  )),
  baselineLogLoss: normalizeNumber(mean(
    observations.map((observation) => observation.baselineLogLoss),
  )),
  brier: normalizeNumber(mean(
    observations.map((observation) => observation.candidateBrierLoss),
  )),
  deltaBrier: normalizeNumber(mean(
    observations.map((observation) => observation.deltaBrierLoss),
  )),
  deltaLogLoss: normalizeNumber(mean(
    observations.map((observation) => observation.deltaLogLoss),
  )),
  logLoss: normalizeNumber(mean(
    observations.map((observation) => observation.candidateLogLoss),
  )),
})

const getDirection = (value) => {
  if (!Number.isFinite(value) || Math.abs(value) <= COMPARISON_TOLERANCE) return 0
  return value < 0 ? -1 : 1
}

const buildSeasonSensitivity = (observations) => {
  const seasons = [...new Set(
    observations.map((observation) => observation.seasonId),
  )]
  const observedDelta = mean(
    observations.map((observation) => observation.deltaBrierLoss),
  )
  const observedDirection = getDirection(observedDelta)
  const perSeason = seasons.map((seasonId) => {
    const seasonObservations = observations.filter((observation) =>
      observation.seasonId === seasonId)
    const deltaBrier = mean(
      seasonObservations.map((observation) => observation.deltaBrierLoss),
    )

    return {
      deltaBrier: normalizeNumber(deltaBrier),
      direction: getDirection(deltaBrier),
      games: seasonObservations.length,
      seasonId,
    }
  })
  const leaveOneSeasonOut = seasons.map((seasonId) => {
    const retained = observations.filter((observation) =>
      observation.seasonId !== seasonId)
    const deltaBrier = retained.length > 0
      ? mean(retained.map((observation) => observation.deltaBrierLoss))
      : null
    const direction = getDirection(deltaBrier)

    return {
      deltaBrier: normalizeNumber(deltaBrier),
      directionChanged:
        observedDirection !== 0 &&
        direction !== 0 &&
        direction !== observedDirection,
      excludedSeasonId: seasonId,
      gamesRetained: retained.length,
    }
  })

  return {
    leaveOneSeasonOut,
    perSeason: perSeason.map(({ direction, ...season }) => season),
    resultSensitiveToSeasonRemoval: leaveOneSeasonOut.some(
      (season) => season.directionChanged,
    ),
    seasonsEqual: perSeason.filter((season) => season.direction === 0).length,
    seasonsImproved: perSeason.filter((season) => season.direction < 0).length,
    seasonsWorse: perSeason.filter((season) => season.direction > 0).length,
  }
}

const deriveDefaultSeed = (identity) => {
  const signature = createDeterministicSignature(
    'nhl-edge/calibration-robustness-default-seed/v1',
    identity,
  )

  return Number.parseInt(signature.slice(-8), 16) >>> 0
}

const createAnalysisId = ({
  baselineSignature,
  blockDesign,
  candidateId,
  configurationSignature,
  intervalLevel,
  observationSignature,
  replicates,
  seed,
}) => createDeterministicSignature(
  'nhl-edge/calibration-robustness-analysis/v1',
  {
    baselineSignature,
    blockSizeDays: blockDesign.blockSizeDays,
    candidateId,
    configurationSignature,
    intervalLevel,
    intervalMethod: INTERVAL_METHOD,
    observationSignature,
    replicates,
    resamplingMethod: RESAMPLING_METHOD,
    seed,
  },
)

module.exports = {
  COMPARISON_TOLERANCE,
  DEFAULT_BLOCK_SIZE_DAYS,
  DEFAULT_INTERVAL_LEVEL,
  DEFAULT_REPLICATES,
  INTERVAL_METHOD,
  RESAMPLING_METHOD,
  SUPPORTED_INTERVAL_LEVELS,
  SUPPORTED_REPLICATES,
  buildPairedCalibrationObservations,
  buildSeasonSensitivity,
  buildSeasonTemporalBlocks,
  calculateLogLoss,
  createAnalysisId,
  createObservationSetSignature,
  createSeededRandom,
  deriveDefaultSeed,
  runPairedBlockBootstrap,
  sampleSeasonStratifiedBlocks,
  summarizeObserved,
}
