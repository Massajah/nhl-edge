const Bet = require('../models/Bet')
const ForwardPredictionSnapshot = require('../models/ForwardPredictionSnapshot')
const HistoricalNhlGame = require('../models/HistoricalNhlGame')
const OddsClosingMarket = require('../models/OddsClosingMarket')
const OddsSnapshot = require('../models/OddsSnapshot')
const { ODDS_SNAPSHOT_TYPES } = require('./oddsSnapshotContracts')

const resolveLean = (query) =>
  typeof query?.lean === 'function' ? query.lean() : query

const predictionProjection = {
  _id: 0,
  adjustments: 1,
  awayFairOdds: 1,
  awayTeamId: 1,
  awayWinProbability: 1,
  calculationContractVersion: 1,
  completeness: 1,
  gameId: 1,
  gameType: 1,
  generatedAt: 1,
  homeFairOdds: 1,
  homeTeamId: 1,
  homeWinProbability: 1,
  modelState: 1,
  modelVersion: 1,
  predictionDefinition: 1,
  scheduledStartAtCapture: 1,
  seasonId: 1,
  settingsFingerprint: 1,
  targetAt: 1,
}

const buildPredictionFilter = ({
  endExclusive,
  modelVersion,
  predictionDefinition,
  seasonId,
  start,
  userId,
}) => {
  const filter = { predictionDefinition, seasonId, userId }

  if (modelVersion) filter.modelVersion = modelVersion
  if (start || endExclusive) {
    filter.scheduledStartAtCapture = {}
    if (start) filter.scheduledStartAtCapture.$gte = start
    if (endExclusive) filter.scheduledStartAtCapture.$lt = endExclusive
  }

  return filter
}

const buildBetPeriodFilter = ({ endExclusive, start, userId }) => {
  const filter = { userId }

  if (!start && !endExclusive) return filter

  const dateRange = {}
  if (start) dateRange.$gte = start
  if (endExclusive) dateRange.$lt = endExclusive

  filter.$and = [
    {
      $or: [
        { scheduledStart: dateRange },
        {
          $and: [
            {
              $or: [
                { scheduledStart: null },
                { scheduledStart: { $exists: false } },
              ],
            },
            { analyzedAt: dateRange },
          ],
        },
      ],
    },
  ]

  return filter
}

const createModelPerformanceRepository = ({
  betModel = Bet,
  closingMarketModel = OddsClosingMarket,
  historicalGameModel = HistoricalNhlGame,
  oddsSnapshotModel = OddsSnapshot,
  predictionModel = ForwardPredictionSnapshot,
} = {}) => ({
  async findBets(period) {
    const query = betModel.find(
      buildBetPeriodFilter(period),
      {
        _id: 1,
        analyzedAt: 1,
        awayTeam: 1,
        betType: 1,
        bookmakerKey: 1,
        bookmakerTitle: 1,
        createdAt: 1,
        expectedValue: 1,
        fairOdds: 1,
        gameId: 1,
        homeTeam: 1,
        marketOdds: 1,
        marketOddsSource: 1,
        modelProbability: 1,
        profit: 1,
        probabilityEdge: 1,
        providerName: 1,
        result: 1,
        scheduledStart: 1,
        selectedSide: 1,
        selectedTeam: 1,
        stake: 1,
      },
    )

    return resolveLean(query)
  },

  async findClosingMarkets(gameIds) {
    if (gameIds.length === 0) return []

    return resolveLean(
      closingMarketModel.find(
        { finalizedAt: { $ne: null }, gameId: { $in: gameIds } },
        {
          _id: 0,
          awayTeamId: 1,
          bestFinal: 1,
          finalBookmakers: 1,
          finalizedAt: 1,
          gameId: 1,
          gameType: 1,
          homeTeamId: 1,
          scheduledStartAtCapture: 1,
          seasonId: 1,
        },
      ),
    )
  },

  async findCaptureHealthClosingMarkets(gameIds, seasonId) {
    if (gameIds.length === 0) return []

    return resolveLean(
      closingMarketModel.find(
        {
          finalizedAt: { $ne: null },
          gameId: { $in: gameIds },
          seasonId,
        },
        {
          _id: 0,
          awayTeamId: 1,
          finalBookmakers: 1,
          finalizedAt: 1,
          gameId: 1,
          gameType: 1,
          homeTeamId: 1,
          scheduledStartAtCapture: 1,
          seasonId: 1,
        },
      ),
    )
  },

  async findCaptureHealthSnapshots(gameIds, seasonId) {
    if (gameIds.length === 0) return []

    return resolveLean(
      oddsSnapshotModel.find(
        {
          gameId: { $in: gameIds },
          schemaVersion: 2,
          seasonId,
          snapshotType: {
            $in: [
              ODDS_SNAPSHOT_TYPES.T24,
              ODDS_SNAPSHOT_TYPES.T6,
              ODDS_SNAPSHOT_TYPES.T2,
            ],
          },
        },
        {
          _id: 0,
          awayTeamId: 1,
          capturedAt: 1,
          gameId: 1,
          gameType: 1,
          homeTeamId: 1,
          scheduledStartAtCapture: 1,
          seasonId: 1,
          snapshotType: 1,
        },
      ),
    )
  },

  async findHistoricalGames(gameIds) {
    if (gameIds.length === 0) return []

    return resolveLean(
      historicalGameModel.find(
        { gameId: { $in: gameIds } },
        {
          _id: 0,
          awayScore: 1,
          awayTeamAbbreviation: 1,
          awayTeamId: 1,
          gameId: 1,
          gameState: 1,
          gameType: 1,
          homeScore: 1,
          homeTeamAbbreviation: 1,
          homeTeamId: 1,
          resultType: 1,
          seasonId: 1,
          startTimeUTC: 1,
        },
      ),
    )
  },

  async findLatestModelVersion(filter) {
    let query = predictionModel
      .findOne(buildPredictionFilter(filter), { _id: 0, modelVersion: 1 })
      .sort({ generatedAt: -1, _id: -1 })

    query = resolveLean(query)
    const prediction = await query

    return String(prediction?.modelVersion ?? '').trim() || null
  },

  async findModelVersions(filter) {
    const versions = await predictionModel.distinct(
      'modelVersion',
      buildPredictionFilter({ ...filter, modelVersion: null }),
    )

    return [...new Set(
      versions.map((version) => String(version ?? '').trim()).filter(Boolean),
    )].sort()
  },

  async findPredictions(filter) {
    const query = predictionModel
      .find(buildPredictionFilter(filter), predictionProjection)
      .sort({ scheduledStartAtCapture: -1, gameId: 1 })

    return resolveLean(query)
  },

  async findT2Snapshots(gameIds, seasonId) {
    if (gameIds.length === 0) return []

    const query = oddsSnapshotModel
      .find(
        {
          gameId: { $in: gameIds },
          schemaVersion: 2,
          seasonId,
          snapshotType: ODDS_SNAPSHOT_TYPES.T2,
        },
        {
          _id: 0,
          awayTeamId: 1,
          bookmakers: 1,
          capturedAt: 1,
          gameId: 1,
          gameType: 1,
          homeTeamId: 1,
          scheduledStartAtCapture: 1,
          seasonId: 1,
        },
      )
      .sort({ capturedAt: 1 })

    return resolveLean(query)
  },

  async findTimelineSnapshots(gameIds, seasonId) {
    if (gameIds.length === 0) return []

    const query = oddsSnapshotModel
      .find(
        {
          gameId: { $in: gameIds },
          schemaVersion: 2,
          seasonId,
          snapshotType: {
            $in: [
              ODDS_SNAPSHOT_TYPES.T24,
              ODDS_SNAPSHOT_TYPES.T6,
              ODDS_SNAPSHOT_TYPES.T2,
            ],
          },
        },
        {
          _id: 0,
          awayTeamId: 1,
          bookmakers: 1,
          capturedAt: 1,
          gameId: 1,
          gameType: 1,
          homeTeamId: 1,
          scheduledStartAtCapture: 1,
          seasonId: 1,
          snapshotType: 1,
          targetAt: 1,
        },
      )
      .sort({ capturedAt: 1, snapshotType: 1 })

    return resolveLean(query)
  },
})

const modelPerformanceRepository = createModelPerformanceRepository()

module.exports = {
  buildBetPeriodFilter,
  buildPredictionFilter,
  createModelPerformanceRepository,
  modelPerformanceRepository,
  predictionProjection,
  resolveLean,
}
