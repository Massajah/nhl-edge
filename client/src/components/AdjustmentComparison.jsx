import { useState } from 'react'
import { Info } from 'lucide-react'
import {
  GOALIE_SELECTION_TYPES,
  getGoalieSelectionSourceLabel,
  normalizeMaximumGoaliePenalty,
} from '../utils/goalies.js'
import { DEFAULT_MAXIMUM_GOALIE_PENALTY } from '../config/baseModel.js'
import {
  formatInjuryImpact,
  getTeamInjurySummary,
} from '../utils/injuries.js'
import {
  getGameContextForSide,
  getTeamGameContextPresentation,
} from '../utils/gameContext.js'

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const formatRating = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '--'

const formatAdjustment = (value) => {
  const numberValue = toNumber(value)

  return `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(2)}`
}

const formatSavePercentage = (savePercentage) =>
  Number.isFinite(savePercentage)
    ? savePercentage.toFixed(3).replace(/^0/, '')
    : '--'

const formatInteger = (value) =>
  Number.isFinite(value) ? String(value) : '--'

const getGoalieDisplayName = (goalie = {}) =>
  goalie.fullName || goalie.name || goalie.playerName || 'Goalie'

const getGoalieCurrentSeason = (stats) => stats?.currentSeason ?? null

function AdjustmentComparison({
  awayTeam,
  canPersistGoalies = false,
  finalRatings,
  goalieErrors,
  goalieStatsByPlayerId = {},
  goalieSaveMessage = '',
  goalieSaveStatus = 'idle',
  goalieStatuses,
  goalieValidationErrors = {},
  goalies,
  hasUnsavedGoalieChanges = false,
  homeTeam,
  injurySummaries,
  inputs,
  gameContext = null,
  gameContextMessage = '',
  gameContextStatus = 'idle',
  maximumGoaliePenalty = DEFAULT_MAXIMUM_GOALIE_PENALTY,
  onChange,
  onGoalieChange,
  onRetryGoalies,
  onSaveGoalies,
  specialTeamsContent = null,
}) {
  const storedAwayInjuryImpact = toNumber(inputs.away.storedInjuryImpact)
  const storedHomeInjuryImpact = toNumber(inputs.home.storedInjuryImpact)
  const awayGameInjuryImpact = toNumber(inputs.away.injuries)
  const homeGameInjuryImpact = toNumber(inputs.home.injuries)
  const awayInjurySummary = getTeamInjurySummary(
    injurySummaries,
    awayTeam.id,
  )
  const homeInjurySummary = getTeamInjurySummary(
    injurySummaries,
    homeTeam.id,
  )
  const automaticContext = {
    away: getAutomaticContextPresentation(gameContext, 'away', inputs.away),
    home: getAutomaticContextPresentation(gameContext, 'home', inputs.home),
  }

  return (
    <section
      className="team-adjustments-section"
      aria-label="Team adjustments"
    >
      <div className="team-adjustments-heading">
        <div>
          <p className="eyebrow">Team adjustments</p>
          <h2>Team Adjustments</h2>
        </div>
        <span>Aligned game inputs</span>
      </div>

      <AdjustmentGroup
        description="Selections and roster availability for this matchup."
        title="Game Inputs"
      >
        <GoalieSelectionPanel
          awayTeam={awayTeam}
          canPersist={canPersistGoalies}
          errorMessages={goalieValidationErrors}
          goalies={goalies}
          goalieErrors={goalieErrors}
          goalieSaveMessage={goalieSaveMessage}
          goalieSaveStatus={goalieSaveStatus}
          goalieStatuses={goalieStatuses}
          goalieStatsByPlayerId={goalieStatsByPlayerId}
          hasUnsavedChanges={hasUnsavedGoalieChanges}
          homeTeam={homeTeam}
          inputs={inputs}
          maximumGoaliePenalty={maximumGoaliePenalty}
          onChange={onGoalieChange}
          onRetry={onRetryGoalies}
          onSave={onSaveGoalies}
        />

        <InjuryContextPanel
          awaySummary={awayInjurySummary}
          awayTeam={awayTeam}
          homeSummary={homeInjurySummary}
          homeTeam={homeTeam}
        />
      </AdjustmentGroup>

      <AdjustmentGroup
        description="Read-only values supplied to the model."
        title="Automatic Adjustments"
        tone="automatic"
      >
        <ComparisonTable awayTeam={awayTeam} homeTeam={homeTeam}>
          <AdjustmentRow
            helpText="Base Home Advantage plus the home team's saved Home Adjustment. This is read-only in Analyzer."
            label="Effective home advantage"
          >
            <ReadOnlyCell muted sideLabel="Away" value="—" />
            <ReadOnlyCell
              sideLabel="Home"
              testId="analyzer-home-homeAdvantage"
              value={formatAdjustment(inputs.home.homeAdvantage)}
            />
          </AdjustmentRow>

          <AdjustmentRow
            helpText="Detected and calculated automatically by the production schedule context service, including Well Rested when enabled."
            label="Rest & Fatigue"
          >
            <ReadOnlyCell
              secondary={automaticContext.away.restLabel}
              sideLabel="Away"
              testId="analyzer-away-restFatigue"
              value={formatAdjustment(inputs.away.restFatigue)}
            />
            <ReadOnlyCell
              secondary={automaticContext.home.restLabel}
              sideLabel="Home"
              testId="analyzer-home-restFatigue"
              value={formatAdjustment(inputs.home.restFatigue)}
            />
          </AdjustmentRow>

          <AdjustmentRow label="Quick Rematch">
            <ReadOnlyCell
              secondary={automaticContext.away.quickRematchLabel}
              sideLabel="Away"
              testId="analyzer-away-quickRematchAdjustment"
              value={formatAdjustment(inputs.away.quickRematchAdjustment)}
            />
            <ReadOnlyCell
              secondary={automaticContext.home.quickRematchLabel}
              sideLabel="Home"
              testId="analyzer-home-quickRematchAdjustment"
              value={formatAdjustment(inputs.home.quickRematchAdjustment)}
            />
          </AdjustmentRow>
        </ComparisonTable>

        {gameContextStatus === 'loading' ? (
          <p className="automatic-adjustment-status" role="status">
            Loading production schedule context…
          </p>
        ) : null}
        {gameContextStatus === 'error' ? (
          <p className="automatic-adjustment-status error" role="alert">
            {gameContextMessage || 'Production schedule context unavailable.'}
          </p>
        ) : null}
        {specialTeamsContent}
      </AdjustmentGroup>

      <AdjustmentGroup
        description="Editable, deliberate inputs for this analysis."
        title="Manual Adjustments"
        tone="manual"
      >
        <ComparisonTable awayTeam={awayTeam} homeTeam={homeTeam}>
          <AdjustmentRow
            helpText="Use this only for cumulative or game-specific lineup effects not already included in the stored player injury impacts. Avoid double counting an absence already represented above."
            label="Game injury adjustment"
          >
            <NumberCell
              field="injuries"
              label="Game-specific injury adjustment"
              max="20"
              min="-20"
              secondary={[
                `Stored: ${formatAdjustment(storedAwayInjuryImpact)}`,
                `Total: ${formatAdjustment(storedAwayInjuryImpact + awayGameInjuryImpact)}`,
              ]}
              side="away"
              sideLabel="Away"
              step="0.5"
              teamName={awayTeam.name}
              value={inputs.away.injuries}
              onChange={onChange}
            />
            <NumberCell
              field="injuries"
              label="Game-specific injury adjustment"
              max="20"
              min="-20"
              secondary={[
                `Stored: ${formatAdjustment(storedHomeInjuryImpact)}`,
                `Total: ${formatAdjustment(storedHomeInjuryImpact + homeGameInjuryImpact)}`,
              ]}
              side="home"
              sideLabel="Home"
              step="0.5"
              teamName={homeTeam.name}
              value={inputs.home.injuries}
              onChange={onChange}
            />
          </AdjustmentRow>

          <AdjustmentRow
            helpText="Use only for clearly justified situational factors such as exceptional game importance."
            label="Motivation"
          >
            <NumberCell
              field="motivation"
              label="Motivation adjustment"
              max="2"
              min="-2"
              side="away"
              sideLabel="Away"
              step="0.25"
              teamName={awayTeam.name}
              value={inputs.away.motivation}
              onChange={onChange}
            />
            <NumberCell
              field="motivation"
              label="Motivation adjustment"
              max="2"
              min="-2"
              side="home"
              sideLabel="Home"
              step="0.25"
              teamName={homeTeam.name}
              value={inputs.home.motivation}
              onChange={onChange}
            />
          </AdjustmentRow>

          <AdjustmentRow
            helpText="Use for relevant factors not already represented by ratings, injuries, goalies, schedule or motivation."
            label="Manual / X-factor"
          >
            <NumberCell
              field="manualAdjustment"
              label="Manual or X-factor adjustment"
              max="2"
              min="-2"
              side="away"
              sideLabel="Away"
              step="0.25"
              teamName={awayTeam.name}
              value={inputs.away.manualAdjustment}
              onChange={onChange}
            />
            <NumberCell
              field="manualAdjustment"
              label="Manual or X-factor adjustment"
              max="2"
              min="-2"
              side="home"
              sideLabel="Home"
              step="0.25"
              teamName={homeTeam.name}
              value={inputs.home.manualAdjustment}
              onChange={onChange}
            />
          </AdjustmentRow>
        </ComparisonTable>
      </AdjustmentGroup>

      <details className="effective-rating-summary">
        <summary>
          <span>Effective Rating Summary</span>
          <strong>
            {awayTeam.abbreviation} {formatRating(finalRatings.away)} ·{' '}
            {homeTeam.abbreviation} {formatRating(finalRatings.home)}
          </strong>
        </summary>
        <ComparisonTable awayTeam={awayTeam} homeTeam={homeTeam}>
          <SummaryRow label="Power rating" values={[inputs.away.baseRating, inputs.home.baseRating]} rating />
          <SummaryRow label="Home advantage" values={[null, inputs.home.homeAdvantage]} />
          <SummaryRow label="Goalie" values={[inputs.away.goalieAdjustment, inputs.home.goalieAdjustment]} />
          <SummaryRow label="Stored injury" values={[inputs.away.storedInjuryImpact, inputs.home.storedInjuryImpact]} />
          <SummaryRow label="Game injury" values={[inputs.away.injuries, inputs.home.injuries]} />
          <SummaryRow label="Rest & Fatigue" values={[inputs.away.restFatigue, inputs.home.restFatigue]} />
          <SummaryRow label="Quick Rematch" values={[inputs.away.quickRematchAdjustment, inputs.home.quickRematchAdjustment]} />
          <SummaryRow label="Motivation" values={[inputs.away.motivation, inputs.home.motivation]} />
          <SummaryRow label="Manual / X-factor" values={[inputs.away.manualAdjustment, inputs.home.manualAdjustment]} />
          <SummaryRow final label="Effective rating" values={[finalRatings.away, finalRatings.home]} rating />
        </ComparisonTable>
      </details>
    </section>
  )
}

function getAutomaticContextPresentation(gameContext, side, sideInputs) {
  const context = getGameContextForSide(gameContext, side)
  const presentation = getTeamGameContextPresentation(context)
  const restAdjustment = presentation.appliedAdjustments.find((item) =>
    ['restFatigue', 'restFatigueOverride'].includes(item.category),
  )
  const quickRematchAdjustment = presentation.appliedAdjustments.find((item) =>
    ['quickRematch', 'quickRematchOverride'].includes(item.category),
  )

  return {
    quickRematchLabel: quickRematchAdjustment?.label ??
      (toNumber(sideInputs.quickRematchAdjustment) === 0
        ? 'Not triggered'
        : 'Production context'),
    restLabel: restAdjustment?.label ??
      (toNumber(sideInputs.restFatigue) === 0
        ? 'No fatigue adjustment'
        : 'Production context'),
  }
}

function AdjustmentGroup({ children, description, title, tone = 'neutral' }) {
  return (
    <section className={`team-adjustment-group ${tone}`}>
      <header className="team-adjustment-group-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{tone === 'manual' ? 'Editable' : tone === 'automatic' ? 'Read-only' : 'Game setup'}</span>
      </header>
      {children}
    </section>
  )
}

function ComparisonTable({ awayTeam, children, homeTeam }) {
  return (
    <div className="adjustment-comparison" role="table">
      <div className="adjustment-comparison-header" role="row">
        <div role="columnheader">Adjustment</div>
        <TeamColumnHeader label="Away" team={awayTeam} />
        <TeamColumnHeader label="Home" team={homeTeam} />
      </div>
      {children}
    </div>
  )
}

function SummaryRow({ final = false, label, rating = false, values }) {
  return (
    <AdjustmentRow label={label} tone={final ? 'final' : undefined}>
      {values.map((value, index) => (
        <ReadOnlyCell
          key={`${label}-${index}`}
          muted={value === null}
          sideLabel={index === 0 ? 'Away' : 'Home'}
          value={value === null ? '—' : rating ? formatRating(value) : formatAdjustment(value)}
        />
      ))}
    </AdjustmentRow>
  )
}

export function InjuryContextPanel({
  awaySummary,
  awayTeam,
  homeSummary,
  homeTeam,
}) {
  return (
    <section
      className="analyzer-injury-context"
      aria-label="Active injury context"
    >
      <div className="analyzer-injury-context-heading">
        <div>
          <h3>Active injuries</h3>
          <p>Compact stored-impact context for this matchup.</p>
        </div>
        <span>Game inputs</span>
      </div>
      <div className="analyzer-injury-context-grid">
        <InjuryContextCard summary={awaySummary} team={awayTeam} />
        <InjuryContextCard summary={homeSummary} team={homeTeam} />
      </div>
    </section>
  )
}

export function InjuryContextCard({
  initialExpanded = false,
  summary = {},
  team,
}) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const injuries = Array.isArray(summary.injuries) ? summary.injuries : []
  const skaterInjuries = injuries.filter((injury) => !injury.isGoalie)
  const goalieInjuries = injuries.filter((injury) => injury.isGoalie)

  return (
    <article className="analyzer-injury-card">
      <header>
        <strong>{team.name}</strong>
        {injuries.length > 0 ? (
          <button
            aria-expanded={expanded}
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Hide injuries' : 'View injuries'}
          </button>
        ) : null}
      </header>

      <p className="analyzer-injury-summary">
        <span>{injuries.length} active</span>
        <span aria-hidden="true">·</span>
        <span>Stored impact {formatInjuryImpact(summary.totalImpact)}</span>
      </p>

      {expanded ? (
        <div className="analyzer-injury-list">
          {skaterInjuries.map((injury) => (
            <AnalyzerInjuryRow injury={injury} key={injury.id || injury.playerName} />
          ))}

          {goalieInjuries.length > 0 ? (
            <div className="analyzer-goalie-injury-list">
              {goalieInjuries.map((injury) => (
                <div key={injury.id || injury.playerName}>
                  <span>
                    {injury.playerName} · {injury.position || 'G'}
                  </span>
                  <small>Goalie availability · excluded from injury impact</small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function AnalyzerInjuryRow({ injury }) {
  const zeroImpact = Number(injury.impact) === 0

  return (
    <div
      className={`analyzer-injury-row${zeroImpact ? ' zero-impact' : ''}`}
    >
      <span>
        {injury.playerName} · {injury.position || 'Unknown'}
      </span>
      <strong>{formatInjuryImpact(injury.impact)}</strong>
    </div>
  )
}

function TeamColumnHeader({ label, team }) {
  return (
    <div className="adjustment-team-heading" role="columnheader">
      <span>{label}</span>
      <strong>{team.name}</strong>
    </div>
  )
}

function AdjustmentRow({ children, helpText, label, tone }) {
  return (
    <div
      className={`adjustment-row ${tone ? `adjustment-row-${tone}` : ''}`}
      role="row"
    >
      <div className="adjustment-row-label" role="rowheader">
        <span>{label}</span>
        {helpText ? <InfoHint text={helpText} /> : null}
      </div>
      {children}
    </div>
  )
}

function InfoHint({ text }) {
  return (
    <span className="field-info" aria-label={text} title={text}>
      <Info aria-hidden="true" size={14} strokeWidth={2.2} />
    </span>
  )
}

function ReadOnlyCell({
  muted = false,
  secondary,
  sideLabel,
  testId,
  value,
}) {
  return (
    <div
      className={`adjustment-cell adjustment-readonly ${muted ? 'muted' : ''}`}
      data-side-label={sideLabel}
      data-testid={testId}
      role="cell"
    >
      <strong>{value}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  )
}

function NumberCell({
  field,
  label,
  max,
  min,
  onChange,
  secondary,
  side,
  sideLabel,
  step,
  teamName,
  value,
}) {
  const inputId = `analyzer-${side}-${field}`

  return (
    <div className="adjustment-cell" data-side-label={sideLabel} role="cell">
      <input
        aria-label={`${teamName} ${label}`}
        className="compact-number-input"
        data-testid={`analyzer-${side}-${field}`}
        id={inputId}
        inputMode="decimal"
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(side, field, event.target.value)}
      />
      {Array.isArray(secondary) ? (
        <div className="adjustment-cell-secondary">
          {secondary.map((line) => <small key={line}>{line}</small>)}
        </div>
      ) : secondary ? <small>{secondary}</small> : null}
    </div>
  )
}

export function GoalieSelectionPanel({
  awayTeam,
  canPersist,
  errorMessages,
  goalieErrors,
  goalieSaveMessage,
  goalieSaveStatus,
  goalies,
  goalieStatsByPlayerId,
  goalieStatuses,
  hasUnsavedChanges,
  homeTeam,
  inputs,
  maximumGoaliePenalty = DEFAULT_MAXIMUM_GOALIE_PENALTY,
  onChange,
  onRetry,
  onSave,
}) {
  const isSaving = goalieSaveStatus === 'saving'
  const hasErrors = Boolean(errorMessages.away || errorMessages.home)
  const configuredMaximum = normalizeMaximumGoaliePenalty(
    maximumGoaliePenalty,
  )
  const goalieHelper =
    `Goalie adjustment is relative to each team's normal starting goalie. ` +
    `0.00 = baseline. Maximum penalty: ${configuredMaximum.toFixed(2)}.`

  return (
    <section className="analyzer-goalie-panel" aria-label="Starting goalies">
      <div className="analyzer-goalie-panel-heading">
        <div>
          <h3>
            Starting goalies <InfoHint text={goalieHelper} />
          </h3>
          <p>Exactly one goalie adjustment is applied for each team.</p>
        </div>
        <span>{hasUnsavedChanges ? 'Unsaved changes' : 'Game inputs'}</span>
      </div>

      <div className="analyzer-goalie-grid">
        <GoalieSelectionCard
          errorMessage={errorMessages.away}
          goalies={goalies.away}
          goalieDataError={goalieErrors.away}
          goalieStatsByPlayerId={goalieStatsByPlayerId}
          label="Away"
          maximumGoaliePenalty={configuredMaximum}
          onChange={onChange}
          onRetry={onRetry.away}
          side="away"
          status={goalieStatuses.away}
          team={awayTeam}
          values={inputs.away}
        />
        <GoalieSelectionCard
          errorMessage={errorMessages.home}
          goalies={goalies.home}
          goalieDataError={goalieErrors.home}
          goalieStatsByPlayerId={goalieStatsByPlayerId}
          label="Home"
          maximumGoaliePenalty={configuredMaximum}
          onChange={onChange}
          onRetry={onRetry.home}
          side="home"
          status={goalieStatuses.home}
          team={homeTeam}
          values={inputs.home}
        />
      </div>

      <div className="analyzer-goalie-actions">
        {goalieSaveMessage ? (
          <p
            className={`form-status ${goalieSaveStatus === 'error' ? 'error' : 'success'}`}
            role={goalieSaveStatus === 'error' ? 'alert' : 'status'}
          >
            {goalieSaveMessage}
          </p>
        ) : null}
        {canPersist ? (
          <button
            className={hasUnsavedChanges ? 'save-ratings-button' : ''}
            disabled={
              isSaving || !hasUnsavedChanges || hasErrors
            }
            type="button"
            onClick={onSave}
          >
            {isSaving ? 'Saving...' : 'Save Goalie Selections'}
          </button>
        ) : (
          <small>
            Select a scheduled Dashboard game to persist goalie choices.
          </small>
        )}
      </div>
    </section>
  )
}

function GoalieSelectionCard({
  errorMessage,
  goalieDataError,
  goalies,
  goalieStatsByPlayerId,
  label,
  maximumGoaliePenalty,
  onChange,
  onRetry,
  side,
  status,
  team,
  values,
}) {
  const configuredMaximum = normalizeMaximumGoaliePenalty(
    maximumGoaliePenalty,
  )
  const selectionType = values.goalieSelectionType ?? 'unknown'
  const selectedGoalie = goalies.find(
    (goalie) => goalie.nhlPlayerId === Number(values.goalieNhlPlayerId),
  )
  const hasMissingSavedGoalie =
    selectionType === GOALIE_SELECTION_TYPES.PROVIDER && !selectedGoalie
  const selectionValue =
    selectionType === GOALIE_SELECTION_TYPES.PROVIDER
      ? `provider:${values.goalieNhlPlayerId}`
      : selectionType
  const selectedGoalieStats = values.goalieNhlPlayerId
    ? goalieStatsByPlayerId[String(values.goalieNhlPlayerId)]
    : null
  const sourceLabel = getGoalieSelectionSourceLabel(values)
  const isUnknown = selectionType === GOALIE_SELECTION_TYPES.UNKNOWN
  const isCustom = selectionType === GOALIE_SELECTION_TYPES.CUSTOM
  const isProvider = selectionType === GOALIE_SELECTION_TYPES.PROVIDER
  const [providerDetailsExpanded, setProviderDetailsExpanded] = useState(() =>
    Boolean(values.goalieOverrideEnabled || errorMessage),
  )

  return (
    <article className="analyzer-goalie-card">
      <header>
        <span>{label}</span>
        <strong>{team.name}</strong>
      </header>

      <label className="field" htmlFor={`analyzer-${side}-goalie-selection`}>
        <span>Starting goalie</span>
        <select
          id={`analyzer-${side}-goalie-selection`}
          data-testid={`analyzer-${side}-goalie-selection`}
          value={selectionValue}
          onChange={(event) => onChange(side, 'selection', event.target.value)}
        >
          <option value={GOALIE_SELECTION_TYPES.UNKNOWN}>Unknown starter</option>
          {goalies.map((goalie) => (
            <option
              key={goalie.nhlPlayerId}
              value={`provider:${goalie.nhlPlayerId}`}
            >
              {goalie.displayName} ({toNumber(goalie.ratingAdjustment).toFixed(2)})
            </option>
          ))}
          {hasMissingSavedGoalie ? (
            <option value={selectionValue}>
              {values.selectedGoalieName || 'Saved provider goalie'} (saved snapshot)
            </option>
          ) : null}
          <option value={GOALIE_SELECTION_TYPES.CUSTOM}>
            Other / Unlisted goalie
          </option>
        </select>
      </label>

      <dl className="goalie-selection-summary">
        <div>
          <dt>Goalie adjustment</dt>
          <dd data-testid={`analyzer-${side}-goalie-adjustment-value`}>
            {formatAdjustment(isUnknown ? 0 : values.goalieAdjustment)}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {isUnknown
              ? 'Unconfirmed'
              : isCustom
                ? 'Unlisted game input'
                : values.goalieOverrideEnabled
                  ? 'Provider goalie · game override'
                  : 'Provider goalie'}
          </dd>
          {isCustom ? <small>{sourceLabel}</small> : null}
        </div>
      </dl>

      {isCustom ? (
        <div className="analyzer-goalie-expanded-inputs">
          <label className="field" htmlFor={`analyzer-${side}-goalie-name`}>
            <span>Name / note (optional)</span>
            <input
              id={`analyzer-${side}-goalie-name`}
              maxLength="120"
              placeholder="AHL recall"
              type="text"
              value={values.selectedGoalieName}
              onChange={(event) =>
                onChange(side, 'goalieName', event.target.value)
              }
            />
            <small>Applies to this game only.</small>
          </label>
          <GoalieAdjustmentControl
            configuredMaximum={configuredMaximum}
            errorMessage={errorMessage}
            isCustom
            onChange={onChange}
            side={side}
            values={values}
          />
        </div>
      ) : null}

      {isProvider ? (
        <div className="analyzer-goalie-details">
          <button
            aria-controls={`analyzer-${side}-goalie-details`}
            aria-expanded={providerDetailsExpanded}
            type="button"
            onClick={() => setProviderDetailsExpanded((current) => !current)}
          >
            {providerDetailsExpanded
              ? 'Hide goalie details'
              : 'View goalie details'}
          </button>
          {providerDetailsExpanded ? (
            <div
              className="analyzer-goalie-expanded-inputs"
              id={`analyzer-${side}-goalie-details`}
            >
              <p>
                Team default:{' '}
                <strong>
                  {formatAdjustment(values.goalieTeamDefaultAdjustment)}
                </strong>
              </p>
              <GoalieAdjustmentControl
                configuredMaximum={configuredMaximum}
                errorMessage={errorMessage}
                onChange={onChange}
                side={side}
                values={values}
              />
              {values.goalieOverrideEnabled ? (
                <button
                  className="goalie-reset-default-button"
                  type="button"
                  onClick={() => onChange(side, 'resetToTeamDefault', true)}
                >
                  Reset to team default
                </button>
              ) : null}
              <GoalieStatsSummary
                errorMessage={goalieDataError}
                goalie={selectedGoalie}
                onRetry={onRetry}
                stats={selectedGoalieStats}
                status={status}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function GoalieAdjustmentControl({
  configuredMaximum,
  errorMessage,
  isCustom = false,
  onChange,
  side,
  values,
}) {
  return (
    <>
      <label className="field" htmlFor={`analyzer-${side}-goalie-adjustment`}>
        <span>
          {isCustom
            ? 'Game-specific goalie adjustment'
            : 'Game adjustment'}
        </span>
        <input
          aria-invalid={Boolean(errorMessage)}
          id={`analyzer-${side}-goalie-adjustment`}
          inputMode="decimal"
          max="0"
          min={configuredMaximum}
          required
          step="0.05"
          type="number"
          value={
            values.goalieOverrideEnabled
              ? (values.goalieManualAdjustment ?? '')
              : (values.goalieTeamDefaultAdjustment ?? '')
          }
          onChange={(event) =>
            onChange(side, 'manualAdjustment', event.target.value)
          }
        />
      </label>
      {errorMessage ? (
        <p className="field-error" role="alert">{errorMessage}</p>
      ) : null}
    </>
  )
}

function GoalieStatsSummary({
  errorMessage,
  goalie,
  onRetry,
  stats,
  status,
}) {
  if (status === 'error') {
    return (
      <div className="goalie-summary goalie-summary-error" role="alert">
        <span>{errorMessage || 'Goalie data unavailable.'}</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (!goalie) {
    return (
      <div className="goalie-summary muted">
        {status === 'loading' || status === 'idle'
          ? 'Loading goalies'
          : 'Unknown / Not confirmed'}
      </div>
    )
  }

  const currentSeason = getGoalieCurrentSeason(stats)

  if (currentSeason?.dataStatus !== 'available') {
    return (
      <div className="goalie-summary muted">
        {currentSeason?.dataStatus === 'no_nhl_games'
          ? 'No NHL games this season'
          : 'Current-season stats unavailable'}
      </div>
    )
  }

  return (
    <div
      className="goalie-summary goalie-stat-line"
      aria-label={`${getGoalieDisplayName(goalie)} selected goalie statistics`}
    >
      <span>SV% {formatSavePercentage(currentSeason.savePercentage)}</span>
      <span>GP {formatInteger(currentSeason.gamesPlayed)}</span>
      <span>GS {formatInteger(currentSeason.gamesStarted)}</span>
    </div>
  )
}

export default AdjustmentComparison
