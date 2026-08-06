import { Info } from 'lucide-react'
import {
  GOALIE_SELECTION_TYPES,
  getGoalieSelectionSourceLabel,
} from '../utils/goalies.js'

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const formatRating = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '--'

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
  inputs,
  isGameContextManaged = false,
  onChange,
  onGoalieChange,
  onRetryGoalies,
  onSaveGoalies,
}) {
  const storedAwayInjuryImpact = toNumber(inputs.away.storedInjuryImpact)
  const storedHomeInjuryImpact = toNumber(inputs.home.storedInjuryImpact)
  const awayGameInjuryImpact = toNumber(inputs.away.injuries)
  const homeGameInjuryImpact = toNumber(inputs.home.injuries)

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
        onChange={onGoalieChange}
        onRetry={onRetryGoalies}
        onSave={onSaveGoalies}
      />

      <div className="adjustment-comparison" role="table">
        <div className="adjustment-comparison-header" role="row">
          <div role="columnheader">Adjustment</div>
          <TeamColumnHeader label="Away" team={awayTeam} />
          <TeamColumnHeader label="Home" team={homeTeam} />
        </div>

        <AdjustmentRow label="Power rating">
          <ReadOnlyCell
            sideLabel="Away"
            value={formatRating(inputs.away.baseRating)}
          />
          <ReadOnlyCell
            sideLabel="Home"
            value={formatRating(inputs.home.baseRating)}
          />
        </AdjustmentRow>

        <AdjustmentRow
          helpText="Base Home Advantage plus the home team's saved Home Adjustment; edit here only for this analysis."
          label="Effective home advantage"
        >
          <ReadOnlyCell muted sideLabel="Away" value="-" />
          <NumberCell
            field="homeAdvantage"
            label="Effective home advantage"
            max="10"
            min="-10"
            side="home"
            sideLabel="Home"
            step="0.5"
            teamName={homeTeam.name}
            value={inputs.home.homeAdvantage}
            onChange={onChange}
          />
        </AdjustmentRow>

        <AdjustmentRow label="Stored injury impact">
          <ReadOnlyCell
            sideLabel="Away"
            value={storedAwayInjuryImpact.toFixed(1)}
          />
          <ReadOnlyCell
            sideLabel="Home"
            value={storedHomeInjuryImpact.toFixed(1)}
          />
        </AdjustmentRow>

        <AdjustmentRow label="Game injury adjustment">
          <NumberCell
            field="injuries"
            label="Game-specific injury adjustment"
            max="20"
            min="-20"
            secondary={`Total: ${(
              storedAwayInjuryImpact + awayGameInjuryImpact
            ).toFixed(1)}`}
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
            secondary={`Total: ${(
              storedHomeInjuryImpact + homeGameInjuryImpact
            ).toFixed(1)}`}
            side="home"
            sideLabel="Home"
            step="0.5"
            teamName={homeTeam.name}
            value={inputs.home.injuries}
            onChange={onChange}
          />
        </AdjustmentRow>

        <AdjustmentRow
          helpText={
            isGameContextManaged
              ? 'This value is managed by the normalized Game Context below.'
              : 'Back-to-backs, compressed schedules, travel, rest edge and road-trip fatigue.'
          }
          label="Rest & fatigue"
        >
          {isGameContextManaged ? (
            <>
              <ReadOnlyCell
                secondary="Game Context"
                sideLabel="Away"
                testId="analyzer-away-restFatigue"
                value={toNumber(inputs.away.restFatigue).toFixed(2)}
              />
              <ReadOnlyCell
                secondary="Game Context"
                sideLabel="Home"
                testId="analyzer-home-restFatigue"
                value={toNumber(inputs.home.restFatigue).toFixed(2)}
              />
            </>
          ) : (
            <>
              <NumberCell
                field="restFatigue"
                label="Rest and fatigue adjustment"
                max="3"
                min="-3"
                side="away"
                sideLabel="Away"
                step="0.25"
                teamName={awayTeam.name}
                value={inputs.away.restFatigue}
                onChange={onChange}
              />
              <NumberCell
                field="restFatigue"
                label="Rest and fatigue adjustment"
                max="3"
                min="-3"
                side="home"
                sideLabel="Home"
                step="0.25"
                teamName={homeTeam.name}
                value={inputs.home.restFatigue}
                onChange={onChange}
              />
            </>
          )}
        </AdjustmentRow>

        <AdjustmentRow
          helpText="Use conservatively for playoff race, rematch context, coaching changes or similar game importance."
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

        <AdjustmentRow label="Effective rating" tone="final">
          <ReadOnlyCell
            sideLabel="Away"
            value={formatRating(finalRatings.away)}
          />
          <ReadOnlyCell
            sideLabel="Home"
            value={formatRating(finalRatings.home)}
          />
        </AdjustmentRow>
      </div>

      <details className="adjustment-guide">
        <summary>Adjustment Guide</summary>
        <p>
          Rest handles schedule and travel. Motivation is for game context.
          Manual / X-factor is only for meaningful inputs not covered elsewhere.
        </p>
      </details>
    </section>
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
      {secondary ? <small>{secondary}</small> : null}
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
  onChange,
  onRetry,
  onSave,
}) {
  const isSaving = goalieSaveStatus === 'saving'
  const hasErrors = Boolean(errorMessages.away || errorMessages.home)

  return (
    <section className="analyzer-goalie-panel" aria-label="Starting goalies">
      <div className="analyzer-goalie-panel-heading">
        <div>
          <h3>Starting goalies</h3>
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
  onChange,
  onRetry,
  side,
  status,
  team,
  values,
}) {
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

      <span className="goalie-selection-source">{sourceLabel}</span>

      {isUnknown ? (
        <dl className="goalie-selection-summary">
          <div><dt>Goalie adjustment</dt><dd>0.00</dd></div>
          <div><dt>Status</dt><dd>Unconfirmed</dd></div>
        </dl>
      ) : (
        <>
          {isCustom ? (
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
          ) : null}

          {isProvider ? (
            <dl className="goalie-selection-summary provider-default">
              <div>
                <dt>Team default</dt>
                <dd>{toNumber(values.goalieTeamDefaultAdjustment).toFixed(2)}</dd>
              </div>
              <div>
                <dt>Game input</dt>
                <dd>
                  {values.goalieOverrideEnabled
                    ? 'Game-specific override'
                    : 'Uses team default'}
                </dd>
              </div>
            </dl>
          ) : null}

          <label className="field" htmlFor={`analyzer-${side}-goalie-adjustment`}>
            <span>{isCustom ? 'Adjustment' : 'Game adjustment'}</span>
            <input
              aria-invalid={Boolean(errorMessage)}
              id={`analyzer-${side}-goalie-adjustment`}
              inputMode="decimal"
              max="5"
              min="-5"
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

          {isProvider && values.goalieOverrideEnabled ? (
            <button
              className="goalie-reset-default-button"
              type="button"
              onClick={() => onChange(side, 'resetToTeamDefault', true)}
            >
              Reset to team default
            </button>
          ) : null}

          {errorMessage ? (
            <p className="field-error" role="alert">{errorMessage}</p>
          ) : null}

          {isProvider ? (
            <GoalieStatsSummary
              errorMessage={goalieDataError}
              goalie={selectedGoalie}
              onRetry={onRetry}
              stats={selectedGoalieStats}
              status={status}
            />
          ) : null}
        </>
      )}
    </article>
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
