const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const bankrollService = require('./bankrollService')
const betSettlementService = require('./betSettlementService')
const nhlSeasonService = require('./nhlSeasonService')
const {
  SPECIAL_TEAMS_MATCHUP_STATUSES,
  SPECIAL_TEAMS_MODES,
  SPECIAL_TEAMS_SIGNALS,
} = require('../../shared/specialTeamsMatchups')

const RESULT_VALUES = Bet.RESULT_VALUES
const DEFAULT_BET_PAGE = 1
const DEFAULT_BET_LIMIT = 5
const SUPPORTED_BET_LIMITS = Object.freeze([5, 10, 20])
const MAX_BET_LIMIT = Math.max(...SUPPORTED_BET_LIMITS)
const BET_RESULT_FILTERS = new Set(['all', 'settled', ...RESULT_VALUES])
const BET_SEASON_ALL = 'all'
const BET_SEASON_CURRENT = 'current'
const EDITABLE_FIELDS = [
  'result',
  'stake',
  'stakeType',
  'sportsbook',
  'closingOdds',
  'notes',
]
const MINIMUM_POSITIVE_EV = 3
const MODEL_STATUSES = {
  BET_CANDIDATE: 'Bet Candidate',
  POSITIVE_VALUE: 'Positive Value',
  POSITIVE_VALUE_BELOW_THRESHOLD: 'Positive Value · Below Threshold',
  BELOW_THRESHOLD: 'Below Threshold',
  NO_VALUE: 'No Value',
  LEGACY: 'Legacy bet',
}
const BET_HISTORY_MODEL_STATUSES = Object.freeze({
  BET_CANDIDATE: 'Bet Candidate',
  POSITIVE_VALUE_BELOW_THRESHOLD: 'Positive Value · Below Threshold',
  NO_VALUE: 'No Value',
  LEGACY: 'Legacy',
})
const STORED_CURRENT_MODEL_STATUSES = Object.freeze([
  MODEL_STATUSES.BET_CANDIDATE,
  MODEL_STATUSES.POSITIVE_VALUE,
  MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD,
  MODEL_STATUSES.BELOW_THRESHOLD,
  MODEL_STATUSES.NO_VALUE,
])
const RECOMMENDATION_STATES = new Set([
  'NO_VALUE',
  'POSITIVE_VALUE_BELOW_THRESHOLD',
  'BET_CANDIDATE',
])
const RECOMMENDATION_STATE_LABELS = {
  NO_VALUE: MODEL_STATUSES.NO_VALUE,
  POSITIVE_VALUE_BELOW_THRESHOLD:
    MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD,
  BET_CANDIDATE: MODEL_STATUSES.BET_CANDIDATE,
}

class BetsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'BetsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const toNumber = (value, fallback = 0) => {
  if (value === null || value === '' || value === undefined) {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const toOptionalNumber = (value, field) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    throw new BetsError(`${field} must be a finite number.`, 400, { field })
  }

  return parsedValue
}

const toOptionalNonNegativeNumber = (value, field) => {
  const parsedValue = toOptionalNumber(value, field)

  if (parsedValue !== null && parsedValue < 0) {
    throw new BetsError(`${field} must be zero or greater.`, 400, { field })
  }

  return parsedValue
}

const toFiniteNumber = (value, field, { allowNull = false } = {}) => {
  if ((value === null || value === '' || value === undefined) && allowNull) {
    return null
  }

  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    throw new BetsError(`${field} must be a finite number.`, 400, { field })
  }

  return parsedValue
}

const toDate = (value, field, { allowNull = false } = {}) => {
  if ((value === null || value === '' || value === undefined) && allowNull) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new BetsError(`${field} must be a valid date.`, 400, { field })
  }

  return date
}

const toText = (value, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const normalizeTeam = (team, field) => {
  if (!team || Array.isArray(team) || typeof team !== 'object') {
    throw new BetsError(`${field} is required.`, 400, { field })
  }

  return {
    teamId: toText(team.teamId),
    name: toText(team.name),
    abbreviation: toText(team.abbreviation).toUpperCase(),
  }
}

const normalizeSelectedSide = (selectedSide) => {
  const normalizedSide = normalizeTeam(selectedSide, 'selectedSide')
  const homeAway = toText(selectedSide.homeAway)

  if (!['home', 'away'].includes(homeAway)) {
    throw new BetsError('selectedSide.homeAway must be home or away.', 400, {
      field: 'selectedSide.homeAway',
    })
  }

  return {
    ...normalizedSide,
    homeAway,
  }
}

const validateResult = (result = 'pending') => {
  if (!RESULT_VALUES.includes(result)) {
    throw new BetsError(
      `result must be one of: ${RESULT_VALUES.join(', ')}.`,
      400,
      { field: 'result' },
    )
  }

  return result
}

const validateMarketOdds = (marketOdds) => {
  const value = toFiniteNumber(marketOdds, 'marketOdds')

  if (value <= 1) {
    throw new BetsError('marketOdds must be greater than 1.', 400, {
      field: 'marketOdds',
    })
  }

  return value
}

const validateStake = (stake = 1) => {
  const value = toFiniteNumber(stake, 'stake')

  if (value <= 0) {
    throw new BetsError('stake must be greater than 0.', 400, {
      field: 'stake',
    })
  }

  return value
}

const validateProbability = (probability, field) => {
  const value = toFiniteNumber(probability, field)

  if (value <= 0 || value > 1) {
    throw new BetsError(`${field} must be between 0 and 1.`, 400, { field })
  }

  return value
}

const getModelStatus = (expectedValue) => {
  if (expectedValue >= MINIMUM_POSITIVE_EV) {
    return MODEL_STATUSES.POSITIVE_VALUE
  }

  if (expectedValue >= 0) {
    return MODEL_STATUSES.BELOW_THRESHOLD
  }

  return MODEL_STATUSES.NO_VALUE
}

const normalizeModelStatus = (modelStatus) => {
  const normalizedStatus = toText(modelStatus).toLowerCase()

  if (normalizedStatus === 'positive value') {
    return MODEL_STATUSES.POSITIVE_VALUE
  }

  if (
    normalizedStatus === 'positive value · below threshold' ||
    normalizedStatus === 'positive value below threshold' ||
    normalizedStatus === 'positive_value_below_threshold'
  ) {
    return MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD
  }

  if (
    normalizedStatus === 'bet candidate' ||
    normalizedStatus === 'bet_candidate'
  ) {
    return MODEL_STATUSES.BET_CANDIDATE
  }

  if (normalizedStatus === 'below threshold') {
    return MODEL_STATUSES.BELOW_THRESHOLD
  }

  if (normalizedStatus === 'no value') {
    return MODEL_STATUSES.NO_VALUE
  }

  return ''
}

const normalizeRecommendationState = (value, field) => {
  if (value === null || value === '' || value === undefined) {
    return ''
  }

  const normalizedValue = toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  if (!RECOMMENDATION_STATES.has(normalizedValue)) {
    throw new BetsError(`${field} is invalid.`, 400, { field })
  }

  return normalizedValue
}

const normalizeSpecialTeamsSnapshot = (snapshot = null, field) => {
  if (snapshot === null || snapshot === '' || snapshot === undefined) {
    return null
  }

  if (Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new BetsError(`${field} must be an object.`, 400, { field })
  }

  const mode = toText(snapshot.mode, SPECIAL_TEAMS_MODES.ALERT_ONLY)
  const status = toText(
    snapshot.status,
    SPECIAL_TEAMS_MATCHUP_STATUSES.UNAVAILABLE,
  )
  const signal = snapshot.signal === null || snapshot.signal === undefined
    ? null
    : toText(snapshot.signal)

  if (!Object.values(SPECIAL_TEAMS_MODES).includes(mode)) {
    throw new BetsError(`${field}.mode is invalid.`, 400, {
      field: `${field}.mode`,
    })
  }

  if (!Object.values(SPECIAL_TEAMS_MATCHUP_STATUSES).includes(status)) {
    throw new BetsError(`${field}.status is invalid.`, 400, {
      field: `${field}.status`,
    })
  }

  if (signal !== null && !Object.values(SPECIAL_TEAMS_SIGNALS).includes(signal)) {
    throw new BetsError(`${field}.signal is invalid.`, 400, {
      field: `${field}.signal`,
    })
  }

  return {
    adjustment: toOptionalNumber(
      snapshot.adjustment,
      `${field}.adjustment`,
    ) ?? 0,
    mode,
    opponentPkRank: toOptionalNumber(
      snapshot.opponentPkRank,
      `${field}.opponentPkRank`,
    ),
    ppRank: toOptionalNumber(snapshot.ppRank, `${field}.ppRank`),
    signal,
    status,
    threshold: toOptionalNumber(snapshot.threshold, `${field}.threshold`),
  }
}

const normalizeAdjustments = (adjustments = {}) => ({
  homeAdvantage: toNumber(adjustments.homeAdvantage),
  homeStoredInjuryImpact: toNumber(adjustments.homeStoredInjuryImpact),
  awayStoredInjuryImpact: toNumber(adjustments.awayStoredInjuryImpact),
  homeInjuries: toNumber(adjustments.homeInjuries),
  awayInjuries: toNumber(adjustments.awayInjuries),
  homeGoalie: toNumber(adjustments.homeGoalie),
  awayGoalie: toNumber(adjustments.awayGoalie),
  homeGoalieId: toText(adjustments.homeGoalieId),
  homeGoalieName: toText(adjustments.homeGoalieName),
  awayGoalieId: toText(adjustments.awayGoalieId),
  awayGoalieName: toText(adjustments.awayGoalieName),
  homeRecentForm: toNumber(
    adjustments.homeRecentForm ?? adjustments.homeRestFatigue,
  ),
  awayRecentForm: toNumber(
    adjustments.awayRecentForm ?? adjustments.awayRestFatigue,
  ),
  homeRestFatigue: toNumber(
    adjustments.homeRestFatigue ?? adjustments.homeRecentForm,
  ),
  awayRestFatigue: toNumber(
    adjustments.awayRestFatigue ?? adjustments.awayRecentForm,
  ),
  homeQuickRematch: toNumber(adjustments.homeQuickRematch),
  awayQuickRematch: toNumber(adjustments.awayQuickRematch),
  homeSpecialTeamsAdjustment: toNumber(
    adjustments.homeSpecialTeamsAdjustment,
  ),
  awaySpecialTeamsAdjustment: toNumber(
    adjustments.awaySpecialTeamsAdjustment,
  ),
  homeSpecialTeamsSnapshot: normalizeSpecialTeamsSnapshot(
    adjustments.homeSpecialTeamsSnapshot,
    'adjustments.homeSpecialTeamsSnapshot',
  ),
  awaySpecialTeamsSnapshot: normalizeSpecialTeamsSnapshot(
    adjustments.awaySpecialTeamsSnapshot,
    'adjustments.awaySpecialTeamsSnapshot',
  ),
  homeMotivation: toNumber(adjustments.homeMotivation),
  awayMotivation: toNumber(adjustments.awayMotivation),
  homeManualAdjustment: toNumber(adjustments.homeManualAdjustment),
  awayManualAdjustment: toNumber(adjustments.awayManualAdjustment),
})

const normalizeBankrollBasis = (value) => {
  const normalizedValue = toText(value).toUpperCase()

  return ['AVAILABLE', 'CURRENT'].includes(normalizedValue)
    ? normalizedValue
    : ''
}

const normalizeKellyMode = (value) => {
  const normalizedValue = toText(value).toUpperCase()

  return ['FULL', 'HALF', 'QUARTER', 'CUSTOM'].includes(normalizedValue)
    ? normalizedValue
    : ''
}

const normalizeBettingSettingsSnapshot = (snapshot = null) => {
  if (snapshot === null || snapshot === '' || snapshot === undefined) {
    return null
  }

  if (Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new BetsError(
      'kellyRecommendation.bettingSettingsSnapshot must be an object.',
      400,
      { field: 'kellyRecommendation.bettingSettingsSnapshot' },
    )
  }

  return {
    bankrollBasis: normalizeBankrollBasis(snapshot.bankrollBasis),
    customKellyFraction: toOptionalNonNegativeNumber(
      snapshot.customKellyFraction,
      'kellyRecommendation.bettingSettingsSnapshot.customKellyFraction',
    ),
    kellyMode: normalizeKellyMode(snapshot.kellyMode),
    maximumStakePercent: toOptionalNonNegativeNumber(
      snapshot.maximumStakePercent,
      'kellyRecommendation.bettingSettingsSnapshot.maximumStakePercent',
    ),
    minimumEdgePercent: toOptionalNonNegativeNumber(
      snapshot.minimumEdgePercent,
      'kellyRecommendation.bettingSettingsSnapshot.minimumEdgePercent',
    ),
    stakeRoundingIncrement: toOptionalNonNegativeNumber(
      snapshot.stakeRoundingIncrement,
      'kellyRecommendation.bettingSettingsSnapshot.stakeRoundingIncrement',
    ),
  }
}

const normalizeKellyRecommendationSnapshot = (snapshot = null) => {
  if (snapshot === null || snapshot === '' || snapshot === undefined) {
    return undefined
  }

  if (Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new BetsError('kellyRecommendation must be an object.', 400, {
      field: 'kellyRecommendation',
    })
  }

  return {
    appliedKellyFraction: toOptionalNonNegativeNumber(
      snapshot.appliedKellyFraction,
      'kellyRecommendation.appliedKellyFraction',
    ),
    bankrollAmountAtRecommendation: toOptionalNonNegativeNumber(
      snapshot.bankrollAmountAtRecommendation,
      'kellyRecommendation.bankrollAmountAtRecommendation',
    ),
    bankrollBasis: normalizeBankrollBasis(snapshot.bankrollBasis),
    bettingSettingsSnapshot: normalizeBettingSettingsSnapshot(
      snapshot.bettingSettingsSnapshot,
    ),
    capApplied: Boolean(snapshot.capApplied),
    eligible: Boolean(snapshot.eligible),
    fractionalKellyPercent: toOptionalNumber(
      snapshot.fractionalKellyPercent,
      'kellyRecommendation.fractionalKellyPercent',
    ),
    fullKellyPercent: toOptionalNumber(
      snapshot.fullKellyPercent,
      'kellyRecommendation.fullKellyPercent',
    ),
    maximumStakePercent: toOptionalNonNegativeNumber(
      snapshot.maximumStakePercent,
      'kellyRecommendation.maximumStakePercent',
    ),
    minimumEdgePercent: toOptionalNonNegativeNumber(
      snapshot.minimumEdgePercent,
      'kellyRecommendation.minimumEdgePercent',
    ),
    recommendationState: normalizeRecommendationState(
      snapshot.recommendationState,
      'kellyRecommendation.recommendationState',
    ),
    reason: toText(snapshot.reason),
    recommendedStakeAmount: toOptionalNonNegativeNumber(
      snapshot.recommendedStakeAmount,
      'kellyRecommendation.recommendedStakeAmount',
    ),
    recommendedStakePercent: toOptionalNonNegativeNumber(
      snapshot.recommendedStakePercent,
      'kellyRecommendation.recommendedStakePercent',
    ),
    roundingIncrement: toOptionalNonNegativeNumber(
      snapshot.roundingIncrement,
      'kellyRecommendation.roundingIncrement',
    ),
  }
}

const normalizeGameContextSnapshot = (snapshot = null) => {
  if (snapshot === null || snapshot === '' || snapshot === undefined) {
    return null
  }

  if (Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new BetsError('gameContextSnapshot must be an object.', 400, {
      field: 'gameContextSnapshot',
    })
  }

  return JSON.parse(JSON.stringify(snapshot))
}

const normalizeGoalieSnapshotAdjustment = (value, field) => {
  const adjustment = toFiniteNumber(value, field)

  if (adjustment < -5 || adjustment > 5) {
    throw new BetsError(`${field} must be between -5.00 and +5.00.`, 400, {
      field,
    })
  }

  const stepUnits = adjustment / 0.05

  if (Math.abs(stepUnits - Math.round(stepUnits)) > 1e-8) {
    throw new BetsError(`${field} must use 0.05 increments.`, 400, { field })
  }

  return adjustment
}

const normalizeGoalieSelectionSnapshot = (snapshot = null) => {
  if (snapshot === null || snapshot === '' || snapshot === undefined) {
    return null
  }

  if (Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new BetsError('goalieSelectionSnapshot must be an object.', 400, {
      field: 'goalieSelectionSnapshot',
    })
  }

  const rawSelectionType = toText(snapshot.selectionType)
  const isLegacyTeamGoalie = rawSelectionType === 'team_goalie'
  const rawNhlPlayerId = toOptionalNumber(
    snapshot.nhlPlayerId,
    'goalieSelectionSnapshot.nhlPlayerId',
  )
  const selectionType =
    isLegacyTeamGoalie
      ? rawNhlPlayerId === null
        ? 'custom'
        : 'provider_goalie'
      : rawSelectionType

  if (!['provider_goalie', 'custom', 'unknown'].includes(selectionType)) {
    throw new BetsError(
      'goalieSelectionSnapshot.selectionType must be provider_goalie, custom, or unknown.',
      400,
      { field: 'goalieSelectionSnapshot.selectionType' },
    )
  }

  if (selectionType === 'unknown') {
    return {
      confirmationStatus: 'unknown',
      customNote: '',
      displayName: '',
      effectiveAdjustment: 0,
      manualAdjustment: null,
      nhlPlayerId: null,
      overrideEnabled: false,
      selectionType,
      source: 'unknown',
      teamDefaultAdjustment: null,
      teamGoalieId: null,
      teamId: toText(snapshot.teamId).toUpperCase(),
    }
  }

  const confirmationStatus = toText(snapshot.confirmationStatus, 'selected')

  if (
    !['unknown', 'selected', 'expected', 'confirmed'].includes(
      confirmationStatus,
    )
  ) {
    throw new BetsError(
      'Selected goalie status must be unknown, selected, expected, or confirmed.',
      400,
      { field: 'goalieSelectionSnapshot.confirmationStatus' },
    )
  }

  const isCustom = selectionType === 'custom'
  const overrideEnabled = isCustom || snapshot.overrideEnabled === true
  const manualAdjustment = overrideEnabled
    ? normalizeGoalieSnapshotAdjustment(
        snapshot.manualAdjustment ?? snapshot.effectiveAdjustment,
        'goalieSelectionSnapshot.manualAdjustment',
      )
    : null
  const teamDefaultAdjustment = isCustom
    ? null
    : normalizeGoalieSnapshotAdjustment(
        snapshot.teamDefaultAdjustment ??
          (isLegacyTeamGoalie ? snapshot.effectiveAdjustment : undefined),
        'goalieSelectionSnapshot.teamDefaultAdjustment',
      )
  const effectiveAdjustment = normalizeGoalieSnapshotAdjustment(
    snapshot.effectiveAdjustment,
    'goalieSelectionSnapshot.effectiveAdjustment',
  )
  const expectedEffectiveAdjustment = overrideEnabled
    ? manualAdjustment
    : teamDefaultAdjustment

  if (Math.abs(effectiveAdjustment - expectedEffectiveAdjustment) > 1e-8) {
    throw new BetsError(
      'goalieSelectionSnapshot.effectiveAdjustment does not match its selected adjustment.',
      400,
      { field: 'goalieSelectionSnapshot.effectiveAdjustment' },
    )
  }

  const displayName = toText(snapshot.displayName ?? snapshot.goalieName)
  const customNote = isCustom ? toText(snapshot.customNote) : ''

  if (displayName.length > 120) {
    throw new BetsError(
      'goalieSelectionSnapshot.displayName cannot exceed 120 characters.',
      400,
      { field: 'goalieSelectionSnapshot.displayName' },
    )
  }

  if (customNote.length > 300) {
    throw new BetsError(
      'goalieSelectionSnapshot.customNote cannot exceed 300 characters.',
      400,
      { field: 'goalieSelectionSnapshot.customNote' },
    )
  }

  const nhlPlayerId = isCustom
    ? null
    : rawNhlPlayerId

  if (
    !isCustom &&
    (!Number.isSafeInteger(nhlPlayerId) || nhlPlayerId <= 0)
  ) {
    throw new BetsError(
      'goalieSelectionSnapshot.nhlPlayerId must be a positive integer.',
      400,
      { field: 'goalieSelectionSnapshot.nhlPlayerId' },
    )
  }

  return {
    confirmationStatus,
    customNote,
    displayName,
    effectiveAdjustment,
    manualAdjustment,
    nhlPlayerId,
    overrideEnabled,
    selectionType,
    source: selectionType,
    teamDefaultAdjustment,
    teamGoalieId: null,
    teamId: toText(snapshot.teamId).toUpperCase(),
  }
}

const calculateProfit = ({ marketOdds, result, stake }) => {
  const odds = Number(marketOdds)
  const wager = Number(stake)

  if (!Number.isFinite(odds) || odds <= 1 || !Number.isFinite(wager)) {
    return 0
  }

  if (result === 'win') {
    return (odds - 1) * wager
  }

  if (result === 'loss') {
    return -wager
  }

  return 0
}

const serializeBet = (bet) => {
  const plainBet =
    typeof bet.toJSON === 'function'
      ? bet.toJSON()
      : {
          ...bet,
          id: bet._id?.toString(),
        }

  delete plainBet._id
  delete plainBet.__v

  return plainBet
}

const normalizeCreatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new BetsError('Request body must be an object.', 400)
  }

  const marketOdds = validateMarketOdds(payload.marketOdds)
  const stake = validateStake(payload.stake ?? 1)
  const result = validateResult(payload.result ?? 'pending')
  const modelProbability = validateProbability(
    payload.modelProbability,
    'modelProbability',
  )
  const fairOdds = toOptionalNumber(payload.fairOdds, 'fairOdds') ?? 1 / modelProbability
  const impliedMarketProbability =
    toOptionalNumber(
      payload.impliedMarketProbability,
      'impliedMarketProbability',
    ) ?? 1 / marketOdds
  const probabilityEdge =
    toOptionalNumber(payload.probabilityEdge, 'probabilityEdge') ??
    modelProbability - impliedMarketProbability
  const expectedValue =
    toOptionalNumber(payload.expectedValue, 'expectedValue') ??
    (modelProbability * marketOdds - 1) * 100
  const kellyRecommendation = normalizeKellyRecommendationSnapshot(
    payload.kellyRecommendation,
  )
  const recommendationState = normalizeRecommendationState(
    payload.recommendationState ?? kellyRecommendation?.recommendationState,
    'recommendationState',
  )
  const modelStatus =
    normalizeModelStatus(payload.modelStatus) ||
    RECOMMENDATION_STATE_LABELS[recommendationState] ||
    getModelStatus(expectedValue)
  const marketOddsSource = ['manual', 'manual_override', 'provider'].includes(
    payload.marketOddsSource,
  )
    ? payload.marketOddsSource
    : 'manual'
  const isProviderOdds = marketOddsSource === 'provider'
  const goalieSelectionSnapshot = normalizeGoalieSelectionSnapshot(
    payload.goalieSelectionSnapshot,
  )
  const specialTeamsSnapshot = normalizeSpecialTeamsSnapshot(
    payload.specialTeamsSnapshot,
    'specialTeamsSnapshot',
  )
  const betType = toText(payload.betType).toLowerCase()
  const placementId = toText(payload.placementId)

  if (betType && betType !== 'moneyline') {
    throw new BetsError('betType must be moneyline when provided.', 400, {
      field: 'betType',
    })
  }

  if (betType === 'moneyline' && result !== 'pending') {
    throw new BetsError('New moneyline bets must start as pending.', 400, {
      field: 'result',
    })
  }


  if (placementId.length > 120) {
    throw new BetsError('placementId must be 120 characters or fewer.', 400, {
      field: 'placementId',
    })
  }

  return {
    gameId: toText(payload.gameId),
    betType,
    placementId: placementId || null,
    analyzedAt: toDate(payload.analyzedAt ?? new Date(), 'analyzedAt'),
    scheduledStart: toDate(payload.scheduledStart, 'scheduledStart', {
      allowNull: true,
    }),
    homeTeam: normalizeTeam(payload.homeTeam, 'homeTeam'),
    awayTeam: normalizeTeam(payload.awayTeam, 'awayTeam'),
    selectedTeam: normalizeTeam(
      payload.selectedTeam ?? payload.selectedSide,
      'selectedTeam',
    ),
    selectedSide: normalizeSelectedSide(payload.selectedSide),
    modelStatus,
    recommendationState,
    modelProbability,
    fairOdds,
    marketOdds,
    marketOddsSource,
    providerName: isProviderOdds ? toText(payload.providerName) || null : null,
    providerEventId: isProviderOdds
      ? toText(payload.providerEventId) || null
      : null,
    bookmakerKey: isProviderOdds
      ? toText(payload.bookmakerKey) || null
      : null,
    bookmakerTitle: isProviderOdds
      ? toText(payload.bookmakerTitle) || null
      : null,
    providerFetchedAt: isProviderOdds
      ? toDate(payload.providerFetchedAt, 'providerFetchedAt', {
          allowNull: true,
        })
      : null,
    bookmakerLastUpdate: isProviderOdds
      ? toDate(payload.bookmakerLastUpdate, 'bookmakerLastUpdate', {
          allowNull: true,
        })
      : null,
    offeredOdds: marketOdds,
    impliedMarketProbability,
    probabilityEdge,
    expectedValue,
    oddsValuePercentage:
      toOptionalNumber(payload.oddsValuePercentage, 'oddsValuePercentage') ??
      expectedValue / 100,
    recommendation: toText(payload.recommendation, modelStatus),
    awayBaseRating: toOptionalNumber(payload.awayBaseRating, 'awayBaseRating'),
    homeBaseRating: toOptionalNumber(payload.homeBaseRating, 'homeBaseRating'),
    awayEffectiveRating: toOptionalNumber(
      payload.awayEffectiveRating,
      'awayEffectiveRating',
    ),
    homeEffectiveRating: toOptionalNumber(
      payload.homeEffectiveRating,
      'homeEffectiveRating',
    ),
    ratingDifference: toOptionalNumber(
      payload.ratingDifference,
      'ratingDifference',
    ),
    goalieAdjustment: toOptionalNumber(
      payload.goalieAdjustment,
      'goalieAdjustment',
    ),
    storedInjuryImpact: toOptionalNumber(
      payload.storedInjuryImpact,
      'storedInjuryImpact',
    ),
    gameInjuryAdjustment: toOptionalNumber(
      payload.gameInjuryAdjustment,
      'gameInjuryAdjustment',
    ),
    totalInjuryAdjustment: toOptionalNumber(
      payload.totalInjuryAdjustment,
      'totalInjuryAdjustment',
    ),
    restFatigueAdjustment: toOptionalNumber(
      payload.restFatigueAdjustment,
      'restFatigueAdjustment',
    ),
    quickRematchAdjustment: toOptionalNumber(
      payload.quickRematchAdjustment,
      'quickRematchAdjustment',
    ),
    specialTeamsAdjustment: toOptionalNumber(
      payload.specialTeamsAdjustment,
      'specialTeamsAdjustment',
    ),
    specialTeamsSnapshot,
    motivationAdjustment: toOptionalNumber(
      payload.motivationAdjustment,
      'motivationAdjustment',
    ),
    manualAdjustment: toOptionalNumber(
      payload.manualAdjustment,
      'manualAdjustment',
    ),
    selectedGoalieName: toText(
      payload.selectedGoalieName,
      goalieSelectionSnapshot?.displayName ??
        goalieSelectionSnapshot?.goalieName ??
        '',
    ),
    selectedGoalieSavePercentage: toOptionalNumber(
      payload.selectedGoalieSavePercentage,
      'selectedGoalieSavePercentage',
    ),
    selectedGoalieGamesPlayed: toOptionalNumber(
      payload.selectedGoalieGamesPlayed,
      'selectedGoalieGamesPlayed',
    ),
    selectedGoalieGamesStarted: toOptionalNumber(
      payload.selectedGoalieGamesStarted,
      'selectedGoalieGamesStarted',
    ),
    goalieSelectionSnapshot,
    stake,
    stakeType: toText(payload.stakeType, 'units') || 'units',
    sportsbook: toText(payload.sportsbook),
    closingOdds: toFiniteNumber(payload.closingOdds, 'closingOdds', {
      allowNull: true,
    }),
    result,
    notes: toText(payload.notes),
    adjustments: normalizeAdjustments(payload.adjustments),
    gameContextSnapshot: normalizeGameContextSnapshot(
      payload.gameContextSnapshot,
    ),
    kellyRecommendation,
  }
}

const normalizeUpdatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new BetsError('Request body must be an object.', 400)
  }

  const fields = Object.keys(payload)

  if (fields.length === 0) {
    throw new BetsError('At least one bet field is required.', 400)
  }

  const unsupportedFields = fields.filter(
    (field) => !EDITABLE_FIELDS.includes(field),
  )

  if (unsupportedFields.length > 0) {
    throw new BetsError('Request body contains unsupported bet fields.', 400, {
      unsupportedFields,
    })
  }

  return fields.reduce((updates, field) => {
    if (field === 'result') {
      updates.result = validateResult(payload.result)
      return updates
    }

    if (field === 'stake') {
      updates.stake = validateStake(payload.stake)
      return updates
    }

    if (field === 'closingOdds') {
      const closingOdds = toFiniteNumber(payload.closingOdds, 'closingOdds', {
        allowNull: true,
      })

      if (closingOdds !== null && closingOdds <= 1) {
        throw new BetsError('closingOdds must be greater than 1.', 400, {
          field: 'closingOdds',
        })
      }

      updates.closingOdds = closingOdds
      return updates
    }

    updates[field] = toText(payload[field])
    return updates
  }, {})
}

const applyProfit = (bet) => {
  bet.profit = calculateProfit({
    marketOdds: bet.marketOdds,
    result: bet.result,
    stake: bet.stake,
  })
}

const getBets = async (userId) => {
  const bets = await Bet.find({ userId }).sort({ analyzedAt: -1, createdAt: -1 })

  return bets.map(serializeBet)
}

const parsePositiveIntegerQuery = (
  value,
  { defaultValue, field, maxValue = Number.MAX_SAFE_INTEGER },
) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const parsedValue = Number(value)

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > maxValue
  ) {
    throw new BetsError(`${field} must be a positive integer.`, 400, {
      field,
      maxValue,
    })
  }

  return parsedValue
}

const normalizeBetListQuery = (query = {}) => {
  if (!query || Array.isArray(query) || typeof query !== 'object') {
    throw new BetsError('Query parameters must be an object.', 400)
  }

  const page = parsePositiveIntegerQuery(query.page, {
    defaultValue: DEFAULT_BET_PAGE,
    field: 'page',
  })
  const limit = parsePositiveIntegerQuery(query.limit, {
    defaultValue: DEFAULT_BET_LIMIT,
    field: 'limit',
    maxValue: MAX_BET_LIMIT,
  })
  const result = toText(query.result, 'all').toLowerCase() || 'all'
  const modelStatus = toText(query.modelStatus, 'all') || 'all'
  const season = toText(query.season, BET_SEASON_ALL) || BET_SEASON_ALL

  if (!BET_RESULT_FILTERS.has(result)) {
    throw new BetsError('result must be a supported bet result filter.', 400, {
      field: 'result',
      supportedValues: [...BET_RESULT_FILTERS],
    })
  }

  if (modelStatus.length > 100) {
    throw new BetsError('modelStatus must be 100 characters or fewer.', 400, {
      field: 'modelStatus',
    })
  }

  if (season.length > 20) {
    throw new BetsError('season must be a supported NHL season.', 400, {
      field: 'season',
    })
  }

  if (!SUPPORTED_BET_LIMITS.includes(limit)) {
    throw new BetsError(
      `limit must be one of: ${SUPPORTED_BET_LIMITS.join(', ')}.`,
      400,
      {
        field: 'limit',
        supportedValues: SUPPORTED_BET_LIMITS,
      },
    )
  }

  return {
    limit,
    modelStatus,
    page,
    result,
    season,
  }
}

const resolveBetListSeason = async (query, options = {}) => {
  if (query.season === BET_SEASON_ALL) {
    return {
      ...query,
      seasonBoundary: null,
      seasonMetadata: null,
    }
  }

  const seasonMetadata =
    options.seasonMetadata ??
    (await nhlSeasonService.getAvailablePowerRatingHistorySeasons(
      options.seasonOptions,
    ))
  const seasonId =
    query.season === BET_SEASON_CURRENT
      ? seasonMetadata?.currentSeasonId
      : query.season
  const season = seasonMetadata?.seasons?.find(
    (item) => item.id === String(seasonId),
  )

  if (!season) {
    throw new BetsError('season must match an available NHL season.', 400, {
      field: 'season',
    })
  }

  const start = new Date(`${season.startDate}T00:00:00.000Z`)
  const endExclusive = new Date(`${season.endDate}T00:00:00.000Z`)

  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    throw new BetsError('NHL season dates were unavailable.', 500)
  }

  return {
    ...query,
    season: season.id,
    seasonBoundary: {
      endExclusive,
      start,
    },
    seasonMetadata: {
      endDate: season.endDate,
      id: season.id,
      isCurrent: Boolean(season.isCurrent),
      label: season.label,
      startDate: season.startDate,
    },
  }
}

const normalizeBetHistoryModelStatus = (value) => {
  const normalizedValue = toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  if (
    normalizedValue === 'bet_candidate' ||
    normalizedValue === 'positive_value'
  ) {
    return BET_HISTORY_MODEL_STATUSES.BET_CANDIDATE
  }

  if (
    normalizedValue === 'positive_value_below_threshold' ||
    normalizedValue === 'below_threshold'
  ) {
    return BET_HISTORY_MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD
  }

  if (normalizedValue === 'no_value') {
    return BET_HISTORY_MODEL_STATUSES.NO_VALUE
  }

  return BET_HISTORY_MODEL_STATUSES.LEGACY
}

const buildBetListFilter = (userId, query) => {
  const filter = { userId }
  const compoundConditions = []

  if (query.result === 'settled') {
    filter.result = {
      $in: RESULT_VALUES.filter((result) => result !== 'pending'),
    }
  } else if (query.result === 'pending') {
    compoundConditions.push({
      $or: [{ result: 'pending' }, { result: null }],
    })
  } else if (query.result !== 'all') {
    filter.result = query.result
  }

  if (query.modelStatus !== 'all') {
    const normalizedModelStatus = normalizeBetHistoryModelStatus(
      query.modelStatus,
    )

    if (normalizedModelStatus === BET_HISTORY_MODEL_STATUSES.LEGACY) {
      compoundConditions.push({
        $or: [
          { modelStatus: BET_HISTORY_MODEL_STATUSES.LEGACY },
          { modelStatus: MODEL_STATUSES.LEGACY },
          {
            expectedValue: null,
            modelStatus: { $in: [null, ''] },
          },
          {
            modelStatus: { $nin: [...STORED_CURRENT_MODEL_STATUSES, null, ''] },
          },
        ],
      })
    } else if (
      normalizedModelStatus === BET_HISTORY_MODEL_STATUSES.BET_CANDIDATE
    ) {
      compoundConditions.push({
        $or: [
          {
            modelStatus: {
              $in: [
                MODEL_STATUSES.BET_CANDIDATE,
                MODEL_STATUSES.POSITIVE_VALUE,
              ],
            },
          },
          { recommendationState: 'BET_CANDIDATE' },
        ],
      })
    } else if (
      normalizedModelStatus ===
      BET_HISTORY_MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD
    ) {
      compoundConditions.push({
        $or: [
          {
            modelStatus: {
              $in: [
                MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD,
                MODEL_STATUSES.BELOW_THRESHOLD,
              ],
            },
          },
          { recommendationState: 'POSITIVE_VALUE_BELOW_THRESHOLD' },
        ],
      })
    } else {
      compoundConditions.push({
        $or: [
          { modelStatus: MODEL_STATUSES.NO_VALUE },
          { recommendationState: 'NO_VALUE' },
        ],
      })
    }
  }

  if (query.seasonBoundary) {
    const dateRange = {
      $gte: query.seasonBoundary.start,
      $lt: query.seasonBoundary.endExclusive,
    }

    compoundConditions.push({
      $or: [
        { scheduledStart: dateRange },
        {
          $and: [
            {
              $or: [
                { scheduledStart: null },
                { scheduledStart: { $exists: false } },
              ],
            },
            { analyzedAt: dateRange },
          ],
        },
      ],
    })
  }

  if (compoundConditions.length > 0) {
    filter.$and = compoundConditions
  }

  return filter
}

const resolveQueryRecords = async (query, selectedFields = '') => {
  let resolvedQuery = query

  if (selectedFields && typeof resolvedQuery.select === 'function') {
    resolvedQuery = resolvedQuery.select(selectedFields)
  }

  if (typeof resolvedQuery.lean === 'function') {
    resolvedQuery = resolvedQuery.lean()
  }

  return resolvedQuery
}

const getSummaryModelStatus = (bet) => {
  const recommendationStatus = RECOMMENDATION_STATE_LABELS[
    toText(bet.recommendationState).toUpperCase()
  ]

  if (recommendationStatus) {
    return normalizeBetHistoryModelStatus(recommendationStatus)
  }

  const rawModelStatus = toText(bet.modelStatus)
  const normalizedStatus = normalizeModelStatus(bet.modelStatus)

  if (normalizedStatus) {
    return normalizeBetHistoryModelStatus(normalizedStatus)
  }

  if (rawModelStatus) {
    return BET_HISTORY_MODEL_STATUSES.LEGACY
  }

  if (
    bet.expectedValue === null ||
    bet.expectedValue === '' ||
    bet.expectedValue === undefined
  ) {
    return BET_HISTORY_MODEL_STATUSES.LEGACY
  }

  const expectedValue = Number(bet.expectedValue)

  return Number.isFinite(expectedValue)
    ? normalizeBetHistoryModelStatus(getModelStatus(expectedValue))
    : BET_HISTORY_MODEL_STATUSES.LEGACY
}

const summarizeBets = (bets = []) =>
  bets.reduce(
    (summary, bet) => {
      const result = RESULT_VALUES.includes(bet.result) ? bet.result : 'pending'
      const stake = Math.max(toNumber(bet.stake, 1), 0)
      const profit = Number.isFinite(bet.profit)
        ? bet.profit
        : calculateProfit(bet)
      const modelStatus = getSummaryModelStatus(bet)

      summary.totalBets += 1
      summary.totalProfit += profit
      summary.totalStake += stake

      if (result === 'win') {
        summary.wins += 1
      } else if (result === 'loss') {
        summary.losses += 1
      } else if (result === 'push') {
        summary.pushes += 1
      } else if (result === 'pending') {
        summary.pending += 1
      }

      if (result !== 'pending') {
        summary.settledStake += stake
      }

      summary.statusCounts[modelStatus] =
        (summary.statusCounts[modelStatus] ?? 0) + 1

      return summary
    },
    {
      losses: 0,
      pending: 0,
      pushes: 0,
      settledStake: 0,
      statusCounts: {},
      totalBets: 0,
      totalProfit: 0,
      totalStake: 0,
      wins: 0,
    },
  )

const getBetsPage = async (userId, query = {}, options = {}) => {
  if (!userId) {
    throw new BetsError('Authenticated userId is required.', 401)
  }

  const betModel = options.betModel ?? Bet
  const normalizedQuery = await resolveBetListSeason(
    normalizeBetListQuery(query),
    options,
  )
  const filter = buildBetListFilter(userId, normalizedQuery)
  const skip = (normalizedQuery.page - 1) * normalizedQuery.limit
  const recordsQuery = betModel
    .find(filter)
    .sort({ analyzedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(normalizedQuery.limit)
  const summaryQuery = betModel.find(filter)
  const [records, totalItems, summaryRecords] = await Promise.all([
    resolveQueryRecords(recordsQuery),
    betModel.countDocuments(filter),
    resolveQueryRecords(
      summaryQuery,
      'expectedValue marketOdds modelStatus profit recommendationState result stake',
    ),
  ])
  const totalPages = Math.ceil(totalItems / normalizedQuery.limit)

  return {
    filters: {
      modelStatus: normalizedQuery.modelStatus,
      result: normalizedQuery.result,
      season: normalizedQuery.season,
    },
    items: (Array.isArray(records) ? records : []).map(serializeBet),
    pagination: {
      hasNextPage: normalizedQuery.page < totalPages,
      hasPreviousPage: normalizedQuery.page > 1,
      page: normalizedQuery.page,
      pageSize: normalizedQuery.limit,
      totalItems,
      totalPages,
    },
    summary: summarizeBets(Array.isArray(summaryRecords) ? summaryRecords : []),
    season: normalizedQuery.seasonMetadata,
  }
}

const createBet = async (userId, payload, options = {}) => {
  const normalizedPayload = normalizeCreatePayload(payload)

  if (normalizedPayload.placementId) {
    const existingBet = await Bet.findOne({
      placementId: normalizedPayload.placementId,
      userId,
    })

    if (existingBet) {
      return serializeBet(existingBet)
    }
  }

  const bet = new Bet({
    ...normalizedPayload,
    userId,
  })

  applyProfit(bet)

  try {
    await bankrollService.runWithOptionalTransaction(async (session) => {
      const scopedOptions = {
        ...options,
        session,
      }
      const shouldRecordStake =
        await bankrollService.shouldUseTransactionalAccounting(
          userId,
          bet,
          scopedOptions,
        )

      if (shouldRecordStake) {
        bet.bankrollAccounting = 'transactional'
        bet.stakeVersion = 1
      }

      if (session) {
        await bet.save({ session })
      } else {
        await bet.save()
      }

      if (shouldRecordStake) {
        try {
          await bankrollService.recordBetStakeForBet(
            userId,
            bet,
            scopedOptions,
          )
        } catch (error) {
          if (!session && typeof Bet.deleteOne === 'function') {
            await Bet.deleteOne({
              _id: bet._id,
              userId,
            })
          }

          throw error
        }
      } else if (bet.result !== 'pending') {
        await bankrollService.syncBetSettlementForBet(
          userId,
          bet,
          scopedOptions,
        )
      }
    }, options)
  } catch (error) {
    if (error?.code === 11000 && normalizedPayload.placementId) {
      const existingBet = await Bet.findOne({
        placementId: normalizedPayload.placementId,
        userId,
      })

      if (existingBet) {
        return serializeBet(existingBet)
      }
    }

    throw error
  }

  return serializeBet(bet)
}

const updateBet = async (userId, id, payload, options = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  const updates = normalizeUpdatePayload(payload)

  if (updates.result !== undefined) {
    if (Object.keys(updates).length > 1) {
      throw new BetsError(
        'Result changes must be saved separately from other bet edits.',
        400,
      )
    }

    const settlement = await betSettlementService.applySettlement(
      userId,
      id,
      updates.result,
      {
        ...options,
        source: 'manual',
      },
    )

    return serializeBet(settlement.bet)
  }

  const bet = await Bet.findOne({
    _id: id,
    userId,
  })

  if (!bet) {
    throw new BetsError('Bet was not found.', 404)
  }

  if (updates.stake !== undefined && bet.result !== 'pending') {
    throw new BetsError(
      'Stake cannot be edited after a bet has been settled.',
      409,
      { field: 'stake' },
    )
  }

  if (
    updates.stake !== undefined &&
    bet.bankrollAccounting === 'transactional'
  ) {
    await bankrollService.runWithOptionalTransaction(async (session) => {
      await bankrollService.recordBetStakeAdjustment(
        userId,
        bet,
        updates.stake,
        {
          ...options,
          session,
        },
      )
      bet.stakeVersion = (Number(bet.stakeVersion) || 1) + 1
      Object.assign(bet, updates)
      applyProfit(bet)

      if (session) {
        await bet.save({ session })
      } else {
        await bet.save()
      }
    }, options)

    return serializeBet(bet)
  }

  Object.assign(bet, updates)
  applyProfit(bet)
  await bet.save()

  return serializeBet(bet)
}

const deleteBet = async (userId, id, options = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  if (
    mongoose.connection.readyState !== 1 &&
    !options.transactionModel &&
    !options.profileModel
  ) {
    const deletedBet = await Bet.findOneAndDelete({
      _id: id,
      userId,
    })

    if (!deletedBet) {
      throw new BetsError('Bet was not found.', 404)
    }

    return serializeBet(deletedBet)
  }

  const deletedBet = await bankrollService.runWithOptionalTransaction(
    async (session) => {
      const bet = await Bet.findOne({
        _id: id,
        userId,
      }).session(session ?? null)

      if (!bet) {
        throw new BetsError('Bet was not found.', 404)
      }

      if (bet.result !== 'pending') {
        throw new BetsError(
          'Settled bets cannot be deleted because their audit history must be preserved.',
          409,
        )
      }

      if (bet.bankrollAccounting === 'transactional') {
        await bankrollService.recordPendingBetCancellation(userId, bet, {
          ...options,
          session,
        })
      }

      return Bet.findOneAndDelete(
        {
          _id: id,
          result: 'pending',
          userId,
        },
        session ? { session } : undefined,
      )
    },
    options,
  )

  if (!deletedBet) {
    throw new BetsError('Bet was not found.', 404)
  }

  return serializeBet(deletedBet)
}

module.exports = {
  BetsError,
  DEFAULT_BET_LIMIT,
  DEFAULT_BET_PAGE,
  MAX_BET_LIMIT,
  SUPPORTED_BET_LIMITS,
  RESULT_VALUES,
  calculateProfit,
  createBet,
  deleteBet,
  getBets,
  getBetsPage,
  normalizeBetListQuery,
  normalizeCreatePayload,
  normalizeGoalieSelectionSnapshot,
  updateBet,
}
