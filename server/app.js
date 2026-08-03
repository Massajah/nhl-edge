const cors = require('cors')
const express = require('express')
const authRoutes = require('./routes/authRoutes')
const bankrollRoutes = require('./routes/bankrollRoutes')
const betsRoutes = require('./routes/betsRoutes')
const gameContextRoutes = require('./routes/gameContextRoutes')
const injuriesRoutes = require('./routes/injuriesRoutes')
const marketOddsRoutes = require('./routes/marketOddsRoutes')
const nhlApiService = require('./services/nhlApiService')
const playersRoutes = require('./routes/playersRoutes')
const powerRatingSimulationsRoutes = require('./routes/powerRatingSimulationsRoutes')
const powerRatingsRoutes = require('./routes/powerRatingsRoutes')
const settingsRoutes = require('./routes/settingsRoutes')
const teamsRoutes = require('./routes/teamsRoutes')
const { getCorsOptions } = require('./config/cors')

const app = express()

app.use(cors(getCorsOptions()))
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }))

app.get('/api', (_request, response) => {
  response.json({
    name: 'NHL Edge API',
    status: 'ready',
  })
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'nhl-edge-server',
    database: process.env.MONGODB_URI ? 'configured' : 'not configured',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/bankroll', bankrollRoutes)
app.use('/api/bets', betsRoutes)
app.use('/api/game-context', gameContextRoutes)
app.use('/api/injuries', injuriesRoutes)
app.use('/api/market-odds', marketOddsRoutes)
app.use('/api/players', playersRoutes)
app.use('/api/power-rating-simulations', powerRatingSimulationsRoutes)
app.use('/api/power-ratings', powerRatingsRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/teams', teamsRoutes)

app.get('/api/schedule/today', async (_request, response, next) => {
  try {
    const schedule = await nhlApiService.getTodaysGames()
    response.json(schedule)
  } catch (error) {
    next(error)
  }
})

app.get('/api/schedule/:date', async (request, response, next) => {
  const { date } = request.params

  if (!nhlApiService.isValidScheduleDate(date)) {
    response.status(400).json({
      error: 'Date must use YYYY-MM-DD format.',
      message: 'Date must use YYYY-MM-DD format.',
    })
    return
  }

  try {
    const schedule = await nhlApiService.getGamesForDate(date)
    response.json(schedule)
  } catch (error) {
    next(error)
  }
})

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode ?? error.status ?? 500

  console.error('API request failed:', {
    message: error.message,
    upstreamStatus: error.upstreamStatus,
  })

  const fallbackMessage =
    error.name === 'NhlApiError'
      ? 'Unable to load NHL data right now.'
      : 'Unable to complete the API request right now.'
  const message =
    statusCode >= 500
      ? (error.publicMessage ?? fallbackMessage)
      : error.message
  const responseBody = {
    error: message,
    message,
  }

  if (statusCode < 500 && error.details) {
    responseBody.details = error.details
  }

  response.status(statusCode).json(responseBody)
})

module.exports = app
