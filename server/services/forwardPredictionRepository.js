const ForwardPredictionSnapshot = require('../models/ForwardPredictionSnapshot')
const { snapshotKey } = require('./forwardPredictionContracts')

const createForwardPredictionRepository = ({ model = ForwardPredictionSnapshot } = {}) => ({
  async ensureReady() { await model.init() },
  async exists(identity) {
    if (!identity.userId) throw new Error('Server-side owner is required.')
    return Boolean(await model.exists(snapshotKey(identity)))
  },
  async insertOnce(snapshot) {
    if (!snapshot.userId) throw new Error('Server-side owner is required.')
    // Validate the full document: query validators cannot enforce cross-field invariants.
    const document = new ForwardPredictionSnapshot(snapshot)
    await document.validate()
    try {
      const result = await model.updateOne(snapshotKey(snapshot),
        { $setOnInsert: document.toObject() }, { upsert: true, setDefaultsOnInsert: false })
      return { inserted: result.upsertedCount === 1 }
    } catch (error) {
      // A concurrent first writer won the unique identity. Its observation is preserved.
      if (error.code === 11000 && await model.exists(snapshotKey(snapshot))) return { inserted: false }
      throw error
    }
  },
})

module.exports = { createForwardPredictionRepository,
  forwardPredictionRepository: createForwardPredictionRepository() }
