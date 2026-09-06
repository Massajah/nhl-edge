require('dotenv').config()

const app = require('./app')
const connectDB = require('./config/db')
const { assertAuthConfig } = require('./config/auth')

const PORT = process.env.PORT || 5000
const HOST = '0.0.0.0'

async function startServer() {
  assertAuthConfig()
  await connectDB()

  app.listen(PORT, HOST, () => {
    console.log(`NHL Edge server running on port ${PORT}`)
  })
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start NHL Edge server:', error.message)
    process.exit(1)
  })
}

module.exports = {
  app,
  startServer,
}
