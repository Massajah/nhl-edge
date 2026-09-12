const { createHash } = require('node:crypto')
const { calculateGame } = require('../../shared/predictionCalculation')
const { getSpecialTeamsContextForTeams } = require('../../shared/specialTeamsMatchups')
const { BASE_MODEL_V1 } = require('../config/baseModel')
const { serializeRatingEngineSettings } = require('./ratingEngineSettingsService')
const { calculateEffectiveHomeAdvantage } = require('./homeAdvantageService')
const { normalizeScheduleAdjustmentSettings } = require('./quickRematchSettingsService')
const { CALCULATION_CONTRACT_VERSION } = require('./forwardPredictionContracts')

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const canonicalJson = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)

const getPredictionSettings = (rawSettings = {}, rawScheduleSettings = {}) => {
  const settings = serializeRatingEngineSettings(rawSettings)
  const schedule = normalizeScheduleAdjustmentSettings(rawScheduleSettings)
  const rest = {}
  if (schedule.restFatigueEnabled) {
    for (const name of ['backToBack', 'backToBackTravel', 'threeInFour', 'wellRested']) {
      rest[name] = schedule[`${name}Enabled`] ? schedule[`${name}Adjustment`] : null
    }
  }
  return {
    probabilityScale: settings.probabilityScale,
    homeAdvantage: settings.homeAdvantage,
    rest,
    quickRematch: schedule.quickRematchEnabled ? {
      maximumDays: schedule.quickRematchMaximumDays,
      adjustment: schedule.quickRematchLoserAdjustment,
    } : null,
    specialTeams: settings.specialTeamsMode === 'automatic' ? {
      adjustment: settings.specialTeamsAdjustment,
      threshold: settings.specialTeamsRankThreshold,
    } : null,
  }
}

const settingsFingerprint = (settings, scheduleSettings) => createHash('sha256')
  .update(canonicalJson(getPredictionSettings(settings, scheduleSettings))).digest('hex')

const calculateAutomaticPrediction = ({ identity, ratings, settings: rawSettings,
  scheduleSettings, injurySummaries, gameContext, specialTeams }) => {
  const settings = serializeRatingEngineSettings(rawSettings ?? {})
  const byTeam = Object.fromEntries((ratings ?? []).map((rating) => [rating.teamId, rating]))
  const missing = ['home', 'away'].filter((side) => !finite(byTeam[identity[`${side}TeamId`]]?.baseRating))
  if (missing.length) return { available: false, reason: 'RATINGS_UNAVAILABLE', missing }
  const matchup = getSpecialTeamsContextForTeams({
    homeTeam: identity.homeTeamId, awayTeam: identity.awayTeamId,
    mode: settings.specialTeamsMode, adjustment: settings.specialTeamsAdjustment,
    threshold: settings.specialTeamsRankThreshold, specialTeams,
  })
  const inputs = {}
  const modelState = {}
  const adjustments = {}
  const completeness = { ratings: 'available', injuries: {},
    schedule: {}, goalies: {}, specialTeams: {} }
  for (const side of ['home', 'away']) {
    const id = identity[`${side}TeamId`]
    const rating = byTeam[id]
    // This persistent team adjustment is already part of Dashboard's effective base rating.
    const ratingAdjustment = finite(rating.manualAdjustment) ? Number(rating.manualAdjustment) : 0
    const baseRating = Number(rating.baseRating) + ratingAdjustment
    const context = gameContext?.[`${side}Context`]
    const selection = gameContext?.goalieSelections?.[side]
    const validGoalie = ['provider_goalie', 'team_goalie'].includes(selection?.selectionType) && selection.teamId === id &&
      Number.isSafeInteger(selection.nhlPlayerId) && selection.nhlPlayerId > 0 && finite(selection.teamDefaultAdjustment)
    const goalie = validGoalie ? Math.max(-5, Math.min(5, Number(selection.teamDefaultAdjustment))) : 0
    const injury = injurySummaries?.[id]
    completeness.injuries[side] = finite(injury?.totalImpact) ? 'stored_user_data' : 'unavailable'
    const scheduleAvailable = context?.dataStatus === 'available'
    completeness.schedule[side] = context?.dataStatus ?? 'unavailable'
    completeness.goalies[side] = validGoalie ? selection.confirmationStatus ?? 'selected' :
      selection?.selectionType === 'custom' ? 'custom_excluded' : 'unknown'
    completeness.specialTeams[side] = settings.specialTeamsMode === 'automatic'
      ? matchup[side].status === 'unavailable' ? 'unavailable' : 'available' : 'disabled'
    adjustments[side] = {
      ratingAdjustment,
      homeAdvantage: side === 'home' ? calculateEffectiveHomeAdvantage({
        baseHomeAdvantage: settings.homeAdvantage, homeRating: rating,
      }).effectiveHomeAdvantage : 0,
      injuries: finite(injury?.totalImpact) ? Number(injury.totalImpact) : 0,
      goalie,
      restFatigue: scheduleAvailable ? Number(context.automaticRestFatigueAdjustment) : 0,
      quickRematch: scheduleAvailable ? Number(context.automaticQuickRematchAdjustment) : 0,
      specialTeams: matchup[side].adjustment,
    }
    if (Object.values(adjustments[side]).some((value) => !Number.isFinite(value))) {
      return { available: false, reason: 'INVALID_AUTOMATIC_INPUT' }
    }
    inputs[side] = { baseRating, homeAdvantage: adjustments[side].homeAdvantage,
      storedInjuryImpact: adjustments[side].injuries, goalieAdjustment: goalie,
      restFatigue: adjustments[side].restFatigue,
      quickRematchAdjustment: adjustments[side].quickRematch,
      specialTeamsAdjustment: adjustments[side].specialTeams, motivation: 0, manualAdjustment: 0 }
    modelState[side] = { baseRating: Number(rating.baseRating), effectiveRating: null,
      goalieNhlPlayerId: validGoalie ? selection.nhlPlayerId : null,
      restFatigueCondition: scheduleAvailable ? context.restFatigueCondition ?? 'unknown' : 'unavailable' }
  }
  const result = calculateGame(inputs.home, inputs.away, settings.probabilityScale)
  if (![result.homeWinProbability, result.awayWinProbability].every((p) => Number.isFinite(p) && p > 0 && p < 1)) {
    return { available: false, reason: 'INVALID_PROBABILITY' }
  }
  modelState.home.effectiveRating = result.homeFinalRating
  modelState.away.effectiveRating = result.awayFinalRating
  return { available: true, modelVersion: BASE_MODEL_V1.modelVersion,
    calculationContractVersion: CALCULATION_CONTRACT_VERSION,
    settingsFingerprint: settingsFingerprint(rawSettings, scheduleSettings),
    effectiveSettings: getPredictionSettings(rawSettings, scheduleSettings),
    homeWinProbability: result.homeWinProbability, awayWinProbability: result.awayWinProbability,
    homeFairOdds: result.homeFairOdds, awayFairOdds: result.awayFairOdds,
    modelState, adjustments, completeness }
}

module.exports = { calculateAutomaticPrediction, canonicalJson, getPredictionSettings, settingsFingerprint }
