import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createServer as createViteServer } from 'vite'

const CLIENT_HOST = '127.0.0.1'
const CLIENT_PORT = 5174
const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 5001
const E2E_DATABASE_NAME = 'nhl_edge_e2e'
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(currentDirectory, '../..')
const repositoryRoot = path.resolve(clientRoot, '..')
const require = createRequire(import.meta.url)

let memoryReplicaSet = null
let httpServer = null
let serverModule = null
let viteServer = null
let startPromise = null
let stopPromise = null

const assertEphemeralMongoUri = (mongoUri) => {
  const parsed = new URL(mongoUri)
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)

  if (
    parsed.protocol !== 'mongodb:' ||
    !isLoopback ||
    parsed.pathname !== `/${E2E_DATABASE_NAME}`
  ) {
    throw new Error('E2E MongoDB must be an isolated loopback database.')
  }
}

const applyIsolatedEnvironment = (mongoUri) => {
  const values = {
    AUTH_RATE_LIMIT: '100',
    CLIENT_ORIGIN: `http://${CLIENT_HOST}:${CLIENT_PORT}`,
    DEMO_AUTH_RATE_LIMIT: '100',
    GOOGLE_CLIENT_ID: '',
    LOCAL_AUTH_ENABLED: 'false',
    MONGODB_URI: mongoUri,
    NHL_EDGE_API_DEBUG: 'false',
    NHL_EDGE_CONTEXT_DEBUG: 'false',
    NHL_EDGE_E2E: 'true',
    NODE_ENV: 'development',
    PORT: String(SERVER_PORT),
    SESSION_COOKIE_SAME_SITE: 'lax',
    SESSION_COOKIE_SECURE: 'false',
    THE_ODDS_API_KEY: '',
    VITE_API_BASE_URL: '',
    VITE_GOOGLE_CLIENT_ID: '',
    VITE_LOCAL_AUTH_ENABLED: 'false',
    VITE_USE_MOCK_GAMES: 'true',
  }

  Object.entries(values).forEach(([key, value]) => {
    process.env[key] = value
  })
}

export const startTestStack = async () => {
  if (startPromise) return startPromise

  startPromise = (async () => {
    memoryReplicaSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: E2E_DATABASE_NAME,
        storageEngine: 'wiredTiger',
      },
    })

    const mongoUri = memoryReplicaSet.getUri(E2E_DATABASE_NAME)
    assertEphemeralMongoUri(mongoUri)
    applyIsolatedEnvironment(mongoUri)

    serverModule = require(path.join(repositoryRoot, 'server', 'index.js'))
    httpServer = await serverModule.startServer()

    viteServer = await createViteServer({
      logLevel: 'error',
      root: clientRoot,
      server: {
        host: CLIENT_HOST,
        port: CLIENT_PORT,
        proxy: {
          '/api': {
            target: `http://${SERVER_HOST}:${SERVER_PORT}`,
          },
        },
        strictPort: true,
      },
    })
    await viteServer.listen()
  })()

  try {
    await startPromise
  } catch (error) {
    await stopTestStack()
    throw error
  }
}

export const stopTestStack = async () => {
  if (stopPromise) return stopPromise

  stopPromise = (async () => {
    const cleanupErrors = []

    if (viteServer) {
      try {
        await viteServer.close()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (serverModule) {
      try {
        httpServer?.closeIdleConnections?.()
        httpServer?.closeAllConnections?.()
        await serverModule.shutdown('E2E shutdown')
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (memoryReplicaSet) {
      try {
        await memoryReplicaSet.stop()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Unable to stop the E2E stack cleanly.')
    }
  })()

  return stopPromise
}
