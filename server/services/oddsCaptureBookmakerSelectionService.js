const BookmakerPreferences = require('../models/BookmakerPreferences')
const User = require('../models/User')
const { getMarketOddsConfig } = require('../config/marketOdds')

const toPlainRows = async (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const createOddsCaptureBookmakerSelectionService = ({
  preferencesModel = BookmakerPreferences,
  userModel = User,
  getConfig = getMarketOddsConfig,
} = {}) => {
  const getSelectedBookmakerKeys = async () => {
    const supported = getConfig().bookmakers.map(({ key }) => key)
    const [users, preferences] = await Promise.all([
      toPlainRows(userModel.find({}, { _id: 1 })),
      toPlainRows(
        preferencesModel.find({}, { disabledBookmakerKeys: 1, userId: 1 }),
      ),
    ])

    if (!Array.isArray(users) || users.length === 0) {
      return supported
    }

    const preferencesByUser = new Map(
      (Array.isArray(preferences) ? preferences : []).map((row) => [
        String(row.userId),
        new Set(row.disabledBookmakerKeys ?? []),
      ]),
    )
    const selected = new Set()

    users.forEach((user) => {
      const disabled = preferencesByUser.get(String(user._id))

      if (!disabled) {
        supported.forEach((key) => selected.add(key))
        return
      }

      supported.forEach((key) => {
        if (!disabled.has(key)) selected.add(key)
      })
    })

    return selected.size > 0
      ? supported.filter((key) => selected.has(key))
      : supported
  }

  return { getSelectedBookmakerKeys }
}

const oddsCaptureBookmakerSelectionService =
  createOddsCaptureBookmakerSelectionService()

module.exports = {
  createOddsCaptureBookmakerSelectionService,
  oddsCaptureBookmakerSelectionService,
}
