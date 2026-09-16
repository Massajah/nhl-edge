require('dotenv').config()

const mongoose = require('mongoose')
const app = require('./app')
const connectDB = require('./config/db')
const { assertAuthConfig } = require('./config/auth')
const { assertDemoSandboxConfig } = require('./config/demoSandbox')

const PORT = process.env.PORT || 5000
const HOST = '0.0.0.0'
let activeServer = null
let shutdownStarted = false

async function startServer() {
  assertAuthConfig()
  assertDemoSandboxConfig()
  await connectDB()

  activeServer = app.listen(PORT, HOST, () => {
    console.log(`NHL Edge server running on port ${PORT}`)
  })

  return activeServer
}

const closeHttpServer = (server) =>
  new Promise((resolve, reject) => {
    if (!server) {
      resolve()
      return
    }

    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

async function shutdown(signal) {
  if (shutdownStarted) return
  shutdownStarted = true

  console.log(`${signal} received. Shutting down NHL Edge server.`)

  try {
    await closeHttpServer(activeServer)
    await mongoose.disconnect()
    console.log('NHL Edge server stopped cleanly.')
  } catch (error) {
    console.error('Failed to stop NHL Edge server cleanly:', error.message)
    process.exitCode = 1
  }
}

if (require.main === module) {
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))

  startServer().catch((error) => {
    console.error('Failed to start NHL Edge server:', error.message)
    process.exit(1)
  })
}

module.exports = {
  app,
  shutdown,
  startServer,
}
