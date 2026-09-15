const BankrollProfile = require('../models/BankrollProfile')
const Bet = require('../models/Bet')
const BookmakerPreferences = require('../models/BookmakerPreferences')
const Injury = require('../models/Injury')
const { getMarketOddsConfig } = require('../config/marketOdds')
const bankrollService = require('./bankrollService')
const betsService = require('./betsService')
const injuriesService = require('./injuriesService')
const { NHL_TEAMS } = require('../../shared/nhlTeams')

const DEMO_SEED_VERSION = 1
const DEMO_SEED_PREFIX = `demo-seed-v${DEMO_SEED_VERSION}`
const DEMO_SEEDED_STARTING_BALANCE = 1000
const DEMO_SEEDED_CURRENT_BALANCE = 994
const DEMO_SEEDED_AVAILABLE_BALANCE = 972

const BET_BLUEPRINTS = Object.freeze([
  ['win', 1.82, 10],
  ['loss', 1.91, 12],
  ['win', 2.05, 10],
  ['loss', 1.76, 8],
  ['win', 1.72, 15],
  ['loss', 2.12, 10],
  ['win', 2.2, 8],
  ['loss', 1.88, 12],
  ['push', 1.95, 10],
  ['win', 1.9, 10],
  ['loss', 2.25, 8],
  ['win', 2.35, 6],
  ['loss', 1.69, 10],
  ['void', 1.86, 12],
  ['win', 1.68, 15],
  ['loss', 2.08, 10],
  ['win', 2, 8],
  ['loss', 1.8, 12],
  ['win', 1.84, 10],
  ['loss', 2.18, 8],
  ['win', 2.15, 8],
  ['loss', 1.74, 8],
  ['pending', 1.93, 10],
  ['pending', 2.1, 12],
])

const INJURY_BLUEPRINTS = Object.freeze([
  ['BOS', 'Demo Skater 01', 'C', 'out', -1.5, 'short-term', true],
  ['COL', 'Demo Skater 02', 'D', 'day-to-day', -0.5, 'short-term', true],
  ['DAL', 'Demo Skater 03', 'RW', 'questionable', -1, 'unknown', true],
  ['EDM', 'Demo Skater 04', 'LW', 'injured-reserve', -2, 'long-term', true],
  ['FLA', 'Demo Skater 05', 'D', 'out', -1, 'short-term', true],
  ['NYR', 'Demo Skater 06', 'C', 'day-to-day', -0.5, 'short-term', true],
  ['TOR', 'Demo Skater 07', 'RW', 'questionable', -2.5, 'unknown', true],
  ['VAN', 'Demo Skater 08', 'LW', 'healthy', 0, 'short-term', false],
  ['VGK', 'Demo Skater 09', 'D', 'healthy', 0, 'long-term', false],
  ['WPG', 'Demo Skater 10', 'C', 'healthy', 0, 'unknown', false],
])

const applySession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query

const getTeam = (index) => NHL_TEAMS[index % NHL_TEAMS.length]

const buildBetPayload = ([result, marketOdds, stake], index) => {
  const away = getTeam(index * 5 + 1)
  let home = getTeam(index * 7 + 10)
  if (home.id === away.id) home = getTeam(index * 7 + 11)
  const selected = index % 2 === 0 ? home : away
  const modelProbability = Number(
    Math.min(0.69, Math.max(0.51, 1 / marketOdds + 0.025)).toFixed(3),
  )
  const scheduledStart = new Date(
    Date.UTC(2025, 0, 5 + index * 4, 0, 30),
  )
  const sportsbook = ['Veikkaus', 'Unibet', 'Coolbet'][index % 3]

  return {
    analyzedAt: new Date(scheduledStart.getTime() - 90 * 60 * 1000),
    awayTeam: {
      abbreviation: away.abbreviation,
      name: away.name,
      teamId: away.id,
    },
    betType: result === 'pending' ? 'moneyline' : '',
    gameId: '',
    homeTeam: {
      abbreviation: home.abbreviation,
      name: home.name,
      teamId: home.id,
    },
    marketOdds,
    marketOddsSource: 'manual',
    modelProbability,
    notes: `Curated demo portfolio · ${DEMO_SEED_PREFIX}`,
    placementId: `${DEMO_SEED_PREFIX}-bet-${String(index + 1).padStart(2, '0')}`,
    result,
    scheduledStart,
    selectedSide: {
      abbreviation: selected.abbreviation,
      homeAway: selected.id === home.id ? 'home' : 'away',
      name: selected.name,
      teamId: selected.id,
    },
    selectedTeam: {
      abbreviation: selected.abbreviation,
      name: selected.name,
      teamId: selected.id,
    },
    sportsbook,
    stake,
    stakeType: 'currency',
  }
}

const buildInjuryPayload = (
  [teamId, playerName, position, status, impact, durationType, active],
  index,
) => ({
  active,
  durationType,
  expectedReturn: active ? `Demo estimate · window ${index + 1}` : 'Returned',
  impact,
  injuryType: active ? 'Demo sample condition' : 'Demo sample history',
  isGoalie: false,
  notes: 'Fictional demo record; not a current injury claim.',
  playerName,
  position,
  status,
  teamId,
})

const seedBankroll = async (userId, options) => {
  const profileModel = options.profileModel ?? BankrollProfile
  const existing = await applySession(
    profileModel.findOne({ userId }),
    options.session,
  )

  if (existing) return false

  await (options.initializeBankroll ?? bankrollService.initializeBankroll)(
    userId,
    {
      currency: 'EUR',
      startDate: '2025-01-01',
      startingBalance: String(DEMO_SEEDED_STARTING_BALANCE),
    },
    { session: options.session },
  )
  return true
}

const seedBets = async (userId, options) => {
  const createBet = options.createBet ?? betsService.createBet

  for (const [index, blueprint] of BET_BLUEPRINTS.entries()) {
    await createBet(userId, buildBetPayload(blueprint, index), {
      session: options.session,
    })
  }
}

const seedInjuries = async (userId, options) => {
  const injuryModel = options.injuryModel ?? Injury
  const createInjury = options.createInjury ?? injuriesService.createInjury

  for (const [index, blueprint] of INJURY_BLUEPRINTS.entries()) {
    const demoSeedKey = `${DEMO_SEED_PREFIX}-injury-${String(index + 1).padStart(2, '0')}`
    const existing = await applySession(
      injuryModel.findOne({ demoSeedKey, userId }),
      options.session,
    )

    if (!existing) {
      await createInjury(userId, buildInjuryPayload(blueprint, index), {
        demoSeedKey,
        maximumPlayerInjuryPenalty: -2.5,
        session: options.session,
      })
    }
  }
}

const seedBookmakerPreferences = async (userId, options) => {
  const preferencesModel =
    options.bookmakerPreferencesModel ?? BookmakerPreferences
  const enabled = new Set(['veikkaus_fi', 'unibet_fi', 'coolbet'])
  const disabledBookmakerKeys = getMarketOddsConfig()
    .bookmakers.map(({ key }) => key)
    .filter((key) => !enabled.has(key))

  await preferencesModel.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: { disabledBookmakerKeys, userId },
    },
    {
      new: true,
      runValidators: true,
      session: options.session,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  )
}

const seedDemoSandbox = async (userId, options = {}) => {
  if (!userId) throw new TypeError('Demo seed requires an exact owner ID.')

  await seedBankroll(userId, options)
  await seedBets(userId, options)
  await seedInjuries(userId, options)
  await seedBookmakerPreferences(userId, options)

  return {
    availableBankroll: DEMO_SEEDED_AVAILABLE_BALANCE,
    betCount: BET_BLUEPRINTS.length,
    currentBankroll: DEMO_SEEDED_CURRENT_BALANCE,
    injuryCount: INJURY_BLUEPRINTS.length,
    seedVersion: DEMO_SEED_VERSION,
    startingBankroll: DEMO_SEEDED_STARTING_BALANCE,
  }
}

module.exports = {
  BET_BLUEPRINTS,
  DEMO_SEEDED_AVAILABLE_BALANCE,
  DEMO_SEEDED_CURRENT_BALANCE,
  DEMO_SEEDED_STARTING_BALANCE,
  DEMO_SEED_PREFIX,
  DEMO_SEED_VERSION,
  INJURY_BLUEPRINTS,
  buildBetPayload,
  buildInjuryPayload,
  seedDemoSandbox,
}
