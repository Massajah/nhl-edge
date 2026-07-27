const DEFAULT_HOME_ADJUSTMENT = 0
const HOME_ADJUSTMENT_LIMITS = Object.freeze({
  max: 5,
  min: -5,
})

const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const getRatingHomeAdjustment = (rating) =>
  toFiniteNumber(
    rating?.homeAdjustment ?? rating?.homeAdvantage,
    DEFAULT_HOME_ADJUSTMENT,
  )

const calculateEffectiveHomeAdvantage = ({
  baseHomeAdvantage,
  homeAdjustment,
  homeRating,
}) => {
  const normalizedBaseHomeAdvantage = toFiniteNumber(baseHomeAdvantage, 0)
  const normalizedHomeAdjustment =
    homeAdjustment === undefined
      ? getRatingHomeAdjustment(homeRating)
      : toFiniteNumber(homeAdjustment, DEFAULT_HOME_ADJUSTMENT)

  return {
    baseHomeAdvantage: normalizedBaseHomeAdvantage,
    effectiveHomeAdvantage:
      normalizedBaseHomeAdvantage + normalizedHomeAdjustment,
    homeTeamAdjustment: normalizedHomeAdjustment,
  }
}

module.exports = {
  DEFAULT_HOME_ADJUSTMENT,
  HOME_ADJUSTMENT_LIMITS,
  calculateEffectiveHomeAdvantage,
  getRatingHomeAdjustment,
}
