process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
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

test('all available bookmakers are enabled by default', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )

  assert.deepEqual(preferences.enabledBookmakerKeys, [
    'book-a',
    'book-b',
    'book-c',
  ])
  assert.deepEqual(preferences.disabledBookmakerKeys, [])
  assert.equal(preferences.usingDefaults, true)
})

test('bookmaker preferences persist independently for each user', async () => {
  const preferencesModel = createPreferencesModel()

  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )
  await updateBookmakerPreferences(
    'user-b',
    { enabledBookmakerKeys: ['book-b'] },
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )

  const userA = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )
  const userB = await getBookmakerPreferences(
    'user-b',
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
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
    { preferencesModel },
  )
  await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: ['book-a', 'book-c'] },
    AVAILABLE_BOOKMAKERS.filter(
      ({ bookmakerKey }) => bookmakerKey !== 'book-b',
    ),
    { preferencesModel },
  )

  const restoredDirectory = await getBookmakerPreferences(
    'user-a',
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )

  assert.deepEqual(restoredDirectory.preferences.enabledBookmakerKeys, [
    'book-a',
    'book-c',
  ])
  assert.deepEqual(restoredDirectory.preferences.disabledBookmakerKeys, [
    'book-b',
  ])
})

test('disabling every bookmaker falls back to all and returns a warning', async () => {
  const preferencesModel = createPreferencesModel()
  const { preferences } = await updateBookmakerPreferences(
    'user-a',
    { enabledBookmakerKeys: [] },
    AVAILABLE_BOOKMAKERS,
    { preferencesModel },
  )

  assert.equal(preferences.fallbackApplied, true)
  assert.equal(preferences.warning, ALL_DISABLED_WARNING)
  assert.deepEqual(preferences.disabledBookmakerKeys, [])
  assert.deepEqual(preferences.enabledBookmakerKeys, [
    'book-a',
    'book-b',
    'book-c',
  ])
  assert.deepEqual(
    preferencesModel.documents.get('user-a').disabledBookmakerKeys,
    [],
  )
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
