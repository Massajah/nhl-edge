import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Database,
  LoaderCircle,
  Play,
  ShieldCheck,
} from 'lucide-react'
import {
  applyModelCalibrationPromotion,
  getModelCalibrationOptions,
  previewModelCalibrationPromotion,
  runModelCalibration,
  runModelCalibrationRobustness,
} from '../services/powerRatingSimulationsApi.js'
import {
  BASE_MODEL_CALIBRATION_FIELDS,
  MODEL_CALIBRATION_ROBUSTNESS_INTERVALS,
  MODEL_CALIBRATION_ROBUSTNESS_REPLICATES,
  addModelCalibrationCombinedSelection,
  createCombinedModelCalibrationExperiment,
  createIsolatedModelCalibrationExperiments,
  createModelCalibrationExperiments,
  createModelCalibrationForm,
  createModelCalibrationRequest,
  createModelCalibrationPromotionPreviewRequest,
  createModelCalibrationRobustnessForm,
  createModelCalibrationRobustnessRequest,
  createModelCalibrationShortlistState,
  getBestComparableCandidateId,
  getModelCalibrationCandidateStatus,
  getModelCalibrationDeltaPresentation,
  getModelCalibrationFeatureCount,
  getModelCalibrationHighlights,
  getModelCalibrationPromotionEligibility,
  getOrderedModelCalibrationRows,
  getOrderedModelCalibrationShortlist,
  getOverrideEntries,
  getPerSeasonComparisonRows,
  getModelCalibrationReviewFlags,
  getShortlistSeasonComparisonRows,
  getUnavailableModelCalibrationSelections,
  removeModelCalibrationCombinedSelection,
  updateModelCalibrationShortlist,
  validateModelCalibrationForm,
  validateModelCalibrationRobustnessForm,
} from '../utils/modelCalibration.js'
import {
  formatRatingLabCandidateType as formatCandidateType,
  formatRatingLabPromotionValue as formatPromotionValue,
} from '../utils/ratingLabPromotion.js'

const getErrorMessage = (error) =>
  error?.message || 'Unable to run Model Calibration. Check readiness and try again.'

const formatMetric = (value, decimals = 4) =>
  Number.isFinite(value) ? Number(value).toFixed(decimals) : '—'

const formatPercent = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

const formatDelta = (value) => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 0.0000005) return '0.0000'
  return `${value > 0 ? '+' : ''}${value.toFixed(4)}`
}

const formatSeasonLabel = (seasonId) => {
  const value = String(seasonId ?? '')

  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}–${value.slice(6)}`
    : value
}

const formatOverrideLabel = (key) => ({
  adjustment: 'Adjustment',
  backToBack: 'Back-to-Back',
  backToBackTravel: 'Back-to-Back + Travel',
  baseHomeAdvantage: 'Base Home Advantage',
  kFactor: 'K Factor',
  loserAdjustment: 'Previous-loser adjustment',
  maximumDays: 'Lookback window',
  overtimeMultiplier: 'OT multiplier',
  probabilityScale: 'Probability Scale',
  regulationMultiplier: 'REG multiplier',
  shootoutMultiplier: 'SO multiplier',
  threeInFour: '3 Games in 4 Days',
  topBottomN: 'Top / Bottom N',
  wellRested: 'Well Rested',
}[key] ?? key)

const formatOverrideValue = (key, value) => {
  if (key === 'maximumDays') return `${value} days`
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled'
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : String(value)
}

const formatSignedValue = (value) =>
  Number.isFinite(Number(value))
    ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}`
    : '—'

function ModelCalibration({
  initialCompletedRequest = null,
  initialErrorMessage = '',
  initialExpandedFamilies = [],
  initialExpandedRowIds = [],
  initialOptions = null,
  initialPromotionError = '',
  initialPromotionPreview = null,
  initialPromotionResult = null,
  initialPromotionStatus = 'idle',
  initialResult = null,
  initialRobustnessCandidateId = '',
  initialRobustnessError = '',
  initialRobustnessResult = null,
  initialRobustnessStatus = 'idle',
  initialShortlistCandidateIds = [],
  initialStatus = 'idle',
  applyPromotion = applyModelCalibrationPromotion,
  loadOptions = getModelCalibrationOptions,
  onOpenAdvancedLabs = () => {},
  previewPromotion = previewModelCalibrationPromotion,
  runCalibration = runModelCalibration,
  runRobustness = runModelCalibrationRobustness,
} = {}) {
  const [options, setOptions] = useState(initialOptions)
  const [optionsStatus, setOptionsStatus] = useState(
    initialOptions ? 'success' : 'loading',
  )
  const [form, setForm] = useState(() =>
    createModelCalibrationForm(initialOptions ?? {}),
  )
  const [runStatus, setRunStatus] = useState(
    initialResult ? 'success' : initialStatus,
  )
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [completedRun, setCompletedRun] = useState(() =>
    initialResult
      ? {
          request:
            initialCompletedRequest ?? createModelCalibrationRequest(form),
          result: initialResult,
        }
      : null,
  )
  const [expandedRows, setExpandedRows] = useState(
    () => new Set(initialExpandedRowIds),
  )
  const [shortlist, setShortlist] = useState(() =>
    createModelCalibrationShortlistState(
      initialResult,
      initialShortlistCandidateIds,
    ),
  )
  const [shortlistMessage, setShortlistMessage] = useState('')
  const [robustnessForm, setRobustnessForm] = useState(() =>
    createModelCalibrationRobustnessForm(
      initialRobustnessCandidateId || initialShortlistCandidateIds[0] || '',
    ),
  )
  const [robustnessResult, setRobustnessResult] = useState(
    initialRobustnessResult,
  )
  const [robustnessStatus, setRobustnessStatus] = useState(
    initialRobustnessResult ? 'success' : initialRobustnessStatus,
  )
  const [robustnessError, setRobustnessError] = useState(
    initialRobustnessError,
  )
  const [promotion, setPromotion] = useState(() => ({
    candidateId: initialPromotionPreview?.candidate?.candidateId ?? '',
    error: initialPromotionError,
    preview: initialPromotionPreview,
    result: initialPromotionResult,
    status: initialPromotionResult
      ? 'success'
      : initialPromotionStatus !== 'idle'
        ? initialPromotionStatus
        : initialPromotionPreview
        ? 'ready'
        : initialPromotionStatus,
  }))
  const robustnessRequestSequence = useRef(0)

  useEffect(() => {
    if (initialOptions) return undefined

    let active = true

    loadOptions()
      .then((loadedOptions) => {
        if (!active) return
        setOptions(loadedOptions)
        setForm(createModelCalibrationForm(loadedOptions))
        setOptionsStatus('success')
      })
      .catch((error) => {
        if (!active) return
        setErrorMessage(getErrorMessage(error))
        setOptionsStatus('error')
      })

    return () => {
      active = false
    }
  }, [initialOptions, loadOptions])

  const isolatedExperiments = useMemo(
    () => createIsolatedModelCalibrationExperiments(form),
    [form],
  )
  const experiments = useMemo(
    () => createModelCalibrationExperiments(form),
    [form],
  )
  const combinedExperiments = experiments.filter(
    (experiment) => experiment.type === 'COMBINED',
  )
  const combinableExperiments = isolatedExperiments.filter(
    (experiment) => experiment.type !== 'BASE_MODEL',
  )
  const combinedDraft = createCombinedModelCalibrationExperiment(
    form.combinedDraftCandidateIds,
    isolatedExperiments,
  )
  const combinedDraftTypes = (form.combinedDraftCandidateIds ?? []).map(
    (candidateId) => combinableExperiments.find(
      (candidate) => candidate.candidateId === candidateId,
    )?.type,
  ).filter(Boolean)
  const combinedDraftHasDuplicateFamily =
    new Set(combinedDraftTypes).size !== combinedDraftTypes.length
  const canAddCombined = Boolean(combinedDraft) &&
    !combinedDraftHasDuplicateFamily &&
    !combinedExperiments.some((candidate) =>
      candidate.candidateId === combinedDraft.candidateId)
  const unavailableSelections = useMemo(
    () => getUnavailableModelCalibrationSelections(options, form, experiments),
    [experiments, form, options],
  )
  const validationMessage = options
    ? validateModelCalibrationForm(options, form)
    : 'Calibration options are unavailable.'
  const isRunning = runStatus === 'loading'
  const isRobustnessRunning = robustnessStatus === 'loading'
  const robustnessValidationMessage = completedRun
    ? validateModelCalibrationRobustnessForm(
        completedRun.result,
        shortlist,
        robustnessForm,
      )
    : 'Complete calibration before running robustness analysis.'
  const selectedBaseline = options?.baselineModes?.find(
    (baseline) => baseline.id === form.baselineMode,
  )
  const selectedFeatures = selectedBaseline?.configuration?.features ?? {}
  const preparationLab = unavailableSelections.some((selection) =>
    selection.families.includes('specialTeams'))
    ? 'special-teams'
    : unavailableSelections.some((selection) =>
        selection.families.includes('teamHomeAdvantage'))
      ? 'home-advantage'
      : unavailableSelections.some((selection) =>
          selection.families.some((family) =>
            family === 'restFatigue' || family === 'quickRematch'))
        ? 'schedule-context'
        : 'calibration'

  const updateForm = (updater) => {
    setForm(updater)
    setErrorMessage('')
  }

  const toggleSeason = (seasonId) => {
    updateForm((current) => ({
      ...current,
      evaluationSeasons: current.evaluationSeasons.includes(seasonId)
        ? current.evaluationSeasons.filter((id) => id !== seasonId)
        : [...current.evaluationSeasons, seasonId].sort(),
    }))
  }

  const selectBaseline = (baselineMode) => {
    updateForm((current) =>
      createModelCalibrationForm({
        ...options,
        defaultBaselineMode: baselineMode,
        defaultSeasonIds: current.evaluationSeasons,
      }),
    )
  }

  const updateBaseCandidate = (field, values) => {
    updateForm((current) => ({
      ...current,
      baseModel: {
        ...current.baseModel,
        [field]: { ...current.baseModel[field], ...values },
      },
    }))
  }

  const toggleHomeAdjustment = (adjustment) => {
    updateForm((current) => {
      const selected = current.teamHomeAdvantage.selectedAdjustments
      const next = selected.includes(adjustment)
        ? selected.filter((value) => value !== adjustment)
        : [...selected, adjustment].sort((left, right) => left - right)

      return {
        ...current,
        teamHomeAdvantage: { selectedAdjustments: next },
      }
    })
  }

  const updateFamily = (family, values) => {
    updateForm((current) => ({
      ...current,
      [family]: { ...current[family], ...values },
    }))
  }

  const updateRestAdjustment = (ruleId, value) => {
    updateForm((current) => ({
      ...current,
      restFatigue: {
        ...current.restFatigue,
        adjustments: {
          ...current.restFatigue.adjustments,
          [ruleId]: Number(value),
        },
      },
    }))
  }

  const toggleCombinedDraftCandidate = (candidateId) => {
    updateForm((current) => ({
      ...current,
      combinedDraftCandidateIds: current.combinedDraftCandidateIds.includes(
        candidateId,
      )
        ? current.combinedDraftCandidateIds.filter((id) => id !== candidateId)
        : [...current.combinedDraftCandidateIds, candidateId],
    }))
  }

  const addCombinedCandidate = () => {
    if (!canAddCombined) return

    updateForm(addModelCalibrationCombinedSelection)
  }

  const removeCombinedCandidate = (candidateId) => {
    updateForm((current) =>
      removeModelCalibrationCombinedSelection(current, candidateId))
  }

  const toggleExpandedRow = (candidateId) => {
    setExpandedRows((current) => {
      const next = new Set(current)

      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })
  }

  const toggleShortlistCandidate = (candidateId) => {
    if (!completedRun) return

    const shouldInclude = !shortlist.candidateIds.includes(candidateId)
    const update = updateModelCalibrationShortlist(
      completedRun.result,
      shortlist,
      candidateId,
      shouldInclude,
    )

    setShortlistMessage(update.message)
    setShortlist(update.state)
    setRobustnessForm((current) => {
      if (!shouldInclude && current.candidateId === candidateId) {
        return {
          ...current,
          candidateId: update.state.candidateIds[0] ?? '',
        }
      }
      if (
        shouldInclude &&
        update.state.candidateIds.includes(candidateId) &&
        !current.candidateId
      ) {
        return { ...current, candidateId }
      }

      return current
    })
  }

  const updateRobustnessForm = (values) => {
    setRobustnessForm((current) => ({ ...current, ...values }))
    setRobustnessError('')
  }

  const handleRobustnessRun = async (event) => {
    event.preventDefault()
    if (
      !completedRun ||
      isRobustnessRunning ||
      robustnessValidationMessage
    ) {
      return
    }

    const request = createModelCalibrationRobustnessRequest(
      completedRun.result,
      robustnessForm,
    )

    if (!request) return

    const requestSequence = robustnessRequestSequence.current + 1
    robustnessRequestSequence.current = requestSequence
    setRobustnessStatus('loading')
    setRobustnessError('')

    try {
      const result = await runRobustness(request)

      if (requestSequence !== robustnessRequestSequence.current) return
      setRobustnessResult(result)
      setRobustnessStatus('success')
    } catch (error) {
      if (requestSequence !== robustnessRequestSequence.current) return
      setRobustnessError(
        error?.message || 'Unable to complete robustness analysis.',
      )
      setRobustnessStatus('error')
    }
  }

  const handlePromotionReview = async (candidateId) => {
    if (!completedRun || promotion.status === 'loading' ||
      promotion.status === 'applying') return

    const request = createModelCalibrationPromotionPreviewRequest(
      completedRun.result,
      candidateId,
    )

    setPromotion({
      candidateId,
      error: '',
      preview: null,
      result: null,
      status: 'loading',
    })

    try {
      const preview = await previewPromotion(request)

      setPromotion({
        candidateId,
        error: '',
        preview,
        result: null,
        status: 'ready',
      })
    } catch (error) {
      const stale = error?.details?.code === 'PRODUCTION_STATE_CHANGED'

      setPromotion({
        candidateId,
        error: stale
          ? 'Production settings changed after this calibration run. Re-run Model Calibration before promoting this candidate.'
          : error?.message || 'Unable to create a production promotion preview.',
        preview: null,
        result: null,
        status: stale ? 'stale' : 'error',
      })
    }
  }

  const handlePromotionApply = async () => {
    if (!promotion.preview || promotion.status !== 'ready' ||
      promotion.preview.validation?.noChanges) return

    setPromotion((current) => ({ ...current, error: '', status: 'applying' }))

    try {
      const result = await applyPromotion(
        promotion.preview.promotionPreviewId,
      )

      setPromotion((current) => ({
        ...current,
        result,
        status: 'success',
      }))
    } catch (error) {
      const stale = error?.details?.code === 'PRODUCTION_STATE_CHANGED'

      setPromotion((current) => ({
        ...current,
        error: stale
          ? 'Production settings changed after this calibration run. Re-run Model Calibration before promoting this candidate.'
          : error?.message || 'Unable to apply production settings.',
        status: stale ? 'stale' : 'ready',
      }))
    }
  }

  const closePromotionReview = () => {
    if (promotion.status === 'applying') return
    setPromotion({
      candidateId: '',
      error: '',
      preview: null,
      result: null,
      status: 'idle',
    })
  }

  const handleRun = async (event) => {
    event.preventDefault()
    if (isRunning || validationMessage) return

    const request = createModelCalibrationRequest(form)

    setRunStatus('loading')
    setErrorMessage('')

    try {
      const result = await runCalibration(request)

      setCompletedRun({ request, result })
      setExpandedRows(new Set())
      setShortlist(createModelCalibrationShortlistState(result))
      setShortlistMessage('')
      robustnessRequestSequence.current += 1
      setRobustnessForm(createModelCalibrationRobustnessForm())
      setRobustnessResult(null)
      setRobustnessStatus('idle')
      setRobustnessError('')
      setPromotion({
        candidateId: '',
        error: '',
        preview: null,
        result: null,
        status: 'idle',
      })
      setRunStatus('success')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      setRunStatus('error')
    }
  }

  if (optionsStatus === 'loading') {
    return (
      <div className="rating-lab-loading-state" role="status">
        <LoaderCircle className="button-spinner" aria-hidden="true" size={20} />
        <div>
          <strong>Loading Model Calibration</strong>
          <p>Checking historical readiness and the current production model.</p>
        </div>
      </div>
    )
  }

  if (!options) {
    return (
      <div className="rating-lab-warning-panel" role="alert">
        <strong>Model Calibration is unavailable</strong>
        <p>{errorMessage}</p>
      </div>
    )
  }

  return (
    <div className="model-calibration-page">
      <header className="model-calibration-header">
        <div>
          <p className="eyebrow">Unified workflow</p>
          <h2>Model Calibration</h2>
          <p>
            Test isolated and explicitly selected combined model changes
            against the same frozen historical dataset and baseline.
          </p>
        </div>
        <div className="model-calibration-safety" aria-label="Read-only calibration">
          <ShieldCheck aria-hidden="true" size={18} />
          <span><strong>Read-only calibration</strong><small>No production writes</small></span>
        </div>
      </header>

      <ol className="model-calibration-workflow" aria-label="Model Calibration workflow">
        {[
          'Configure Calibration',
          'Run Calibration',
          'Review Results',
          'Shortlist Candidates',
          'Compare Shortlist',
          'Run Robustness Analysis',
          'Review for Production',
        ].map((label, index) => (
          <li key={label}><span>{index + 1}</span>{label}</li>
        ))}
      </ol>

      <form className="model-calibration-form" onSubmit={handleRun}>
        <section className="model-calibration-panel" aria-labelledby="evaluation-dataset-heading">
          <div className="model-calibration-section-heading">
            <div><p className="eyebrow">Step 1</p><h3 id="evaluation-dataset-heading">Evaluation Dataset</h3></div>
            <span>{form.evaluationSeasons.length} seasons selected</span>
          </div>
          <div className="model-calibration-season-grid">
            {options.seasons.map((season) => {
              const selected = form.evaluationSeasons.includes(season.id)
              const ready = season.historicalDataset?.status === 'ready'

              return (
                <label className={`model-calibration-season ${selected ? 'selected' : ''}`} key={season.id}>
                  <input type="checkbox" checked={selected} onChange={() => toggleSeason(season.id)} />
                  <span><strong>{season.label}</strong><small>{ready ? 'Prepared' : 'Dataset not prepared'}</small></span>
                  <em className={ready ? 'ready' : 'unavailable'}>{ready ? 'Ready' : season.historicalDataset?.status ?? 'Not prepared'}</em>
                </label>
              )
            })}
          </div>
          {unavailableSelections.length > 0 ? (
            <div className="model-calibration-readiness" role="status">
              <Database aria-hidden="true" size={18} />
              <div>
                <strong>Additional preparation required</strong>
                <p>{unavailableSelections.map((item) => item.label).join(', ')} cannot run every selected experiment yet.</p>
              </div>
              <button type="button" onClick={() => onOpenAdvancedLabs(preparationLab)}>Open Advanced Labs</button>
            </div>
          ) : null}
        </section>

        <section className="model-calibration-panel" aria-labelledby="baseline-heading">
          <div className="model-calibration-section-heading">
            <div><p className="eyebrow">Step 2</p><h3 id="baseline-heading">Baseline</h3></div>
          </div>
          <div className="model-calibration-baselines" role="radiogroup" aria-label="Calibration baseline">
            {options.baselineModes.map((baseline) => (
              <label className={form.baselineMode === baseline.id ? 'selected' : ''} key={baseline.id}>
                <input type="radio" name="model-calibration-baseline" checked={form.baselineMode === baseline.id} onChange={() => selectBaseline(baseline.id)} />
                <span><strong>{baseline.label}</strong><small>{baseline.description}</small></span>
              </label>
            ))}
          </div>
          <p className="model-calibration-helper">
            The selected baseline is the reference for every candidate delta.
            Current Production and the Canonical Base Model are distinct baselines.
          </p>
          <BaselineConfigurationSummary
            configuration={selectedBaseline?.configuration}
            description={selectedBaseline?.description}
            label={selectedBaseline?.label}
          />
          <div className="model-calibration-starting-state">
            <strong>Starting state</strong>
            <span>{options.startingState.label}</span>
            <small>{options.startingState.description}</small>
          </div>
        </section>

        <section className="model-calibration-panel" aria-labelledby="experiments-heading">
          <div className="model-calibration-section-heading">
            <div><p className="eyebrow">Step 3</p><h3 id="experiments-heading">Experiments</h3></div>
            <span>Baseline + {isolatedExperiments.length} isolated + {combinedExperiments.length} combined · {experiments.length + 1} total evaluations</span>
          </div>
          <p className="model-calibration-helper">
            Isolated candidates change one selected feature family. Combined
            candidates test only the explicit cross-family combinations you add;
            all other model settings remain frozen to the selected baseline.
          </p>

          <div className="model-calibration-experiments">
            <details open={initialExpandedFamilies.includes('baseModel')}>
              <summary><span><strong>Base Model Parameters</strong><small>Scale, home advantage, K and result multipliers</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body">
                <p>Each checked parameter becomes one isolated candidate. Starting Rating experiments remain in Advanced Labs because they can change comparison identity.</p>
                <div className="model-calibration-base-grid">
                  {BASE_MODEL_CALIBRATION_FIELDS.map((field) => (
                    <label key={field.key}>
                      <input type="checkbox" checked={form.baseModel[field.key].enabled} onChange={(event) => updateBaseCandidate(field.key, { enabled: event.target.checked })} />
                      <span>{field.label}</span>
                      <input aria-label={`${field.label} candidate`} type="number" min={field.min} max={field.max} step={field.step} value={form.baseModel[field.key].value} onChange={(event) => updateBaseCandidate(field.key, { value: event.target.value })} />
                    </label>
                  ))}
                </div>
              </div>
            </details>

            <details open={initialExpandedFamilies.includes('teamHomeAdvantage')}>
              <summary><span><strong>Team Home Advantage</strong><small>Leakage-safe preseason tiers and symmetric adjustment</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body">
                <p className="model-calibration-family-baseline">Baseline: {selectedFeatures.teamHomeAdvantage?.enabled ? `${selectedFeatures.teamHomeAdvantage.adjustments?.length ?? 0} saved team adjustments` : 'Disabled'}</p>
                <div className="model-calibration-choice-row">
                  {(options.candidateDefinitions.teamHomeAdvantage.adjustmentOptions ?? []).filter((value) => value !== 0).map((adjustment) => (
                    <label key={adjustment}>
                      <input type="checkbox" checked={form.teamHomeAdvantage.selectedAdjustments.includes(adjustment)} onChange={() => toggleHomeAdjustment(adjustment)} />
                      <span>±{Number(adjustment).toFixed(2)}</span>
                    </label>
                  ))}
                </div>
                <button className="model-calibration-advanced-link" type="button" onClick={() => onOpenAdvancedLabs('home-advantage')}>Open tier diagnostics in Advanced Labs</button>
              </div>
            </details>

            <details open={initialExpandedFamilies.includes('restFatigue')}>
              <summary><span><strong>Rest &amp; Fatigue</strong><small>One coherent priority-preserving configuration</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body">
                <p className="model-calibration-family-baseline">Baseline: {selectedFeatures.restFatigue?.enabled ? 'Enabled' : 'Disabled'}</p>
                <label className="model-calibration-enable"><input type="checkbox" checked={form.restFatigue.enabled} onChange={(event) => updateFamily('restFatigue', { enabled: event.target.checked })} /><span>Evaluate this configuration</span></label>
                <div className="model-calibration-select-grid">
                  {options.candidateDefinitions.restFatigue.rules.map((rule) => (
                    <label key={rule.id}><span>{rule.label}</span><select value={form.restFatigue.adjustments[rule.id]} onChange={(event) => updateRestAdjustment(rule.id, event.target.value)}>{rule.presetValues.map((value) => <option key={value} value={value}>{Number(value).toFixed(2)}</option>)}</select></label>
                  ))}
                </div>
                <small>Rules retain the existing mutual-exclusion priority.</small>
              </div>
            </details>

            <details open={initialExpandedFamilies.includes('quickRematch')}>
              <summary><span><strong>Quick Rematch</strong><small>Previous-loser adjustment and lookback</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body">
                <p className="model-calibration-family-baseline">Baseline: {selectedFeatures.quickRematch?.enabled ? `${selectedFeatures.quickRematch.maximumDays} days · +${Number(selectedFeatures.quickRematch.loserAdjustment).toFixed(2)}` : 'Disabled'}</p>
                <label className="model-calibration-enable"><input type="checkbox" checked={form.quickRematch.enabled} onChange={(event) => updateFamily('quickRematch', { enabled: event.target.checked })} /><span>Evaluate this configuration</span></label>
                <div className="model-calibration-select-grid two">
                  <label><span>Lookback window</span><select value={form.quickRematch.maximumDays} onChange={(event) => updateFamily('quickRematch', { maximumDays: Number(event.target.value) })}>{options.candidateDefinitions.quickRematch.windowOptions.map((value) => <option key={value} value={value}>{value} days</option>)}</select></label>
                  <label><span>Previous-loser adjustment</span><select value={form.quickRematch.loserAdjustment} onChange={(event) => updateFamily('quickRematch', { loserAdjustment: Number(event.target.value) })}>{options.candidateDefinitions.quickRematch.adjustmentOptions.map((value) => <option key={value} value={value}>+{Number(value).toFixed(2)}</option>)}</select></label>
                </div>
              </div>
            </details>

            <details open={initialExpandedFamilies.includes('specialTeams')}>
              <summary><span><strong>Special Teams</strong><small>Prior-season Top / Bottom N matchup signal</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body">
                <p className="model-calibration-family-baseline">Baseline: {selectedFeatures.specialTeams?.enabled ? `Top / Bottom ${selectedFeatures.specialTeams.topBottomN} · ±${Number(selectedFeatures.specialTeams.adjustmentMagnitude).toFixed(2)}` : 'Disabled'}</p>
                <label className="model-calibration-enable"><input type="checkbox" checked={form.specialTeams.enabled} onChange={(event) => updateFamily('specialTeams', { enabled: event.target.checked })} /><span>Evaluate this configuration</span></label>
                <div className="model-calibration-select-grid two">
                  <label><span>Top / Bottom N</span><select value={form.specialTeams.topBottomN} onChange={(event) => updateFamily('specialTeams', { topBottomN: Number(event.target.value) })}>{options.candidateDefinitions.specialTeams.thresholdOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label><span>Symmetric adjustment</span><select value={form.specialTeams.adjustment} onChange={(event) => updateFamily('specialTeams', { adjustment: Number(event.target.value) })}>{options.candidateDefinitions.specialTeams.adjustmentOptions.filter((value) => value !== 0).map((value) => <option key={value} value={value}>±{Number(value).toFixed(2)}</option>)}</select></label>
                </div>
                <button className="model-calibration-advanced-link" type="button" onClick={() => onOpenAdvancedLabs('special-teams')}>Open dataset diagnostics in Advanced Labs</button>
              </div>
            </details>

            <details open={initialExpandedFamilies.includes('combined')}>
              <summary><span><strong>Selected Combined Candidates</strong><small>Compose explicit configurations from selected feature candidates</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
              <div className="model-calibration-experiment-body model-calibration-combined-builder">
                <p>Combined candidates test selected feature changes together. Only combinations you explicitly add are evaluated.</p>
                <p className="model-calibration-family-baseline">Choose at least two configured candidates from different feature families. Base Model candidates stay isolated.</p>
                {combinableExperiments.length > 0 ? (
                  <div className="model-calibration-combined-options">
                    {combinableExperiments.map((candidate) => (
                      <label key={candidate.candidateId}>
                        <input type="checkbox" checked={form.combinedDraftCandidateIds.includes(candidate.candidateId)} onChange={() => toggleCombinedDraftCandidate(candidate.candidateId)} />
                        <span><strong>{candidate.label}</strong><small>{formatCandidateType(candidate.type)}</small></span>
                      </label>
                    ))}
                  </div>
                ) : <p className="model-calibration-empty-combined">Configure isolated feature candidates above to make them available here.</p>}
                {combinedDraftHasDuplicateFamily ? <small className="model-calibration-combined-warning">Select no more than one candidate from each feature family.</small> : null}
                <button className="model-calibration-add-combined" type="button" disabled={!canAddCombined} onClick={addCombinedCandidate}>Add explicit combination</button>
                {combinedExperiments.length > 0 ? (
                  <div className="model-calibration-combined-list">
                    {combinedExperiments.map((candidate) => (
                      <div key={candidate.candidateId}>
                        <span><strong>{candidate.label}</strong><small>{candidate.components.length} components</small></span>
                        <button type="button" onClick={() => removeCombinedCandidate(candidate.candidateId)}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        </section>

        {errorMessage ? <p className="form-status error" role="alert">{errorMessage}</p> : null}

        <section className="model-calibration-run-panel">
          <div><strong>Baseline + {isolatedExperiments.length} isolated + {combinedExperiments.length} combined · {experiments.length + 1} total evaluations</strong><small>{form.evaluationSeasons.length} selected seasons · {selectedBaseline?.label}</small></div>
          <button
            aria-describedby={
              validationMessage && !isRunning
                ? 'model-calibration-run-reason'
                : undefined
            }
            className="save-ratings-button"
            type="submit"
            disabled={isRunning || Boolean(validationMessage)}
          >
            {isRunning ? <LoaderCircle className="button-spinner" aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
            <span>{isRunning ? 'Running calibration…' : 'Run Calibration'}</span>
          </button>
        </section>

        {validationMessage && !isRunning ? (
          <p
            className="model-calibration-validation"
            id="model-calibration-run-reason"
          >
            Run Calibration is unavailable: {validationMessage}
          </p>
        ) : null}
      </form>

      {isRunning ? (
        <div className="model-calibration-running" role="status" aria-live="polite">
          <LoaderCircle className="button-spinner" aria-hidden="true" size={22} />
          <div><strong>Running calibration…</strong><p>Evaluating {isolatedExperiments.length} isolated and {combinedExperiments.length} combined candidates across {form.evaluationSeasons.length} seasons</p></div>
        </div>
      ) : null}

      {completedRun ? (
        <ModelCalibrationResults
          completedRun={completedRun}
          expandedRows={expandedRows}
          options={options}
          shortlist={shortlist}
          shortlistMessage={shortlistMessage}
          onToggleShortlist={toggleShortlistCandidate}
          onToggleRow={toggleExpandedRow}
          onRunRobustness={handleRobustnessRun}
          onApplyPromotion={handlePromotionApply}
          onClosePromotion={closePromotionReview}
          onReviewPromotion={handlePromotionReview}
          onUpdateRobustnessForm={updateRobustnessForm}
          robustnessError={robustnessError}
          robustnessForm={robustnessForm}
          robustnessResult={robustnessResult}
          robustnessStatus={robustnessStatus}
          robustnessValidationMessage={robustnessValidationMessage}
          promotion={promotion}
        />
      ) : null}
    </div>
  )
}

function BaselineConfigurationSummary({ configuration, description, label }) {
  if (!configuration) return null

  const model = configuration.model ?? {}
  const features = configuration.features ?? {}
  const specialTeams = features.specialTeams ?? {}
  const specialTeamsMode = !specialTeams.enabled
    ? 'Off'
    : specialTeams.automaticAdjustmentEnabled
      ? 'Automatic'
      : 'Alert only'

  return (
    <div className="model-calibration-baseline-summary">
      <div><strong>{label}</strong><small>{description ?? 'Configuration preview'}</small></div>
      <dl>
        <div><dt>Probability Scale</dt><dd>{formatMetric(model.probabilityScale, 2)}</dd></div>
        <div><dt>Base Home Advantage</dt><dd>{formatMetric(model.baseHomeAdvantage, 2)}</dd></div>
        <div><dt>K Factor</dt><dd>{formatMetric(model.kFactor, 2)}</dd></div>
        <div><dt>REG / OT / SO</dt><dd>{formatMetric(model.regulationMultiplier, 2)} / {formatMetric(model.overtimeMultiplier, 2)} / {formatMetric(model.shootoutMultiplier, 2)}</dd></div>
        <div><dt>Rest &amp; Fatigue</dt><dd>{features.restFatigue?.enabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Quick Rematch</dt><dd>{features.quickRematch?.enabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Special Teams</dt><dd>{specialTeamsMode}</dd></div>
        <div><dt>Team Home Adjustment</dt><dd>{features.teamHomeAdvantage?.enabled ? `${features.teamHomeAdvantage.adjustments?.length ?? 0} team values` : 'Disabled'}</dd></div>
      </dl>
    </div>
  )
}

function ModelCalibrationResults({
  completedRun,
  expandedRows,
  onApplyPromotion,
  onClosePromotion,
  onReviewPromotion,
  onRunRobustness,
  onToggleRow,
  onToggleShortlist,
  onUpdateRobustnessForm,
  options,
  promotion,
  robustnessError,
  robustnessForm,
  robustnessResult,
  robustnessStatus,
  robustnessValidationMessage,
  shortlist,
  shortlistMessage,
}) {
  const { request, result } = completedRun
  const rows = getOrderedModelCalibrationRows(result)
  const bestCandidateId = getBestComparableCandidateId(result)
  const bestCandidate = result.candidates?.find(
    (candidate) => candidate.candidateId === bestCandidateId,
  )
  const baselineLabel = options.baselineModes.find(
    (baseline) => baseline.id === result.baselineMode,
  )?.label ?? result.baselineMode

  return (
    <section className="model-calibration-results" aria-labelledby="comparison-results-heading">
      <div className="model-calibration-section-heading">
        <div><p className="eyebrow">Completed run</p><h3 id="comparison-results-heading">Comparison Results</h3></div>
      </div>

      <div className="model-calibration-run-summary">
        <div><span>Evaluation</span><strong>{request.evaluationSeasons.map(formatSeasonLabel).join(' · ')}</strong></div>
        <div><span>Games</span><strong>{result.evaluationContext.gameCount.toLocaleString()}</strong></div>
        <div><span>Baseline</span><strong>{baselineLabel}</strong></div>
        <div><span>Candidates</span><strong>{request.experiments.length}</strong></div>
        <div><span>Best comparable result</span><strong>{bestCandidate?.label ?? 'None'}</strong></div>
        <div><span>Δ Brier</span><strong className={bestCandidate?.comparison.deltaBrier < 0 ? 'improved' : ''}>{formatDelta(bestCandidate?.comparison.deltaBrier)}</strong></div>
      </div>

      <p className="model-calibration-interpretation">
        Lower Brier is better. Compare pooled improvement with season-by-season
        consistency before changing production settings. Negative Δ Brier
        indicates improvement.
      </p>

      {shortlistMessage ? (
        <p className="model-calibration-shortlist-message" role="status">
          {shortlistMessage}
        </p>
      ) : null}

      <div className="model-calibration-table-scroll">
        <table className="model-calibration-table">
          <thead><tr><th>Model</th><th>Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Accuracy</th><th>Seasons Improved</th><th>Games</th><th>Status</th><th>Compare</th><th><span className="sr-only">Details</span></th></tr></thead>
          <tbody>
            {rows.map((candidate) => {
              const status = getModelCalibrationCandidateStatus(candidate)
              const expanded = expandedRows.has(candidate.candidateId)
              const best = candidate.candidateId === bestCandidateId
              const consistency = candidate.diagnostics?.seasonConsistency
              const shortlisted = shortlist.candidateIds.includes(
                candidate.candidateId,
              )
              const shortlistDisabled =
                candidate.candidateType !== 'BASELINE' &&
                candidate.diagnostics?.comparability?.comparable !== true

              return [
                <tr className={`${best ? 'best-comparable' : ''} ${status === 'Failed' ? 'failed' : ''}`} key={candidate.candidateId}>
                  <td><strong>{candidate.label}</strong><span className={`model-calibration-type-badge ${candidate.candidateType.toLowerCase().replaceAll('_', '-')}`}>{formatCandidateType(candidate.candidateType)}{candidate.candidateType === 'COMBINED' ? ` · ${candidate.components.length} features` : ''}</span>{best ? <small>Best comparable Brier</small> : null}</td>
                  <td>{formatMetric(candidate.metrics.pooledBrier)}</td>
                  <td className={candidate.comparison.deltaBrier < 0 ? 'improved' : candidate.comparison.deltaBrier > 0 ? 'worse' : ''}>{candidate.candidateType === 'BASELINE' ? '—' : formatDelta(candidate.comparison.deltaBrier)}</td>
                  <td>{formatMetric(candidate.metrics.logLoss, 3)}</td>
                  <td>{formatPercent(candidate.metrics.accuracy)}</td>
                  <td>{candidate.candidateType === 'BASELINE' ? '—' : `${consistency?.seasonsImproved ?? 0}/${consistency?.seasonCount ?? 0}`}</td>
                  <td>{candidate.evaluation.games?.toLocaleString?.() ?? '—'}</td>
                  <td><span className={`model-calibration-status ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span></td>
                  <td className="model-calibration-shortlist-cell">
                    {candidate.candidateType === 'BASELINE' ? (
                      <span>Reference</span>
                    ) : (
                      <button
                        aria-label={`${shortlisted ? 'Remove' : 'Add'} ${candidate.label} ${shortlisted ? 'from' : 'to'} shortlist comparison`}
                        aria-pressed={shortlisted}
                        disabled={shortlistDisabled}
                        title={shortlistDisabled
                          ? 'Not directly comparable to this run baseline.'
                          : shortlisted
                            ? 'Remove from shortlist comparison'
                            : 'Add to shortlist comparison'}
                        type="button"
                        onClick={() => onToggleShortlist(candidate.candidateId)}
                      >
                        <span aria-hidden="true">{shortlisted ? '★' : '☆'}</span>
                      </button>
                    )}
                  </td>
                  <td><button aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${candidate.label} details`} type="button" onClick={() => onToggleRow(candidate.candidateId)}><ChevronDown aria-hidden="true" size={17} /></button></td>
                </tr>,
                expanded ? (
                  <tr className="model-calibration-detail-row" key={`${candidate.candidateId}-details`}><td colSpan="10"><CandidateDetails baseline={result.baseline} candidate={candidate} configuration={candidate.candidateType === 'BASELINE' ? result.evaluationContext.baselineConfiguration : null} /></td></tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      </div>

      <ShortlistComparison
        completedRun={completedRun}
        onRemoveCandidate={onToggleShortlist}
        onReviewPromotion={onReviewPromotion}
        promotion={promotion}
        shortlist={shortlist}
      />

      <RobustnessAnalysis
        completedRun={completedRun}
        errorMessage={robustnessError}
        form={robustnessForm}
        onRun={onRunRobustness}
        onUpdateForm={onUpdateRobustnessForm}
        result={robustnessResult}
        shortlist={shortlist}
        status={robustnessStatus}
        validationMessage={robustnessValidationMessage}
      />

      <PromotionReview
        onApply={onApplyPromotion}
        onClose={onClosePromotion}
        promotion={promotion}
      />

      <details className="model-calibration-run-details">
        <summary>Run Details</summary>
        <dl>
          <div><dt>Run ID</dt><dd>{result.runId}</dd></div>
          <div><dt>Dataset signature</dt><dd>{result.evaluationContext.datasetSignature}</dd></div>
          <div><dt>Starting-state signature</dt><dd>{result.evaluationContext.startingStateSignature}</dd></div>
          <div><dt>Baseline signature</dt><dd>{result.evaluationContext.baselineSignature}</dd></div>
          {result.evaluationContext.productionSnapshotId ? <div><dt>Production snapshot</dt><dd>{result.evaluationContext.productionSnapshotId}</dd></div> : null}
        </dl>
      </details>
    </section>
  )
}

const formatFeatureCount = (candidate) => {
  const count = getModelCalibrationFeatureCount(candidate)

  if (candidate.candidateType === 'BASELINE') return 'Baseline'
  if (candidate.candidateType === 'BASE_MODEL') {
    return 'Parameter change (not a feature component)'
  }
  if (!Number.isFinite(count)) return '—'
  return `${count} feature${count === 1 ? '' : 's'}`
}

const formatConsistency = (candidate) => {
  if (candidate.candidateType === 'BASELINE') return 'Reference'

  const consistency = candidate.diagnostics?.seasonConsistency

  if (
    !Number.isFinite(consistency?.seasonsImproved) ||
    !Number.isFinite(consistency?.seasonsEqual) ||
    !Number.isFinite(consistency?.seasonsWorse)
  ) {
    return '—'
  }

  return `${consistency.seasonsImproved} improved · ${consistency.seasonsEqual} equal · ${consistency.seasonsWorse} worse`
}

function ComparisonDelta({ isReference = false, metric, value }) {
  if (isReference) return <span>Reference</span>

  const presentation = getModelCalibrationDeltaPresentation(value, metric)

  return (
    <span
      aria-label={presentation.text}
      className={`model-calibration-comparison-delta ${presentation.direction}`}
    >
      {presentation.text}
    </span>
  )
}

function ComparisonMetricRow({ candidates, formatValue, label }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {candidates.map((candidate) => (
        <td key={candidate.candidateId}>{formatValue(candidate)}</td>
      ))}
    </tr>
  )
}

function ShortlistComparison({
  completedRun,
  onRemoveCandidate,
  onReviewPromotion,
  promotion,
  shortlist,
}) {
  const { request, result } = completedRun
  const candidates = useMemo(
    () => getOrderedModelCalibrationShortlist(result, shortlist),
    [result, shortlist],
  )
  const highlights = useMemo(
    () => getModelCalibrationHighlights(candidates),
    [candidates],
  )
  const perSeason = useMemo(
    () => getShortlistSeasonComparisonRows(candidates),
    [candidates],
  )

  if (candidates.length <= 1) return null

  const baseline = candidates[0]
  const seasonCount = baseline.evaluation?.seasons?.length ??
    request.evaluationSeasons?.length ??
    perSeason.length
  const gameCount = baseline.evaluation?.games ??
    result.evaluationContext?.gameCount

  return (
    <section
      className="model-calibration-shortlist"
      aria-labelledby="shortlist-comparison-heading"
    >
      <div className="model-calibration-shortlist-heading">
        <div>
          <p className="eyebrow">Review only</p>
          <h4 id="shortlist-comparison-heading">Shortlist Comparison</h4>
        </div>
        <span>{candidates.length - 1} / 5 shortlisted</span>
      </div>

      <p className="model-calibration-shortlist-summary">
        Comparing {baseline.label} with {candidates.length - 1} shortlisted
        candidate{candidates.length === 2 ? '' : 's'} across {seasonCount}{' '}
        season{seasonCount === 1 ? '' : 's'} and{' '}
        {Number.isFinite(gameCount) ? gameCount.toLocaleString() : '—'} games.
      </p>

      <div className="model-calibration-shortlist-scroll">
        <table className="model-calibration-shortlist-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {candidates.map((candidate) => {
                const flags = getModelCalibrationReviewFlags(
                  candidate,
                  highlights,
                )

                return (
                  <th scope="col" key={candidate.candidateId}>
                    <span className="model-calibration-shortlist-model">
                      <strong>{candidate.label}</strong>
                      <small>{formatCandidateType(candidate.candidateType)} · {formatFeatureCount(candidate)}</small>
                      {candidate.candidateType === 'BASELINE' ? (
                        <em>Reference</em>
                      ) : (
                        <button
                          aria-label={`Remove ${candidate.label} from shortlist comparison`}
                          type="button"
                          onClick={() => onRemoveCandidate(candidate.candidateId)}
                        >
                          Remove
                        </button>
                      )}
                      {flags.length > 0 ? (
                        <span className="model-calibration-review-flags">
                          {flags.map((flag) => (
                            <b key={flag.key}>{flag.label}</b>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <ComparisonMetricRow candidates={candidates} label="Pooled Brier" formatValue={(candidate) => formatMetric(candidate.metrics?.pooledBrier, 6)} />
            <ComparisonMetricRow candidates={candidates} label="Δ Brier vs Baseline" formatValue={(candidate) => <ComparisonDelta isReference={candidate.candidateType === 'BASELINE'} metric="brier" value={candidate.comparison?.deltaBrier} />} />
            <ComparisonMetricRow candidates={candidates} label="Log Loss" formatValue={(candidate) => formatMetric(candidate.metrics?.logLoss, 6)} />
            <ComparisonMetricRow candidates={candidates} label="Δ Log Loss vs Baseline" formatValue={(candidate) => <ComparisonDelta isReference={candidate.candidateType === 'BASELINE'} metric="logLoss" value={candidate.comparison?.deltaLogLoss} />} />
            <ComparisonMetricRow candidates={candidates} label="ECE" formatValue={(candidate) => formatMetric(candidate.metrics?.ece, 6)} />
            <ComparisonMetricRow candidates={candidates} label="Accuracy" formatValue={(candidate) => formatPercent(candidate.metrics?.accuracy)} />
            <ComparisonMetricRow candidates={candidates} label="Average Season Brier" formatValue={(candidate) => formatMetric(candidate.metrics?.averageSeasonBrier, 6)} />
            <ComparisonMetricRow candidates={candidates} label="Worst Season Brier" formatValue={(candidate) => formatMetric(candidate.metrics?.worstSeasonBrier, 6)} />
            <ComparisonMetricRow candidates={candidates} label="Seasons Improved / Equal / Worse" formatValue={formatConsistency} />
            <ComparisonMetricRow candidates={candidates} label="Feature Count" formatValue={formatFeatureCount} />
            <ComparisonMetricRow candidates={candidates} label="Candidate Type" formatValue={(candidate) => formatCandidateType(candidate.candidateType)} />
            <ComparisonMetricRow candidates={candidates} label="Components" formatValue={(candidate) => candidate.candidateType === 'COMBINED' ? candidate.components.map((component) => component.label ?? component.candidateId).join(' + ') : '—'} />
            <ComparisonMetricRow candidates={candidates} label="Vs Best Included Component" formatValue={(candidate) => {
              const interaction = candidate.diagnostics?.interaction

              if (candidate.candidateType !== 'COMBINED') return '—'
              if (!Number.isFinite(interaction?.combinedVsBestComponentDeltaBrier)) {
                return 'Component comparison unavailable.'
              }

              const component = result.candidates?.find((item) =>
                item.candidateId === interaction.bestComponentCandidateId)

              return (
                <span className="model-calibration-component-diagnostic">
                  <ComparisonDelta
                    metric="brier"
                    value={interaction.combinedVsBestComponentDeltaBrier}
                  />
                  <small>vs {component?.label ?? interaction.bestComponentCandidateId ?? 'best included isolated component'}</small>
                </span>
              )
            }} />
          </tbody>
        </table>
      </div>

      <div className="model-calibration-shortlist-seasons">
        <strong>Per-season comparison</strong>
        <p>Brier and Δ Brier use the frozen completed-run season results.</p>
        <div className="model-calibration-shortlist-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                {candidates.map((candidate) => (
                  <th scope="col" key={candidate.candidateId}>{candidate.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perSeason.map((season) => (
                <tr key={season.seasonId}>
                  <th scope="row">{formatSeasonLabel(season.seasonId)}</th>
                  {season.candidates.map((candidateSeason, index) => (
                    <td key={candidateSeason.candidateId}>
                      <strong>{formatMetric(candidateSeason.brier, 6)}</strong>
                      <ComparisonDelta
                        isReference={candidates[index].candidateType === 'BASELINE'}
                        metric="brier"
                        value={candidateSeason.deltaBrier}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="model-calibration-promotion-entry">
        <div>
          <p className="eyebrow">Controlled production promotion</p>
          <strong>Reviewed candidates</strong>
          <p>
            Open a server-authoritative preview before any production change.
            Metrics never authorize promotion automatically.
          </p>
        </div>
        <div className="model-calibration-promotion-candidates">
          {candidates.slice(1).map((candidate) => {
            const eligibility = getModelCalibrationPromotionEligibility(
              result,
              candidate,
            )
            const isLoading = promotion.candidateId === candidate.candidateId &&
              promotion.status === 'loading'

            return (
              <article key={candidate.candidateId}>
                <span>
                  <strong>{candidate.label}</strong>
                  <small>{formatCandidateType(candidate.candidateType)}</small>
                </span>
                {eligibility.eligible ? (
                  <button
                    disabled={isLoading || promotion.status === 'applying'}
                    type="button"
                    onClick={() => onReviewPromotion(candidate.candidateId)}
                  >
                    {isLoading ? (
                      <LoaderCircle
                        className="button-spinner"
                        aria-hidden="true"
                        size={15}
                      />
                    ) : null}
                    {isLoading ? 'Preparing Preview…' : 'Review for Production'}
                  </button>
                ) : (
                  <small className="model-calibration-promotion-ineligible">
                    {eligibility.reason}
                  </small>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const formatSignedMetric = (value, decimals = 6) => {
  if (!Number.isFinite(value)) return '—'

  const rounded = Number(value.toFixed(decimals))

  if (rounded === 0) return Number(0).toFixed(decimals)
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)}`
}

const formatBootstrapRate = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

function RobustnessAnalysis({
  completedRun,
  errorMessage,
  form,
  onRun,
  onUpdateForm,
  result,
  shortlist,
  status,
  validationMessage,
}) {
  const candidates = getOrderedModelCalibrationShortlist(
    completedRun.result,
    shortlist,
  ).filter((candidate) => candidate.candidateType !== 'BASELINE')
  const isRunning = status === 'loading'

  if (candidates.length === 0 && !result) return null

  const intervalPercent = result
    ? Math.round(result.method.intervalLevel * 100)
    : null
  const consistency = result?.seasonSensitivity
  const directionChanges = consistency?.leaveOneSeasonOut?.filter(
    (entry) => entry.directionChanged,
  ) ?? []

  return (
    <section
      className="model-calibration-robustness"
      aria-labelledby="robustness-analysis-heading"
    >
      <div className="model-calibration-shortlist-heading">
        <div>
          <p className="eyebrow">Descriptive uncertainty</p>
          <h4 id="robustness-analysis-heading">Robustness Analysis</h4>
        </div>
        <span>Paired · Review only</span>
      </div>

      <p className="model-calibration-shortlist-summary">
        Resample completed baseline and candidate predictions together in
        season-stratified chronological blocks. This does not rerun or reorder
        the rating engine.
      </p>

      {candidates.length > 0 ? (
        <form className="model-calibration-robustness-controls" onSubmit={onRun}>
          <label>
            <span>Candidate</span>
            <select
              value={form.candidateId}
              onChange={(event) => onUpdateForm({
                candidateId: event.target.value,
              })}
            >
              <option value="">Choose candidate</option>
              {candidates.map((candidate) => (
                <option value={candidate.candidateId} key={candidate.candidateId}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Bootstrap samples</span>
            <select
              value={form.replicates}
              onChange={(event) => onUpdateForm({
                replicates: Number(event.target.value),
              })}
            >
              {MODEL_CALIBRATION_ROBUSTNESS_REPLICATES.map((replicates) => (
                <option value={replicates} key={replicates}>
                  {replicates.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Bootstrap interval</span>
            <select
              value={form.intervalLevel}
              onChange={(event) => onUpdateForm({
                intervalLevel: Number(event.target.value),
              })}
            >
              {MODEL_CALIBRATION_ROBUSTNESS_INTERVALS.map((level) => (
                <option value={level} key={level}>
                  {Math.round(level * 100)}%
                </option>
              ))}
            </select>
          </label>
          <details className="model-calibration-robustness-seed">
            <summary>Advanced seed</summary>
            <label>
              <span>Optional deterministic seed</span>
              <input
                inputMode="numeric"
                max="4294967295"
                min="0"
                placeholder="Derived from frozen run"
                type="number"
                value={form.seed}
                onChange={(event) => onUpdateForm({ seed: event.target.value })}
              />
            </label>
          </details>
          <button
            disabled={isRunning || Boolean(validationMessage)}
            type="submit"
          >
            {isRunning ? (
              <LoaderCircle className="button-spinner" aria-hidden="true" size={16} />
            ) : null}
            {isRunning ? 'Analyzing…' : 'Run Robustness Analysis'}
          </button>
        </form>
      ) : (
        <p className="model-calibration-robustness-note">
          Shortlist a comparable candidate to run another analysis. The frozen
          completed analysis remains below.
        </p>
      )}

      {validationMessage && candidates.length > 0 && !isRunning ? (
        <p className="model-calibration-robustness-validation">
          {validationMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="form-status error" role="alert">{errorMessage}</p>
      ) : null}
      {isRunning ? (
        <div className="model-calibration-robustness-loading" role="status" aria-live="polite">
          <LoaderCircle className="button-spinner" aria-hidden="true" size={18} />
          <span>Building paired temporal blocks and resampling the frozen observations…</span>
        </div>
      ) : null}

      {result ? (
        <div className="model-calibration-robustness-result">
          <div className="model-calibration-robustness-result-heading">
            <div>
              <strong>{result.candidate.label}</strong>
              <small>Against {result.baseline.label} · frozen run {result.runId}</small>
            </div>
            <span>{result.method.replicates.toLocaleString()} resamples</span>
          </div>

          <div className="model-calibration-robustness-primary">
            <div>
              <span>Observed Δ Brier</span>
              <ComparisonDelta metric="brier" value={result.observed.deltaBrier} />
            </div>
            <div>
              <span>{intervalPercent}% bootstrap interval</span>
              <strong>
                {formatSignedMetric(result.bootstrap.deltaBrier.lower)} to{' '}
                {formatSignedMetric(result.bootstrap.deltaBrier.upper)}
              </strong>
              <small>
                Interval {result.bootstrap.deltaBrier.intervalCrossesZero
                  ? 'includes zero'
                  : 'does not include zero'}
              </small>
            </div>
            <div>
              <span>Better than baseline in resamples</span>
              <strong>{formatBootstrapRate(result.bootstrap.deltaBrier.proportionBetter)}</strong>
              <small>
                Worse {formatBootstrapRate(result.bootstrap.deltaBrier.proportionWorse)} · Equal{' '}
                {formatBootstrapRate(result.bootstrap.deltaBrier.proportionEqual)}
              </small>
            </div>
            <div>
              <span>Season consistency</span>
              <strong>
                {Number.isFinite(consistency?.seasonsImproved)
                  ? `${consistency.seasonsImproved} improved · ${consistency.seasonsEqual} equal · ${consistency.seasonsWorse} worse`
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="model-calibration-robustness-secondary">
            <div>
              <strong>Bootstrap distribution summary</strong>
              <dl>
                <div><dt>Mean Δ Brier</dt><dd>{formatSignedMetric(result.bootstrap.deltaBrier.mean)}</dd></div>
                <div><dt>Median Δ Brier</dt><dd>{formatSignedMetric(result.bootstrap.deltaBrier.median)}</dd></div>
                <div><dt>Observed Δ Log Loss</dt><dd>{formatSignedMetric(result.observed.deltaLogLoss)}</dd></div>
                <div><dt>Log Loss interval</dt><dd>{formatSignedMetric(result.bootstrap.deltaLogLoss.lower)} to {formatSignedMetric(result.bootstrap.deltaLogLoss.upper)}</dd></div>
              </dl>
            </div>
            <div>
              <strong>Season results</strong>
              <ul>
                {(consistency?.perSeason ?? []).map((season) => (
                  <li key={season.seasonId}>
                    <span>{formatSeasonLabel(season.seasonId)}</span>
                    <ComparisonDelta metric="brier" value={season.deltaBrier} />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className={`model-calibration-season-sensitivity ${consistency?.resultSensitiveToSeasonRemoval ? 'sensitive' : ''}`}>
            <strong>Leave-one-season-out sensitivity</strong>
            <p>
              {consistency?.resultSensitiveToSeasonRemoval
                ? `Result changes direction when ${directionChanges.map((entry) => formatSeasonLabel(entry.excludedSeasonId)).join(' or ')} is excluded.`
                : 'Result does not change direction when any single evaluated season is excluded.'}
            </p>
            <div>
              {(consistency?.leaveOneSeasonOut ?? []).map((entry) => (
                <span key={entry.excludedSeasonId}>
                  <b>Without {formatSeasonLabel(entry.excludedSeasonId)}</b>
                  <ComparisonDelta metric="brier" value={entry.deltaBrier} />
                </span>
              ))}
            </div>
          </div>

          <details className="model-calibration-method-details">
            <summary>Method details</summary>
            <dl>
              <div><dt>Method</dt><dd>{result.method.resamplingMethod.replaceAll('_', ' ')}</dd></div>
              <div><dt>Block definition</dt><dd>{result.method.blockDefinition}</dd></div>
              <div><dt>Interval</dt><dd>{intervalPercent}% {result.method.intervalMethod} bootstrap</dd></div>
              <div><dt>Replicates</dt><dd>{result.method.replicates.toLocaleString()}</dd></div>
              <div><dt>Seed</dt><dd>{result.method.seed}</dd></div>
              <div><dt>Observations</dt><dd>{result.observationSet.games.toLocaleString()} games · {result.observationSet.seasons.length} seasons</dd></div>
              <div><dt>Temporal blocks</dt><dd>{result.method.totalBlocks}</dd></div>
              <div><dt>Observation signature</dt><dd>{result.observationSet.signature}</dd></div>
            </dl>
            <p>
              Baseline and candidate losses are sampled as pairs. Repeatedly
              evaluating many candidates can introduce selection bias; this
              descriptive analysis does not correct for multiple comparisons.
            </p>
          </details>
        </div>
      ) : null}
    </section>
  )
}

function PromotionReview({ onApply, onClose, promotion }) {
  if (!promotion || promotion.status === 'idle') return null

  const preview = promotion.preview
  const result = promotion.result
  const robustness = preview?.robustnessSummary
  const bootstrap = robustness?.bootstrap?.deltaBrier
  const sensitivity = robustness?.seasonSensitivity
  const isApplying = promotion.status === 'applying'
  const isStale = promotion.status === 'stale'
  const noChanges = preview?.validation?.noChanges === true

  return (
    <div className="model-calibration-promotion-backdrop" role="presentation">
      <section
        aria-labelledby="promotion-review-heading"
        aria-modal="true"
        className="model-calibration-promotion-review"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Controlled production promotion</p>
            <h4 id="promotion-review-heading">Production Review</h4>
          </div>
          <button
            aria-label="Close production review"
            disabled={isApplying}
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        {promotion.status === 'loading' ? (
          <div className="model-calibration-promotion-loading" role="status">
            <LoaderCircle className="button-spinner" aria-hidden="true" size={18} />
            <span>Revalidating the frozen candidate and current production settings…</span>
          </div>
        ) : null}

        {promotion.error ? (
          <div
            className={`model-calibration-promotion-alert ${isStale ? 'stale' : 'error'}`}
            role="alert"
          >
            <strong>{isStale ? 'Production state changed' : 'Promotion unavailable'}</strong>
            <p>{promotion.error}</p>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="model-calibration-promotion-summary">
              <div>
                <span>Candidate</span>
                <strong>{preview.candidate.label}</strong>
                <small>{formatCandidateType(preview.candidate.candidateType)}</small>
              </div>
              <div>
                <span>Affected features</span>
                <strong>{preview.affectedFamilies.map(formatCandidateType).join(' · ')}</strong>
                {preview.candidate.productionResolution?.mode ===
                  'FROZEN_TIER_TO_TEAM_MAP' ? (
                    <small>
                      Team values resolved from the frozen{' '}
                      {formatSeasonLabel(
                        preview.candidate.productionResolution.sourceSeasonId,
                      )} tier assignment.
                    </small>
                  ) : null}
              </div>
              <div>
                <span>Calibration result</span>
                <strong>Δ Brier {formatSignedMetric(preview.candidate.calibrationResult?.comparison?.deltaBrier)}</strong>
                <small>{formatConsistency({
                  candidateType: preview.candidate.candidateType,
                  diagnostics: {
                    seasonConsistency:
                      preview.candidate.calibrationResult?.seasonConsistency,
                  },
                })}</small>
              </div>
              <div>
                <span>Current-state validation</span>
                <strong className={isStale ? 'worse' : 'improved'}>
                  {isStale ? 'Stale' : 'Current'}
                </strong>
                <small>{preview.validation.productionSnapshotCurrent
                  ? 'Relevant production state matches the frozen run.'
                  : 'Production state requires a new calibration.'}</small>
              </div>
            </div>

            <div className="model-calibration-promotion-robustness">
              <strong>Robustness review</strong>
              {robustness?.available ? (
                <dl>
                  <div><dt>Observed Δ Brier</dt><dd>{formatSignedMetric(robustness.observed?.deltaBrier)}</dd></div>
                  <div><dt>Bootstrap interval</dt><dd>{formatSignedMetric(bootstrap?.lower)} to {formatSignedMetric(bootstrap?.upper)}</dd></div>
                  <div><dt>Better than baseline</dt><dd>{formatBootstrapRate(bootstrap?.proportionBetter)}</dd></div>
                  <div><dt>Interval status</dt><dd>{bootstrap?.intervalCrossesZero ? 'Includes zero' : 'Does not include zero'}</dd></div>
                  <div><dt>Season consistency</dt><dd>{Number.isFinite(sensitivity?.seasonsImproved) ? `${sensitivity.seasonsImproved} improved · ${sensitivity.seasonsEqual} equal · ${sensitivity.seasonsWorse} worse` : '—'}</dd></div>
                  <div><dt>Leave-one-season-out</dt><dd>{sensitivity?.resultSensitiveToSeasonRemoval ? 'Direction changes when a season is removed' : 'No direction change when one season is removed'}</dd></div>
                </dl>
              ) : (
                <p>Robustness analysis has not been run for this candidate.</p>
              )}
              <small>These results are descriptive and do not approve or authorize promotion.</small>
            </div>

            <div className="model-calibration-promotion-diff">
              <div>
                <strong>Exact production diff</strong>
                <span>{preview.changes.length} changed · {preview.unchanged.length} unchanged</span>
              </div>
              {preview.diff.map((group) => (
                <section key={group.family}>
                  <h5>{group.label}</h5>
                  <div>
                    {group.fields.map((field) => (
                      <p
                        className={field.changed ? 'changed' : 'unchanged'}
                        key={field.path}
                      >
                        <span>{field.label}</span>
                        <b>{formatPromotionValue(field.path, field.before)}</b>
                        <i aria-hidden="true">→</i>
                        <b>{formatPromotionValue(field.path, field.after)}</b>
                        <small>{field.changed ? 'Changed' : 'Unchanged'}</small>
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {noChanges ? (
              <div className="model-calibration-promotion-alert">
                <strong>Production already matches this candidate.</strong>
                <p>No write or promotion audit record will be created.</p>
              </div>
            ) : null}

            {result ? (
              <div className="model-calibration-promotion-success" role="status">
                <strong>Production settings updated.</strong>
                <p>{result.affectedFamilies.map(formatCandidateType).join(' · ')}</p>
                <dl>
                  <div><dt>Applied</dt><dd>{new Date(result.appliedAt).toLocaleString()}</dd></div>
                  <div><dt>Promotion / audit ID</dt><dd>{result.promotionId}</dd></div>
                </dl>
                <small>
                  This completed calibration remains frozen and is now historical
                  relative to current production.
                </small>
              </div>
            ) : null}

            <details className="model-calibration-promotion-identities">
              <summary>Frozen identity details</summary>
              <dl>
                <div><dt>Run ID</dt><dd>{preview.runIdentity.runId}</dd></div>
                <div><dt>Candidate signature</dt><dd>{preview.candidate.configurationSignature}</dd></div>
                <div><dt>Dataset signature</dt><dd>{preview.runIdentity.datasetSignature}</dd></div>
                <div><dt>Game IDs signature</dt><dd>{preview.runIdentity.gameIdSignature}</dd></div>
                <div><dt>Starting-state signature</dt><dd>{preview.runIdentity.startingStateSignature}</dd></div>
                <div><dt>Baseline signature</dt><dd>{preview.runIdentity.baselineSignature}</dd></div>
                <div><dt>Production snapshot</dt><dd>{preview.runIdentity.productionSnapshotId}</dd></div>
                <div><dt>Preview expires</dt><dd>{new Date(preview.metadata.expiresAt).toLocaleString()}</dd></div>
              </dl>
            </details>

            {!result ? (
              <footer>
                <div>
                  <strong>This changes the production analysis model.</strong>
                  <small>
                    Apply is atomic and will revalidate production again immediately
                    before writing.
                  </small>
                </div>
                <button type="button" disabled={isApplying} onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={isApplying || isStale || noChanges ||
                    promotion.status !== 'ready'}
                  type="button"
                  onClick={onApply}
                >
                  {isApplying ? (
                    <LoaderCircle className="button-spinner" aria-hidden="true" size={16} />
                  ) : null}
                  {isApplying ? 'Applying…' : 'Apply to Production'}
                </button>
              </footer>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

function CandidateDetails({ baseline, candidate, configuration }) {
  const perSeason = getPerSeasonComparisonRows(candidate, baseline)
  const warnings = candidate.diagnostics?.comparability?.warnings ?? []
  const error = candidate.diagnostics?.error
  const consistency = candidate.diagnostics?.seasonConsistency
  const interaction = candidate.diagnostics?.interaction
  const isCombined = candidate.candidateType === 'COMBINED'

  return (
    <div className="model-calibration-candidate-details">
      {configuration ? (
        <BaselineConfigurationSummary
          configuration={configuration}
          description={candidate.metadata?.productionSnapshotId
            ? 'Frozen production snapshot used for this run'
            : 'Frozen reference configuration used for this run'}
          label="Frozen baseline configuration"
        />
      ) : isCombined ? (
        <div className="model-calibration-combined-details">
          <strong>Combined components</strong>
          {candidate.components.map((component) => (
            <div key={`${component.type}-${component.candidateId ?? 'inline'}`}>
              <span><b>{formatCandidateType(component.type)}</b>{component.label ?? component.candidateId ?? 'Inline component'}</span>
              {getOverrideEntries({ overrides: component.overrides })
                .map(({ key, value }) => (
                <small key={key}>{formatOverrideLabel(key)}: {formatOverrideValue(key, value)}</small>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="model-calibration-overrides">
          <strong>Tested override</strong>
          {getOverrideEntries(candidate).map((entry) => (
            <span key={entry.key}><b>{formatOverrideLabel(entry.key)}</b>{formatOverrideValue(entry.key, entry.value)}</span>
          ))}
        </div>
      )}

      {isCombined && candidate.configuration ? (
        <FrozenFeatureConfiguration configuration={candidate.configuration} />
      ) : null}

      {interaction ? (
        <div className="model-calibration-interaction">
          <strong>Descriptive component comparison</strong>
          <span>Best included isolated component Brier: {formatMetric(interaction.bestComponentBrier)}</span>
          <span>Combined vs best component Δ Brier: {formatDelta(interaction.combinedVsBestComponentDeltaBrier)}</span>
          <small>This is descriptive only and is not a statistical interaction estimate.</small>
        </div>
      ) : null}

      {configuration ? (
        <FrozenFeatureConfiguration configuration={configuration} />
      ) : consistency ? (
        <p className="model-calibration-consistency">
          <strong>Season consistency</strong>
          <span>{consistency.seasonsImproved ?? 0} improved · {consistency.seasonsEqual ?? 0} equal · {consistency.seasonsWorse ?? 0} worse</span>
        </p>
      ) : null}

      {error ? <p className="form-status error"><strong>Failed:</strong> {error.message}</p> : null}
      {warnings.length > 0 ? (
        <div className="model-calibration-comparison-warnings">
          <strong>Comparison notes</strong>
          {warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
        </div>
      ) : null}

      {perSeason.length > 0 ? (
        <div className="model-calibration-season-details">
          <strong>Season breakdown</strong>
          <table><thead><tr><th>Season</th><th>Games</th><th>Brier</th><th>Δ Brier</th><th>Log Loss</th><th>Accuracy</th><th>ECE</th></tr></thead><tbody>{perSeason.map((season) => <tr key={season.seasonId}><td>{formatSeasonLabel(season.seasonId)}</td><td>{season.games}</td><td>{formatMetric(season.brier)}</td><td className={season.deltaBrier < 0 ? 'improved' : season.deltaBrier > 0 ? 'worse' : ''}>{candidate.candidateType === 'BASELINE' ? '—' : formatDelta(season.deltaBrier)}</td><td>{formatMetric(season.logLoss, 3)}</td><td>{formatPercent(season.accuracy)}</td><td>{formatMetric(season.ece, 3)}</td></tr>)}</tbody></table>
        </div>
      ) : null}
    </div>
  )
}

function FrozenFeatureConfiguration({ configuration }) {
  const features = configuration.features ?? {}
  const rest = features.restFatigue ?? {}
  const quick = features.quickRematch ?? {}
  const specialTeams = features.specialTeams ?? {}
  const teamHome = features.teamHomeAdvantage ?? {}
  const teamAdjustments = teamHome.adjustments ?? []

  return (
    <div className="model-calibration-frozen-features">
      <strong>Exact frozen feature configuration</strong>
      <dl>
        <div><dt>3 Games in 4 Days</dt><dd>{formatSignedValue(rest.adjustments?.['3_games_in_4_days'])}</dd></div>
        <div><dt>Back-to-Back</dt><dd>{formatSignedValue(rest.adjustments?.back_to_back)}</dd></div>
        <div><dt>Back-to-Back + Travel</dt><dd>{formatSignedValue(rest.adjustments?.back_to_back_travel)}</dd></div>
        <div><dt>Well Rested</dt><dd>{rest.includeWellRested ? formatSignedValue(rest.adjustments?.well_rested) : 'Disabled'}</dd></div>
        <div><dt>Quick Rematch</dt><dd>{quick.enabled ? `${quick.maximumDays} days · ${formatSignedValue(quick.loserAdjustment)}` : 'Disabled'}</dd></div>
        <div><dt>Special Teams</dt><dd>{specialTeams.enabled ? `Top / Bottom ${specialTeams.topBottomN} · ${formatSignedValue(specialTeams.adjustmentMagnitude)} · ${specialTeams.automaticAdjustmentEnabled ? 'Automatic' : 'Alert only'}` : 'Disabled'}</dd></div>
        <div><dt>Team Home Adjustment</dt><dd>{teamHome.enabled ? `${teamHome.mode} · ${teamAdjustments.length} values` : 'Disabled'}</dd></div>
      </dl>
      {teamAdjustments.length > 0 ? (
        <details>
          <summary>{teamAdjustments.length} exact team adjustments</summary>
          <div>
            {teamAdjustments.map((adjustment) => (
              <span key={adjustment.teamId}><b>{adjustment.teamId}</b>{formatSignedValue(adjustment.adjustment)}</span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

export default ModelCalibration
