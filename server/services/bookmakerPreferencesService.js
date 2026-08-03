const BookmakerPreferences = require('../models/BookmakerPreferences')

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
    })
  })

  return [...indexed.values()].sort((left, right) =>
    left.bookmakerTitle.localeCompare(right.bookmakerTitle),
  )
}

const normalizeDisabledKeys = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeBookmakerKey))]
    .filter(Boolean)
    .sort()

const buildPreferencesResponse = ({
  availableBookmakers,
  disabledBookmakerKeys = [],
  fallbackApplied = false,
  usingDefaults = false,
}) => {
  const normalizedAvailable = normalizeAvailableBookmakers(availableBookmakers)
  const availableKeySet = new Set(
    normalizedAvailable.map(({ bookmakerKey }) => bookmakerKey),
  )
  const normalizedDisabled = normalizeDisabledKeys(disabledBookmakerKeys).filter(
    (bookmakerKey) => availableKeySet.has(bookmakerKey),
  )
  const disabledSet = new Set(normalizedDisabled)

  return {
    availableBookmakers: normalizedAvailable,
    disabledBookmakerKeys: normalizedDisabled,
    enabledBookmakerKeys: normalizedAvailable
      .map(({ bookmakerKey }) => bookmakerKey)
      .filter((bookmakerKey) => !disabledSet.has(bookmakerKey)),
    fallbackApplied,
    usingDefaults,
    warning: fallbackApplied ? ALL_DISABLED_WARNING : null,
  }
}

const getPreferencesModel = (options = {}) =>
  options.preferencesModel ?? BookmakerPreferences

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
  const preferencesDocument = await preferencesModel.findOne({ userId })
  let response = buildPreferencesResponse({
    availableBookmakers,
    disabledBookmakerKeys: preferencesDocument?.disabledBookmakerKeys,
    usingDefaults: !preferencesDocument,
  })

  if (
    response.availableBookmakers.length > 0 &&
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

  const normalizedAvailable = normalizeAvailableBookmakers(availableBookmakers)
  const availableKeys = normalizedAvailable.map(
    ({ bookmakerKey }) => bookmakerKey,
  )
  const availableKeySet = new Set(availableKeys)
  const requestedEnabledKeys = normalizeUpdatePayload(payload).filter(
    (bookmakerKey) => availableKeySet.has(bookmakerKey),
  )
  const fallbackApplied =
    normalizedAvailable.length > 0 && requestedEnabledKeys.length === 0
  const effectiveEnabledKeys = fallbackApplied
    ? availableKeys
    : requestedEnabledKeys
  const enabledSet = new Set(effectiveEnabledKeys)
  const currentDisabledBookmakerKeys = availableKeys.filter(
    (bookmakerKey) => !enabledSet.has(bookmakerKey),
  )
  const preferencesModel = getPreferencesModel(options)
  const existingPreferences = fallbackApplied
    ? null
    : await preferencesModel.findOne({ userId })
  const inactiveDisabledBookmakerKeys = normalizeDisabledKeys(
    existingPreferences?.disabledBookmakerKeys,
  ).filter((bookmakerKey) => !availableKeySet.has(bookmakerKey))
  const disabledBookmakerKeys = fallbackApplied
    ? []
    : normalizeDisabledKeys([
        ...inactiveDisabledBookmakerKeys,
        ...currentDisabledBookmakerKeys,
      ])

  await persistDisabledKeys({
    disabledBookmakerKeys,
    preferencesModel,
    userId,
  })

  return {
    preferences: buildPreferencesResponse({
      availableBookmakers: normalizedAvailable,
      disabledBookmakerKeys,
      fallbackApplied,
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
  normalizeUpdatePayload,
  updateBookmakerPreferences,
}
