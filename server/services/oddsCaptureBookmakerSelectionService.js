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
      toPlainRows(userModel.find({}, { _id: 1, status: 1 })),
      toPlainRows(
        preferencesModel.find({}, { disabledBookmakerKeys: 1, userId: 1 }),
      ),
    ])

    const activeUserIds = new Set(
      (Array.isArray(users) ? users : [])
        .filter((user) => user.status !== 'disabled')
        .map((user) => String(user._id)),
    )
    const selected = new Set()

    ;(Array.isArray(preferences) ? preferences : []).forEach((preference) => {
      if (!activeUserIds.has(String(preference.userId))) return

      const disabled = new Set(preference.disabledBookmakerKeys ?? [])
      supported.forEach((key) => {
        if (!disabled.has(key)) selected.add(key)
      })
    })

    return supported.filter((key) => selected.has(key))
  }

  return { getSelectedBookmakerKeys }
}

const oddsCaptureBookmakerSelectionService =
  createOddsCaptureBookmakerSelectionService()

module.exports = {
  createOddsCaptureBookmakerSelectionService,
  oddsCaptureBookmakerSelectionService,
}
