import {
  MODEL_STATUSES,
  calculateExpectedValue,
  calculateImpliedProbability,
  getModelStatus,
  normalizeModelStatus,
  parseMarketOdds,
} from './calculateGame.js'

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
const DEFAULT_MODEL_STATUS = MODEL_STATUSES.NO_VALUE
const MODEL_STATUS_PRIORITY = {
  [MODEL_STATUSES.POSITIVE_VALUE]: 4,
  [MODEL_STATUSES.BELOW_THRESHOLD]: 2,
  [MODEL_STATUSES.NO_VALUE]: 1,
}

const toNumber = (value, fallback = 0) => {
  if (value === null || value === '' || value === undefined) {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const toNullableNumber = (value) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

const toText = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value : fallback

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toOdds = (value) => Math.max(toNumber(value, 1.01), 1.01)

const toNullableOdds = (value) => {
  const parsedOdds = toNullableNumber(value)

  return parsedOdds !== null && parsedOdds > 1 ? parsedOdds : null
}

const getSavedModelStatus = ({ expectedValue, modelStatus }) =>
  normalizeModelStatus(modelStatus) ??
  getModelStatus(expectedValue) ??
  MODEL_STATUSES.LEGACY

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
  storedInjuryImpact: toNumber(values.storedInjuryImpact),
  injuries: toNumber(values.injuries),
  goalieAdjustment: toNumber(values.goalieAdjustment),
  selectedGoalieId: toText(values.selectedGoalieId, ''),
  selectedGoalieName: toText(values.selectedGoalieName, ''),
  recentForm: toNumber(values.recentForm ?? values.restFatigue),
  restFatigue: toNumber(values.restFatigue ?? values.recentForm),
  motivation: toNumber(values.motivation),
  manualAdjustment: toNumber(values.manualAdjustment),
})

export const getRecommendedSide = (analysis) => {
  const homeModelStatus =
    normalizeModelStatus(analysis.homeModelStatus) ??
    normalizeModelStatus(analysis.homeRecommendation) ??
    DEFAULT_MODEL_STATUS
  const awayModelStatus =
    normalizeModelStatus(analysis.awayModelStatus) ??
    normalizeModelStatus(analysis.awayRecommendation) ??
    DEFAULT_MODEL_STATUS
  const homePriority = MODEL_STATUS_PRIORITY[homeModelStatus] ?? 0
  const awayPriority = MODEL_STATUS_PRIORITY[awayModelStatus] ?? 0

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
      expectedValue: analysis.expectedValue,
      modelStatus: analysis.modelStatus,
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
    expectedValue: isHomeSide
      ? analysis.homeExpectedValue
      : analysis.awayExpectedValue,
    modelStatus: isHomeSide ? analysis.homeModelStatus : analysis.awayModelStatus,
    recommendation: isHomeSide
      ? analysis.homeRecommendation
      : analysis.awayRecommendation,
  }
}

export const calculateProfit = (analysis) => {
  const stake = normalizeStake(analysis.stake)
  const result = normalizeResult(analysis.result)
  const marketOdds = analysis.marketOdds ?? getRecommendedBet(analysis).marketOdds

  if (!Number.isFinite(marketOdds) || marketOdds <= 1) {
    return 0
  }

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
    homeMarketOdds: parseMarketOdds(inputs.home.marketOdds),
    awayMarketOdds: parseMarketOdds(inputs.away.marketOdds),
    homeEdge: result.homeEdge,
    awayEdge: result.awayEdge,
    homeExpectedValue: result.homeExpectedValue,
    awayExpectedValue: result.awayExpectedValue,
    homeOddsDifference: result.homeOddsDifference,
    awayOddsDifference: result.awayOddsDifference,
    homeModelStatus: result.homeModelStatus,
    awayModelStatus: result.awayModelStatus,
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
  homeStoredInjuryImpact: toNumber(inputs.home.storedInjuryImpact),
  awayStoredInjuryImpact: toNumber(inputs.away.storedInjuryImpact),
  homeInjuries: toNumber(inputs.home.injuries),
  awayInjuries: toNumber(inputs.away.injuries),
  homeGoalie: toNumber(inputs.home.goalieAdjustment),
  awayGoalie: toNumber(inputs.away.goalieAdjustment),
  homeGoalieId: toText(inputs.home.selectedGoalieId, ''),
  homeGoalieName: toText(inputs.home.selectedGoalieName, ''),
  awayGoalieId: toText(inputs.away.selectedGoalieId, ''),
  awayGoalieName: toText(inputs.away.selectedGoalieName, ''),
  homeRecentForm: toNumber(inputs.home.restFatigue ?? inputs.home.recentForm),
  awayRecentForm: toNumber(inputs.away.restFatigue ?? inputs.away.recentForm),
  homeRestFatigue: toNumber(inputs.home.restFatigue ?? inputs.home.recentForm),
  awayRestFatigue: toNumber(inputs.away.restFatigue ?? inputs.away.recentForm),
  homeMotivation: toNumber(inputs.home.motivation),
  awayMotivation: toNumber(inputs.away.motivation),
  homeManualAdjustment: toNumber(inputs.home.manualAdjustment),
  awayManualAdjustment: toNumber(inputs.away.manualAdjustment),
})

const createSelectedAdjustmentSnapshot = (values = {}) => {
  const storedInjuryImpact = toNumber(values.storedInjuryImpact)
  const gameInjuryAdjustment = toNumber(values.injuries)

  return {
    goalieAdjustment: toNumber(values.goalieAdjustment),
    storedInjuryImpact,
    gameInjuryAdjustment,
    totalInjuryAdjustment: storedInjuryImpact + gameInjuryAdjustment,
    restFatigueAdjustment: toNumber(values.restFatigue ?? values.recentForm),
    motivationAdjustment: toNumber(values.motivation),
    manualAdjustment: toNumber(values.manualAdjustment),
  }
}

const createSelectedGoalieSnapshot = (values = {}, selectedGoalieStats = {}) => {
  const hasAvailableStats = selectedGoalieStats?.dataStatus === 'available'

  return {
    selectedGoalieName: toText(values.selectedGoalieName, ''),
    selectedGoalieSavePercentage: hasAvailableStats
      ? toNullableNumber(selectedGoalieStats.savePercentage)
      : null,
    selectedGoalieGamesPlayed: hasAvailableStats
      ? toNullableNumber(selectedGoalieStats.gamesPlayed)
      : null,
    selectedGoalieGamesStarted: hasAvailableStats
      ? toNullableNumber(selectedGoalieStats.gamesStarted)
      : null,
  }
}

const normalizeKellySettingsSnapshot = (snapshot = {}) => {
  if (!isPlainObject(snapshot)) {
    return null
  }

  return {
    bankrollBasis: toText(snapshot.bankrollBasis, ''),
    customKellyFraction: toNullableNumber(snapshot.customKellyFraction),
    kellyMode: toText(snapshot.kellyMode, ''),
    maximumStakePercent: toNullableNumber(snapshot.maximumStakePercent),
    minimumEdgePercent: toNullableNumber(snapshot.minimumEdgePercent),
    stakeRoundingIncrement: toNullableNumber(snapshot.stakeRoundingIncrement),
  }
}

const normalizeKellyRecommendationSnapshot = (snapshot = null) => {
  if (!isPlainObject(snapshot)) {
    return null
  }

  return {
    appliedKellyFraction: toNullableNumber(snapshot.appliedKellyFraction),
    bankrollAmountAtRecommendation: toNullableNumber(
      snapshot.bankrollAmountAtRecommendation,
    ),
    bankrollBasis: toText(snapshot.bankrollBasis, ''),
    bettingSettingsSnapshot: normalizeKellySettingsSnapshot(
      snapshot.bettingSettingsSnapshot,
    ),
    capApplied: Boolean(snapshot.capApplied),
    eligible: Boolean(snapshot.eligible),
    fractionalKellyPercent: toNullableNumber(snapshot.fractionalKellyPercent),
    fullKellyPercent: toNullableNumber(snapshot.fullKellyPercent),
    maximumStakePercent: toNullableNumber(snapshot.maximumStakePercent),
    minimumEdgePercent: toNullableNumber(snapshot.minimumEdgePercent),
    reason: toText(snapshot.reason, ''),
    recommendedStakeAmount: toNullableNumber(snapshot.recommendedStakeAmount),
    recommendedStakePercent: toNullableNumber(snapshot.recommendedStakePercent),
    roundingIncrement: toNullableNumber(snapshot.roundingIncrement),
  }
}

export const createBetPayloadFromGameAnalysis = ({
  awayTeam,
  gameId = '',
  homeTeam,
  inputs,
  kellyRecommendation = null,
  notes = '',
  result,
  scheduledStart = null,
  selectedSide = 'home',
  selectedGoalieStats = null,
  stake = DEFAULT_STAKE,
}) => {
  const savedAnalysis = createSavedAnalysis({
    awayTeam,
    homeTeam,
    inputs,
    result,
  })
  const selectedMarket = selectedSide === 'away' ? 'away' : 'home'
  const normalizedSelectedSide = selectedMarket
  const selectedTeam = normalizedSelectedSide === 'home' ? homeTeam : awayTeam
  const selectedInputs = inputs[selectedMarket]
  const marketOdds = parseMarketOdds(inputs[selectedMarket].marketOdds)
  const expectedValue = calculateExpectedValue(
    savedAnalysis[`${selectedMarket}WinProbability`],
    marketOdds,
  )
  const modelStatus = getModelStatus(expectedValue)
  const selectedAdjustmentSnapshot =
    createSelectedAdjustmentSnapshot(selectedInputs)

  return {
    gameId,
    analyzedAt: savedAnalysis.dateTime,
    scheduledStart,
    homeTeam: toTeamPayload(homeTeam),
    awayTeam: toTeamPayload(awayTeam),
    selectedTeam: toTeamPayload(selectedTeam),
    selectedSide: {
      ...toTeamPayload(selectedTeam),
      homeAway: normalizedSelectedSide,
    },
    modelProbability: savedAnalysis[`${selectedMarket}WinProbability`],
    fairOdds: savedAnalysis[`${selectedMarket}FairOdds`],
    marketOdds,
    impliedMarketProbability: calculateImpliedProbability(marketOdds),
    probabilityEdge: savedAnalysis[`${selectedMarket}Edge`],
    expectedValue,
    modelStatus,
    oddsValuePercentage: expectedValue === null ? 0 : expectedValue / 100,
    recommendation: modelStatus,
    awayBaseRating: toNumber(inputs.away.baseRating),
    homeBaseRating: toNumber(inputs.home.baseRating),
    awayEffectiveRating: result.awayFinalRating,
    homeEffectiveRating: result.homeFinalRating,
    ratingDifference: result.ratingDifference,
    ...selectedAdjustmentSnapshot,
    ...createSelectedGoalieSnapshot(selectedInputs, selectedGoalieStats),
    stake: normalizeStake(stake),
    stakeType: 'units',
    sportsbook: '',
    closingOdds: null,
    result: savedAnalysis.result,
    profit: 0,
    notes: toText(notes, ''),
    adjustments: createAdjustmentsPayload(inputs),
    kellyRecommendation: normalizeKellyRecommendationSnapshot(
      kellyRecommendation,
    ),
  }
}

export const normalizeSavedAnalysis = (analysis = {}, index = 0) => {
  const homeExpectedValue = toNullableNumber(analysis.homeExpectedValue)
  const awayExpectedValue = toNullableNumber(analysis.awayExpectedValue)
  const homeModelStatus = getSavedModelStatus({
    expectedValue: homeExpectedValue,
    modelStatus: analysis.homeModelStatus ?? analysis.homeRecommendation,
  })
  const awayModelStatus = getSavedModelStatus({
    expectedValue: awayExpectedValue,
    modelStatus: analysis.awayModelStatus ?? analysis.awayRecommendation,
  })
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
    homeFairOdds: toNullableOdds(analysis.homeFairOdds),
    awayFairOdds: toNullableOdds(analysis.awayFairOdds),
    homeMarketOdds: toNullableOdds(analysis.homeMarketOdds),
    awayMarketOdds: toNullableOdds(analysis.awayMarketOdds),
    homeEdge: toNullableNumber(analysis.homeEdge),
    awayEdge: toNullableNumber(analysis.awayEdge),
    homeExpectedValue,
    awayExpectedValue,
    homeOddsDifference: toNullableNumber(analysis.homeOddsDifference),
    awayOddsDifference: toNullableNumber(analysis.awayOddsDifference),
    homeModelStatus,
    awayModelStatus,
    homeRecommendation: homeModelStatus,
    awayRecommendation: awayModelStatus,
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
  const selectedAdjustments = normalized.adjustments[selectedMarket]
  const expectedValue = normalized[`${selectedMarket}ExpectedValue`]
  const modelStatus = getSavedModelStatus({
    expectedValue,
    modelStatus: normalized[`${selectedMarket}ModelStatus`],
  })
  const selectedAdjustmentSnapshot =
    createSelectedAdjustmentSnapshot(selectedAdjustments)

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
    selectedTeam: toTeamPayload(selectedTeam),
    selectedSide: {
      ...toTeamPayload(selectedTeam),
      homeAway: selectedSide,
    },
    modelProbability: normalized[`${selectedMarket}WinProbability`],
    fairOdds: normalized[`${selectedMarket}FairOdds`],
    marketOdds: normalized[`${selectedMarket}MarketOdds`],
    impliedMarketProbability: calculateImpliedProbability(
      normalized[`${selectedMarket}MarketOdds`],
    ),
    probabilityEdge: normalized[`${selectedMarket}Edge`],
    expectedValue,
    modelStatus,
    oddsValuePercentage: expectedValue === null ? null : expectedValue / 100,
    recommendation: modelStatus,
    awayBaseRating: normalized.adjustments.away.baseRating,
    homeBaseRating: normalized.adjustments.home.baseRating,
    awayEffectiveRating: normalized.awayFinalRating,
    homeEffectiveRating: normalized.homeFinalRating,
    ratingDifference: normalized.homeFinalRating - normalized.awayFinalRating,
    ...selectedAdjustmentSnapshot,
    selectedGoalieName: toText(selectedAdjustments.selectedGoalieName, ''),
    selectedGoalieSavePercentage: null,
    selectedGoalieGamesPlayed: null,
    selectedGoalieGamesStarted: null,
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
      homeRestFatigue: normalized.adjustments.home.restFatigue,
      awayRestFatigue: normalized.adjustments.away.restFatigue,
      homeMotivation: normalized.adjustments.home.motivation,
      awayMotivation: normalized.adjustments.away.motivation,
      homeManualAdjustment: normalized.adjustments.home.manualAdjustment,
      awayManualAdjustment: normalized.adjustments.away.manualAdjustment,
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
    expectedValue: roundForSignature(bet.expectedValue),
    modelStatus: bet.modelStatus ?? '',
    recommendation: bet.recommendation ?? '',
    adjustments: bet.adjustments ?? {},
  })

export const normalizeBet = (bet = {}) => {
  const selectedHomeAway = ['home', 'away'].includes(bet.selectedSide?.homeAway)
    ? bet.selectedSide.homeAway
    : 'home'
  const selectedAdjustmentPrefix = selectedHomeAway === 'home' ? 'home' : 'away'
  const selectedGoalieFallback = toText(
    bet.adjustments?.[`${selectedAdjustmentPrefix}GoalieName`],
    '',
  )
  const marketOdds = toNullableOdds(bet.marketOdds)
  const expectedValue = toNullableNumber(bet.expectedValue)
  const modelStatus = getSavedModelStatus({
    expectedValue,
    modelStatus: bet.modelStatus,
  })
  const selectedStoredInjuryImpact =
    toNullableNumber(bet.storedInjuryImpact) ??
    toNullableNumber(
      bet.adjustments?.[`${selectedAdjustmentPrefix}StoredInjuryImpact`],
    )
  const selectedGameInjuryAdjustment =
    toNullableNumber(bet.gameInjuryAdjustment) ??
    toNullableNumber(bet.adjustments?.[`${selectedAdjustmentPrefix}Injuries`])
  const selectedTotalInjuryAdjustment =
    toNullableNumber(bet.totalInjuryAdjustment) ??
    (selectedStoredInjuryImpact !== null || selectedGameInjuryAdjustment !== null
      ? toNumber(selectedStoredInjuryImpact) + toNumber(selectedGameInjuryAdjustment)
      : null)

  return {
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
    selectedTeam: {
      teamId: toText(
        bet.selectedTeam?.teamId ?? bet.selectedSide?.teamId,
        '',
      ),
      name: toText(
        bet.selectedTeam?.name ?? bet.selectedSide?.name,
        'Selected Team',
      ),
      abbreviation: toText(
        bet.selectedTeam?.abbreviation ?? bet.selectedSide?.abbreviation,
        '',
      ),
    },
    selectedSide: {
      teamId: toText(bet.selectedSide?.teamId, ''),
      name: toText(bet.selectedSide?.name, 'Selected Team'),
      abbreviation: toText(bet.selectedSide?.abbreviation, ''),
      homeAway: selectedHomeAway,
    },
    modelProbability: toNullableNumber(bet.modelProbability),
    fairOdds: toNullableOdds(bet.fairOdds),
    marketOdds,
    impliedMarketProbability:
      toNullableNumber(bet.impliedMarketProbability) ??
      calculateImpliedProbability(marketOdds),
    probabilityEdge: toNullableNumber(bet.probabilityEdge),
    expectedValue,
    modelStatus,
    oddsValuePercentage:
      toNullableNumber(bet.oddsValuePercentage) ??
      (expectedValue === null ? null : expectedValue / 100),
    recommendation: toText(bet.recommendation, modelStatus),
    awayBaseRating: toNullableNumber(bet.awayBaseRating),
    homeBaseRating: toNullableNumber(bet.homeBaseRating),
    awayEffectiveRating: toNullableNumber(bet.awayEffectiveRating),
    homeEffectiveRating: toNullableNumber(bet.homeEffectiveRating),
    ratingDifference: toNullableNumber(bet.ratingDifference),
    goalieAdjustment:
      toNullableNumber(bet.goalieAdjustment) ??
      toNullableNumber(bet.adjustments?.[`${selectedAdjustmentPrefix}Goalie`]),
    storedInjuryImpact: selectedStoredInjuryImpact,
    gameInjuryAdjustment: selectedGameInjuryAdjustment,
    totalInjuryAdjustment: selectedTotalInjuryAdjustment,
    restFatigueAdjustment:
      toNullableNumber(bet.restFatigueAdjustment) ??
      toNullableNumber(
        bet.adjustments?.[`${selectedAdjustmentPrefix}RestFatigue`] ??
          bet.adjustments?.[`${selectedAdjustmentPrefix}RecentForm`],
      ),
    motivationAdjustment:
      toNullableNumber(bet.motivationAdjustment) ??
      toNullableNumber(bet.adjustments?.[`${selectedAdjustmentPrefix}Motivation`]),
    manualAdjustment:
      toNullableNumber(bet.manualAdjustment) ??
      toNullableNumber(
        bet.adjustments?.[`${selectedAdjustmentPrefix}ManualAdjustment`],
      ),
    selectedGoalieName: toText(bet.selectedGoalieName, selectedGoalieFallback),
    selectedGoalieSavePercentage: toNullableNumber(
      bet.selectedGoalieSavePercentage,
    ),
    selectedGoalieGamesPlayed: toNullableNumber(bet.selectedGoalieGamesPlayed),
    selectedGoalieGamesStarted: toNullableNumber(bet.selectedGoalieGamesStarted),
    stake: normalizeStake(bet.stake),
    stakeType: toText(bet.stakeType, 'units'),
    sportsbook: toText(bet.sportsbook, ''),
    closingOdds:
      bet.closingOdds === null ||
      bet.closingOdds === '' ||
      bet.closingOdds === undefined
        ? ''
        : toNullableOdds(bet.closingOdds),
    result: normalizeResult(bet.result),
    profit: toNumber(bet.profit),
    notes: toText(bet.notes, ''),
    kellyRecommendation: normalizeKellyRecommendationSnapshot(
      bet.kellyRecommendation,
    ),
    adjustments: {
      homeAdvantage: toNumber(bet.adjustments?.homeAdvantage),
      homeStoredInjuryImpact: toNumber(bet.adjustments?.homeStoredInjuryImpact),
      awayStoredInjuryImpact: toNumber(bet.adjustments?.awayStoredInjuryImpact),
      homeInjuries: toNumber(bet.adjustments?.homeInjuries),
      awayInjuries: toNumber(bet.adjustments?.awayInjuries),
      homeGoalie: toNumber(bet.adjustments?.homeGoalie),
      awayGoalie: toNumber(bet.adjustments?.awayGoalie),
      homeGoalieId: toText(bet.adjustments?.homeGoalieId, ''),
      homeGoalieName: toText(bet.adjustments?.homeGoalieName, ''),
      awayGoalieId: toText(bet.adjustments?.awayGoalieId, ''),
      awayGoalieName: toText(bet.adjustments?.awayGoalieName, ''),
      homeRecentForm: toNumber(
        bet.adjustments?.homeRecentForm ?? bet.adjustments?.homeRestFatigue,
      ),
      awayRecentForm: toNumber(
        bet.adjustments?.awayRecentForm ?? bet.adjustments?.awayRestFatigue,
      ),
      homeRestFatigue: toNumber(
        bet.adjustments?.homeRestFatigue ?? bet.adjustments?.homeRecentForm,
      ),
      awayRestFatigue: toNumber(
        bet.adjustments?.awayRestFatigue ?? bet.adjustments?.awayRecentForm,
      ),
      homeMotivation: toNumber(bet.adjustments?.homeMotivation),
      awayMotivation: toNumber(bet.adjustments?.awayMotivation),
      homeManualAdjustment: toNumber(bet.adjustments?.homeManualAdjustment),
      awayManualAdjustment: toNumber(bet.adjustments?.awayManualAdjustment),
    },
  }
}

export const normalizeBets = (bets) =>
  (Array.isArray(bets) ? bets : [])
    .map((bet) => normalizeBet(bet))
    .sort((betA, betB) => {
      const dateA = Date.parse(betA.analyzedAt)
      const dateB = Date.parse(betB.analyzedAt)

      return toNumber(dateB) - toNumber(dateA)
    })
