const TEAM_DEFINITIONS = [
  {
    id: 'ANA',
    name: 'Anaheim Ducks',
    division: 'Pacific',
  },
  {
    id: 'BOS',
    name: 'Boston Bruins',
    division: 'Atlantic',
  },
  {
    id: 'BUF',
    name: 'Buffalo Sabres',
    division: 'Atlantic',
  },
  {
    id: 'CGY',
    name: 'Calgary Flames',
    division: 'Pacific',
  },
  {
    id: 'CAR',
    name: 'Carolina Hurricanes',
    division: 'Metropolitan',
  },
  {
    id: 'CHI',
    name: 'Chicago Blackhawks',
    division: 'Central',
  },
  {
    id: 'COL',
    name: 'Colorado Avalanche',
    division: 'Central',
  },
  {
    id: 'CBJ',
    name: 'Columbus Blue Jackets',
    division: 'Metropolitan',
  },
  {
    id: 'DAL',
    name: 'Dallas Stars',
    division: 'Central',
  },
  {
    id: 'DET',
    name: 'Detroit Red Wings',
    division: 'Atlantic',
  },
  {
    id: 'EDM',
    name: 'Edmonton Oilers',
    division: 'Pacific',
  },
  {
    id: 'FLA',
    name: 'Florida Panthers',
    division: 'Atlantic',
  },
  {
    id: 'LAK',
    name: 'Los Angeles Kings',
    division: 'Pacific',
  },
  {
    id: 'MIN',
    name: 'Minnesota Wild',
    division: 'Central',
  },
  {
    aliases: ['Montréal Canadiens'],
    id: 'MTL',
    name: 'Montreal Canadiens',
    division: 'Atlantic',
  },
  {
    id: 'NSH',
    name: 'Nashville Predators',
    division: 'Central',
  },
  {
    id: 'NJD',
    name: 'New Jersey Devils',
    division: 'Metropolitan',
  },
  {
    id: 'NYI',
    name: 'New York Islanders',
    division: 'Metropolitan',
  },
  {
    id: 'NYR',
    name: 'New York Rangers',
    division: 'Metropolitan',
  },
  {
    id: 'OTT',
    name: 'Ottawa Senators',
    division: 'Atlantic',
  },
  {
    id: 'PHI',
    name: 'Philadelphia Flyers',
    division: 'Metropolitan',
  },
  {
    id: 'PIT',
    name: 'Pittsburgh Penguins',
    division: 'Metropolitan',
  },
  {
    aliases: ['San José Sharks'],
    id: 'SJS',
    name: 'San Jose Sharks',
    division: 'Pacific',
  },
  {
    id: 'SEA',
    name: 'Seattle Kraken',
    division: 'Pacific',
  },
  {
    id: 'STL',
    identityName: 'St Louis Blues',
    name: 'St. Louis Blues',
    division: 'Central',
  },
  {
    id: 'TBL',
    name: 'Tampa Bay Lightning',
    division: 'Atlantic',
  },
  {
    id: 'TOR',
    name: 'Toronto Maple Leafs',
    division: 'Atlantic',
  },
  {
    aliases: ['Utah Hockey Club', 'Utah HC', 'ARI', 'Arizona Coyotes'],
    id: 'UTA',
    name: 'Utah Mammoth',
    division: 'Central',
  },
  {
    id: 'VAN',
    name: 'Vancouver Canucks',
    division: 'Pacific',
  },
  {
    id: 'VGK',
    name: 'Vegas Golden Knights',
    division: 'Pacific',
  },
  {
    id: 'WSH',
    name: 'Washington Capitals',
    division: 'Metropolitan',
  },
  {
    id: 'WPG',
    name: 'Winnipeg Jets',
    division: 'Central',
  },
]

const NHL_TEAMS = TEAM_DEFINITIONS.map(({ division, id, name }) => ({
  id,
  abbreviation: id,
  name,
  division,
}))

const TEAM_IDENTITIES = Object.freeze(
  TEAM_DEFINITIONS.map(({ aliases = [], id, identityName, name }) => [
    id,
    ...new Set([identityName ?? name, name, ...aliases]),
  ]),
)

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

const nhlTeamsApi = {
  NHL_TEAMS,
  TEAM_IDENTITIES,
  getNhlTeamIdentity,
  normalizeTeamText,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = nhlTeamsApi
}

if (typeof globalThis !== 'undefined') {
  globalThis.__NHL_EDGE_NHL_TEAMS__ = nhlTeamsApi
}
