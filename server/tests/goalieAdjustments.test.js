process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const GoalieAdjustment = require('../models/GoalieAdjustment')
const {
  normalizeGoalieSelectionSnapshot,
} = require('../services/betsService')
const {
  createUnknownGoalieSelection,
  normalizeGameGoalieSelection,
  normalizePersistedGoalieSelection,
} = require('../services/gameGoalieSelectionService')
const {
  updateGameGoalieSelections,
} = require('../services/gameContextService')
const {
  calculateGameContextForGame,
} = require('../services/gameContextRules')
const {
  deleteGoalieAdjustment,
  getProviderGoalieAdjustments,
  normalizeAdjustment,
  saveGoalieAdjustment,
} = require('../services/goalieAdjustmentsService')
const {
  buildTeamInjurySummaryPipeline,
  normalizeCreatePayload: normalizeInjuryCreatePayload,
} = require('../services/injuriesService')

const providerRosters = {
  BOS: {
    goalies: [
      { fullName: 'Boston Goalie', id: 8470002, position: 'G' },
    ],
  },
  LAK: {
    goalies: [
      { fullName: 'Darcy Kuemper', id: 8475311, position: 'G' },
      { fullName: 'David Rittich', id: 8475831, position: 'G' },
    ],
  },
  TOR: {
    goalies: [
      { fullName: 'Toronto Goalie', id: 8470003, position: 'G' },
    ],
  },
}

const getRosterForTeam = async (abbreviation) =>
  structuredClone(providerRosters[abbreviation] ?? { goalies: [] })

const createAdjustmentStore = () => {
  const documents = new Map()
  const keyOf = (value) =>
    `${value.userId}:${value.teamId}:${Number(value.nhlPlayerId)}`

  return {
    documents,
    model: {
      find: async (filter) =>
        [...documents.values()].filter(
          (document) =>
            String(document.userId) === String(filter.userId) &&
            document.teamId === filter.teamId,
        ),
      findOneAndDelete: async (filter) => {
        const key = keyOf(filter)
        const document = documents.get(key) ?? null
        documents.delete(key)
        return document
      },
      findOneAndUpdate: async (filter, update) => {
        const key = keyOf(filter)
        const document = {
          ...(documents.get(key) ?? update.$setOnInsert ?? {}),
          ...update.$set,
          nhlPlayerId: Number(filter.nhlPlayerId),
          teamId: filter.teamId,
          updatedAt: '2026-08-04T12:00:00.000Z',
          userId: filter.userId,
        }

        documents.set(key, document)
        return document
      },
    },
  }
}

const createLegacyStore = (initialDocuments = []) => {
  const documents = new Map()

  initialDocuments.forEach((document) => {
    const key = `${document.userId}:${document.teamId}`
    const stored = {
      ...document,
      goalies: document.goalies.map((goalie) => ({ ...goalie })),
    }
    stored.save = async () => stored
    documents.set(key, stored)
  })

  return {
    documents,
    model: {
      findOne: async (filter) =>
        documents.get(`${filter.userId}:${filter.teamId}`) ?? null,
    },
  }
}

const createOptions = ({ adjustments, legacy }) => ({
  getRosterForTeam,
  goalieAdjustmentModel: adjustments.model,
  legacyTeamGoaliesModel: legacy.model,
})

const request = async (path, options = {}) => {
  const server = app.listen(0)
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options)
    return response.status
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const createGameContextStore = (initialContexts = []) => {
  const contexts = new Map(
    initialContexts.map((context) => [
      `${context.userId}:${context.gameId}`,
      { ...context },
    ]),
  )
  const setPath = (target, path, value) => {
    const parts = path.split('.')
    let current = target

    parts.slice(0, -1).forEach((part) => {
      current[part] = current[part] ?? {}
      current = current[part]
    })
    current[parts.at(-1)] = value
  }

  return {
    contexts,
    model: {
      findOne: async (filter) =>
        contexts.get(`${filter.userId}:${filter.gameId}`) ?? null,
      findOneAndUpdate: async (filter, update) => {
        const key = `${filter.userId}:${filter.gameId}`
        const document = contexts.get(key) ?? {
          gameId: filter.gameId,
          userId: filter.userId,
          ...(update.$setOnInsert ?? {}),
        }

        Object.entries(update.$set ?? {}).forEach(([path, value]) => {
          setPath(document, path, value)
        })
        contexts.set(key, document)
        return document
      },
    },
  }
}

test('goalie adjustment APIs require authentication', async () => {
  assert.equal(await request('/api/teams/LAK/goalie-adjustments'), 401)
  assert.equal(
    await request('/api/teams/LAK/goalie-adjustments/8475311', {
      body: JSON.stringify({ ratingAdjustment: 0 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    }),
    401,
  )
  assert.equal(
    await request('/api/game-context/game-1/goalies', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }),
    401,
  )
})

test('provider goalies merge implicit defaults and saved user adjustments', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })

  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475831,
    {
      activeOverride: null,
      note: 'Reliable backup',
      ratingAdjustment: -0.75,
    },
    options,
  )
  const result = await getProviderGoalieAdjustments('user-a', 'LAK', options)

  assert.equal(result.teamId, 'LAK')
  assert.equal(result.goalies.length, 2)
  assert.equal(result.goalies[0].displayName, 'Darcy Kuemper')
  assert.equal(result.goalies[0].ratingAdjustment, 0)
  assert.equal(result.goalies[0].hasSavedAdjustment, false)
  assert.equal(result.goalies[1].displayName, 'David Rittich')
  assert.equal(result.goalies[1].ratingAdjustment, -0.75)
  assert.equal(result.goalies[1].note, 'Reliable backup')
  assert.equal(result.goalies[1].hasSavedAdjustment, true)
})

test('adjustments edit, delete to implicit zero, and remain user/team isolated', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })

  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { note: '', ratingAdjustment: -0.5 },
    options,
  )
  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { note: 'Updated', ratingAdjustment: -1.25 },
    options,
  )

  const userA = await getProviderGoalieAdjustments('user-a', 'LAK', options)
  const userB = await getProviderGoalieAdjustments('user-b', 'LAK', options)
  const otherTeam = await getProviderGoalieAdjustments('user-a', 'BOS', options)

  assert.equal(userA.goalies[0].ratingAdjustment, -1.25)
  assert.equal(userA.goalies[0].note, 'Updated')
  assert.equal(userB.goalies[0].ratingAdjustment, 0)
  assert.equal(otherTeam.goalies[0].ratingAdjustment, 0)

  await deleteGoalieAdjustment('user-a', 'LAK', 8475311, options)
  const deleted = await getProviderGoalieAdjustments('user-a', 'LAK', options)

  assert.equal(deleted.goalies[0].ratingAdjustment, 0)
  assert.equal(deleted.goalies[0].hasSavedAdjustment, false)
  assert.equal(adjustments.documents.size, 0)
})

test('zero adjustment without note does not create a database record', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })

  const result = await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { activeOverride: null, note: '', ratingAdjustment: 0 },
    options,
  )

  assert.equal(result.adjustment, null)
  assert.equal(result.goalie.ratingAdjustment, 0)
  assert.equal(adjustments.documents.size, 0)
})

test('LAK abbreviation and Los Angeles Kings name resolve to one canonical team', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })

  await saveGoalieAdjustment(
    'user-a',
    'Los Angeles Kings',
    8475311,
    { note: '', ratingAdjustment: 0.5 },
    options,
  )
  const result = await getProviderGoalieAdjustments('user-a', 'LAK', options)

  assert.equal(result.teamId, 'LAK')
  assert.equal(result.teamAbbreviation, 'LAK')
  assert.equal(result.goalies[0].ratingAdjustment, 0.5)
})

test('adjustment validation rejects invalid teams, IDs, values, and ownership fields', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5.01, 5.01, 0.03]) {
    assert.throws(() => normalizeAdjustment(value), { statusCode: 400 })
  }

  await assert.rejects(
    saveGoalieAdjustment(
      'user-a',
      'NOT-A-TEAM',
      8475311,
      { ratingAdjustment: 0 },
      options,
    ),
    { statusCode: 400 },
  )
  await assert.rejects(
    saveGoalieAdjustment(
      'user-a',
      'LAK',
      'invalid',
      { ratingAdjustment: 0 },
      options,
    ),
    { statusCode: 400 },
  )
  await assert.rejects(
    saveGoalieAdjustment(
      'user-a',
      'LAK',
      8475311,
      { ratingAdjustment: 0, userId: 'user-b' },
      options,
    ),
    (error) =>
      error.statusCode === 400 &&
      error.details.unsupportedFields.includes('userId'),
  )
  await assert.rejects(
    saveGoalieAdjustment(
      'user-a',
      'LAK',
      9999999,
      { ratingAdjustment: 0 },
      options,
    ),
    { statusCode: 404 },
  )
})

test('legacy matching NHL IDs normalize while unmatched manual goalies stay hidden', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore([
    {
      goalies: [
        {
          active: true,
          name: 'Legacy Darcy',
          nhlPlayerId: 8475311,
          note: 'Migrated on read',
          ratingAdjustment: -0.77,
        },
        {
          active: true,
          name: 'Manual Only Goalie',
          nhlPlayerId: null,
          ratingAdjustment: -2,
        },
        {
          active: true,
          name: 'Former Provider Goalie',
          nhlPlayerId: 8499999,
          ratingAdjustment: -1,
        },
      ],
      teamId: 'LAK',
      userId: 'user-a',
    },
  ])
  const options = createOptions({ adjustments, legacy })
  const result = await getProviderGoalieAdjustments('user-a', 'LAK', options)

  assert.equal(result.goalies.length, 2)
  assert.equal(result.goalies[0].displayName, 'Darcy Kuemper')
  assert.equal(result.goalies[0].ratingAdjustment, -0.75)
  assert.equal(result.goalies[0].adjustmentSource, 'legacy_normalized')
  assert.equal(result.adjustments.length, 1)
  assert.equal(
    result.goalies.some((goalie) => goalie.displayName === 'Manual Only Goalie'),
    false,
  )
})

test('old selections normalize by provider identity without mutating historical values', () => {
  const oldProvider = normalizePersistedGoalieSelection(
    {
      confirmationStatus: 'confirmed',
      effectiveAdjustment: -0.75,
      goalieName: 'Historical Goalie',
      nhlPlayerId: 8475311,
      overrideEnabled: false,
      selectionType: 'team_goalie',
      teamDefaultAdjustment: -0.75,
      teamId: 'LAK',
    },
    'LAK',
  )
  const oldManual = normalizePersistedGoalieSelection(
    {
      effectiveAdjustment: -2,
      goalieName: 'Manual Only',
      selectionType: 'team_goalie',
      teamDefaultAdjustment: -2,
      teamId: 'LAK',
    },
    'LAK',
  )

  assert.equal(oldProvider.selectionType, 'provider_goalie')
  assert.equal(oldProvider.source, 'provider_goalie')
  assert.equal(oldProvider.displayName, 'Historical Goalie')
  assert.equal(oldProvider.effectiveAdjustment, -0.75)
  assert.equal(oldProvider.confirmationStatus, 'confirmed')
  assert.equal(oldManual.selectionType, 'custom')
  assert.equal(oldManual.displayName, 'Manual Only')
  assert.equal(oldManual.effectiveAdjustment, -2)

  const oldBetSnapshot = normalizeGoalieSelectionSnapshot({
    confirmationStatus: 'expected',
    effectiveAdjustment: -0.75,
    goalieName: 'Historical Goalie',
    nhlPlayerId: 8475311,
    selectionType: 'team_goalie',
    teamId: 'LAK',
  })

  assert.equal(oldBetSnapshot.selectionType, 'provider_goalie')
  assert.equal(oldBetSnapshot.displayName, 'Historical Goalie')
  assert.equal(oldBetSnapshot.teamDefaultAdjustment, -0.75)
  assert.equal(oldBetSnapshot.effectiveAdjustment, -0.75)
})

test('provider, custom, unknown, and game-specific override selections normalize', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })
  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { note: '', ratingAdjustment: -0.75 },
    options,
  )

  const provider = await normalizeGameGoalieSelection(
    'user-a',
    {
      nhlPlayerId: 8475311,
      selectionType: 'provider_goalie',
      teamId: 'LAK',
    },
    { expectedTeamId: 'LAK', ...options },
  )
  const override = await normalizeGameGoalieSelection(
    'user-a',
    {
      manualAdjustment: -1.5,
      nhlPlayerId: 8475311,
      overrideEnabled: true,
      selectionType: 'provider_goalie',
      teamId: 'LAK',
    },
    { expectedTeamId: 'LAK', ...options },
  )
  const custom = await normalizeGameGoalieSelection(
    'user-a',
    {
      displayName: '',
      manualAdjustment: -2,
      selectionType: 'custom',
      teamId: 'LAK',
    },
    { expectedTeamId: 'LAK', ...options },
  )

  assert.equal(provider.displayName, 'Darcy Kuemper')
  assert.equal(provider.teamDefaultAdjustment, -0.75)
  assert.equal(provider.effectiveAdjustment, -0.75)
  assert.equal(provider.confirmationStatus, 'selected')
  assert.equal(override.teamDefaultAdjustment, -0.75)
  assert.equal(override.manualAdjustment, -1.5)
  assert.equal(override.effectiveAdjustment, -1.5)
  assert.equal(custom.displayName, '')
  assert.equal(custom.effectiveAdjustment, -2)
  assert.deepEqual(createUnknownGoalieSelection('LAK'), {
    confirmationStatus: 'unknown',
    customNote: '',
    displayName: '',
    effectiveAdjustment: 0,
    manualAdjustment: null,
    nhlPlayerId: null,
    overrideEnabled: false,
    selectionType: 'unknown',
    source: 'unknown',
    teamDefaultAdjustment: null,
    teamGoalieId: null,
    teamId: 'LAK',
  })
})

test('saved provider snapshot remains stable after the team default changes', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const options = createOptions({ adjustments, legacy })
  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { note: '', ratingAdjustment: -0.75 },
    options,
  )
  const gameSnapshot = await normalizeGameGoalieSelection(
    'user-a',
    {
      nhlPlayerId: 8475311,
      selectionType: 'provider_goalie',
      teamId: 'LAK',
    },
    { expectedTeamId: 'LAK', ...options },
  )
  const betSnapshot = normalizeGoalieSelectionSnapshot(gameSnapshot)

  await saveGoalieAdjustment(
    'user-a',
    'LAK',
    8475311,
    { note: '', ratingAdjustment: 1.25 },
    options,
  )

  assert.equal(gameSnapshot.displayName, 'Darcy Kuemper')
  assert.equal(gameSnapshot.effectiveAdjustment, -0.75)
  assert.equal(betSnapshot.displayName, 'Darcy Kuemper')
  assert.equal(betSnapshot.effectiveAdjustment, -0.75)
  assert.equal(betSnapshot.source, 'provider_goalie')
})

test('game context saves provider selections per user and preserves them on recalculation', async () => {
  const adjustments = createAdjustmentStore()
  const legacy = createLegacyStore()
  const goalieOptions = createOptions({ adjustments, legacy })
  const contextStore = createGameContextStore([
    {
      awayTeam: { abbreviation: 'TOR', teamId: 'TOR' },
      gameId: 'game-1',
      homeTeam: { abbreviation: 'LAK', teamId: 'LAK' },
      userId: 'user-a',
    },
    {
      awayTeam: { abbreviation: 'TOR', teamId: 'TOR' },
      gameId: 'game-1',
      homeTeam: { abbreviation: 'LAK', teamId: 'LAK' },
      userId: 'user-b',
    },
  ])
  const result = await updateGameGoalieSelections(
    'user-a',
    'game-1',
    {
      away: createUnknownGoalieSelection('TOR'),
      home: {
        nhlPlayerId: 8475311,
        selectionType: 'provider_goalie',
        teamId: 'LAK',
      },
    },
    {
      contextModel: contextStore.model,
      ...goalieOptions,
    },
  )

  assert.equal(result.context.goalieSelections.home.displayName, 'Darcy Kuemper')
  assert.equal(result.context.goalieSelections.home.effectiveAdjustment, 0)
  assert.equal(
    contextStore.contexts.get('user-b:game-1').goalieSelections,
    undefined,
  )

  const recalculated = calculateGameContextForGame({
    currentGame: {
      awayTeam: { abbreviation: 'TOR', name: 'Toronto Maple Leafs' },
      gameId: 'game-1',
      gameState: 'FUT',
      homeTeam: { abbreviation: 'LAK', name: 'Los Angeles Kings' },
      scheduledStart: '2026-08-05T00:00:00.000Z',
      status: 'Scheduled',
    },
    existingContext: result.context,
    now: new Date('2026-08-04T12:00:00.000Z'),
  })

  assert.equal(
    recalculated.goalieSelections.home.displayName,
    'Darcy Kuemper',
  )
  assert.equal(
    recalculated.goalieSelections.home.selectionType,
    'provider_goalie',
  )
})

test('goalie injury flag remains informational and excluded from injury impact', async () => {
  const normalized = await normalizeInjuryCreatePayload({
    impact: -3,
    isGoalie: true,
    playerName: 'Goalie Injury',
    teamId: 'LAK',
  })
  const pipeline = buildTeamInjurySummaryPipeline(
    '507f1f77bcf86cd799439011',
  )
  const group = pipeline.find((stage) => stage.$group).$group

  assert.equal(normalized.isGoalie, true)
  assert.deepEqual(group.totalImpact.$sum.$cond, [
    { $eq: ['$isGoalie', true] },
    0,
    '$impact',
  ])
})

test('goalie adjustments enforce one user-team-player record', () => {
  const uniqueIndex = GoalieAdjustment.schema
    .indexes()
    .find(([fields, options]) =>
      fields.userId === 1 &&
      fields.teamId === 1 &&
      fields.nhlPlayerId === 1 &&
      options.unique,
    )

  assert.ok(uniqueIndex)
})
