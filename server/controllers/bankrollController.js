const bankrollService = require('../services/bankrollService')

const initializeBankroll = async (request, response, next) => {
  try {
    const result = await bankrollService.initializeBankroll(
      request.user.id,
      request.body,
    )

    response.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

const addDeposit = async (request, response, next) => {
  try {
    const result = await bankrollService.addDeposit(request.user.id, request.body)

    response.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

const addWithdrawal = async (request, response, next) => {
  try {
    const result = await bankrollService.addWithdrawal(
      request.user.id,
      request.body,
    )

    response.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

const getBankrollSummary = async (request, response, next) => {
  try {
    const summary = await bankrollService.getBankrollSummary(
      request.user.id,
      request.query,
    )

    response.json({ summary })
  } catch (error) {
    next(error)
  }
}

const getBankrollTransactions = async (request, response, next) => {
  try {
    const result = await bankrollService.getBankrollTransactions(
      request.user.id,
      request.query,
    )

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getBankrollSeasons = async (_request, response, next) => {
  try {
    const result = await bankrollService.getBankrollSeasons()

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  addDeposit,
  addWithdrawal,
  getBankrollSeasons,
  getBankrollSummary,
  getBankrollTransactions,
  initializeBankroll,
}
