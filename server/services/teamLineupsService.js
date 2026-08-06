const TeamLineup = require('../models/TeamLineup')
const nhlApiService = require('./nhlApiService')
const { getKnownTeamById } = require('./teamCatalogService')

const FORWARD_LINE_COUNT = 4
const DEFENSE_PAIR_COUNT = 3
const LINEUP_NOTE_MAX_LENGTH = 1500
const FORWARD_SLOT_FIELDS = [
  'leftWingPlayerId',
  'centerPlayerId',
  'rightWingPlayerId',
]
const DEFENSE_SLOT_FIELDS = [
  'leftDefensePlayerId',
  'rightDefensePlayerId',
]
const UPDATE_FIELDS = ['defensePairs', 'forwardLines', 'lineupNote']

class TeamLineupsError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'TeamLineupsError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const assertUserId = (userId) => {
  if (!userId) {
    throw new TeamLineupsError('Authenticated userId is required.', 401)
  }
}

const toText = (value) =>
  typeof value === 'string' ? value.trim() : ''

const asPlainObject = (value) => {
  if (!value) {
    return null
  }

  return typeof value.toJSON === 'function' ? value.toJSON() : { ...value }
}

const createEmptyForwardLines = () =>
  Array.from({ length: FORWARD_LINE_COUNT }, (_item, index) => ({
    lineNumber: index + 1,
    leftWingPlayerId: null,
    centerPlayerId: null,
    rightWingPlayerId: null,
  }))

const createEmptyDefensePairs = () =>
  Array.from({ length: DEFENSE_PAIR_COUNT }, (_item, index) => ({
    pairNumber: index + 1,
    leftDefensePlayerId: null,
    rightDefensePlayerId: null,
  }))

const createEmptyLineup = (teamId) => ({
  createdAt: null,
  defensePairs: createEmptyDefensePairs(),
  forwardLines: createEmptyForwardLines(),
  lineupNote: '',
  teamId,
  updatedAt: null,
})

const normalizePlayerId = (value, field) => {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const playerId = Number(value)

  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    throw new TeamLineupsError(
      `${field} must be a positive integer or null.`,
      400,
      { field },
    )
  }

  return playerId
}

const assertPlainObject = (value, field) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new TeamLineupsError(`${field} must be an object.`, 400, { field })
  }
}

const assertSupportedFields = (value, supportedFields, field) => {
  const unsupportedFields = Object.keys(value).filter(
    (key) => !supportedFields.includes(key),
  )

  if (unsupportedFields.length > 0) {
    throw new TeamLineupsError(
      `${field} contains unsupported fields.`,
      400,
      { field, unsupportedFields },
    )
  }
}

const normalizeNumberedRows = ({
  count,
  numberField,
  rows,
  slotFields,
}) => {
  if (rows === undefined) {
    rows = []
  }

  if (!Array.isArray(rows)) {
    throw new TeamLineupsError(`${numberField}s must be an array.`, 400, {
      field: numberField,
    })
  }

  if (rows.length > count) {
    throw new TeamLineupsError(
      `${numberField}s cannot contain more than ${count} rows.`,
      400,
      { field: numberField },
    )
  }

  const normalizedByNumber = new Map()

  rows.forEach((row, index) => {
    const field = `${numberField}s[${index}]`

    assertPlainObject(row, field)
    assertSupportedFields(row, [numberField, ...slotFields], field)

    const rowNumber = Number(row[numberField])

    if (
      !Number.isSafeInteger(rowNumber) ||
      rowNumber < 1 ||
      rowNumber > count
    ) {
      throw new TeamLineupsError(
        `${field}.${numberField} must be between 1 and ${count}.`,
        400,
        { field: `${field}.${numberField}` },
      )
    }

    if (normalizedByNumber.has(rowNumber)) {
      throw new TeamLineupsError(
        `${numberField} ${rowNumber} is duplicated.`,
        400,
        { field: `${field}.${numberField}` },
      )
    }

    const normalizedRow = { [numberField]: rowNumber }

    slotFields.forEach((slotField) => {
      normalizedRow[slotField] = normalizePlayerId(
        row[slotField],
        `${field}.${slotField}`,
      )
    })
    normalizedByNumber.set(rowNumber, normalizedRow)
  })

  return Array.from({ length: count }, (_item, index) => {
    const rowNumber = index + 1

    return normalizedByNumber.get(rowNumber) ?? {
      [numberField]: rowNumber,
      ...Object.fromEntries(slotFields.map((field) => [field, null])),
    }
  })
}

const normalizeLineupNote = (value) => {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new TeamLineupsError('lineupNote must be a string.', 400, {
      field: 'lineupNote',
    })
  }

  const lineupNote = toText(value)

  if (lineupNote.length > LINEUP_NOTE_MAX_LENGTH) {
    throw new TeamLineupsError(
      `lineupNote cannot exceed ${LINEUP_NOTE_MAX_LENGTH} characters.`,
      400,
      { field: 'lineupNote' },
    )
  }

  return lineupNote
}

const normalizeUpdatePayload = (payload = {}) => {
  assertPlainObject(payload, 'Request body')
  assertSupportedFields(payload, UPDATE_FIELDS, 'Request body')

  return {
    defensePairs: normalizeNumberedRows({
      count: DEFENSE_PAIR_COUNT,
      numberField: 'pairNumber',
      rows: payload.defensePairs,
      slotFields: DEFENSE_SLOT_FIELDS,
    }),
    forwardLines: normalizeNumberedRows({
      count: FORWARD_LINE_COUNT,
      numberField: 'lineNumber',
      rows: payload.forwardLines,
      slotFields: FORWARD_SLOT_FIELDS,
    }),
    lineupNote: normalizeLineupNote(payload.lineupNote),
  }
}

const requireKnownTeam = async (teamIdentity) => {
  const team = await getKnownTeamById(teamIdentity)

  if (!team) {
    throw new TeamLineupsError(
      'teamId must match a known NHL team.',
      400,
      { field: 'teamId' },
    )
  }

  return team
}

const serializeLineup = (document, teamId) => {
  if (!document) {
    return createEmptyLineup(teamId)
  }

  const lineup = asPlainObject(document)

  return {
    createdAt: lineup.createdAt ?? null,
    defensePairs: normalizeNumberedRows({
      count: DEFENSE_PAIR_COUNT,
      numberField: 'pairNumber',
      rows: lineup.defensePairs,
      slotFields: DEFENSE_SLOT_FIELDS,
    }),
    forwardLines: normalizeNumberedRows({
      count: FORWARD_LINE_COUNT,
      numberField: 'lineNumber',
      rows: lineup.forwardLines,
      slotFields: FORWARD_SLOT_FIELDS,
    }),
    lineupNote: normalizeLineupNote(lineup.lineupNote),
    teamId,
    updatedAt: lineup.updatedAt ?? null,
  }
}

const getModel = (options = {}) =>
  options.teamLineupModel ?? TeamLineup

const getRosterProvider = (options = {}) =>
  options.getRosterForTeam ?? nhlApiService.getRosterForTeam

const getSelectedPlayerIds = (rows, fields) =>
  new Set(
    rows.flatMap((row) => fields.map((field) => row[field])).filter(Boolean),
  )

const getProviderPlayerIds = (players = []) =>
  new Set(
    (Array.isArray(players) ? players : [])
      .map((player) => Number(player.id ?? player.playerId))
      .filter((playerId) => Number.isSafeInteger(playerId) && playerId > 0),
  )

const assertRosterSelections = ({ existing, lineup, roster }) => {
  const forwardIds = getSelectedPlayerIds(
    lineup.forwardLines,
    FORWARD_SLOT_FIELDS,
  )
  const defenseIds = getSelectedPlayerIds(
    lineup.defensePairs,
    DEFENSE_SLOT_FIELDS,
  )
  const providerForwardIds = getProviderPlayerIds(roster?.forwards)
  const providerDefenseIds = getProviderPlayerIds(roster?.defensemen)
  const existingForwardIds = getSelectedPlayerIds(
    existing.forwardLines,
    FORWARD_SLOT_FIELDS,
  )
  const existingDefenseIds = getSelectedPlayerIds(
    existing.defensePairs,
    DEFENSE_SLOT_FIELDS,
  )

  forwardIds.forEach((playerId) => {
    if (providerForwardIds.has(playerId) || existingForwardIds.has(playerId)) {
      return
    }

    const message = providerDefenseIds.has(playerId)
      ? 'A defense-only provider player cannot be saved in a forward slot.'
      : 'Forward slots must use current provider forwards.'

    throw new TeamLineupsError(message, 400, {
      field: 'forwardLines',
      playerId,
    })
  })

  defenseIds.forEach((playerId) => {
    if (providerDefenseIds.has(playerId) || existingDefenseIds.has(playerId)) {
      return
    }

    const message = providerForwardIds.has(playerId)
      ? 'A forward-only provider player cannot be saved in a defense slot.'
      : 'Defense slots must use current provider defensemen.'

    throw new TeamLineupsError(message, 400, {
      field: 'defensePairs',
      playerId,
    })
  })
}

const getTeamLineup = async (userId, teamIdentity, options = {}) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const document = await getModel(options).findOne({
    teamId: team.teamId,
    userId,
  })

  return {
    modelValues: serializeLineup(document, team.teamId),
    teamAbbreviation: team.teamAbbreviation,
    teamId: team.teamId,
    teamName: team.teamName,
  }
}

const saveTeamLineup = async (
  userId,
  teamIdentity,
  payload,
  options = {},
) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const lineup = normalizeUpdatePayload(payload)
  const model = getModel(options)
  const [existingDocument, roster] = await Promise.all([
    model.findOne({ teamId: team.teamId, userId }),
    getRosterProvider(options)(team.teamAbbreviation),
  ])
  const existing = serializeLineup(existingDocument, team.teamId)

  assertRosterSelections({ existing, lineup, roster })

  const filter = { teamId: team.teamId, userId }
  const update = {
    $set: lineup,
    $setOnInsert: filter,
  }
  const updateOptions = {
    new: true,
    runValidators: true,
    setDefaultsOnInsert: true,
    upsert: true,
  }
  let document

  try {
    document = await model.findOneAndUpdate(filter, update, updateOptions)
  } catch (error) {
    if (error?.code !== 11000) {
      throw error
    }

    document = await model.findOneAndUpdate(filter, update, {
      ...updateOptions,
      upsert: false,
    })
  }

  return {
    modelValues: serializeLineup(document, team.teamId),
    success: true,
  }
}

const clearTeamLineup = async (userId, teamIdentity, options = {}) => {
  assertUserId(userId)
  const team = await requireKnownTeam(teamIdentity)
  const result = await getModel(options).deleteOne({
    teamId: team.teamId,
    userId,
  })

  return {
    cleared: Boolean(result?.deletedCount),
    modelValues: createEmptyLineup(team.teamId),
    success: true,
  }
}

module.exports = {
  DEFENSE_PAIR_COUNT,
  DEFENSE_SLOT_FIELDS,
  FORWARD_LINE_COUNT,
  FORWARD_SLOT_FIELDS,
  LINEUP_NOTE_MAX_LENGTH,
  TeamLineupsError,
  assertRosterSelections,
  clearTeamLineup,
  createEmptyLineup,
  getTeamLineup,
  normalizePlayerId,
  normalizeUpdatePayload,
  saveTeamLineup,
  serializeLineup,
}
