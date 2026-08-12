import { useEffect, useState } from 'react'
import { FlaskConical, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import {
  getSpecialTeamsCalibrationOptions,
  prepareSpecialTeamsCalibrationGameSeason,
  prepareSpecialTeamsReferenceSeason,
  runSpecialTeamsCalibration,
} from '../services/powerRatingSimulationsApi.js'

const formatMetric = (value, decimals = 5) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '--'

const formatPercent = (value, decimals = 1) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(decimals)}%`
    : '--'

const formatInteger = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '--'

const formatAdjustment = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue)
    ? `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(2)}`
    : '--'
}

const formatDelta = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue)
    ? `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(5)}`
    : '--'
}

const formatRawPercentage = (value) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(2)}%`
    : '--'

const getDatasetAction = (dataset = {}) => ({
  label:
    dataset.status === 'ready'
      ? 'Refresh'
      : dataset.status === 'error'
        ? 'Retry'
        : dataset.status === 'partial'
          ? 'Resume'
          : 'Prepare',
  refresh: dataset.status === 'ready',
})

const getErrorMessage = (error) => {
  const message =
    error?.message || 'Unable to run Special Teams calibration.'
  const missingGames = error?.details?.missingGameSeasonIds ?? []
  const missingReferences =
    error?.details?.missingReferenceSeasonIds ?? []
  const required = [...missingGames, ...missingReferences]

  return required.length
    ? `${message} Required: ${required.join(', ')}.`
    : message
}

function SpecialTeamsCalibration({
  initialErrorMessage = '',
  initialOptions = null,
  initialResult = null,
  loadOptions = getSpecialTeamsCalibrationOptions,
  prepareGameSeason = prepareSpecialTeamsCalibrationGameSeason,
  prepareReferenceSeason = prepareSpecialTeamsReferenceSeason,
  runCalibration = runSpecialTeamsCalibration,
} = {}) {
  const [options, setOptions] = useState(initialOptions)
  const [optionsStatus, setOptionsStatus] = useState(
    initialOptions ? 'success' : initialErrorMessage ? 'error' : 'loading',
  )
  const [selectedSeasonIds, setSelectedSeasonIds] = useState(
    initialOptions?.defaultSeasonIds ?? [],
  )
  const [customThreshold, setCustomThreshold] = useState('')
  const [preparingKey, setPreparingKey] = useState('')
  const [result, setResult] = useState(initialResult)
  const [runStatus, setRunStatus] = useState(
    initialResult ? 'success' : 'idle',
  )
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)

  useEffect(() => {
    if (initialOptions) return undefined

    let active = true
    loadOptions()
      .then((loadedOptions) => {
        if (!active) return
        setOptions(loadedOptions)
        setSelectedSeasonIds(loadedOptions.defaultSeasonIds)
        setOptionsStatus('success')
        setErrorMessage('')
      })
      .catch((error) => {
        if (!active) return
        setOptionsStatus('error')
        setErrorMessage(getErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [initialOptions, loadOptions])

  const refreshOptions = async () => {
    const loadedOptions = await loadOptions()
    setOptions(loadedOptions)
    setOptionsStatus('success')
  }

  const handlePrepareGameSeason = async (season) => {
    const action = getDatasetAction(season.historicalDataset)
    const key = `games:${season.id}`
    setPreparingKey(key)
    setErrorMessage('')
    try {
      await prepareGameSeason(season.id, { refresh: action.refresh })
      await refreshOptions()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setPreparingKey('')
    }
  }

  const handlePrepareReferenceSeason = async (season) => {
    const action = getDatasetAction(season.specialTeamsDataset)
    const key = `reference:${season.id}`
    setPreparingKey(key)
    setErrorMessage('')
    try {
      await prepareReferenceSeason(season.id, { refresh: action.refresh })
      await refreshOptions()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setPreparingKey('')
    }
  }

  const toggleSeason = (seasonId, selected) => {
    setSelectedSeasonIds((current) =>
      selected
        ? [...new Set([...current, seasonId])]
        : current.filter((candidate) => candidate !== seasonId),
    )
    setErrorMessage('')
  }

  const handleRun = async (event) => {
    event.preventDefault()
    if (runStatus === 'loading') return

    if (selectedSeasonIds.length === 0) {
      setErrorMessage('Select at least one fully prepared target season.')
      return
    }

    if (customThreshold !== '') {
      const threshold = Number(customThreshold)
      const limits = options.customThresholdLimits

      if (
        !Number.isInteger(threshold) ||
        threshold < limits.min ||
        threshold > limits.max
      ) {
        setErrorMessage(
          `Custom N must be an integer from ${limits.min} through ${limits.max}.`,
        )
        return
      }
    }

    setRunStatus('loading')
    setResult(null)
    setErrorMessage('')
    try {
      const calibration = await runCalibration({
        ...(customThreshold === ''
          ? {}
          : { customThreshold: Number(customThreshold) }),
        seasonIds: selectedSeasonIds,
      })
      setResult(calibration)
      setRunStatus('success')
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
          <strong>Loading Special Teams calibration</strong>
          <p>Checking historical games and frozen PP/PK references.</p>
        </div>
      </div>
    )
  }

  if (!options) {
    return (
      <div className="rating-lab-warning-panel" role="alert">
        <strong>Special Teams calibration is unavailable</strong>
        <p>{errorMessage}</p>
      </div>
    )
  }

  const selectedSeasons = options.seasons.filter((season) =>
    selectedSeasonIds.includes(season.id),
  )
  const allSelectedReady =
    selectedSeasons.length > 0 &&
    selectedSeasons.every((season) => season.eligibleForMainComparison)
  const thresholdCount = new Set([
    ...options.thresholdOptions,
    ...(customThreshold === '' ? [] : [Number(customThreshold)]),
  ]).size
  const combinationCount = thresholdCount * options.adjustmentOptions.length

  return (
    <div className="special-teams-calibration-lab">
      <div className="calibration-isolation-banner">
        <FlaskConical aria-hidden="true" size={22} />
        <div>
          <span>
            <strong>Phase 4 — Special Teams Matchup Calibration</strong>
            <p>
              Test whether strong PP vs weak PK and weak PP vs strong PK
              matchups improve historical win-probability calibration.
            </p>
          </span>
        </div>
        <span className="experimental-badge">Review only</span>
      </div>

      {errorMessage ? (
        <p className="form-status error" role="alert">{errorMessage}</p>
      ) : null}

      <ControlModel options={options} />
      <HistoricalReadiness
        options={options}
        preparingKey={preparingKey}
        selectedSeasonIds={selectedSeasonIds}
        onPrepareGame={handlePrepareGameSeason}
        onPrepareReference={handlePrepareReferenceSeason}
        onToggle={toggleSeason}
      />

      <form className="rating-lab-controls-panel" onSubmit={handleRun}>
        <section className="rating-lab-board">
          <div className="rating-lab-board-heading">
            <div>
              <p className="eyebrow">Automatic comparison grid</p>
              <h3>Threshold and symmetric adjustment sweep</h3>
            </div>
            <span>{combinationCount} combinations</span>
          </div>
          <div className="special-teams-grid-summary">
            <div>
              <span>Top / Bottom N</span>
              <strong>{options.thresholdOptions.join(' · ')}</strong>
            </div>
            <div>
              <span>Adjustment X</span>
              <strong>
                {options.adjustmentOptions
                  .map((value) => formatAdjustment(value))
                  .join(' · ')}
              </strong>
            </div>
            <label className="field" htmlFor="special-teams-custom-threshold">
              <span>Optional custom N</span>
              <input
                id="special-teams-custom-threshold"
                type="number"
                min={options.customThresholdLimits.min}
                max={options.customThresholdLimits.max}
                step="1"
                value={customThreshold}
                onChange={(event) => {
                  setCustomThreshold(event.target.value)
                  setErrorMessage('')
                }}
              />
            </label>
          </div>
          <p className="calibration-helper">
            Positive signals add +X; negative signals add −X. Each team is
            evaluated independently, and X=0 is the Base Model v1 control.
          </p>
          <div className="rating-lab-actions">
            <button
              className="save-ratings-button rating-lab-run-button"
              type="submit"
              disabled={runStatus === 'loading' || !allSelectedReady}
            >
              {runStatus === 'loading' ? (
                <LoaderCircle className="button-spinner" aria-hidden="true" size={18} />
              ) : (
                <Play aria-hidden="true" size={17} />
              )}
              <span>
                {runStatus === 'loading'
                  ? 'Running grid...'
                  : `Run ${combinationCount}-combination grid`}
              </span>
            </button>
          </div>
        </section>
      </form>

      {!allSelectedReady ? (
        <div className="rating-lab-warning-panel" role="status">
          <strong>Historical data is not ready</strong>
          <p>
            Prepare each selected game season and all three listed prior
            Special Teams seasons. Partial ranking windows are excluded from
            the main pooled comparison.
          </p>
        </div>
      ) : null}

      {result ? <SpecialTeamsResults result={result} /> : null}
    </div>
  )
}

function ControlModel({ options }) {
  const baseline = options.baseline

  return (
    <section className="rating-lab-board" aria-label="Phase 4 control model">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Active baseline</p>
          <h3>{baseline.name}</h3>
        </div>
        <span>{baseline.modelVersion}</span>
      </div>
      <div className="calibration-diagnostic-grid">
        <Diagnostic label="Starting ratings" value={`${baseline.startingRatings.min}–${baseline.startingRatings.max}, center ${baseline.startingRatings.center}`} />
        <Diagnostic label="Probability scale" value={baseline.probabilityScale} />
        <Diagnostic label="Base Home Advantage" value={baseline.baseHomeAdvantage} />
        <Diagnostic label="K / REG / OT / SO" value={`${baseline.kFactor} / ${baseline.regulationMultiplier} / ${baseline.overtimeMultiplier} / ${baseline.shootoutMultiplier}`} />
      </div>
      <p className="calibration-helper">
        Team Home Advantage, Rest &amp; Fatigue, Quick Rematch, injuries, and
        goalies are disabled for this isolated Phase 4 test.
      </p>
    </section>
  )
}

function HistoricalReadiness({
  onPrepareGame,
  onPrepareReference,
  onToggle,
  options,
  preparingKey,
  selectedSeasonIds,
}) {
  return (
    <section className="rating-lab-board" aria-label="Historical data readiness">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Leakage-safe inputs</p>
          <h3>Historical data readiness</h3>
        </div>
        <span>Frozen S−3 through S−1</span>
      </div>
      <div className="special-teams-readiness-layout">
        <div>
          <h4>Target game seasons</h4>
          <div className="calibration-season-grid">
            {options.seasons.map((season) => {
              const selected = selectedSeasonIds.includes(season.id)
              const action = getDatasetAction(season.historicalDataset)
              const key = `games:${season.id}`

              return (
                <div className={`calibration-season-entry ${selected ? 'selected' : ''}`} key={season.id}>
                  <label className="calibration-season-option">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => onToggle(season.id, event.target.checked)}
                    />
                    <span>
                      <strong>{season.label}</strong>
                      <small>
                        Games: {season.historicalDataset.status} · Reference:{' '}
                        {season.specialTeamsReference.complete ? 'ready' : 'missing'}
                      </small>
                    </span>
                  </label>
                  <p>
                    PP/PK reference: {season.specialTeamsReference.sourceSeasonIds.join(', ')}
                  </p>
                  {season.specialTeamsReference.missingSeasonIds.length ? (
                    <small>
                      Required: {season.specialTeamsReference.missingSeasonIds.join(', ')}
                    </small>
                  ) : null}
                  <button
                    type="button"
                    disabled={Boolean(preparingKey)}
                    onClick={() => onPrepareGame(season)}
                  >
                    <RefreshCw aria-hidden="true" size={13} />
                    {preparingKey === key ? 'Preparing...' : `${action.label} games`}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <h4>Prior-season Special Teams snapshots</h4>
          <div className="calibration-season-grid">
            {options.referenceSeasons.map((season) => {
              const action = getDatasetAction(season.specialTeamsDataset)
              const key = `reference:${season.id}`

              return (
                <div className="calibration-season-entry" key={season.id}>
                  <span className="calibration-season-option">
                    <span aria-hidden="true" />
                    <span>
                      <strong>{season.label}</strong>
                      <small>
                        {season.specialTeamsDataset.status} ·{' '}
                        {formatInteger(season.specialTeamsDataset.teamCount)} teams
                      </small>
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(preparingKey)}
                    onClick={() => onPrepareReference(season)}
                  >
                    <RefreshCw aria-hidden="true" size={13} />
                    {preparingKey === key ? 'Preparing...' : action.label}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function SpecialTeamsResults({ result }) {
  return (
    <div className="calibration-results">
      <BestTestedResult result={result} />
      <ThresholdSummary summaries={result.thresholdSummary} />
      <SignalDiagnostics summaries={result.thresholdSummary} />
      <ComparisonTable comparisons={result.comparisons} />
      <PerSeasonDiagnostics comparisons={result.comparisons} />
      <HistoricalRankingAudit rankingAudit={result.rankingAudit} />
      <section className="rating-lab-warning-panel">
        <strong>Experimental results only</strong>
        <p>
          Production remains informational alert-only. No Dashboard,
          Analyzer, Power Rating, fair-odds, or Settings value was modified.
        </p>
      </section>
    </div>
  )
}

function BestTestedResult({ result }) {
  const best = result.bestTestedResult

  return (
    <section className="rating-lab-board">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Lowest pooled Brier</p>
          <h3>Best tested result</h3>
        </div>
        <span>Not automatically recommended</span>
      </div>
      <div className="calibration-diagnostic-grid">
        <Diagnostic label="Threshold N" value={best.threshold} />
        <Diagnostic label="Adjustment X" value={formatAdjustment(best.adjustment)} />
        <Diagnostic label="Pooled Brier" value={formatMetric(best.pooledBrier)} />
        <Diagnostic label="Δ Brier" value={formatDelta(best.brierDelta)} />
        <Diagnostic label="Seasons beating baseline" value={best.seasonsBeatingBaseline} />
      </div>
    </section>
  )
}

function ThresholdSummary({ summaries = [] }) {
  return (
    <TablePanel title="Threshold-only diagnostic" detail="Occurrence breadth versus best tested X">
      <table className="rating-lab-table calibration-table">
        <thead><tr><th>N</th><th>Positive</th><th>Negative</th><th>Total signals</th><th>Games affected</th><th>Both teams signal</th><th>Affected %</th><th>Best X</th><th>Best pooled Brier</th><th>Seasons beating baseline</th></tr></thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.threshold}>
              <td><strong>{summary.threshold}</strong></td>
              <td>{formatInteger(summary.occurrences.positiveOccurrences)}</td>
              <td>{formatInteger(summary.occurrences.negativeOccurrences)}</td>
              <td>{formatInteger(summary.totalSignalOccurrences)}</td>
              <td>{formatInteger(summary.occurrences.gamesAffected)}</td>
              <td>{formatInteger(summary.occurrences.bothTeamsSignal)}</td>
              <td>{formatPercent(summary.gamesAffectedPercentage)}</td>
              <td>{formatAdjustment(summary.bestTestedAdjustment)}</td>
              <td>{formatMetric(summary.bestPooledBrier)}</td>
              <td>{summary.seasonsBeatingBaseline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  )
}

function SignalDiagnostics({ summaries = [] }) {
  return (
    <TablePanel title="Positive vs negative signal diagnostics" detail="Baseline expectations; no asymmetric optimization">
      <table className="rating-lab-table calibration-table">
        <thead><tr><th>N</th><th>Signal</th><th>Occurrences</th><th>Baseline expected win</th><th>Actual win rate</th><th>Brier contribution</th><th>Avg rank gap</th></tr></thead>
        <tbody>
          {summaries.flatMap((summary) =>
            ['positive', 'negative'].map((signal) => {
              const diagnostic = summary.signalDiagnostics[signal]
              return (
                <tr key={`${summary.threshold}-${signal}`}>
                  <td>{summary.threshold}</td>
                  <td><strong>{signal === 'positive' ? 'Positive signal only' : 'Negative signal only'}</strong></td>
                  <td>{formatInteger(diagnostic.occurrences)}</td>
                  <td>{formatPercent(diagnostic.averageBaselineExpectedWinProbability)}</td>
                  <td>{formatPercent(diagnostic.actualWinRate)}</td>
                  <td>{formatMetric(diagnostic.averageBrierContribution)}</td>
                  <td>{formatMetric(diagnostic.rankExtremity.averageRankGap, 2)}</td>
                </tr>
              )
            }),
          )}
        </tbody>
      </table>
    </TablePanel>
  )
}

function ComparisonTable({ comparisons = [] }) {
  return (
    <TablePanel title="Special Teams comparison grid" detail={`${comparisons.length} tested threshold + adjustment combinations`}>
      <table className="rating-lab-table calibration-table">
        <thead><tr><th>N</th><th>X</th><th>Positive</th><th>Negative</th><th>Games affected</th><th>Pooled Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Δ Log Loss</th><th>ECE</th><th>Accuracy</th><th>Avg season Brier</th><th>Worst season</th><th>Stability</th><th>Seasons beating baseline</th></tr></thead>
        <tbody>
          {comparisons.map((comparison) => (
            <tr className={comparison.best ? 'best-run' : ''} key={`${comparison.threshold}-${comparison.adjustment}`}>
              <td><strong>{comparison.threshold}</strong>{comparison.best ? <small>Best tested</small> : null}</td>
              <td>{formatAdjustment(comparison.adjustment)}</td>
              <td>{formatInteger(comparison.occurrences.positiveOccurrences)}</td>
              <td>{formatInteger(comparison.occurrences.negativeOccurrences)}</td>
              <td>{formatInteger(comparison.occurrences.gamesAffected)}</td>
              <td>{formatMetric(comparison.metrics.brierScore)}</td>
              <td>{formatDelta(comparison.delta.brierScore)}</td>
              <td>{formatMetric(comparison.metrics.logLoss)}</td>
              <td>{formatDelta(comparison.delta.logLoss)}</td>
              <td>{formatMetric(comparison.metrics.expectedCalibrationError)}</td>
              <td>{formatPercent(comparison.metrics.accuracy)}</td>
              <td>{formatMetric(comparison.averageSeasonBrier)}</td>
              <td>{comparison.worstSeason?.seasonId ?? '--'} · {formatMetric(comparison.worstSeason?.brierScore)}</td>
              <td>{comparison.stability.level}</td>
              <td>{comparison.seasonsBeatingBaseline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  )
}

function PerSeasonDiagnostics({ comparisons = [] }) {
  return (
    <section className="calibration-run-details">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Season stability</p><h3>Per-season diagnostics</h3></div>
      </div>
      {comparisons.map((comparison) => (
        <details className="calibration-detail-card" key={`season-${comparison.threshold}-${comparison.adjustment}`}>
          <summary>
            <span><strong>Top/Bottom {comparison.threshold} · X {formatAdjustment(comparison.adjustment)}</strong><small>{formatInteger(comparison.occurrences.gamesAffected)} games affected</small></span>
            <span>{formatMetric(comparison.metrics.brierScore)} Brier</span>
          </summary>
          <div className="rating-lab-table-scroll">
            <table className="rating-lab-table calibration-table">
              <thead><tr><th>Season</th><th>Positive</th><th>Negative</th><th>Games affected</th><th>Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Δ Log Loss</th></tr></thead>
              <tbody>
                {comparison.seasonResults.map((season) => (
                  <tr key={season.seasonId}>
                    <td><strong>{season.seasonId}</strong></td>
                    <td>{formatInteger(season.occurrences.positiveOccurrences)}</td>
                    <td>{formatInteger(season.occurrences.negativeOccurrences)}</td>
                    <td>{formatInteger(season.occurrences.gamesAffected)}</td>
                    <td>{formatMetric(season.metrics.brierScore)}</td>
                    <td>{formatDelta(season.delta.brierScore)}</td>
                    <td>{formatMetric(season.metrics.logLoss)}</td>
                    <td>{formatDelta(season.delta.logLoss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  )
}

function HistoricalRankingAudit({ rankingAudit = [] }) {
  return (
    <section className="calibration-run-details">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Leakage audit</p><h3>Frozen historical Special Teams rankings</h3></div>
      </div>
      {rankingAudit.map((reference) => (
        <details className="calibration-detail-card" key={reference.targetSeasonId}>
          <summary>
            <span><strong>{reference.targetSeasonId} Special Teams reference</strong><small>Based on {reference.sourceSeasonIds.join(' through ')}</small></span>
            <span>{reference.leagueTeamCount} teams</span>
          </summary>
          <div className="rating-lab-table-scroll">
            <table className="rating-lab-table calibration-table">
              <thead><tr><th>Team</th><th>3-season PP%</th><th>PP rank</th><th>3-season PK%</th><th>PK rank</th><th>Source identities</th></tr></thead>
              <tbody>
                {reference.teams.map((team) => (
                  <tr key={team.teamAbbreviation}>
                    <td><strong>{team.teamAbbreviation}</strong></td>
                    <td>{formatRawPercentage(team.averagePowerPlayPercentage)}</td>
                    <td>{team.powerPlayLeagueRank ?? '--'}</td>
                    <td>{formatRawPercentage(team.averagePenaltyKillPercentage)}</td>
                    <td>{team.penaltyKillLeagueRank ?? '--'}</td>
                    <td>{team.seasonValues.map((season) => season.sourceTeamAbbreviation ?? 'missing').join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  )
}

function TablePanel({ children, detail, title }) {
  return (
    <section className="rating-lab-board calibration-table-panel">
      <div className="rating-lab-board-heading"><h3>{title}</h3><span>{detail}</span></div>
      <div className="rating-lab-table-scroll">{children}</div>
    </section>
  )
}

function Diagnostic({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}

export default SpecialTeamsCalibration
