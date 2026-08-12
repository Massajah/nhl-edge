import { useEffect, useState } from 'react'
import { FlaskConical, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import {
  getScheduleCalibrationOptions,
  prepareScheduleCalibrationSeason,
  runScheduleCalibration,
} from '../services/powerRatingSimulationsApi.js'

const WELL_RESTED_ID = 'well_rested'

const formatMetric = (value, decimals = 5) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '--'

const formatPercent = (value) =>
  Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '--'

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

const getErrorMessage = (error) => {
  const message = error?.message || 'Unable to run Schedule & Context calibration.'
  const missing = error?.details?.missingSeasonIds
  return Array.isArray(missing) && missing.length
    ? `${message} Required: ${missing.join(', ')}.`
    : message
}

const getDatasetAction = (dataset = {}) => ({
  label:
    dataset.status === 'ready'
      ? 'Refresh'
      : dataset.status === 'partial'
        ? 'Resume'
        : 'Prepare',
  refresh: dataset.status === 'ready',
})

const getPrimaryRules = (options) =>
  options?.primaryRules ??
  (options?.rules ?? []).filter((rule) => rule.id !== WELL_RESTED_ID)

const getOptionalRules = (options) =>
  options?.optionalRules ??
  (options?.rules ?? []).filter((rule) => rule.id === WELL_RESTED_ID)

const createCombinedRestConfiguration = (options) =>
  Object.fromEntries(
    (options?.rules ?? []).map((rule) => [
      rule.id,
      rule.id === WELL_RESTED_ID ? 0 : rule.productionValue,
    ]),
  )

const createCombinedQuickRematch = (options) => {
  const reference = options?.quickRematch?.productionReference ?? {}
  return {
    enabled: reference.enabled ?? true,
    loserAdjustment: reference.loserAdjustment ?? 0.25,
    maximumDays: reference.maximumDays ?? 5,
  }
}

function ScheduleContextCalibration({
  initialErrorMessage = '',
  initialOptions = null,
  initialResult = null,
  loadOptions = getScheduleCalibrationOptions,
  prepareSeason = prepareScheduleCalibrationSeason,
  runCalibration = runScheduleCalibration,
} = {}) {
  const [options, setOptions] = useState(initialOptions)
  const [optionsStatus, setOptionsStatus] = useState(
    initialOptions ? 'success' : initialErrorMessage ? 'error' : 'loading',
  )
  const [result, setResult] = useState(initialResult)
  const [runStatus, setRunStatus] = useState(initialResult ? 'success' : 'idle')
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [selectedSeasonIds, setSelectedSeasonIds] = useState(
    initialOptions?.defaultSeasonIds ?? [],
  )
  const [customValues, setCustomValues] = useState({})
  const [combinedConfiguration, setCombinedConfiguration] = useState(() =>
    createCombinedRestConfiguration(initialOptions),
  )
  const [includeWellRested, setIncludeWellRested] = useState(false)
  const [quickRematchGrid, setQuickRematchGrid] = useState({
    customAdjustment: '',
    customWindow: '',
  })
  const [combinedQuickRematch, setCombinedQuickRematch] = useState(() =>
    createCombinedQuickRematch(initialOptions),
  )
  const [preparingSeasonId, setPreparingSeasonId] = useState('')

  useEffect(() => {
    if (initialOptions) return undefined

    let active = true
    loadOptions()
      .then((loadedOptions) => {
        if (active) {
          setOptions(loadedOptions)
          setSelectedSeasonIds(loadedOptions.defaultSeasonIds)
          setCombinedConfiguration(
            createCombinedRestConfiguration(loadedOptions),
          )
          setCombinedQuickRematch(createCombinedQuickRematch(loadedOptions))
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

  const refreshOptions = async () => {
    const loadedOptions = await loadOptions()
    setOptions(loadedOptions)
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
      setErrorMessage('Select at least one prepared season.')
      return
    }

    setRunStatus('loading')
    setResult(null)
    setErrorMessage('')
    try {
      const calibration = await runCalibration({
        combinedConfiguration,
        combinedScheduleContext: {
          includeWellRested,
          quickRematch: combinedQuickRematch,
          restFatigue: combinedConfiguration,
        },
        customValues: Object.fromEntries(
          Object.entries(customValues).filter(([, value]) => value !== ''),
        ),
        includeWellRested,
        quickRematchGrid: Object.fromEntries(
          Object.entries(quickRematchGrid).filter(([, value]) => value !== ''),
        ),
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
        <div><strong>Loading Schedule &amp; Context calibration</strong><p>Checking prepared historical seasons and production references.</p></div>
      </div>
    )
  }

  if (!options) {
    return (
      <div className="rating-lab-warning-panel" role="alert">
        <strong>Schedule &amp; Context calibration is unavailable</strong>
        <p>{errorMessage}</p>
      </div>
    )
  }

  const primaryRules = getPrimaryRules(options)
  const optionalRules = getOptionalRules(options)
  const allSelectedReady = selectedSeasonIds.every(
    (seasonId) => options.seasons.find((season) => season.id === seasonId)
      ?.historicalDataset?.status === 'ready',
  )
  const quickWindowChoices = [...new Set([
    ...options.quickRematch.windowOptions,
    combinedQuickRematch.maximumDays,
    ...(quickRematchGrid.customWindow === ''
      ? []
      : [Number(quickRematchGrid.customWindow)]),
  ])].filter(Number.isFinite).sort((left, right) => left - right)
  const quickAdjustmentChoices = [...new Set([
    ...options.quickRematch.adjustmentOptions,
    combinedQuickRematch.loserAdjustment,
    ...(quickRematchGrid.customAdjustment === ''
      ? []
      : [Number(quickRematchGrid.customAdjustment)]),
  ])].filter(Number.isFinite).sort((left, right) => left - right)

  return (
    <div className="schedule-context-lab">
      <div className="calibration-isolation-banner">
        <FlaskConical aria-hidden="true" size={22} />
        <div>
          <strong>Production-isolated Schedule &amp; Context calibration</strong>
          <p>Phase 3 tests production-active fatigue rules, Quick Rematch, and their additive interaction with chronological historical replay.</p>
        </div>
        <span>Review only</span>
      </div>

      {errorMessage ? <p className="form-status error" role="alert">{errorMessage}</p> : null}

      <ControlModel options={options} />
      <SeasonSelection
        options={options}
        preparingSeasonId={preparingSeasonId}
        selectedSeasonIds={selectedSeasonIds}
        onPrepare={handlePrepare}
        onToggle={toggleSeason}
      />

      <form onSubmit={handleRun}>
        <Phase3A
          combinedConfiguration={combinedConfiguration}
          customValues={customValues}
          includeWellRested={includeWellRested}
          options={options}
          optionalRules={optionalRules}
          primaryRules={primaryRules}
          onCombinedConfiguration={setCombinedConfiguration}
          onCustomValues={setCustomValues}
          onIncludeWellRested={setIncludeWellRested}
        />

        <Phase3B
          combinedQuickRematch={combinedQuickRematch}
          options={options}
          quickAdjustmentChoices={quickAdjustmentChoices}
          quickRematchGrid={quickRematchGrid}
          quickWindowChoices={quickWindowChoices}
          runStatus={runStatus}
          runDisabled={!allSelectedReady}
          onCombinedQuickRematch={setCombinedQuickRematch}
          onQuickRematchGrid={setQuickRematchGrid}
        />

        <CombinedConfiguration
          combinedConfiguration={combinedConfiguration}
          combinedQuickRematch={combinedQuickRematch}
          includeWellRested={includeWellRested}
          optionalRules={optionalRules}
          primaryRules={primaryRules}
        />
      </form>

      {result ? (
        <ScheduleResults
          options={options}
          primaryRules={primaryRules}
          optionalRules={optionalRules}
          result={result}
        />
      ) : null}

      <section className="rating-lab-board schedule-isolation-note">
        <strong>Review-only output</strong>
        <p>Zero is always the control. Best historical results are not recommendations and are never written to Settings. Production changes require manual review; Quick Rematch may have weak or no predictive value.</p>
      </section>
    </div>
  )
}

function ControlModel({ options }) {
  return (
    <section className="rating-lab-board">
      <div className="rating-lab-board-heading">
        <div><p className="eyebrow">Control model</p><h3>{options.baseline.name}</h3></div>
        <span>No production writes</span>
      </div>
      <p className="calibration-helper">Every candidate starts from ratings 42–50 (center 46), Base HA 3.5, scale 20, K 1.3, and Reg / OT / SO 1.0 / 0.4 / 0.1. Team Home Advantage is disabled so schedule effects remain isolated.</p>
      <div className="home-advantage-backtest-plan">
        <span><strong>Historical source</strong> HistoricalNhlGame</span>
        <span><strong>Replay</strong> chronological, in memory</span>
        <span><strong>Settings</strong> reference only, never written</span>
      </div>
    </section>
  )
}

function SeasonSelection({
  onPrepare,
  onToggle,
  options,
  preparingSeasonId,
  selectedSeasonIds,
}) {
  return (
    <section className="rating-lab-board">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Historical data reuse</p><h3>Evaluation seasons</h3></div><span>Select prepared seasons</span></div>
      <div className="home-advantage-season-grid">
        {options.seasons.map((season) => {
          const action = getDatasetAction(season.historicalDataset)
          const preparing = preparingSeasonId === season.id
          return (
            <article key={season.id}>
              <label><input type="checkbox" checked={selectedSeasonIds.includes(season.id)} onChange={(event) => onToggle(season.id, event.target.checked)} /><strong>{season.label}</strong></label>
              <span className={`dataset-status ${season.historicalDataset.status}`}>{season.historicalDataset.status.replaceAll('_', ' ')}</span>
              <button type="button" disabled={Boolean(preparingSeasonId)} onClick={() => onPrepare(season)}>
                {preparing ? <LoaderCircle className="button-spinner" size={14} /> : <RefreshCw size={14} />}
                {preparing ? 'Working...' : action.label}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function RuleCard({ customValues, onCustomValues, options, rule }) {
  const minimumAdjustment =
    options.minCustomAdjustment ?? -options.maxAbsoluteCustomAdjustment
  const maximumAdjustment =
    options.maxCustomAdjustment ?? options.maxAbsoluteCustomAdjustment

  return (
    <article className="schedule-rule-card">
      <div><strong>{rule.label}</strong><span>Production {formatAdjustment(rule.productionValue)}</span></div>
      <p>{rule.presetValues.map(formatAdjustment).join(' · ')}</p>
      <label className="field"><span>Optional custom adjustment</span><input type="number" min={minimumAdjustment} max={maximumAdjustment} step="0.01" value={customValues[rule.id] ?? ''} onChange={(event) => onCustomValues((current) => ({ ...current, [rule.id]: event.target.value }))} /></label>
      {rule.id === 'back_to_back_travel' ? (
        <p className="calibration-helper">Extended experimental range because the current historical optimum is below -3.0.</p>
      ) : null}
      <details><summary>Production definition</summary><p>{rule.definition}</p></details>
    </article>
  )
}

function Phase3A({
  combinedConfiguration,
  customValues,
  includeWellRested,
  onCombinedConfiguration,
  onCustomValues,
  onIncludeWellRested,
  optionalRules,
  options,
  primaryRules,
}) {
  return (
    <section className="rating-lab-board phase-three-section">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Phase 3A</p><h3>Rest &amp; Fatigue</h3></div><span>Production-active rules first</span></div>
      <p className="calibration-helper">3 Games in 4 Days, Back-to-Back, and Back-to-Back + Travel are tested independently against zero. Rest &amp; Fatigue remains exclusive internally.</p>
      <div className="schedule-rule-grid">
        {primaryRules.map((rule) => <RuleCard customValues={customValues} key={rule.id} onCustomValues={onCustomValues} options={options} rule={rule} />)}
      </div>

      <details className="schedule-optional-experiments">
        <summary>Optional Experiments</summary>
        <p>Well Rested is currently disabled by default in production. It is retained as an optional experiment and does not participate in the primary Phase 3A combined configuration unless explicitly enabled.</p>
        <div className="schedule-rule-grid">
          {optionalRules.map((rule) => <RuleCard customValues={customValues} key={rule.id} onCustomValues={onCustomValues} options={options} rule={rule} />)}
        </div>
      </details>

      <div className="settings-priority-note"><strong>Exclusive priority</strong><span>Back-to-Back + Travel &gt; Back-to-Back &gt; 3 Games in 4 Days &gt; Well Rested</span></div>
      <div className="rating-lab-board-heading schedule-subheading"><div><p className="eyebrow">Phase 3A combined</p><h3>Combined Rest &amp; Fatigue</h3></div><span>Manual candidates</span></div>
      <div className="schedule-combined-grid">
        {primaryRules.map((rule) => (
          <RuleSelector combinedConfiguration={combinedConfiguration} customValue={customValues[rule.id]} key={rule.id} onCombinedConfiguration={onCombinedConfiguration} rule={rule} />
        ))}
      </div>
      <label className="toggle-field schedule-optional-toggle"><input type="checkbox" checked={includeWellRested} onChange={(event) => onIncludeWellRested(event.target.checked)} /><span>Include optional Well Rested experiment</span></label>
      {includeWellRested
        ? optionalRules.map((rule) => <RuleSelector combinedConfiguration={combinedConfiguration} customValue={customValues[rule.id]} key={rule.id} onCombinedConfiguration={onCombinedConfiguration} rule={rule} />)
        : null}
    </section>
  )
}

function RuleSelector({
  combinedConfiguration,
  customValue,
  onCombinedConfiguration,
  rule,
}) {
  const values = [...new Set([
    ...rule.presetValues,
    ...(customValue === '' || customValue === undefined
      ? []
      : [Number(customValue)]),
  ])].filter(Number.isFinite).sort((left, right) => left - right)
  return (
    <label className="field">
      <span>{rule.label}</span>
      <select value={combinedConfiguration[rule.id]} onChange={(event) => onCombinedConfiguration((current) => ({ ...current, [rule.id]: Number(event.target.value) }))}>
        {values.map((value) => <option value={value} key={value}>{formatAdjustment(value)}</option>)}
      </select>
    </label>
  )
}

function Phase3B({
  combinedQuickRematch,
  onCombinedQuickRematch,
  onQuickRematchGrid,
  options,
  quickAdjustmentChoices,
  quickRematchGrid,
  quickWindowChoices,
  runDisabled,
  runStatus,
}) {
  const reference = options.quickRematch.productionReference
  return (
    <section className="rating-lab-board phase-three-section">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Phase 3B</p><h3>Quick Rematch</h3></div><span>5 × 4 standard grid</span></div>
      <p className="calibration-helper">Test whether a recent head-to-head rematch provides predictive value and calibrate both the lookback window and rating adjustment.</p>
      <div className="home-advantage-backtest-plan quick-rematch-reference">
        <span><strong>Production reference</strong> {reference.enabled ? 'Enabled' : 'Disabled'} · {reference.usingDefaults ? 'canonical defaults' : 'persisted settings'}</span>
        <span><strong>Max Days</strong> {reference.maximumDays}</span>
        <span><strong>Previous Loser Adjustment</strong> {formatAdjustment(reference.loserAdjustment)}</span>
      </div>
      <div className="schedule-grid-reference"><span><strong>Windows</strong> {options.quickRematch.windowOptions.join(', ')} days</span><span><strong>Adjustments</strong> {options.quickRematch.adjustmentOptions.map(formatAdjustment).join(', ')}</span><span><strong>Standard combinations</strong> 20 in one run</span></div>
      <div className="schedule-custom-grid">
        <label className="field"><span>Optional custom window</span><input type="number" min="1" max={options.maxCustomQuickRematchWindow} step="1" value={quickRematchGrid.customWindow} onChange={(event) => onQuickRematchGrid((current) => ({ ...current, customWindow: event.target.value }))} /></label>
        <label className="field"><span>Optional custom adjustment</span><input type="number" min="0" max={options.maxCustomQuickRematchAdjustment} step="0.01" value={quickRematchGrid.customAdjustment} onChange={(event) => onQuickRematchGrid((current) => ({ ...current, customAdjustment: event.target.value }))} /></label>
      </div>
      <details className="schedule-production-definition"><summary>Production definition</summary><p>{options.quickRematch.definition}</p></details>

      <div className="rating-lab-board-heading schedule-subheading"><div><p className="eyebrow">Final candidate</p><h3>Selected Quick Rematch configuration</h3></div><span>Manual selection</span></div>
      <div className="schedule-combined-grid">
        <label className="toggle-field"><input type="checkbox" checked={combinedQuickRematch.enabled} onChange={(event) => onCombinedQuickRematch((current) => ({ ...current, enabled: event.target.checked }))} /><span>Enable Quick Rematch</span></label>
        <label className="field"><span>Max Days</span><select disabled={!combinedQuickRematch.enabled} value={combinedQuickRematch.maximumDays} onChange={(event) => onCombinedQuickRematch((current) => ({ ...current, maximumDays: Number(event.target.value) }))}>{quickWindowChoices.map((value) => <option key={value} value={value}>{value} days</option>)}</select></label>
        <label className="field"><span>Previous Loser Adjustment</span><select disabled={!combinedQuickRematch.enabled} value={combinedQuickRematch.loserAdjustment} onChange={(event) => onCombinedQuickRematch((current) => ({ ...current, loserAdjustment: Number(event.target.value) }))}>{quickAdjustmentChoices.map((value) => <option key={value} value={value}>{formatAdjustment(value)}</option>)}</select></label>
      </div>
      <button className="save-ratings-button" type="submit" disabled={runDisabled || runStatus === 'loading'}>
        {runStatus === 'loading' ? <LoaderCircle className="button-spinner" size={17} /> : <Play size={17} />}
        {runStatus === 'loading' ? 'Running Phase 3 grid...' : 'Run Quick Rematch grid & Phase 3 comparisons'}
      </button>
    </section>
  )
}

function CombinedConfiguration({
  combinedConfiguration,
  combinedQuickRematch,
  includeWellRested,
  optionalRules,
  primaryRules,
}) {
  return (
    <section className="rating-lab-board phase-three-section">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Final comparison</p><h3>Combined Schedule &amp; Context</h3></div><span>Base control vs selected values</span></div>
      <p className="calibration-helper">The final replay uses the manually selected Rest &amp; Fatigue configuration plus the manually selected Quick Rematch configuration. Individual sweep winners are never substituted automatically.</p>
      <div className="schedule-selected-summary">
        {primaryRules.map((rule) => <span key={rule.id}>{rule.label}: <strong>{formatAdjustment(combinedConfiguration[rule.id])}</strong></span>)}
        {optionalRules.map((rule) => <span key={rule.id}>{rule.label}: <strong>{includeWellRested ? formatAdjustment(combinedConfiguration[rule.id]) : 'Disabled'}</strong></span>)}
        <span>Quick Rematch: <strong>{combinedQuickRematch.enabled ? `${combinedQuickRematch.maximumDays} days / ${formatAdjustment(combinedQuickRematch.loserAdjustment)}` : 'Disabled'}</strong></span>
      </div>
      <p className="settings-card-note"><strong>Quick Rematch is additive to the selected Rest &amp; Fatigue adjustment.</strong> For example, −1.25 fatigue plus +0.25 Quick Rematch produces −1.00 total context adjustment.</p>
    </section>
  )
}

function ScheduleResults({ options, optionalRules, primaryRules, result }) {
  return (
    <div className="schedule-results">
      <div className="rating-lab-board-heading schedule-results-heading"><div><p className="eyebrow">Phase 3A results</p><h3>Primary Rest &amp; Fatigue sweeps</h3></div></div>
      {primaryRules.map((rule) => <RuleResults key={rule.id} result={result.individualResults[rule.id]} rule={rule} />)}
      <details className="schedule-optional-results"><summary>Optional Experiments — Well Rested results</summary>{optionalRules.map((rule) => <RuleResults key={rule.id} result={result.individualResults[rule.id]} rule={rule} />)}</details>
      <RestCombinedResults options={options} result={result} />
      <QuickRematchResults result={result.quickRematchResult} />
      <CombinedScheduleResults options={options} result={result} />
    </div>
  )
}

function RuleResults({ result, rule }) {
  return (
    <section className="rating-lab-table-panel">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Independent rule</p><h3>{rule.label}</h3></div><span>Lower pooled Brier is primary</span></div>
      <div className="rating-lab-table-scroll"><table className="rating-lab-table schedule-results-table"><thead><tr><th>Adjustment</th><th>Occurrences</th><th>Games affected</th><th>Pooled Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Δ Log Loss</th><th>ECE</th><th>Accuracy</th><th>Avg season Brier</th><th>Worst season</th><th>Seasons beating baseline</th><th>Per-season diagnostics</th></tr></thead><tbody>
        {result.comparisons.map((comparison) => (
          <tr className={comparison.best ? 'best-run' : ''} key={comparison.adjustment}>
            <td><strong>{formatAdjustment(comparison.adjustment)}</strong>{comparison.best ? <small>Best Brier</small> : null}</td><td>{comparison.occurrences}</td><td>{comparison.gamesAffected} ({formatPercent(comparison.gamesAffectedPercentage)})</td><td>{formatMetric(comparison.metrics.brierScore)}</td><td>{formatDelta(comparison.delta.brierScore)}</td><td>{formatMetric(comparison.metrics.logLoss)}</td><td>{formatDelta(comparison.delta.logLoss)}</td><td>{formatMetric(comparison.metrics.expectedCalibrationError)}</td><td>{formatPercent(comparison.metrics.accuracy)}</td><td>{formatMetric(comparison.averageSeasonBrier)}</td><td>{comparison.worstSeason.seasonId} · {formatMetric(comparison.worstSeason.brierScore)}</td><td>{comparison.seasonsBeatingBaseline}/{comparison.seasonResults.length}</td><td><SeasonDetails comparison={comparison} /></td>
          </tr>
        ))}
      </tbody></table></div>
    </section>
  )
}

function SeasonDetails({ comparison }) {
  return <details><summary>Season results</summary>{comparison.seasonResults.map((season) => <p key={season.seasonId}><strong>{season.seasonId}</strong> · {season.occurrences ?? 0} occurrences · {season.gamesAffected} games affected · Brier {formatMetric(season.metrics.brierScore)} · Δ {formatDelta(season.delta.brierScore)} · Log Loss {formatMetric(season.metrics.logLoss)}</p>)}</details>
}

function ComparisonTable({ controlLabel, result, selectedLabel }) {
  const { noAdjustments, selected } = result
  return (
    <div className="rating-lab-table-scroll"><table className="rating-lab-table"><thead><tr><th>Configuration</th><th>Pooled Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Δ Log Loss</th><th>ECE</th><th>Accuracy</th><th>Avg season Brier</th><th>Worst season</th><th>Stability</th><th>Seasons beating baseline</th></tr></thead><tbody>
      <tr><td><strong>{controlLabel}</strong></td><td>{formatMetric(noAdjustments.metrics.brierScore)}</td><td>0.00000</td><td>{formatMetric(noAdjustments.metrics.logLoss)}</td><td>0.00000</td><td>{formatMetric(noAdjustments.metrics.expectedCalibrationError)}</td><td>{formatPercent(noAdjustments.metrics.accuracy)}</td><td>{formatMetric(noAdjustments.averageSeasonBrier)}</td><td>{formatMetric(noAdjustments.worstSeason.brierScore)}</td><td>{noAdjustments.stability.level}</td><td>Control</td></tr>
      <tr><td><strong>{selectedLabel}</strong></td><td>{formatMetric(selected.metrics.brierScore)}</td><td>{formatDelta(selected.delta.brierScore)}</td><td>{formatMetric(selected.metrics.logLoss)}</td><td>{formatDelta(selected.delta.logLoss)}</td><td>{formatMetric(selected.metrics.expectedCalibrationError)}</td><td>{formatPercent(selected.metrics.accuracy)}</td><td>{formatMetric(selected.averageSeasonBrier)}</td><td>{formatMetric(selected.worstSeason.brierScore)}</td><td>{selected.stability.level}</td><td>{selected.seasonsBeatingBaseline}/{selected.seasonResults.length}</td></tr>
    </tbody></table></div>
  )
}

function RestCombinedResults({ options, result }) {
  const combined = result.combinedRestFatigueResult ?? result.combinedResult
  const labels = Object.fromEntries(options.rules.map((rule) => [rule.id, rule.label]))
  const appliedCounts = combined.appliedCounts ?? combined.priorityCounts
  const matchedCounts = combined.matchedCounts ?? {}
  const snapshot = combined.configurationSnapshot ?? {
    adjustments: result.selectedCombinedConfiguration ?? {},
    includeWellRested: result.diagnostics.wellRestedIncludedInCombined === true,
  }
  const primaryRules = getPrimaryRules(options)
  const optionalRules = getOptionalRules(options)

  return (
    <section className="rating-lab-table-panel">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Phase 3A combined</p><h3>Combined Rest &amp; Fatigue comparison</h3></div><span>Exclusive fatigue</span></div>
      <p className="calibration-helper">Configuration used for this run</p>
      <div className="schedule-selected-summary">
        {primaryRules.map((rule) => <span key={rule.id}>{rule.label}: <strong>{formatAdjustment(snapshot.adjustments[rule.id])}</strong></span>)}
        {optionalRules.map((rule) => <span key={rule.id}>{rule.label}: <strong>{snapshot.includeWellRested ? formatAdjustment(snapshot.adjustments[rule.id]) : 'Disabled'}</strong></span>)}
      </div>
      <ComparisonTable controlLabel="No Rest & Fatigue adjustments" result={combined} selectedLabel="Selected Rest & Fatigue configuration" />
      <div className="schedule-priority-counts">{result.diagnostics.precedence.map((id) => <span key={id}>{labels[id]} applied: <strong>{appliedCounts[id] ?? 0}</strong></span>)}<span>No fatigue adjustment: <strong>{appliedCounts.normal ?? 0}</strong></span><span>Well Rested detected: <strong>{matchedCounts.well_rested ?? 0}</strong></span><span>Applied sum: <strong>{combined.teamGameCount}</strong> team-games</span></div>
    </section>
  )
}

function QuickRematchResults({ result }) {
  const best = result.bestTestedResult
  return (
    <section className="rating-lab-table-panel quick-rematch-results">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Phase 3B results</p><h3>Quick Rematch grid</h3></div><span>{result.testedCombinationCount} combinations · zero rows collapsed</span></div>
      <div className="schedule-best-diagnostic"><span>Best pooled result <strong>{best.disabled ? 'Disabled / 0.00' : `${best.windowDays} days / ${formatAdjustment(best.adjustment)}`}</strong></span><span>Seasons beating baseline <strong>{best.seasonsBeatingBaseline}</strong></span><span>Occurrences <strong>{best.occurrences}</strong></span>{best.negligibleImprovement || best.smallSample ? <p>Interpret cautiously: improvement is negligible, season consistency is limited, or the sample is small.</p> : null}</div>
      <div className="rating-lab-table-scroll"><table className="rating-lab-table schedule-results-table"><thead><tr><th>Window</th><th>Adjustment</th><th>Occurrences</th><th>Occurrence rate</th><th>Games affected</th><th>Pooled Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Δ Log Loss</th><th>ECE</th><th>Accuracy</th><th>Avg season Brier</th><th>Worst season</th><th>Seasons beating baseline</th><th>Per-season diagnostics</th></tr></thead><tbody>
        {result.comparisons.map((comparison) => (
          <tr className={comparison.best ? 'best-run' : ''} key={comparison.disabled ? 'disabled' : `${comparison.windowDays}-${comparison.adjustment}`}>
            <td>{comparison.disabled ? 'Disabled' : `${comparison.windowDays} days`}{comparison.best ? <small>Best tested result</small> : null}</td><td>{formatAdjustment(comparison.adjustment)}</td><td>{comparison.occurrences ?? '--'}</td><td>{formatPercent(comparison.occurrenceRate)}</td><td>{comparison.gamesAffected}</td><td>{formatMetric(comparison.metrics.brierScore)}</td><td>{formatDelta(comparison.delta.brierScore)}</td><td>{formatMetric(comparison.metrics.logLoss)}</td><td>{formatDelta(comparison.delta.logLoss)}</td><td>{formatMetric(comparison.metrics.expectedCalibrationError)}</td><td>{formatPercent(comparison.metrics.accuracy)}</td><td>{formatMetric(comparison.averageSeasonBrier)}</td><td>{comparison.worstSeason.seasonId} · {formatMetric(comparison.worstSeason.brierScore)}</td><td>{comparison.seasonsBeatingBaseline}/{comparison.seasonResults.length}</td><td><SeasonDetails comparison={comparison} /></td>
          </tr>
        ))}
      </tbody></table></div>
    </section>
  )
}

function CombinedScheduleResults({ options, result }) {
  const combined = result.combinedScheduleContextResult
  const labels = Object.fromEntries(options.rules.map((rule) => [rule.id, rule.label]))
  const counts = combined.occurrenceCounts
  const appliedCounts = combined.appliedRestFatigueCounts ?? counts
  const matchedCounts = combined.matchedRestFatigueCounts ?? {}
  return (
    <section className="rating-lab-table-panel combined-schedule-results">
      <div className="rating-lab-board-heading"><div><p className="eyebrow">Final combined replay</p><h3>Combined Schedule &amp; Context results</h3></div><span>Fatigue exclusive · Quick Rematch additive</span></div>
      <ComparisonTable controlLabel="No Schedule & Context adjustments" result={combined} selectedLabel="Selected combined configuration" />
      <div className="schedule-priority-counts">{result.diagnostics.precedence.map((id) => <span key={id}>{labels[id]} applied: <strong>{appliedCounts[id] ?? 0}</strong></span>)}<span>No fatigue adjustment: <strong>{appliedCounts.normal ?? 0}</strong></span><span>Well Rested detected: <strong>{matchedCounts.well_rested ?? 0}</strong></span><span>Quick Rematch applied: <strong>{counts.quick_rematch ?? 0}</strong></span><span>No context adjustment: <strong>{counts.no_context_adjustment ?? 0}</strong></span><span>Evaluated: <strong>{combined.teamGameCount}</strong> team-games</span></div>
    </section>
  )
}

export default ScheduleContextCalibration
