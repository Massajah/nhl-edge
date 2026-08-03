const { marketOddsService } = require('../services/marketOddsService')
const bookmakerPreferencesService = require('../services/bookmakerPreferencesService')
const {
  filterMarketOddsForBookmakers,
} = require('../services/bookmakerOddsFilter')
const nhlApiService = require('../services/nhlApiService')

const getNhlMarketOdds = async (request, response, next) => {
  const date = String(request.query.date ?? '')

  if (!nhlApiService.isValidScheduleDate(date)) {
    response.status(400).json({
      error: 'Date must use YYYY-MM-DD format.',
      message: 'Date must use YYYY-MM-DD format.',
    })
    return
  }

  try {
    const publicResult = await marketOddsService.getNhlMarketOdds({
      date,
      refresh: request.query.refresh === 'true',
    })
    const { preferences } =
      await bookmakerPreferencesService.getBookmakerPreferences(
        request.user.id,
        publicResult.availableBookmakers,
      )
    const result = filterMarketOddsForBookmakers(
      publicResult,
      preferences.enabledBookmakerKeys,
    )

    response.json({
      ...result,
      bookmakerPreferences: {
        enabledBookmakerKeys: preferences.enabledBookmakerKeys,
        fallbackApplied: preferences.fallbackApplied,
        warning: preferences.warning,
      },
    })
  } catch (error) {
    next(error)
  }
}

const getMarketOddsStatus = (_request, response) => {
  response.json(marketOddsService.getStatus())
}

module.exports = {
  getMarketOddsStatus,
  getNhlMarketOdds,
}
