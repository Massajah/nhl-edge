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

test('a user without explicit preferences does not expand capture', async () => {
  const service = createService({
    preferences: [{ userId: 'a', disabledBookmakerKeys: ['coolbet'] }],
    users: [{ _id: 'a' }, { _id: 'default-user' }],
  })

  assert.deepEqual(await service.getSelectedBookmakerKeys(), [
    'pinnacle',
    'unibet_fi',
  ])
})

test('two users selecting the same bookmaker contribute one global key', async () => {
  const disabledBookmakerKeys = ['coolbet', 'unibet_fi']
  const service = createService({
    preferences: [
      { userId: 'a', disabledBookmakerKeys },
      { userId: 'b', disabledBookmakerKeys },
    ],
    users: [{ _id: 'a' }, { _id: 'b' }],
  })

  assert.deepEqual(await service.getSelectedBookmakerKeys(), ['pinnacle'])
})

test('an empty installation makes no provider selection', async () => {
  assert.deepEqual(await createService().getSelectedBookmakerKeys(), [])
})

test('all-disabled and disabled-user preferences do not expand capture', async () => {
  const service = createService({
    preferences: [
      { userId: 'a', disabledBookmakerKeys: BOOKMAKERS.map(({ key }) => key) },
      { userId: 'b', disabledBookmakerKeys: [] },
    ],
    users: [
      { _id: 'a', status: 'active' },
      { _id: 'b', status: 'disabled' },
    ],
  })

  assert.deepEqual(await service.getSelectedBookmakerKeys(), [])
})
