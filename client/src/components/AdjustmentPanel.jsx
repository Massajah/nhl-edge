const baseFields = [
  {
    key: 'baseRating',
    label: 'Base Power Rating',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'marketOdds',
    label: 'Market Decimal Odds',
    min: 1.01,
    max: 100,
    step: 0.01,
  },
  {
    key: 'injuries',
    label: 'Game-specific Injury Adj.',
    min: -20,
    max: 20,
    step: 0.5,
  },
  {
    key: 'goalieAdjustment',
    label: 'Goalie Adjustment',
    min: -20,
    max: 20,
    step: 0.5,
  },
  {
    key: 'recentForm',
    label: 'Recent Form',
    min: -20,
    max: 20,
    step: 0.5,
  },
  {
    key: 'motivation',
    label: 'Motivation',
    min: -20,
    max: 20,
    step: 0.5,
  },
]

const homeAdvantageField = {
  key: 'homeAdvantage',
  label: 'Home Advantage',
  min: -10,
  max: 10,
  step: 0.5,
}

function AdjustmentPanel({
  title,
  teamName,
  side,
  values,
  showHomeAdvantage = false,
  onChange,
}) {
  const fields = showHomeAdvantage
    ? [baseFields[0], baseFields[1], homeAdvantageField, ...baseFields.slice(2)]
    : baseFields

  return (
    <section className="adjustment-panel">
      <div className="panel-header">
        <p className="eyebrow">{title}</p>
        <h2>{teamName}</h2>
      </div>

      <div className="injury-adjustment-summary">
        <div>
          <span>Stored injury impact</span>
          <strong>{Number(values.storedInjuryImpact ?? 0).toFixed(1)}</strong>
        </div>
        <div>
          <span>Game-specific injury adjustment</span>
          <strong>{Number(values.injuries ?? 0).toFixed(1)}</strong>
        </div>
        <div>
          <span>Total injury adjustment</span>
          <strong>
            {(
              Number(values.storedInjuryImpact ?? 0) +
              Number(values.injuries ?? 0)
            ).toFixed(1)}
          </strong>
        </div>
      </div>

      <div className="adjustment-list">
        {fields.map((field) => (
          <label className="field numeric-field" key={field.key}>
            <span>{field.label}</span>
            <input
              data-testid={side ? `analyzer-${side}-${field.key}` : undefined}
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={values[field.key]}
              inputMode="decimal"
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  )
}

export default AdjustmentPanel
