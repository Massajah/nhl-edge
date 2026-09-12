const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const {
  CALCULATION_CONTRACT_VERSION,
  CLOSE_BEFORE_MS,
  OPEN_BEFORE_MS,
  PREDICTION_DEFINITION,
} = require('./forwardPredictionContracts')
const { CLOSING_SAFETY_REASON } = require('./oddsClosingMarketContracts')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const PERFORMANCE_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
})

const PERFORMANCE_REASON_CODES = Object.freeze({
  BET_AFTER_START: 'BET_AFTER_START',
  GAME_POSTPONED: 'GAME_POSTPONED',
  GAME_UNAVAILABLE: 'GAME_UNAVAILABLE',
  INCOMPLETE_TWO_SIDED_ODDS: 'INCOMPLETE_TWO_SIDED_ODDS',
  INVALID_BET_ODDS: 'INVALID_BET_ODDS',
  INVALID_FINAL_RESULT: 'INVALID_FINAL_RESULT',
  INVALID_BET_SIDE: 'INVALID_BET_SIDE',
  INVALID_OFFICIAL_PREDICTION: 'INVALID_OFFICIAL_PREDICTION',
  MANUAL_ODDS: 'MANUAL_ODDS',
  MISSING_FINAL_MARKET: 'MISSING_FINAL_MARKET',
  MISSING_T2_MARKET: 'MISSING_T2_MARKET',
  MODEL_VERSION_MISSING: 'MODEL_VERSION_MISSING',
  NO_OFFICIAL_PREDICTION: 'NO_OFFICIAL_PREDICTION',
  NO_LATER_SAME_BOOK_FINAL: 'NO_LATER_SAME_BOOK_FINAL',
  NO_RELEVANT_BET: 'NO_RELEVANT_BET',
  NO_SETTLED_BET: 'NO_SETTLED_BET',
  NO_SETTLED_STAKE: 'NO_SETTLED_STAKE',
  PREDICTION_AFTER_START: 'PREDICTION_AFTER_START',
  RESULT_PENDING: 'RESULT_PENDING',
  RESULT_UNAVAILABLE: 'RESULT_UNAVAILABLE',
  SCHEDULE_IDENTITY_MISMATCH: 'SCHEDULE_IDENTITY_MISMATCH',
  UNKNOWN_BOOKMAKER: 'UNKNOWN_BOOKMAKER',
})

const CALIBRATION_BUCKETS = Object.freeze([
  Object.freeze({ lowerBound: 0.5, upperBound: 0.55, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.55, upperBound: 0.6, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.6, upperBound: 0.65, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.65, upperBound: 0.7, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.7, upperBound: 0.75, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.75, upperBound: 0.8, upperInclusive: false }),
  Object.freeze({ lowerBound: 0.8, upperBound: 1, upperInclusive: true }),
])

const MOVEMENT_TOLERANCE = 1e-12
const recognizedBookmakerKeys = new Set(
  REQUESTED_BOOKMAKERS.map(({ key }) => key),
)

const isRecognizedBookmakerKey = (value) =>
  recognizedBookmakerKeys.has(String(value ?? '').trim())

const validProbability = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= 1

const validDecimalOdds = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 1

const toTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return NaN
  return new Date(value).getTime()
}

const percentage = (numerator, denominator) =>
  denominator > 0 ? (Number(numerator) / denominator) * 100 : 0

const average = (values) =>
  values.length > 0
    ? values.reduce((sum, value) => sum + Number(value), 0) / values.length
    : null

const median = (values) => {
  if (!Array.isArray(values) || values.length === 0) return null

  const sorted = values.map(Number).sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint]
}

const uniqueReasons = (reasons = []) =>
  [...new Set(reasons.filter(Boolean))].sort()

const buildUnavailableMetric = ({
  eligibleCount = 0,
  excludedCount = 0,
  reasons = [],
} = {}) => ({
  eligibleCount,
  excludedCount,
  reasons: uniqueReasons(reasons),
  sampleSize: 0,
  status: PERFORMANCE_STATUSES.UNAVAILABLE,
  value: null,
})

const validateOfficialPrediction = (prediction = {}) => {
  const generatedAt = toTimestamp(prediction.generatedAt)
  const scheduledStart = toTimestamp(prediction.scheduledStartAtCapture)
  const targetAt = toTimestamp(prediction.targetAt)
  const beforeStart = scheduledStart - generatedAt

  if (!String(prediction.modelVersion ?? '').trim()) {
    return PERFORMANCE_REASON_CODES.MODEL_VERSION_MISSING
  }
  if (generatedAt >= scheduledStart) {
    return PERFORMANCE_REASON_CODES.PREDICTION_AFTER_START
  }

  const validIdentity =
    /^\d{10}$/.test(String(prediction.gameId ?? '')) &&
    /^\d{8}$/.test(String(prediction.seasonId ?? '')) &&
    [2, 3].includes(Number(prediction.gameType)) &&
    Boolean(String(prediction.homeTeamId ?? '').trim()) &&
    Boolean(String(prediction.awayTeamId ?? '').trim()) &&
    prediction.homeTeamId !== prediction.awayTeamId
  const homeProbability = Number(prediction.homeWinProbability)
  const awayProbability = Number(prediction.awayWinProbability)
  const validContract =
    prediction.predictionDefinition === PREDICTION_DEFINITION &&
    prediction.calculationContractVersion === CALCULATION_CONTRACT_VERSION &&
    /^[a-f0-9]{64}$/.test(String(prediction.settingsFingerprint ?? ''))
  const validTiming =
    Number.isFinite(generatedAt) &&
    Number.isFinite(scheduledStart) &&
    Number.isFinite(targetAt) &&
    beforeStart >= CLOSE_BEFORE_MS &&
    beforeStart <= OPEN_BEFORE_MS &&
    targetAt === scheduledStart - OPEN_BEFORE_MS
  const validProbabilities =
    validProbability(homeProbability) &&
    validProbability(awayProbability) &&
    homeProbability > 0 &&
    awayProbability > 0 &&
    Math.abs(homeProbability + awayProbability - 1) <= 1e-12

  return validIdentity && validContract && validTiming && validProbabilities
    ? null
    : PERFORMANCE_REASON_CODES.INVALID_OFFICIAL_PREDICTION
}

const calculateBrier = (observations = [], cohortSize = observations.length) => {
  const valid = observations.filter(
    ({ probability, outcome }) =>
      validProbability(probability) && [0, 1].includes(Number(outcome)),
  )
  const excludedCount = Math.max(0, cohortSize - valid.length)

  if (valid.length === 0) {
    return buildUnavailableMetric({
      eligibleCount: 0,
      excludedCount,
      reasons: [PERFORMANCE_REASON_CODES.RESULT_PENDING],
    })
  }

  return {
    eligibleCount: valid.length,
    excludedCount,
    reasons: [],
    sampleSize: valid.length,
    status: PERFORMANCE_STATUSES.AVAILABLE,
    value: average(
      valid.map(({ probability, outcome }) =>
        (Number(probability) - Number(outcome)) ** 2,
      ),
    ),
  }
}

const calculateAccuracy = (observations = []) => {
  let correctCount = 0
  let incorrectCount = 0
  let noPickCount = 0

  observations.forEach(({ homeProbability, homeWon }) => {
    const probability = Number(homeProbability)

    if (!validProbability(probability) || typeof homeWon !== 'boolean') return
    if (probability === 0.5) {
      noPickCount += 1
      return
    }

    const predictedHome = probability > 0.5
    if (predictedHome === homeWon) correctCount += 1
    else incorrectCount += 1
  })

  const sampleSize = correctCount + incorrectCount

  return {
    accuracyPercent:
      sampleSize > 0 ? percentage(correctCount, sampleSize) : null,
    correctCount,
    incorrectCount,
    noPickCount,
    sampleSize,
    status:
      sampleSize > 0
        ? PERFORMANCE_STATUSES.AVAILABLE
        : PERFORMANCE_STATUSES.UNAVAILABLE,
  }
}

const calibrationBucketFor = (probability) =>
  CALIBRATION_BUCKETS.find(
    ({ lowerBound, upperBound, upperInclusive }) =>
      probability >= lowerBound &&
      (probability < upperBound || (upperInclusive && probability <= upperBound)),
  )

const calculateCalibration = (observations = []) => {
  const grouped = new Map(CALIBRATION_BUCKETS.map((bucket) => [bucket, []]))

  observations.forEach(({ homeProbability, homeWon }) => {
    const home = Number(homeProbability)
    if (!validProbability(home) || typeof homeWon !== 'boolean') return

    const favoriteProbability = Math.max(home, 1 - home)
    const bucket = calibrationBucketFor(favoriteProbability)
    if (!bucket) return

    // A 50/50 observation is not an accuracy pick; home is the deterministic
    // event-side tie break used only to keep the fixed 50% calibration boundary.
    const favoriteWon = home >= 0.5 ? homeWon : !homeWon
    grouped.get(bucket).push({ favoriteProbability, favoriteWon })
  })

  return CALIBRATION_BUCKETS.map((bucket) => {
    const rows = grouped.get(bucket)
    const averagePredictedProbability = average(
      rows.map(({ favoriteProbability }) => favoriteProbability),
    )
    const actualWinRate = average(
      rows.map(({ favoriteWon }) => (favoriteWon ? 1 : 0)),
    )

    return {
      actualWinRate,
      averagePredictedProbability,
      calibrationGapPercentagePoints:
        rows.length > 0
          ? (actualWinRate - averagePredictedProbability) * 100
          : null,
      lowerBound: bucket.lowerBound,
      sampleSize: rows.length,
      status:
        rows.length > 0
          ? PERFORMANCE_STATUSES.AVAILABLE
          : PERFORMANCE_STATUSES.UNAVAILABLE,
      upperBound: bucket.upperBound,
      upperInclusive: bucket.upperInclusive,
    }
  })
}

const calculateNoVigConsensus = (bookmakers = []) => {
  const rows = []

  ;(Array.isArray(bookmakers) ? bookmakers : []).forEach((bookmaker) => {
    const homeOdds = Number(bookmaker?.homeOdds)
    const awayOdds = Number(bookmaker?.awayOdds)

    if (!validDecimalOdds(homeOdds) || !validDecimalOdds(awayOdds)) return

    const homeImplied = 1 / homeOdds
    const awayImplied = 1 / awayOdds
    rows.push({
      awayOdds,
      homeOdds,
      homeProbability: homeImplied / (homeImplied + awayImplied),
      key: String(bookmaker.key ?? ''),
    })
  })

  if (rows.length === 0) {
    return {
      awayProbability: null,
      bookmakerCount: 0,
      bookmakerKeys: [],
      homeProbability: null,
      reason: PERFORMANCE_REASON_CODES.INCOMPLETE_TWO_SIDED_ODDS,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
    }
  }

  const homeProbability = median(rows.map((row) => row.homeProbability))

  return {
    awayProbability: 1 - homeProbability,
    bookmakerCount: rows.length,
    bookmakerKeys: rows.map(({ key }) => key).filter(Boolean).sort(),
    homeProbability,
    reason: null,
    status: PERFORMANCE_STATUSES.AVAILABLE,
  }
}

const calculateBookmakerCountStatistics = (counts = []) => {
  if (counts.length === 0) {
    return { average: null, maximum: null, median: null, minimum: null }
  }

  return {
    average: average(counts),
    maximum: Math.max(...counts),
    median: median(counts),
    minimum: Math.min(...counts),
  }
}

const calculatePairedBrier = ({
  marketCoverageCount = 0,
  observations = [],
  resolvedCount = 0,
} = {}) => {
  const valid = observations.filter(
    ({ marketProbability, modelProbability, outcome }) =>
      validProbability(marketProbability) &&
      validProbability(modelProbability) &&
      [0, 1].includes(Number(outcome)),
  )
  const pairedSampleSize = valid.length
  const bookmakerCounts = valid.map(({ bookmakerCount }) => bookmakerCount)

  if (pairedSampleSize === 0) {
    return {
      bookmakerCount: calculateBookmakerCountStatistics([]),
      brierImprovement: null,
      excludedResolvedCount: resolvedCount,
      marketBrier: null,
      marketCoverageCount,
      pairedModelBrier: null,
      pairedSampleSize: 0,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
    }
  }

  const pairedModelBrier = average(
    valid.map(({ modelProbability, outcome }) =>
      (Number(modelProbability) - Number(outcome)) ** 2,
    ),
  )
  const marketBrier = average(
    valid.map(({ marketProbability, outcome }) =>
      (Number(marketProbability) - Number(outcome)) ** 2,
    ),
  )

  return {
    bookmakerCount: calculateBookmakerCountStatistics(bookmakerCounts),
    brierImprovement: marketBrier - pairedModelBrier,
    excludedResolvedCount: Math.max(0, resolvedCount - pairedSampleSize),
    marketBrier,
    marketCoverageCount,
    pairedModelBrier,
    pairedSampleSize,
    status: PERFORMANCE_STATUSES.AVAILABLE,
  }
}

const calculateMarketMovement = (
  observations = [],
  tolerance = MOVEMENT_TOLERANCE,
) => {
  const valid = observations.filter(
    ({ finalProbability, modelProbability, t2Probability }) =>
      validProbability(finalProbability) &&
      validProbability(modelProbability) &&
      validProbability(t2Probability),
  )
  let towardCount = 0
  let awayCount = 0
  let unchangedCount = 0
  const t2Distances = []
  const finalDistances = []

  valid.forEach(({ finalProbability, modelProbability, t2Probability }) => {
    const distanceAtT2 = Math.abs(modelProbability - t2Probability)
    const distanceAtFinal = Math.abs(modelProbability - finalProbability)
    const change = distanceAtFinal - distanceAtT2

    t2Distances.push(distanceAtT2)
    finalDistances.push(distanceAtFinal)
    if (change < -tolerance) towardCount += 1
    else if (change > tolerance) awayCount += 1
    else unchangedCount += 1
  })

  if (valid.length === 0) {
    return {
      averageDistanceAtFinalPercentagePoints: null,
      averageDistanceAtT2PercentagePoints: null,
      averageDistanceChangePercentagePoints: null,
      awayCount: 0,
      sampleSize: 0,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
      tolerance,
      towardCount: 0,
      towardPercent: null,
      unchangedCount: 0,
    }
  }

  const averageT2 = average(t2Distances)
  const averageFinal = average(finalDistances)

  return {
    averageDistanceAtFinalPercentagePoints: averageFinal * 100,
    averageDistanceAtT2PercentagePoints: averageT2 * 100,
    // Negative means the FINAL consensus was closer to the model on average.
    averageDistanceChangePercentagePoints: (averageFinal - averageT2) * 100,
    awayCount,
    sampleSize: valid.length,
    status: PERFORMANCE_STATUSES.AVAILABLE,
    tolerance,
    towardCount,
    towardPercent: percentage(towardCount, valid.length),
    unchangedCount,
  }
}

const calculateBetPerformance = (bets = []) => {
  const resultCounts = {
    losses: 0,
    pendingBets: 0,
    pushes: 0,
    voids: 0,
    wins: 0,
  }
  const settled = []

  bets.forEach((bet) => {
    const result = ['win', 'loss', 'push', 'void'].includes(bet?.result)
      ? bet.result
      : 'pending'

    if (result === 'pending') {
      resultCounts.pendingBets += 1
      return
    }

    settled.push(bet)
    if (result === 'win') resultCounts.wins += 1
    if (result === 'loss') resultCounts.losses += 1
    if (result === 'push') resultCounts.pushes += 1
    if (result === 'void') resultCounts.voids += 1
  })

  const settledStake = settled.reduce(
    (sum, bet) => sum + Math.max(0, Number(bet.stake) || 0),
    0,
  )
  const profit = settled.reduce(
    (sum, bet) => sum + (Number.isFinite(Number(bet.profit)) ? Number(bet.profit) : 0),
    0,
  )
  const validOdds = settled
    .map((bet) => Number(bet.marketOdds))
    .filter(validDecimalOdds)

  if (settled.length === 0) {
    return {
      averageDecimalOdds: null,
      ...resultCounts,
      profit: null,
      reasons: [PERFORMANCE_REASON_CODES.NO_SETTLED_BET],
      roiPercent: null,
      settledBets: 0,
      status: PERFORMANCE_STATUSES.UNAVAILABLE,
      totalRelevantBets: bets.length,
      totalStake: null,
    }
  }

  return {
    averageDecimalOdds: average(validOdds),
    ...resultCounts,
    profit,
    reasons:
      settledStake > 0 ? [] : [PERFORMANCE_REASON_CODES.NO_SETTLED_STAKE],
    roiPercent: settledStake > 0 ? percentage(profit, settledStake) : null,
    settledBets: settled.length,
    status:
      settledStake > 0
        ? PERFORMANCE_STATUSES.AVAILABLE
        : PERFORMANCE_STATUSES.UNAVAILABLE,
    totalRelevantBets: bets.length,
    totalStake: settledStake,
  }
}

const unavailableClv = (reason) => ({
  bestFinalOdds: null,
  bookmakerKey: null,
  clvPercent: null,
  finalOdds: null,
  finalObservedAt: null,
  reason,
  status: PERFORMANCE_STATUSES.UNAVAILABLE,
  vsBestFinalPercent: null,
})

const exactClosingIdentity = (bet, closingMarket) =>
  String(bet?.gameId ?? '') === String(closingMarket?.gameId ?? '') &&
  Number.isFinite(toTimestamp(bet?.scheduledStart)) &&
  toTimestamp(bet.scheduledStart) ===
    toTimestamp(closingMarket?.scheduledStartAtCapture)

const calculateBetClv = (bet = {}, closingMarket = null) => {
  if (bet.marketOddsSource !== 'provider') {
    return unavailableClv(PERFORMANCE_REASON_CODES.MANUAL_ODDS)
  }

  const bookmakerKey = String(bet.bookmakerKey ?? '').trim()
  if (!isRecognizedBookmakerKey(bookmakerKey)) {
    return unavailableClv(PERFORMANCE_REASON_CODES.UNKNOWN_BOOKMAKER)
  }

  const betOdds = Number(bet.marketOdds)
  if (!validDecimalOdds(betOdds)) {
    return unavailableClv(PERFORMANCE_REASON_CODES.INVALID_BET_ODDS)
  }

  const start = toTimestamp(bet.scheduledStart)
  const createdAt = toTimestamp(bet.createdAt)
  if (!/^\d{10}$/.test(String(bet.gameId ?? '')) || !Number.isFinite(start)) {
    return unavailableClv(PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH)
  }
  if (
    !closingMarket ||
    !closingMarket.finalizedAt ||
    !exactClosingIdentity(bet, closingMarket)
  ) {
    return unavailableClv(
      closingMarket
        ? PERFORMANCE_REASON_CODES.SCHEDULE_IDENTITY_MISMATCH
        : PERFORMANCE_REASON_CODES.MISSING_FINAL_MARKET,
    )
  }
  if (Number.isFinite(createdAt) && createdAt >= start) {
    return unavailableClv(PERFORMANCE_REASON_CODES.BET_AFTER_START)
  }
  if (!Number.isFinite(createdAt)) {
    return unavailableClv(PERFORMANCE_REASON_CODES.NO_LATER_SAME_BOOK_FINAL)
  }

  const side = bet.selectedSide?.homeAway
  const oddsField = side === 'home' ? 'homeOdds' : side === 'away' ? 'awayOdds' : null
  if (!oddsField) {
    return unavailableClv(PERFORMANCE_REASON_CODES.INVALID_BET_SIDE)
  }
  const selectedTeamId = getNhlTeamIdentity(
    bet.selectedSide?.teamId || bet.selectedSide?.abbreviation,
    bet.selectedTeam?.teamId || bet.selectedTeam?.abbreviation,
  )
  const closingTeamId = getNhlTeamIdentity(
    side === 'home' ? closingMarket.homeTeamId : closingMarket.awayTeamId,
  )
  if (!selectedTeamId || !closingTeamId || selectedTeamId !== closingTeamId) {
    return unavailableClv(PERFORMANCE_REASON_CODES.INVALID_BET_SIDE)
  }

  const finalRow = (closingMarket.finalBookmakers ?? []).find(
    (row) => row.key === bookmakerKey,
  )
  const observedAt = toTimestamp(finalRow?.observedAt)
  const providerStart = toTimestamp(finalRow?.providerCommenceTime)
  const safeFinal =
    finalRow?.safetyReason === CLOSING_SAFETY_REASON &&
    observedAt > createdAt &&
    observedAt < start &&
    providerStart === start &&
    validDecimalOdds(finalRow?.[oddsField])

  if (!safeFinal) {
    return unavailableClv(PERFORMANCE_REASON_CODES.NO_LATER_SAME_BOOK_FINAL)
  }

  const finalOdds = Number(finalRow[oddsField])
  const best = closingMarket.bestFinal?.[side]
  const matchingBestRow = (closingMarket.finalBookmakers ?? []).find(
    (row) =>
      row.key === best?.bookmakerKey &&
      Number(row?.[oddsField]) === Number(best?.odds) &&
      toTimestamp(row?.observedAt) === toTimestamp(best?.observedAt),
  )
  const bestObservedAt = toTimestamp(best?.observedAt)
  const safeBest =
    matchingBestRow &&
    matchingBestRow.safetyReason === CLOSING_SAFETY_REASON &&
    toTimestamp(matchingBestRow.providerCommenceTime) === start &&
    bestObservedAt > createdAt &&
    bestObservedAt < start &&
    validDecimalOdds(best?.odds)

  return {
    bestFinalOdds: safeBest ? Number(best.odds) : null,
    bookmakerKey,
    clvPercent: (betOdds / finalOdds - 1) * 100,
    finalOdds,
    finalObservedAt: finalRow.observedAt,
    reason: null,
    status: PERFORMANCE_STATUSES.AVAILABLE,
    vsBestFinalPercent: safeBest
      ? (betOdds / Number(best.odds) - 1) * 100
      : null,
  }
}

const summarizeClv = (clvRows = [], totalRelevantBets = clvRows.length) => {
  const eligible = clvRows.filter(
    ({ status }) => status === PERFORMANCE_STATUSES.AVAILABLE,
  )
  const values = eligible.map(({ clvPercent }) => clvPercent)
  const bestValues = eligible
    .map(({ vsBestFinalPercent }) => vsBestFinalPercent)
    .filter(Number.isFinite)
  const tolerance = 1e-12

  return {
    averageClvPercent: average(values),
    coveragePercent: percentage(eligible.length, totalRelevantBets),
    eligibleBetCount: eligible.length,
    medianClvPercent: median(values),
    negativeClvCount: values.filter((value) => value < -tolerance).length,
    positiveClvCount: values.filter((value) => value > tolerance).length,
    reasons:
      totalRelevantBets === 0
        ? [PERFORMANCE_REASON_CODES.NO_RELEVANT_BET]
        : uniqueReasons(clvRows.map(({ reason }) => reason)),
    status:
      eligible.length > 0
        ? PERFORMANCE_STATUSES.AVAILABLE
        : PERFORMANCE_STATUSES.UNAVAILABLE,
    unavailableBetCount: Math.max(0, totalRelevantBets - eligible.length),
    vsBestFinal: {
      averagePercent: average(bestValues),
      eligibleBetCount: bestValues.length,
      label: 'vs Best FINAL',
      medianPercent: median(bestValues),
      status:
        bestValues.length > 0
          ? PERFORMANCE_STATUSES.AVAILABLE
          : PERFORMANCE_STATUSES.UNAVAILABLE,
    },
    zeroClvCount: values.filter((value) => Math.abs(value) <= tolerance).length,
  }
}

module.exports = {
  CALIBRATION_BUCKETS,
  MOVEMENT_TOLERANCE,
  PERFORMANCE_REASON_CODES,
  PERFORMANCE_STATUSES,
  average,
  buildUnavailableMetric,
  calculateAccuracy,
  calculateBetClv,
  calculateBetPerformance,
  calculateBookmakerCountStatistics,
  calculateBrier,
  calculateCalibration,
  calculateMarketMovement,
  calculateNoVigConsensus,
  calculatePairedBrier,
  isRecognizedBookmakerKey,
  median,
  percentage,
  summarizeClv,
  uniqueReasons,
  validDecimalOdds,
  validProbability,
  validateOfficialPrediction,
}
