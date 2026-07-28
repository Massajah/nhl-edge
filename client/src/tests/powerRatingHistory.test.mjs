import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let apiClient
let historyUtils
let powerRatingsApi
let vite

const historyResponse = {
  filters: {
    from: '2026-01-01',
    resultType: 'OVERTIME',
    team: 'CAR',
    to: '2026-01-31',
  },
  items: [
    {
      awayRatingAfter: 52.21,
      awayRatingBefore: 53,
      awayRatingChange: -0.79,
      awayScore: 2,
      awayTeam: {
        abbreviation: 'NYR',
        id: 'NYR',
        name: 'New York Rangers',
      },
      baseHomeAdvantage: 4,
      effectiveHomeAdvantage: 4.5,
      engineSettingsSnapshot: {
        homeAdvantage: 4,
        kFactor: 1.2,
        modelVersion: 'power-rating-v1',
        overtimeMultiplier: 0.7,
        regulationMultiplier: 1,
        shootoutMultiplier: 0.5,
      },
      gameDate: '2026-01-10',
      gameId: 2025020123,
      homeRatingAfter: 45.79,
      homeRatingBefore: 45,
      homeRatingChange: 0.79,
      homeScore: 1,
      homeTeam: {
        abbreviation: 'BOS',
        id: 'BOS',
        name: 'Boston Bruins',
      },
      homeTeamAdjustment: 0.5,
      id: 'audit-1',
      processedAt: '2026-07-27T13:07:00.000Z',
      resultType: 'OVERTIME',
    },
  ],
  pagination: {
    hasNextPage: true,
    hasPreviousPage: false,
    limit: 25,
    page: 1,
    totalItems: 26,
    totalPages: 2,
  },
  summary: {
    dateRange: {
      from: '2026-01-01',
      to: '2026-01-31',
    },
    gamesProcessed: 26,
    mostRecentGame: {
      awayTeam: 'NYR',
      gameDate: '2026-01-10',
      gameId: 2025020123,
      homeTeam: 'BOS',
      processedAt: '2026-07-27T13:07:00.000Z',
    },
    teamsAffected: 12,
    totalRatingMovement: 41.234,
  },
}

const seasonResponse = {
  currentSeasonId: '20262027',
  metadataSource: 'fallback',
  seasons: [
    {
      endDate: '2027-04-30',
      id: '20262027',
      isCurrent: true,
      label: '2026\u201327',
      startDate: '2026-10-01',
    },
    {
      endDate: '2026-04-16',
      id: '20252026',
      isCurrent: false,
      label: '2025\u201326',
      startDate: '2025-10-07',
    },
  ],
  warning: 'Using fallback NHL regular-season boundaries.',
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
  historyUtils = await vite.ssrLoadModule('/src/utils/powerRatingHistory.js')
})

after(async () => {
  await vite?.close()
})

test('getPowerRatingHistory formats query parameters centrally', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('history-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(JSON.stringify(historyResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const result = await powerRatingsApi.getPowerRatingHistory({
      filters: {
        from: '2026-01-01',
        resultType: 'overtime',
        team: 'car',
        to: '2026-01-31',
      },
      limit: 50,
      page: 2,
    })

    assert.equal(result.items.length, 1)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequests.length, 1)
  assert.equal(capturedRequests[0].method, 'GET')
  assert.equal(
    capturedRequests[0].url,
    '/api/power-ratings/history?page=2&limit=50&from=2026-01-01&to=2026-01-31&team=CAR&resultType=OVERTIME',
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer history-token',
  )
})

test('getPowerRatingHistorySeasons uses centralized authenticated request', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('season-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(JSON.stringify(seasonResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const result = await powerRatingsApi.getPowerRatingHistorySeasons()

    assert.equal(result.currentSeasonId, '20262027')
    assert.equal(result.seasons[0].label, '2026\u201327')
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequests[0].url, '/api/power-ratings/history/seasons')
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer season-token',
  )
})

test('current season is the default history filter when metadata is available', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const defaultFilters =
    historyUtils.createDefaultPowerRatingHistoryFilters(
      historyUtils.getCurrentPowerRatingHistorySeasonId(metadata),
    )
  const dateFields = historyUtils.getPowerRatingHistoryDateFields(
    defaultFilters,
    metadata,
  )

  assert.equal(defaultFilters.season, '20262027')
  assert.equal(dateFields.from, '2026-10-01')
  assert.equal(dateFields.to, '2027-04-30')
  assert.equal(dateFields.disabled, true)
})

test('selecting a named season sets dates and disables date inputs', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const filters = historyUtils.applyPowerRatingHistorySeasonSelection(
    {
      resultType: 'OVERTIME',
      team: 'CAR',
    },
    '20252026',
    metadata,
  )
  const dateFields = historyUtils.getPowerRatingHistoryDateFields(
    filters,
    metadata,
  )

  assert.equal(filters.season, '20252026')
  assert.equal(filters.team, 'CAR')
  assert.equal(filters.resultType, 'OVERTIME')
  assert.equal(dateFields.from, '2025-10-07')
  assert.equal(dateFields.to, '2026-04-16')
  assert.equal(dateFields.disabled, true)
})

test('custom date range enables date inputs and all seasons clears dates', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const namedFilters = historyUtils.applyPowerRatingHistorySeasonSelection(
    {},
    '20252026',
    metadata,
  )
  const customFilters = historyUtils.applyPowerRatingHistorySeasonSelection(
    namedFilters,
    historyUtils.POWER_RATING_HISTORY_SEASON_CUSTOM,
    metadata,
  )
  const allFilters = historyUtils.applyPowerRatingHistorySeasonSelection(
    namedFilters,
    historyUtils.POWER_RATING_HISTORY_SEASON_ALL,
    metadata,
  )

  assert.equal(
    historyUtils.getPowerRatingHistoryDateFields(customFilters, metadata)
      .disabled,
    false,
  )
  assert.deepEqual(
    historyUtils.resolvePowerRatingHistoryFilters(allFilters, metadata),
    {
      from: '',
      resultType: '',
      team: '',
      to: '',
    },
  )
})

test('season-derived query strings preserve season dates during pagination', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const queryString = historyUtils.buildPowerRatingHistoryQueryString({
    filters: {
      resultType: 'REGULATION',
      season: '20252026',
      team: 'bos',
    },
    limit: 25,
    page: 3,
    seasonMetadata: metadata,
  })

  assert.equal(
    queryString,
    '?page=3&limit=25&from=2025-10-07&to=2026-04-16&team=BOS&resultType=REGULATION',
  )
})

test('season metadata failure still permits custom date range filtering', () => {
  const filters = {
    from: '2026-01-01',
    season: historyUtils.POWER_RATING_HISTORY_SEASON_CUSTOM,
    to: '2026-01-31',
  }
  const dateFields = historyUtils.getPowerRatingHistoryDateFields(filters, null)

  assert.equal(dateFields.disabled, false)
  assert.deepEqual(
    historyUtils.resolvePowerRatingHistoryFilters(filters, null),
    {
      from: '2026-01-01',
      resultType: '',
      team: '',
      to: '2026-01-31',
    },
  )
})

test('clear filters can reset back to the current season', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const clearedFilters =
    historyUtils.createDefaultPowerRatingHistoryFilters(
      historyUtils.getCurrentPowerRatingHistorySeasonId(metadata),
    )

  assert.deepEqual(clearedFilters, {
    from: '',
    resultType: '',
    season: '20262027',
    team: '',
    to: '',
  })
})

test('history formatting uses two decimals, signs, and safe fallbacks', () => {
  assert.equal(historyUtils.formatHistoryRatingValue(53.333), '53.33')
  assert.equal(historyUtils.formatHistoryRatingValue('bad'), '--')
  assert.equal(historyUtils.formatHistorySignedRatingChange(0.7), '+0.70')
  assert.equal(historyUtils.formatHistorySignedRatingChange(-0.7), '-0.70')
  assert.equal(historyUtils.formatHistorySignedRatingChange(null), '--')
})

test('history filter validation rejects invalid ranges and future dates', () => {
  const invalidRange = historyUtils.validatePowerRatingHistoryFilters(
    {
      from: '2026-01-31',
      to: '2026-01-01',
    },
    {
      today: '2026-07-28',
    },
  )
  const futureDate = historyUtils.validatePowerRatingHistoryFilters(
    {
      from: '2026-07-29',
    },
    {
      today: '2026-07-28',
    },
  )

  assert.equal(invalidRange.isValid, false)
  assert.match(invalidRange.fieldErrors.from, /on or before/)
  assert.equal(futureDate.isValid, false)
  assert.match(futureDate.fieldErrors.from, /future/)
})

test('history pagination helper clamps previous and next state', () => {
  assert.equal(
    historyUtils.getNextPowerRatingHistoryPage(
      {
        page: 1,
        totalPages: 4,
      },
      'previous',
    ),
    1,
  )
  assert.equal(
    historyUtils.getNextPowerRatingHistoryPage(
      {
        page: 2,
        totalPages: 4,
      },
      'next',
    ),
    3,
  )
  assert.equal(
    historyUtils.getNextPowerRatingHistoryPage(
      {
        page: 4,
        totalPages: 4,
      },
      'next',
    ),
    4,
  )
})

test('history empty states distinguish no history from no matching filters', () => {
  const metadata =
    historyUtils.normalizePowerRatingHistorySeasonsResponse(seasonResponse)
  const selectedSeason = historyUtils.getPowerRatingHistorySeasonById(
    metadata,
    '20262027',
  )

  assert.match(
    historyUtils.getPowerRatingHistoryEmptyState({
      filters: {
        season: '20262027',
      },
      selectedSeason,
      totalItems: 0,
    }).message,
    /2026\u201327 season/,
  )
  assert.match(
    historyUtils.getPowerRatingHistoryEmptyState({
      filters: {},
      totalItems: 0,
    }).message,
    /processed yet/,
  )
  assert.match(
    historyUtils.getPowerRatingHistoryEmptyState({
      filters: {
        team: 'CAR',
      },
      totalItems: 0,
    }).message,
    /match the selected filters/,
  )
  assert.equal(
    historyUtils.getPowerRatingHistoryEmptyState({
      filters: {},
      totalItems: 2,
    }),
    null,
  )
})

test('history audit rows show complete calculation details', () => {
  const normalizedHistory =
    historyUtils.normalizePowerRatingHistoryResponse(historyResponse)
  const rows = historyUtils.getPowerRatingHistoryAuditRows(
    normalizedHistory.items[0],
  )
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))

  assert.equal(rowsByKey.get('kFactor').value, '1.20')
  assert.equal(rowsByKey.get('baseHomeAdvantage').value, '4.00')
  assert.equal(rowsByKey.get('resultMultiplier').value, '0.70')
  assert.equal(rowsByKey.get('gameId').value, '2025020123')
  assert.equal(rowsByKey.get('awayRatingTransition').value, '53.00 -> 52.21')
})

test('history audit rows show unavailable state for legacy records', () => {
  const rows = historyUtils.getPowerRatingHistoryAuditRows({
    awayTeam: {
      abbreviation: 'NYR',
    },
    gameId: '2025020123',
    homeTeam: {
      abbreviation: 'BOS',
    },
    resultType: 'REGULATION',
  })
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))

  assert.equal(
    rowsByKey.get('kFactor').value,
    historyUtils.POWER_RATING_HISTORY_UNAVAILABLE,
  )
  assert.equal(
    rowsByKey.get('awayRatingTransition').value,
    historyUtils.POWER_RATING_HISTORY_UNAVAILABLE,
  )
  assert.equal(rowsByKey.get('gameId').value, '2025020123')
})

test('history response normalization prevents malformed numeric values rendering as NaN', () => {
  const normalized = historyUtils.normalizePowerRatingHistoryResponse({
    ...historyResponse,
    items: [
      {
        ...historyResponse.items[0],
        awayRatingBefore: 'not-a-number',
        awayRatingChange: Number.NaN,
        homeRatingAfter: undefined,
      },
    ],
  })
  const item = normalized.items[0]

  assert.equal(item.awayRatingBefore, null)
  assert.equal(item.awayRatingChange, null)
  assert.equal(item.homeRatingAfter, null)
  assert.equal(historyUtils.formatHistoryRatingValue(item.awayRatingBefore), '--')
  assert.equal(historyUtils.formatHistorySignedRatingChange(item.awayRatingChange), '--')
})
