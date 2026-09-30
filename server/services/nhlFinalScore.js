const parseNhlScore = (value) => {
  if (
    value === null ||
    value === undefined ||
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !/^\d+$/.test(value.trim()))
  ) {
    return null
  }

  const score = Number(value)
  return Number.isSafeInteger(score) && score >= 0 ? score : null
}

const getValidFinalScore = (game = {}) => {
  const home = parseNhlScore(game.homeTeam?.score)
  const away = parseNhlScore(game.awayTeam?.score)

  return home === null || away === null ? null : { home, away }
}

module.exports = { getValidFinalScore, parseNhlScore }
