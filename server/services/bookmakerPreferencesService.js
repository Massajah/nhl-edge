const BookmakerPreferences = require('../models/BookmakerPreferences')
const { getMarketOddsConfig } = require('../config/marketOdds')

const ALL_DISABLED_WARNING =
  'At least one bookmaker must be enabled. All bookmakers have been enabled automatically.'

class BookmakerPreferencesError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'BookmakerPreferencesError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const normalizeBookmakerKey = (value) => String(value ?? '').trim()

const normalizeAvailableBookmakers = (bookmakers = []) => {
  const indexed = new Map()

  ;(Array.isArray(bookmakers) ? bookmakers : []).forEach((bookmaker) => {
    const bookmakerKey = normalizeBookmakerKey(bookmaker?.bookmakerKey)

    if (!bookmakerKey) {
      return
    }

    indexed.set(bookmakerKey, {
      bookmakerKey,
      bookmakerTitle: String(
        bookmaker?.bookmakerTitle ?? bookmakerKey,
      ).trim(),
      lastUpdate: bookmaker?.lastUpdate ?? null,
    })
  })

  return [...indexed.values()].sort((left, right) =>
    left.bookmakerTitle.localeCompare(right.bookmakerTitle),
  )
}

const normalizeSupportedBookmakers = (bookmakers = []) => {
  const indexed = new Map()

  ;(Array.isArray(bookmakers) ? bookmakers : []).forEach((bookmaker) => {
    const bookmakerKey = normalizeBookmakerKey(
      bookmaker?.key ?? bookmaker?.bookmakerKey,
    )

    if (!bookmakerKey || indexed.has(bookmakerKey)) {
      return
    }

    indexed.set(bookmakerKey, {
      bookmakerKey,
      bookmakerTitle: String(
        bookmaker?.title ?? bookmaker?.bookmakerTitle ?? bookmakerKey,
      ).trim(),
    })
  })

  return [...indexed.values()]
}

const normalizeDisabledKeys = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeBookmakerKey))]
    .filter(Boolean)
    .sort()

const buildPreferencesResponse = ({
  availableBookmakers,
  disabledBookmakerKeys = [],
  fallbackApplied = false,
  supportedBookmakers = getMarketOddsConfig().bookmakers,
  usingDefaults = false,
}) => {
  const normalizedAvailable = normalizeAvailableBookmakers(availableBookmakers)
  const normalizedSupported = normalizeSupportedBookmakers(supportedBookmakers)
  const supportedKeySet = new Set(
    normalizedSupported.map(({ bookmakerKey }) => bookmakerKey),
  )
  const supportedAvailable = normalizedAvailable.filter(({ bookmakerKey }) =>
    supportedKeySet.has(bookmakerKey),
  )
  const availableByKey = new Map(
    supportedAvailable.map((bookmaker) => [bookmaker.bookmakerKey, bookmaker]),
  )
  const normalizedDisabled = normalizeDisabledKeys(disabledBookmakerKeys).filter(
    (bookmakerKey) => supportedKeySet.has(bookmakerKey),
  )
  const disabledSet = new Set(normalizedDisabled)

  return {
    availableBookmakers: supportedAvailable,
    disabledBookmakerKeys: normalizedDisabled,
    enabledBookmakerKeys: normalizedSupported
      .map(({ bookmakerKey }) => bookmakerKey)
      .filter((bookmakerKey) => !disabledSet.has(bookmakerKey)),
    fallbackApplied,
    supportedBookmakers: normalizedSupported.map((bookmaker) => ({
      ...bookmaker,
      available: availableByKey.has(bookmaker.bookmakerKey),
      lastUpdate:
        availableByKey.get(bookmaker.bookmakerKey)?.lastUpdate ?? null,
    })),
    usingDefaults,
    warning: fallbackApplied ? ALL_DISABLED_WARNING : null,
  }
}

const getPreferencesModel = (options = {}) =>
  options.preferencesModel ?? BookmakerPreferences

const getSupportedBookmakers = (options = {}) =>
  options.supportedBookmakers ?? getMarketOddsConfig().bookmakers

const assertUserId = (userId) => {
  if (!userId) {
    throw new BookmakerPreferencesError(
      'Authenticated userId is required.',
      401,
    )
  }
}

const persistDisabledKeys = async ({
  disabledBookmakerKeys,
  preferencesModel,
  userId,
}) =>
  preferencesModel.findOneAndUpdate(
    { userId },
    {
      $set: { disabledBookmakerKeys },
      $setOnInsert: { userId },
    },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )

const getBookmakerPreferences = async (
  userId,
  availableBookmakers = [],
  options = {},
) => {
  assertUserId(userId)

  const preferencesModel = getPreferencesModel(options)
  const supportedBookmakers = getSupportedBookmakers(options)
  const preferencesDocument = await preferencesModel.findOne({ userId })
  let response = buildPreferencesResponse({
    availableBookmakers,
    disabledBookmakerKeys: preferencesDocument?.disabledBookmakerKeys,
    supportedBookmakers,
    usingDefaults: !preferencesDocument,
  })

  if (
    response.supportedBookmakers.length > 0 &&
    response.enabledBookmakerKeys.length === 0
  ) {
    await persistDisabledKeys({
      disabledBookmakerKeys: [],
      preferencesModel,
      userId,
    })
    response = buildPreferencesResponse({
      availableBookmakers,
      disabledBookmakerKeys: [],
      fallbackApplied: true,
      supportedBookmakers,
    })
  }

  return { preferences: response }
}

const normalizeUpdatePayload = (payload = {}) => {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new BookmakerPreferencesError(
      'Request body must be an object.',
      400,
    )
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => field !== 'enabledBookmakerKeys',
  )

  if (unsupportedFields.length > 0) {
    throw new BookmakerPreferencesError(
      'Request body contains unsupported bookmaker preference fields.',
      400,
      { unsupportedFields },
    )
  }

  if (!Array.isArray(payload.enabledBookmakerKeys)) {
    throw new BookmakerPreferencesError(
      'enabledBookmakerKeys must be an array.',
      400,
      { field: 'enabledBookmakerKeys' },
    )
  }

  return normalizeDisabledKeys(payload.enabledBookmakerKeys)
}

const updateBookmakerPreferences = async (
  userId,
  payload,
  availableBookmakers = [],
  options = {},
) => {
  assertUserId(userId)

  const supportedBookmakers = getSupportedBookmakers(options)
  const normalizedSupported = normalizeSupportedBookmakers(supportedBookmakers)
  const normalizedAvailable = normalizeAvailableBookmakers(availableBookmakers)
  const supportedKeys = normalizedSupported.map(
    ({ bookmakerKey }) => bookmakerKey,
  )
  const supportedKeySet = new Set(supportedKeys)
  const requestedEnabledKeys = normalizeUpdatePayload(payload).filter(
    (bookmakerKey) => supportedKeySet.has(bookmakerKey),
  )
  const fallbackApplied =
    normalizedSupported.length > 0 && requestedEnabledKeys.length === 0
  const effectiveEnabledKeys = fallbackApplied
    ? supportedKeys
    : requestedEnabledKeys
  const enabledSet = new Set(effectiveEnabledKeys)
  const disabledBookmakerKeys = supportedKeys.filter(
    (bookmakerKey) => !enabledSet.has(bookmakerKey),
  )
  const preferencesModel = getPreferencesModel(options)

  await persistDisabledKeys({
    disabledBookmakerKeys: fallbackApplied ? [] : disabledBookmakerKeys,
    preferencesModel,
    userId,
  })

  return {
    preferences: buildPreferencesResponse({
      availableBookmakers: normalizedAvailable,
      disabledBookmakerKeys: fallbackApplied ? [] : disabledBookmakerKeys,
      fallbackApplied,
      supportedBookmakers,
    }),
    success: true,
  }
}

module.exports = {
  ALL_DISABLED_WARNING,
  BookmakerPreferencesError,
  buildPreferencesResponse,
  getBookmakerPreferences,
  normalizeAvailableBookmakers,
  normalizeSupportedBookmakers,
  normalizeUpdatePayload,
  updateBookmakerPreferences,
}
