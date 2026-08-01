const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const bankrollService = require('./bankrollService')

const RESULT_VALUES = Bet.RESULT_VALUES
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
  POSITIVE_VALUE: 'Positive Value',
  BELOW_THRESHOLD: 'Below Threshold',
  NO_VALUE: 'No Value',
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

  if (normalizedStatus === 'below threshold') {
    return MODEL_STATUSES.BELOW_THRESHOLD
  }

  if (normalizedStatus === 'no value') {
    return MODEL_STATUSES.NO_VALUE
  }

  return ''
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
  const modelStatus =
    normalizeModelStatus(payload.modelStatus) || getModelStatus(expectedValue)

  return {
    gameId: toText(payload.gameId),
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
    modelProbability,
    fairOdds,
    marketOdds,
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
    motivationAdjustment: toOptionalNumber(
      payload.motivationAdjustment,
      'motivationAdjustment',
    ),
    manualAdjustment: toOptionalNumber(
      payload.manualAdjustment,
      'manualAdjustment',
    ),
    selectedGoalieName: toText(payload.selectedGoalieName),
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
    kellyRecommendation: normalizeKellyRecommendationSnapshot(
      payload.kellyRecommendation,
    ),
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

const createBet = async (userId, payload) => {
  const bet = new Bet({
    ...normalizeCreatePayload(payload),
    userId,
  })

  applyProfit(bet)
  await bet.save()
  await bankrollService.syncBetSettlementForBet(userId, bet)

  return serializeBet(bet)
}

const updateBet = async (userId, id, payload) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  const updates = normalizeUpdatePayload(payload)
  const bet = await Bet.findOne({
    _id: id,
    userId,
  })

  if (!bet) {
    throw new BetsError('Bet was not found.', 404)
  }

  Object.assign(bet, updates)
  applyProfit(bet)
  await bet.save()
  await bankrollService.syncBetSettlementForBet(userId, bet)

  return serializeBet(bet)
}

const deleteBet = async (userId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  const deletedBet = await Bet.findOneAndDelete({
    _id: id,
    userId,
  })

  if (!deletedBet) {
    throw new BetsError('Bet was not found.', 404)
  }

  await bankrollService.removeBetSettlementForBet(userId, deletedBet._id)

  return serializeBet(deletedBet)
}

module.exports = {
  BetsError,
  RESULT_VALUES,
  calculateProfit,
  createBet,
  deleteBet,
  getBets,
  updateBet,
}
