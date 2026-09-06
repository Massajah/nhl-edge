process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createOddsCaptureBookmakerSelectionService,
} = require('../services/oddsCaptureBookmakerSelectionService')

const BOOKMAKERS = [
  { key: 'coolbet' },
  { key: 'pinnacle' },
  { key: 'unibet_fi' },
]

const createService = ({ preferences = [], users = [] } = {}) =>
  createOddsCaptureBookmakerSelectionService({
    getConfig: () => ({ bookmakers: BOOKMAKERS }),
    preferencesModel: { find: () => structuredClone(preferences) },
    userModel: { find: () => structuredClone(users) },
  })

test('global scheduled capture uses the union of user-enabled bookmakers', async () => {
  const service = createService({
    preferences: [
      { userId: 'a', disabledBookmakerKeys: ['coolbet'] },
      { userId: 'b', disabledBookmakerKeys: ['pinnacle'] },
    ],
    users: [{ _id: 'a' }, { _id: 'b' }],
  })

  assert.deepEqual(await service.getSelectedBookmakerKeys(), [
    'coolbet',
    'pinnacle',
    'unibet_fi',
  ])
})

test('a user on default settings keeps the full catalog tracked', async () => {
  const service = createService({
    preferences: [{ userId: 'a', disabledBookmakerKeys: ['coolbet'] }],
    users: [{ _id: 'a' }, { _id: 'default-user' }],
  })

  assert.deepEqual(await service.getSelectedBookmakerKeys(), BOOKMAKERS.map(({ key }) => key))
})

test('an empty installation safely tracks the supported catalog', async () => {
  assert.deepEqual(
    await createService().getSelectedBookmakerKeys(),
    BOOKMAKERS.map(({ key }) => key),
  )
})
