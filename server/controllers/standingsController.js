const standingsService = require('../services/standingsService')
const playoffService = require('../services/playoffService')

const getStandings = async (request, response, next) => {
  try {
    const result = await standingsService.getStandings(request.query)

    response.json(result)
  } catch (error) {
    next(error)
  }
}

const getPlayoffs = async (request, response, next) => {
  try {
    const result = await playoffService.getPlayoffs(request.query)

    response.json(result)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getPlayoffs,
  getStandings,
}
