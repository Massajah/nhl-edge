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

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

export const normalizeInjurySummary = (summary = []) => {
  const summaryByTeamId = new Map(
    (Array.isArray(summary) ? summary : []).map((teamSummary) => [
      normalizeIdentifier(teamSummary.teamId),
      {
        teamId: normalizeIdentifier(teamSummary.teamId),
        teamName: teamSummary.teamName ?? '',
        teamAbbreviation: normalizeIdentifier(teamSummary.teamAbbreviation),
        activeInjuries: toNumber(teamSummary.activeInjuries),
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
      totalImpact: 0,
    }
  )
}

export const formatInjuryImpact = (value) => toNumber(value).toFixed(1)

export const normalizeInjury = (injury = {}) => ({
  id: injury.id ?? '',
  teamId: normalizeIdentifier(injury.teamId),
  teamName: injury.teamName ?? '',
  teamAbbreviation: normalizeIdentifier(injury.teamAbbreviation),
  playerName: injury.playerName ?? '',
  status: injury.status ?? 'out',
  injuryType: injury.injuryType ?? '',
  impact: toNumber(injury.impact),
  durationType: injury.durationType ?? 'unknown',
  expectedReturn: injury.expectedReturn ?? '',
  notes: injury.notes ?? '',
  active: injury.active ?? true,
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
