export const HOME_ADVANTAGE_SORT_OPTIONS = Object.freeze([
  { key: 'homePointsAdvantage', label: 'Home P% advantage' },
  { key: 'homeWinAdvantage', label: 'Home W% advantage' },
  { key: 'homePointsPercentage', label: 'Home Points %' },
  { key: 'homeWinPercentage', label: 'Home Win %' },
])

const getSortValue = (team, key) => {
  if (key === 'homePointsPercentage') {
    return team.home?.pointsPercentage
  }

  if (key === 'homeWinPercentage') {
    return team.home?.winPercentage
  }

  return team[key]
}

export const sortHomeAdvantageTeams = (
  teams = [],
  { direction = 'desc', key = 'homePointsAdvantage' } = {},
) =>
  [...teams].sort((left, right) => {
    const leftValue = getSortValue(left, key)
    const rightValue = getSortValue(right, key)
    const leftFinite = Number.isFinite(leftValue)
    const rightFinite = Number.isFinite(rightValue)

    if (leftFinite && rightFinite && leftValue !== rightValue) {
      return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue
    }

    if (leftFinite !== rightFinite) {
      return leftFinite ? -1 : 1
    }

    return left.teamName.localeCompare(right.teamName)
  })

export const formatHomeRate = (value, decimals = 1) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(decimals)}%`
    : '--'

export const formatPercentagePoints = (value, decimals = 1) => {
  if (!Number.isFinite(Number(value))) {
    return '--'
  }

  const percentagePoints = Number(value) * 100
  const sign = percentagePoints > 0 ? '+' : percentagePoints < 0 ? '−' : ''

  return `${sign}${Math.abs(percentagePoints).toFixed(decimals)} pp`
}

export const formatCalibrationMetric = (value, decimals = 5) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '--'

export const formatCalibrationDelta = (value, decimals = 5) => {
  if (!Number.isFinite(Number(value))) {
    return '--'
  }

  const numberValue = Number(value)
  const sign = numberValue > 0 ? '+' : numberValue < 0 ? '−' : ''

  return `${sign}${Math.abs(numberValue).toFixed(decimals)}`
}

export const formatAdjustment = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue)
    ? numberValue === 0
      ? '0.00'
      : `±${numberValue.toFixed(2)}`
    : '--'
}

export const formatSeasonLabel = (seasonId) => {
  const normalized = String(seasonId ?? '').replace(/\D/g, '')

  return /^\d{8}$/.test(normalized)
    ? `${normalized.slice(0, 4)}–${normalized.slice(6)}`
    : String(seasonId ?? '--')
}

export const getDatasetAction = (dataset = {}) => {
  if (dataset.status === 'ready') {
    return { label: 'Refresh dataset', refresh: true }
  }

  if (['partial', 'error'].includes(dataset.status)) {
    return { label: 'Resume', refresh: false }
  }

  return { label: 'Prepare', refresh: false }
}

export const getDatasetStatusLabel = (dataset = {}) => {
  const games = Number(dataset.completedGames ?? dataset.importedGames ?? 0)

  if (dataset.status === 'ready') {
    return `Ready · ${games.toLocaleString()} games`
  }

  if (dataset.status === 'partial') {
    return `Partial · ${games.toLocaleString()} games`
  }

  if (dataset.status === 'error') {
    return `Error · ${games.toLocaleString()} saved games`
  }

  return 'Not prepared'
}

export const validateCustomAdjustment = (value, max = 5) => {
  if (value === '') {
    return ''
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= max
    ? ''
    : `Custom X must be between 0 and ${max}.`
}

export const createHomeAdvantagePayload = (customAdjustment) =>
  customAdjustment === ''
    ? {}
    : { customAdjustment: Number(customAdjustment) }
