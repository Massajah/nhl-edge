import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Play, RotateCcw } from 'lucide-react'
import {
  getBaseModelCalibrationOptions,
  prepareHistoricalCalibrationSeason,
  runBaseModelCalibration,
} from '../services/powerRatingSimulationsApi.js'
import {
  CALIBRATION_NUMBER_FIELDS,
  CALIBRATION_STARTING_PRESETS,
  DEFAULT_SELECTED_CALIBRATION_PRESETS,
  buildCalibrationRanking,
  buildCalibrationSummary,
  buildProbabilityReferenceRows,
  clearCalibrationSeasons,
  createCalibrationForm,
  createCalibrationPayload,
  estimateCalibrationGames,
  formatCalibrationPercent,
  formatCalibrationScore,
  isLatestCalibrationRequest,
  selectAllCalibrationSeasons,
  toggleCalibrationSeason,
  validateCalibrationForm,
} from '../utils/baseModelCalibration.js'

const sortOptions = [
  { label: 'Pooled Brier', value: 'brierScore' },
  { label: 'Average season Brier', value: 'averageSeasonBrier' },
  { label: 'Worst season Brier', value: 'worstSeasonBrier' },
  { label: 'Pooled log loss', value: 'logLoss' },
  { label: 'Pooled ECE', value: 'expectedCalibrationError' },
  { label: 'Accuracy', value: 'accuracy' },
]

const getErrorMessage = (error) => {
  const message = error?.message ?? 'Unable to run base model calibration.'

  if (Array.isArray(error?.details?.teamIds)) {
    return `${message} Missing or invalid: ${error.details.teamIds.join(', ')}.`
  }

  if (Array.isArray(error?.details?.seasons)) {
    const seasonMessages = error.details.seasons
      .map(
        (season) =>
          `${season.label ?? season.seasonId}: ${
            season.userMessage ?? 'Calibration failed.'
          }`,
      )
      .join(' ')

    return `${message} ${seasonMessages}`.trim()
  }

  if (error?.details?.field) {
    return `${message} Field: ${error.details.field}.`
  }

  return message
}

const getCustomPreset = (form) => ({
  center: Number(form.startingRatings.center),
  key: 'custom',
  label:
    form.startingRatings.mode === 'fixed_spread'
      ? `Custom ±${formatCalibrationScore(
          Number(form.startingRatings.spread) / 2,
          1,
        )}`
      : 'Custom current',
  mode: form.startingRatings.mode,
  spread: Number(form.startingRatings.spread),
})

const getHistoricalDatasetLabel = (dataset = {}) => {
  const games = Number(dataset.completedGames ?? dataset.importedGames ?? 0)
  const expected = Number(dataset.expectedApproximateGames ?? 1312)
  const progressPercent = Number(dataset.progress?.percent)
  const progressSuffix = Number.isFinite(progressPercent)
    ? ` \u00b7 ${progressPercent}% of date windows`
    : ''

  if (dataset.status === 'ready') {
    return `Ready \u00b7 ${games.toLocaleString()} games`
  }

  if (dataset.status === 'partial') {
    return `Partial \u00b7 ${games.toLocaleString()}/~${expected.toLocaleString()} games${progressSuffix}`
  }

  if (dataset.status === 'importing') {
    return `Preparing \u00b7 ${games.toLocaleString()}/~${expected.toLocaleString()} games`
  }

  if (dataset.status === 'error') {
    return 'Preparation paused'
  }

  return 'Not prepared'
}

const getHistoricalDatasetAction = (dataset = {}) => {
  if (dataset.status === 'ready') {
    return 'Refresh dataset'
  }

  if (dataset.status === 'partial' || dataset.status === 'error') {
    return 'Resume'
  }

  return 'Prepare historical season'
}

function BaseModelCalibration({
  initialErrorMessage = '',
  initialOptions = null,
  initialRuns = [],
  initialRunStatus = 'idle',
  loadOptions = getBaseModelCalibrationOptions,
  prepareSeason = prepareHistoricalCalibrationSeason,
  runCalibration = runBaseModelCalibration,
} = {}) {
  const [options, setOptions] = useState(initialOptions)
  const [optionsStatus, setOptionsStatus] = useState(
    initialOptions ? 'success' : 'loading',
  )
  const [form, setForm] = useState(() => createCalibrationForm(initialOptions ?? {}))
  const [selectedPresetKeys, setSelectedPresetKeys] = useState(
    () => new Set(DEFAULT_SELECTED_CALIBRATION_PRESETS),
  )
  const [runs, setRuns] = useState(initialRuns)
  const [runStatus, setRunStatus] = useState(
    initialRuns.length > 0 ? 'success' : initialRunStatus,
  )
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [failedCoverage, setFailedCoverage] = useState(null)
  const [preparationMessage, setPreparationMessage] = useState('')
  const [preparingSeasonIds, setPreparingSeasonIds] = useState([])
  const [activePreparationSeasonId, setActivePreparationSeasonId] = useState(null)
  const [sortKey, setSortKey] = useState('brierScore')
  const activeRunRequest = useRef(0)
  const autoPreparationAttempted = useRef(new Set())
  const preparationQueue = useRef(Promise.resolve())
  const preparationPausedByRateLimit = useRef(false)
  const queuedPreparationSeasonIds = useRef(new Set())

  useEffect(() => {
    if (initialOptions) {
      return undefined
    }

    let active = true

    loadOptions()
      .then((loadedOptions) => {
        if (!active) {
          return
        }

        setOptions(loadedOptions)
        setForm(createCalibrationForm(loadedOptions))
        setOptionsStatus('success')
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setOptionsStatus('error')
        setErrorMessage(getErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [initialOptions, loadOptions])

  useEffect(
    () => () => {
      activeRunRequest.current += 1
    },
    [],
  )

  const runSeasonPreparation = useCallback(
    async (seasonId, refresh) => {
      setActivePreparationSeasonId(seasonId)

      try {
        if (preparationPausedByRateLimit.current) {
          return null
        }

        const result = await prepareSeason(seasonId, { refresh })

        if (result.dataset?.lastErrorCode === 'rate_limited') {
          preparationPausedByRateLimit.current = true
        }

        setOptions((current) => ({
          ...current,
          seasons: (current?.seasons ?? []).map((season) =>
            season.id === seasonId
              ? {
                  ...season,
                  historicalDataset: {
                    ...result.dataset,
                    progress: result.progress,
                  },
                }
              : season,
          ),
        }))
        setPreparationMessage(
          result.message ??
            (result.status === 'ready'
              ? 'Historical season is ready for calibration.'
              : 'Historical season progress was saved.'),
        )
        return result
      } catch (error) {
        setPreparationMessage(getErrorMessage(error))
        return null
      } finally {
        setActivePreparationSeasonId(null)
        queuedPreparationSeasonIds.current.delete(seasonId)
        setPreparingSeasonIds((current) =>
          current.filter((queuedSeasonId) => queuedSeasonId !== seasonId),
        )
      }
    },
    [prepareSeason],
  )

  const queueSeasonPreparation = useCallback(
    (seasonId, { manual = false, refresh = false } = {}) => {
      if (queuedPreparationSeasonIds.current.has(seasonId)) {
        return preparationQueue.current
      }

      if (manual) {
        preparationPausedByRateLimit.current = false
      }

      queuedPreparationSeasonIds.current.add(seasonId)
      setPreparingSeasonIds((current) => [...current, seasonId])
      preparationQueue.current = preparationQueue.current.then(
        () => runSeasonPreparation(seasonId, refresh),
        () => runSeasonPreparation(seasonId, refresh),
      )
      return preparationQueue.current
    },
    [runSeasonPreparation],
  )

  useEffect(() => {
    if (optionsStatus !== 'success') {
      return
    }

    form.seasonIds.forEach((seasonId) => {
      const dataset = options?.seasons?.find(
        (season) => season.id === seasonId,
      )?.historicalDataset

      if (
        dataset?.status !== 'ready' &&
        dataset?.status !== 'importing' &&
        !autoPreparationAttempted.current.has(seasonId)
      ) {
        autoPreparationAttempted.current.add(seasonId)
        queueSeasonPreparation(seasonId)
      }
    })
  }, [form.seasonIds, options?.seasons, optionsStatus, queueSeasonPreparation])

  const probabilityRows = useMemo(
    () => buildProbabilityReferenceRows(form),
    [form],
  )
  const ranking = useMemo(
    () => buildCalibrationRanking(runs, sortKey),
    [runs, sortKey],
  )
  const summary = useMemo(() => buildCalibrationSummary(runs), [runs])
  const comparisonPresets = useMemo(
    () => [...CALIBRATION_STARTING_PRESETS, getCustomPreset(form)],
    [form],
  )
  const isRunning = runStatus === 'loading'
  const isMultiSeason = form.seasonIds.length > 1
  const latestHistoricalSeasonId = (options?.seasons ?? []).reduce(
    (latest, season) =>
      !latest || season.endDate > latest.endDate ? season : latest,
    null,
  )?.id
  const usesCurrentOnOlderSeason =
    form.seasonIds.length === 1 &&
    form.seasonIds[0] !== latestHistoricalSeasonId &&
    (selectedPresetKeys.has('current') ||
      (selectedPresetKeys.has('custom') &&
        form.startingRatings.mode === 'current'))

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrorMessage('')
  }

  const updateConfiguration = (field, value) => {
    setForm((current) => ({
      ...current,
      configuration: {
        ...current.configuration,
        [field]: value,
      },
    }))
    setErrorMessage('')
  }

  const updateStartingRatings = (field, value) => {
    setForm((current) => ({
      ...current,
      startingRatings: {
        ...current.startingRatings,
        [field]: value,
      },
    }))
    setErrorMessage('')
  }

  const applySeasonSelection = (seasonIds) => {
    const firstSeason = options?.seasons?.find(
      (season) => season.id === seasonIds[0],
    )
    setForm((current) => ({
      ...current,
      dateFrom: firstSeason?.startDate ?? current.dateFrom,
      dateTo: firstSeason?.endDate ?? current.dateTo,
      seasonIds,
      startingRatings:
        seasonIds.length > 1
          ? { ...current.startingRatings, mode: 'fixed_spread' }
          : current.startingRatings,
      useCustomDateRange:
        seasonIds.length === 1 ? current.useCustomDateRange : false,
    }))

    if (seasonIds.length > 1) {
      setSelectedPresetKeys((current) => {
        const next = new Set(current)
        next.delete('current')
        return next
      })
    }

    setErrorMessage('')
  }

  const handleSeasonToggle = (seasonId) => {
    applySeasonSelection(toggleCalibrationSeason(form.seasonIds, seasonId))
  }

  const togglePreset = (presetKey) => {
    setSelectedPresetKeys((current) => {
      const next = new Set(current)

      if (next.has(presetKey)) {
        next.delete(presetKey)
      } else {
        next.add(presetKey)
      }

      return next
    })
    setErrorMessage('')
  }

  const resetDefaults = () => {
    setForm(createCalibrationForm(options ?? {}))
    setSelectedPresetKeys(new Set(DEFAULT_SELECTED_CALIBRATION_PRESETS))
    setErrorMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (isRunning) {
      return
    }

    const selectedKeys = [...selectedPresetKeys]
    const validationMessage = validateCalibrationForm(form, selectedKeys)

    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    const presets = comparisonPresets.filter((preset) =>
      selectedPresetKeys.has(preset.key),
    )
    const requestSequence = activeRunRequest.current + 1
    const payloads = presets.map((preset) =>
      createCalibrationPayload(form, preset),
    )

    activeRunRequest.current = requestSequence

    setRunStatus('loading')
    setErrorMessage('')
    setFailedCoverage(null)

    const completedRuns = []
    const failedRuns = []

    for (const payload of payloads) {
      try {
        completedRuns.push(await runCalibration(payload))
      } catch (error) {
        failedRuns.push(error)
      }

      if (!isLatestCalibrationRequest(requestSequence, activeRunRequest.current)) {
        return
      }
    }

    if (!isLatestCalibrationRequest(requestSequence, activeRunRequest.current)) {
      return
    }

    if (completedRuns.length > 0) {
      setRuns(completedRuns)
      setRunStatus('success')
      setErrorMessage(
        failedRuns.length > 0
          ? `${failedRuns.length} comparison run failed. ${getErrorMessage(
              failedRuns[0],
            )}`
          : '',
      )
      return
    }

    setRunStatus(runs.length > 0 ? 'success' : 'error')
    const failedSeasons = failedRuns[0]?.details?.seasons

    if (Array.isArray(failedSeasons)) {
      setFailedCoverage({
        completedSeasons: 0,
        failedSeasons: failedSeasons.length,
        incomplete: true,
        seasons: failedSeasons,
        selectedSeasons: failedSeasons.length,
      })
    }

    setErrorMessage(getErrorMessage(failedRuns[0]))
  }

  return (
    <div className="calibration-lab">
      <div className="calibration-isolation-banner" role="note">
        <div>
          <span className="experimental-badge">Experimental</span>
          <strong>Production-isolated calibration</strong>
        </div>
        <p>
          Replay calculations stay in memory. Prepared historical games are
          shared read-only inputs; production ratings, settings, and rating
          history are never written.
        </p>
      </div>

      <div className="calibration-layout">
        <aside className="rating-lab-controls-panel calibration-controls-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Phase 1 setup</p>
              <h2>Base Model Calibration</h2>
            </div>
          </div>

          {optionsStatus === 'loading' ? (
            <div className="rating-lab-loading-state" role="status">
              <LoaderCircle className="button-spinner" aria-hidden="true" size={20} />
              <div>
                <strong>Loading calibration defaults</strong>
                <p>Reading seasons and your production model settings.</p>
              </div>
            </div>
          ) : null}

          {optionsStatus !== 'loading' ? (
            <form className="rating-lab-form" onSubmit={handleSubmit}>
              <fieldset className="rating-lab-fieldset calibration-season-fieldset">
                <legend>Historical seasons</legend>
                <div className="calibration-season-actions">
                  <button
                    type="button"
                    onClick={() =>
                      applySeasonSelection(
                        selectAllCalibrationSeasons(options?.seasons ?? []),
                      )
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applySeasonSelection(clearCalibrationSeasons())
                    }
                  >
                    Clear
                  </button>
                </div>
                <div className="calibration-season-grid">
                  {(options?.seasons ?? []).map((season) => {
                    const dataset = season.historicalDataset ?? {}
                    const isQueuedLocally = preparingSeasonIds.includes(season.id)
                    const isPreparing =
                      isQueuedLocally || dataset.status === 'importing'

                    return (
                      <div
                        className={`calibration-season-entry ${
                          form.seasonIds.includes(season.id) ? 'selected' : ''
                        }`}
                        key={season.id}
                      >
                        <label className="calibration-season-option">
                          <input
                            checked={form.seasonIds.includes(season.id)}
                            type="checkbox"
                            onChange={() => handleSeasonToggle(season.id)}
                          />
                          <span>
                            <strong>{season.label}</strong>
                            <small>{season.startDate} to {season.endDate}</small>
                          </span>
                        </label>
                        <div className="calibration-dataset-status">
                          <span className={`dataset-status ${dataset.status ?? 'not_imported'}`}>
                            {isQueuedLocally
                              ? activePreparationSeasonId === season.id
                                ? 'Preparing historical season...'
                                : 'Queued for preparation...'
                              : getHistoricalDatasetLabel(dataset)}
                          </span>
                          <button
                            disabled={isPreparing}
                            type="button"
                            onClick={() =>
                              queueSeasonPreparation(season.id, {
                                manual: true,
                                refresh: dataset.status === 'ready',
                              })
                            }
                          >
                            {isQueuedLocally
                              ? dataset.status === 'ready'
                                ? 'Refreshing...'
                                : 'Preparing...'
                              : dataset.status === 'importing'
                                ? 'Preparation in progress'
                              : getHistoricalDatasetAction(dataset)}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="calibration-selection-summary">
                  {form.seasonIds.length} season{form.seasonIds.length === 1 ? '' : 's'} selected
                  {' · '}estimated games ~{estimateCalibrationGames(form.seasonIds).toLocaleString()}
                  {' · '}boundaries from{' '}
                  {options?.seasonMetadataSource === 'tested-explicit'
                    ? 'tested explicit metadata'
                    : options?.seasonMetadataSource === 'fallback'
                      ? 'tested fallback metadata'
                      : 'NHL API/cache'}
                </p>
              </fieldset>

              <label className="rating-lab-inline-toggle">
                <input
                  checked={form.useCustomDateRange}
                  disabled={form.seasonIds.length !== 1}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('useCustomDateRange', event.target.checked)
                  }
                />
                <span>Use a custom date range</span>
              </label>

              {form.useCustomDateRange ? (
                <div className="rating-lab-field-grid">
                  <label className="field" htmlFor="calibration-date-from">
                    <span>Custom range from</span>
                    <input
                      id="calibration-date-from"
                      type="date"
                      value={form.dateFrom}
                      onChange={(event) => updateField('dateFrom', event.target.value)}
                    />
                  </label>
                  <label className="field" htmlFor="calibration-date-to">
                    <span>Custom range to</span>
                    <input
                      id="calibration-date-to"
                      type="date"
                      value={form.dateTo}
                      onChange={(event) => updateField('dateTo', event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              <p className="calibration-helper">
                Each selected season uses its exact regular-season boundaries and
                starts from a fresh rating state. Custom ranges are single-season only.
              </p>
              {usesCurrentOnOlderSeason ? (
                <p className="form-status warning">
                  Current production ratings are an experimental, potentially
                  biased starting source for this older historical season.
                </p>
              ) : null}

              <fieldset className="rating-lab-fieldset">
                <legend>Custom starting ratings</legend>
                <div className="rating-lab-choice-grid">
                  {[
                    ['current', 'Current production'],
                    ['fixed_spread', 'Centered fixed spread'],
                  ].map(([value, label]) => (
                    <label
                      className={`rating-lab-choice ${
                        form.startingRatings.mode === value ? 'selected' : ''
                      }`}
                      key={value}
                    >
                      <input
                        checked={form.startingRatings.mode === value}
                        disabled={isMultiSeason && value === 'current'}
                        name="calibration-starting-mode"
                        type="radio"
                        value={value}
                        onChange={(event) =>
                          updateStartingRatings('mode', event.target.value)
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="rating-lab-field-grid calibration-spread-fields">
                  <label className="field" htmlFor="calibration-center">
                    <span>Center</span>
                    <input
                      disabled={form.startingRatings.mode !== 'fixed_spread'}
                      id="calibration-center"
                      type="number"
                      step="0.5"
                      value={form.startingRatings.center}
                      onChange={(event) =>
                        updateStartingRatings('center', event.target.value)
                      }
                    />
                  </label>
                  <label className="field" htmlFor="calibration-spread">
                    <span>Total spread</span>
                    <input
                      disabled={form.startingRatings.mode !== 'fixed_spread'}
                      id="calibration-spread"
                      min="0.01"
                      max="100"
                      type="number"
                      step="0.5"
                      value={form.startingRatings.spread}
                      onChange={(event) =>
                        updateStartingRatings('spread', event.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="calibration-helper">
                  Current production ratings are unavailable for cross-season runs.
                  Older fixed-spread seasons use the explicitly reported historical
                  ordering fallback when no season snapshot exists.
                </p>
              </fieldset>

              <fieldset className="rating-lab-fieldset">
                <legend>Runs to compare</legend>
                <div className="calibration-preset-grid">
                  {comparisonPresets.map((preset) => (
                    <label
                      className={`calibration-preset ${
                        selectedPresetKeys.has(preset.key) ? 'selected' : ''
                      }`}
                      key={preset.key}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPresetKeys.has(preset.key)}
                        disabled={isMultiSeason && preset.mode === 'current'}
                        onChange={() => togglePreset(preset.key)}
                      />
                      <strong>{preset.label}</strong>
                      <span>
                        {preset.mode === 'current'
                          ? 'Production values'
                          : `Center ${preset.center}, spread ${preset.spread}`}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rating-lab-fieldset">
                <legend>Base model parameters</legend>
                <div className="rating-lab-field-grid">
                  {CALIBRATION_NUMBER_FIELDS.map((field) => (
                    <label
                      className="field rating-lab-number-field"
                      htmlFor={`calibration-${field.key}`}
                      key={field.key}
                    >
                      <span>{field.label}</span>
                      <input
                        id={`calibration-${field.key}`}
                        max={field.max}
                        min={field.min}
                        step={field.step}
                        type="number"
                        value={
                          field.configuration
                            ? form.configuration[field.key]
                            : form[field.key]
                        }
                        onChange={(event) =>
                          field.configuration
                            ? updateConfiguration(field.key, event.target.value)
                            : updateField(field.key, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <ProbabilityReference rows={probabilityRows} />

              <div className="calibration-exclusion-note">
                <strong>Phase 1 formula scope</strong>
                <p>
                  Home rating + home advantage − away rating. Goalie, injury,
                  lineup, rest, travel, manual, and Analyzer adjustments are excluded.
                </p>
              </div>

              {options?.warning ? (
                <p className="form-status warning">{options.warning}</p>
              ) : null}
              {preparationMessage ? (
                <p className="form-status info" role="status">
                  {preparationMessage}
                </p>
              ) : null}
              {errorMessage ? (
                <p className="form-status error" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <div className="rating-lab-actions">
                <button
                  className="save-ratings-button rating-lab-run-button"
                  disabled={isRunning || optionsStatus === 'error'}
                  type="submit"
                >
                  {isRunning ? (
                    <LoaderCircle className="button-spinner" aria-hidden="true" size={18} />
                  ) : (
                    <Play aria-hidden="true" size={17} />
                  )}
                  <span>
                    {isRunning
                      ? 'Running comparison...'
                      : `Run comparison (${selectedPresetKeys.size})`}
                  </span>
                </button>
                <button
                  className="reset-button rating-lab-reset-button"
                  disabled={isRunning}
                  type="button"
                  onClick={resetDefaults}
                >
                  <RotateCcw aria-hidden="true" size={17} />
                  <span>Reset defaults</span>
                </button>
              </div>
            </form>
          ) : null}
        </aside>

        <section className="rating-lab-results-panel calibration-results-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Probability calibration</p>
              <h2>Comparison Results</h2>
            </div>
            <label className="calibration-sort">
              <span>Sort by</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isRunning ? (
            <div className="rating-lab-loading-state" role="status">
              <LoaderCircle className="button-spinner" aria-hidden="true" size={20} />
              <div>
                <strong>Replaying selected runs</strong>
                <p>Games are loaded through the shared NHL schedule cache.</p>
              </div>
            </div>
          ) : null}

          {!isRunning && runs.length === 0 && !failedCoverage ? (
            <div className="rating-lab-empty-state">
              <strong>Ready to compare</strong>
              <p>
                Select at least two starting-rating presets. Results are ranked by
                Brier score by default.
              </p>
            </div>
          ) : null}

          {!isRunning && failedCoverage ? (
            <SeasonCoverage coverage={failedCoverage} />
          ) : null}

          {runs.length > 0 ? (
            <CalibrationResults ranking={ranking} summary={summary} />
          ) : null}
        </section>
      </div>
    </div>
  )
}

function ProbabilityReference({ rows }) {
  return (
    <section className="calibration-reference" aria-label="Live probability reference">
      <div>
        <strong>Live probability reference</strong>
        <span>Neutral site and configured home advantage use the simulation formula</span>
      </div>
      <div className="calibration-reference-grid">
        {rows.map((row) => (
          <div key={row.ratingDifference}>
            <span>+{row.ratingDifference} rating</span>
            <strong>
              <small>Neutral</small>
              {formatCalibrationPercent(row.neutralHomeProbability)}
            </strong>
            <em>
              <small>With HA</small>
              {formatCalibrationPercent(row.appliedHomeProbability)}
            </em>
          </div>
        ))}
      </div>
    </section>
  )
}

function CalibrationResults({ ranking, summary }) {
  const rankedRuns = ranking.orderedRuns
  const bestRun = ranking.eligibleRuns[0]
  const isPartialRanking = ranking.kind === 'partial'

  return (
    <div className="rating-lab-results calibration-results">
      {bestRun.coverage?.incomplete ? (
        <div className="calibration-coverage-warning" role="alert">
          <strong>Partial result — incomplete season coverage</strong>
          <p>
            {bestRun.coverage.completedSeasons ?? 0} of{' '}
            {bestRun.coverage.selectedSeasons ?? 0} selected seasons completed.
            Pooled metrics include completed seasons only.
          </p>
        </div>
      ) : null}

      <div className="calibration-metric-grid">
        <CalibrationMetric
          detail={bestRun.aggregate?.incomplete ? 'Incomplete coverage' : 'Complete coverage'}
          label="Seasons"
          value={`${bestRun.aggregate?.completedSeasons ?? 1}/${bestRun.aggregate?.requestedSeasons ?? 1}`}
        />
        <CalibrationMetric
          detail={bestRun.dataset.source}
          label="Games"
          value={bestRun.dataset.gamesIncluded.toLocaleString()}
        />
        <CalibrationMetric
          detail={
            isPartialRanking
              ? 'Best pooled Brier among comparable partial results'
              : bestRun.label
          }
          label={isPartialRanking ? 'Best pooled Brier (partial)' : 'Best pooled Brier'}
          value={formatCalibrationScore(bestRun.metrics.brierScore)}
        />
        <CalibrationMetric
          detail="Lower is better"
          label="Log loss"
          value={formatCalibrationScore(bestRun.metrics.logLoss)}
        />
        <CalibrationMetric
          detail="Weighted bucket gap"
          label="ECE"
          value={formatCalibrationPercent(bestRun.metrics.expectedCalibrationError)}
        />
        <CalibrationMetric
          detail="Context, not objective"
          label="Accuracy"
          value={formatCalibrationPercent(bestRun.metrics.accuracy?.rate)}
        />
      </div>

      <SanityBaselines baselines={bestRun.sanityBaselines} />
      <StabilitySummary run={bestRun} />
      <SeasonCoverage coverage={bestRun.coverage} />

      <section className="rating-lab-table-panel calibration-table-panel">
        <div className="rating-lab-board-heading">
          <div>
            <p className="eyebrow">Lower is better</p>
            <h3>Run comparison</h3>
          </div>
          <span>{rankedRuns.length} runs</span>
        </div>
        <div className="rating-lab-table-scroll">
          <table className="rating-lab-table calibration-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Seasons</th>
                <th>Games</th>
                <th>Pooled Brier</th>
                <th>Avg season Brier</th>
                <th>Worst season Brier</th>
                <th>Pooled log loss</th>
                <th>Pooled ECE</th>
                <th>Accuracy</th>
                <th>Stability</th>
                <th>Sanity baselines</th>
              </tr>
            </thead>
            <tbody>
              {rankedRuns.map((run) => {
                const rankingEligible = ranking.eligibleRuns.includes(run)
                const isBestRun = rankingEligible && run === bestRun

                return (
                <tr className={isBestRun ? 'best-run' : ''} key={run.label}>
                  <td>
                    <strong>{run.label}</strong>
                    <small>
                      scale {run.parameters.probabilityScale}, HA{' '}
                      {run.parameters.homeAdvantage}, K{' '}
                      {run.parameters.configuration.kFactor}
                    </small>
                    {!rankingEligible ? (
                      <small>Not ranked — incompatible or incomplete coverage</small>
                    ) : run.coverage?.incomplete ? (
                      <small>Ranked among matching partial results only</small>
                    ) : null}
                  </td>
                  <td>
                    {run.aggregate?.completedSeasons ?? 1}/
                    {run.aggregate?.requestedSeasons ?? 1}
                  </td>
                  <td>{run.dataset.gamesIncluded.toLocaleString()}</td>
                  <td>{formatCalibrationScore(run.metrics.brierScore)}</td>
                  <td>{formatCalibrationScore(run.aggregate?.averageSeasonBrier)}</td>
                  <td>{formatCalibrationScore(run.aggregate?.worstSeason?.brierScore)}</td>
                  <td>{formatCalibrationScore(run.metrics.logLoss)}</td>
                  <td>
                    {formatCalibrationPercent(run.metrics.expectedCalibrationError)}
                  </td>
                  <td>{formatCalibrationPercent(run.metrics.accuracy?.rate)}</td>
                  <td>{run.stability?.level?.replaceAll('_', ' ') ?? '--'}</td>
                  <td>
                    <div className="calibration-baseline-statuses">
                      <span className={run.baselineComparison?.constant50 ?? ''}>
                        {getBaselineComparisonLabel(
                          run.baselineComparison?.constant50,
                          '50% baseline',
                        )}
                      </span>
                      <span
                        className={
                          run.baselineComparison?.historicalHomeRate ?? ''
                        }
                      >
                        {getBaselineComparisonLabel(
                          run.baselineComparison?.historicalHomeRate,
                          'home-rate baseline',
                        )}
                      </span>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="calibration-run-details">
        {rankedRuns.map((run) => (
          <CalibrationRunDetails key={`details-${run.label}`} run={run} />
        ))}
      </div>

      <section className="calibration-final-summary">
        <p className="eyebrow">Phase 1 readout</p>
        <h3>Calibration summary</h3>
        <p>{summary}</p>
        <small>
          This comparison evaluates only base rating difference and home advantage;
          it does not recommend a production change automatically.
        </small>
      </section>
    </div>
  )
}

function SanityBaselines({ baselines = {} }) {
  const constant50 = baselines.constant50 ?? {}
  const historicalHomeRate = baselines.historicalHomeRate ?? {}

  return (
    <section className="calibration-baselines" aria-label="Sanity baselines">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Non-rating references</p>
          <h3>Sanity baselines</h3>
        </div>
        <span>Dataset-only predictions</span>
      </div>
      <div className="calibration-baseline-grid">
        <div>
          <strong>50% baseline</strong>
          <span>
            Brier <b>{formatCalibrationScore(constant50.brierScore)}</b>
          </span>
          <span>
            Log loss <b>{formatCalibrationScore(constant50.logLoss)}</b>
          </span>
        </div>
        <div>
          <strong>Historical home-rate baseline</strong>
          <span>
            Probability{' '}
            <b>{formatCalibrationPercent(historicalHomeRate.probability)}</b>
          </span>
          <span>
            Brier{' '}
            <b>{formatCalibrationScore(historicalHomeRate.brierScore)}</b>
          </span>
          <span>
            Log loss <b>{formatCalibrationScore(historicalHomeRate.logLoss)}</b>
          </span>
        </div>
      </div>
      <p>
        Baselines use constant probabilities and do not update or produce team
        ratings.
      </p>
    </section>
  )
}

const getSeasonStatusLabel = (status) => {
  const labels = {
    completed: 'Completed',
    data_unavailable: 'Failed — historical schedule unavailable',
    invalid_team_order: 'Failed — starting team order unavailable',
    no_games: 'Failed — no completed games',
    rate_limited: 'Failed — provider rate limited',
    simulation_failed: 'Failed — simulation error',
  }

  return labels[status] ?? 'Failed — unavailable'
}

function SeasonCoverage({ coverage = {} }) {
  const seasons = coverage.seasons ?? []

  return (
    <section className="calibration-season-coverage" aria-label="Season Coverage">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Historical data completeness</p>
          <h3>Season Coverage</h3>
        </div>
        <span>
          {coverage.completedSeasons ?? 0}/{coverage.selectedSeasons ?? seasons.length}{' '}
          completed
        </span>
      </div>
      <div className="calibration-season-coverage-grid">
        {seasons.map((season) => (
          <article
            className={season.status === 'completed' ? 'completed' : 'failed'}
            key={season.seasonId}
          >
            <div>
              <strong>{season.label ?? season.seasonId}</strong>
              <span>{getSeasonStatusLabel(season.status)}</span>
            </div>
            <p>
              {season.gamesFound ?? 0} found · {season.gamesIncluded ?? 0} included ·{' '}
              {season.gamesSkipped ?? 0} skipped
            </p>
            <small>
              {season.boundaries?.resolvedStartDate ?? '--'} to{' '}
              {season.boundaries?.resolvedEndDate ?? '--'} ·{' '}
              {season.boundaries?.metadataSource ?? 'season metadata'}
            </small>
            {season.expectedGames?.approximate ? (
              <small>
                Expected approximately {season.expectedGames.approximate.toLocaleString()}
                {' '}games; low-count warning below{' '}
                {season.expectedGames.minimum.toLocaleString()}.
              </small>
            ) : null}
            {season.userMessage ? (
              <p className="season-failure-message">{season.userMessage}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function StabilitySummary({ run }) {
  const stability = run.stability ?? {}
  const aggregate = run.aggregate ?? {}
  const stabilityLabel = stability.level?.replaceAll('_', ' ') ?? '--'

  return (
    <section className="calibration-stability" aria-label="Cross-season stability">
      <div className="rating-lab-board-heading">
        <div>
          <p className="eyebrow">Cross-season validation</p>
          <h3>
            Stability: {stability.partial ? `partial · ${stabilityLabel}` : stabilityLabel}
          </h3>
        </div>
        <span>
          {stability.seasonsEvaluated ?? 0}/{stability.seasonsSelected ?? 0} seasons
        </span>
      </div>
      <div className="calibration-stability-grid">
        <span>Average season Brier <strong>{formatCalibrationScore(aggregate.averageSeasonBrier)}</strong></span>
        <span>Best season <strong>{aggregate.bestSeason?.label ?? '--'} · {formatCalibrationScore(aggregate.bestSeason?.brierScore)}</strong></span>
        <span>Worst season <strong>{aggregate.worstSeason?.label ?? '--'} · {formatCalibrationScore(aggregate.worstSeason?.brierScore)}</strong></span>
        <span>Range <strong>{formatCalibrationScore(stability.brierRange)}</strong></span>
        <span>Standard deviation <strong>{formatCalibrationScore(stability.brierStandardDeviation)}</strong></span>
        <span>Beats home-rate baseline <strong>{stability.seasonsBeatingHomeRate ?? 0}/{stability.seasonsEvaluated ?? 0}</strong></span>
        <span>Beats 50% baseline <strong>{stability.seasonsBeatingConstant50 ?? 0}/{stability.seasonsEvaluated ?? 0}</strong></span>
      </div>
      <p>
        Stable means Brier range ≤ 0.010 and standard deviation ≤ 0.005;
        mixed means range ≤ 0.020 and standard deviation ≤ 0.010. These are
        descriptive thresholds, not statistical significance tests.
      </p>
    </section>
  )
}

const getBaselineComparisonLabel = (status, baselineLabel) => {
  if (status === 'better') {
    return `Better than ${baselineLabel}`
  }

  if (status === 'worse') {
    return `Worse than ${baselineLabel}`
  }

  if (status === 'equal') {
    return `Matches ${baselineLabel}`
  }

  return `Comparison to ${baselineLabel} unavailable`
}

function CalibrationMetric({ detail, label, value }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function CalibrationRunDetails({ run }) {
  const distribution = run.metrics.predictionDistribution
  const finalSummary = run.finalRatingSummary ?? {}

  return (
    <details className="calibration-detail-card">
      <summary>
        <span>
          <strong>{run.displayLabel ?? run.label}</strong>
          <small>
            {run.dataset.gamesFound} found · {run.dataset.gamesIncluded} included ·{' '}
            {run.dataset.gamesSkipped} skipped · {run.dataset.source}
          </small>
        </span>
        <span>{run.diagnostics.centerInvariance.passed ? 'Center invariant' : 'Check center'}</span>
      </summary>

      <div className="calibration-diagnostic-grid">
        <div>
          <span>Prediction min</span>
          <strong>{formatCalibrationPercent(distribution.minimum)}</strong>
        </div>
        <div>
          <span>Prediction median</span>
          <strong>{formatCalibrationPercent(distribution.median)}</strong>
        </div>
        <div>
          <span>Prediction max</span>
          <strong>{formatCalibrationPercent(distribution.maximum)}</strong>
        </div>
        <div>
          <span>Favorite ≥60%</span>
          <strong>
            {formatCalibrationPercent(distribution.favoriteConfidenceAbove60Rate)}
          </strong>
        </div>
        <div>
          <span>Favorite ≥65%</span>
          <strong>
            {formatCalibrationPercent(distribution.favoriteConfidenceAbove65Rate)}
          </strong>
        </div>
        <div>
          <span>Favorite ≥70%</span>
          <strong>
            {formatCalibrationPercent(distribution.favoriteConfidenceAbove70Rate)}
          </strong>
        </div>
        <div>
          <span>Favorite ≥75%</span>
          <strong>
            {formatCalibrationPercent(distribution.favoriteConfidenceAbove75Rate)}
          </strong>
        </div>
      </div>

      <section className="calibration-formula-snapshot">
        <strong>Exact run snapshot</strong>
        <code>{run.diagnostics.formula ?? '--'}</code>
        <span>
          Scale {formatCalibrationScore(run.parameters.probabilityScale, 2)};
          home advantage {formatCalibrationScore(run.parameters.homeAdvantage, 2)};
          K {formatCalibrationScore(run.parameters.configuration.kFactor, 2)};
          multipliers REG{' '}
          {formatCalibrationScore(run.parameters.configuration.regulationMultiplier, 2)},
          OT {formatCalibrationScore(run.parameters.configuration.overtimeMultiplier, 2)},
          SO {formatCalibrationScore(run.parameters.configuration.shootoutMultiplier, 2)}.
        </span>
        <span>
          {run.filters?.seasonId ?? '--'} · {run.filters?.dateFrom ?? '--'} to{' '}
          {run.filters?.dateTo ?? '--'} ·{' '}
          {run.parameters.startingRatings.orderingSource ?? '--'}
        </span>
      </section>

      <SeasonBreakdown seasons={run.seasonResults ?? []} />

      {(run.seasonFailures ?? []).length > 0 ? (
        <div className="calibration-warning-list">
          <strong>Incomplete season coverage</strong>
          {run.seasonFailures.map((failure) => (
            <p key={failure.seasonId}>
              {failure.seasonLabel}: {failure.message}
            </p>
          ))}
        </div>
      ) : null}

      {run.finalRatingSummary ? (
        <FinalRatingSummary summary={finalSummary} teams={run.teamResults ?? []} />
      ) : null}

      <BucketTable
        actualLabel="Home win rate"
        buckets={run.calibrationBuckets}
        title="Home-win calibration buckets"
      />
      <BucketTable
        actualLabel="Favorite accuracy"
        buckets={run.confidenceBuckets}
        title="Prediction confidence distribution"
      />

      {Object.keys(run.dataset.skipReasons ?? {}).length > 0 ? (
        <div className="calibration-skip-list">
          <strong>Skip reasons</strong>
          {Object.entries(run.dataset.skipReasons).map(([reason, count]) => (
            <span key={reason}>
              {reason.replaceAll('_', ' ').toLowerCase()}: {count}
            </span>
          ))}
        </div>
      ) : null}

      {(run.warnings ?? []).length > 0 ? (
        <div className="calibration-warning-list">
          {(run.warnings ?? []).map((warning) => (
            <p key={warning.code}>{warning.message}</p>
          ))}
        </div>
      ) : null}

      <section className="calibration-metric-definitions">
        <strong>Metric definitions</strong>
        {Object.entries(run.diagnostics.metricDefinitions ?? {}).map(
          ([metric, definition]) => (
            <p key={metric}>
              <span>{metric.replaceAll(/([A-Z])/g, ' $1')}</span>: {definition}
            </p>
          ),
        )}
      </section>
    </details>
  )
}

function SeasonBreakdown({ seasons }) {
  return (
    <section className="calibration-season-breakdown">
      <div className="rating-lab-board-heading">
        <h3>Per-season breakdown</h3>
        <span>Ratings reset before every season</span>
      </div>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Games</th>
              <th>Brier</th>
              <th>Log loss</th>
              <th>ECE</th>
              <th>Accuracy</th>
              <th>Final spread</th>
              <th>50% baseline</th>
              <th>Home-rate baseline</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((season) => (
              <tr key={season.seasonId}>
                <td>
                  <strong>{season.label}</strong>
                  <small>{season.filters.dateFrom} to {season.filters.dateTo}</small>
                  <small>
                    {season.metadataSource === 'fallback'
                      ? 'tested fallback metadata'
                      : 'NHL API/cache'}
                    {' · '}{season.orderingSource}
                  </small>
                </td>
                <td>{season.dataset.gamesIncluded.toLocaleString()}</td>
                <td>{formatCalibrationScore(season.metrics.brierScore)}</td>
                <td>{formatCalibrationScore(season.metrics.logLoss)}</td>
                <td>{formatCalibrationPercent(season.metrics.expectedCalibrationError)}</td>
                <td>{formatCalibrationPercent(season.metrics.accuracy?.rate)}</td>
                <td>{formatCalibrationScore(season.finalRatingSummary?.spread, 2)}</td>
                <td>
                  {formatCalibrationScore(season.sanityBaselines?.constant50?.brierScore)}
                  <small>{season.baselineComparison?.constant50 ?? '--'}</small>
                </td>
                <td>
                  {formatCalibrationScore(season.sanityBaselines?.historicalHomeRate?.brierScore)}
                  <small>{season.baselineComparison?.historicalHomeRate ?? '--'}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FinalRatingSummary({ summary, teams }) {
  return (
    <section className="calibration-final-ratings">
      <div className="rating-lab-board-heading">
        <h3>Final temporary ratings</h3>
        <span>Top 5 and bottom 5</span>
      </div>
      <div className="calibration-final-rating-metrics">
        <span>Average <strong>{formatCalibrationScore(summary.average, 2)}</strong></span>
        <span>Highest <strong>{summary.highest?.abbreviation ?? '--'} {formatCalibrationScore(summary.highest?.rating, 2)}</strong></span>
        <span>Lowest <strong>{summary.lowest?.abbreviation ?? '--'} {formatCalibrationScore(summary.lowest?.rating, 2)}</strong></span>
        <span>Spread <strong>{formatCalibrationScore(summary.spread, 2)}</strong></span>
      </div>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table calibration-team-ratings-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Starting</th>
              <th>Final</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.teamId}>
                <td>{team.abbreviation}</td>
                <td>{formatCalibrationScore(team.startingRating, 2)}</td>
                <td>{formatCalibrationScore(team.finalRating, 2)}</td>
                <td>{formatCalibrationScore(team.netChange, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BucketTable({ actualLabel, buckets, title }) {
  return (
    <section className="calibration-buckets">
      <h4>{title}</h4>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Games</th>
              <th>Average probability</th>
              <th>{actualLabel}</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.label}>
                <td>{bucket.label}</td>
                <td>{bucket.count}</td>
                <td>{formatCalibrationPercent(bucket.averageProbability)}</td>
                <td>{formatCalibrationPercent(bucket.actualRate)}</td>
                <td>{formatCalibrationPercent(bucket.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default BaseModelCalibration
