const DEFAULT_PROMOTION_PREVIEW_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_PROMOTION_PREVIEWS = 48

const createCalibrationPromotionPreviewStore = ({
  maximumPreviews = DEFAULT_MAX_PROMOTION_PREVIEWS,
} = {}) => {
  const previews = new Map()

  const enforceLimit = () => {
    while (previews.size > maximumPreviews) {
      previews.delete(previews.keys().next().value)
    }
  }

  const put = (record) => {
    previews.delete(record.promotionPreviewId)
    previews.set(record.promotionPreviewId, record)
    enforceLimit()
    return record
  }

  const getForUser = (userId, promotionPreviewId) => {
    const record = previews.get(String(promotionPreviewId))

    return record?.userId === String(userId) ? record : null
  }

  const beginApply = (userId, promotionPreviewId, now = Date.now()) => {
    const record = getForUser(userId, promotionPreviewId)

    if (!record) return { record: null, status: 'NOT_FOUND' }
    if (record.expiresAtMs <= now) return { record, status: 'EXPIRED' }
    if (record.consumedAt) return { record, status: 'CONSUMED' }
    if (record.applying) return { record, status: 'APPLYING' }

    record.applying = true
    return { record, status: 'READY' }
  }

  const finishApply = (
    userId,
    promotionPreviewId,
    { appliedResult = null, consumedAt = null } = {},
  ) => {
    const record = getForUser(userId, promotionPreviewId)

    if (!record) return null
    record.applying = false
    if (consumedAt) {
      record.consumedAt = consumedAt
      record.appliedResult = appliedResult
    }
    return record
  }

  const clear = () => previews.clear()

  return {
    beginApply,
    clear,
    finishApply,
    getForUser,
    put,
    size: () => previews.size,
  }
}

const calibrationPromotionPreviewStore =
  createCalibrationPromotionPreviewStore()

module.exports = {
  DEFAULT_MAX_PROMOTION_PREVIEWS,
  DEFAULT_PROMOTION_PREVIEW_TTL_MS,
  calibrationPromotionPreviewStore,
  createCalibrationPromotionPreviewStore,
}
