const mongoose = require('mongoose')
const Bet = require('../models/Bet')
const bankrollService = require('./bankrollService')
const { COMPLETED_GAME_STATES } = require('./nhlGameEligibility')
const nhlApiService = require('./nhlApiService')

const AUTOMATIC_SETTLEMENT_RESULTS = new Set(['win', 'loss'])
const MANUAL_SETTLEMENT_RESULTS = new Set([
  'pending',
  'win',
  'loss',
  'push',
  'void',
])

class BetSettlementError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message)
    this.name = 'BetSettlementError'
    this.statusCode = statusCode
    this.publicMessage = message
    this.details = details
  }
}

const toObjectIdIfValid = (value) =>
  mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value

const normalizeIdentifier = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : String(value ?? '').trim()

const getBetId = (bet = {}) => bet._id ?? bet.id

const roundMoneyToCents = (value) =>
  Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0

const centsToMoney = (value) => Number((Number(value || 0) / 100).toFixed(2))

const calculateProfitCents = (bet = {}, result = bet.result) => {
  const stakeCents = roundMoneyToCents(bet.stake)
  const odds = Number(bet.marketOdds)

  if (result === 'win' && Number.isFinite(odds) && odds > 1) {
    return Math.round(stakeCents * (odds - 1))
  }

  if (result === 'loss') {
    return -stakeCents
  }

  return 0
}

const calculateReturnCents = (bet = {}, result = bet.result) => {
  const stakeCents = roundMoneyToCents(bet.stake)
  const odds = Number(bet.marketOdds)

  if (result === 'win' && Number.isFinite(odds) && odds > 1) {
    return Math.round(stakeCents * odds)
  }

  if (result === 'void' || result === 'push') {
    return stakeCents
  }

  return 0
}

const getFinancialEffectCents = (bet = {}, result = bet.result) =>
  bet.bankrollAccounting === 'transactional'
    ? calculateReturnCents(bet, result)
    : calculateProfitCents(bet, result)

const getApplicationTransactionType = (bet = {}, result) => {
  if (bet.bankrollAccounting !== 'transactional') {
    return 'BET_SETTLEMENT'
  }

  if (result === 'win') {
    return 'BET_WIN_RETURN'
  }

  if (result === 'void' || result === 'push') {
    return 'BET_VOID_RETURN'
  }

  return 'BET_SETTLEMENT'
}

const buildSettlementFinancialPlan = ({
  bet,
  newResult,
  previousResult,
  source,
  version,
}) => {
  const betId = getBetId(bet)
  const newEffectCents = getFinancialEffectCents(bet, newResult)
  const newProfitCents = calculateProfitCents(bet, newResult)
  const isCorrection = previousResult !== 'pending'
  const commonMetadata = {
    accounting: bet.bankrollAccounting ?? 'legacy',
    isCorrection,
    newResult,
    previousResult,
    settlementSource: source,
    settlementVersion: version,
    stake: Number(bet.stake) || 0,
    marketOdds: Number(bet.marketOdds) || 0,
  }

  if (!isCorrection) {
    return [
      {
        actionKey: `bet:${betId}:settlement:${version}`,
        amountCents: newEffectCents,
        description: `Bet settled as ${newResult}`,
        metadata: {
          ...commonMetadata,
          isSettlementResult: newResult !== 'pending',
          realizedProfitDeltaCents: newProfitCents,
        },
        type: getApplicationTransactionType(bet, newResult),
      },
    ]
  }

  const previousEffectCents = getFinancialEffectCents(bet, previousResult)
  const previousProfitCents = calculateProfitCents(bet, previousResult)

  return [
    {
      actionKey: `bet:${betId}:settlement-reversal:${version}`,
      amountCents: -previousEffectCents,
      description: `Reverse ${previousResult} settlement before correction`,
      metadata: {
        ...commonMetadata,
        isSettlementResult: false,
        realizedProfitDeltaCents: -previousProfitCents,
        reversedResult: previousResult,
      },
      type: 'SETTLEMENT_REVERSAL',
    },
    {
      actionKey: `bet:${betId}:settlement-correction:${version}`,
      amountCents: newEffectCents,
      description:
        newResult === 'pending'
          ? 'Settlement corrected back to pending'
          : `Corrected settlement to ${newResult}`,
      metadata: {
        ...commonMetadata,
        isSettlementResult: newResult !== 'pending',
        realizedProfitDeltaCents: newProfitCents,
      },
      type:
        bet.bankrollAccounting === 'transactional' && newResult === 'win'
          ? 'BET_WIN_RETURN'
          : bet.bankrollAccounting === 'transactional' &&
              (newResult === 'void' || newResult === 'push')
            ? 'BET_VOID_RETURN'
            : 'MANUAL_ADJUSTMENT',
    },
  ]
}

const applySession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query

const findBet = async (betModel, filter, session) =>
  applySession(betModel.findOne(filter), session)

const findOneAndUpdate = async (betModel, filter, update, options = {}) => {
  const query = betModel.findOneAndUpdate(filter, update, {
    new: true,
    runValidators: true,
    session: options.session ?? undefined,
  })

  return applySession(query, options.session)
}

const buildSettlementUpdate = ({
  bet,
  gameMetadata,
  newResult,
  now,
  source,
}) => {
  const isSettled = newResult !== 'pending'
  const update = {
    $inc: {
      settlementVersion: 1,
    },
    $set: {
      finalAwayScore:
        gameMetadata.finalAwayScore ?? bet.finalAwayScore ?? null,
      finalHomeScore:
        gameMetadata.finalHomeScore ?? bet.finalHomeScore ?? null,
      lastSettlementCheckAt: now,
      profit: centsToMoney(calculateProfitCents(bet, newResult)),
      result: newResult,
      settledAt: isSettled ? now : null,
      settledGameId:
        gameMetadata.settledGameId ?? bet.settledGameId ?? '',
      settlementCheckStatus: isSettled ? 'settled' : '',
      settlementIssue: '',
      settlementReturn: centsToMoney(calculateReturnCents(bet, newResult)),
      settlementSource: isSettled ? source : null,
    },
  }

  if (bet.result !== 'pending') {
    update.$push = {
      settlementCorrections: {
        correctedAt: now,
        newResult,
        previousResult: bet.result,
        source,
      },
    }
  }

  return update
}

const rollbackUntransactionalSettlement = async ({
  bet,
  betModel,
  newResult,
  session,
  userId,
  version,
}) => {
  if (session) {
    return
  }

  const rollbackUpdate = {
    $inc: {
      settlementVersion: -1,
    },
    $set: {
      finalAwayScore: bet.finalAwayScore ?? null,
      finalHomeScore: bet.finalHomeScore ?? null,
      lastSettlementCheckAt: bet.lastSettlementCheckAt ?? null,
      profit: centsToMoney(calculateProfitCents(bet, bet.result)),
      result: bet.result,
      settledAt: bet.settledAt ?? null,
      settledGameId: bet.settledGameId ?? '',
      settlementCheckStatus: bet.settlementCheckStatus ?? '',
      settlementIssue: bet.settlementIssue ?? '',
      settlementReturn: bet.settlementReturn ?? 0,
      settlementSource: bet.settlementSource ?? null,
    },
  }

  if (bet.result !== 'pending') {
    rollbackUpdate.$pop = {
      settlementCorrections: 1,
    }
  }

  await findOneAndUpdate(
    betModel,
    {
      _id: getBetId(bet),
      result: newResult,
      settlementVersion: version,
      userId: toObjectIdIfValid(userId),
    },
    rollbackUpdate,
    { session },
  )
}

const applySettlement = async (
  userId,
  betId,
  newResult,
  options = {},
) => {
  const source = options.source === 'automatic' ? 'automatic' : 'manual'
  const supportedResults =
    source === 'automatic'
      ? AUTOMATIC_SETTLEMENT_RESULTS
      : MANUAL_SETTLEMENT_RESULTS

  if (!supportedResults.has(newResult)) {
    throw new BetSettlementError('Unsupported settlement result.', 400, {
      result: newResult,
      source,
    })
  }

  if (!mongoose.Types.ObjectId.isValid(betId)) {
    throw new BetSettlementError('Bet was not found.', 404)
  }

  const betModel = options.betModel ?? Bet

  return bankrollService.runWithOptionalTransaction(
    async (session) => {
      const scopedOptions = {
        ...options,
        session,
      }
      const bet = await findBet(
        betModel,
        {
          _id: toObjectIdIfValid(betId),
          userId: toObjectIdIfValid(userId),
        },
        session,
      )

      if (!bet) {
        throw new BetSettlementError('Bet was not found.', 404)
      }

      if (bet.result === newResult) {
        return {
          bet,
          status: 'already-settled',
        }
      }

      if (source === 'automatic' && bet.result !== 'pending') {
        return {
          bet,
          status: 'already-settled',
        }
      }

      const previousResult = bet.result
      const rollbackBet = {
        _id: getBetId(bet),
        finalAwayScore: bet.finalAwayScore,
        finalHomeScore: bet.finalHomeScore,
        lastSettlementCheckAt: bet.lastSettlementCheckAt,
        marketOdds: bet.marketOdds,
        result: previousResult,
        settledAt: bet.settledAt,
        settledGameId: bet.settledGameId,
        settlementCheckStatus: bet.settlementCheckStatus,
        settlementIssue: bet.settlementIssue,
        settlementReturn: bet.settlementReturn,
        settlementSource: bet.settlementSource,
        stake: bet.stake,
      }
      const financialBet = {
        _id: getBetId(bet),
        bankrollAccounting: bet.bankrollAccounting,
        marketOdds: bet.marketOdds,
        stake: bet.stake,
      }
      const now = options.nowProvider ? options.nowProvider() : new Date()
      const version = (Number(bet.settlementVersion) || 0) + 1
      const claimedBet = await findOneAndUpdate(
        betModel,
        {
          _id: getBetId(bet),
          result: bet.result,
          userId: toObjectIdIfValid(userId),
        },
        buildSettlementUpdate({
          bet,
          gameMetadata: options.gameMetadata ?? {},
          newResult,
          now,
          source,
        }),
        { session },
      )

      if (!claimedBet) {
        return {
          bet,
          status: 'already-settled',
        }
      }

      const isFinanciallyTracked = await bankrollService.isBetFinanciallyTracked(
        userId,
        bet,
        scopedOptions,
      )

      if (isFinanciallyTracked) {
        const plan = buildSettlementFinancialPlan({
          bet: financialBet,
          newResult,
          previousResult,
          source,
          version,
        })

        const recordedTransactions = []

        try {
          for (const transaction of plan) {
            const recorded = await bankrollService.createAuditedBetTransaction(
              userId,
              bet,
              {
                ...transaction,
                occurredAt: now,
              },
              scopedOptions,
            )

            if (recorded.status === 'recorded') {
              recordedTransactions.push(transaction)
            }
          }
        } catch (error) {
          if (!session) {
            for (const transaction of recordedTransactions.reverse()) {
              await bankrollService.createAuditedBetTransaction(
                userId,
                rollbackBet,
                {
                  actionKey: `${transaction.actionKey}:rollback`,
                  amountCents: -transaction.amountCents,
                  description: 'Compensate failed settlement operation',
                  metadata: {
                    failedSettlementCompensation: true,
                    realizedProfitDeltaCents: -(
                      Number(
                        transaction.metadata?.realizedProfitDeltaCents,
                      ) || 0
                    ),
                  },
                  occurredAt: now,
                  type: 'SETTLEMENT_REVERSAL',
                },
                scopedOptions,
              )
            }
          }

          await rollbackUntransactionalSettlement({
            bet: rollbackBet,
            betModel,
            newResult,
            session,
            userId,
            version,
          })
          throw error
        }
      }

      return {
        bet: claimedBet,
        previousResult,
        status: previousResult === 'pending' ? 'settled' : 'corrected',
      }
    },
    options,
  )
}

const getTeamIdentifiers = (team = {}) =>
  new Set(
    [team.teamId, team.abbreviation, team.abbrev]
      .map(normalizeIdentifier)
      .filter(Boolean),
  )

const intersects = (left, right) =>
  [...left].some((identifier) => right.has(identifier))

const determineMoneylineResult = (bet = {}, game = {}) => {
  if (!normalizeIdentifier(bet.gameId)) {
    return {
      reason: 'game_not_linked',
      result: null,
    }
  }

  if (bet.betType !== 'moneyline') {
    return {
      reason: 'unsupported_bet_type',
      result: null,
    }
  }

  const selectedTeamId =
    normalizeIdentifier(bet.selectedTeam?.teamId) ||
    normalizeIdentifier(bet.selectedSide?.teamId)

  if (!selectedTeamId) {
    return {
      reason: 'selected_team_not_linked',
      result: null,
    }
  }

  if (
    normalizeIdentifier(game.gameId ?? game.id) !==
    normalizeIdentifier(bet.gameId)
  ) {
    return {
      reason: 'game_linkage_mismatch',
      result: null,
    }
  }

  const gameState = normalizeIdentifier(game.gameState)

  if (!COMPLETED_GAME_STATES.has(gameState)) {
    return {
      reason: 'game_not_final',
      result: null,
    }
  }

  const selectedIdentifiers = new Set([selectedTeamId])
  const homeIdentifiers = getTeamIdentifiers(game.homeTeam)
  const awayIdentifiers = getTeamIdentifiers(game.awayTeam)
  const isHome = intersects(selectedIdentifiers, homeIdentifiers)
  const isAway = intersects(selectedIdentifiers, awayIdentifiers)

  if (isHome === isAway) {
    return {
      reason: 'selected_team_not_in_game',
      result: null,
    }
  }

  if (
    (bet.selectedSide?.homeAway === 'home' && !isHome) ||
    (bet.selectedSide?.homeAway === 'away' && !isAway)
  ) {
    return {
      reason: 'selected_side_linkage_mismatch',
      result: null,
    }
  }

  const homeScore = Number(game.homeTeam?.score)
  const awayScore = Number(game.awayTeam?.score)

  if (
    !Number.isFinite(homeScore) ||
    !Number.isFinite(awayScore) ||
    homeScore === awayScore
  ) {
    return {
      reason: 'final_score_unavailable',
      result: null,
    }
  }

  const homeWon = homeScore > awayScore

  return {
    finalAwayScore: awayScore,
    finalHomeScore: homeScore,
    reason: null,
    result: (isHome && homeWon) || (isAway && !homeWon) ? 'win' : 'loss',
  }
}

const SETTLEMENT_ISSUE_MESSAGES = Object.freeze({
  final_score_unavailable: 'Final score unavailable.',
  game_linkage_mismatch: 'Game linkage is inconsistent.',
  game_not_final: 'Game is not final.',
  game_not_linked: 'Automatic settlement unavailable — game not linked.',
  game_unavailable: 'Game result unavailable.',
  provider_error: 'Unable to retrieve the NHL game result.',
  selected_side_linkage_mismatch: 'Selected side does not match the linked game.',
  selected_team_not_in_game: 'Selected team does not belong to the linked game.',
  selected_team_not_linked:
    'Automatic settlement unavailable — selected team not linked.',
  unsupported_bet_type: 'Automatic settlement supports moneyline bets only.',
})

const markSettlementIssue = async (userId, bet, reason, options = {}) => {
  const betModel = options.betModel ?? Bet

  if (typeof betModel.updateOne !== 'function') {
    return
  }

  await betModel.updateOne(
    {
      _id: getBetId(bet),
      result: 'pending',
      userId: toObjectIdIfValid(userId),
    },
    {
      $set: {
        lastSettlementCheckAt: options.nowProvider
          ? options.nowProvider()
          : new Date(),
        settlementCheckStatus: reason,
        settlementIssue:
          SETTLEMENT_ISSUE_MESSAGES[reason] ?? 'Game result unavailable.',
      },
    },
  )
}

const settlePendingMoneylineBets = async (userId, options = {}) => {
  if (!userId) {
    throw new BetSettlementError('Authenticated userId is required.', 401)
  }

  const betModel = options.betModel ?? Bet
  const gameProvider = options.gameProvider ?? nhlApiService.getGameLanding
  const pendingBets = await betModel.find({
    result: 'pending',
    userId: toObjectIdIfValid(userId),
  })
  const bets = Array.isArray(pendingBets) ? pendingBets : []
  const gamePromises = new Map()
  const results = []
  let alreadySettled = 0
  let wins = 0
  let losses = 0

  const getGame = (gameId) => {
    const key = String(gameId)

    if (!gamePromises.has(key)) {
      gamePromises.set(key, Promise.resolve().then(() => gameProvider(key)))
    }

    return gamePromises.get(key)
  }

  for (const bet of bets) {
    let decision = determineMoneylineResult(bet, {})

    if (
      decision.reason === 'game_linkage_mismatch' &&
      normalizeIdentifier(bet.gameId)
    ) {
      try {
        const game = await getGame(bet.gameId)

        if (!game) {
          decision = {
            reason: 'game_unavailable',
            result: null,
          }
        } else {
          decision = determineMoneylineResult(bet, game)
        }

        if (decision.result) {
          const settlement = await (
            options.applySettlementProvider ?? applySettlement
          )(userId, getBetId(bet), decision.result, {
            ...options,
            gameMetadata: {
              finalAwayScore: decision.finalAwayScore,
              finalHomeScore: decision.finalHomeScore,
              settledGameId: String(bet.gameId),
            },
            source: 'automatic',
          })

          if (settlement.status === 'settled') {
            if (decision.result === 'win') {
              wins += 1
            } else {
              losses += 1
            }
          } else if (settlement.status === 'already-settled') {
            alreadySettled += 1
          }

          results.push({
            betId: String(getBetId(bet)),
            result: decision.result,
            status: settlement.status,
          })
          continue
        }
      } catch (error) {
        decision = {
          error: error.message,
          reason: 'provider_error',
          result: null,
        }
      }
    }

    await markSettlementIssue(userId, bet, decision.reason, options)
    results.push({
      betId: String(getBetId(bet)),
      message:
        SETTLEMENT_ISSUE_MESSAGES[decision.reason] ?? 'Game result unavailable.',
      reason: decision.reason,
      status: 'pending',
    })
  }

  const settled = wins + losses

  return {
    alreadySettled,
    checked: bets.length,
    errors: results.filter((result) => result.reason === 'provider_error').length,
    losses,
    results,
    settled,
    stillPending: Math.max(0, bets.length - settled - alreadySettled),
    wins,
  }
}

module.exports = {
  AUTOMATIC_SETTLEMENT_RESULTS,
  BetSettlementError,
  SETTLEMENT_ISSUE_MESSAGES,
  applySettlement,
  buildSettlementFinancialPlan,
  calculateProfitCents,
  calculateReturnCents,
  determineMoneylineResult,
  getFinancialEffectCents,
  settlePendingMoneylineBets,
}
