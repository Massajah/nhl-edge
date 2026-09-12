import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
} from 'lucide-react'
import {
  fetchModelPerformance,
  fetchModelPerformanceGames,
} from '../services/modelPerformanceApi.js'
import {
  CAPTURE_HEALTH_FILTER_BY_CHECKPOINT,
  GAME_STATUS_OPTIONS,
  MODEL_PERFORMANCE_TABS,
  buildPriceTimelinePoints,
  createModelPerformanceFilters,
  formatCalibrationBucket,
  formatCaptureCoverage,
  formatGameDate,
  formatNumber,
  formatOdds,
  formatPercent,
  formatPerformanceReason,
  formatProbability,
  formatSignedNumber,
  formatTimestamp,
  formatUnits,
  getCalibrationChartPoint,
  getCaptureHealthLabel,
  getMetricTone,
  getResultSummary,
  getSampleState,
  getSelectedModel,
  isCaptureHealthStatusFilter,
  shortenFingerprint,
} from '../utils/modelPerformance.js'

const DEFAULT_GAMES_LIMIT = 20

function ModelPerformance({
  initialAggregate = null,
  initialAggregateError = '',
  initialAggregateStatus = '',
  initialExpandedGameIds = [],
  initialGames = null,
  initialGamesError = '',
  initialGamesStatus = '',
  initialTab = 'forward',
  loadAggregate = fetchModelPerformance,
  loadGames = fetchModelPerformanceGames,
  onNavigate,
} = {}) {
  const initialFilters = {
    ...createModelPerformanceFilters(),
    modelVersion: initialAggregate?.metadata?.modelVersion ?? '',
    season: initialAggregate?.metadata?.season?.id ?? '',
  }
  const [activeTab, setActiveTab] = useState(initialTab)
  const [aggregate, setAggregate] = useState(initialAggregate)
  const [aggregateStatus, setAggregateStatus] = useState(
    initialAggregateStatus || (initialAggregate ? 'success' : 'loading'),
  )
  const [aggregateError, setAggregateError] = useState(initialAggregateError)
  const [draftFilters, setDraftFilters] = useState(initialFilters)
  const [appliedFilters, setAppliedFilters] = useState(initialFilters)
  const [games, setGames] = useState(initialGames)
  const [gamesStatus, setGamesStatus] = useState(
    initialGamesStatus || (initialGames ? 'success' : 'idle'),
  )
  const [gamesError, setGamesError] = useState(initialGamesError)
  const [gamesPage, setGamesPage] = useState(
    initialGames?.pagination?.page ?? 1,
  )
  const [gameStatusFilter, setGameStatusFilter] = useState(
    initialGames?.filters?.status ?? 'all',
  )
  const [expandedGameIds, setExpandedGameIds] = useState(
    () => new Set(initialExpandedGameIds),
  )
  const skipInitialAggregateLoad = useRef(Boolean(initialAggregate))
  const skipInitialGamesLoad = useRef(Boolean(initialGames))

  const gamesRequest = useMemo(
    () => ({
      ...appliedFilters,
      limit: DEFAULT_GAMES_LIMIT,
      page: gamesPage,
      status: gameStatusFilter,
    }),
    [appliedFilters, gameStatusFilter, gamesPage],
  )

  useEffect(() => {
    if (skipInitialAggregateLoad.current) {
      skipInitialAggregateLoad.current = false
      return undefined
    }

    let active = true
    setAggregateStatus('loading')
    setAggregateError('')

    loadAggregate(appliedFilters)
      .then((result) => {
        if (!active) return
        setAggregate(result)
        setAggregateStatus('success')
        setDraftFilters((current) => ({
          ...current,
          modelVersion:
            current.modelVersion || result.metadata?.modelVersion || '',
          season: current.season || result.metadata?.season?.id || '',
        }))
      })
      .catch((error) => {
        if (!active) return
        setAggregateStatus('error')
        setAggregateError(error.message)
      })

    return () => {
      active = false
    }
  }, [appliedFilters, loadAggregate])

  useEffect(() => {
    if (activeTab !== 'games') return undefined
    if (skipInitialGamesLoad.current) {
      skipInitialGamesLoad.current = false
      return undefined
    }

    let active = true
    setGamesStatus('loading')
    setGamesError('')

    loadGames(gamesRequest)
      .then((result) => {
        if (!active) return
        setGames(result)
        setGamesStatus('success')
      })
      .catch((error) => {
        if (!active) return
        setGamesStatus('error')
        setGamesError(error.message)
      })

    return () => {
      active = false
    }
  }, [activeTab, gamesRequest, loadGames])

  const applyFilters = (event) => {
    event.preventDefault()
    setGamesPage(1)
    setExpandedGameIds(new Set())
    setGames(null)
    setAppliedFilters({ ...draftFilters })
  }

  const resetFilters = () => {
    const defaults = createModelPerformanceFilters()
    skipInitialAggregateLoad.current = false
    skipInitialGamesLoad.current = false
    setDraftFilters(defaults)
    setAppliedFilters(defaults)
    setGamesPage(1)
    setGameStatusFilter('all')
    setGames(null)
    setExpandedGameIds(new Set())
  }

  const retryAggregate = () => {
    skipInitialAggregateLoad.current = false
    setAppliedFilters((current) => ({ ...current }))
  }

  const retryGames = () => {
    skipInitialGamesLoad.current = false
    setGamesStatus('loading')
    setGamesError('')
    setGamesPage((current) => current)
    loadGames(gamesRequest)
      .then((result) => {
        setGames(result)
        setGamesStatus('success')
        setGamesError('')
      })
      .catch((error) => {
        setGamesStatus('error')
        setGamesError(error.message)
      })
  }

  const toggleGame = (gameId) => {
    setExpandedGameIds((current) => {
      const next = new Set(current)

      if (next.has(gameId)) next.delete(gameId)
      else next.add(gameId)
      return next
    })
  }

  const inspectCaptureGap = (statusFilter) => {
    setActiveTab('games')
    setGameStatusFilter(statusFilter)
    setGamesPage(1)
    setGames(null)
    setExpandedGameIds(new Set())
  }

  return (
    <section className="model-performance-page" aria-label="Model Performance">
      <div className="model-performance-intro">
        <div>
          <p className="eyebrow">Production measurement</p>
          <h2>Forward performance, without hindsight</h2>
          <p>
            Based on immutable official pregame predictions captured at T2.
          </p>
        </div>
        <button
          className="model-performance-rating-lab-link"
          type="button"
          onClick={() => onNavigate?.('rating-lab')}
        >
          Historical backtest in Rating Lab
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>

      <PerformanceFilters
        aggregate={aggregate}
        filters={draftFilters}
        isLoading={aggregateStatus === 'loading'}
        onApply={applyFilters}
        onChange={setDraftFilters}
        onReset={resetFilters}
      />

      {aggregateStatus === 'error' ? (
        <PerformanceMessage
          actionLabel="Try again"
          message={aggregateError || 'The aggregate could not be loaded.'}
          onAction={retryAggregate}
          title="Model Performance unavailable"
          tone="error"
        />
      ) : null}

      {aggregateStatus === 'loading' && !aggregate ? (
        <PerformanceLoading label="Loading forward performance" />
      ) : null}

      {aggregate ? (
        <>
          <CoverageBanner
            aggregate={aggregate}
            onInspectCaptureGap={inspectCaptureGap}
          />
          {aggregate.metadata?.mixedSettings ? (
            <div className="model-performance-info" role="status">
              <AlertCircle aria-hidden="true" size={18} />
              <span>
                Multiple model settings configurations exist in this cohort
                ({aggregate.metadata.settingsFingerprintCount} fingerprints).
              </span>
            </div>
          ) : null}

          <div
            className="model-performance-tabs"
            role="tablist"
            aria-label="Model Performance views"
          >
            {MODEL_PERFORMANCE_TABS.map((tab) => (
              <button
                aria-controls={`model-performance-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                id={`model-performance-tab-${tab.id}`}
                key={tab.id}
                role="tab"
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`model-performance-tab-${activeTab}`}
            className="model-performance-tab-panel"
            id={`model-performance-panel-${activeTab}`}
            role="tabpanel"
          >
            {activeTab === 'forward' ? (
              <ForwardModelTab aggregate={aggregate} />
            ) : null}
            {activeTab === 'bets' ? (
              <BetsClvTab aggregate={aggregate} />
            ) : null}
            {activeTab === 'games' ? (
              <GamesTab
                errorMessage={gamesError}
                expandedGameIds={expandedGameIds}
                games={games}
                status={gamesStatus}
                statusFilter={gameStatusFilter}
                onPageChange={setGamesPage}
                onRetry={retryGames}
                onStatusChange={(value) => {
                  setGameStatusFilter(value)
                  setGamesPage(1)
                  setGames(null)
                  setExpandedGameIds(new Set())
                }}
                onToggleGame={toggleGame}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}

function PerformanceFilters({
  aggregate,
  filters,
  isLoading,
  onApply,
  onChange,
  onReset,
}) {
  const seasons = aggregate?.metadata?.availableSeasons ?? []
  const versions = aggregate?.metadata?.availableModelVersions ?? []

  return (
    <form className="model-performance-filters" onSubmit={onApply}>
      <label className="field" htmlFor="model-performance-season">
        <span>Season</span>
        <select
          id="model-performance-season"
          value={filters.season}
          onChange={(event) =>
            onChange((current) => ({ ...current, season: event.target.value }))
          }
        >
          {seasons.length === 0 ? <option value="">Current season</option> : null}
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.label}{season.isCurrent ? ' · Current' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="field" htmlFor="model-performance-from">
        <span>From</span>
        <input
          id="model-performance-from"
          type="date"
          value={filters.from}
          onChange={(event) =>
            onChange((current) => ({ ...current, from: event.target.value }))
          }
        />
      </label>

      <label className="field" htmlFor="model-performance-to">
        <span>To</span>
        <input
          id="model-performance-to"
          type="date"
          value={filters.to}
          onChange={(event) =>
            onChange((current) => ({ ...current, to: event.target.value }))
          }
        />
      </label>

      <label className="field" htmlFor="model-performance-version">
        <span>Model version</span>
        <select
          id="model-performance-version"
          value={filters.modelVersion}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              modelVersion: event.target.value,
            }))
          }
        >
          {versions.length === 0 ? (
            <option value="">Latest relevant version</option>
          ) : null}
          {versions.map((version) => (
            <option key={version} value={version}>{version}</option>
          ))}
        </select>
      </label>

      <div className="model-performance-filter-actions">
        <button type="submit" disabled={isLoading}>Apply</button>
        <button className="secondary" type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </form>
  )
}

function CoverageBanner({ aggregate, onInspectCaptureGap }) {
  const forward = aggregate.coverage?.forward ?? {}
  const bets = aggregate.coverage?.bets ?? {}
  const official = forward.officialPredictions ?? 0
  const relevantBets = bets.totalRelevantBets ?? 0
  const captureHealth = aggregate.captureHealth ?? {}
  const officialT2 = captureHealth.officialT2 ?? {}
  const expectedOfficial = officialT2.expectedOfficialT2
  const capturedOfficial = officialT2.capturedOfficialT2
  const missedOfficial = officialT2.missedOfficialT2
  const officialCaptureAvailable =
    expectedOfficial !== null && expectedOfficial !== undefined

  return (
    <aside className="model-performance-coverage" aria-label="Data coverage">
      <div className="model-performance-coverage-heading">
        <div>
          <span>Data coverage</span>
          <strong>{aggregate.metadata?.season?.label ?? 'Selected season'}</strong>
        </div>
        <span className={`coverage-state ${aggregate.dataQuality?.status ?? 'partial'}`}>
          {aggregate.dataQuality?.status === 'complete' ? 'Complete' : 'Coverage varies'}
        </span>
      </div>
      <div className="model-performance-coverage-grid">
        <CoverageItem
          label="Official T2 captures"
          onClick={
            Number(missedOfficial) > 0
              ? () => onInspectCaptureGap?.('missed_official_t2')
              : null
          }
          supporting={
            officialCaptureAvailable
              ? `${formatPercent(officialT2.officialT2CoveragePercent)} · ${missedOfficial} missed`
              : 'Unavailable'
          }
          value={
            officialCaptureAvailable
              ? formatCaptureCoverage(capturedOfficial, expectedOfficial)
              : `${official} captured`
          }
        />
        <CoverageItem
          label="Resolved results"
          value={`${forward.validFinalResults ?? 0} / ${official}`}
          supporting={formatPercent(forward.resultCoveragePercent)}
        />
        <CoverageItem
          label="T2 market"
          value={`${forward.validT2Markets ?? 0} / ${official}`}
          supporting={formatPercent(forward.t2MarketCoveragePercent)}
        />
        <CoverageItem
          label="FINAL market"
          value={`${forward.validFinalMarkets ?? 0} / ${official}`}
          supporting={formatPercent(forward.finalMarketCoveragePercent)}
        />
        <CoverageItem
          label="CLV eligible"
          value={`${bets.sameBookClvEligibleBets ?? 0} / ${relevantBets} bets`}
          supporting={formatPercent(bets.clvCoveragePercent)}
        />
      </div>
      <CaptureHealthPanel
        captureHealth={captureHealth}
        onInspectCaptureGap={onInspectCaptureGap}
      />
      {aggregate.dataQuality?.status === 'partial' ? (
        <p>Missing coverage is informational and is not treated as model failure.</p>
      ) : null}
    </aside>
  )
}

function CoverageItem({ label, onClick, supporting = '', value }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {supporting ? <small>{supporting}</small> : null}
    </>
  )

  return onClick ? (
    <button className="coverage-item actionable" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="coverage-item">{content}</div>
  )
}

function CaptureHealthPanel({ captureHealth, onInspectCaptureGap }) {
  const checkpoints = captureHealth?.marketCheckpoints ?? {}
  const status = captureHealth?.status ?? 'UNAVAILABLE'

  return (
    <section className="capture-health-panel" aria-label="Market checkpoint coverage">
      <div className="capture-health-heading">
        <span>Market checkpoint coverage</span>
        <strong className={`capture-health-state ${status.toLowerCase()}`}>
          {getCaptureHealthLabel(captureHealth)}
        </strong>
      </div>
      <div className="capture-health-grid">
        {['T24', 'T6', 'T2', 'FINAL'].map((checkpoint) => {
          const coverage = checkpoints[checkpoint] ?? {}
          const missing = coverage.missingCount
          const available =
            coverage.expectedCount !== null &&
            coverage.expectedCount !== undefined
          const content = (
            <>
              <span>{checkpoint}</span>
              <strong>
                {formatCaptureCoverage(
                  coverage.capturedCount,
                  coverage.expectedCount,
                )}
              </strong>
              <small>
                {!available
                  ? 'Unavailable'
                  : coverage.status === 'NOT_DUE'
                    ? 'Not due'
                    : `${formatPercent(coverage.coveragePercent)} · ${missing} missing`}
              </small>
            </>
          )

          return Number(missing) > 0 ? (
            <button
              className="capture-health-item missed"
              key={checkpoint}
              type="button"
              onClick={() =>
                onInspectCaptureGap?.(
                  CAPTURE_HEALTH_FILTER_BY_CHECKPOINT[checkpoint],
                )
              }
            >
              {content}
            </button>
          ) : (
            <div
              className={`capture-health-item ${String(coverage.status ?? 'UNAVAILABLE').toLowerCase()}`}
              key={checkpoint}
            >
              {content}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ForwardModelTab({ aggregate }) {
  const overview = aggregate.forwardOverview ?? {}
  const finalComparison = aggregate.marketComparison?.final ?? {}
  const t2Comparison = aggregate.marketComparison?.t2 ?? {}
  const movement = aggregate.marketComparison?.movementTowardModel ?? {}
  const modelSample = overview.modelBrier?.sampleSize ?? 0
  const sampleState = getSampleState(modelSample)
  const official = aggregate.coverage?.forward?.officialPredictions ?? 0

  return (
    <div className="model-performance-content">
      <div className={`model-performance-sample-state ${sampleState.id}`}>
        <strong>{sampleState.label}</strong>
        <span>n={modelSample} resolved official predictions</span>
      </div>

      {official === 0 ? (
        <PerformanceMessage
          message="Official forward observations will appear after valid T2 captures. Historical backtests remain available in Rating Lab."
          title="No forward performance data yet"
        />
      ) : modelSample === 0 ? (
        <PerformanceMessage
          message="Official predictions exist, but no valid final results are available yet."
          title="Waiting for resolved games"
        />
      ) : Number(aggregate.coverage?.forward?.validT2Markets ?? 0) === 0 &&
        Number(aggregate.coverage?.forward?.validFinalMarkets ?? 0) === 0 ? (
        <PerformanceMessage
          message="Model results remain available, but no paired T2 or FINAL market observations can be compared for this cohort."
          title="Market coverage unavailable"
        />
      ) : null}

      <section aria-labelledby="forward-overview-title">
        <SectionHeading
          id="forward-overview-title"
          supporting="Lower Brier is better"
          title="Forward model"
        />
        <div className="performance-kpi-grid primary">
          <MetricCard
            emphasis="primary"
            label="Model Brier"
            sampleSize={overview.modelBrier?.sampleSize}
            supporting="Official T2 model"
            value={formatNumber(overview.modelBrier?.value)}
          />
          <MetricCard
            label="FINAL Market Brier"
            sampleSize={finalComparison.pairedSampleSize}
            supporting="Paired no-vig consensus"
            value={formatNumber(finalComparison.finalMarketBrier ?? finalComparison.marketBrier)}
          />
          <MetricCard
            emphasis="primary"
            label="Brier Improvement vs FINAL"
            sampleSize={finalComparison.pairedSampleSize}
            supporting="Positive favors NHL Edge"
            tone={getMetricTone(
              finalComparison.brierImprovement,
              finalComparison.pairedSampleSize,
            )}
            value={formatSignedNumber(finalComparison.brierImprovement)}
          />
          <MetricCard
            label="Accuracy"
            sampleSize={overview.accuracy?.sampleSize}
            supporting={`${overview.accuracy?.correctCount ?? 0} correct · ${overview.accuracy?.noPickCount ?? 0} no-pick`}
            value={formatPercent(overview.accuracy?.accuracyPercent)}
          />
        </div>
      </section>

      <section aria-labelledby="market-diagnostics-title">
        <SectionHeading
          id="market-diagnostics-title"
          supporting="Directional diagnostics"
          title="Market context"
        />
        <div className="performance-kpi-grid secondary-row">
          <MetricCard
            label="T2 Market Brier"
            sampleSize={t2Comparison.pairedSampleSize}
            supporting="Paired no-vig consensus"
            value={formatNumber(t2Comparison.marketBrier)}
          />
          <MetricCard
            label="Brier Improvement vs T2"
            sampleSize={t2Comparison.pairedSampleSize}
            supporting="Positive favors NHL Edge"
            tone={getMetricTone(
              t2Comparison.brierImprovement,
              t2Comparison.pairedSampleSize,
            )}
            value={formatSignedNumber(t2Comparison.brierImprovement)}
          />
          <article className="performance-kpi-card movement-card">
            <span>Market moved toward model</span>
            <strong>{formatPercent(movement.towardPercent)}</strong>
            <p>
              {movement.towardCount ?? 0} toward · {movement.awayCount ?? 0} away ·{' '}
              {movement.unchangedCount ?? 0} unchanged
            </p>
            <small>n={movement.sampleSize ?? 0} · directional diagnostic only</small>
            {movement.sampleSize > 0 ? (
              <div className="movement-distance">
                T2 {formatNumber(movement.averageDistanceAtT2PercentagePoints, 1)} pp
                <ArrowRight aria-hidden="true" size={14} />
                FINAL {formatNumber(movement.averageDistanceAtFinalPercentagePoints, 1)} pp
              </div>
            ) : null}
          </article>
        </div>
      </section>

      <CalibrationPanel buckets={aggregate.calibration ?? []} />
      <DataQualityPanel dataQuality={aggregate.dataQuality} />
    </div>
  )
}

function MetricCard({
  emphasis = 'secondary',
  label,
  sampleSize = 0,
  supporting,
  tone = 'neutral',
  value,
}) {
  return (
    <article className={`performance-kpi-card ${emphasis} ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{supporting}</p>
      <small>n={sampleSize ?? 0}</small>
    </article>
  )
}

function CalibrationPanel({ buckets }) {
  const points = buckets
    .map((bucket) => ({ bucket, point: getCalibrationChartPoint(bucket) }))
    .filter(({ point }) => point)

  return (
    <section className="calibration-panel" aria-labelledby="calibration-title">
      <SectionHeading
        id="calibration-title"
        supporting="Favorite confidence"
        title="Calibration"
      />
      <div className="calibration-content">
        <div className="calibration-chart-wrap">
          <svg
            aria-label="Actual favorite win rate compared with predicted probability"
            className="calibration-chart"
            role="img"
            viewBox="0 0 420 245"
          >
            <line className="calibration-grid-line" x1="48" x2="380" y1="210" y2="210" />
            <line className="calibration-grid-line" x1="48" x2="380" y1="122" y2="122" />
            <line className="calibration-grid-line" x1="48" x2="380" y1="34" y2="34" />
            <line className="calibration-perfect-line" x1="48" x2="380" y1="122" y2="34" />
            <text x="14" y="214">0%</text>
            <text x="8" y="126">50%</text>
            <text x="2" y="38">100%</text>
            <text x="42" y="232">50%</text>
            <text x="202" y="232">75%</text>
            <text x="361" y="232">100%</text>
            {points.map(({ bucket, point }) => (
              <circle
                aria-label={`${formatCalibrationBucket(bucket)}, actual ${formatProbability(bucket.actualWinRate)}, n=${bucket.sampleSize}`}
                className={`calibration-point ${point.state}`}
                cx={point.x}
                cy={point.y}
                key={`${bucket.lowerBound}-${bucket.upperBound}`}
                r={point.state === 'normal' ? 6 : 5}
              >
                <title>{`${formatCalibrationBucket(bucket)} · predicted ${formatProbability(bucket.averagePredictedProbability)} · actual ${formatProbability(bucket.actualWinRate)} · n=${bucket.sampleSize}`}</title>
              </circle>
            ))}
          </svg>
          <div className="calibration-chart-legend">
            <span><i className="normal" /> n≥25</span>
            <span><i className="cautious" /> n=10–24</span>
            <span><i className="sparse" /> n&lt;10</span>
          </div>
        </div>
        <div className="calibration-table-scroll">
          <table className="calibration-table">
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">Predicted</th>
                <th scope="col">Actual</th>
                <th scope="col">Gap</th>
                <th scope="col">n</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr className={bucket.sampleSize < 10 ? 'sparse' : ''} key={bucket.lowerBound}>
                  <th scope="row">{formatCalibrationBucket(bucket)}</th>
                  <td>{formatProbability(bucket.averagePredictedProbability)}</td>
                  <td>{formatProbability(bucket.actualWinRate)}</td>
                  <td>{formatSignedNumber(bucket.calibrationGapPercentagePoints, 1, ' pp')}</td>
                  <td>{bucket.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function BetsClvTab({ aggregate }) {
  const bets = aggregate.betPerformance ?? {}
  const clv = aggregate.clv ?? {}
  const hasBets = Number(bets.totalRelevantBets) > 0

  return (
    <div className="model-performance-content">
      <section aria-labelledby="bets-clv-title">
        <SectionHeading
          id="bets-clv-title"
          supporting="Saved bets only"
          title="Bets & closing value"
        />
        {!hasBets ? (
          <PerformanceMessage
            message="Saved bets in the selected period will appear here. Bet results remain separate from all-game model performance."
            title="No bets in this period"
          />
        ) : null}
        <div className="performance-kpi-grid primary">
          <MetricCard
            label="Settled Bets"
            sampleSize={bets.settledBets}
            supporting={`${bets.pendingBets ?? 0} open excluded`}
            value={bets.settledBets ?? 0}
          />
          <MetricCard
            label="Profit"
            sampleSize={bets.settledBets}
            supporting="Stored settlement profit"
            tone={getMetricTone(bets.profit, bets.settledBets)}
            value={formatUnits(bets.profit)}
          />
          <MetricCard
            label="ROI"
            sampleSize={bets.settledBets}
            supporting="Settled stake only"
            tone={getMetricTone(bets.roiPercent, bets.settledBets)}
            value={formatPercent(bets.roiPercent)}
          />
          <MetricCard
            emphasis="primary"
            label="Average Same-Book CLV"
            sampleSize={clv.eligibleBetCount}
            supporting={`Median ${formatPercent(clv.medianClvPercent)}`}
            tone={getMetricTone(clv.averageClvPercent, clv.eligibleBetCount)}
            value={formatSignedNumber(clv.averageClvPercent, 1, '%')}
          />
        </div>
      </section>

      <section className="bet-performance-summary" aria-label="Bet result summary">
        <div>
          <span>Record</span>
          <strong>
            {bets.wins ?? 0}–{bets.losses ?? 0}–{bets.pushes ?? 0}–{bets.voids ?? 0}
          </strong>
          <small>W–L–Push–Void</small>
        </div>
        <div>
          <span>CLV coverage</span>
          <strong>{clv.eligibleBetCount ?? 0} / {bets.totalRelevantBets ?? 0}</strong>
          <small>{formatPercent(clv.coveragePercent)}</small>
        </div>
        <div>
          <span>CLV outcomes</span>
          <strong>
            {clv.positiveClvCount ?? 0} + · {clv.negativeClvCount ?? 0} − · {clv.zeroClvCount ?? 0} flat
          </strong>
          <small>Same-book FINAL only</small>
        </div>
        <div>
          <span>vs Best FINAL</span>
          <strong>{formatSignedNumber(clv.vsBestFinal?.averagePercent, 1, '%')}</strong>
          <small>Separate comparison · n={clv.vsBestFinal?.eligibleBetCount ?? 0}</small>
        </div>
      </section>

      {hasBets && Number(clv.eligibleBetCount) === 0 ? (
        <PerformanceMessage
          message="No saved bet has a safely linked, later same-book FINAL price. Manual odds and incomplete legacy metadata remain unavailable by design."
          title="Same-book CLV unavailable"
        />
      ) : null}
      <DataQualityPanel dataQuality={{
        reasons: aggregate.dataQuality?.bets?.reasons,
        reasonCounts: aggregate.dataQuality?.bets?.reasonCounts,
      }} />
    </div>
  )
}

function GamesTab({
  errorMessage,
  expandedGameIds,
  games,
  onPageChange,
  onRetry,
  onStatusChange,
  onToggleGame,
  status,
  statusFilter,
}) {
  if (status === 'loading' && !games) {
    return <PerformanceLoading label="Loading game details" />
  }

  if (status === 'error') {
    return (
      <PerformanceMessage
        actionLabel="Try again"
        message={errorMessage || 'The game drill-down could not be loaded.'}
        onAction={onRetry}
        title="Games unavailable"
        tone="error"
      />
    )
  }

  const rows = games?.items ?? []
  const captureGapView = isCaptureHealthStatusFilter(statusFilter)
  const pagination = games?.pagination ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    page: 1,
    totalItems: 0,
    totalPages: 0,
  }

  return (
    <div className="model-performance-content">
      <div className="games-toolbar">
        <div>
          <h3>Official game observations</h3>
          <p>Each row explains the inputs behind the aggregate.</p>
        </div>
        <label className="field" htmlFor="model-performance-game-status">
          <span>Status</span>
          <select
            id="model-performance-game-status"
            value={statusFilter}
            onChange={(event) => onStatusChange(event.target.value)}
          >
            {GAME_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {status === 'loading' ? (
        <div className="games-refreshing" role="status">
          <RefreshCw aria-hidden="true" size={15} /> Refreshing games…
        </div>
      ) : null}

      {status === 'success' && rows.length === 0 ? (
        <PerformanceMessage
          message={
            captureGapView
              ? 'No overdue missing captures match this checkpoint filter.'
              : 'Try another status or broaden the selected date range.'
          }
          title={captureGapView ? 'No capture gaps' : 'No games match these filters'}
        />
      ) : null}

      {rows.length > 0 ? (
        captureGapView ? (
          <CaptureGapList rows={rows} />
        ) : (
          <>
          <div className="performance-games-table-wrap">
            <table className="performance-games-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Game</th>
                  <th scope="col">Model</th>
                  <th scope="col">T2 Market</th>
                  <th scope="col">FINAL Market</th>
                  <th scope="col">Result</th>
                  <th scope="col">Bet / Profit</th>
                  <th scope="col">CLV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = expandedGameIds.has(row.gameId)

                  return (
                    <Fragment key={`${row.gameId}-${row.scheduledStart}`}>
                      <GameTableRow
                        expanded={expanded}
                        row={row}
                        onToggle={() => onToggleGame(row.gameId)}
                      />
                      {expanded ? (
                        <tr className="performance-game-detail-row">
                          <td colSpan="8"><GameDetails row={row} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="performance-game-cards">
            {rows.map((row) => (
              <GameCard
                expanded={expandedGameIds.has(row.gameId)}
                key={`${row.gameId}-${row.scheduledStart}`}
                row={row}
                onToggle={() => onToggleGame(row.gameId)}
              />
            ))}
          </div>
          </>
        )
      ) : null}

      <Pagination pagination={pagination} onPageChange={onPageChange} />
    </div>
  )
}

function CaptureGapList({ rows }) {
  return (
    <>
      <div className="performance-games-table-wrap capture-gap-table-wrap">
        <table className="performance-games-table capture-gap-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Game</th>
              <th scope="col">Missing capture</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.gameId}-${row.scheduledStart}-${row.captureCheckpoint}`}>
                <td>{formatGameDate(row.scheduledStart)}</td>
                <th scope="row">{row.awayTeamId} @ {row.homeTeamId}</th>
                <td><strong>{row.captureCheckpoint}</strong></td>
                <td>{formatPerformanceReason(row.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="performance-game-cards capture-gap-cards">
        {rows.map((row) => (
          <article
            className="performance-game-card capture-gap-card"
            key={`${row.gameId}-${row.scheduledStart}-${row.captureCheckpoint}`}
          >
            <small>{formatGameDate(row.scheduledStart)}</small>
            <strong>{row.awayTeamId} @ {row.homeTeamId}</strong>
            <span>{row.captureCheckpoint}</span>
            <p>{formatPerformanceReason(row.reason)}</p>
          </article>
        ))}
      </div>
    </>
  )
}

function GameTableRow({ expanded, onToggle, row }) {
  const model = getSelectedModel(row)
  const bet = row.betDetails?.[0]

  return (
    <tr>
      <td>{formatGameDate(row.scheduledStart)}</td>
      <th scope="row">
        <button
          aria-expanded={expanded}
          className="game-expand-button"
          type="button"
          onClick={onToggle}
        >
          <span>{row.awayTeamId} @ {row.homeTeamId}</span>
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </th>
      <td><ModelCell model={model} /></td>
      <td><MarketCell market={row.t2Market} /></td>
      <td><MarketCell market={row.finalMarket} /></td>
      <td><span className={`game-result-status ${row.status?.toLowerCase()}`}>{getResultSummary(row)}</span></td>
      <td><BetCell bet={bet} count={row.bets?.betCount} /></td>
      <td><ClvCell bet={bet} /></td>
    </tr>
  )
}

function GameCard({ expanded, onToggle, row }) {
  const model = getSelectedModel(row)
  const bet = row.betDetails?.[0]

  return (
    <article className="performance-game-card">
      <button
        aria-expanded={expanded}
        className="performance-game-card-heading"
        type="button"
        onClick={onToggle}
      >
        <span>
          <small>{formatGameDate(row.scheduledStart)}</small>
          <strong>{row.awayTeamId} @ {row.homeTeamId}</strong>
        </span>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
      <div className="performance-game-card-grid">
        <div><span>Model</span><ModelCell model={model} /></div>
        <div><span>FINAL market</span><MarketCell market={row.finalMarket} /></div>
        <div><span>Result</span><strong>{getResultSummary(row)}</strong></div>
        <div><span>Bet / CLV</span><BetCell bet={bet} count={row.bets?.betCount} /><ClvCell bet={bet} /></div>
      </div>
      {expanded ? <GameDetails row={row} /> : null}
    </article>
  )
}

function ModelCell({ model }) {
  return model ? (
    <span className="game-table-stack">
      <strong>{model.label}</strong>
      <span>{formatProbability(model.probability)}</span>
      <small>Fair {formatOdds(model.fairOdds)}</small>
    </span>
  ) : <span className="unavailable-value">Unavailable</span>
}

function MarketCell({ market }) {
  return market?.status === 'available' ? (
    <span className="game-table-stack">
      <strong>{formatProbability(market.homeProbability)} home</strong>
      <small>{market.bookmakerCount} {market.bookmakerCount === 1 ? 'book' : 'books'}</small>
    </span>
  ) : (
    <span className="unavailable-value">
      {market?.reason ? formatPerformanceReason(market.reason) : 'Unavailable'}
    </span>
  )
}

function BetCell({ bet, count = 0 }) {
  if (!bet) return <span className="unavailable-value">No bet</span>

  return (
    <span className="game-table-stack">
      <strong>{bet.selectedSide?.teamId || bet.selectedSide?.homeAway || 'Bet'} @ {formatOdds(bet.marketOdds)}</strong>
      <span>{String(bet.result ?? 'pending').toUpperCase()} · {formatUnits(bet.profit)}</span>
      {count > 1 ? <small>{count} saved bets</small> : null}
    </span>
  )
}

function ClvCell({ bet }) {
  const comparison = bet?.closingComparison

  return comparison?.status === 'available' ? (
    <span className="game-table-stack">
      <strong>{formatSignedNumber(comparison.clvPercent, 1, '%')}</strong>
      <small>Same-book</small>
    </span>
  ) : (
    <span className="unavailable-value">
      {comparison?.reason ? formatPerformanceReason(comparison.reason) : '—'}
    </span>
  )
}

function GameDetails({ row }) {
  const adjustments = Object.keys(row.model?.adjustments?.home ?? {})
  const betDetails = row.betDetails ?? []

  return (
    <div className="performance-game-details">
      <section>
        <h4>Official Model</h4>
        <dl className="performance-detail-grid">
          <DetailValue label="Model version" value={row.modelVersion} />
          <DetailValue
            label="Settings fingerprint"
            title={row.settingsFingerprint}
            value={shortenFingerprint(row.settingsFingerprint)}
          />
          <DetailValue label="Generated" value={formatTimestamp(row.generatedAt)} />
          <DetailValue
            label={`${row.homeTeamId} probability @ T2`}
            value={formatProbability(row.model?.homeWinProbability)}
          />
          <DetailValue
            label={`${row.homeTeamId} fair odds @ T2`}
            value={formatOdds(row.model?.homeFairOdds)}
          />
          <DetailValue
            label={`${row.awayTeamId} fair odds @ T2`}
            value={formatOdds(row.model?.awayFairOdds)}
          />
          <DetailValue
            label={`${row.homeTeamId} base → effective`}
            value={`${formatNumber(row.model?.state?.home?.baseRating, 1)} → ${formatNumber(row.model?.state?.home?.effectiveRating, 1)}`}
          />
          <DetailValue
            label={`${row.awayTeamId} base → effective`}
            value={`${formatNumber(row.model?.state?.away?.baseRating, 1)} → ${formatNumber(row.model?.state?.away?.effectiveRating, 1)}`}
          />
        </dl>
        {adjustments.length > 0 ? (
          <div className="performance-adjustments" aria-label="Automatic adjustments">
            {adjustments.map((key) => (
              <span key={key}>
                {key.replace(/([A-Z])/g, ' $1')} · {row.homeTeamId}{' '}
                {formatSignedNumber(row.model.adjustments.home[key], 1)} / {row.awayTeamId}{' '}
                {formatSignedNumber(row.model.adjustments.away?.[key], 1)}
              </span>
            ))}
          </div>
        ) : null}
        <CompletenessSummary completeness={row.completeness} />
      </section>

      <section>
        <h4>Market</h4>
        <dl className="performance-detail-grid">
          <DetailValue
            label="T2 no-vig consensus"
            value={`${formatProbability(row.t2Market?.homeProbability)} ${row.homeTeamId}`}
          />
          <DetailValue
            label="T2 bookmaker count"
            value={
              row.t2Market?.status === 'available'
                ? `${row.t2Market.bookmakerCount} ${row.t2Market.bookmakerCount === 1 ? 'book' : 'books'}`
                : '—'
            }
          />
          <DetailValue
            label="FINAL no-vig consensus"
            value={`${formatProbability(row.finalMarket?.homeProbability)} ${row.homeTeamId}`}
          />
          <DetailValue
            label="FINAL bookmaker count"
            value={
              row.finalMarket?.status === 'available'
                ? `${row.finalMarket.bookmakerCount} ${row.finalMarket.bookmakerCount === 1 ? 'book' : 'books'}`
                : '—'
            }
          />
          <DetailValue
            label="T2 distance to model"
            value={`${formatNumber(row.marketDistance?.t2PercentagePoints, 1)} pp`}
          />
          <DetailValue
            label="FINAL distance to model"
            value={`${formatNumber(row.marketDistance?.finalPercentagePoints, 1)} pp`}
          />
        </dl>
        <p className="performance-detail-note">
          Consensus values are bookmaker-level, two-sided no-vig probabilities—not Best FINAL prices.
        </p>
      </section>

      <section className="performance-game-bets">
        <h4>Bet & closing comparison</h4>
        {betDetails.length === 0 ? (
          <p className="performance-detail-note">No bet was saved for this game.</p>
        ) : (
          betDetails.map((bet, index) => (
            <BetDetail bet={bet} index={index} key={bet.id || index} row={row} />
          ))
        )}
      </section>

      <section>
        <h4>Data quality</h4>
        {row.reasons?.length ? (
          <div className="performance-reason-list">
            {row.reasons.map((reason) => (
              <span key={reason}>{formatPerformanceReason(reason)}</span>
            ))}
          </div>
        ) : (
          <p className="performance-detail-note">No missing-data reasons for this observation.</p>
        )}
      </section>
    </div>
  )
}

function BetDetail({ bet, index, row }) {
  const points = buildPriceTimelinePoints(bet)
  const closing = bet.closingComparison ?? {}

  return (
    <article className="performance-bet-detail">
      <div className="performance-bet-detail-heading">
        <strong>{bet.selectedSide?.teamId || `Bet ${index + 1}`}</strong>
        <span>{bet.bookmaker?.name || bet.bookmaker?.key || 'Bookmaker unavailable'}</span>
      </div>
      <dl className="performance-detail-grid bet-values">
        <DetailValue
          label="Official Model Fair Odds @ T2"
          value={formatOdds(
            bet.selectedSide?.homeAway === 'away'
              ? row.model?.awayFairOdds
              : bet.selectedSide?.homeAway === 'home'
                ? row.model?.homeFairOdds
                : null,
          )}
        />
        <DetailValue
          label="Model Fair Odds @ Bet"
          value={formatOdds(bet.modelAtBet?.fairOdds)}
        />
        <DetailValue
          label="Model Probability @ Bet"
          value={formatProbability(bet.modelAtBet?.probability)}
        />
        <DetailValue label="Bet Odds" value={formatOdds(bet.marketOdds)} />
        <DetailValue
          label="Same-book FINAL"
          value={formatOdds(closing.sameBookFinalOdds)}
        />
        <DetailValue
          label="Same-book CLV"
          value={formatSignedNumber(closing.clvPercent, 1, '%')}
        />
        <DetailValue
          label="Edge @ Bet"
          value={formatSignedNumber(
            bet.modelAtBet?.probabilityEdge == null
              ? null
              : bet.modelAtBet.probabilityEdge * 100,
            1,
            ' pp',
          )}
        />
        <DetailValue
          label="EV @ Bet"
          value={formatSignedNumber(bet.expectedValuePercent, 1, '%')}
        />
        <DetailValue label="Stake" value={bet.stake == null ? '—' : `${formatNumber(bet.stake, 2)}u`} />
        <DetailValue label="Result / profit" value={`${String(bet.result).toUpperCase()} · ${formatUnits(bet.profit)}`} />
        <DetailValue label="vs Best FINAL" value={formatSignedNumber(closing.vsBestFinalPercent, 1, '%')} />
        <DetailValue label="Best FINAL odds" value={formatOdds(closing.bestFinalOdds)} />
      </dl>
      {points.length > 0 ? <PriceTimeline points={points} /> : null}
      <p className="performance-detail-note">
        Official T2 and Model @ Bet are separate stored observations. Missing Bet values are not reconstructed.
      </p>
      {closing.status !== 'available' && closing.reason ? (
        <p className="performance-clv-unavailable">
          Same-book CLV unavailable: {formatPerformanceReason(closing.reason)}.
        </p>
      ) : null}
    </article>
  )
}

function PriceTimeline({ points }) {
  return (
    <div className="price-timeline" aria-label="Saved bet price timeline">
      {points.map((point, index) => (
        <Fragment key={point.key}>
          <div className={`price-timeline-point ${point.key}`}>
            <span>{point.label}</span>
            <strong>{formatOdds(point.odds)}</strong>
            <small>{point.observedAt ? formatTimestamp(point.observedAt) : ''}</small>
          </div>
          {index < points.length - 1 ? <ArrowRight aria-hidden="true" size={16} /> : null}
        </Fragment>
      ))}
      <p>
        Earliest captured market is NHL Edge’s first stored valid same-book price, not the bookmaker’s opening odds.
      </p>
    </div>
  )
}

function CompletenessSummary({ completeness }) {
  if (!completeness) return null

  const entries = Object.entries(completeness).flatMap(([category, value]) => {
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([side, status]) => [
        `${category} · ${side}`,
        status,
      ])
    }

    return [[category, value]]
  })

  return (
    <div className="performance-completeness" aria-label="Prediction completeness">
      {entries.map(([label, value]) => (
        <span key={label}><strong>{label}</strong>{String(value).replaceAll('_', ' ')}</span>
      ))}
    </div>
  )
}

function DetailValue({ label, title, value }) {
  return (
    <div title={title}>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  )
}

function DataQualityPanel({ dataQuality = {} }) {
  const reasons = dataQuality?.reasons ?? []
  const counts = dataQuality?.reasonCounts ?? {}

  if (reasons.length === 0) return null

  return (
    <section className="performance-data-quality" aria-labelledby="data-quality-title">
      <SectionHeading id="data-quality-title" title="Data quality" />
      <div className="performance-reason-list">
        {reasons.map((reason) => (
          <span key={reason}>
            {formatPerformanceReason(reason)}
            {Number(counts[reason]) > 0 ? ` · ${counts[reason]}` : ''}
          </span>
        ))}
      </div>
    </section>
  )
}

function SectionHeading({ id, supporting = '', title }) {
  return (
    <div className="model-performance-section-heading">
      <h3 id={id}>{title}</h3>
      {supporting ? <span>{supporting}</span> : null}
    </div>
  )
}

function Pagination({ onPageChange, pagination }) {
  if (!pagination || pagination.totalItems === 0) return null

  return (
    <nav className="model-performance-pagination" aria-label="Games pagination">
      <button
        aria-label="Previous games page"
        disabled={!pagination.hasPreviousPage}
        type="button"
        onClick={() => onPageChange(pagination.page - 1)}
      >
        <ChevronLeft aria-hidden="true" size={17} /> Previous
      </button>
      <span>
        Page {pagination.page} of {Math.max(1, pagination.totalPages)} · {pagination.totalItems} games
      </span>
      <button
        aria-label="Next games page"
        disabled={!pagination.hasNextPage}
        type="button"
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Next <ChevronRight aria-hidden="true" size={17} />
      </button>
    </nav>
  )
}

function PerformanceLoading({ label }) {
  return (
    <div className="model-performance-loading" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <div><strong>{label}</strong><p>Reading the selected official cohort.</p></div>
    </div>
  )
}

function PerformanceMessage({
  actionLabel = '',
  message,
  onAction,
  title,
  tone = 'neutral',
}) {
  return (
    <div className={`model-performance-message ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div><strong>{title}</strong><p>{message}</p></div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  )
}

export {
  BetsClvTab,
  CalibrationPanel,
  CaptureGapList,
  CaptureHealthPanel,
  CoverageBanner,
  ForwardModelTab,
  GameCard,
  GameDetails,
  GameTableRow,
  GamesTab,
  MetricCard,
  PerformanceFilters,
  PriceTimeline,
}

export default ModelPerformance
