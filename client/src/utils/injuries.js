import { NHL_TEAMS } from '../data/teams.js'

export const INJURY_STATUS_OPTIONS = [
  { value: 'out', label: 'Out' },
  { value: 'injured-reserve', label: 'Injured reserve' },
  { value: 'day-to-day', label: 'Day-to-day' },
  { value: 'questionable', label: 'Questionable' },
  { value: 'healthy', label: 'Healthy' },
]

export const INJURY_DURATION_OPTIONS = [
  { value: 'short-term', label: 'Short-term' },
  { value: 'long-term', label: 'Long-term' },
  { value: 'unknown', label: 'Unknown' },
]

export const INJURY_POSITION_OPTIONS = [
  { value: '', label: 'Unknown / not listed' },
  { value: 'C', label: 'Center (C)' },
  { value: 'LW', label: 'Left wing (LW)' },
  { value: 'RW', label: 'Right wing (RW)' },
  { value: 'D', label: 'Defense (D)' },
  { value: 'G', label: 'Goalie (G)' },
]

const POSITION_ALIASES = Object.freeze({
  C: 'C',
  CENTER: 'C',
  CENTRE: 'C',
  D: 'D',
  DEFENSE: 'D',
  DEFENSEMAN: 'D',
  DEFENCEMAN: 'D',
  G: 'G',
  GK: 'G',
  GOALIE: 'G',
  GOALTENDER: 'G',
  L: 'LW',
  LEFT: 'LW',
  LW: 'LW',
  'LEFT WING': 'LW',
  R: 'RW',
  RIGHT: 'RW',
  RW: 'RW',
  'RIGHT WING': 'RW',
})

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

export const normalizeInjuryPosition = (position) =>
  POSITION_ALIASES[normalizeIdentifier(position)] ?? ''

const normalizeProviderPlayerId = (providerPlayerId) => {
  const normalizedId = Number(providerPlayerId)
  return Number.isInteger(normalizedId) && normalizedId > 0
    ? normalizedId
    : null
}

export const normalizeInjurySummaryPlayer = (injury = {}) => {
  const position = normalizeInjuryPosition(injury.position)
  const isGoalie = position === 'G' || injury.isGoalie === true

  return {
    id: injury.id ?? '',
    impact: isGoalie ? 0 : toNumber(injury.impact),
    isGoalie,
    playerName: injury.playerName?.trim() || 'Unknown player',
    position,
    providerPlayerId: normalizeProviderPlayerId(injury.providerPlayerId),
  }
}

export const normalizeInjurySummary = (summary = []) => {
  const summaryByTeamId = new Map(
    (Array.isArray(summary) ? summary : []).map((teamSummary) => [
      normalizeIdentifier(teamSummary.teamId),
      {
        teamId: normalizeIdentifier(teamSummary.teamId),
        teamName: teamSummary.teamName ?? '',
        teamAbbreviation: normalizeIdentifier(teamSummary.teamAbbreviation),
        activeInjuries: toNumber(teamSummary.activeInjuries),
        activeSkaterInjuries: toNumber(teamSummary.activeSkaterInjuries),
        goalieInjuries: toNumber(teamSummary.goalieInjuries),
        injuries: (Array.isArray(teamSummary.injuries)
          ? teamSummary.injuries
          : []
        ).map(normalizeInjurySummaryPlayer),
        totalImpact: toNumber(teamSummary.totalImpact),
      },
    ]),
  )

  return NHL_TEAMS.reduce((normalizedSummary, team) => {
    const teamSummary = summaryByTeamId.get(team.id)

    normalizedSummary[team.id] = {
      teamId: team.id,
      teamName: team.name,
      teamAbbreviation: team.abbreviation,
      activeInjuries: teamSummary?.activeInjuries ?? 0,
      activeSkaterInjuries: teamSummary?.activeSkaterInjuries ?? 0,
      goalieInjuries: teamSummary?.goalieInjuries ?? 0,
      injuries: teamSummary?.injuries ?? [],
      totalImpact: teamSummary?.totalImpact ?? 0,
    }

    return normalizedSummary
  }, {})
}

export const getTeamInjurySummary = (summaryByTeamId = {}, teamId) => {
  const normalizedTeamId = normalizeIdentifier(teamId)

  return (
    summaryByTeamId[normalizedTeamId] ?? {
      teamId: normalizedTeamId,
      teamName: '',
      teamAbbreviation: normalizedTeamId,
      activeInjuries: 0,
      activeSkaterInjuries: 0,
      goalieInjuries: 0,
      injuries: [],
      totalImpact: 0,
    }
  )
}

export const formatInjuryImpact = (value) => toNumber(value).toFixed(1)

export const buildClearHistoryConfirmation = (teamName, recordCount) =>
  `Clear ${teamName} injury history?\n\nThis will permanently delete ${recordCount} historical injury ${recordCount === 1 ? 'record' : 'records'}. Active injuries will not be affected.`

export const normalizeInjury = (injury = {}) => ({
  id: injury.id ?? '',
  teamId: normalizeIdentifier(injury.teamId),
  teamName: injury.teamName ?? '',
  teamAbbreviation: normalizeIdentifier(injury.teamAbbreviation),
  playerName: injury.playerName ?? '',
  providerPlayerId: normalizeProviderPlayerId(injury.providerPlayerId),
  position: normalizeInjuryPosition(injury.position),
  status: injury.status ?? 'out',
  injuryType: injury.injuryType ?? '',
  impact: toNumber(injury.impact),
  durationType: injury.durationType ?? 'unknown',
  expectedReturn: injury.expectedReturn ?? '',
  notes: injury.notes ?? '',
  active: injury.active ?? true,
  isGoalie:
    normalizeInjuryPosition(injury.position) === 'G' ||
    injury.isGoalie === true,
  createdAt: injury.createdAt,
  updatedAt: injury.updatedAt,
})

export const normalizeInjuries = (injuries = []) =>
  (Array.isArray(injuries) ? injuries : [])
    .map(normalizeInjury)
    .sort((injuryA, injuryB) => {
      if (injuryA.active !== injuryB.active) {
        return injuryA.active ? -1 : 1
      }

      const teamComparison = injuryA.teamName.localeCompare(injuryB.teamName)

      return teamComparison || injuryA.playerName.localeCompare(injuryB.playerName)
    })

export const normalizeInjuryRosterPlayers = (roster = {}) =>
  ['forwards', 'defensemen', 'goalies']
    .flatMap((group) => (Array.isArray(roster?.[group]) ? roster[group] : []))
    .map((player) => ({
      fullName: player.fullName || player.playerName || 'Unknown player',
      id: normalizeProviderPlayerId(player.id ?? player.nhlPlayerId),
      position: normalizeInjuryPosition(player.position),
      sweaterNumber: String(player.sweaterNumber ?? '').trim(),
    }))
    .filter((player) => player.id && player.fullName)
    .sort((playerA, playerB) => playerA.fullName.localeCompare(playerB.fullName))

export const filterInjuryRosterPlayers = (players = [], searchTerm = '') => {
  const query = String(searchTerm).trim().toLowerCase()

  if (!query) {
    return players
  }

  return players.filter((player) =>
    [
      player.fullName,
      player.position,
      player.sweaterNumber ? `#${player.sweaterNumber}` : '',
    ].some((value) => String(value).toLowerCase().includes(query)),
  )
}

export const formatInjuryRosterPlayerOption = (player) => {
  const details = [
    player.position || 'Unknown position',
    player.sweaterNumber ? `#${player.sweaterNumber}` : '',
  ].filter(Boolean)

  return `${player.fullName} · ${details.join(' · ')}`
}

export const getInjuryImpactOptions = (maximumPlayerInjuryPenalty = -2.5) => {
  const configuredMaximum = Number(maximumPlayerInjuryPenalty)
  const minimum =
    Number.isFinite(configuredMaximum) && configuredMaximum <= 0
      ? Math.ceil(configuredMaximum * 2) / 2
      : -2.5
  const options = []

  for (let impact = 0; impact >= minimum; impact -= 0.5) {
    options.push(Number(impact.toFixed(2)))
  }

  return options
}

export const isStandardInjuryImpact = (
  impact,
  maximumPlayerInjuryPenalty = -2.5,
) => {
  const value = Number(impact)
  const maximum = Number(maximumPlayerInjuryPenalty)

  return (
    Number.isFinite(value) &&
    value <= 0 &&
    value >= maximum &&
    Number.isInteger(value * 2)
  )
}
