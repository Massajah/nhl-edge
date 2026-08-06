process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const TeamLineup = require('../models/TeamLineup')
const {
  clearTeamLineup,
  getTeamLineup,
  saveTeamLineup,
} = require('../services/teamLineupsService')

const providerRosters = {
  BOS: {
    defensemen: [
      { fullName: 'Boston Defense One', id: 8481001, position: 'D' },
      { fullName: 'Boston Defense Two', id: 8481002, position: 'D' },
    ],
    forwards: [
      { fullName: 'Boston Forward One', id: 8471001, position: 'C' },
      { fullName: 'Boston Forward Two', id: 8471002, position: 'L' },
      { fullName: 'Boston Forward Three', id: 8471003, position: 'R' },
    ],
  },
  LAK: {
    defensemen: [
      { fullName: 'Los Angeles Defense', id: 8482001, position: 'D' },
    ],
    forwards: [
      { fullName: 'Los Angeles Forward', id: 8472001, position: 'C' },
    ],
  },
}

const createLineupStore = () => {
  const documents = new Map()
  let clock = 0
  const keyOf = ({ teamId, userId }) => `${userId}:${teamId}`

  return {
    documents,
    model: {
      deleteOne: async (filter) => {
        const deleted = documents.delete(keyOf(filter))
        return { deletedCount: deleted ? 1 : 0 }
      },
      findOne: async (filter) => documents.get(keyOf(filter)) ?? null,
      findOneAndUpdate: async (filter, update) => {
        const key = keyOf(filter)
        const existing = documents.get(key)
        const timestamp = new Date(
          Date.UTC(2026, 7, 5, 10, clock++),
        ).toISOString()
        const document = {
          ...(existing ?? update.$setOnInsert ?? {}),
          ...structuredClone(update.$set),
          createdAt: existing?.createdAt ?? timestamp,
          teamId: filter.teamId,
          updatedAt: timestamp,
          userId: filter.userId,
        }

        documents.set(key, document)
        return document
      },
    },
  }
}

const createOptions = (store, rosters = providerRosters) => ({
  getRosterForTeam: async (teamId) =>
    structuredClone(
      rosters[teamId] ?? { defensemen: [], forwards: [] },
    ),
  teamLineupModel: store.model,
})

const requestStatus = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    return response.status
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('team model-values APIs require authentication', async () => {
  assert.equal(await requestStatus('/api/teams/BOS/model-values'), 401)
  assert.equal(
    await requestStatus('/api/teams/BOS/model-values/lines', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    }),
    401,
  )
  assert.equal(
    await requestStatus('/api/teams/BOS/model-values/lines', {
      method: 'DELETE',
    }),
    401,
  )
})

test('empty and incomplete lineups save with fixed optional row shapes', async () => {
  const store = createLineupStore()
  const options = createOptions(store)
  const empty = await saveTeamLineup('user-a', 'BOS', {}, options)

  assert.equal(empty.modelValues.forwardLines.length, 4)
  assert.equal(empty.modelValues.defensePairs.length, 3)
  assert.equal(empty.modelValues.forwardLines[0].leftWingPlayerId, null)
  assert.equal(empty.modelValues.lineupNote, '')

  const incomplete = await saveTeamLineup(
    'user-a',
    'Boston Bruins',
    {
      forwardLines: [
        { lineNumber: 1, leftWingPlayerId: 8471001 },
      ],
    },
    options,
  )

  assert.equal(incomplete.modelValues.teamId, 'BOS')
  assert.equal(
    incomplete.modelValues.forwardLines[0].leftWingPlayerId,
    8471001,
  )
  assert.equal(incomplete.modelValues.forwardLines[0].centerPlayerId, null)
  assert.equal(store.documents.size, 1)
})

test('complete lines, defense pairs, and note update one user-team document', async () => {
  const store = createLineupStore()
  const options = createOptions(store)
  const forwardLines = Array.from({ length: 4 }, (_item, index) => ({
    centerPlayerId: 8471001,
    leftWingPlayerId: 8471002,
    lineNumber: index + 1,
    rightWingPlayerId: 8471003,
  }))
  const defensePairs = Array.from({ length: 3 }, (_item, index) => ({
    leftDefensePlayerId: 8481001,
    pairNumber: index + 1,
    rightDefensePlayerId: 8481002,
  }))
  const created = await saveTeamLineup(
    'user-a',
    'BOS',
    { defensePairs, forwardLines, lineupNote: 'Personal estimate' },
    options,
  )
  const updated = await saveTeamLineup(
    'user-a',
    'BOS',
    {
      defensePairs,
      forwardLines,
      lineupNote: 'Updated personal estimate',
    },
    options,
  )

  assert.equal(created.modelValues.forwardLines[3].rightWingPlayerId, 8471003)
  assert.equal(created.modelValues.defensePairs[2].rightDefensePlayerId, 8481002)
  assert.equal(updated.modelValues.lineupNote, 'Updated personal estimate')
  assert.equal(store.documents.size, 1)
  assert.equal(updated.modelValues.createdAt, created.modelValues.createdAt)
})

test('lineups stay isolated by user and canonical team identity for BOS and LAK', async () => {
  const store = createLineupStore()
  const options = createOptions(store)

  await saveTeamLineup(
    'user-a',
    'BOS',
    { lineupNote: 'Boston user A' },
    options,
  )
  await saveTeamLineup(
    'user-b',
    'Boston Bruins',
    { lineupNote: 'Boston user B' },
    options,
  )
  await saveTeamLineup(
    'user-a',
    'Los Angeles Kings',
    {
      forwardLines: [
        { centerPlayerId: 8472001, lineNumber: 1 },
      ],
      lineupNote: 'Los Angeles user A',
    },
    options,
  )

  const bosA = await getTeamLineup('user-a', 'Boston Bruins', options)
  const bosB = await getTeamLineup('user-b', 'BOS', options)
  const lakA = await getTeamLineup('user-a', 'LAK', options)

  assert.equal(bosA.teamId, 'BOS')
  assert.equal(bosA.modelValues.lineupNote, 'Boston user A')
  assert.equal(bosB.modelValues.lineupNote, 'Boston user B')
  assert.equal(lakA.teamId, 'LAK')
  assert.equal(lakA.modelValues.forwardLines[0].centerPlayerId, 8472001)
  assert.equal(store.documents.size, 3)
})

test('validation rejects invalid teams, malformed IDs, wrong roster groups, and long notes', async () => {
  const store = createLineupStore()
  const options = createOptions(store)

  await assert.rejects(
    saveTeamLineup('user-a', 'INVALID', {}, options),
    (error) => error.statusCode === 400 && /known NHL team/.test(error.message),
  )
  await assert.rejects(
    saveTeamLineup(
      'user-a',
      'BOS',
      {
        forwardLines: [
          { leftWingPlayerId: 'not-an-id', lineNumber: 1 },
        ],
      },
      options,
    ),
    (error) => error.statusCode === 400 && /positive integer/.test(error.message),
  )
  await assert.rejects(
    saveTeamLineup(
      'user-a',
      'BOS',
      {
        forwardLines: [
          { leftWingPlayerId: 8481001, lineNumber: 1 },
        ],
      },
      options,
    ),
    (error) => error.statusCode === 400 && /defense-only/.test(error.message),
  )
  await assert.rejects(
    saveTeamLineup(
      'user-a',
      'BOS',
      {
        defensePairs: [
          { leftDefensePlayerId: 8471001, pairNumber: 1 },
        ],
      },
      options,
    ),
    (error) => error.statusCode === 400 && /forward-only/.test(error.message),
  )
  await assert.rejects(
    saveTeamLineup(
      'user-a',
      'BOS',
      { lineupNote: 'x'.repeat(1501) },
      options,
    ),
    (error) => error.statusCode === 400 && /1500/.test(error.message),
  )
  await assert.rejects(
    saveTeamLineup('user-a', 'BOS', { userId: 'user-b' }, options),
    (error) => error.statusCode === 400 && /unsupported fields/.test(error.message),
  )
})

test('saved player IDs survive provider roster changes and remain editable', async () => {
  const store = createLineupStore()
  const mutableRosters = structuredClone(providerRosters)
  const options = createOptions(store, mutableRosters)

  await saveTeamLineup(
    'user-a',
    'BOS',
    {
      forwardLines: [
        { centerPlayerId: 8471001, lineNumber: 1 },
      ],
    },
    options,
  )
  mutableRosters.BOS.forwards = []

  const read = await getTeamLineup('user-a', 'BOS', options)
  const resaved = await saveTeamLineup(
    'user-a',
    'BOS',
    {
      defensePairs: read.modelValues.defensePairs,
      forwardLines: read.modelValues.forwardLines,
      lineupNote: read.modelValues.lineupNote,
    },
    options,
  )

  assert.equal(read.modelValues.forwardLines[0].centerPlayerId, 8471001)
  assert.equal(resaved.modelValues.forwardLines[0].centerPlayerId, 8471001)
})

test('clear removes positions and note without touching another team', async () => {
  const store = createLineupStore()
  const options = createOptions(store)

  await saveTeamLineup(
    'user-a',
    'BOS',
    { lineupNote: 'Clear me' },
    options,
  )
  await saveTeamLineup(
    'user-a',
    'LAK',
    { lineupNote: 'Keep me' },
    options,
  )
  const cleared = await clearTeamLineup('user-a', 'BOS', options)
  const bos = await getTeamLineup('user-a', 'BOS', options)
  const lak = await getTeamLineup('user-a', 'LAK', options)

  assert.equal(cleared.cleared, true)
  assert.equal(bos.modelValues.lineupNote, '')
  assert.equal(bos.modelValues.updatedAt, null)
  assert.equal(lak.modelValues.lineupNote, 'Keep me')
})

test('TeamLineup schema enforces one document per user and team', () => {
  const uniqueIndex = TeamLineup.schema.indexes().find(
    ([fields, options]) =>
      fields.userId === 1 && fields.teamId === 1 && options.unique,
  )

  assert.ok(uniqueIndex)
})
