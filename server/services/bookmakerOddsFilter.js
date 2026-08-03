const { selectBestOdds } = require('./marketOddsProvider')

const collectAvailableBookmakers = (events = []) => {
  const bookmakers = new Map()

  ;(Array.isArray(events) ? events : []).forEach((event) => {
    ;(Array.isArray(event?.bookmakers) ? event.bookmakers : []).forEach(
      (bookmaker) => {
        if (!bookmaker?.bookmakerKey) {
          return
        }

        bookmakers.set(bookmaker.bookmakerKey, {
          bookmakerKey: bookmaker.bookmakerKey,
          bookmakerTitle:
            bookmaker.bookmakerTitle || bookmaker.bookmakerKey,
        })
      },
    )
  })

  return [...bookmakers.values()].sort((left, right) =>
    left.bookmakerTitle.localeCompare(right.bookmakerTitle),
  )
}

const filterMarketOddsForBookmakers = (response, enabledBookmakerKeys = []) => {
  const enabledSet = new Set(enabledBookmakerKeys)

  return {
    ...response,
    games: (Array.isArray(response?.games) ? response.games : []).map((game) => {
      if (!game.marketOdds) {
        return game
      }

      const allBookmakers = (
        Array.isArray(game.marketOdds.bookmakers)
          ? game.marketOdds.bookmakers
          : []
      ).map((bookmaker) => ({
        ...bookmaker,
        enabled: enabledSet.has(bookmaker.bookmakerKey),
      }))
      const enabledBookmakers = allBookmakers.filter(
        (bookmaker) => bookmaker.enabled,
      )
      const awayBest = selectBestOdds(enabledBookmakers, 'away')
      const homeBest = selectBestOdds(enabledBookmakers, 'home')

      return {
        ...game,
        marketOdds: {
          ...game.marketOdds,
          allBookmakers,
          awayBest,
          bookmakers: enabledBookmakers,
          homeBest,
        },
        oddsStatus: awayBest || homeBest ? 'ready' : 'missing',
      }
    }),
  }
}

module.exports = {
  collectAvailableBookmakers,
  filterMarketOddsForBookmakers,
}
