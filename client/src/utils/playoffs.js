const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : ''

const toOptionalInteger = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)

  return Number.isInteger(numberValue) ? numberValue : null
}

const normalizeTeam = (team) => {
  if (!isPlainObject(team)) {
    return null
  }

  const abbreviation = normalizeText(team.abbreviation).toUpperCase()
  const name = normalizeText(team.name)

  if (!abbreviation && !name) {
    return null
  }

  return {
    abbreviation,
    isWinner: Boolean(team.isWinner),
    logo: normalizeText(team.logo),
    name: name || abbreviation,
    providerTeamId: toOptionalInteger(team.providerTeamId),
    seed: normalizeText(team.seed),
    teamId: normalizeText(team.teamId),
    wins: toOptionalInteger(team.wins),
  }
}

const normalizeSeries = (series = {}) => ({
  bestOf: toOptionalInteger(series.bestOf),
  conference: normalizeText(series.conference),
  higherSeedTeam: normalizeTeam(series.higherSeedTeam),
  id: normalizeText(series.id),
  lowerSeedTeam: normalizeTeam(series.lowerSeedTeam),
  providerSeriesId: normalizeText(series.providerSeriesId),
  round: toOptionalInteger(series.round),
  roundName: normalizeText(series.roundName),
  status: normalizeText(series.status),
  winner: normalizeTeam(series.winner),
  winnerTeamId: normalizeText(series.winnerTeamId),
})

const normalizeConference = (conference) => {
  if (!isPlainObject(conference)) {
    return null
  }

  return {
    id: normalizeText(conference.id),
    name: normalizeText(conference.name),
    rounds: (Array.isArray(conference.rounds) ? conference.rounds : []).map(
      (round) => ({
        id: normalizeText(round.id),
        label: normalizeText(round.label),
        number: toOptionalInteger(round.number),
        series: (Array.isArray(round.series) ? round.series : []).map(
          normalizeSeries,
        ),
      }),
    ),
  }
}

export const normalizePlayoffResponse = (data = {}) => {
  if (!isPlainObject(data) || !normalizeText(data.selectedSeasonId)) {
    throw new Error('Playoff response was malformed.')
  }

  return {
    champion: normalizeTeam(data.champion),
    conferences: isPlainObject(data.conferences)
      ? {
          eastern: normalizeConference(data.conferences.eastern),
          western: normalizeConference(data.conferences.western),
        }
      : null,
    currentSeasonId: normalizeText(data.currentSeasonId),
    error: isPlainObject(data.error)
      ? {
          code: normalizeText(data.error.code),
          message: normalizeText(data.error.message),
        }
      : null,
    mode: normalizeText(data.mode),
    provider: isPlainObject(data.provider) ? { ...data.provider } : null,
    season: isPlainObject(data.season) ? { ...data.season } : null,
    selectedSeasonId: normalizeText(data.selectedSeasonId),
    stanleyCupFinal: isPlainObject(data.stanleyCupFinal)
      ? normalizeSeries(data.stanleyCupFinal)
      : null,
    status: normalizeText(data.status),
  }
}

export const getSeriesSummary = (series = {}) => {
  const top = series.higherSeedTeam
  const bottom = series.lowerSeedTeam

  if (!top || !bottom) {
    return 'Matchup TBD'
  }

  if (series.status === 'projected') {
    return 'Projected matchup'
  }

  if (series.status === 'complete' && series.winner) {
    const loser = series.winner.teamId === top.teamId ? bottom : top

    return `${series.winner.abbreviation} wins ${series.winner.wins}–${loser.wins}`
  }

  if (series.status === 'active') {
    if (top.wins === bottom.wins) {
      return `Series tied ${top.wins}–${bottom.wins}`
    }

    const leader = top.wins > bottom.wins ? top : bottom
    const trailer = leader === top ? bottom : top

    return `${leader.abbreviation} leads ${leader.wins}–${trailer.wins}`
  }

  return 'Series not started'
}

export const getSeriesAccessibilityLabel = (series = {}) => {
  const top = series.higherSeedTeam
  const bottom = series.lowerSeedTeam
  const topLabel = top
    ? `${top.name}, ${top.wins ?? 'no series score'}`
    : 'Team to be determined'
  const bottomLabel = bottom
    ? `${bottom.name}, ${bottom.wins ?? 'no series score'}`
    : 'Team to be determined'

  return `${topLabel} versus ${bottomLabel}. ${getSeriesSummary(series)}.`
}
