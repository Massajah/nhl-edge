const mongoose = require('mongoose')
const Bet = require('../models/Bet')

const RESULT_VALUES = Bet.RESULT_VALUES
const EDITABLE_FIELDS = [
  'result',
  'stake',
  'stakeType',
  'sportsbook',
  'closingOdds',
  'notes',
]

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
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
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

  if (value < 0) {
    throw new BetsError('stake cannot be negative.', 400, { field: 'stake' })
  }

  return value
}

const normalizeAdjustments = (adjustments = {}) => ({
  homeAdvantage: toNumber(adjustments.homeAdvantage),
  homeInjuries: toNumber(adjustments.homeInjuries),
  awayInjuries: toNumber(adjustments.awayInjuries),
  homeGoalie: toNumber(adjustments.homeGoalie),
  awayGoalie: toNumber(adjustments.awayGoalie),
  homeRecentForm: toNumber(adjustments.homeRecentForm),
  awayRecentForm: toNumber(adjustments.awayRecentForm),
  homeMotivation: toNumber(adjustments.homeMotivation),
  awayMotivation: toNumber(adjustments.awayMotivation),
})

const calculateProfit = ({ marketOdds, result, stake }) => {
  if (result === 'win') {
    return (marketOdds - 1) * stake
  }

  if (result === 'loss') {
    return -stake
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

  return {
    gameId: toText(payload.gameId),
    analyzedAt: toDate(payload.analyzedAt ?? new Date(), 'analyzedAt'),
    scheduledStart: toDate(payload.scheduledStart, 'scheduledStart', {
      allowNull: true,
    }),
    homeTeam: normalizeTeam(payload.homeTeam, 'homeTeam'),
    awayTeam: normalizeTeam(payload.awayTeam, 'awayTeam'),
    selectedSide: normalizeSelectedSide(payload.selectedSide),
    modelProbability: toNumber(payload.modelProbability),
    fairOdds: toNumber(payload.fairOdds),
    marketOdds,
    probabilityEdge: toNumber(payload.probabilityEdge),
    oddsValuePercentage: toNumber(payload.oddsValuePercentage),
    recommendation: toText(payload.recommendation),
    stake,
    stakeType: toText(payload.stakeType, 'units') || 'units',
    sportsbook: toText(payload.sportsbook),
    closingOdds: toFiniteNumber(payload.closingOdds, 'closingOdds', {
      allowNull: true,
    }),
    result,
    notes: toText(payload.notes),
    adjustments: normalizeAdjustments(payload.adjustments),
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

const getBets = async () => {
  const bets = await Bet.find({}).sort({ analyzedAt: -1, createdAt: -1 })

  return bets.map(serializeBet)
}

const createBet = async (payload) => {
  const bet = new Bet(normalizeCreatePayload(payload))

  applyProfit(bet)
  await bet.save()

  return serializeBet(bet)
}

const updateBet = async (id, payload) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  const updates = normalizeUpdatePayload(payload)
  const bet = await Bet.findById(id)

  if (!bet) {
    throw new BetsError('Bet was not found.', 404)
  }

  Object.assign(bet, updates)
  applyProfit(bet)
  await bet.save()

  return serializeBet(bet)
}

const deleteBet = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BetsError('Bet was not found.', 404)
  }

  const deletedBet = await Bet.findByIdAndDelete(id)

  if (!deletedBet) {
    throw new BetsError('Bet was not found.', 404)
  }

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
