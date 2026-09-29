const Bet = require('../models/Bet')
const User = require('../models/User')
const { getProductionAccountFilter } = require('../config/accountTypes')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const { CLOSING_SAFETY_REASON } = require('./oddsClosingMarketContracts')
const { getNhlTeamIdentity } = require('./nhlTeamIdentity')

const supportedBookmakers = new Set(REQUESTED_BOOKMAKERS.map(({ key }) => key))
const asRows = async (query) => typeof query?.lean === 'function' ? query.lean() : query
const validTime = (value) => {
  if (value === null || value === undefined || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

const requirementFromBet = (bet, game) => {
  const start = game.scheduledStart.getTime()
  const created = validTime(bet.createdAt)
  const key = String(bet.bookmakerKey ?? '').trim()
  const market = key === 'coolbet' ? 'h2h_ot' : 'h2h'
  const side = bet.selectedSide?.homeAway
  const selected = getNhlTeamIdentity(
    bet.selectedSide?.teamId || bet.selectedSide?.abbreviation,
    bet.selectedTeam?.teamId || bet.selectedTeam?.abbreviation,
  )
  if (
    bet.marketOddsSource !== 'provider' ||
    String(bet.gameId ?? '') !== game.gameId ||
    validTime(bet.scheduledStart) !== start ||
    created === null || created >= start ||
    !supportedBookmakers.has(key) ||
    (bet.providerMarketKey && bet.providerMarketKey !== market) ||
    (key === 'coolbet' && bet.providerMarketKey !== 'h2h_ot') ||
    !Number.isFinite(Number(bet.marketOdds)) || Number(bet.marketOdds) <= 1 ||
    !['home', 'away'].includes(side) ||
    selected !== (side === 'home' ? game.homeTeamId : game.awayTeamId)
  ) return null

  return { bookmakerKey: key, providerMarketKey: market, betCreatedAt: created }
}

const hasSafeClosingRow = (closing, requirement, game) => {
  if (!closing || closing.gameId !== game.gameId ||
      validTime(closing.scheduledStartAtCapture) !== game.scheduledStart.getTime() ||
      closing.homeTeamId !== game.homeTeamId ||
      closing.awayTeamId !== game.awayTeamId) return false
  return (closing.latestSafeBookmakers ?? []).some((row) => {
    const observed = validTime(row.observedAt)
    return row.key === requirement.bookmakerKey &&
      (row.providerMarketKey ?? 'h2h') === requirement.providerMarketKey &&
      row.safetyReason === CLOSING_SAFETY_REASON &&
      validTime(row.providerCommenceTime) === game.scheduledStart.getTime() &&
      observed !== null && observed > requirement.betCreatedAt &&
      observed < game.scheduledStart.getTime() &&
      Number.isFinite(Number(row.homeOdds)) && Number(row.homeOdds) > 1 &&
      Number.isFinite(Number(row.awayOdds)) && Number(row.awayOdds) > 1
  })
}

const createOddsClosingRequirementService = ({
  betModel = Bet,
  userModel = User,
} = {}) => ({
  async findForGames(games) {
    if (!games.length) return new Map()
    const users = await asRows(userModel.find({
      $and: [
        { $or: [{ status: 'active' }, { status: { $exists: false } }] },
        getProductionAccountFilter(),
      ],
    }, { _id: 1 }))
    const userIds = (users ?? []).map((user) => user._id)
    if (!userIds.length) return new Map()
    const activeUserIds = new Set(userIds.map(String))
    const bets = await asRows(betModel.find({
      userId: { $in: userIds },
      gameId: { $in: games.map(({ gameId }) => gameId) },
      marketOddsSource: 'provider',
    }, {
      bookmakerKey: 1, createdAt: 1, gameId: 1, marketOdds: 1, userId: 1,
      marketOddsSource: 1, providerMarketKey: 1, scheduledStart: 1,
      selectedSide: 1, selectedTeam: 1,
    }))
    const result = new Map(games.map((game) => [game.gameId, []]))
    for (const game of games) {
      const byMarket = new Map()
      for (const bet of bets ?? []) {
        if (!activeUserIds.has(String(bet.userId))) continue
        const requirement = requirementFromBet(bet, game)
        if (!requirement) continue
        const identity = `${requirement.bookmakerKey}|${requirement.providerMarketKey}`
        const current = byMarket.get(identity)
        if (!current || current.betCreatedAt < requirement.betCreatedAt) {
          byMarket.set(identity, requirement)
        }
      }
      result.set(game.gameId, [...byMarket.values()])
    }
    return result
  },
})

const oddsClosingRequirementService = createOddsClosingRequirementService()

module.exports = {
  createOddsClosingRequirementService,
  hasSafeClosingRow,
  oddsClosingRequirementService,
}
