const {
  canonicalize,
  createDeterministicSignature,
  createGameIdSignature,
  deepFreeze,
} = require('./calibrationIdentity')

const compareIdentifiers = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

const asPlainObject = (value) => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  if (typeof value.toObject === 'function') {
    return value.toObject()
  }

  return { ...value }
}

const normalizeIdentifier = (value, field) => {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    throw new TypeError(`${field} requires a non-empty identifier.`)
  }

  return normalized
}

const normalizeUniqueIdentifiers = (values, field) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must contain at least one identifier.`)
  }

  const normalized = values.map((value, index) =>
    normalizeIdentifier(value, `${field}[${index}]`),
  )

  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${field} must not contain duplicate identifiers.`)
  }

  return normalized.sort(compareIdentifiers)
}

const toIsoStringOrNull = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

const getHistoricalDatasetRevision = (dataset) => {
  const document = asPlainObject(dataset)
  const revision =
    document.datasetRevision ?? document.revision ?? document.version ?? null

  return typeof revision === 'string' || Number.isFinite(revision)
    ? revision
    : null
}

const normalizeCompletedWindows = (completedWindows) => {
  if (!Array.isArray(completedWindows)) {
    return []
  }

  return completedWindows
    .map((window) => ({
      completedAt: toIsoStringOrNull(window?.completedAt),
      dateFrom: window?.dateFrom ?? null,
      dateTo: window?.dateTo ?? null,
      gamesFound: Number.isFinite(window?.gamesFound)
        ? window.gamesFound
        : null,
      gamesPersisted: Number.isFinite(window?.gamesPersisted)
        ? window.gamesPersisted
        : null,
    }))
    .sort(
      (left, right) =>
        compareIdentifiers(String(left.dateFrom), String(right.dateFrom)) ||
        compareIdentifiers(String(left.dateTo), String(right.dateTo)),
    )
}

const getHistoricalPreparationMetadata = (dataset, seasonId = null) => {
  const document = asPlainObject(dataset)
  const completedWindows = normalizeCompletedWindows(document.completedWindows)

  return canonicalize({
    completedAt: toIsoStringOrNull(document.completedAt),
    completedGames: Number.isFinite(document.completedGames)
      ? document.completedGames
      : null,
    completedWindowCount: Array.isArray(document.completedWindows)
      ? document.completedWindows.length
      : Number.isFinite(document.completedWindows)
        ? document.completedWindows
        : null,
    completedWindows,
    datasetRevision: getHistoricalDatasetRevision(document),
    firstGameDate: document.firstGameDate ?? null,
    importedGames: Number.isFinite(
      document.importedGames ?? document.gamesPersisted,
    )
      ? document.importedGames ?? document.gamesPersisted
      : null,
    lastGameDate: document.lastGameDate ?? null,
    regularSeasonEnd: document.regularSeasonEnd ?? null,
    regularSeasonStart: document.regularSeasonStart ?? null,
    seasonId: document.seasonId ?? seasonId,
    skippedGames: Number.isFinite(document.skippedGames)
      ? document.skippedGames
      : null,
    source: document.source ?? null,
    status: document.status ?? null,
  })
}

const normalizePreparationMetadata = (metadata, seasons) => {
  const metadataArray = Array.isArray(metadata)
    ? metadata
    : metadata instanceof Map
      ? [...metadata.entries()].map(([seasonId, dataset]) => ({
          dataset,
          seasonId,
        }))
      : []
  const normalizedBySeason = new Map(
    metadataArray.map((entry, index) => {
      const source = entry?.dataset ?? entry
      const seasonId = normalizeIdentifier(
        entry?.seasonId ?? source?.seasonId,
        `preparationMetadata[${index}].seasonId`,
      )

      return [seasonId, getHistoricalPreparationMetadata(source, seasonId)]
    }),
  )

  return seasons.map(
    (seasonId) =>
      normalizedBySeason.get(seasonId) ??
      getHistoricalPreparationMetadata({ seasonId }, seasonId),
  )
}

const getCombinedDatasetRevision = (preparationMetadata) => {
  if (
    preparationMetadata.length === 0 ||
    preparationMetadata.some((metadata) => metadata.datasetRevision === null)
  ) {
    return null
  }

  return createDeterministicSignature(
    'nhl-edge/calibration-dataset-revisions/v1',
    preparationMetadata.map(({ datasetRevision, seasonId }) => ({
      datasetRevision,
      seasonId,
    })),
  )
}

/**
 * Builds an immutable description of a frozen calibration sample. Existing
 * HistoricalSeasonDataset documents have preparation metadata but no reliable
 * revision field, so datasetRevision remains null for those documents.
 */
const createCalibrationDatasetContext = ({
  datasetRevision,
  includedGameIds,
  preparationMetadata = [],
  seasons,
} = {}) => {
  const normalizedSeasons = normalizeUniqueIdentifiers(seasons, 'seasons')
  const normalizedGameIds = normalizeUniqueIdentifiers(
    includedGameIds,
    'includedGameIds',
  )
  const normalizedPreparationMetadata = normalizePreparationMetadata(
    preparationMetadata,
    normalizedSeasons,
  )
  const gameIdSignature = createGameIdSignature(normalizedGameIds)
  const resolvedDatasetRevision =
    datasetRevision ??
    getCombinedDatasetRevision(normalizedPreparationMetadata)
  const datasetSignature = createDeterministicSignature(
    'nhl-edge/calibration-dataset/v1',
    {
      includedGameIds: normalizedGameIds,
      seasons: normalizedSeasons,
    },
  )

  return deepFreeze({
    datasetRevision: resolvedDatasetRevision ?? null,
    datasetSignature,
    gameCount: normalizedGameIds.length,
    gameIdSignature,
    includedGameIds: normalizedGameIds,
    preparationMetadata: normalizedPreparationMetadata,
    seasons: normalizedSeasons,
  })
}

module.exports = {
  createCalibrationDatasetContext,
  getHistoricalDatasetRevision,
  getHistoricalPreparationMetadata,
}
