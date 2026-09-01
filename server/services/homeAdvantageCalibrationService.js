const historicalNhlDataService = require('./historicalNhlDataService')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')
const { FALLBACK_SEASONS, getSeasonLabel } = require('./nhlSeasonService')
const { normalizeSeasonId } = require('./nhlSeasonIdentity')
const { getSeedTeams } = require('./powerRatingsService')
const {
  STARTING_MODES,
  buildStartingState,
  calculateMetrics,
} = require('./baseModelCalibrationService')
const {
  WINNERS,
  calculatePregameProbability,
  calculateRatingUpdate,
  createRatingEngineConfiguration,
} = require('./powerRatingEngine')

const CURRENT_RANKING_SEASON_IDS = Object.freeze([
  '20232024',
  '20242025',
  '20252026',
])
const BACKTEST_TARGET_SEASON_IDS = CURRENT_RANKING_SEASON_IDS
const DEFAULT_ADJUSTMENTS = Object.freeze([0, 0.25, 0.5, 0.75, 1])
const MAX_CUSTOM_ADJUSTMENT = 5
const REQUIRED_SEASON_IDS = Object.freeze([
  '20202021',
  '20212022',
  '20222023',
  ...CURRENT_RANKING_SEASON_IDS,
])
const RESULT_TYPES = Object.freeze({
  OT: 'overtime',
  REG: 'regulation',
  SO: 'shootout',
})
const TIER_ADJUSTMENT_SIGN = Object.freeze({
  Normal: 0,
  Strong: 1,
  Weak: -1,
})
const TIER_BOUNDARY_CONFIG = Object.freeze({
  effectiveTieTolerance: 0.001,
  gapComparisonEpsilon: 1e-12,
  maximumMinimumTierSize: 6,
  method: 'local_gap_aware',
  searchRadius: 3,
  version: 'home-points-local-gap-v1',
})

class HomeAdvantageCalibrationError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'HomeAdvantageCalibrationError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const round = (value, decimals = 8) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const getMedian = (values) => {
  const finiteValues = values.filter(Number.isFinite).sort((left, right) => left - right)

  if (finiteValues.length === 0) {
    return null
  }

  const middle = Math.floor(finiteValues.length / 2)

  return finiteValues.length % 2 === 0
    ? (finiteValues[middle - 1] + finiteValues[middle]) / 2
    : finiteValues[middle]
}

const getSeasonDefinition = (seasonId) => {
  const normalizedId = normalizeSeasonId(seasonId)
  const season = FALLBACK_SEASONS.find((candidate) => candidate.id === normalizedId)

  if (!season) {
    throw new HomeAdvantageCalibrationError(
      'Season is not part of the Phase 2 home-advantage calibration window.',
      400,
      { seasonId: normalizedId || seasonId },
    )
  }

  return {
    endDate: season.endDate,
    expectedApproximateGames: normalizedId === '20202021' ? 868 : 1312,
    id: normalizedId,
    label: getSeasonLabel(normalizedId),
    startDate: season.startDate,
  }
}

const getRequiredSeasonDefinitions = () => REQUIRED_SEASON_IDS.map(getSeasonDefinition)

const getPriorSeasonIds = (targetSeasonId, count = 3) => {
  const startYear = Number(normalizeSeasonId(targetSeasonId).slice(0, 4))

  return Array.from({ length: count }, (_item, index) => {
    const priorStart = startYear - count + index
    return `${priorStart}${priorStart + 1}`
  })
}

const normalizeTeam = (team = {}) => {
  const teamId = getNhlTeamIdentity(
    team.teamId,
    team.id,
    team.abbreviation,
    team.teamName,
    team.name,
  )

  return teamId
    ? {
        abbreviation: teamId,
        teamId,
        teamName: team.teamName ?? team.name ?? teamId,
      }
    : null
}

const buildTeamDirectory = (teams = []) => {
  const normalizedTeams = teams.map(normalizeTeam).filter(Boolean)
  const teamsById = new Map(normalizedTeams.map((team) => [team.teamId, team]))

  return { teams: normalizedTeams, teamsById }
}

const getGameSeasonId = (game = {}) =>
  normalizeSeasonId(game.seasonId ?? String(game.season ?? ''))

const getGameTeamId = (game, side) =>
  getNhlTeamIdentity(
    game?.[`${side}TeamId`],
    game?.[`${side}TeamAbbreviation`],
    game?.[`${side}Team`]?.abbrev,
    game?.[`${side}Team`]?.abbreviation,
    game?.[`${side}Team`]?.name,
  )

const getGameScore = (game, side) => {
  const score = Number(game?.[`${side}Score`] ?? game?.[`${side}Team`]?.score)

  return Number.isInteger(score) && score >= 0 ? score : null
}

const getGameResultType = (game = {}) =>
  game.resultType ?? RESULT_TYPES[game.gameOutcome?.lastPeriodType] ?? null

const getGameTimestamp = (game = {}) => {
  const timestamp = Date.parse(game.startTimeUTC ?? game.gameDate ?? '')

  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

const normalizeHistoricalGame = (game, teamsById) => {
  if (Number(game?.gameType) !== 2) {
    return null
  }

  const homeTeamId = getGameTeamId(game, 'home')
  const awayTeamId = getGameTeamId(game, 'away')
  const homeScore = getGameScore(game, 'home')
  const awayScore = getGameScore(game, 'away')
  const resultType = getGameResultType(game)
  const seasonId = getGameSeasonId(game)

  if (
    !teamsById.has(homeTeamId) ||
    !teamsById.has(awayTeamId) ||
    homeScore === null ||
    awayScore === null ||
    homeScore === awayScore ||
    !Object.values(RESULT_TYPES).includes(resultType) ||
    !seasonId
  ) {
    return null
  }

  return {
    awayScore,
    awayTeamId,
    gameId: String(game.gameId ?? game.id ?? ''),
    homeScore,
    homeTeamId,
    resultType,
    seasonId,
    timestamp: getGameTimestamp(game),
  }
}

const createLocationStats = () => ({
  gamesPlayed: 0,
  losses: 0,
  overtimeLosses: 0,
  points: 0,
  wins: 0,
})

const calculateLocationRates = (stats) => ({
  ...stats,
  pointsPercentage: stats.gamesPlayed > 0
    ? stats.points / (stats.gamesPlayed * 2)
    : null,
  winPercentage: stats.gamesPlayed > 0
    ? stats.wins / stats.gamesPlayed
    : null,
})

const recordTeamResult = (stats, { isWinner, resultType }) => {
  stats.gamesPlayed += 1

  if (isWinner) {
    stats.wins += 1
    stats.points += 2
    return
  }

  if (resultType === 'regulation') {
    stats.losses += 1
    return
  }

  stats.overtimeLosses += 1
  stats.points += 1
}

const compareRankedTeams = (left, right) => {
  const compareNullableDescending = (leftValue, rightValue) => {
    const leftFinite = Number.isFinite(leftValue)
    const rightFinite = Number.isFinite(rightValue)

    if (leftFinite && rightFinite) {
      return rightValue - leftValue
    }

    if (leftFinite !== rightFinite) {
      return leftFinite ? -1 : 1
    }

    return 0
  }
  const pointsDifference = compareNullableDescending(
    left.homePointsAdvantage,
    right.homePointsAdvantage,
  )

  if (pointsDifference !== 0) {
    return pointsDifference
  }

  return left.teamName.localeCompare(right.teamName) ||
    left.teamId.localeCompare(right.teamId)
}

const getMinimumTierSize = (teamCount) => {
  if (teamCount < 3) {
    return 0
  }

  return Math.min(
    TIER_BOUNDARY_CONFIG.maximumMinimumTierSize,
    Math.floor(teamCount / 3),
  )
}

const buildBoundaryCandidate = (ranked, cutIndex, targetRank) => {
  const upperTeam = ranked[cutIndex - 1]
  const lowerTeam = ranked[cutIndex]
  const upperValue = upperTeam?.homePointsAdvantage
  const lowerValue = lowerTeam?.homePointsAdvantage
  const hasNumericGap = Number.isFinite(upperValue) && Number.isFinite(lowerValue)
  const gap = hasNumericGap ? upperValue - lowerValue : null
  const splitsEffectiveTie = hasNumericGap &&
    gap <= TIER_BOUNDARY_CONFIG.effectiveTieTolerance

  return {
    cutIndex,
    distanceFromTarget: Math.abs(cutIndex - targetRank),
    gap,
    hasNumericGap,
    isLocal:
      Math.abs(cutIndex - targetRank) <= TIER_BOUNDARY_CONFIG.searchRadius,
    isMeaningful: hasNumericGap &&
      gap > TIER_BOUNDARY_CONFIG.effectiveTieTolerance,
    lowerTeam,
    splitsEffectiveTie,
    upperTeam,
  }
}

const compareLargestLocalGap = (left, right) => {
  const gapDifference = right.gap - left.gap

  return Math.abs(gapDifference) > TIER_BOUNDARY_CONFIG.gapComparisonEpsilon
    ? gapDifference
    : left.distanceFromTarget - right.distanceFromTarget ||
        left.cutIndex - right.cutIndex
}

const compareClosestValidBoundary = (left, right) => {
  const distanceDifference = left.distanceFromTarget - right.distanceFromTarget

  if (distanceDifference !== 0) {
    return distanceDifference
  }

  const gapDifference = (right.gap ?? Number.NEGATIVE_INFINITY) -
    (left.gap ?? Number.NEGATIVE_INFINITY)

  return Number.isFinite(gapDifference) &&
    Math.abs(gapDifference) > TIER_BOUNDARY_CONFIG.gapComparisonEpsilon
    ? gapDifference
    : left.cutIndex - right.cutIndex
}

const getOrderedBoundaryCandidates = ({ maximumCut, minimumCut, ranked, targetRank }) => {
  const candidates = []

  for (let cutIndex = minimumCut; cutIndex <= maximumCut; cutIndex += 1) {
    candidates.push(buildBoundaryCandidate(ranked, cutIndex, targetRank))
  }

  const validCandidates = candidates.filter((candidate) => !candidate.splitsEffectiveTie)
  const localMeaningfulGaps = validCandidates
    .filter((candidate) => candidate.isLocal && candidate.isMeaningful)
    .sort(compareLargestLocalGap)
  const largestGap = localMeaningfulGaps[0]?.gap
  const equallyLargestGaps = localMeaningfulGaps.filter(
    (candidate) =>
      largestGap - candidate.gap <= TIER_BOUNDARY_CONFIG.gapComparisonEpsilon,
  )

  if (localMeaningfulGaps.length > 0 && equallyLargestGaps.length === 1) {
    localMeaningfulGaps.forEach((candidate) => {
      candidate.selection = 'largest_meaningful_local_gap'
    })
    const localGapIndexes = new Set(
      localMeaningfulGaps.map((candidate) => candidate.cutIndex),
    )
    const fallbacks = validCandidates
      .filter((candidate) => !localGapIndexes.has(candidate.cutIndex))
      .sort(compareClosestValidBoundary)

    fallbacks.forEach((candidate) => {
      candidate.selection = 'closest_valid_fallback'
    })
    return [...localMeaningfulGaps, ...fallbacks]
  }

  return validCandidates.sort(compareClosestValidBoundary).map((candidate) => ({
    ...candidate,
    selection: 'closest_valid_fallback',
  }))
}

const buildBoundaryDiagnostic = (candidate, targetRank) => ({
  boundaryAfterRank: candidate.cutIndex,
  gap: candidate.gap,
  lower: {
    homePointsAdvantage: candidate.lowerTeam?.homePointsAdvantage ?? null,
    rank: candidate.cutIndex + 1,
    teamId: candidate.lowerTeam?.teamId ?? null,
    teamName: candidate.lowerTeam?.teamName ?? null,
  },
  selection: candidate.selection,
  targetRank,
  upper: {
    homePointsAdvantage: candidate.upperTeam?.homePointsAdvantage ?? null,
    rank: candidate.cutIndex,
    teamId: candidate.upperTeam?.teamId ?? null,
    teamName: candidate.upperTeam?.teamName ?? null,
  },
})

const classifyHomeAdvantageTiers = (rows) => {
  const ranked = [...rows].sort(compareRankedTeams)
  const teamCount = ranked.length
  const minimumTierSize = getMinimumTierSize(teamCount)

  if (teamCount < 3 || minimumTierSize < 1) {
    throw new HomeAdvantageCalibrationError(
      'At least three teams are required to classify home-advantage tiers.',
      422,
    )
  }

  const strongTargetRank = Math.round(teamCount / 3)
  const normalWeakTargetRank = Math.round((teamCount * 2) / 3)
  const strongCandidates = getOrderedBoundaryCandidates({
    maximumCut: teamCount - minimumTierSize * 2,
    minimumCut: minimumTierSize,
    ranked,
    targetRank: strongTargetRank,
  })
  let selectedStrong = null
  let selectedNormalWeak = null

  for (const strongCandidate of strongCandidates) {
    const normalWeakCandidates = getOrderedBoundaryCandidates({
      maximumCut: teamCount - minimumTierSize,
      minimumCut: strongCandidate.cutIndex + minimumTierSize,
      ranked,
      targetRank: normalWeakTargetRank,
    })

    if (normalWeakCandidates.length > 0) {
      selectedStrong = strongCandidate
      selectedNormalWeak = normalWeakCandidates[0]
      break
    }
  }

  if (!selectedStrong || !selectedNormalWeak) {
    throw new HomeAdvantageCalibrationError(
      'Home-advantage tiers could not be formed without splitting an effective tie.',
      422,
      {
        effectiveTieTolerance: TIER_BOUNDARY_CONFIG.effectiveTieTolerance,
        minimumTierSize,
        teamCount,
      },
    )
  }

  const teams = ranked.map((row, index) => ({
    ...row,
    rank: index + 1,
    tier: index < selectedStrong.cutIndex
      ? 'Strong'
      : index < selectedNormalWeak.cutIndex
        ? 'Normal'
        : 'Weak',
  }))
  const tierSizes = {
    normal: selectedNormalWeak.cutIndex - selectedStrong.cutIndex,
    strong: selectedStrong.cutIndex,
    weak: teamCount - selectedNormalWeak.cutIndex,
  }

  return {
    teams,
    tierBoundaries: {
      effectiveTieTolerance: TIER_BOUNDARY_CONFIG.effectiveTieTolerance,
      method: TIER_BOUNDARY_CONFIG.method,
      minimumTierSize,
      normalWeak: buildBoundaryDiagnostic(
        selectedNormalWeak,
        normalWeakTargetRank,
      ),
      searchRadius: TIER_BOUNDARY_CONFIG.searchRadius,
      strongNormal: buildBoundaryDiagnostic(selectedStrong, strongTargetRank),
      version: TIER_BOUNDARY_CONFIG.version,
    },
    tierSizes,
  }
}

const buildTierSummary = (rankedTeams) =>
  ['Strong', 'Normal', 'Weak'].map((tier) => {
    const teams = rankedTeams.filter((team) => team.tier === tier)
    const advantages = teams.map((team) => team.homePointsAdvantage)
    const finiteAdvantages = advantages.filter(Number.isFinite)

    return {
      averageHomePointsAdvantage: finiteAdvantages.length > 0
        ? round(
            finiteAdvantages.reduce((sum, value) => sum + value, 0) /
              finiteAdvantages.length,
          )
        : null,
      medianHomePointsAdvantage: round(getMedian(advantages)),
      teamCount: teams.length,
      tier,
    }
  })

const aggregateHomePerformance = ({ games = [], seasonIds, teams = [] }) => {
  const { teams: normalizedTeams, teamsById } = buildTeamDirectory(teams)
  const selectedSeasonIds = new Set((seasonIds ?? []).map(normalizeSeasonId))
  const statsByTeam = new Map(
    normalizedTeams.map((team) => [
      team.teamId,
      { away: createLocationStats(), home: createLocationStats(), team },
    ]),
  )
  let gamesIncluded = 0
  let gamesSkipped = 0

  games.forEach((game) => {
    const normalizedGame = normalizeHistoricalGame(game, teamsById)

    if (!normalizedGame || !selectedSeasonIds.has(normalizedGame.seasonId)) {
      gamesSkipped += 1
      return
    }

    const homeWon = normalizedGame.homeScore > normalizedGame.awayScore
    recordTeamResult(statsByTeam.get(normalizedGame.homeTeamId).home, {
      isWinner: homeWon,
      resultType: normalizedGame.resultType,
    })
    recordTeamResult(statsByTeam.get(normalizedGame.awayTeamId).away, {
      isWinner: !homeWon,
      resultType: normalizedGame.resultType,
    })
    gamesIncluded += 1
  })

  const rows = normalizedTeams.map((team) => {
    const stats = statsByTeam.get(team.teamId)
    const home = calculateLocationRates(stats.home)
    const away = calculateLocationRates(stats.away)

    return {
      abbreviation: team.abbreviation,
      away,
      home,
      homePointsAdvantage:
        home.pointsPercentage === null || away.pointsPercentage === null
          ? null
          : home.pointsPercentage - away.pointsPercentage,
      homeWinAdvantage:
        home.winPercentage === null || away.winPercentage === null
          ? null
          : home.winPercentage - away.winPercentage,
      teamId: team.teamId,
      teamName: team.teamName,
    }
  })
  const classification = classifyHomeAdvantageTiers(rows)
  const rankedTeams = classification.teams
  const leagueHome = calculateLocationRates(
    rows.reduce((total, row) => {
      Object.keys(total).forEach((field) => { total[field] += row.home[field] })
      return total
    }, createLocationStats()),
  )
  const leagueAway = calculateLocationRates(
    rows.reduce((total, row) => {
      Object.keys(total).forEach((field) => { total[field] += row.away[field] })
      return total
    }, createLocationStats()),
  )

  return {
    aggregationMethod: 'Raw games are pooled across seasons before percentages are calculated.',
    gamesIncluded,
    gamesSkipped,
    league: {
      awayPointsPercentage: leagueAway.pointsPercentage,
      awayWinPercentage: leagueAway.winPercentage,
      homePointsPercentage: leagueHome.pointsPercentage,
      homeWinPercentage: leagueHome.winPercentage,
    },
    seasonIds: [...selectedSeasonIds],
    teams: rankedTeams,
    tierBoundaries: classification.tierBoundaries,
    tierSizes: classification.tierSizes,
    tierSummary: buildTierSummary(rankedTeams),
  }
}

const buildTierStability = (currentTeams, previousTeams) => {
  const previousById = new Map(previousTeams.map((team) => [team.teamId, team]))
  const teams = currentTeams.map((current) => {
    const previous = previousById.get(current.teamId)
    const hasData = current.home.gamesPlayed > 0 && previous?.home.gamesPlayed > 0

    return {
      currentTier: current.tier,
      previousTier: hasData ? previous.tier : null,
      status: !hasData ? 'Unavailable' : current.tier === previous.tier ? 'Stable' : 'Changed',
      teamId: current.teamId,
      teamName: current.teamName,
    }
  })
  const getRetention = (tier) => {
    const eligible = teams.filter((team) => team.previousTier === tier)
    const retained = eligible.filter((team) => team.currentTier === tier).length

    return {
      eligible: eligible.length,
      rate: eligible.length > 0 ? round(retained / eligible.length) : null,
      retained,
    }
  }

  return {
    previousWindowSeasonIds: getPriorSeasonIds('20252026'),
    strongRetention: getRetention('Strong'),
    teams,
    weakRetention: getRetention('Weak'),
  }
}

const buildHistoricalTierSnapshots = ({ gamesBySeason, teams }) =>
  BACKTEST_TARGET_SEASON_IDS.map((targetSeasonId) => {
    const sourceSeasonIds = getPriorSeasonIds(targetSeasonId)
    const sourceGames = sourceSeasonIds.flatMap(
      (seasonId) => gamesBySeason.get(seasonId) ?? [],
    )
    const analysis = aggregateHomePerformance({
      games: sourceGames,
      seasonIds: sourceSeasonIds,
      teams,
    })
    const tiers = Object.freeze(
      Object.fromEntries(analysis.teams.map((team) => [team.teamId, team.tier])),
    )

    return Object.freeze({
      assignedBeforeReplay: true,
      sourceSeasonIds: Object.freeze([...sourceSeasonIds]),
      targetSeasonId,
      tierBoundaries: analysis.tierBoundaries,
      tierSizes: analysis.tierSizes,
      tiers,
    })
  })

const buildReplayGames = ({ games, seasonId, teams }) => {
  const { teamsById } = buildTeamDirectory(teams)

  return games
    .map((game) => normalizeHistoricalGame(game, teamsById))
    .filter((game) => game?.seasonId === seasonId)
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.gameId.localeCompare(right.gameId),
    )
}

const buildReplayStartingState = (teams) =>
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

const getTierHomeAdvantageAdjustment = (tier, adjustment) =>
  (TIER_ADJUSTMENT_SIGN[tier] ?? 0) * adjustment

const replaySeasonWithTierAdjustment = ({ adjustment, games, snapshot, teams }) => {
  const ratingState = buildReplayStartingState(teams)
  const replayGames = buildReplayGames({
    games,
    seasonId: snapshot.targetSeasonId,
    teams,
  })
  const configuration = createRatingEngineConfiguration({
    kFactor: BASE_MODEL_V1.kFactor,
    overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
    regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
    shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
  })
  const predictions = []

  replayGames.forEach((game) => {
    const home = ratingState.get(game.homeTeamId)
    const away = ratingState.get(game.awayTeamId)
    const tier = snapshot.tiers[game.homeTeamId]
    const effectiveHomeAdvantage =
      BASE_MODEL_V1.baseHomeAdvantage +
      getTierHomeAdvantageAdjustment(tier, adjustment)
    const probability = calculatePregameProbability({
      automaticAdjustments: {},
      awayRating: away.finalRating,
      homeAdvantage: effectiveHomeAdvantage,
      homeRating: home.finalRating,
      probabilityScale: BASE_MODEL_V1.probabilityScale,
    })
    const winner = game.homeScore > game.awayScore ? WINNERS.HOME : WINNERS.AWAY
    const actualHomeWin = winner === WINNERS.HOME ? 1 : 0

    predictions.push({
      actualHomeWin,
      effectiveHomeAdvantage,
      favoriteConfidence: Math.max(
        probability.homeProbability,
        probability.awayProbability,
      ),
      gameId: game.gameId,
      homeProbability: probability.homeProbability,
      homeTeamId: game.homeTeamId,
      homeTier: tier,
      predictedCorrect:
        (probability.homeProbability >= 0.5 && actualHomeWin === 1) ||
        (probability.homeProbability < 0.5 && actualHomeWin === 0),
    })
    const update = calculateRatingUpdate({
      awayExpectedProbability: probability.awayProbability,
      configuration,
      homeExpectedProbability: probability.homeProbability,
      resultType: game.resultType,
      winner,
    })

    home.finalRating += update.homeDelta
    away.finalRating += update.awayDelta
    home.gamesProcessed += 1
    away.gamesProcessed += 1
  })

  if (predictions.length === 0) {
    throw new HomeAdvantageCalibrationError(
      `No regular-season games were available to replay for ${snapshot.targetSeasonId}.`,
      409,
      { seasonId: snapshot.targetSeasonId },
    )
  }

  return {
    metrics: calculateMetrics(predictions),
    predictions,
    ratingState,
  }
}

const calculateStability = (seasonBrierScores) => {
  if (seasonBrierScores.length < 2) {
    return { brierRange: null, brierStandardDeviation: null, level: 'not_assessed' }
  }

  const average = seasonBrierScores.reduce((sum, score) => sum + score, 0) /
    seasonBrierScores.length
  const range = Math.max(...seasonBrierScores) - Math.min(...seasonBrierScores)
  const standardDeviation = Math.sqrt(
    seasonBrierScores.reduce((sum, score) => sum + (score - average) ** 2, 0) /
      seasonBrierScores.length,
  )

  return {
    brierRange: round(range),
    brierStandardDeviation: round(standardDeviation),
    level: range <= 0.01 && standardDeviation <= 0.005
      ? 'stable'
      : range <= 0.02 && standardDeviation <= 0.01
        ? 'mixed'
        : 'unstable',
  }
}

const buildAdjustmentComparison = ({ adjustment, gamesBySeason, snapshots, teams }) => {
  const replays = snapshots.map((snapshot) => {
    const replay = replaySeasonWithTierAdjustment({
      adjustment,
      games: gamesBySeason.get(snapshot.targetSeasonId) ?? [],
      snapshot,
      teams,
    })

    return { replay, snapshot }
  })
  const seasonResults = replays.map(({ replay, snapshot }) => ({
    games: replay.predictions.length,
    metrics: {
      accuracy: replay.metrics.accuracy.rate,
      brierScore: replay.metrics.brierScore,
      expectedCalibrationError: replay.metrics.expectedCalibrationError,
      logLoss: replay.metrics.logLoss,
    },
    seasonId: snapshot.targetSeasonId,
    tierSizes: snapshot.tierSizes,
  }))
  const predictions = replays.flatMap(({ replay, snapshot }) =>
    replay.predictions.map((prediction) => ({
      ...prediction,
      seasonId: snapshot.targetSeasonId,
    })),
  )
  const metrics = calculateMetrics(predictions)
  const seasonBrierScores = seasonResults.map((result) => result.metrics.brierScore)
  const averageSeasonBrier = seasonBrierScores.reduce((sum, score) => sum + score, 0) /
    seasonBrierScores.length
  const worstSeason = [...seasonResults].sort(
    (left, right) => right.metrics.brierScore - left.metrics.brierScore,
  )[0]

  return {
    adjustment,
    averageSeasonBrier: round(averageSeasonBrier),
    effectiveHomeAdvantage: {
      normal: BASE_MODEL_V1.baseHomeAdvantage,
      strong: round(BASE_MODEL_V1.baseHomeAdvantage + adjustment),
      weak: round(BASE_MODEL_V1.baseHomeAdvantage - adjustment),
    },
    metrics: {
      accuracy: metrics.accuracy.rate,
      brierScore: metrics.brierScore,
      expectedCalibrationError: metrics.expectedCalibrationError,
      logLoss: metrics.logLoss,
    },
    seasonResults,
    stability: calculateStability(seasonBrierScores),
    worstSeason: {
      brierScore: worstSeason.metrics.brierScore,
      seasonId: worstSeason.seasonId,
    },
  }
}

const compareAdjustments = ({ adjustments, gamesBySeason, snapshots, teams }) => {
  const comparisons = adjustments.map((adjustment) =>
    buildAdjustmentComparison({ adjustment, gamesBySeason, snapshots, teams }),
  )
  const baseline = comparisons.find((comparison) => comparison.adjustment === 0)

  comparisons.forEach((comparison) => {
    comparison.delta = {
      brierScore: round(comparison.metrics.brierScore - baseline.metrics.brierScore),
      logLoss: round(comparison.metrics.logLoss - baseline.metrics.logLoss),
    }
    comparison.seasonsBeatingBaseline = comparison.seasonResults.filter((season) => {
      const baselineSeason = baseline.seasonResults.find(
        (candidate) => candidate.seasonId === season.seasonId,
      )
      return season.metrics.brierScore < baselineSeason.metrics.brierScore
    }).length
  })
  const best = [...comparisons].sort(
    (left, right) =>
      left.metrics.brierScore - right.metrics.brierScore ||
      left.adjustment - right.adjustment,
  )[0]

  comparisons.forEach((comparison) => {
    comparison.best = comparison === best
  })

  return comparisons
}

const normalizeAdjustmentPayload = (payload = {}) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HomeAdvantageCalibrationError('Request body must be an object.', 400)
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => field !== 'customAdjustment',
  )

  if (unsupportedFields.length > 0) {
    throw new HomeAdvantageCalibrationError(
      'Request contains unsupported fields.',
      400,
      { unsupportedFields },
    )
  }

  if (payload.customAdjustment === undefined || payload.customAdjustment === '') {
    return [...DEFAULT_ADJUSTMENTS]
  }

  const customAdjustment = Number(payload.customAdjustment)

  if (
    !Number.isFinite(customAdjustment) ||
    customAdjustment < 0 ||
    customAdjustment > MAX_CUSTOM_ADJUSTMENT
  ) {
    throw new HomeAdvantageCalibrationError(
      `customAdjustment must be between 0 and ${MAX_CUSTOM_ADJUSTMENT}.`,
      400,
      { field: 'customAdjustment' },
    )
  }

  return [...new Set([...DEFAULT_ADJUSTMENTS, customAdjustment])].sort(
    (left, right) => left - right,
  )
}

const flattenGames = (gamesBySeason, seasonIds) =>
  seasonIds.flatMap((seasonId) => gamesBySeason.get(seasonId) ?? [])

const loadAnalysisContext = async (options = {}) => {
  const seasonDefinitions = getRequiredSeasonDefinitions()
  const teams = await (options.teamsProvider ?? getSeedTeams)()
  const statuses = await (
    options.historicalStatusProvider ?? historicalNhlDataService.getHistoricalSeasonStatuses
  )(seasonDefinitions, { repository: options.historicalRepository })
  const statusById = new Map(
    (statuses ?? []).map((status) => [status.seasonId, status]),
  )
  const readySeasonIds = REQUIRED_SEASON_IDS.filter(
    (seasonId) => statusById.get(seasonId)?.status === 'ready',
  )
  const loaded = readySeasonIds.length > 0
    ? await (
        options.historicalLoadProvider ?? historicalNhlDataService.loadPreparedSeasons
      )(readySeasonIds, { repository: options.historicalRepository })
    : { gamesBySeason: new Map() }

  return {
    gamesBySeason: loaded.gamesBySeason ?? new Map(),
    seasonDefinitions,
    statusById,
    teams,
  }
}

const buildSeasonReadiness = ({ seasonDefinitions, statusById }) =>
  seasonDefinitions.map((season) => ({
    ...season,
    historicalDataset:
      statusById.get(season.id) ?? historicalNhlDataService.makeDatasetStatus(null, season),
    purposes: [
      ...(CURRENT_RANKING_SEASON_IDS.includes(season.id)
        ? ['current_ranking', 'backtest_target']
        : []),
      ...(BACKTEST_TARGET_SEASON_IDS.some((target) =>
        getPriorSeasonIds(target).includes(season.id))
        ? ['tier_history']
        : []),
    ],
  }))

const getHomeAdvantageCalibrationOptions = async (userId, options = {}) => {
  if (!userId) {
    throw new HomeAdvantageCalibrationError('Authenticated userId is required.', 401)
  }

  const context = await loadAnalysisContext(options)
  const seasons = buildSeasonReadiness(context)
  const currentReady = CURRENT_RANKING_SEASON_IDS.every(
    (seasonId) => context.statusById.get(seasonId)?.status === 'ready',
  )
  const backtestReady = REQUIRED_SEASON_IDS.every(
    (seasonId) => context.statusById.get(seasonId)?.status === 'ready',
  )
  const currentAnalysis = currentReady
    ? aggregateHomePerformance({
        games: flattenGames(context.gamesBySeason, CURRENT_RANKING_SEASON_IDS),
        seasonIds: CURRENT_RANKING_SEASON_IDS,
        teams: context.teams,
      })
    : null
  const previousWindowSeasonIds = getPriorSeasonIds('20252026')
  const stabilityReady = previousWindowSeasonIds.every(
    (seasonId) => context.statusById.get(seasonId)?.status === 'ready',
  )
  const previousAnalysis = stabilityReady
    ? aggregateHomePerformance({
        games: flattenGames(context.gamesBySeason, previousWindowSeasonIds),
        seasonIds: previousWindowSeasonIds,
        teams: context.teams,
      })
    : null

  return {
    backtestPlan: BACKTEST_TARGET_SEASON_IDS.map((targetSeasonId) => ({
      leakageSafe: true,
      missingSeasonIds: getPriorSeasonIds(targetSeasonId).filter(
        (seasonId) => context.statusById.get(seasonId)?.status !== 'ready',
      ),
      sourceSeasonIds: getPriorSeasonIds(targetSeasonId),
      targetSeasonId,
      targetStatus: context.statusById.get(targetSeasonId)?.status ?? 'not_imported',
    })),
    currentAnalysis,
    defaults: {
      adjustmentOptions: DEFAULT_ADJUSTMENTS,
      baseHomeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      currentRankingSeasonIds: CURRENT_RANKING_SEASON_IDS,
      maxCustomAdjustment: MAX_CUSTOM_ADJUSTMENT,
      tierBoundaryConfig: TIER_BOUNDARY_CONFIG,
      modelParameters: {
        kFactor: BASE_MODEL_V1.kFactor,
        overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
        probabilityScale: BASE_MODEL_V1.probabilityScale,
        regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
        shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
        startingRatings: BASE_MODEL_V1.startingRatings,
      },
    },
    franchiseIdentity: {
      arizonaUtah:
        'Arizona Coyotes (ARI), Utah Hockey Club, and Utah Mammoth records are explicitly normalized to the current UTA franchise. No other franchises are merged.',
      method: 'centralized_nhl_team_identity',
    },
    isolation: {
      historicalSource: 'HistoricalNhlGame / HistoricalSeasonDataset',
      productionSettingsRead: false,
      productionWrites: false,
    },
    modelVersion: BASE_MODEL_V1.modelVersion,
    readiness: {
      backtestReady,
      currentRankingReady: currentReady,
      missingBacktestSeasonIds: REQUIRED_SEASON_IDS.filter(
        (seasonId) => context.statusById.get(seasonId)?.status !== 'ready',
      ),
      missingCurrentRankingSeasonIds: CURRENT_RANKING_SEASON_IDS.filter(
        (seasonId) => context.statusById.get(seasonId)?.status !== 'ready',
      ),
      stabilityReady,
    },
    seasons,
    stability:
      currentAnalysis && previousAnalysis
        ? buildTierStability(currentAnalysis.teams, previousAnalysis.teams)
        : null,
    tierBoundaries: currentAnalysis?.tierBoundaries ?? {
      ...TIER_BOUNDARY_CONFIG,
      minimumTierSize: null,
      normalWeak: null,
      strongNormal: null,
    },
  }
}

const runHomeAdvantageCalibration = async (userId, payload, options = {}) => {
  if (!userId) {
    throw new HomeAdvantageCalibrationError('Authenticated userId is required.', 401)
  }

  const adjustments = normalizeAdjustmentPayload(payload)
  const context = await loadAnalysisContext(options)
  const missingSeasonIds = REQUIRED_SEASON_IDS.filter(
    (seasonId) => context.statusById.get(seasonId)?.status !== 'ready',
  )

  if (missingSeasonIds.length > 0) {
    throw new HomeAdvantageCalibrationError(
      'Leakage-safe backtesting requires additional prepared historical seasons.',
      409,
      { missingSeasonIds },
    )
  }

  const snapshots = buildHistoricalTierSnapshots({
    gamesBySeason: context.gamesBySeason,
    teams: context.teams,
  })
  const comparisons = compareAdjustments({
    adjustments,
    gamesBySeason: context.gamesBySeason,
    snapshots,
    teams: context.teams,
  })
  const currentAnalysis = aggregateHomePerformance({
    games: flattenGames(context.gamesBySeason, CURRENT_RANKING_SEASON_IDS),
    seasonIds: CURRENT_RANKING_SEASON_IDS,
    teams: context.teams,
  })

  return {
    comparisons,
    currentAnalysis,
    diagnostics: {
      baseHomeAdvantage: BASE_MODEL_V1.baseHomeAdvantage,
      classificationFrozenBeforeReplay: true,
      tierAlgorithmVersion: TIER_BOUNDARY_CONFIG.version,
      tierBoundaryConfig: TIER_BOUNDARY_CONFIG,
      modelParameters: {
        kFactor: BASE_MODEL_V1.kFactor,
        overtimeMultiplier: BASE_MODEL_V1.overtimeMultiplier,
        probabilityScale: BASE_MODEL_V1.probabilityScale,
        regulationMultiplier: BASE_MODEL_V1.regulationMultiplier,
        shootoutMultiplier: BASE_MODEL_V1.shootoutMultiplier,
        startingRatings: BASE_MODEL_V1.startingRatings,
        startingOrder:
          'Franchise-normalized alphabetical order, reset independently for every replay season.',
      },
      noFutureData: snapshots.every((snapshot) =>
        snapshot.sourceSeasonIds.every((sourceSeasonId) => sourceSeasonId < snapshot.targetSeasonId),
      ),
      productionWrites: false,
      ratingResetBetweenSeasons: true,
      testedAdjustments: adjustments,
    },
    experimental: true,
    modelVersion: BASE_MODEL_V1.modelVersion,
    snapshots: snapshots.map((snapshot) => ({
      assignedBeforeReplay: snapshot.assignedBeforeReplay,
      sourceSeasonIds: snapshot.sourceSeasonIds,
      targetSeasonId: snapshot.targetSeasonId,
      tierBoundaries: snapshot.tierBoundaries,
      tierSizes: snapshot.tierSizes,
    })),
  }
}

const prepareHomeAdvantageHistoricalSeason = async (
  userId,
  seasonId,
  payload,
  options = {},
) => {
  if (!userId) {
    throw new HomeAdvantageCalibrationError('Authenticated userId is required.', 401)
  }

  const season = getSeasonDefinition(seasonId)

  return (
    options.prepareProvider ?? historicalNhlDataService.prepareHistoricalSeason
  )(season.id, payload, {
    ...options,
    minimumPlausibleGames: season.id === '20202021' ? 800 : undefined,
    season,
  })
}

module.exports = {
  BACKTEST_TARGET_SEASON_IDS,
  CURRENT_RANKING_SEASON_IDS,
  DEFAULT_ADJUSTMENTS,
  HomeAdvantageCalibrationError,
  MAX_CUSTOM_ADJUSTMENT,
  REQUIRED_SEASON_IDS,
  TIER_BOUNDARY_CONFIG,
  aggregateHomePerformance,
  buildAdjustmentComparison,
  buildHistoricalTierSnapshots,
  buildTierStability,
  classifyHomeAdvantageTiers,
  compareAdjustments,
  compareRankedTeams,
  getHomeAdvantageCalibrationOptions,
  getMinimumTierSize,
  getPriorSeasonIds,
  getTierHomeAdvantageAdjustment,
  getRequiredSeasonDefinitions,
  normalizeAdjustmentPayload,
  normalizeHistoricalGame,
  prepareHomeAdvantageHistoricalSeason,
  replaySeasonWithTierAdjustment,
  runHomeAdvantageCalibration,
}
