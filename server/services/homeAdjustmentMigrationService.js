const PowerRating = require('../models/PowerRating')
const { DEFAULT_HOME_ADJUSTMENT } = require('./homeAdvantageService')

const LEGACY_DEFAULT_HOME_ADVANTAGE = 2.5

const buildLegacyDefaultFilter = () => ({
  homeAdvantage: LEGACY_DEFAULT_HOME_ADVANTAGE,
})

const migrateLegacyDefaultHomeAdjustments = async ({
  confirm = false,
  powerRatingModel = PowerRating,
} = {}) => {
  const filter = buildLegacyDefaultFilter()
  const matchedCount = await powerRatingModel.countDocuments(filter)
  let modifiedCount = 0

  if (confirm && matchedCount > 0) {
    const result = await powerRatingModel.updateMany(filter, {
      $set: {
        homeAdvantage: DEFAULT_HOME_ADJUSTMENT,
      },
    })

    modifiedCount = result.modifiedCount ?? result.nModified ?? 0
  }

  return {
    confirmed: Boolean(confirm),
    field: 'homeAdvantage',
    matchedCount,
    modifiedCount,
    newDefaultHomeAdjustment: DEFAULT_HOME_ADJUSTMENT,
    oldDefaultHomeAdvantage: LEGACY_DEFAULT_HOME_ADVANTAGE,
  }
}

module.exports = {
  LEGACY_DEFAULT_HOME_ADVANTAGE,
  buildLegacyDefaultFilter,
  migrateLegacyDefaultHomeAdjustments,
}
