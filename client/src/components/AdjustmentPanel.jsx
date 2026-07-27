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

const getGoalieOptionLabel = (goalie, stats) => {
  const currentSeason = getGoalieCurrentSeason(stats)
  const name = getGoalieDisplayName(goalie)

  if (currentSeason?.dataStatus === 'available') {
    return `${name} - SV% ${formatSavePercentage(
      currentSeason.savePercentage,
    )} / GP ${formatInteger(currentSeason.gamesPlayed)} / GS ${formatInteger(
      currentSeason.gamesStarted,
    )}`
  }

  if (currentSeason?.dataStatus === 'no_nhl_games') {
    return `${name} - No NHL games`
  }

  return `${name} - stats unavailable`
}

function AdjustmentPanel({
  finalRating,
  goalies = [],
  goalieError = '',
  goalieStatsByPlayerId = {},
  goalieStatus = 'idle',
  onChange,
  onRetryGoalies,
  showHomeAdvantage = false,
  side,
  teamName,
  title,
  values,
}) {
  const selectedGoalieId = values.selectedGoalieId ?? ''
  const selectedGoalie = goalies.find(
    (goalie) => String(goalie.id) === String(selectedGoalieId),
  )
  const selectedGoalieStats = selectedGoalie
    ? goalieStatsByPlayerId[String(selectedGoalie.id)]
    : null
  const storedInjuryImpact = toNumber(values.storedInjuryImpact)
  const gameInjuryAdjustment = toNumber(values.injuries)
  const totalInjuryAdjustment = storedInjuryImpact + gameInjuryAdjustment

  return (
    <section className="adjustment-panel">
      <div className="panel-header">
        <p className="eyebrow">{title}</p>
        <h2>{teamName}</h2>
      </div>

      <div className="adjustment-section">
        <div className="adjustment-section-header">
          <h3>Power Rating</h3>
          <span>automatic</span>
        </div>
        <div className="read-only-grid">
          <ReadOnlyMetric
            label="Base power rating"
            value={formatRating(values.baseRating)}
          />
          <ReadOnlyMetric
            label="Effective rating"
            value={formatRating(finalRating)}
          />
        </div>
      </div>

      {showHomeAdvantage ? (
        <div className="adjustment-section">
          <div className="adjustment-section-header">
            <h3>Effective Home Advantage</h3>
            <span>game override</span>
          </div>
          <NumberField
            helper="Base Home Advantage plus team Home Adjustment; applies only to this home-team analysis."
            id={`analyzer-${side}-homeAdvantage`}
            label="Effective home advantage"
            max="10"
            min="-10"
            step="0.5"
            value={values.homeAdvantage}
            onChange={(value) => onChange('homeAdvantage', value)}
          />
        </div>
      ) : null}

      <div className="adjustment-section">
        <div className="adjustment-section-header">
          <h3>Starting Goalie</h3>
          <span>manual</span>
        </div>
        <label className="field">
          <span>Starting goalie</span>
          <select
            data-testid={`analyzer-${side}-selectedGoalieId`}
            value={selectedGoalieId}
            onChange={(event) =>
              onChange('selectedGoalieId', event.target.value)
            }
          >
            <option value="">Unknown / Not confirmed</option>
            {goalies.map((goalie) => (
              <option key={goalie.id} value={String(goalie.id)}>
                {getGoalieOptionLabel(
                  goalie,
                  goalieStatsByPlayerId[String(goalie.id)],
                )}
              </option>
            ))}
          </select>
        </label>
        <GoalieStatsSummary
          errorMessage={goalieError}
          goalie={selectedGoalie}
          onRetry={onRetryGoalies}
          stats={selectedGoalieStats}
          status={goalieStatus}
        />
        <NumberField
          id={`analyzer-${side}-goalieAdjustment`}
          label="Goalie adjustment"
          max="20"
          min="-20"
          step="0.5"
          value={values.goalieAdjustment}
          onChange={(value) => onChange('goalieAdjustment', value)}
        />
      </div>

      <div className="adjustment-section">
        <div className="adjustment-section-header">
          <h3>Injuries</h3>
          <span>stored + manual</span>
        </div>
        <div className="injury-adjustment-summary">
          <ReadOnlyMetric
            label="Stored injury impact"
            value={storedInjuryImpact.toFixed(1)}
          />
          <ReadOnlyMetric
            label="Game-specific injury adjustment"
            value={gameInjuryAdjustment.toFixed(1)}
          />
          <ReadOnlyMetric
            label="Total injury adjustment"
            value={totalInjuryAdjustment.toFixed(1)}
          />
        </div>
        <NumberField
          id={`analyzer-${side}-injuries`}
          label="Game-specific injury adjustment"
          max="20"
          min="-20"
          step="0.5"
          value={values.injuries}
          onChange={(value) => onChange('injuries', value)}
        />
      </div>

      <div className="adjustment-section compact-adjustments">
        <NumberField
          helper="Back-to-backs, 3-in-4, 4-in-6, rest edge, schedule congestion, travel and road trips."
          id={`analyzer-${side}-restFatigue`}
          label="Rest & fatigue adjustment"
          max="3"
          min="-3"
          step="0.25"
          value={values.restFatigue}
          onChange={(value) => onChange('restFatigue', value)}
        />
        <NumberField
          helper="Use conservatively for importance, playoff race, rematch context, coaching changes or similar motivation."
          id={`analyzer-${side}-motivation`}
          label="Motivation adjustment"
          max="2"
          min="-2"
          step="0.25"
          value={values.motivation}
          onChange={(value) => onChange('motivation', value)}
        />
        <NumberField
          helper="Use only for relevant factors not already included in the model."
          id={`analyzer-${side}-manualAdjustment`}
          label="Manual adjustment / X-factor"
          max="2"
          min="-2"
          step="0.25"
          value={values.manualAdjustment}
          onChange={(value) => onChange('manualAdjustment', value)}
        />
      </div>
    </section>
  )
}

function NumberField({
  helper,
  id,
  label,
  max,
  min,
  onChange,
  step,
  value,
}) {
  return (
    <label className="field numeric-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <small>{helper}</small> : null}
    </label>
  )
}

function ReadOnlyMetric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
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
  if (status === 'loading' || status === 'idle') {
    return <div className="goalie-picker-state">Loading team goalies</div>
  }

  if (status === 'error') {
    return (
      <div className="goalie-picker-state error" role="alert">
        <span>{errorMessage || 'Goalie data unavailable.'}</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (!goalie) {
    return (
      <div className="goalie-selected-stats muted">
        Unknown / Not confirmed
      </div>
    )
  }

  const currentSeason = getGoalieCurrentSeason(stats)

  if (currentSeason?.dataStatus !== 'available') {
    return (
      <div className="goalie-selected-stats muted">
        {currentSeason?.dataStatus === 'no_nhl_games'
          ? 'No NHL games this season'
          : 'Current-season goalie stats unavailable'}
      </div>
    )
  }

  return (
    <div
      className="goalie-selected-stats"
      aria-label={`${getGoalieDisplayName(goalie)} selected goalie statistics`}
    >
      <GoalieStat
        label="SV%"
        value={formatSavePercentage(currentSeason.savePercentage)}
      />
      <GoalieStat label="GP" value={formatInteger(currentSeason.gamesPlayed)} />
      <GoalieStat label="GS" value={formatInteger(currentSeason.gamesStarted)} />
    </div>
  )
}

function GoalieStat({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default AdjustmentPanel
