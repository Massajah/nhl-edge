export const formatRatingLabCandidateType = (candidateType) => ({
  BASELINE: 'Baseline',
  BASE_MODEL: 'Base Model',
  COMBINED: 'Combined Candidate',
  QUICK_REMATCH: 'Quick Rematch',
  REST_FATIGUE: 'Rest & Fatigue',
  SPECIAL_TEAMS: 'Special Teams',
  TEAM_HOME_ADVANTAGE: 'Team Home Advantage',
}[candidateType] ?? candidateType)

export const formatRatingLabPromotionValue = (path, value) => {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled'
  if (path === 'quickRematchMaximumDays') return `${value} days`
  if (path === 'specialTeamsMode') {
    return String(value ?? '')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  if (Number.isFinite(Number(value))) {
    const number = Number(value)
    return `${number > 0 ? '+' : ''}${number.toFixed(2)}`
  }
  return String(value ?? '—')
}
