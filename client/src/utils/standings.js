export const STANDINGS_VIEWS = Object.freeze({
  CONFERENCE: 'conference',
  DIVISION: 'division',
  LEAGUE: 'league',
  PLAYOFFS: 'playoffs',
})

export const STANDINGS_VIEW_OPTIONS = Object.freeze([
  { id: STANDINGS_VIEWS.LEAGUE, label: 'League' },
  { id: STANDINGS_VIEWS.CONFERENCE, label: 'Conference' },
  { id: STANDINGS_VIEWS.DIVISION, label: 'Division' },
  { id: STANDINGS_VIEWS.PLAYOFFS, label: 'Playoffs', type: 'playoffs' },
])

export const DEFAULT_CLINCH_INDICATORS = Object.freeze([
  Object.freeze({ code: 'x', label: 'Clinched playoff berth' }),
  Object.freeze({ code: 'y', label: 'Clinched division title' }),
  Object.freeze({ code: 'z', label: 'Clinched conference title' }),
  Object.freeze({ code: 'p', label: "Clinched Presidents' Trophy" }),
  Object.freeze({ code: 'e', label: 'Eliminated from playoff contention' }),
])

const CONFERENCE_ORDER = Object.freeze(['Eastern', 'Western'])
const DIVISION_ORDER = Object.freeze([
  'Atlantic',
  'Metropolitan',
  'Central',
  'Pacific',
])

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const toOptionalInteger = (value) => {
  const numberValue = toOptionalNumber(value)

  return Number.isInteger(numberValue) ? numberValue : null
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : ''

const normalizeSeason = (season = {}) => ({
  endDate: normalizeText(season.endDate),
  id: normalizeText(season.id),
  isCurrent: Boolean(season.isCurrent),
  label: normalizeText(season.label),
  startDate: normalizeText(season.startDate),
})

const normalizeClinchIndicator = (indicator = {}) => ({
  code: normalizeText(indicator.code).toLowerCase(),
  label: normalizeText(indicator.label),
})

const normalizeStanding = (standing = {}) => ({
  clinchIndicator: normalizeText(standing.clinchIndicator),
  conference: normalizeText(standing.conference),
  conferenceRank: toOptionalInteger(standing.conferenceRank),
  division: normalizeText(standing.division),
  divisionRank: toOptionalInteger(standing.divisionRank),
  gamesPlayed: toOptionalInteger(standing.gamesPlayed),
  goalDifferential: toOptionalInteger(standing.goalDifferential),
  goalsAgainst: toOptionalInteger(standing.goalsAgainst),
  goalsFor: toOptionalInteger(standing.goalsFor),
  last10Record: normalizeText(standing.last10Record),
  losses: toOptionalInteger(standing.losses),
  officialRank: toOptionalInteger(standing.officialRank),
  overtimeLosses: toOptionalInteger(standing.overtimeLosses),
  pointPercentage: toOptionalNumber(standing.pointPercentage),
  points: toOptionalInteger(standing.points),
  regulationPlusOvertimeWins: toOptionalInteger(
    standing.regulationPlusOvertimeWins,
  ),
  regulationWins: toOptionalInteger(standing.regulationWins),
  streak: normalizeText(standing.streak),
  teamAbbreviation: normalizeText(standing.teamAbbreviation).toUpperCase(),
  teamId: normalizeText(standing.teamId),
  teamLogo: normalizeText(standing.teamLogo),
  teamName: normalizeText(standing.teamName),
  wildcardRank: toOptionalInteger(standing.wildcardRank),
  wins: toOptionalInteger(standing.wins),
})

export const normalizeStandingsResponse = (data = {}) => {
  if (
    !isPlainObject(data) ||
    !Array.isArray(data.seasons) ||
    !Array.isArray(data.standings)
  ) {
    throw new Error('Standings response was malformed.')
  }

  return {
    clinchIndicators: (
      Array.isArray(data.clinchIndicators)
        ? data.clinchIndicators
        : DEFAULT_CLINCH_INDICATORS
    )
      .map(normalizeClinchIndicator)
      .filter((indicator) => indicator.code && indicator.label),
    currentSeasonId: normalizeText(data.currentSeasonId),
    error: isPlainObject(data.error)
      ? {
          code: normalizeText(data.error.code),
          message: normalizeText(data.error.message),
        }
      : null,
    provider: isPlainObject(data.provider) ? { ...data.provider } : null,
    season: normalizeSeason(data.season),
    seasons: data.seasons.map(normalizeSeason).filter((season) => season.id),
    selectedSeasonId: normalizeText(data.selectedSeasonId),
    standings: data.standings
      .map(normalizeStanding)
      .filter((standing) => standing.teamAbbreviation),
    status: normalizeText(data.status),
  }
}

export const getClinchIndicatorBadges = (
  value,
  indicators = DEFAULT_CLINCH_INDICATORS,
) => {
  const definitions = new Map(
    indicators.map((indicator) => [
      normalizeText(indicator.code).toLowerCase(),
      normalizeText(indicator.label),
    ]),
  )
  const codes = [
    ...new Set(
      normalizeText(value)
        .toLowerCase()
        .match(/[a-z0-9]/g) ?? [],
    ),
  ]

  return codes.map((code) => ({
    code,
    label: definitions.get(code) || `Official NHL status indicator “${code}”`,
    supported: definitions.has(code),
  }))
}

export const formatStandingsNumber = (value) =>
  Number.isFinite(value) ? String(value) : '—'

export const formatPointPercentage = (value) =>
  Number.isFinite(value)
    ? value.toFixed(3).replace(/^0/, '')
    : '—'

export const formatGoalDifferential = (value) => {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return value > 0 ? `+${value}` : String(value)
}

const sortByRank = (rows, rankField) =>
  [...rows].sort(
    (left, right) =>
      (left[rankField] ?? Number.POSITIVE_INFINITY) -
        (right[rankField] ?? Number.POSITIVE_INFINITY) ||
      left.teamName.localeCompare(right.teamName),
  )

const buildSections = ({ names, rankField, rows, valueField }) =>
  names
    .map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      rankField,
      rows: sortByRank(
        rows.filter((row) => row[valueField] === name),
        rankField,
      ),
      title: valueField === 'conference' ? `${name} Conference` : name,
    }))
    .filter((section) => section.rows.length > 0)

export const getStandingsSections = (
  rows = [],
  view = STANDINGS_VIEWS.CONFERENCE,
) => {
  if (view === STANDINGS_VIEWS.LEAGUE) {
    return [
      {
        id: 'league',
        rankField: 'officialRank',
        rows: sortByRank(rows, 'officialRank'),
        title: 'NHL',
      },
    ]
  }

  if (view === STANDINGS_VIEWS.DIVISION) {
    return buildSections({
      names: DIVISION_ORDER,
      rankField: 'divisionRank',
      rows,
      valueField: 'division',
    })
  }

  return buildSections({
    names: CONFERENCE_ORDER,
    rankField: 'conferenceRank',
    rows,
    valueField: 'conference',
  })
}
