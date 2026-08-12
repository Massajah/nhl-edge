const CANONICAL_SEASON_ID_PATTERN = /^(\d{4})(\d{4})$/
const DISPLAY_SEASON_ID_PATTERN = /^(\d{4})[-\u2013\u2014](\d{2}|\d{4})$/

const buildSeasonId = (startYear) =>
  Number.isInteger(startYear) ? `${startYear}${startYear + 1}` : ''

const normalizeSeasonId = (seasonId) => {
  const value = String(seasonId ?? '').trim()
  const canonicalMatch = value.match(CANONICAL_SEASON_ID_PATTERN)

  if (canonicalMatch) {
    const startYear = Number(canonicalMatch[1])
    const endYear = Number(canonicalMatch[2])

    return endYear === startYear + 1 ? buildSeasonId(startYear) : ''
  }

  const displayMatch = value.match(DISPLAY_SEASON_ID_PATTERN)

  if (!displayMatch) {
    return ''
  }

  const startYear = Number(displayMatch[1])
  const rawEndYear = displayMatch[2]
  const shortEndYear = Math.floor(startYear / 100) * 100 + Number(rawEndYear)
  const endYear = rawEndYear.length === 2
    ? shortEndYear <= startYear
      ? shortEndYear + 100
      : shortEndYear
    : Number(rawEndYear)

  return endYear === startYear + 1 ? buildSeasonId(startYear) : ''
}

const getSeasonStartYear = (seasonId) => {
  const normalizedSeasonId = normalizeSeasonId(seasonId)

  return normalizedSeasonId ? Number(normalizedSeasonId.slice(0, 4)) : null
}

const getSeasonLabel = (seasonId) => {
  const startYear = getSeasonStartYear(seasonId)

  if (!Number.isInteger(startYear)) {
    return ''
  }

  return `${startYear}\u2013${String(startYear + 1).slice(-2)}`
}

module.exports = {
  CANONICAL_SEASON_ID_PATTERN,
  buildSeasonId,
  getSeasonLabel,
  getSeasonStartYear,
  normalizeSeasonId,
}
