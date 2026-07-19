require('dotenv').config()

const app = require('./app')
const connectDB = require('./config/db')
const { assertJwtConfig } = require('./config/auth')

const PORT = process.env.PORT || 5000

async function startServer() {
  assertJwtConfig()
  await connectDB()

  app.listen(PORT, () => {
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
