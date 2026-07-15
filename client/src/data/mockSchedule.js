const MOCK_GAME_IDS = {
  oilersStars: 2026020001,
  panthersLightning: 2026020002,
  mapleLeafsBruins: 2026020003,
}

const logoUrl = (abbreviation) =>
  `https://assets.nhle.com/logos/nhl/svg/${abbreviation}_light.svg`

const toDateValue = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const futureStartTime = (hoursFromNow) =>
  new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()

const createTeam = (name, abbreviation) => ({
  abbreviation,
  logo: logoUrl(abbreviation),
  name,
  score: null,
})

const createMockGame = ({
  awayTeam,
  gameId,
  homeTeam,
  hoursFromNow,
}) => ({
  gameId,
  startTimeUTC: futureStartTime(hoursFromNow),
  homeTeam,
  awayTeam,
  gameState: 'FUT',
  status: 'Scheduled',
})

export const getMockSchedule = (date = toDateValue(new Date())) => ({
  date,
  games: [
    createMockGame({
      awayTeam: createTeam('Edmonton Oilers', 'EDM'),
      gameId: MOCK_GAME_IDS.oilersStars,
      homeTeam: createTeam('Dallas Stars', 'DAL'),
      hoursFromNow: 4,
    }),
    createMockGame({
      awayTeam: createTeam('Florida Panthers', 'FLA'),
      gameId: MOCK_GAME_IDS.panthersLightning,
      homeTeam: createTeam('Tampa Bay Lightning', 'TBL'),
      hoursFromNow: 5,
    }),
    createMockGame({
      awayTeam: createTeam('Toronto Maple Leafs', 'TOR'),
      gameId: MOCK_GAME_IDS.mapleLeafsBruins,
      homeTeam: createTeam('Boston Bruins', 'BOS'),
      hoursFromNow: 6,
    }),
  ],
})
