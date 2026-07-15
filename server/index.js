require('dotenv').config()

const cors = require('cors')
const express = require('express')
const betsRoutes = require('./routes/betsRoutes')
const connectDB = require('./config/db')
const injuriesRoutes = require('./routes/injuriesRoutes')
const nhlApiService = require('./services/nhlApiService')
const powerRatingsRoutes = require('./routes/powerRatingsRoutes')

const app = express()
const PORT = process.env.PORT || 5000

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
  }),
)
app.use(express.json())

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

app.use('/api/bets', betsRoutes)
app.use('/api/injuries', injuriesRoutes)
app.use('/api/power-ratings', powerRatingsRoutes)

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
      ? "Unable to load today's NHL schedule right now."
      : 'Unable to complete the API request right now.'
  const responseBody = {
    error:
      statusCode >= 500
        ? (error.publicMessage ?? fallbackMessage)
        : error.message,
  }

  if (statusCode < 500 && error.details) {
    responseBody.details = error.details
  }

  response.status(statusCode).json(responseBody)
})

async function startServer() {
  await connectDB()

  app.listen(PORT, () => {
    console.log(`NHL Edge server running on port ${PORT}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start NHL Edge server:', error.message)
  process.exit(1)
})
