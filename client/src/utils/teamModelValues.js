export const FORWARD_LINE_COUNT = 4
export const DEFENSE_PAIR_COUNT = 3
export const LINEUP_NOTE_MAX_LENGTH = 1500
export const FORWARD_SLOT_FIELDS = [
  'leftWingPlayerId',
  'centerPlayerId',
  'rightWingPlayerId',
]
export const DEFENSE_SLOT_FIELDS = [
  'leftDefensePlayerId',
  'rightDefensePlayerId',
]
export const FORWARD_SNAPSHOT_FIELDS = {
  leftWingPlayerId: 'leftWingDisplayNameSnapshot',
  centerPlayerId: 'centerDisplayNameSnapshot',
  rightWingPlayerId: 'rightWingDisplayNameSnapshot',
}
export const DEFENSE_SNAPSHOT_FIELDS = {
  leftDefensePlayerId: 'leftDefenseDisplayNameSnapshot',
  rightDefensePlayerId: 'rightDefenseDisplayNameSnapshot',
}

const toPlayerId = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const playerId = Number(value)

  return Number.isSafeInteger(playerId) && playerId > 0 ? playerId : null
}

export const createEmptyForwardLines = () =>
  Array.from({ length: FORWARD_LINE_COUNT }, (_item, index) => ({
    centerPlayerId: null,
    centerDisplayNameSnapshot: '',
    leftWingPlayerId: null,
    leftWingDisplayNameSnapshot: '',
    lineNumber: index + 1,
    rightWingPlayerId: null,
    rightWingDisplayNameSnapshot: '',
  }))

export const createEmptyDefensePairs = () =>
  Array.from({ length: DEFENSE_PAIR_COUNT }, (_item, index) => ({
    leftDefensePlayerId: null,
    leftDefenseDisplayNameSnapshot: '',
    pairNumber: index + 1,
    rightDefensePlayerId: null,
    rightDefenseDisplayNameSnapshot: '',
  }))

const normalizeRows = ({
  count,
  numberField,
  rows,
  snapshotFields,
  slotFields,
}) => {
  const rowsByNumber = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      Number(row?.[numberField]),
      row,
    ]),
  )

  return Array.from({ length: count }, (_item, index) => {
    const rowNumber = index + 1
    const row = rowsByNumber.get(rowNumber) ?? {}
    const normalized = { [numberField]: rowNumber }

    slotFields.forEach((field) => {
      normalized[field] = toPlayerId(row[field])
      const snapshotField = snapshotFields[field]

      normalized[snapshotField] = normalized[field] &&
        typeof row[snapshotField] === 'string'
        ? row[snapshotField].trim()
        : ''
    })

    return normalized
  })
}

export const normalizeTeamModelValues = (modelValues = {}, teamId = '') => ({
  createdAt: modelValues?.createdAt ?? null,
  defensePairs: normalizeRows({
    count: DEFENSE_PAIR_COUNT,
    numberField: 'pairNumber',
    rows: modelValues?.defensePairs,
    snapshotFields: DEFENSE_SNAPSHOT_FIELDS,
    slotFields: DEFENSE_SLOT_FIELDS,
  }),
  forwardLines: normalizeRows({
    count: FORWARD_LINE_COUNT,
    numberField: 'lineNumber',
    rows: modelValues?.forwardLines,
    snapshotFields: FORWARD_SNAPSHOT_FIELDS,
    slotFields: FORWARD_SLOT_FIELDS,
  }),
  lineupNote:
    typeof modelValues?.lineupNote === 'string'
      ? modelValues.lineupNote
      : '',
  teamId: modelValues?.teamId ?? teamId,
  updatedAt: modelValues?.updatedAt ?? null,
})

export const getTeamModelValuesPayload = (modelValues) => {
  const normalized = normalizeTeamModelValues(modelValues, modelValues?.teamId)
  const getSelectionRows = (
    rows,
    numberField,
    slotFields,
    snapshotFields,
  ) =>
    rows.map((row) => ({
      [numberField]: row[numberField],
      ...Object.fromEntries(slotFields.flatMap((field) => [
        [field, row[field]],
        [snapshotFields[field], row[snapshotFields[field]]],
      ])),
    }))

  return {
    defensePairs: getSelectionRows(
      normalized.defensePairs,
      'pairNumber',
      DEFENSE_SLOT_FIELDS,
      DEFENSE_SNAPSHOT_FIELDS,
    ),
    forwardLines: getSelectionRows(
      normalized.forwardLines,
      'lineNumber',
      FORWARD_SLOT_FIELDS,
      FORWARD_SNAPSHOT_FIELDS,
    ),
    lineupNote: normalized.lineupNote.trim(),
  }
}

export const isConfiguredRow = (row, slotFields) =>
  slotFields.some((field) => Boolean(toPlayerId(row?.[field])))

export const getConfiguredForwardLines = (modelValues) =>
  normalizeTeamModelValues(modelValues).forwardLines.filter((line) =>
    isConfiguredRow(line, FORWARD_SLOT_FIELDS),
  )

export const getConfiguredDefensePairs = (modelValues) =>
  normalizeTeamModelValues(modelValues).defensePairs.filter((pair) =>
    isConfiguredRow(pair, DEFENSE_SLOT_FIELDS),
  )

export const getDuplicatePlayerIds = (rows, slotFields) => {
  const counts = new Map()

  rows.forEach((row) => {
    slotFields.forEach((field) => {
      const playerId = toPlayerId(row?.[field])

      if (playerId) {
        counts.set(playerId, (counts.get(playerId) ?? 0) + 1)
      }
    })
  })

  return [...counts.entries()]
    .filter((entry) => entry[1] > 1)
    .map(([playerId]) => playerId)
}

export const getRosterPlayer = (players, playerId) => {
  const normalizedId = toPlayerId(playerId)

  return (Array.isArray(players) ? players : []).find(
    (player) => toPlayerId(player.id ?? player.playerId) === normalizedId,
  ) ?? null
}

export const getPlayerDisplayName = (
  players,
  playerId,
  displayNameSnapshot = '',
) => {
  const normalizedId = toPlayerId(playerId)

  if (!normalizedId) {
    return ''
  }

  const player = getRosterPlayer(players, normalizedId)

  return player?.fullName || player?.playerName || displayNameSnapshot ||
    `Unavailable player · ID ${normalizedId}`
}

export const formatPlayerOption = (player) => {
  const details = [
    player?.position,
    player?.sweaterNumber ? `#${player.sweaterNumber}` : '',
  ].filter(Boolean)
  const name = player?.fullName || player?.playerName || 'Unknown player'

  return details.length > 0 ? `${name} · ${details.join(' · ')}` : name
}

export const formatModelValuesUpdatedDate = (value) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date)
}
