export const SAVED_ANALYSES_STORAGE_KEY = 'nhl-edge-saved-analyses'

export const RESULT_OPTIONS = [
  {
    value: 'all',
    label: 'All',
  },
  {
    value: 'pending',
    label: 'Pending',
  },
  {
    value: 'win',
    label: 'Win',
  },
  {
    value: 'loss',
    label: 'Loss',
  },
  {
    value: 'push',
    label: 'Push',
  },
  {
    value: 'void',
    label: 'Void',
  },
]

export const BET_RESULT_OPTIONS = RESULT_OPTIONS.filter(
  (option) => option.value !== 'all',
)
const RESULT_VALUES = BET_RESULT_OPTIONS.map((option) => option.value)
const DEFAULT_STAKE = 1
const DEFAULT_RECOMMENDATION = 'NO BET'
const RECOMMENDATION_PRIORITY = {
  BET: 3,
  LEAN: 2,
  'NO BET': 1,
}

const toNumber = (value, fallback = 0) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const toText = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value : fallback

const toOdds = (value) => Math.max(toNumber(value, 1.01), 1.01)

const createId = () => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const normalizeResult = (result) =>
  RESULT_VALUES.includes(result) ? result : 'pending'

const normalizeStake = (stake) => Math.max(toNumber(stake, DEFAULT_STAKE), 0)

const normalizeAdjustments = (values = {}) => ({
  baseRating: toNumber(values.baseRating),
  marketOdds: toOdds(values.marketOdds),
  homeAdvantage: toNumber(values.homeAdvantage),
  injuries: toNumber(values.injuries),
  goalieAdjustment: toNumber(values.goalieAdjustment),
  recentForm: toNumber(values.recentForm),
  motivation: toNumber(values.motivation),
})

export const getRecommendedSide = (analysis) => {
  const homeRecommendation = analysis.homeRecommendation ?? DEFAULT_RECOMMENDATION
  const awayRecommendation = analysis.awayRecommendation ?? DEFAULT_RECOMMENDATION
  const homePriority = RECOMMENDATION_PRIORITY[homeRecommendation] ?? 0
  const awayPriority = RECOMMENDATION_PRIORITY[awayRecommendation] ?? 0

  if (homePriority > awayPriority) {
    return 'home'
  }

  if (awayPriority > homePriority) {
    return 'away'
  }

  return toNumber(analysis.homeEdge) >= toNumber(analysis.awayEdge)
    ? 'home'
    : 'away'
}

export const getRecommendedBet = (analysis) => {
  if (analysis.selectedSide) {
    return {
      side: analysis.selectedSide.homeAway,
      team: analysis.selectedSide.name,
      fairOdds: analysis.fairOdds,
      marketOdds: analysis.marketOdds,
      edge: analysis.probabilityEdge,
      oddsValuePercentage: analysis.oddsValuePercentage,
      recommendation: analysis.recommendation,
    }
  }

  const side = getRecommendedSide(analysis)
  const isHomeSide = side === 'home'

  return {
    side,
    team: isHomeSide ? analysis.homeTeam : analysis.awayTeam,
    fairOdds: isHomeSide ? analysis.homeFairOdds : analysis.awayFairOdds,
    marketOdds: isHomeSide ? analysis.homeMarketOdds : analysis.awayMarketOdds,
    edge: isHomeSide ? analysis.homeEdge : analysis.awayEdge,
    recommendation: isHomeSide
      ? analysis.homeRecommendation
      : analysis.awayRecommendation,
  }
}

export const calculateProfit = (analysis) => {
  const stake = normalizeStake(analysis.stake)
  const result = normalizeResult(analysis.result)
  const marketOdds = analysis.marketOdds ?? getRecommendedBet(analysis).marketOdds

  if (result === 'win') {
    return (marketOdds - 1) * stake
  }

  if (result === 'loss') {
    return -stake
  }

  return 0
}

export const createSavedAnalysis = ({ homeTeam, awayTeam, inputs, result }) => {
  const analysis = {
    id: createId(),
    dateTime: new Date().toISOString(),
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeFinalRating: result.homeFinalRating,
    awayFinalRating: result.awayFinalRating,
    homeWinProbability: result.homeWinProbability,
    awayWinProbability: result.awayWinProbability,
    homeFairOdds: result.homeFairOdds,
    awayFairOdds: result.awayFairOdds,
    homeMarketOdds: toOdds(inputs.home.marketOdds),
    awayMarketOdds: toOdds(inputs.away.marketOdds),
    homeEdge: result.homeEdge,
    awayEdge: result.awayEdge,
    homeRecommendation: result.homeRecommendation,
    awayRecommendation: result.awayRecommendation,
    adjustments: {
      home: normalizeAdjustments(inputs.home),
      away: normalizeAdjustments(inputs.away),
    },
    result: 'pending',
    stake: DEFAULT_STAKE,
  }

  return {
    ...analysis,
    recommendedSide: getRecommendedSide(analysis),
  }
}

const toTeamPayload = (team) => ({
  teamId: toText(team.id ?? team.teamId, ''),
  name: toText(team.name, ''),
  abbreviation: toText(team.abbreviation ?? team.id ?? team.teamId, ''),
})

const createAdjustmentsPayload = (inputs) => ({
  homeAdvantage: toNumber(inputs.home.homeAdvantage),
  homeInjuries: toNumber(inputs.home.injuries),
  awayInjuries: toNumber(inputs.away.injuries),
  homeGoalie: toNumber(inputs.home.goalieAdjustment),
  awayGoalie: toNumber(inputs.away.goalieAdjustment),
  homeRecentForm: toNumber(inputs.home.recentForm),
  awayRecentForm: toNumber(inputs.away.recentForm),
  homeMotivation: toNumber(inputs.home.motivation),
  awayMotivation: toNumber(inputs.away.motivation),
})

export const createBetPayloadFromGameAnalysis = ({
  awayTeam,
  gameId = '',
  homeTeam,
  inputs,
  result,
  scheduledStart = null,
}) => {
  const savedAnalysis = createSavedAnalysis({
    awayTeam,
    homeTeam,
    inputs,
    result,
  })
  const selectedSide = savedAnalysis.recommendedSide
  const selectedTeam = selectedSide === 'home' ? homeTeam : awayTeam
  const selectedMarket = selectedSide === 'home' ? 'home' : 'away'

  return {
    gameId,
    analyzedAt: savedAnalysis.dateTime,
    scheduledStart,
    homeTeam: toTeamPayload(homeTeam),
    awayTeam: toTeamPayload(awayTeam),
    selectedSide: {
      ...toTeamPayload(selectedTeam),
      homeAway: selectedSide,
    },
    modelProbability: savedAnalysis[`${selectedMarket}WinProbability`],
    fairOdds: savedAnalysis[`${selectedMarket}FairOdds`],
    marketOdds: savedAnalysis[`${selectedMarket}MarketOdds`],
    probabilityEdge: savedAnalysis[`${selectedMarket}Edge`],
    oddsValuePercentage:
      savedAnalysis[`${selectedMarket}MarketOdds`] /
        savedAnalysis[`${selectedMarket}FairOdds`] -
      1,
    recommendation: savedAnalysis[`${selectedMarket}Recommendation`],
    stake: savedAnalysis.stake,
    stakeType: 'units',
    sportsbook: '',
    closingOdds: null,
    result: savedAnalysis.result,
    profit: 0,
    notes: '',
    adjustments: createAdjustmentsPayload(inputs),
  }
}

export const normalizeSavedAnalysis = (analysis = {}, index = 0) => {
  const normalized = {
    id: toText(analysis.id, `analysis-${index}-${Date.now()}`),
    gameId: toText(analysis.gameId, ''),
    dateTime: toText(analysis.dateTime, new Date().toISOString()),
    scheduledStart: analysis.scheduledStart ?? null,
    homeTeam: toText(analysis.homeTeam, analysis.homeTeam?.name ?? 'Home Team'),
    awayTeam: toText(analysis.awayTeam, analysis.awayTeam?.name ?? 'Away Team'),
    homeTeamId: toText(analysis.homeTeamId, 'HOME'),
    awayTeamId: toText(analysis.awayTeamId, 'AWAY'),
    homeFinalRating: toNumber(analysis.homeFinalRating),
    awayFinalRating: toNumber(analysis.awayFinalRating),
    homeWinProbability: toNumber(analysis.homeWinProbability),
    awayWinProbability: toNumber(analysis.awayWinProbability),
    homeFairOdds: toOdds(analysis.homeFairOdds),
    awayFairOdds: toOdds(analysis.awayFairOdds),
    homeMarketOdds: toOdds(analysis.homeMarketOdds),
    awayMarketOdds: toOdds(analysis.awayMarketOdds),
    homeEdge: toNumber(analysis.homeEdge),
    awayEdge: toNumber(analysis.awayEdge),
    homeRecommendation: toText(
      analysis.homeRecommendation,
      DEFAULT_RECOMMENDATION,
    ),
    awayRecommendation: toText(
      analysis.awayRecommendation,
      DEFAULT_RECOMMENDATION,
    ),
    adjustments: {
      home: normalizeAdjustments(analysis.adjustments?.home),
      away: normalizeAdjustments(analysis.adjustments?.away),
    },
    result: normalizeResult(analysis.result),
    stake: normalizeStake(analysis.stake),
  }

  return {
    ...normalized,
    recommendedSide: getRecommendedSide(normalized),
  }
}

export const normalizeSavedAnalyses = (analyses) =>
  (Array.isArray(analyses) ? analyses : [])
    .map((analysis, index) => normalizeSavedAnalysis(analysis, index))
    .sort((analysisA, analysisB) => {
      const dateA = Date.parse(analysisA.dateTime)
      const dateB = Date.parse(analysisB.dateTime)

      return toNumber(dateB) - toNumber(dateA)
    })

export const loadSavedAnalyses = () => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const storedAnalyses = window.localStorage.getItem(
      SAVED_ANALYSES_STORAGE_KEY,
    )
    return normalizeSavedAnalyses(
      storedAnalyses ? JSON.parse(storedAnalyses) : [],
    )
  } catch {
    return []
  }
}

export const removeSavedAnalyses = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(SAVED_ANALYSES_STORAGE_KEY)
}

export const hasSavedAnalysesInLocalStorage = () =>
  loadSavedAnalyses().length > 0

const teamFromLegacy = (name, teamId) => ({
  id: teamId,
  name,
  abbreviation: teamId,
})

export const createBetPayloadFromSavedAnalysis = (analysis) => {
  const normalized = normalizeSavedAnalysis(analysis)
  const selectedSide = normalized.recommendedSide
  const selectedTeam =
    selectedSide === 'home'
      ? teamFromLegacy(normalized.homeTeam, normalized.homeTeamId)
      : teamFromLegacy(normalized.awayTeam, normalized.awayTeamId)
  const selectedMarket = selectedSide === 'home' ? 'home' : 'away'

  return {
    gameId: normalized.gameId ?? '',
    analyzedAt: normalized.dateTime,
    scheduledStart: normalized.scheduledStart ?? null,
    homeTeam: toTeamPayload(
      teamFromLegacy(normalized.homeTeam, normalized.homeTeamId),
    ),
    awayTeam: toTeamPayload(
      teamFromLegacy(normalized.awayTeam, normalized.awayTeamId),
    ),
    selectedSide: {
      ...toTeamPayload(selectedTeam),
      homeAway: selectedSide,
    },
    modelProbability: normalized[`${selectedMarket}WinProbability`],
    fairOdds: normalized[`${selectedMarket}FairOdds`],
    marketOdds: normalized[`${selectedMarket}MarketOdds`],
    probabilityEdge: normalized[`${selectedMarket}Edge`],
    oddsValuePercentage:
      normalized[`${selectedMarket}MarketOdds`] /
        normalized[`${selectedMarket}FairOdds`] -
      1,
    recommendation: normalized[`${selectedMarket}Recommendation`],
    stake: normalized.stake,
    stakeType: 'units',
    sportsbook: '',
    closingOdds: null,
    result: normalized.result,
    profit: calculateProfit(normalized),
    notes: '',
    adjustments: {
      homeAdvantage: normalized.adjustments.home.homeAdvantage,
      homeInjuries: normalized.adjustments.home.injuries,
      awayInjuries: normalized.adjustments.away.injuries,
      homeGoalie: normalized.adjustments.home.goalieAdjustment,
      awayGoalie: normalized.adjustments.away.goalieAdjustment,
      homeRecentForm: normalized.adjustments.home.recentForm,
      awayRecentForm: normalized.adjustments.away.recentForm,
      homeMotivation: normalized.adjustments.home.motivation,
      awayMotivation: normalized.adjustments.away.motivation,
    },
  }
}

const roundForSignature = (value) => Number(toNumber(value).toFixed(6))

export const getBetSignature = (bet) =>
  JSON.stringify({
    gameId: bet.gameId ?? '',
    homeTeamId: bet.homeTeam?.teamId ?? bet.homeTeamId ?? '',
    awayTeamId: bet.awayTeam?.teamId ?? bet.awayTeamId ?? '',
    selectedTeamId: bet.selectedSide?.teamId ?? '',
    selectedHomeAway: bet.selectedSide?.homeAway ?? '',
    modelProbability: roundForSignature(bet.modelProbability),
    fairOdds: roundForSignature(bet.fairOdds),
    marketOdds: roundForSignature(bet.marketOdds),
    probabilityEdge: roundForSignature(bet.probabilityEdge),
    recommendation: bet.recommendation ?? '',
    adjustments: bet.adjustments ?? {},
  })

export const normalizeBet = (bet = {}) => ({
  ...bet,
  id: toText(bet.id, ''),
  gameId: toText(bet.gameId, ''),
  analyzedAt: toText(bet.analyzedAt, new Date().toISOString()),
  scheduledStart: bet.scheduledStart ?? null,
  homeTeam: {
    teamId: toText(bet.homeTeam?.teamId, 'HOME'),
    name: toText(bet.homeTeam?.name, 'Home Team'),
    abbreviation: toText(bet.homeTeam?.abbreviation, 'HOME'),
  },
  awayTeam: {
    teamId: toText(bet.awayTeam?.teamId, 'AWAY'),
    name: toText(bet.awayTeam?.name, 'Away Team'),
    abbreviation: toText(bet.awayTeam?.abbreviation, 'AWAY'),
  },
  selectedSide: {
    teamId: toText(bet.selectedSide?.teamId, ''),
    name: toText(bet.selectedSide?.name, 'Selected Team'),
    abbreviation: toText(bet.selectedSide?.abbreviation, ''),
    homeAway: ['home', 'away'].includes(bet.selectedSide?.homeAway)
      ? bet.selectedSide.homeAway
      : 'home',
  },
  modelProbability: toNumber(bet.modelProbability),
  fairOdds: toOdds(bet.fairOdds),
  marketOdds: toOdds(bet.marketOdds),
  probabilityEdge: toNumber(bet.probabilityEdge),
  oddsValuePercentage: toNumber(bet.oddsValuePercentage),
  recommendation: toText(bet.recommendation, DEFAULT_RECOMMENDATION),
  stake: normalizeStake(bet.stake),
  stakeType: toText(bet.stakeType, 'units'),
  sportsbook: toText(bet.sportsbook, ''),
  closingOdds:
    bet.closingOdds === null ||
    bet.closingOdds === '' ||
    bet.closingOdds === undefined
      ? ''
      : toOdds(bet.closingOdds),
  result: normalizeResult(bet.result),
  profit: toNumber(bet.profit),
  notes: toText(bet.notes, ''),
  adjustments: {
    homeAdvantage: toNumber(bet.adjustments?.homeAdvantage),
    homeInjuries: toNumber(bet.adjustments?.homeInjuries),
    awayInjuries: toNumber(bet.adjustments?.awayInjuries),
    homeGoalie: toNumber(bet.adjustments?.homeGoalie),
    awayGoalie: toNumber(bet.adjustments?.awayGoalie),
    homeRecentForm: toNumber(bet.adjustments?.homeRecentForm),
    awayRecentForm: toNumber(bet.adjustments?.awayRecentForm),
    homeMotivation: toNumber(bet.adjustments?.homeMotivation),
    awayMotivation: toNumber(bet.adjustments?.awayMotivation),
  },
})

export const normalizeBets = (bets) =>
  (Array.isArray(bets) ? bets : [])
    .map((bet) => normalizeBet(bet))
    .sort((betA, betB) => {
      const dateA = Date.parse(betA.analyzedAt)
      const dateB = Date.parse(betB.analyzedAt)

      return toNumber(dateB) - toNumber(dateA)
    })
