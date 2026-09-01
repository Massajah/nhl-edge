import { useEffect, useState } from 'react'
import {
  ChevronDown,
  History,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import {
  getModelCalibrationPromotion,
  getModelCalibrationPromotions,
} from '../services/powerRatingSimulationsApi.js'
import {
  formatRatingLabCandidateType as formatCandidateType,
  formatRatingLabPromotionValue as formatHistoryValue,
} from '../utils/ratingLabPromotion.js'

const HISTORY_PAGE_LIMIT = 20

const formatDate = (value) => {
  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'
}

const formatMetric = (value, decimals = 6) => {
  if (!Number.isFinite(Number(value))) return '—'
  const number = Number(value)

  if (Math.abs(number) < 0.5 * 10 ** -decimals) {
    return Number(0).toFixed(decimals)
  }

  return `${number > 0 ? '+' : ''}${number.toFixed(decimals)}`
}

const formatPercent = (value) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%`
    : '—'

const getErrorMessage = (error, fallback) => error?.message || fallback

function PromotionHistory({
  initialDetails = {},
  initialErrorMessage = '',
  initialExpandedPromotionIds = [],
  initialPagination = null,
  initialPromotions = null,
  initialStatus = 'idle',
  loadPromotion = getModelCalibrationPromotion,
  loadPromotions = getModelCalibrationPromotions,
} = {}) {
  const [promotions, setPromotions] = useState(initialPromotions ?? [])
  const [pagination, setPagination] = useState(initialPagination ?? {
    hasMore: false,
    limit: HISTORY_PAGE_LIMIT,
    nextCursor: null,
  })
  const [status, setStatus] = useState(
    initialPromotions
      ? 'success'
      : initialStatus === 'idle'
        ? 'loading'
        : initialStatus,
  )
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [details, setDetails] = useState(initialDetails)
  const [detailStatuses, setDetailStatuses] = useState({})
  const [detailErrors, setDetailErrors] = useState({})
  const [expanded, setExpanded] = useState(
    () => new Set(initialExpandedPromotionIds),
  )

  const loadFirstPage = async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      const response = await loadPromotions({ limit: HISTORY_PAGE_LIMIT })
      setPromotions(response.promotions ?? [])
      setPagination(response.pagination ?? {
        hasMore: false,
        limit: HISTORY_PAGE_LIMIT,
        nextCursor: null,
      })
      setStatus('success')
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, 'Unable to load Promotion History.'),
      )
      setStatus('error')
    }
  }

  useEffect(() => {
    if (initialPromotions || initialStatus !== 'idle') return undefined

    let active = true

    loadPromotions({ limit: HISTORY_PAGE_LIMIT })
      .then((response) => {
        if (!active) return
        setPromotions(response.promotions ?? [])
        setPagination(response.pagination ?? {
          hasMore: false,
          limit: HISTORY_PAGE_LIMIT,
          nextCursor: null,
        })
        setStatus('success')
      })
      .catch((error) => {
        if (!active) return
        setErrorMessage(
          getErrorMessage(error, 'Unable to load Promotion History.'),
        )
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [initialPromotions, initialStatus, loadPromotions])

  const loadMore = async () => {
    if (!pagination.hasMore || !pagination.nextCursor || status === 'more') {
      return
    }

    setStatus('more')
    setErrorMessage('')

    try {
      const response = await loadPromotions({
        cursor: pagination.nextCursor,
        limit: pagination.limit ?? HISTORY_PAGE_LIMIT,
      })
      setPromotions((current) => [
        ...current,
        ...(response.promotions ?? []),
      ])
      setPagination(response.pagination ?? pagination)
      setStatus('success')
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, 'Unable to load more Promotion History.'),
      )
      setStatus('success')
    }
  }

  const togglePromotion = async (promotionId) => {
    const isExpanded = expanded.has(promotionId)

    setExpanded((current) => {
      const next = new Set(current)
      if (isExpanded) next.delete(promotionId)
      else next.add(promotionId)
      return next
    })
    if (isExpanded || details[promotionId] ||
      detailStatuses[promotionId] === 'loading') return

    setDetailStatuses((current) => ({
      ...current,
      [promotionId]: 'loading',
    }))
    setDetailErrors((current) => ({ ...current, [promotionId]: '' }))

    try {
      const response = await loadPromotion(promotionId)
      setDetails((current) => ({
        ...current,
        [promotionId]: response.promotion,
      }))
      setDetailStatuses((current) => ({
        ...current,
        [promotionId]: 'success',
      }))
    } catch (error) {
      setDetailErrors((current) => ({
        ...current,
        [promotionId]: getErrorMessage(
          error,
          'Unable to load promotion details.',
        ),
      }))
      setDetailStatuses((current) => ({
        ...current,
        [promotionId]: 'error',
      }))
    }
  }

  return (
    <div className="promotion-history-page">
      <header className="promotion-history-header">
        <div>
          <p className="eyebrow">Read-only audit trail</p>
          <h2>Promotion History</h2>
          <p>
            Review production changes previously applied through Rating Lab.
          </p>
        </div>
        <div className="promotion-history-safety" aria-label="Read-only history">
          <ShieldCheck aria-hidden="true" size={18} />
          <span><strong>Immutable history</strong><small>No production controls</small></span>
        </div>
      </header>

      <div className="promotion-history-note">
        <History aria-hidden="true" size={18} />
        <p>
          Promotion History is an audit trail. Current production settings may
          differ from older entries; production settings remain authoritative.
        </p>
      </div>

      {status === 'loading' ? (
        <div className="promotion-history-state" role="status" aria-live="polite">
          <LoaderCircle className="button-spinner" aria-hidden="true" size={20} />
          <div><strong>Loading Promotion History</strong><p>Reading durable audit records…</p></div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="promotion-history-state error" role="alert">
          <div><strong>Promotion History is unavailable</strong><p>{errorMessage}</p></div>
          <button type="button" onClick={loadFirstPage}>Try Again</button>
        </div>
      ) : null}

      {status !== 'loading' && status !== 'error' && promotions.length === 0 ? (
        <div className="promotion-history-empty">
          <strong>No production changes have been promoted from Rating Lab yet.</strong>
          <p>Successful controlled promotions will appear here.</p>
        </div>
      ) : null}

      {promotions.length > 0 ? (
        <section className="promotion-history-list" aria-label="Promotion audit records">
          {promotions.map((promotion) => {
            const isExpanded = expanded.has(promotion.promotionId)
            const detail = details[promotion.promotionId]
            const detailStatus = detailStatuses[promotion.promotionId]

            return (
              <article className="promotion-history-entry" key={promotion.promotionId}>
                <div className="promotion-history-summary">
                  <div className="promotion-history-candidate">
                    <span>{formatDate(promotion.appliedAt)}</span>
                    <strong>{promotion.candidate.label}</strong>
                    <small>{formatCandidateType(promotion.candidate.type)}</small>
                  </div>
                  <dl>
                    <div><dt>Features</dt><dd>{promotion.affectedFeatureFamilies.map(formatCandidateType).join(' · ')}</dd></div>
                    <div><dt>Changes</dt><dd>{promotion.changeCount}</dd></div>
                    <div><dt>Robustness</dt><dd>{promotion.robustnessAvailable ? 'Recorded' : 'Not recorded'}</dd></div>
                    <div><dt>Status</dt><dd><span className="promotion-history-status">{promotion.status}</span></dd></div>
                  </dl>
                  <button
                    aria-controls={`promotion-history-${promotion.promotionId}`}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} ${promotion.candidate.label} promotion details`}
                    type="button"
                    onClick={() => togglePromotion(promotion.promotionId)}
                  >
                    <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                    <ChevronDown aria-hidden="true" size={17} />
                  </button>
                </div>

                {isExpanded ? (
                  <div
                    className="promotion-history-detail"
                    id={`promotion-history-${promotion.promotionId}`}
                    role="region"
                  >
                    {detailStatus === 'loading' && !detail ? (
                      <div className="promotion-history-detail-state" role="status">
                        <LoaderCircle className="button-spinner" aria-hidden="true" size={17} />
                        <span>Loading immutable promotion details…</span>
                      </div>
                    ) : null}
                    {detailErrors[promotion.promotionId] ? (
                      <p className="form-status error" role="alert">
                        {detailErrors[promotion.promotionId]}
                      </p>
                    ) : null}
                    {detail ? <PromotionHistoryDetail promotion={detail} /> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {errorMessage && status === 'success' ? (
        <p className="form-status error" role="alert">{errorMessage}</p>
      ) : null}
      {pagination.hasMore && promotions.length > 0 ? (
        <button
          className="promotion-history-load-more"
          disabled={status === 'more'}
          type="button"
          onClick={loadMore}
        >
          {status === 'more' ? (
            <LoaderCircle className="button-spinner" aria-hidden="true" size={16} />
          ) : null}
          {status === 'more' ? 'Loading…' : 'Load More'}
        </button>
      ) : null}
    </div>
  )
}

function PromotionHistoryDetail({ promotion }) {
  const robustness = promotion.robustnessSummary
  const bootstrap = robustness?.bootstrap?.deltaBrier
  const sensitivity = robustness?.seasonSensitivity
  const intervalPercent = Number.isFinite(robustness?.method?.intervalLevel)
    ? Math.round(robustness.method.intervalLevel * 100)
    : null

  return (
    <>
      <div className="promotion-history-identifiers">
        <div><span>Promotion ID</span><strong>{promotion.promotionId}</strong></div>
        <div><span>Calibration Run</span><strong>{promotion.runId}</strong></div>
        <div><span>Candidate Type</span><strong>{formatCandidateType(promotion.candidate.type)}</strong></div>
      </div>

      <div className="model-calibration-promotion-diff promotion-history-diff">
        <div>
          <strong>Historical production diff</strong>
          <span>{promotion.changeCount} changed at promotion time</span>
        </div>
        {promotion.diff.map((group) => (
          <section key={group.family}>
            <h5>{group.label}</h5>
            <div>
              {group.fields.map((field) => (
                <p
                  className={field.changed ? 'changed' : 'unchanged'}
                  key={`${group.family}-${field.path}`}
                >
                  <span>{field.label}</span>
                  <b>{formatHistoryValue(field.path, field.before)}</b>
                  <i aria-hidden="true">→</i>
                  <b>{formatHistoryValue(field.path, field.after)}</b>
                  <small>{field.changed ? 'Changed' : 'Unchanged'}</small>
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="promotion-history-robustness" aria-label="Historical robustness summary">
        <strong>Robustness Analysis</strong>
        {robustness ? (
          <>
            <dl>
              <div><dt>Observed Δ Brier</dt><dd>{formatMetric(robustness.observed?.deltaBrier)}</dd></div>
              <div><dt>{intervalPercent ? `${intervalPercent}% ` : ''}bootstrap interval</dt><dd>{formatMetric(bootstrap?.lower)} to {formatMetric(bootstrap?.upper)}</dd></div>
              <div><dt>Better than baseline in resamples</dt><dd>{formatPercent(bootstrap?.proportionBetter)}</dd></div>
              <div><dt>Interval status</dt><dd>{typeof bootstrap?.intervalCrossesZero === 'boolean' ? (bootstrap.intervalCrossesZero ? 'Includes zero' : 'Does not include zero') : '—'}</dd></div>
              <div><dt>Season consistency</dt><dd>{Number.isFinite(sensitivity?.seasonsImproved) ? `${sensitivity.seasonsImproved} improved · ${sensitivity.seasonsEqual} equal · ${sensitivity.seasonsWorse} worse` : '—'}</dd></div>
              <div><dt>Season-removal sensitivity</dt><dd>{typeof sensitivity?.resultSensitiveToSeasonRemoval === 'boolean' ? (sensitivity.resultSensitiveToSeasonRemoval ? 'Direction changes when a season is removed' : 'No direction change when one season is removed') : '—'}</dd></div>
            </dl>
            <small>Historical descriptive results; they did not approve or authorize promotion.</small>
          </>
        ) : (
          <p>Robustness analysis was not recorded for this promotion.</p>
        )}
      </section>

      <details className="promotion-history-technical">
        <summary>Technical details</summary>
        <dl>
          <div><dt>Candidate ID</dt><dd>{promotion.candidate.candidateId}</dd></div>
          <div><dt>Candidate configuration signature</dt><dd>{promotion.candidate.configurationSignature}</dd></div>
          <div><dt>Frozen dataset signature</dt><dd>{promotion.identities.datasetSignature}</dd></div>
          <div><dt>Game IDs signature</dt><dd>{promotion.identities.gameIdSignature}</dd></div>
          <div><dt>Starting-state signature</dt><dd>{promotion.identities.startingStateSignature}</dd></div>
          <div><dt>Baseline identity</dt><dd>{promotion.baseline.identity}</dd></div>
          <div><dt>Baseline signature</dt><dd>{promotion.baseline.signature}</dd></div>
          <div><dt>Production snapshot ID</dt><dd>{promotion.identities.productionSnapshotId}</dd></div>
          <div><dt>Production identity before</dt><dd>{promotion.identities.productionStateIdentityBefore}</dd></div>
          <div><dt>Production identity after</dt><dd>{promotion.identities.productionStateIdentityAfter}</dd></div>
          <div><dt>Model version</dt><dd>{promotion.modelVersion}</dd></div>
        </dl>
      </details>
    </>
  )
}

export default PromotionHistory
