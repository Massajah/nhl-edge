const crypto = require('node:crypto')
const { REQUESTED_BOOKMAKERS } = require('../config/marketOdds')
const {
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  parseValidDate,
} = require('./oddsSnapshotContracts')

const CLOSING_MARKET_SCHEMA_VERSION = 2
const CLOSING_OBSERVATION_TYPE = 'CLOSING'
const CLOSING_WINDOW_MAXIMUM_BEFORE_START_MS = 30 * 60 * 1000
const CLOSING_WINDOW_MINIMUM_BEFORE_START_MS = 5 * 60 * 1000
const CLOSING_FINALIZATION_GRACE_MS = 36 * 60 * 60 * 1000
const CLOSING_SAFETY_REASON =
  'NHL_PREGAME_AND_FETCHED_BEFORE_SCHEDULE_PROVIDER_CUTOFF'
const MAX_CLOSING_OBSERVATIONS = 12

const supportedBookmakerKeys = new Set(
  REQUESTED_BOOKMAKERS.map(({ key }) => key),
)

const normalizeSelectedBookmakerKeys = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) =>
    String(value ?? '').trim(),
  ))]
    .filter((key) => supportedBookmakerKeys.has(key))
    .sort()

const buildClosingMarketKey = ({ gameId, scheduledStart }) =>
  [
    String(gameId ?? '').trim(),
    ODDS_SNAPSHOT_PROVIDER,
    parseValidDate(scheduledStart, 'scheduledStart').getTime(),
  ].join('|')

const buildClosingWorkKey = ({ gameId, scheduledStart }) =>
  `${CLOSING_OBSERVATION_TYPE}:${String(gameId ?? '').trim()}:${parseValidDate(
    scheduledStart,
    'scheduledStart',
  ).getTime()}`

const normalizeClosingBookmakers = (
  bookmakers = [],
  selectedBookmakerKeys = [],
) => {
  const selected = new Set(normalizeSelectedBookmakerKeys(selectedBookmakerKeys))
  const byKey = new Map()

  ;(Array.isArray(bookmakers) ? bookmakers : []).forEach((row) => {
    const key = String(row?.key ?? row?.bookmakerKey ?? '').trim()
    const homeOdds = Number(row?.homeOdds)
    const awayOdds = Number(row?.awayOdds)

    if (
      !selected.has(key) ||
      byKey.has(key) ||
      !Number.isFinite(homeOdds) ||
      homeOdds <= 1 ||
      !Number.isFinite(awayOdds) ||
      awayOdds <= 1
    ) {
      return
    }

    const rawLastUpdate = row?.lastUpdate
    const parsedLastUpdate =
      rawLastUpdate === null || rawLastUpdate === undefined || rawLastUpdate === ''
        ? null
        : new Date(rawLastUpdate)

    if (parsedLastUpdate && !Number.isFinite(parsedLastUpdate.getTime())) {
      return
    }

    byKey.set(key, {
      awayOdds,
      homeOdds,
      key,
      lastUpdate: parsedLastUpdate,
    })
  })

  return [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  )
}

const buildClosingMarketStateHash = ({
  bookmakers = [],
  selectedBookmakerKeys = [],
}) => {
  const selected = normalizeSelectedBookmakerKeys(selectedBookmakerKeys)
  const rows = normalizeClosingBookmakers(bookmakers, selected)
  const pricesByKey = new Map(rows.map((row) => [row.key, row]))
  const semanticState = selected.map((key) => {
    const row = pricesByKey.get(key)

    return row ? [key, row.homeOdds, row.awayOdds] : [key, null, null]
  })

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(semanticState))
    .digest('hex')
}

const isWithinClosingObservationWindow = (scheduledStart, observedAt) => {
  const start = parseValidDate(scheduledStart, 'scheduledStart')
  const observation = parseValidDate(observedAt, 'observedAt')
  const beforeStartMs = start.getTime() - observation.getTime()

  return (
    beforeStartMs >= CLOSING_WINDOW_MINIMUM_BEFORE_START_MS &&
    beforeStartMs <= CLOSING_WINDOW_MAXIMUM_BEFORE_START_MS
  )
}

const buildBestFinal = (bookmakers = []) => {
  const select = (side) => {
    const oddsField = side === 'home' ? 'homeOdds' : 'awayOdds'
    const candidates = (Array.isArray(bookmakers) ? bookmakers : [])
      .filter((row) => Number.isFinite(row?.[oddsField]) && row[oddsField] > 1)
      .sort(
        (left, right) =>
          right[oddsField] - left[oddsField] || left.key.localeCompare(right.key),
      )
    const best = candidates[0]

    return best
      ? {
          bookmakerKey: best.key,
          lastUpdate: best.lastUpdate ?? null,
          observedAt: best.observedAt,
          odds: best[oddsField],
        }
      : null
  }

  return { away: select('away'), home: select('home') }
}

module.exports = {
  CLOSING_FINALIZATION_GRACE_MS,
  CLOSING_MARKET_SCHEMA_VERSION,
  CLOSING_OBSERVATION_TYPE,
  CLOSING_SAFETY_REASON,
  CLOSING_WINDOW_MAXIMUM_BEFORE_START_MS,
  CLOSING_WINDOW_MINIMUM_BEFORE_START_MS,
  MAX_CLOSING_OBSERVATIONS,
  ODDS_SNAPSHOT_MARKET,
  ODDS_SNAPSHOT_PROVIDER,
  buildBestFinal,
  buildClosingMarketKey,
  buildClosingMarketStateHash,
  buildClosingWorkKey,
  isWithinClosingObservationWindow,
  normalizeClosingBookmakers,
  normalizeSelectedBookmakerKeys,
}
