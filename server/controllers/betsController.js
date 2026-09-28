const betsService = require('../services/betsService')
const betSettlementService = require('../services/betSettlementService')
const startingGoalieAuditService = require('../services/startingGoalieAuditService')
const { isDemoSandboxAccount } = require('../config/accountTypes')

const getStartingGoalieAudits = async (request, response, next) => {
  try {
    const result = await startingGoalieAuditService.getBetsStartingGoalieAudits(
      request.user.id,
      request.query.betIds,
      { demo: isDemoSandboxAccount(request.authUser) },
    )
    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getBets = async (request, response, next) => {
  try {
    const usesPaginatedQuery = [
      'page',
      'limit',
      'result',
      'modelStatus',
      'season',
    ].some((field) => request.query[field] !== undefined)

    if (usesPaginatedQuery) {
      const result = await betsService.getBetsPage(
        request.user.id,
        request.query,
      )

      response.json(result)
      return
    }

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
  getStartingGoalieAudits,
  settlePendingBets,
  updateBet,
}
