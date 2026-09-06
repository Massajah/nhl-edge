process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const bookmakerPreferencesService = require('../services/bookmakerPreferencesService')
const {
  ALL_DISABLED_WARNING,
  getBookmakerPreferences,
  updateBookmakerPreferences,
} = require('../services/bookmakerPreferencesService')
const {
  collectAvailableBookmakers,
  filterMarketOddsForBookmakers,
} = require('../services/bookmakerOddsFilter')

const AVAILABLE_BOOKMAKERS = [
  { bookmakerKey: 'book-b', bookmakerTitle: 'Book B' },
  { bookmakerKey: 'book-a', bookmakerTitle: 'Book A' },
  { bookmakerKey: 'book-c', bookmakerTitle: 'Book C' },
]

const createPreferencesModel = () => {
  const documents = new Map()

  return {
    documents,
    async findOne({ userId }) {
      return documents.get(String(userId)) ?? null
    },
    async findOneAndUpdate({ userId }, update) {
      const document = {
        disabledBookmakerKeys: [...update.$set.disabledBookmakerKeys],
        userId,
      }
      documents.set(String(userId), document)
      return document
    },
  }
}

const createOptions = (preferencesModel, supportedBookmakers = AVAILABLE_BOOKMAKERS) => ({
  preferencesModel,
  supportedBookmakers,
})

test('all available bookmakers are enabled by default', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  assert.deepEqual(preferences.enabledBookmakerKeys, [
    'book-b',
    'book-a',
    'book-c',
  ])
  assert.deepEqual(preferences.disabledBookmakerKeys, [])
  assert.equal(preferences.usingDefaults, true)
  assert.equal(preferences.captureParticipation, 'unconfigured')
  assert.equal(preferences.participatesInCapture, false)
})

test('bookmaker preferences persist independently for each user', async () => {
  const preferencesModel = createPreferencesModel()

  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )
  await updateBookmakerPreferences(
    'user-b',
    { enabledBookmakerKeys: ['book-b'] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  const userA = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )
  const userB = await getBookmakerPreferences(
    'user-b',
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  assert.deepEqual(userA.preferences.enabledBookmakerKeys, [
    'book-a',
    'book-c',
  ])
  assert.deepEqual(userA.preferences.disabledBookmakerKeys, ['book-b'])
  assert.deepEqual(userB.preferences.enabledBookmakerKeys, ['book-b'])
  assert.deepEqual(userB.preferences.disabledBookmakerKeys, [
    'book-a',
    'book-c',
  ])
})

test('temporarily unavailable bookmakers retain the user preference', async () => {
  const preferencesModel = createPreferencesModel()

  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )
  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS.filter(
      ({ bookmakerKey }) => bookmakerKey !== 'book-c',
    ),
    createOptions(preferencesModel),
  )

  const restoredDirectory = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  assert.deepEqual(restoredDirectory.preferences.enabledBookmakerKeys, [
    'book-a',
    'book-c',
  ])
  assert.deepEqual(restoredDirectory.preferences.disabledBookmakerKeys, [
    'book-b',
  ])
})

test('disabling every bookmaker persists an explicit empty selection', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: [] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  assert.equal(preferences.fallbackApplied, false)
  assert.equal(preferences.captureParticipation, 'disabled')
  assert.equal(preferences.participatesInCapture, false)
  assert.equal(preferences.warning, ALL_DISABLED_WARNING)
  assert.deepEqual(preferences.disabledBookmakerKeys, [
    'book-a',
    'book-b',
    'book-c',
  ])
  assert.deepEqual(preferences.enabledBookmakerKeys, [])
  assert.deepEqual(
    preferencesModel.documents.get('user-a').disabledBookmakerKeys,
    ['book-b', 'book-a', 'book-c'],
  )
})

test('requested catalog and latest availability remain distinct', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await getBookmakerPreferences(
    'user-a',
    [AVAILABLE_BOOKMAKERS[0]],
    createOptions(preferencesModel),
  )

  assert.equal(preferences.supportedBookmakers.length, 3)
  assert.deepEqual(
    preferences.supportedBookmakers.map(({ bookmakerKey, available }) => ({
      available,
      bookmakerKey,
    })),
    [
      { available: true, bookmakerKey: 'book-b' },
      { available: false, bookmakerKey: 'book-a' },
      { available: false, bookmakerKey: 'book-c' },
    ],
  )
  assert.deepEqual(preferences.enabledBookmakerKeys, [
    'book-b',
    'book-a',
    'book-c',
  ])
})

test('existing disabled keys remain disabled while a newly supported bookmaker defaults enabled', async () => {
  const preferencesModel = createPreferencesModel()

  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )
  const expandedCatalog = [
    ...AVAILABLE_BOOKMAKERS,
    { bookmakerKey: 'book-d', bookmakerTitle: 'Book D' },
  ]
  const { preferences } = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel, expandedCatalog),
  )

  assert.deepEqual(preferences.disabledBookmakerKeys, ['book-b'])
  assert.equal(preferences.enabledBookmakerKeys.includes('book-d'), true)
})

test('unsupported bookmaker keys are sanitized against the server catalog', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'unsupported-client-key'] },
    AVAILABLE_BOOKMAKERS,
    createOptions(preferencesModel),
  )

  assert.deepEqual(preferences.enabledBookmakerKeys, ['book-a'])
  assert.equal(JSON.stringify(preferences).includes('unsupported-client-key'), false)
})

test('preference operations require an authenticated user identity', async () => {
  const preferencesModel = createPreferencesModel()

  await assert.rejects(
    () => getBookmakerPreferences('', AVAILABLE_BOOKMAKERS, createOptions(preferencesModel)),
    (error) => error.statusCode === 401,
  )
  await assert.rejects(
    () =>
      updateBookmakerPreferences(
        null,
        { enabledBookmakerKeys: ['book-a'] },
        AVAILABLE_BOOKMAKERS,
        createOptions(preferencesModel),
      ),
    (error) => error.statusCode === 401,
  )
})

test('authenticated preference endpoints read and save only for the session user', async (t) => {
  const server = app.listen(0)
  const calls = []
  const originalGet = bookmakerPreferencesService.getBookmakerPreferences
  const originalUpdate = bookmakerPreferencesService.updateBookmakerPreferences

  t.after(() => {
    bookmakerPreferencesService.getBookmakerPreferences = originalGet
    bookmakerPreferencesService.updateBookmakerPreferences = originalUpdate
    server.close()
  })
  bookmakerPreferencesService.getBookmakerPreferences = async (userId) => {
    calls.push({ operation: 'read', userId })
    return { preferences: { enabledBookmakerKeys: ['veikkaus_fi'] } }
  }
  bookmakerPreferencesService.updateBookmakerPreferences = async (
    userId,
    payload,
  ) => {
    calls.push({ operation: 'save', payload, userId })
    return {
      preferences: { enabledBookmakerKeys: payload.enabledBookmakerKeys },
      success: true,
    }
  }

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  const token = authSessionService.createTestAuthSession('session-user')
  const headers = {
    Cookie: `nhl_edge_session=${token}`,
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
  }
  const read = await fetch(
    `http://127.0.0.1:${port}/api/settings/bookmakers?userId=other-user`,
    { headers },
  )
  const save = await fetch(
    `http://127.0.0.1:${port}/api/settings/bookmakers?userId=other-user`,
    {
      body: JSON.stringify({ enabledBookmakerKeys: ['coolbet'] }),
      headers,
      method: 'PUT',
    },
  )

  assert.equal(read.status, 200)
  assert.equal(save.status, 200)
  assert.deepEqual(calls, [
    { operation: 'read', userId: 'session-user' },
    {
      operation: 'save',
      payload: { enabledBookmakerKeys: ['coolbet'] },
      userId: 'session-user',
    },
  ])
})

test('preference endpoints reject unauthenticated reads and writes', async (t) => {
  const server = app.listen(0)
  t.after(() => server.close())
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  const read = await fetch(
    `http://127.0.0.1:${port}/api/settings/bookmakers`,
  )
  const save = await fetch(
    `http://127.0.0.1:${port}/api/settings/bookmakers`,
    {
      body: JSON.stringify({ enabledBookmakerKeys: ['coolbet'] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    },
  )

  assert.equal(read.status, 401)
  assert.equal(save.status, 401)
})

const createPublicOddsResponse = () => ({
  games: [
    {
      gameId: 'game-1',
      marketOdds: {
        awayBest: null,
        bookmakers: [
          {
            awayOdds: 2.2,
            bookmakerKey: 'book-a',
            bookmakerTitle: 'Book A',
            homeOdds: 1.8,
            lastUpdate: '2026-08-03T12:00:00.000Z',
          },
          {
            awayOdds: 2.4,
            bookmakerKey: 'book-b',
            bookmakerTitle: 'Book B',
            homeOdds: 1.75,
            lastUpdate: '2026-08-03T12:01:00.000Z',
          },
          {
            awayOdds: 2.1,
            bookmakerKey: 'book-c',
            bookmakerTitle: 'Book C',
            homeOdds: 1.9,
            lastUpdate: '2026-08-03T12:02:00.000Z',
          },
        ],
        homeBest: null,
      },
      oddsStatus: 'ready',
    },
  ],
  status: 'cached',
})

test('best available odds are recomputed only from enabled bookmakers', () => {
  const filtered = filterMarketOddsForBookmakers(createPublicOddsResponse(), [
    'book-a',
    'book-c',
  ])
  const marketOdds = filtered.games[0].marketOdds

  assert.equal(marketOdds.awayBest.bookmakerKey, 'book-a')
  assert.equal(marketOdds.awayBest.odds, 2.2)
  assert.equal(marketOdds.homeBest.bookmakerKey, 'book-c')
  assert.equal(marketOdds.homeBest.odds, 1.9)
  assert.deepEqual(
    marketOdds.bookmakers.map(({ bookmakerKey }) => bookmakerKey),
    ['book-a', 'book-c'],
  )
  assert.equal(marketOdds.allBookmakers.length, 3)
  assert.equal(
    marketOdds.allBookmakers.find(
      ({ bookmakerKey }) => bookmakerKey === 'book-b',
    ).enabled,
    false,
  )
})

test('best-odds filtering excludes unavailable, incomplete, and malformed rows', () => {
  const response = createPublicOddsResponse()
  response.games[0].marketOdds.bookmakers = [
    {
      awayOdds: 2.05,
      bookmakerKey: 'only-valid',
      bookmakerTitle: 'Only Valid',
      homeOdds: 1.85,
    },
    {
      awayOdds: 'NaN',
      bookmakerKey: 'incomplete',
      bookmakerTitle: 'Incomplete',
      homeOdds: 9.99,
    },
  ]

  const filtered = filterMarketOddsForBookmakers(response, [
    'only-valid',
    'incomplete',
    'unavailable-bookmaker',
  ])

  assert.equal(filtered.games[0].marketOdds.bookmakers.length, 1)
  assert.equal(filtered.games[0].marketOdds.awayBest.odds, 2.05)
  assert.equal(filtered.games[0].marketOdds.homeBest.odds, 1.85)
  assert.equal(typeof filtered.games[0].marketOdds.homeBest.odds, 'number')

  const noValid = filterMarketOddsForBookmakers(response, [
    'incomplete',
    'unavailable-bookmaker',
  ])

  assert.equal(noValid.games[0].marketOdds.awayBest, null)
  assert.equal(noValid.games[0].marketOdds.homeBest, null)
  assert.equal(noValid.games[0].oddsStatus, 'missing')
})

test('available bookmaker directory is deduplicated and ordered by name', () => {
  const available = collectAvailableBookmakers([
    {
      bookmakers: [
        { bookmakerKey: 'z', bookmakerTitle: 'Zulu' },
        { bookmakerKey: 'a', bookmakerTitle: 'Alpha' },
      ],
    },
    {
      bookmakers: [
        { bookmakerKey: 'z', bookmakerTitle: 'Zulu' },
        { bookmakerKey: 'm', bookmakerTitle: 'Mike' },
      ],
    },
  ])

  assert.deepEqual(
    available.map(({ bookmakerKey }) => bookmakerKey),
    ['a', 'm', 'z'],
  )
})
