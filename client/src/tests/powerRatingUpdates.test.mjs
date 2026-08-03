import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let apiClient
let powerRatingsApi
let updateUtils
let vite

const successResponse = {
  success: true,
  dateRange: {
    from: '2025-03-01',
    to: '2025-03-07',
  },
  gamesFound: 1,
  gamesAlreadyProcessed: 0,
  gamesProcessed: 1,
  gamesSkipped: 0,
  errors: [],
  processedGames: [
    {
      gameDate: '2025-03-01',
      gameId: 2001,
      awayTeam: 'BUF',
      homeTeam: 'CAR',
      awayScore: 4,
      homeScore: 2,
      resultType: 'REGULATION',
      awayRatingBefore: 53.4,
      awayRatingAfter: 54.1,
      awayRatingChange: 0.7,
      homeRatingBefore: 56.8,
      homeRatingAfter: 56.1,
      homeRatingChange: -0.7,
    },
  ],
}

const automaticSuccessResponse = {
  status: 'updated',
  success: true,
  dateRange: {
    from: '2025-03-01',
    to: '2025-03-07',
  },
  gamesFound: 2,
  gamesAlreadyProcessed: 1,
  gamesProcessed: 1,
  gamesSkipped: 0,
  errors: [],
  latestProcessedGame: {
    gameDate: '2025-03-07',
    gameId: 2002,
    awayTeam: 'BUF',
    homeTeam: 'CAR',
    awayScore: 3,
    homeScore: 2,
    resultType: 'OVERTIME',
    settingsSnapshot: {
      homeAdvantage: 4,
      kFactor: 1.2,
      modelVersion: 'power-rating-v1',
      overtimeMultiplier: 0.7,
      regulationMultiplier: 1,
      shootoutMultiplier: 0.5,
    },
  },
  processedGames: successResponse.processedGames,
  ratingSettingsUsed: {
    homeAdvantage: 4,
    kFactor: 1.2,
    modelVersion: 'power-rating-v1',
    overtimeMultiplier: 0.7,
    regulationMultiplier: 1,
    shootoutMultiplier: 0.5,
  },
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  apiClient = await vite.ssrLoadModule('/src/services/apiClient.js')
  powerRatingsApi = await vite.ssrLoadModule('/src/services/powerRatingsApi.js')
  updateUtils = await vite.ssrLoadModule('/src/utils/powerRatingUpdates.js')
})

after(async () => {
  await vite?.close()
})

test('updatePowerRatings formats a valid date range request', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('ratings-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(JSON.stringify(successResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const result = await powerRatingsApi.updatePowerRatings({
      from: '2025-03-01',
      to: '2025-03-07',
    })

    assert.equal(result.gamesProcessed, 1)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequests.length, 1)
  assert.equal(capturedRequests[0].url, '/api/power-ratings/update')
  assert.equal(capturedRequests[0].method, 'POST')
  assert.deepEqual(capturedRequests[0].body, {
    from: '2025-03-01',
    to: '2025-03-07',
  })
  assert.equal(
    Object.hasOwn(capturedRequests[0].body, 'userId'),
    false,
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer ratings-token',
  )
})

test('autoUpdatePowerRatings deduplicates in-flight requests without userId', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []
  let resolveResponse
  const responseReady = new Promise((resolve) => {
    resolveResponse = resolve
  })

  apiClient.setAuthToken('ratings-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })
    await responseReady

    return new Response(JSON.stringify(automaticSuccessResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const firstRequest = powerRatingsApi.autoUpdatePowerRatings()
    const secondRequest = powerRatingsApi.autoUpdatePowerRatings()

    resolveResponse()

    const [firstResult, secondResult] = await Promise.all([
      firstRequest,
      secondRequest,
    ])

    assert.equal(firstResult, secondResult)
    assert.equal(firstResult.status, 'updated')
    assert.equal(firstResult.gamesProcessed, 1)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequests.length, 1)
  assert.equal(capturedRequests[0].url, '/api/power-ratings/auto-update')
  assert.equal(capturedRequests[0].method, 'POST')
  assert.deepEqual(capturedRequests[0].body, {})
  assert.equal(Object.hasOwn(capturedRequests[0].body, 'userId'), false)
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer ratings-token',
  )
})

test('Power Rating update date validation rejects Date From after Date To', () => {
  const validation = updateUtils.validatePowerRatingUpdateRange(
    {
      from: '2025-03-08',
      to: '2025-03-07',
    },
    {
      today: '2025-03-10',
    },
  )

  assert.equal(validation.isValid, false)
  assert.match(validation.fieldErrors.from, /on or before/)
})

test('Power Rating update date validation rejects future dates', () => {
  const validation = updateUtils.validatePowerRatingUpdateRange(
    {
      from: '2025-03-01',
      to: '2025-03-11',
    },
    {
      today: '2025-03-10',
    },
  )

  assert.equal(validation.isValid, false)
  assert.match(validation.fieldErrors.to, /future/)
})

test('Power Rating update UI guard prevents duplicate submissions', () => {
  const validation = updateUtils.validatePowerRatingUpdateRange(
    {
      from: '2025-03-01',
      to: '2025-03-07',
    },
    {
      today: '2025-03-10',
    },
  )

  assert.equal(
    updateUtils.canRunPowerRatingUpdate({
      isUpdating: false,
      validation,
    }),
    true,
  )
  assert.equal(
    updateUtils.canRunPowerRatingUpdate({
      isUpdating: true,
      validation,
    }),
    false,
  )
})

test('Power Rating update result summary is normalized', () => {
  const result = updateUtils.normalizePowerRatingUpdateResult(successResponse)

  assert.equal(result.success, true)
  assert.equal(result.gamesFound, 1)
  assert.equal(result.processedGames[0].gameDate, '2025-03-01')
  assert.equal(result.processedGames[0].awayTeam, 'BUF')
  assert.equal(result.processedGames[0].awayScore, 4)
  assert.equal(
    updateUtils.formatSignedRatingChange(
      result.processedGames[0].homeRatingChange,
    ),
    '-0.70',
  )
  assert.throws(
    () => updateUtils.normalizePowerRatingUpdateResult({ success: true }),
    /malformed/,
  )
})

test('automatic Power Rating update result summary is normalized', () => {
  const result = updateUtils.normalizeAutomaticPowerRatingUpdateResult(
    automaticSuccessResponse,
  )

  assert.equal(result.status, 'updated')
  assert.equal(result.success, true)
  assert.equal(result.dateRange.from, '2025-03-01')
  assert.equal(result.gamesAlreadyProcessed, 1)
  assert.equal(result.latestProcessedGame.gameId, '2002')
  assert.equal(result.latestProcessedGame.settingsSnapshot.kFactor, 1.2)
  assert.equal(result.ratingSettingsUsed.homeAdvantage, 4)
  assert.throws(
    () => updateUtils.normalizeAutomaticPowerRatingUpdateResult({}),
    /malformed/,
  )
})

test('automatic update initialization and unavailable responses normalize safely', () => {
  const initializationResult =
    updateUtils.normalizeAutomaticPowerRatingUpdateResult({
      dateRange: null,
      errors: [],
      gamesAlreadyProcessed: 0,
      gamesFound: 0,
      gamesProcessed: 0,
      gamesSkipped: 0,
      latestProcessedGame: null,
      message:
        'Power Rating automatic updates need an initial processing point.',
      processedGames: [],
      ratingSettingsUsed: null,
      status: 'requires_initialization',
      success: false,
    })
  const unavailableResult =
    updateUtils.normalizeAutomaticPowerRatingUpdateResult({
      dateRange: {
        from: '2025-03-01',
        to: '2025-03-07',
      },
      errors: [
        {
          code: 'AUTO_UPDATE_UNAVAILABLE',
          gameId: null,
          reason: 'Schedule unavailable.',
        },
      ],
      gamesAlreadyProcessed: 0,
      gamesFound: 0,
      gamesProcessed: 0,
      gamesSkipped: 1,
      latestProcessedGame: null,
      processedGames: [],
      ratingSettingsUsed: null,
      status: 'unavailable',
      success: false,
    })

  assert.equal(initializationResult.dateRange, null)
  assert.equal(initializationResult.status, 'requires_initialization')
  assert.match(initializationResult.message, /initial processing point/)
  assert.equal(unavailableResult.status, 'unavailable')
  assert.equal(unavailableResult.errors[0].reason, 'Schedule unavailable.')
})

test('zero newly processed games is a neutral successful result', () => {
  const result = updateUtils.normalizePowerRatingUpdateResult({
    success: true,
    dateRange: {
      from: '2025-03-01',
      to: '2025-03-07',
    },
    gamesFound: 2,
    gamesAlreadyProcessed: 2,
    gamesProcessed: 0,
    gamesSkipped: 0,
    errors: [],
    processedGames: [],
  })

  assert.equal(updateUtils.getPowerRatingUpdateOutcomeTone(result), 'neutral')
  assert.match(
    updateUtils.getPowerRatingUpdateOutcomeMessage(result),
    /already processed/,
  )
})

test('processed-game list helpers initially limit visible rows', () => {
  const processedGames = Array.from({ length: 10 }, (_item, index) => ({
    gameId: index + 1,
  }))

  assert.equal(
    updateUtils.getVisibleProcessedGames(processedGames).length,
    8,
  )
  assert.equal(
    updateUtils.hasHiddenProcessedGames(processedGames),
    true,
  )
  assert.equal(
    updateUtils.getVisibleProcessedGames(processedGames, {
      showAll: true,
    }).length,
    10,
  )
  assert.equal(
    updateUtils.hasHiddenProcessedGames(processedGames, {
      showAll: true,
    }),
    false,
  )
})
