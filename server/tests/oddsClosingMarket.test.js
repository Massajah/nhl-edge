process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const OddsClosingMarket = require('../models/OddsClosingMarket')
const {
  CLOSING_SAFETY_REASON,
  buildClosingMarketStateHash,
} = require('../services/oddsClosingMarketContracts')
const {
  createOddsClosingMarketRepository,
} = require('../services/oddsClosingMarketRepository')

const START = '2026-10-08T19:00:00.000Z'
const SELECTED = ['coolbet', 'pinnacle', 'unibet_fi']

const clone = (value) => structuredClone(value)

const createMemoryModel = () => {
  const documents = new Map()
  let nextId = 1

  const matches = (document, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === '_id') return String(document._id) === String(value)
      return document[key] === value
    })

  return {
    documents,
    async create(values) {
      if (documents.has(values.closingKey)) {
        const error = new Error('duplicate')
        error.code = 11000
        throw error
      }

      const document = { _id: String(nextId++), ...clone(values) }
      documents.set(values.closingKey, document)
      return clone(document)
    },
    async findOne(filter) {
      return clone([...documents.values()].find((row) => matches(row, filter)) ?? null)
    },
    async findOneAndUpdate(filter, update) {
      const document = [...documents.values()].find((row) => matches(row, filter))

      if (!document) return null
      Object.assign(document, clone(update.$set ?? {}))
      Object.entries(update.$inc ?? {}).forEach(([key, amount]) => {
        document[key] = (document[key] ?? 0) + amount
      })
      return clone(document)
    },
  }
}

const makeRows = ({ coolbet = [1.55, 2.68], pinnacle = [1.6, 2.5], unibet = [1.57, 2.66] } = {}) =>
  [
    coolbet && { key: 'coolbet', homeOdds: coolbet[0], awayOdds: coolbet[1], lastUpdate: null },
    pinnacle && { key: 'pinnacle', homeOdds: pinnacle[0], awayOdds: pinnacle[1], lastUpdate: '2026-10-08T18:39:00.000Z' },
    unibet && { key: 'unibet_fi', homeOdds: unibet[0], awayOdds: unibet[1], lastUpdate: '2026-10-08T18:39:30.000Z' },
  ].filter(Boolean)

const makeCandidate = (capturedAt, bookmakers = makeRows()) => ({
  awayTeamId: 'BOS',
  bookmakers,
  capturedAt,
  gameId: '2026020001',
  gameType: 2,
  homeTeamId: 'TOR',
  providerCommenceTime: START,
  providerEventId: 'provider-event-1',
  scheduledStartAtCapture: START,
  seasonId: '20262027',
  selectedBookmakerKeys: SELECTED,
})

test('closing market state hash ignores ordering and timestamps but includes availability and prices', () => {
  const rows = makeRows()
  const baseline = buildClosingMarketStateHash({
    bookmakers: rows,
    selectedBookmakerKeys: SELECTED,
  })
  const reordered = buildClosingMarketStateHash({
    bookmakers: [...rows].reverse().map((row) => ({
      ...row,
      lastUpdate: '2026-10-08T18:44:00.000Z',
    })),
    selectedBookmakerKeys: [...SELECTED].reverse(),
  })
  const disappeared = buildClosingMarketStateHash({
    bookmakers: makeRows({ coolbet: null }),
    selectedBookmakerKeys: SELECTED,
  })

  assert.equal(reordered, baseline)
  assert.notEqual(disappeared, baseline)
})

test('closing observations are change-driven while latest safe timestamps advance', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })
  const first = await repository.recordObservation(
    makeCandidate('2026-10-08T18:30:00.000Z'),
  )
  const identical = await repository.recordObservation(
    makeCandidate('2026-10-08T18:35:00.000Z', [...makeRows()].reverse()),
  )
  const changed = await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:40:00.000Z',
      makeRows({ unibet: [1.58, 2.64] }),
    ),
  )
  const state = [...model.documents.values()][0]

  assert.equal(first.observationStored, true)
  assert.equal(first.closingMarket.finalizedAt, null)
  assert.equal(identical.observationStored, false)
  assert.equal(changed.observationStored, true)
  assert.equal(state.observations.length, 2)
  assert.equal(
    new Date(state.latestSafeBookmakers.find(({ key }) => key === 'coolbet').observedAt)
      .toISOString(),
    '2026-10-08T18:40:00.000Z',
  )
})

test('a selected bookmaker appearance creates a new observation and latest-safe row', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(
    makeCandidate('2026-10-08T18:30:00.000Z', makeRows({ coolbet: null })),
  )
  await repository.recordObservation(
    makeCandidate('2026-10-08T18:35:00.000Z'),
  )
  const state = [...model.documents.values()][0]
  const coolbet = state.latestSafeBookmakers.find(({ key }) => key === 'coolbet')

  assert.equal(state.observations.length, 2)
  assert.equal(coolbet.awayOdds, 2.68)
  assert.equal(new Date(coolbet.observedAt).toISOString(), '2026-10-08T18:35:00.000Z')
})

test('bookmaker disappearance is recorded without erasing its latest safe price', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(makeCandidate('2026-10-08T18:40:00.000Z'))
  await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:45:00.000Z',
      makeRows({ coolbet: [1.54, 2.7], unibet: [1.58, 2.64] }),
    ),
  )
  await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:50:00.000Z',
      makeRows({ coolbet: null, unibet: [1.57, 2.66] }),
    ),
  )
  await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:55:00.000Z',
      makeRows({ coolbet: null, pinnacle: [1.61, 2.49], unibet: [1.56, 2.69] }),
    ),
  )
  const state = [...model.documents.values()][0]
  const coolbet = state.latestSafeBookmakers.find(({ key }) => key === 'coolbet')

  assert.equal(state.observations.length, 4)
  assert.equal(coolbet.awayOdds, 2.7)
  assert.equal(new Date(coolbet.observedAt).toISOString(), '2026-10-08T18:45:00.000Z')
})

test('bookmaker FINALs are independent and best home and away may use different books', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(makeCandidate('2026-10-08T18:40:00.000Z'))
  await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:45:00.000Z',
      makeRows({ coolbet: [1.62, 2.55], unibet: null }),
    ),
  )
  await repository.recordObservation(
    makeCandidate(
      '2026-10-08T18:55:00.000Z',
      makeRows({ coolbet: null, pinnacle: [1.6, 2.72], unibet: [1.59, 2.7] }),
    ),
  )
  const result = await repository.finalizeClosingMarket({
    gameId: '2026020001',
    observedAt: '2026-10-08T18:55:00.000Z',
    reason: 'CLOSING_WINDOW_ENDED',
    scheduledStart: START,
    selectedBookmakerKeys: SELECTED,
  })
  const repeated = await repository.finalizeClosingMarket({
    gameId: '2026020001',
    observedAt: START,
    reason: 'GAME_STARTED',
    scheduledStart: START,
    selectedBookmakerKeys: SELECTED,
  })
  const final = result.closingMarket

  assert.equal(result.status, 'FINALIZED')
  assert.equal(repeated.status, 'EXISTING')
  assert.equal(final.finalBookmakers.length, 3)
  assert.equal(
    new Date(final.finalBookmakers.find(({ key }) => key === 'coolbet').observedAt)
      .toISOString(),
    '2026-10-08T18:45:00.000Z',
  )
  assert.equal(final.bestFinal.home.bookmakerKey, 'coolbet')
  assert.equal(final.bestFinal.home.odds, 1.62)
  assert.equal(final.bestFinal.away.bookmakerKey, 'pinnacle')
  assert.equal(final.bestFinal.away.odds, 2.72)
  const coolbetFinal = final.finalBookmakers.find(({ key }) => key === 'coolbet')
  assert.equal(coolbetFinal.lastUpdate, null)
  assert.equal(coolbetFinal.lastUpdateMissing, true)
  assert.equal(coolbetFinal.safetyReason, CLOSING_SAFETY_REASON)
})

test('settings changes preserve historical observations and filter only the derived FINAL', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(makeCandidate('2026-10-08T18:30:00.000Z'))
  await repository.recordObservation({
    ...makeCandidate('2026-10-08T18:35:00.000Z', makeRows({ coolbet: null, unibet: null })),
    selectedBookmakerKeys: ['pinnacle'],
  })
  const result = await repository.finalizeClosingMarket({
    gameId: '2026020001',
    observedAt: '2026-10-08T18:55:00.000Z',
    reason: 'CLOSING_WINDOW_ENDED',
    scheduledStart: START,
    selectedBookmakerKeys: ['pinnacle'],
  })

  assert.deepEqual(result.closingMarket.observations[0].selectedBookmakerKeys, SELECTED)
  assert.equal(result.closingMarket.observations[0].bookmakers.length, 3)
  assert.deepEqual(result.closingMarket.observations[1].selectedBookmakerKeys, ['pinnacle'])
  assert.deepEqual(
    result.closingMarket.finalBookmakers.map(({ key }) => key),
    ['pinnacle'],
  )
})

test('rescheduled starts create distinct closing histories for the same NHL game', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })
  const rescheduledStart = '2026-10-08T19:30:00.000Z'

  await repository.recordObservation(makeCandidate('2026-10-08T18:30:00.000Z'))
  await repository.recordObservation({
    ...makeCandidate('2026-10-08T19:00:00.000Z'),
    providerCommenceTime: rescheduledStart,
    scheduledStartAtCapture: rescheduledStart,
  })

  assert.equal(model.documents.size, 2)
})

test('concurrent duplicate cron observations remain idempotent', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })
  const candidate = makeCandidate('2026-10-08T18:30:00.000Z')
  const results = await Promise.all([
    repository.recordObservation(candidate),
    repository.recordObservation(candidate),
  ])
  const state = [...model.documents.values()][0]

  assert.equal(results.filter(({ observationStored }) => observationStored).length, 1)
  assert.equal(state.observations.length, 1)
})

test('an unavailable market with no prior safe price finalizes without fabricating odds', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(
    makeCandidate('2026-10-08T18:50:00.000Z', []),
  )
  const result = await repository.finalizeClosingMarket({
    gameId: '2026020001',
    observedAt: '2026-10-08T18:55:00.000Z',
    reason: 'CLOSING_WINDOW_ENDED',
    scheduledStart: START,
    selectedBookmakerKeys: SELECTED,
  })

  assert.equal(result.closingMarket.finalizationReason, 'NO_SAFE_ODDS')
  assert.deepEqual(result.closingMarket.finalBookmakers, [])
  assert.equal(result.closingMarket.bestFinal.home, null)
  assert.equal(result.closingMarket.bestFinal.away, null)
})

test('v2 closing market documents validate with compact normalized history', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(makeCandidate('2026-10-08T18:40:00.000Z'))
  const stored = [...model.documents.values()][0]
  delete stored._id
  const document = new OddsClosingMarket(stored)

  await document.validate()
  assert.equal(document.schemaVersion, 2)
  assert.equal(document.observations.length, 1)
  assert.equal(document.latestSafeBookmakers.length, 3)
})

test('v2 closing schema rejects same-team games and duplicate selected keys', async () => {
  const model = createMemoryModel()
  const repository = createOddsClosingMarketRepository({ closingModel: model })

  await repository.recordObservation(makeCandidate('2026-10-08T18:40:00.000Z'))
  const stored = clone([...model.documents.values()][0])
  delete stored._id

  await assert.rejects(
    new OddsClosingMarket({ ...stored, awayTeamId: 'TOR' }).validate(),
    (error) => Boolean(error.errors.awayTeamId),
  )
  await assert.rejects(
    new OddsClosingMarket({
      ...stored,
      selectedBookmakerKeys: ['coolbet', 'coolbet'],
    }).validate(),
    (error) => Boolean(error.errors.selectedBookmakerKeys),
  )
})
