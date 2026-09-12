const mongoose = require('mongoose')
const { PREDICTION_DEFINITION, CALCULATION_CONTRACT_VERSION, OPEN_BEFORE_MS, CLOSE_BEFORE_MS } =
  require('../services/forwardPredictionContracts')

const number = { type: Number, required: true, validate: Number.isFinite }
const text = { type: String, required: true }
const sideState = new mongoose.Schema({ baseRating: number, effectiveRating: number,
  goalieNhlPlayerId: { type: Number, default: null }, restFatigueCondition: text }, { _id: false })
const sideAdjustments = new mongoose.Schema(Object.fromEntries(
  ['ratingAdjustment', 'homeAdvantage', 'injuries', 'goalie', 'restFatigue', 'quickRematch', 'specialTeams']
    .map((key) => [key, number]),
), { _id: false })
const sideStatus = new mongoose.Schema({ home: text, away: text }, { _id: false })
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId: { ...text, match: /^\d{10}$/ },
  seasonId: { ...text, match: /^\d{8}$/ },
  gameType: { type: Number, enum: [2, 3], required: true },
  scheduledStartAtCapture: { type: Date, required: true },
  homeTeamId: text,
  awayTeamId: text,
  predictionDefinition: { ...text, enum: [PREDICTION_DEFINITION] },
  modelVersion: text,
  calculationContractVersion: { ...text, enum: [CALCULATION_CONTRACT_VERSION] },
  settingsFingerprint: { ...text, match: /^[a-f0-9]{64}$/ },
  generatedAt: { type: Date, required: true },
  targetAt: { type: Date, required: true },
  homeWinProbability: { ...number, min: Number.EPSILON, max: 1 - Number.EPSILON },
  awayWinProbability: { ...number, min: Number.EPSILON, max: 1 - Number.EPSILON },
  homeFairOdds: { ...number, min: 1 },
  awayFairOdds: { ...number, min: 1 },
  modelState: { home: { type: sideState, required: true }, away: { type: sideState, required: true } },
  adjustments: { home: { type: sideAdjustments, required: true }, away: { type: sideAdjustments, required: true } },
  effectiveSettings: { type: mongoose.Schema.Types.Mixed, required: true },
  completeness: {
    ratings: text, injuries: { type: sideStatus, required: true },
    schedule: { type: sideStatus, required: true },
    goalies: { type: sideStatus, required: true },
    specialTeams: { type: sideStatus, required: true },
  },
}, { collection: 'forward_prediction_snapshots', versionKey: false, strict: 'throw' })

schema.eachPath((_name, path) => { path.options.immutable = true })
schema.pre('validate', function () {
  const before = +this.scheduledStartAtCapture - +this.generatedAt
  if (!Number.isFinite(before) || before < CLOSE_BEFORE_MS || before > OPEN_BEFORE_MS ||
      +this.targetAt !== +this.scheduledStartAtCapture - OPEN_BEFORE_MS) {
    this.invalidate('generatedAt', 'Official prediction must be generated inside the inclusive T2 window.')
  }
  if (Math.abs(this.homeWinProbability + this.awayWinProbability - 1) > 1e-12 ||
      Math.abs(this.homeFairOdds * this.homeWinProbability - 1) > 1e-12 ||
      Math.abs(this.awayFairOdds * this.awayWinProbability - 1) > 1e-12) {
    this.invalidate('homeWinProbability', 'Probability/fair-odds contract mismatch.')
  }
})
schema.pre('save', function () {
  if (!this.isNew) throw new Error('Official predictions are immutable.')
})
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], function () {
  const update = this.getUpdate()
  if (this.op !== 'updateOne' || !this.getOptions().upsert || !update?.$setOnInsert ||
      Object.keys(update).some((key) => key !== '$setOnInsert')) {
    throw new Error('Official predictions only support insert-once updates.')
  }
})
schema.pre('bulkWrite', function () { throw new Error('Use the insert-once prediction repository.') })
schema.index({ userId: 1, gameId: 1, scheduledStartAtCapture: 1, predictionDefinition: 1 }, { unique: true })
schema.index({ userId: 1, seasonId: 1, predictionDefinition: 1, generatedAt: 1 })

module.exports = mongoose.model('ForwardPredictionSnapshot', schema)
// This collection has never supported ownerless records or ownership reassignment.
module.exports.legacyOwnerMigrationAllowed = false
