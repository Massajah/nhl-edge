const hasComparableGoalie = (goalie) =>
  goalie?.selectionType === 'provider_goalie' &&
  goalie?.sourceType === 'MANUAL' &&
  Number.isSafeInteger(Number(goalie.nhlPlayerId)) &&
  Number(goalie.nhlPlayerId) > 0

export const isEligibleForGoalieAudit = (bet) =>
  Boolean(
    bet?.id &&
    /^\d{10}$/.test(String(bet.gameId ?? '')) &&
    bet.scheduledStart && Number.isFinite(+new Date(bet.scheduledStart)) &&
    ['away', 'home'].some((side) =>
      hasComparableGoalie(bet.startingGoaliesAtBet?.[side])),
  )

export const getEligibleGoalieAuditBetIds = (bets = [], { includePending = false } = {}) =>
  [...new Set(bets
    .filter((bet) => (includePending || bet.result !== 'pending') &&
      isEligibleForGoalieAudit(bet))
    .map((bet) => bet.id))]

export const goalieAuditStatusLabel = (status) => {
  if (status === 'MATCH') return 'Match'
  if (status === 'MISMATCH') return 'Different starter'
  return 'Unavailable'
}
