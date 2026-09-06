process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const mongoose = require('mongoose')
const Injury = require('../models/Injury')
const app = require('../app')
const injuriesController = require('../controllers/injuriesController')
const injuriesService = require('../services/injuriesService')
const {
  buildActiveDuplicateQuery,
  buildTeamHistoryDeleteQuery,
  buildTeamInjurySummaryPipeline,
  clearTeamInjuryHistory,
  createInjury,
  normalizeCreatePayload,
  normalizeImpact,
  normalizePlayerPosition,
  normalizeUpdatePayload,
  serializeSummaryInjury,
  updateInjury,
} = require('../services/injuriesService')

const USER_A = new mongoose.Types.ObjectId().toString()

const createFakeInjuryModel = () => {
  const records = []

  const same = (left, right) => String(left) === String(right)

  class FakeInjury {
    constructor(document) {
      Object.assign(this, document)
      this._id = document._id ?? new mongoose.Types.ObjectId()
    }

    async save() {
      if (!records.includes(this)) {
        records.push(this)
      }

      return this
    }

    toJSON() {
      return {
        ...this,
        id: this._id.toString(),
        userId: String(this.userId),
      }
    }

    static async findOne(filter) {
      if (filter._id && !filter._id.$ne) {
        return records.find(
          (record) =>
            same(record._id, filter._id) && same(record.userId, filter.userId),
        ) ?? null
      }

      return records.find((record) => {
        if (
          !same(record.userId, filter.userId) ||
          record.teamId !== filter.teamId ||
          record.active !== true ||
          record.status === 'healthy' ||
          (filter._id?.$ne && same(record._id, filter._id.$ne))
        ) {
          return false
        }

        if (filter.providerPlayerId) {
          return record.providerPlayerId === filter.providerPlayerId
        }

        const nameExpression = filter.$and?.[1]?.playerName?.$regex
        return (
          !record.providerPlayerId &&
          new RegExp(nameExpression, 'i').test(record.playerName)
        )
      }) ?? null
    }

    static async deleteMany(filter) {
      const retainedRecords = records.filter((record) => {
        const belongsToScope =
          same(record.userId, filter.userId) && record.teamId === filter.teamId
        const isHistorical = record.active !== true || record.status === 'healthy'

        return !belongsToScope || !isHistorical
      })
      const deletedCount = records.length - retainedRecords.length

      records.splice(0, records.length, ...retainedRecords)
      return { deletedCount }
    }
  }

  return { model: FakeInjury, records }
}

const settingsProvider = async () => ({
  settings: { maximumPlayerInjuryPenalty: -2.5 },
})

test('roster identity fields normalize canonical positions and preserve provider IDs', async () => {
  assert.equal(normalizePlayerPosition('L'), 'LW')
  assert.equal(normalizePlayerPosition('right wing'), 'RW')
  assert.equal(normalizePlayerPosition('defenseman'), 'D')

  const injury = await normalizeCreatePayload(
    {
      impact: -1,
      playerName: 'Roster Skater',
      position: 'L',
      providerPlayerId: 8470001,
      teamId: 'BOS',
    },
    { maximumPlayerInjuryPenalty: -2.5 },
  )

  assert.equal(injury.playerName, 'Roster Skater')
  assert.equal(injury.position, 'LW')
  assert.equal(injury.providerPlayerId, 8470001)
  assert.equal(injury.isGoalie, false)
})

test('manual unlisted players require a name and may omit provider identity and position', async () => {
  const injury = await normalizeCreatePayload(
    { impact: 0, playerName: 'AHL Call-up', teamId: 'LAK' },
    { maximumPlayerInjuryPenalty: -2.5 },
  )

  assert.equal(injury.providerPlayerId, null)
  assert.equal(injury.position, '')

  await assert.rejects(
    () => normalizeCreatePayload({ playerName: ' ', teamId: 'LAK' }),
    (error) => error.statusCode === 400 && error.details.field === 'playerName',
  )
})

test('provider and manual goalies are reference-only and persist zero model impact', async () => {
  for (const payload of [
    {
      impact: -2.5,
      playerName: 'Provider Goalie',
      position: 'G',
      providerPlayerId: 8470002,
      teamId: 'BOS',
    },
    {
      impact: -1.5,
      playerName: 'Unlisted Goalie',
      position: 'goalie',
      teamId: 'LAK',
    },
  ]) {
    const normalized = await normalizeCreatePayload(payload, {
      maximumPlayerInjuryPenalty: -2.5,
    })

    assert.equal(normalized.position, 'G')
    assert.equal(normalized.isGoalie, true)
    assert.equal(normalized.impact, 0)
  }

  assert.deepEqual(
    serializeSummaryInjury({ impact: -4, isGoalie: false, position: 'G' }),
    {
      id: '',
      impact: 0,
      isGoalie: true,
      playerName: 'Unknown player',
      position: 'G',
      providerPlayerId: null,
    },
  )
})

test('skater injury values use the configured range and 0.50-point steps', () => {
  for (const impact of [0, -0.5, -1, -1.5, -2, -2.5]) {
    assert.equal(normalizeImpact(impact, -2.5), impact)
  }

  for (const impact of [0.5, -2.75, -3]) {
    assert.throws(
      () => normalizeImpact(impact, -2.5),
      (error) => error.statusCode === 400 && error.details.field === 'impact',
    )
  }

  assert.equal(normalizeImpact(-1.5, -1.5), -1.5)
  assert.throws(() => normalizeImpact(-2, -1.5))
})

test('legacy arbitrary impact stays readable until the impact itself changes', () => {
  const existingInjury = {
    impact: -1.65,
    isGoalie: false,
    position: '',
  }

  assert.equal(
    normalizeUpdatePayload(
      { impact: -1.65, notes: 'Still under review' },
      { existingInjury, maximumPlayerInjuryPenalty: -2.5 },
    ).impact,
    -1.65,
  )
  assert.throws(() =>
    normalizeUpdatePayload(
      { impact: -1.75 },
      { existingInjury, maximumPlayerInjuryPenalty: -2.5 },
    ),
  )
  assert.equal(
    normalizeUpdatePayload(
      { impact: -1.5 },
      { existingInjury, maximumPlayerInjuryPenalty: -2.5 },
    ).impact,
    -1.5,
  )
})

test('active duplicate provider and manual identities are protected without blocking history', async () => {
  const store = createFakeInjuryModel()
  const options = { injuryModel: store.model, settingsProvider }

  const first = await createInjury(
    USER_A,
    {
      impact: -1,
      playerName: 'Same Skater',
      position: 'C',
      providerPlayerId: 8470003,
      teamId: 'BOS',
    },
    options,
  )

  await assert.rejects(
    () =>
      createInjury(
        USER_A,
        {
          impact: -0.5,
          playerName: 'Renamed Snapshot',
          position: 'C',
          providerPlayerId: 8470003,
          teamId: 'BOS',
        },
        options,
      ),
    (error) =>
      error.statusCode === 409 && Boolean(error.details.existingInjuryId),
  )

  await updateInjury(
    USER_A,
    first.id,
    { active: false, status: 'healthy' },
    options,
  )
  const reopened = await createInjury(
    USER_A,
    {
      impact: -0.5,
      playerName: 'Same Skater',
      position: 'C',
      providerPlayerId: 8470003,
      teamId: 'BOS',
    },
    options,
  )

  assert.notEqual(reopened.id, first.id)
  assert.equal(store.records.length, 2)

  const manualQuery = buildActiveDuplicateQuery({
    playerName: 'A. Player (Call-up)',
    providerPlayerId: null,
    teamId: 'BOS',
    userId: USER_A,
  })
  assert.equal(manualQuery.$and[1].playerName.$options, 'i')
  assert.equal(manualQuery.$and[1].playerName.$regex, '^A\\. Player \\(Call-up\\)$')
})

test('stored team impact pipeline counts only negative active skaters and keeps context rows', () => {
  const pipeline = buildTeamInjurySummaryPipeline(USER_A)
  const match = pipeline[0].$match
  const group = pipeline[1].$group

  assert.equal(match.active, true)
  assert.deepEqual(match.status, { $ne: 'healthy' })
  assert.deepEqual(group.totalImpact.$sum.$cond[0], {
    $and: [
      { $ne: ['$isGoalie', true] },
      { $ne: ['$position', 'G'] },
      { $lt: ['$impact', 0] },
    ],
  })
  assert.equal(group.totalImpact.$sum.$cond[1], '$impact')
  assert.equal(group.injuries.$push.playerName, '$playerName')
  assert.equal(group.injuries.$push.position, '$position')
})

test('team history cleanup is user-scoped, team-scoped and preserves active skaters and goalies', async () => {
  const store = createFakeInjuryModel()
  const USER_B = new mongoose.Types.ObjectId().toString()
  const activeSkater = {
    active: true,
    impact: -1.5,
    playerName: 'Active Skater',
    position: 'C',
    status: 'out',
    teamId: 'BOS',
    userId: USER_A,
  }
  const activeGoalie = {
    active: true,
    impact: 0,
    isGoalie: true,
    playerName: 'Active Goalie',
    position: 'G',
    status: 'day-to-day',
    teamId: 'BOS',
    userId: USER_A,
  }

  store.records.push(
    activeSkater,
    activeGoalie,
    {
      active: false,
      impact: -2,
      playerName: 'Recovered Skater',
      status: 'healthy',
      teamId: 'BOS',
      userId: USER_A,
    },
    {
      active: true,
      impact: -0.5,
      playerName: 'Legacy Healthy Record',
      status: 'healthy',
      teamId: 'BOS',
      userId: USER_A,
    },
    {
      impact: -1,
      playerName: 'Legacy Inactive Record',
      status: 'out',
      teamId: 'BOS',
      userId: USER_A,
    },
    {
      active: false,
      playerName: 'Other Team History',
      status: 'healthy',
      teamId: 'LAK',
      userId: USER_A,
    },
    {
      active: false,
      playerName: 'Other User History',
      status: 'healthy',
      teamId: 'BOS',
      userId: USER_B,
    },
  )

  const storedImpactBefore = store.records
    .filter(
      (record) =>
        String(record.userId) === USER_A &&
        record.teamId === 'BOS' &&
        record.active === true &&
        record.status !== 'healthy' &&
        record.isGoalie !== true,
    )
    .reduce((total, record) => total + Math.min(Number(record.impact) || 0, 0), 0)

  assert.deepEqual(buildTeamHistoryDeleteQuery(USER_A, 'BOS'), {
    userId: USER_A,
    teamId: 'BOS',
    $or: [{ active: { $ne: true } }, { status: 'healthy' }],
  })

  const result = await clearTeamInjuryHistory(USER_A, 'BOS', {
    injuryModel: store.model,
  })

  assert.deepEqual(result, { deletedCount: 3, teamId: 'BOS' })
  assert.equal(store.records.includes(activeSkater), true)
  assert.equal(store.records.includes(activeGoalie), true)
  assert.equal(store.records.some((record) => record.playerName === 'Other Team History'), true)
  assert.equal(store.records.some((record) => record.playerName === 'Other User History'), true)

  const storedImpactAfter = store.records
    .filter(
      (record) =>
        String(record.userId) === USER_A &&
        record.teamId === 'BOS' &&
        record.active === true &&
        record.status !== 'healthy' &&
        record.isGoalie !== true,
    )
    .reduce((total, record) => total + Math.min(Number(record.impact) || 0, 0), 0)

  assert.equal(storedImpactAfter, storedImpactBefore)
})

test('team history cleanup rejects unknown teams before attempting deletion', async () => {
  let deleteWasCalled = false

  await assert.rejects(
    () =>
      clearTeamInjuryHistory(USER_A, 'NOT-A-TEAM', {
        injuryModel: {
          async deleteMany() {
            deleteWasCalled = true
          },
        },
      }),
    (error) => error.statusCode === 400 && error.details.field === 'teamId',
  )

  assert.equal(deleteWasCalled, false)
})

test('team history cleanup endpoint requires authentication', async () => {
  const server = app.listen(0)

  try {
    const address = server.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/injuries/team/BOS/history`,
      { method: 'DELETE' },
    )

    assert.equal(response.status, 401)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test('team history cleanup controller trusts the authenticated user and returns deleted count', async () => {
  const originalClearTeamInjuryHistory = injuriesService.clearTeamInjuryHistory
  let capturedScope
  let responseBody
  let forwardedError

  injuriesService.clearTeamInjuryHistory = async (userId, teamId) => {
    capturedScope = { teamId, userId }
    return { deletedCount: 4, teamId }
  }

  try {
    await injuriesController.clearTeamInjuryHistory(
      {
        body: { userId: 'client-supplied-user' },
        params: { teamId: 'BOS' },
        user: { id: USER_A },
      },
      {
        json(body) {
          responseBody = body
        },
      },
      (error) => {
        forwardedError = error
      },
    )

    assert.equal(forwardedError, undefined)
    assert.deepEqual(capturedScope, { teamId: 'BOS', userId: USER_A })
    assert.deepEqual(responseBody, {
      deletedCount: 4,
      success: true,
      teamId: 'BOS',
    })
  } finally {
    injuriesService.clearTeamInjuryHistory = originalClearTeamInjuryHistory
  }
})

test('legacy injury documents need no destructive identity migration', async () => {
  const document = new Injury({
    impact: -1.65,
    playerName: 'Legacy Skater',
    teamAbbreviation: 'BOS',
    teamId: 'BOS',
    teamName: 'Boston Bruins',
    userId: new mongoose.Types.ObjectId(),
  })

  await document.validate()
  assert.equal(document.providerPlayerId, null)
  assert.equal(document.position, '')
  assert.equal(document.impact, -1.65)
})
