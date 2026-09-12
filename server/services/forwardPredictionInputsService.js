const PowerRating = require('../models/PowerRating')
const GameContext = require('../models/GameContext')
const nhl = require('./nhlApiService')
const { getRatingEngineSettings } = require('./ratingEngineSettingsService')
const { getQuickRematchSettings } = require('./quickRematchSettingsService')
const { getTeamInjurySummary } = require('./injuriesService')
const { calculateGameContextForGame, normalizeGame } = require('./gameContextRules')
const { loadScheduleGamesForContext } = require('./gameContextService')
const { getGameIdentity } = require('./forwardPredictionContracts')

// One loader per cron run: share public provider requests, never cache private user inputs across users/runs.
const createForwardPredictionInputsService = ({ ratingModel = PowerRating, contextModel = GameContext,
  getSettings = getRatingEngineSettings, getScheduleSettings = getQuickRematchSettings,
  getInjuries = getTeamInjurySummary, provider = nhl } = {}) => {
  const ranges = new Map()
  let specialTeamsPromise
  const scheduleProvider = (from, to) => {
    const key = `${from}/${to}`
    if (!ranges.has(key)) ranges.set(key,
      provider.getScheduleGamesForDateRange(from, to, { includeProviderState: true }).then((state) => {
        if (state.stale || !Array.isArray(state.games)) throw new Error('Schedule history unavailable.')
        return state.games
      }))
    return ranges.get(key)
  }
  return {
    async loadUserInputs(userId, games, observedAt) {
      if (!userId) throw new Error('Server-side owner is required.')
      const ratings = await ratingModel.find({ userId }).lean()
      const ratedTeams = new Set(ratings.filter((rating) => rating.baseRating != null &&
        rating.baseRating !== '' && Number.isFinite(Number(rating.baseRating))).map((rating) => rating.teamId))
      if (!games.some((game) => {
        const identity = getGameIdentity(game)
        return identity && ratedTeams.has(identity.homeTeamId) && ratedTeams.has(identity.awayTeamId)
      })) return { ratings, contexts: new Map() }
      const [{ settings }, { settings: scheduleSettings }, injuries, storedContexts] = await Promise.all([
        getSettings(userId), getScheduleSettings(userId),
        // A database failure must retry, not silently replace potentially known injuries with zero.
        getInjuries(userId),
        contextModel.find({ userId, gameId: { $in: games.map((game) => String(game.gameId ?? game.id)) } }).lean(),
      ])
      const normalizedGames = games.map(normalizeGame)
      const { scheduleGames, scheduleError } = await loadScheduleGamesForContext(normalizedGames, scheduleSettings,
        { getScheduleGamesForDateRange: scheduleProvider })
      if (settings.specialTeamsMode === 'automatic' && !specialTeamsPromise) {
        specialTeamsPromise = provider.getLeagueSpecialTeamsMatchupData({ includeProviderState: true })
          .then((state) => state?.stale ? null : state?.data ?? null).catch(() => null)
      }
      const specialTeams = settings.specialTeamsMode === 'automatic' ? await specialTeamsPromise : null
      const contexts = new Map(normalizedGames.map((game) => {
        const stored = storedContexts.find((row) => row.gameId === game.gameId &&
          +new Date(row.scheduledStart) === +game.scheduledStart) ?? {}
        const context = calculateGameContextForGame({ currentGame: game,
          homeScheduleGames: scheduleGames, awayScheduleGames: scheduleGames,
          existingContext: stored, quickRematchSettings: scheduleSettings, now: observedAt })
        // Keep provenance: legacy normalization can otherwise substitute a manual override
        // for a missing team-default goalie adjustment.
        context.goalieSelections = stored.goalieSelections ?? {}
        if (scheduleError) {
          for (const side of ['home', 'away']) context[`${side}Context`].dataStatus = 'unavailable'
        }
        return [game.gameId, context]
      }))
      return { ratings, settings, scheduleSettings, specialTeams, contexts,
        injurySummaries: Object.fromEntries(injuries.map((summary) => [summary.teamId, summary])) }
    },
  }
}

module.exports = { createForwardPredictionInputsService }
