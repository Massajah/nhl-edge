const TEAM_IDENTITIES = Object.freeze([
  ['ANA', 'Anaheim Ducks'],
  ['BOS', 'Boston Bruins'],
  ['BUF', 'Buffalo Sabres'],
  ['CGY', 'Calgary Flames'],
  ['CAR', 'Carolina Hurricanes'],
  ['CHI', 'Chicago Blackhawks'],
  ['COL', 'Colorado Avalanche'],
  ['CBJ', 'Columbus Blue Jackets'],
  ['DAL', 'Dallas Stars'],
  ['DET', 'Detroit Red Wings'],
  ['EDM', 'Edmonton Oilers'],
  ['FLA', 'Florida Panthers'],
  ['LAK', 'Los Angeles Kings'],
  ['MIN', 'Minnesota Wild'],
  ['MTL', 'Montreal Canadiens', 'Montréal Canadiens'],
  ['NSH', 'Nashville Predators'],
  ['NJD', 'New Jersey Devils'],
  ['NYI', 'New York Islanders'],
  ['NYR', 'New York Rangers'],
  ['OTT', 'Ottawa Senators'],
  ['PHI', 'Philadelphia Flyers'],
  ['PIT', 'Pittsburgh Penguins'],
  ['SJS', 'San Jose Sharks', 'San José Sharks'],
  ['SEA', 'Seattle Kraken'],
  ['STL', 'St Louis Blues', 'St. Louis Blues'],
  ['TBL', 'Tampa Bay Lightning'],
  ['TOR', 'Toronto Maple Leafs'],
  ['UTA', 'Utah Mammoth', 'Utah Hockey Club', 'Utah HC'],
  ['VAN', 'Vancouver Canucks'],
  ['VGK', 'Vegas Golden Knights'],
  ['WSH', 'Washington Capitals'],
  ['WPG', 'Winnipeg Jets'],
])

const normalizeTeamText = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const TEAM_ALIAS_INDEX = new Map()

TEAM_IDENTITIES.forEach(([identity, ...aliases]) => {
  ;[identity, ...aliases].forEach((alias) => {
    TEAM_ALIAS_INDEX.set(normalizeTeamText(alias), identity)
  })
})

const getNhlTeamIdentity = (...values) => {
  for (const value of values) {
    const identity = TEAM_ALIAS_INDEX.get(normalizeTeamText(value))

    if (identity) {
      return identity
    }
  }

  return null
}

module.exports = {
  TEAM_IDENTITIES,
  getNhlTeamIdentity,
  normalizeTeamText,
}
