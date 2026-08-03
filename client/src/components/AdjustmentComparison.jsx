import { Info } from 'lucide-react'

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
  finalRatings,
  goalieErrors,
  goalieStatsByPlayerId = {},
  goalieStatuses,
  goalies,
  homeTeam,
  inputs,
  isGameContextManaged = false,
  onChange,
  onRetryGoalies,
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

        <AdjustmentRow label="Starting goalie">
          <GoalieSelectorCell
            errorMessage={goalieErrors.away}
            goalies={goalies.away}
            goalieStatsByPlayerId={goalieStatsByPlayerId}
            side="away"
            sideLabel="Away"
            status={goalieStatuses.away}
            teamName={awayTeam.name}
            value={inputs.away.selectedGoalieId}
            onChange={onChange}
            onRetry={onRetryGoalies.away}
          />
          <GoalieSelectorCell
            errorMessage={goalieErrors.home}
            goalies={goalies.home}
            goalieStatsByPlayerId={goalieStatsByPlayerId}
            side="home"
            sideLabel="Home"
            status={goalieStatuses.home}
            teamName={homeTeam.name}
            value={inputs.home.selectedGoalieId}
            onChange={onChange}
            onRetry={onRetryGoalies.home}
          />
        </AdjustmentRow>

        <AdjustmentRow label="Goalie adjustment">
          <NumberCell
            field="goalieAdjustment"
            label="Goalie adjustment"
            max="20"
            min="-20"
            side="away"
            sideLabel="Away"
            step="0.5"
            teamName={awayTeam.name}
            value={inputs.away.goalieAdjustment}
            onChange={onChange}
          />
          <NumberCell
            field="goalieAdjustment"
            label="Goalie adjustment"
            max="20"
            min="-20"
            side="home"
            sideLabel="Home"
            step="0.5"
            teamName={homeTeam.name}
            value={inputs.home.goalieAdjustment}
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

function GoalieSelectorCell({
  errorMessage,
  goalieStatsByPlayerId,
  goalies,
  onChange,
  onRetry,
  side,
  sideLabel,
  status,
  teamName,
  value,
}) {
  const selectedGoalie = goalies.find(
    (goalie) => String(goalie.id) === String(value),
  )
  const selectedGoalieStats = selectedGoalie
    ? goalieStatsByPlayerId[String(selectedGoalie.id)]
    : null

  return (
    <div
      className="adjustment-cell goalie-selector-cell"
      data-side-label={sideLabel}
      role="cell"
    >
      <select
        aria-label={`${teamName} starting goalie`}
        data-testid={`analyzer-${side}-selectedGoalieId`}
        value={value ?? ''}
        onChange={(event) =>
          onChange(side, 'selectedGoalieId', event.target.value)
        }
      >
        <option value="">Unknown / Not confirmed</option>
        {goalies.map((goalie) => (
          <option key={goalie.id} value={String(goalie.id)}>
            {getGoalieDisplayName(goalie)}
          </option>
        ))}
      </select>
      <GoalieStatsSummary
        errorMessage={errorMessage}
        goalie={selectedGoalie}
        onRetry={onRetry}
        stats={selectedGoalieStats}
        status={status}
      />
    </div>
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
