import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let apiClient
let bankrollApi
let bankrollUtils
let vite

const seasonResponse = {
  currentSeasonId: '20252026',
  metadataSource: 'fallback',
  seasons: [
    {
      endDate: '2026-04-16',
      id: '20252026',
      isCurrent: true,
      label: '2025-26',
      startDate: '2025-10-07',
    },
  ],
  warning: 'Using fallback dates.',
}

const summaryResponse = {
  summary: {
    availableBankrollCents: 9850,
    bettingProfitCents: -150,
    cashFlowCents: 2500,
    currency: 'EUR',
    currentBankrollCents: 10000,
    depositsCents: 3000,
    initialized: true,
    initializedAt: '2026-01-01T00:00:00.000Z',
    initializedDate: '2026-01-01',
    pendingStakeCents: 150,
    period: {
      key: 'all-time',
    },
    settledBets: 2,
    startingBalanceCents: 7500,
    withdrawalsCents: 500,
  },
}

const transactionsResponse = {
  filters: {
    type: 'DEPOSIT',
  },
  items: [
    {
      amountCents: 2500,
      description: 'Reload',
      id: 'txn-1',
      occurredAt: '2026-01-02T00:00:00.000Z',
      occurredDate: '2026-01-02',
      runningBalanceCents: 10000,
      type: 'DEPOSIT',
    },
  ],
  pagination: {
    hasNextPage: false,
    hasPreviousPage: false,
    limit: 10,
    page: 1,
    totalItems: 1,
    totalPages: 1,
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
  bankrollApi = await vite.ssrLoadModule('/src/services/bankrollApi.js')
  bankrollUtils = await vite.ssrLoadModule('/src/utils/bankroll.js')
})

after(async () => {
  await vite?.close()
})

test('bankroll summary normalization uses cents and avoids NaN values', () => {
  const summary = bankrollUtils.normalizeBankrollSummary(summaryResponse.summary)

  assert.equal(summary.currentBankroll, 100)
  assert.equal(summary.availableBankroll, 98.5)
  assert.equal(summary.bettingProfit, -1.5)
  assert.equal(summary.cashFlow, 25)
  assert.equal(summary.currency, 'EUR')
  assert.equal(String(summary.pendingStake).includes('NaN'), false)
})

test('bankroll initialization validation and request formatting are centralized', () => {
  const invalid = bankrollUtils.validateBankrollInitialization(
    {
      currency: 'EUR',
      startDate: '2026-01-01',
      startingBalance: '10.999',
    },
    {
      today: '2026-01-02',
    },
  )

  assert.equal(invalid.isValid, false)
  assert.equal(
    invalid.fieldErrors.startingBalance,
    'Starting Balance must be 0 or a positive amount with up to two decimals.',
  )

  assert.deepEqual(
    bankrollUtils.buildBankrollInitializationRequest({
      currency: 'eur',
      startDate: '2026-01-01',
      startingBalance: '10.90',
    }),
    {
      currency: 'EUR',
      startDate: '2026-01-01',
      startingBalance: 10.9,
    },
  )
})

test('bankroll period selection follows available season metadata', () => {
  const metadata =
    bankrollUtils.normalizeBankrollSeasonsResponse(seasonResponse)
  const filters = bankrollUtils.applyBankrollPeriodSelection(
    bankrollUtils.createDefaultBankrollFilters(),
    '20252026',
    metadata,
  )
  const dateFields = bankrollUtils.getBankrollDateFields(filters, metadata)

  assert.equal(filters.period, 'season')
  assert.equal(filters.season, '20252026')
  assert.equal(dateFields.disabled, true)
  assert.equal(dateFields.from, '2025-10-07')
  assert.equal(dateFields.to, '2026-04-16')
})

test('custom bankroll date validation rejects inverted ranges', () => {
  const validation = bankrollUtils.validateBankrollFilters(
    {
      from: '2026-02-01',
      period: 'custom',
      season: 'custom',
      to: '2026-01-01',
      type: '',
    },
    {
      today: '2026-02-02',
    },
  )

  assert.equal(validation.isValid, false)
  assert.equal(
    validation.fieldErrors.from,
    'Date From must be on or before Date To.',
  )
})

test('cash transaction validation catches excessive withdrawals', () => {
  const validation = bankrollUtils.validateBankrollCashTransaction(
    {
      amount: '50.01',
      occurredAt: '2026-01-02',
    },
    {
      currentBankroll: 50,
      today: '2026-01-03',
      type: 'WITHDRAWAL',
    },
  )

  assert.equal(validation.isValid, false)
  assert.equal(validation.fieldErrors.amount, 'Withdrawal exceeds current bankroll.')
})

test('transaction labels and tones are stable for the ledger', () => {
  assert.equal(
    bankrollUtils.getBankrollTransactionLabel('BET_SETTLEMENT'),
    'Bet settlement',
  )
  assert.equal(
    bankrollUtils.getBankrollTransactionTone({
      amount: -1,
    }),
    'negative',
  )
  assert.equal(
    bankrollUtils.getBankrollTransactionTone({
      amount: 0,
    }),
    'neutral',
  )
})

test('bankroll summary API builds authenticated season query', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []
  const metadata =
    bankrollUtils.normalizeBankrollSeasonsResponse(seasonResponse)

  apiClient.setAuthToken('bankroll-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(JSON.stringify(summaryResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const summary = await bankrollApi.getBankrollSummary({
      filters: {
        period: 'season',
        season: '20252026',
      },
      seasonMetadata: metadata,
    })

    assert.equal(summary.currentBankroll, 100)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(
    capturedRequests[0].url,
    '/api/bankroll/summary?period=season&season=20252026',
  )
  assert.equal(
    capturedRequests[0].headers.get('Authorization'),
    'Bearer bankroll-token',
  )
})

test('deposit API sends normalized money request body', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []

  apiClient.setAuthToken('bankroll-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      body: JSON.parse(options.body),
      headers: options.headers,
      method: options.method,
      url,
    })

    return new Response(JSON.stringify(summaryResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 201,
    })
  }

  try {
    const result = await bankrollApi.addBankrollDeposit({
      amount: '12.30',
      description: 'Reload',
      occurredAt: '2026-01-02',
    })

    assert.equal(result.summary.currentBankroll, 100)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedRequests[0].url, '/api/bankroll/deposits')
  assert.equal(capturedRequests[0].method, 'POST')
  assert.deepEqual(capturedRequests[0].body, {
    amount: 12.3,
    description: 'Reload',
    occurredAt: '2026-01-02',
  })
})

test('transactions API includes pagination, period, and type filters', async () => {
  const originalFetch = globalThis.fetch
  const capturedRequests = []
  const metadata =
    bankrollUtils.normalizeBankrollSeasonsResponse(seasonResponse)

  apiClient.setAuthToken('bankroll-token')
  globalThis.fetch = async (url, options = {}) => {
    capturedRequests.push({
      headers: options.headers,
      method: options.method ?? 'GET',
      url,
    })

    return new Response(JSON.stringify(transactionsResponse), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }

  try {
    const result = await bankrollApi.getBankrollTransactions({
      filters: {
        period: 'season',
        season: '20252026',
        type: 'DEPOSIT',
      },
      limit: 10,
      page: 2,
      seasonMetadata: metadata,
    })

    assert.equal(result.items[0].runningBalance, 100)
  } finally {
    apiClient.clearAuthToken()
    globalThis.fetch = originalFetch
  }

  assert.equal(
    capturedRequests[0].url,
    '/api/bankroll/transactions?page=2&limit=10&season=20252026&type=DEPOSIT',
  )
})
