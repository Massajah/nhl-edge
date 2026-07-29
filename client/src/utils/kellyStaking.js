import {
  BANKROLL_DEFAULT_CURRENCY,
  formatBankrollCurrency,
  normalizeBankrollCurrency,
} from './bankroll.js'
import {
  DEFAULT_BETTING_SETTINGS,
  getBankrollBasisLabel,
  getKellyModeFraction,
  getKellyModeLabel,
  normalizeBettingSettings,
} from './bettingSettings.js'
import { parseMarketOdds } from './calculateGame.js'

const EPSILON = 1e-9
const MONEY_EPSILON = 1e-6

export const KELLY_RECOMMENDATION_REASONS = Object.freeze({
  BANKROLL_NOT_INITIALIZED: 'BANKROLL_NOT_INITIALIZED',
  BELOW_MINIMUM_EDGE: 'BELOW_MINIMUM_EDGE',
  INVALID_ODDS: 'INVALID_ODDS',
  INVALID_PROBABILITY: 'INVALID_PROBABILITY',
  NO_AVAILABLE_BANKROLL: 'NO_AVAILABLE_BANKROLL',
  NO_POSITIVE_EDGE: 'NO_POSITIVE_EDGE',
  NON_POSITIVE_KELLY: 'NON_POSITIVE_KELLY',
  STAKE_BELOW_ROUNDING_INCREMENT: 'STAKE_BELOW_ROUNDING_INCREMENT',
})

const toNumber = (value, fallback = 0) => {
  if (value === null || value === '' || value === undefined) {
    return fallback
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : fallback
}

const toOptionalNumber = (value) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

const isValidProbability = (value) =>
  Number.isFinite(value) && value > 0 && value <= 1

const normalizePositiveNumber = (value, fallback) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 0
    ? numberValue
    : fallback
}

const normalizeNonNegativeNumber = (value, fallback = 0) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback
}

const roundDisplayNumber = (value, decimals = 10) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const createBaseRecommendation = ({
  bankrollAmount,
  bankrollInitialized,
  kellyFraction,
  maximumStakePercent,
  minimumEdgePercent,
  roundingIncrement,
}) => ({
  bankrollAmount,
  bankrollInitialized: Boolean(bankrollInitialized),
  capApplied: false,
  cappedStakePercent: null,
  edgeDecimal: null,
  edgePercentagePoints: null,
  eligible: false,
  fractionalKellyFraction: null,
  fractionalKellyPercent: null,
  fullKellyFraction: null,
  fullKellyPercent: null,
  hasStakePercent: false,
  impliedProbability: null,
  maximumStakePercent,
  minimumEdgePercent,
  reason: null,
  recommendedStakeAmount: 0,
  roundingIncrement,
  selectedKellyFraction: kellyFraction,
  unroundedStakeAmount: 0,
})

const withReason = (recommendation, reason) => ({
  ...recommendation,
  eligible: false,
  reason,
  recommendedStakeAmount: 0,
})

export const roundStakeAmountDown = (amount, increment) => {
  const moneyAmount = Number(amount)
  const roundingIncrement = Number(increment)

  if (
    !Number.isFinite(moneyAmount) ||
    moneyAmount <= 0 ||
    !Number.isFinite(roundingIncrement) ||
    roundingIncrement <= 0
  ) {
    return 0
  }

  const amountCents = Math.floor(moneyAmount * 100 + MONEY_EPSILON)
  const incrementCents = Math.max(1, Math.round(roundingIncrement * 100))
  const roundedCents =
    Math.floor((amountCents + MONEY_EPSILON) / incrementCents) *
    incrementCents

  return Number((roundedCents / 100).toFixed(2))
}

export const calculateKellyStakeRecommendation = ({
  bankrollAmount = 0,
  bankrollInitialized = true,
  decimalOdds,
  kellyFraction = DEFAULT_BETTING_SETTINGS.customKellyFraction,
  maximumStakePercent = DEFAULT_BETTING_SETTINGS.maximumStakePercent,
  minimumEdgePercent = DEFAULT_BETTING_SETTINGS.minimumEdgePercent,
  modelProbability,
  roundingIncrement = DEFAULT_BETTING_SETTINGS.stakeRoundingIncrement,
} = {}) => {
  const probability = Number(modelProbability)
  const parsedOdds = parseMarketOdds(decimalOdds)
  const selectedKellyFraction = normalizePositiveNumber(kellyFraction, 0)
  const stakeCapPercent = normalizePositiveNumber(
    maximumStakePercent,
    DEFAULT_BETTING_SETTINGS.maximumStakePercent,
  )
  const edgeThresholdPercent = Math.max(
    0,
    toNumber(minimumEdgePercent, DEFAULT_BETTING_SETTINGS.minimumEdgePercent),
  )
  const normalizedRoundingIncrement = normalizePositiveNumber(
    roundingIncrement,
    DEFAULT_BETTING_SETTINGS.stakeRoundingIncrement,
  )
  const normalizedBankrollAmount = normalizeNonNegativeNumber(bankrollAmount)
  const baseRecommendation = createBaseRecommendation({
    bankrollAmount: normalizedBankrollAmount,
    bankrollInitialized,
    kellyFraction: selectedKellyFraction,
    maximumStakePercent: stakeCapPercent,
    minimumEdgePercent: edgeThresholdPercent,
    roundingIncrement: normalizedRoundingIncrement,
  })

  if (!isValidProbability(probability)) {
    return withReason(
      baseRecommendation,
      KELLY_RECOMMENDATION_REASONS.INVALID_PROBABILITY,
    )
  }

  if (!parsedOdds) {
    return withReason(
      {
        ...baseRecommendation,
        modelProbability: probability,
      },
      KELLY_RECOMMENDATION_REASONS.INVALID_ODDS,
    )
  }

  const impliedProbability = 1 / parsedOdds
  const edgeDecimal = probability - impliedProbability
  const edgePercentagePoints = edgeDecimal * 100
  const fullKellyFraction =
    (parsedOdds * probability - 1) / (parsedOdds - 1)
  const fullKellyPercent = fullKellyFraction * 100
  const fractionalKellyFraction = fullKellyFraction * selectedKellyFraction
  const fractionalKellyPercent = fractionalKellyFraction * 100
  const capApplied = fractionalKellyPercent - stakeCapPercent > EPSILON
  const cappedStakePercent = Math.min(
    Math.max(fractionalKellyPercent, 0),
    stakeCapPercent,
  )
  const calculatedRecommendation = {
    ...baseRecommendation,
    capApplied,
    cappedStakePercent: roundDisplayNumber(cappedStakePercent),
    edgeDecimal: roundDisplayNumber(edgeDecimal),
    edgePercentagePoints: roundDisplayNumber(edgePercentagePoints),
    fractionalKellyFraction: roundDisplayNumber(fractionalKellyFraction),
    fractionalKellyPercent: roundDisplayNumber(fractionalKellyPercent),
    fullKellyFraction: roundDisplayNumber(fullKellyFraction),
    fullKellyPercent: roundDisplayNumber(fullKellyPercent),
    hasStakePercent: fullKellyFraction > EPSILON && edgeDecimal > EPSILON,
    impliedProbability: roundDisplayNumber(impliedProbability),
    marketOdds: parsedOdds,
    modelProbability: probability,
  }

  if (edgeDecimal <= EPSILON) {
    return withReason(
      calculatedRecommendation,
      KELLY_RECOMMENDATION_REASONS.NO_POSITIVE_EDGE,
    )
  }

  if (fullKellyFraction <= EPSILON || fractionalKellyFraction <= EPSILON) {
    return withReason(
      calculatedRecommendation,
      KELLY_RECOMMENDATION_REASONS.NON_POSITIVE_KELLY,
    )
  }

  if (edgePercentagePoints + EPSILON < edgeThresholdPercent) {
    return withReason(
      {
        ...calculatedRecommendation,
        hasStakePercent: true,
      },
      KELLY_RECOMMENDATION_REASONS.BELOW_MINIMUM_EDGE,
    )
  }

  if (!bankrollInitialized) {
    return withReason(
      {
        ...calculatedRecommendation,
        hasStakePercent: true,
      },
      KELLY_RECOMMENDATION_REASONS.BANKROLL_NOT_INITIALIZED,
    )
  }

  if (normalizedBankrollAmount <= 0) {
    return withReason(
      {
        ...calculatedRecommendation,
        hasStakePercent: true,
      },
      KELLY_RECOMMENDATION_REASONS.NO_AVAILABLE_BANKROLL,
    )
  }

  const unroundedStakeAmount =
    (normalizedBankrollAmount * cappedStakePercent) / 100
  const recommendedStakeAmount = roundStakeAmountDown(
    unroundedStakeAmount,
    normalizedRoundingIncrement,
  )

  if (recommendedStakeAmount <= 0) {
    return withReason(
      {
        ...calculatedRecommendation,
        hasStakePercent: true,
        unroundedStakeAmount: roundDisplayNumber(unroundedStakeAmount),
      },
      KELLY_RECOMMENDATION_REASONS.STAKE_BELOW_ROUNDING_INCREMENT,
    )
  }

  return {
    ...calculatedRecommendation,
    eligible: true,
    hasStakePercent: true,
    reason: null,
    recommendedStakeAmount,
    unroundedStakeAmount: roundDisplayNumber(unroundedStakeAmount),
  }
}

export const getSelectedBankrollForKelly = (
  bankrollSummary = null,
  bankrollBasis = DEFAULT_BETTING_SETTINGS.bankrollBasis,
) => {
  const normalizedBasis = bankrollBasis === 'CURRENT' ? 'CURRENT' : 'AVAILABLE'
  const amountField =
    normalizedBasis === 'CURRENT' ? 'currentBankroll' : 'availableBankroll'

  return {
    amount: toNumber(bankrollSummary?.[amountField], 0),
    basis: normalizedBasis,
    currency: normalizeBankrollCurrency(
      bankrollSummary?.currency ?? BANKROLL_DEFAULT_CURRENCY,
    ),
    initialized: Boolean(bankrollSummary?.initialized),
    label: getBankrollBasisLabel(normalizedBasis),
  }
}

export const getKellyModeRecommendationLabel = (
  settings = DEFAULT_BETTING_SETTINGS,
) => {
  const normalizedSettings = normalizeBettingSettings(settings)

  if (normalizedSettings.kellyMode === 'CUSTOM') {
    return `Custom Kelly - ${normalizedSettings.customKellyFraction.toFixed(
      2,
    )}x Full Kelly`
  }

  return getKellyModeLabel(normalizedSettings.kellyMode)
}

export const createKellyStakeRecommendation = ({
  bankrollSummary = null,
  decimalOdds,
  modelProbability,
  settings = DEFAULT_BETTING_SETTINGS,
} = {}) => {
  const normalizedSettings = normalizeBettingSettings(settings)
  const bankroll = getSelectedBankrollForKelly(
    bankrollSummary,
    normalizedSettings.bankrollBasis,
  )
  const recommendation = calculateKellyStakeRecommendation({
    bankrollAmount: bankroll.amount,
    bankrollInitialized: bankroll.initialized,
    decimalOdds,
    kellyFraction: getKellyModeFraction(normalizedSettings),
    maximumStakePercent: normalizedSettings.maximumStakePercent,
    minimumEdgePercent: normalizedSettings.minimumEdgePercent,
    modelProbability,
    roundingIncrement: normalizedSettings.stakeRoundingIncrement,
  })

  return {
    ...recommendation,
    bankrollBasis: bankroll.basis,
    bankrollBasisLabel: bankroll.label,
    bettingSettingsSnapshot: normalizedSettings,
    currency: bankroll.currency,
    kellyMode: normalizedSettings.kellyMode,
    kellyModeLabel: getKellyModeRecommendationLabel(normalizedSettings),
  }
}

export const formatKellyProbability = (value) => {
  const probability = toOptionalNumber(value)

  if (probability === null) {
    return '--'
  }

  const displayProbability = Math.min(Math.max(probability, 0), 1)

  return `${(displayProbability * 100).toFixed(2)} %`
}

export const formatKellyPercent = (value) => {
  const numberValue = toOptionalNumber(value)

  return numberValue === null ? '--' : `${numberValue.toFixed(2)} %`
}

export const formatKellyPercentagePoints = (value) => {
  const numberValue = toOptionalNumber(value)

  return numberValue === null
    ? '--'
    : `${numberValue.toFixed(2)} percentage points`
}

export const formatKellyEdge = (edgeDecimal) => {
  const edge = toOptionalNumber(edgeDecimal)

  if (edge === null) {
    return '--'
  }

  const percentagePoints = edge * 100
  const sign = percentagePoints >= 0 ? '+' : ''

  return `${sign}${percentagePoints.toFixed(2)} %-points`
}

export const formatKellyCurrency = (
  value,
  currency = BANKROLL_DEFAULT_CURRENCY,
) => {
  const amount = toOptionalNumber(value)

  if (amount === null) {
    return '--'
  }

  return formatBankrollCurrency(Number(amount.toFixed(2)), currency)
}

export const formatStakeInputValue = (value) => {
  const amount = toOptionalNumber(value)

  if (amount === null || amount <= 0) {
    return ''
  }

  return String(Number(amount.toFixed(2)))
}

export const getKellyRecommendationReasonMessage = (
  recommendation = {},
  { currency = recommendation.currency ?? BANKROLL_DEFAULT_CURRENCY } = {},
) => {
  const reason = recommendation.reason
  const minimumEdge = formatKellyPercentagePoints(
    recommendation.minimumEdgePercent,
  )
  const edgePoints = formatKellyPercentagePoints(
    recommendation.edgePercentagePoints,
  )
  const rounding = formatKellyCurrency(
    recommendation.roundingIncrement,
    currency,
  )

  if (reason === KELLY_RECOMMENDATION_REASONS.INVALID_PROBABILITY) {
    return 'Model probability is unavailable for the selected side.'
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.INVALID_ODDS) {
    return 'Enter decimal odds greater than 1.00.'
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.NO_POSITIVE_EDGE) {
    return 'The selected odds do not offer a positive model edge.'
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.BELOW_MINIMUM_EDGE) {
    return `The model edge is ${edgePoints}. Your minimum is ${minimumEdge}.`
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.NON_POSITIVE_KELLY) {
    return 'The current probability and odds do not produce a positive Kelly fraction.'
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.BANKROLL_NOT_INITIALIZED) {
    return 'Set up your bankroll in Bet Tracker to receive a stake amount. Kelly percentages are still shown.'
  }

  if (reason === KELLY_RECOMMENDATION_REASONS.NO_AVAILABLE_BANKROLL) {
    return recommendation.bankrollBasis === 'CURRENT'
      ? 'Current bankroll is zero, so no stake amount can be recommended.'
      : 'All available bankroll is currently reserved by pending bets.'
  }

  if (
    reason === KELLY_RECOMMENDATION_REASONS.STAKE_BELOW_ROUNDING_INCREMENT
  ) {
    return `The calculated stake is below the configured rounding increment of ${rounding}.`
  }

  return ''
}

export const createKellyRecommendationSnapshot = (recommendation = null) => {
  if (!recommendation) {
    return null
  }

  const hasAmount = recommendation.eligible && recommendation.recommendedStakeAmount > 0

  return {
    appliedKellyFraction: recommendation.selectedKellyFraction,
    bankrollAmountAtRecommendation: recommendation.bankrollInitialized
      ? recommendation.bankrollAmount
      : null,
    bankrollBasis: recommendation.bankrollBasis,
    bettingSettingsSnapshot: recommendation.bettingSettingsSnapshot,
    capApplied: recommendation.capApplied,
    eligible: recommendation.eligible,
    fractionalKellyPercent: recommendation.fractionalKellyPercent,
    fullKellyPercent: recommendation.fullKellyPercent,
    maximumStakePercent: recommendation.maximumStakePercent,
    minimumEdgePercent: recommendation.minimumEdgePercent,
    reason: recommendation.reason,
    recommendedStakeAmount: hasAmount
      ? recommendation.recommendedStakeAmount
      : null,
    recommendedStakePercent: recommendation.hasStakePercent
      ? recommendation.cappedStakePercent
      : null,
    roundingIncrement: recommendation.roundingIncrement,
  }
}
