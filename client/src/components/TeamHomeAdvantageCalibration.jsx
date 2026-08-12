import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import {
  getHomeAdvantageCalibrationOptions,
  prepareHomeAdvantageHistoricalSeason,
  runHomeAdvantageCalibration,
} from '../services/powerRatingSimulationsApi.js'
import {
  HOME_ADVANTAGE_SORT_OPTIONS,
  createHomeAdvantagePayload,
  formatAdjustment,
  formatCalibrationDelta,
  formatCalibrationMetric,
  formatHomeRate,
  formatPercentagePoints,
  formatSeasonLabel,
  getDatasetAction,
  getDatasetStatusLabel,
  sortHomeAdvantageTeams,
  validateCustomAdjustment,
} from '../utils/teamHomeAdvantageCalibration.js'

const getErrorMessage = (error) => {
  const message = error?.message || 'Unable to load Team Home Advantage calibration.'
  const missing = error?.details?.missingSeasonIds

  return Array.isArray(missing) && missing.length > 0
    ? `${message} Required: ${missing.join(', ')}.`
    : message
}

function TeamHomeAdvantageCalibration({
  initialErrorMessage = '',
  initialOptions = null,
  initialResult = null,
  loadOptions = getHomeAdvantageCalibrationOptions,
  prepareSeason = prepareHomeAdvantageHistoricalSeason,
  runCalibration = runHomeAdvantageCalibration,
} = {}) {
  const [options, setOptions] = useState(initialOptions)
  const [optionsStatus, setOptionsStatus] = useState(
    initialOptions ? 'success' : initialErrorMessage ? 'error' : 'loading',
  )
  const [result, setResult] = useState(initialResult)
  const [runStatus, setRunStatus] = useState(initialResult ? 'success' : 'idle')
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [customAdjustment, setCustomAdjustment] = useState('')
  const [selectedAdjustment, setSelectedAdjustment] = useState(0)
  const [preparingSeasonId, setPreparingSeasonId] = useState('')
  const [sortState, setSortState] = useState({
    direction: 'desc',
    key: 'homePointsAdvantage',
  })

  useEffect(() => {
    if (initialOptions) {
      return undefined
    }

    let active = true

    loadOptions()
      .then((loadedOptions) => {
        if (active) {
          setOptions(loadedOptions)
          setOptionsStatus('success')
          setErrorMessage('')
        }
      })
      .catch((error) => {
        if (active) {
          setOptionsStatus('error')
          setErrorMessage(getErrorMessage(error))
        }
      })

    return () => { active = false }
  }, [initialOptions, loadOptions])

  const tierAlgorithmVersion = options?.defaults?.tierBoundaryConfig?.version
  const activeResult = result?.diagnostics?.tierAlgorithmVersion === tierAlgorithmVersion
    ? result
    : null
  const currentAnalysis = activeResult?.currentAnalysis ?? options?.currentAnalysis
  const sortedTeams = useMemo(
    () => sortHomeAdvantageTeams(currentAnalysis?.teams, sortState),
    [currentAnalysis?.teams, sortState],
  )
  const selectedComparison = activeResult?.comparisons?.find(
    (comparison) => comparison.adjustment === Number(selectedAdjustment),
  )
  const effectiveAdjustment = selectedComparison?.adjustment ?? Number(selectedAdjustment)
  const customError = validateCustomAdjustment(
    customAdjustment,
    options?.defaults?.maxCustomAdjustment ?? 5,
  )

  const refreshOptions = async () => {
    const loadedOptions = await loadOptions()
    setOptions(loadedOptions)
    setResult(null)
    setRunStatus('idle')
    setOptionsStatus('success')
  }

  const handlePrepare = async (season) => {
    const action = getDatasetAction(season.historicalDataset)
    setPreparingSeasonId(season.id)
    setErrorMessage('')

    try {
      await prepareSeason(season.id, { refresh: action.refresh })
      await refreshOptions()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setPreparingSeasonId('')
    }
  }

  const handleRun = async (event) => {
    event.preventDefault()

    if (customError || runStatus === 'loading') {
      return
    }

    setRunStatus('loading')
    setErrorMessage('')

    try {
      const calibration = await runCalibration(
        createHomeAdvantagePayload(customAdjustment),
      )
      setResult(calibration)
      setRunStatus('success')
      const best = calibration.comparisons?.find((comparison) => comparison.best)
      if (best) {
        setSelectedAdjustment(best.adjustment)
      }
    } catch (error) {
      setRunStatus('error')
      setErrorMessage(getErrorMessage(error))
    }
  }

  if (optionsStatus === 'loading') {
    return (
      <div className="rating-lab-loading-state" role="status">
        <LoaderCircle className="button-spinner" aria-hidden="true" size={20} />
        <div>
          <strong>Loading Team Home Advantage</strong>
          <p>Checking prepared historical datasets and current ranking inputs.</p>
        </div>
      </div>
    )
  }

  if (!options) {
    return (
      <div className="rating-lab-warning-panel" role="alert">
        <strong>Team Home Advantage is unavailable</strong>
        <p>{errorMessage}</p>
      </div>
    )
  }

  return (
    <div className="home-advantage-lab">
      <div className="calibration-isolation-banner">
        <FlaskConical aria-hidden="true" size={22} />
        <div>
          <strong>Production-isolated Phase 2</strong>
          <p>
            Measure persistent team-specific home performance and test whether
            simple home-strength tiers improve the Base Model. This lab never
            writes Team Home Adjustments.
          </p>
        </div>
        <span>Experimental</span>
      </div>

      {errorMessage ? <p className="form-status error" role="alert">{errorMessage}</p> : null}

      <HistoricalReadiness
        options={options}
        preparingSeasonId={preparingSeasonId}
        onPrepare={handlePrepare}
      />

      {currentAnalysis ? (
        <>
          <CurrentRanking
            sortState={sortState}
            sortedTeams={sortedTeams}
            onSortChange={setSortState}
          />
          <TierDiagnostics analysis={currentAnalysis} stability={options.stability} />
        </>
      ) : (
        <div className="rating-lab-empty-state">
          <strong>Current ranking inputs are incomplete</strong>
          <p>
            Prepare {options.readiness.missingCurrentRankingSeasonIds.join(', ')}
            {' '}to calculate the Current 3-Year Home Strength Ranking.
          </p>
        </div>
      )}

      <BacktestSetup
        customAdjustment={customAdjustment}
        customError={customError}
        options={options}
        runStatus={runStatus}
        selectedAdjustment={selectedAdjustment}
        onCustomAdjustment={setCustomAdjustment}
        onRun={handleRun}
        onSelectedAdjustment={setSelectedAdjustment}
      />

      {activeResult ? <CalibrationResults result={activeResult} /> : null}

      {currentAnalysis ? (
        <RecommendationPreview
          adjustment={effectiveAdjustment}
          analysis={currentAnalysis}
          baseHomeAdvantage={options.defaults.baseHomeAdvantage}
        />
      ) : null}
    </div>
  )
}

function HistoricalReadiness({ onPrepare, options, preparingSeasonId }) {
  return (
    <section className="rating-lab-board home-advantage-readiness">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Historical data reuse</p>
          <h3>Leakage-safe season readiness</h3>
        </div>
        <span>{options.readiness.backtestReady ? 'Backtest ready' : 'More history required'}</span>
      </div>
      <p className="calibration-helper">
        Each target season is classified from its three completed predecessor
        seasons. Target-season results never participate in its tier assignment,
        and tiers are frozen before replay.
      </p>
      <div className="home-advantage-season-grid">
        {options.seasons.map((season) => {
          const action = getDatasetAction(season.historicalDataset)
          const isPreparing = preparingSeasonId === season.id

          return (
            <article key={season.id}>
              <div>
                <strong>{season.label}</strong>
                <small>{season.purposes.join(' · ').replaceAll('_', ' ')}</small>
              </div>
              <span className={`dataset-status ${season.historicalDataset.status}`}>
                {getDatasetStatusLabel(season.historicalDataset)}
              </span>
              <button
                type="button"
                disabled={Boolean(preparingSeasonId)}
                onClick={() => onPrepare(season)}
              >
                {isPreparing ? <LoaderCircle className="button-spinner" size={14} /> : <RefreshCw size={14} />}
                {isPreparing ? 'Working...' : action.label}
              </button>
            </article>
          )
        })}
      </div>
      {!options.readiness.backtestReady ? (
        <p className="calibration-coverage-warning">
          Additional required seasons: {options.readiness.missingBacktestSeasonIds.join(', ')}.
        </p>
      ) : null}
      <div className="home-advantage-backtest-plan">
        {options.backtestPlan.map((plan) => (
          <span key={plan.targetSeasonId}>
            <strong>{plan.targetSeasonId}</strong> ← {plan.sourceSeasonIds.join(', ')}
          </span>
        ))}
      </div>
    </section>
  )
}

function CurrentRanking({ onSortChange, sortedTeams, sortState }) {
  return (
    <section className="rating-lab-table-panel home-advantage-ranking">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Production planning preview</p>
          <h3>Current 3-Year Home Strength Ranking</h3>
        </div>
        <label className="calibration-sort">
          <span>Sort by</span>
          <select
            value={sortState.key}
            onChange={(event) => onSortChange({ direction: 'desc', key: event.target.value })}
          >
            {HOME_ADVANTAGE_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="calibration-helper">
        2023–24, 2024–25, and 2025–26 raw games are combined before percentages
        are calculated. Default order is Home Points Advantage descending.
        Arizona Coyotes and Utah Hockey Club history is explicitly carried into
        the current Utah Mammoth franchise through the centralized identity map;
        no unrelated franchises are merged.
      </p>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table">
          <thead><tr>
            <th>Rank</th><th>Team</th><th>Home GP</th><th>Home P%</th>
            <th>Away P%</th><th>Home P% advantage</th><th>Home W%</th>
            <th>Away W%</th><th>Home W% advantage</th><th>Tier</th>
          </tr></thead>
          <tbody>
            {sortedTeams.map((team) => (
              <tr key={team.teamId}>
                <td>{team.rank}</td><td><strong>{team.teamName}</strong><small>{team.abbreviation}</small></td>
                <td>{team.home.gamesPlayed}</td><td>{formatHomeRate(team.home.pointsPercentage)}</td>
                <td>{formatHomeRate(team.away.pointsPercentage)}</td>
                <td>{formatPercentagePoints(team.homePointsAdvantage, 2)}</td>
                <td>{formatHomeRate(team.home.winPercentage)}</td>
                <td>{formatHomeRate(team.away.winPercentage)}</td>
                <td>{formatPercentagePoints(team.homeWinAdvantage)}</td>
                <td><span className={`home-tier ${team.tier.toLowerCase()}`}>{team.tier}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TierDiagnostics({ analysis, stability }) {
  const boundaries = analysis.tierBoundaries
  const sizes = analysis.tierSizes

  return (
    <section className="home-advantage-diagnostics">
      <div className="rating-lab-board">
        <div className="rating-lab-board-heading">
          <h3>Tier summary</h3>
          <span>Strong: {sizes.strong} · Normal: {sizes.normal} · Weak: {sizes.weak}</span>
        </div>
        <p className="calibration-helper">
          Tier boundaries follow local gaps in the 3-year Home P% Advantage ranking
          and avoid splitting effectively tied teams.
        </p>
        <div className="home-advantage-tier-summary">
          {analysis.tierSummary.map((tier) => (
            <article key={tier.tier}>
              <strong>{tier.tier}</strong><span>{tier.teamCount} teams</span>
              <small>Average {formatPercentagePoints(tier.averageHomePointsAdvantage)}</small>
              <small>Median {formatPercentagePoints(tier.medianHomePointsAdvantage)}</small>
            </article>
          ))}
        </div>
        <div className="home-advantage-backtest-plan">
          {[
            ['Strong / Normal boundary', boundaries.strongNormal],
            ['Normal / Weak boundary', boundaries.normalWeak],
          ].map(([label, boundary]) => (
            <span key={label}>
              <strong>{label}</strong>{' '}
              {formatPercentagePoints(boundary.upper.homePointsAdvantage, 2)} →{' '}
              {formatPercentagePoints(boundary.lower.homePointsAdvantage, 2)} · Gap:{' '}
              {Number.isFinite(boundary.gap)
                ? formatPercentagePoints(Math.abs(boundary.gap), 2).replace(/^\+/, '')
                : '--'}
            </span>
          ))}
        </div>
        <div className="home-advantage-league-summary">
          <span>League Home P% <strong>{formatHomeRate(analysis.league.homePointsPercentage)}</strong></span>
          <span>League Away P% <strong>{formatHomeRate(analysis.league.awayPointsPercentage)}</strong></span>
          <span>League Home W% <strong>{formatHomeRate(analysis.league.homeWinPercentage)}</strong></span>
          <span>League Away W% <strong>{formatHomeRate(analysis.league.awayWinPercentage)}</strong></span>
        </div>
      </div>
      <div className="rating-lab-board">
        <div className="rating-lab-board-heading"><h3>Tier stability diagnostics</h3><span>Diagnostic only</span></div>
        {stability ? (
          <>
            <p className="calibration-helper">Latest three-year tier compared with the previous available three-season window.</p>
            <div className="home-advantage-retention">
              <span>Strong-tier retention <strong>{formatHomeRate(stability.strongRetention.rate)}</strong></span>
              <span>Weak-tier retention <strong>{formatHomeRate(stability.weakRetention.rate)}</strong></span>
            </div>
            <div className="home-advantage-stability-list">
              {stability.teams.map((team) => (
                <span key={team.teamId}>{team.teamName}: Previous {team.previousTier ?? '--'} / Latest {team.currentTier} · <strong>{team.status}</strong></span>
              ))}
            </div>
          </>
        ) : <p className="calibration-helper">Prepare the previous window to calculate Stable / Changed and tier retention.</p>}
      </div>
    </section>
  )
}

function BacktestSetup({
  customAdjustment,
  customError,
  onCustomAdjustment,
  onRun,
  onSelectedAdjustment,
  options,
  runStatus,
  selectedAdjustment,
}) {
  const choices = options.defaults.adjustmentOptions

  return (
    <section className="rating-lab-board home-advantage-test">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Calibration test</p><h3>Symmetric tier adjustment</h3></div>
        <span>Base HA stays {options.defaults.baseHomeAdvantage.toFixed(1)}</span>
      </div>
      <p className="calibration-helper">
        Strong = Base HA + X, Normal = Base HA, Weak = Base HA − X. The modifier
        applies only to the home team. No statistical-significance claim is made.
      </p>
      <div className="home-advantage-backtest-plan">
        <span><strong>Start</strong> 42–50 (center 46)</span>
        <span><strong>Scale</strong> 20</span>
        <span><strong>K</strong> 1.3</span>
        <span><strong>Reg / OT / SO</strong> 1.0 / 0.4 / 0.1</span>
      </div>
      <form onSubmit={onRun}>
        <div className="home-advantage-x-options">
          {choices.map((adjustment) => (
            <label key={adjustment} className={Number(selectedAdjustment) === adjustment ? 'selected' : ''}>
              <input type="radio" name="tier-adjustment" checked={Number(selectedAdjustment) === adjustment} onChange={() => onSelectedAdjustment(adjustment)} />
              <span>{adjustment === 0 ? 'No team adjustment' : formatAdjustment(adjustment)}</span>
            </label>
          ))}
          <label className="field">
            <span>Custom X</span>
            <input type="number" min="0" max={options.defaults.maxCustomAdjustment} step="0.01" value={customAdjustment} onChange={(event) => { onCustomAdjustment(event.target.value); if (event.target.value !== '') onSelectedAdjustment(Number(event.target.value)) }} />
          </label>
        </div>
        {customError ? <p className="form-status error">{customError}</p> : null}
        <button className="save-ratings-button" type="submit" disabled={!options.readiness.backtestReady || runStatus === 'loading' || Boolean(customError)}>
          {runStatus === 'loading' ? <LoaderCircle className="button-spinner" size={17} /> : <Play size={17} />}
          {runStatus === 'loading' ? 'Running comparison...' : 'Run tier comparison'}
        </button>
      </form>
    </section>
  )
}

function CalibrationResults({ result }) {
  return (
    <section className="rating-lab-table-panel home-advantage-results">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Leakage-safe backtest</p><h3>Backtest comparison</h3></div>
        <span>Lower pooled Brier is primary</span>
      </div>
      <div className="home-advantage-backtest-plan">
        <span><strong>Tier sizes by target season</strong> Strong / Normal / Weak</span>
        {result.snapshots.map((snapshot) => (
          <span key={snapshot.targetSeasonId}>
            <strong>{formatSeasonLabel(snapshot.targetSeasonId)}</strong>{' '}
            {snapshot.tierSizes.strong} / {snapshot.tierSizes.normal} / {snapshot.tierSizes.weak}
          </span>
        ))}
      </div>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table">
          <thead><tr><th>Adjustment</th><th>Brier</th><th>Δ Brier</th><th>Log loss</th><th>Δ Log Loss</th><th>ECE</th><th>Accuracy</th><th>Avg season Brier</th><th>Worst season</th><th>Stability</th><th>Seasons beating baseline</th></tr></thead>
          <tbody>
            {result.comparisons.map((comparison) => (
              <tr className={comparison.best ? 'best-run' : ''} key={comparison.adjustment}>
                <td><strong>{formatAdjustment(comparison.adjustment)}</strong>{comparison.best ? <small>Best Brier</small> : null}</td>
                <td>{formatCalibrationMetric(comparison.metrics.brierScore)}</td>
                <td>{formatCalibrationDelta(comparison.delta.brierScore)}</td>
                <td>{formatCalibrationMetric(comparison.metrics.logLoss)}</td>
                <td>{formatCalibrationDelta(comparison.delta.logLoss)}</td>
                <td>{formatCalibrationMetric(comparison.metrics.expectedCalibrationError)}</td>
                <td>{formatHomeRate(comparison.metrics.accuracy)}</td>
                <td>{formatCalibrationMetric(comparison.averageSeasonBrier)}</td>
                <td>{comparison.worstSeason.seasonId} · {formatCalibrationMetric(comparison.worstSeason.brierScore)}</td>
                <td>{comparison.stability.level}</td>
                <td>{comparison.seasonsBeatingBaseline}/{comparison.seasonResults.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RecommendationPreview({ adjustment, analysis, baseHomeAdvantage }) {
  return (
    <section className="rating-lab-board home-advantage-preview">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Read-only recommendation preview</p><h3>Current 3-Year Home Strength Ranking</h3></div>
        <span>Selected test adjustment: {formatAdjustment(adjustment)}</span>
      </div>
      <div className="home-advantage-preview-grid">
        {['Strong', 'Normal', 'Weak'].map((tier) => (
          <article key={tier}>
            <strong>{tier}</strong>
            <span>Effective HA {(
              baseHomeAdvantage + (tier === 'Strong' ? adjustment : tier === 'Weak' ? -adjustment : 0)
            ).toFixed(2)}</span>
            <p>{analysis.teams.filter((team) => team.tier === tier).map((team) => team.teamName).join(', ')}</p>
          </article>
        ))}
      </div>
      <p className="calibration-helper">Preview only. Production Team Home Adjustments remain unchanged.</p>
    </section>
  )
}

export default TeamHomeAdvantageCalibration
