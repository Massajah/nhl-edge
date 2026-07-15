const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatSignedPercent = (value) =>
  `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
const formatOdds = (value) => value.toFixed(2)
const recommendationClass = (recommendation) =>
  recommendation.toLowerCase().replace(' ', '-')

function ResultCard({
  projectedWinner,
  projectedWinnerSide,
  probability,
  fairOdds,
  ratingDifference,
  homeTeam,
  awayTeam,
  homeFinalRating,
  awayFinalRating,
  homeMarket,
  awayMarket,
  onSaveAnalysis,
  saveDisabled = false,
  saveMessage,
  saveStatus = 'idle',
}) {
  const meterWidth = `${Math.max(0, Math.min(100, probability * 100))}%`
  const ratingDifferenceLabel =
    ratingDifference > 0
      ? `Home +${ratingDifference.toFixed(1)}`
      : ratingDifference < 0
        ? `Away +${Math.abs(ratingDifference).toFixed(1)}`
        : 'Even'

  return (
    <article className="result-card">
      <div className="result-header">
        <div>
          <p className="eyebrow">Projection</p>
          <h2>Main Result</h2>
        </div>
        <span className="favorite-badge">
          {projectedWinnerSide === 'home' ? 'Home' : 'Away'}
        </span>
      </div>

      <div className="winner-block">
        <small>Projected winner</small>
        <strong>{projectedWinner}</strong>
      </div>

      <div className="result-metric primary">
        <span>Win probability</span>
        <strong>{formatPercent(probability)}</strong>
      </div>
      <div className="probability-meter" aria-hidden="true">
        <span style={{ width: meterWidth }} />
      </div>

      <div className="result-metrics">
        <div className="result-metric">
          <span>Fair odds</span>
          <strong>{formatOdds(fairOdds)}</strong>
        </div>
        <div className="result-metric">
          <span>Rating diff</span>
          <strong>{ratingDifferenceLabel}</strong>
        </div>
      </div>

      <div className="rating-comparison">
        <div>
          <span>{homeTeam}</span>
          <strong>{homeFinalRating.toFixed(1)}</strong>
        </div>
        <div>
          <span>{awayTeam}</span>
          <strong>{awayFinalRating.toFixed(1)}</strong>
        </div>
      </div>

      <div className="edge-board">
        <div className="edge-board-header">
          <p className="eyebrow">Market Edge</p>
          <span>Model - implied</span>
        </div>
        <MarketEdgeRow teamName={homeTeam} market={homeMarket} />
        <MarketEdgeRow teamName={awayTeam} market={awayMarket} />
      </div>

      <div className="result-actions">
        <button
          className="save-analysis-button"
          type="button"
          disabled={saveDisabled}
          onClick={onSaveAnalysis}
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Save Analysis'}
        </button>
        {saveMessage ? (
          <span className={`save-analysis-status ${saveStatus}`} role="status">
            {saveMessage}
          </span>
        ) : null}
      </div>
    </article>
  )
}

function MarketEdgeRow({ teamName, market }) {
  return (
    <div className={`edge-row ${recommendationClass(market.recommendation)}`}>
      <div className="edge-team">
        <span>{teamName}</span>
        <strong>{formatSignedPercent(market.edge)}</strong>
      </div>
      <div className="edge-details">
        <span>Model {formatPercent(market.modelProbability)}</span>
        <span>Implied {formatPercent(market.impliedProbability)}</span>
      </div>
      <span className="recommendation-badge">{market.recommendation}</span>
    </div>
  )
}

export default ResultCard
