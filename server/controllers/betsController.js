const betsService = require('../services/betsService')
const betSettlementService = require('../services/betSettlementService')

const getBets = async (request, response, next) => {
  try {
    const bets = await betsService.getBets(request.user.id)

    response.json({ bets })
  } catch (error) {
    next(error)
  }
}

const createBet = async (request, response, next) => {
  try {
    const bet = await betsService.createBet(request.user.id, request.body)

    response.status(201).json({ bet })
  } catch (error) {
    next(error)
  }
}

const updateBet = async (request, response, next) => {
  try {
    const bet = await betsService.updateBet(
      request.user.id,
      request.params.id,
      request.body,
    )

    response.json({ bet })
  } catch (error) {
    next(error)
  }
}

const deleteBet = async (request, response, next) => {
  try {
    const bet = await betsService.deleteBet(request.user.id, request.params.id)

    response.json({ bet })
  } catch (error) {
    next(error)
  }
}

const settlePendingBets = async (request, response, next) => {
  try {
    const summary = await betSettlementService.settlePendingMoneylineBets(
      request.user.id,
    )

    response.json({ summary })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createBet,
  deleteBet,
  getBets,
  settlePendingBets,
  updateBet,
}
