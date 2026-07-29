import {
  ADD_MARKET_ODDS_STATUS,
  MODEL_STATUSES,
  PROBABILITY_EDGE_HELP_TEXT,
  parseMarketOdds,
} from '../utils/calculateGame.js'
import {
  formatKellyCurrency,
  formatKellyEdge,
  formatKellyPercent,
  formatKellyProbability,
  getKellyRecommendationReasonMessage,
} from '../utils/kellyStaking.js'

const formatPercent = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--'

const formatProbabilityEdge = (value) =>
  Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`
    : '--'

const formatExpectedValue = (value) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : '--'

const formatSignedNumber = (value) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : '--'

const formatOdds = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : '--'

const formatRating = (value) =>
  Number.isFinite(value) ? value.toFixed(1) : '--'

const modelStatusClass = (modelStatus = '') =>
  String(modelStatus ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const isInvalidMarketOdds = (value) =>
  value !== '' && value !== null && value !== undefined && !parseMarketOdds(value)

const getMarketBySide = (result, side) => {
  const prefix = side === 'home' ? 'home' : 'away'

  return {
    expectedValue: result[`${prefix}ExpectedValue`],
    fairOdds: result[`${prefix}FairOdds`],
    impliedProbability: result[`${prefix}ImpliedProbability`],
    modelStatus: result[`${prefix}ModelStatus`],
    modelProbability: result[`${prefix}WinProbability`],
    oddsDifference: result[`${prefix}OddsDifference`],
    probabilityEdge: result[`${prefix}Edge`],
    recommendation: result[`${prefix}Recommendation`],
  }
}

const getStatusWarning = (modelStatus) => {
  if (modelStatus === MODEL_STATUSES.BELOW_THRESHOLD) {
    return 'Expected value is positive, but below the current model threshold. You can still save this bet.'
  }

  if (modelStatus === MODEL_STATUSES.NO_VALUE) {
    return 'The model estimates negative expected value for this bet. You can still save it if this is intentional.'
  }

  return ''
}

function ResultCard({
  awayTeam,
  homeTeam,
  inputs,
  isBetReviewOpen = false,
  onCloseReview,
  onMarketOddsChange,
  onOpenBetTracker,
  onOpenBettingSettings,
  onOpenReview,
  onSaveBet,
  onSelectedSideChange,
  onStakeChange,
  onUseRecommendedStake,
  result,
  bankrollError = '',
  bankrollStatus = 'idle',
  bettingSettingsError = '',
  bettingSettingsStatus = 'idle',
  reviewDisabled = true,
  reviewDisabledReason,
  saveDisabled,
  saveDisabledReason,
  saveMessage,
  saveStatus = 'idle',
  selectedSide,
  stake,
  stakeRecommendation,
  validSaveSides = [],
}) {
  const marketSides = [
    {
      label: 'Away',
      market: getMarketBySide(result, 'away'),
      marketOddsValue: inputs.away.marketOdds,
      side: 'away',
      team: awayTeam,
      values: inputs.away,
    },
    {
      label: 'Home',
      market: getMarketBySide(result, 'home'),
      marketOddsValue: inputs.home.marketOdds,
      side: 'home',
      team: homeTeam,
      values: inputs.home,
    },
  ]
  const [awayMarketSide, homeMarketSide] = marketSides
  const modelLeanSide =
    homeMarketSide.market.modelProbability >=
    awayMarketSide.market.modelProbability
      ? homeMarketSide
      : awayMarketSide
  const validMarketSides = marketSides.filter(({ marketOddsValue }) =>
    Boolean(parseMarketOdds(marketOddsValue)),
  )
  const highestExpectedValueSide = validMarketSides.length
    ? [...validMarketSides].sort(
        (sideA, sideB) =>
          (sideB.market.expectedValue ?? -Infinity) -
          (sideA.market.expectedValue ?? -Infinity),
      )[0]
    : null
  const selectedMarketSide =
    marketSides.find(({ side }) => side === selectedSide) ?? homeMarketSide

  return (
    <article className="result-card">
      <div className="result-header">
        <div>
          <p className="eyebrow">Projection and market comparison</p>
          <h2>Betting Decision</h2>
        </div>
      </div>

      <div className="decision-strip">
        <DecisionItem label="Model lean" value={modelLeanSide.team.name} />
        <DecisionItem
          label="Highest EV"
          tone={
            highestExpectedValueSide
              ? modelStatusClass(highestExpectedValueSide.market.modelStatus)
              : 'muted'
          }
          value={
            highestExpectedValueSide
              ? `${highestExpectedValueSide.team.name} ${formatExpectedValue(
                  highestExpectedValueSide.market.expectedValue,
                )}`
              : 'Add market odds'
          }
        />
      </div>

      <div className="market-comparison-board">
        {marketSides.map((marketSide) => (
          <MarketComparisonSide
            key={marketSide.side}
            {...marketSide}
            onMarketOddsChange={onMarketOddsChange}
          />
        ))}
      </div>

      <StakeRecommendationCard
        bankrollError={bankrollError}
        bankrollStatus={bankrollStatus}
        bettingSettingsError={bettingSettingsError}
        bettingSettingsStatus={bettingSettingsStatus}
        marketSides={marketSides}
        saveStatus={saveStatus}
        selectedMarketSide={selectedMarketSide}
        selectedSide={selectedSide}
        stakeRecommendation={stakeRecommendation}
        onOpenBetTracker={onOpenBetTracker}
        onOpenBettingSettings={onOpenBettingSettings}
        onSelectedSideChange={onSelectedSideChange}
        onUseRecommendedStake={onUseRecommendedStake}
      />

      <ModelDetails
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        result={result}
      />

      <div className="review-bet-shell">
        <button
          className="save-analysis-button review-save-toggle"
          disabled={reviewDisabled}
          title={reviewDisabled ? reviewDisabledReason : undefined}
          type="button"
          onClick={onOpenReview}
        >
          Review & Save Bet
        </button>
        {saveMessage && !isBetReviewOpen ? (
          <span className={`save-analysis-status ${saveStatus}`} role="status">
            {saveMessage}
          </span>
        ) : reviewDisabled && reviewDisabledReason ? (
          <span className="save-analysis-status" role="status">
            {reviewDisabledReason}
          </span>
        ) : null}
      </div>

      {isBetReviewOpen ? (
        <BetReviewPanel
          saveDisabled={saveDisabled}
          saveDisabledReason={saveDisabledReason}
          saveMessage={saveMessage}
          saveStatus={saveStatus}
          selectedMarketSide={selectedMarketSide}
          selectedSide={selectedSide}
          stake={stake}
          validSaveSides={validSaveSides}
          onClose={onCloseReview}
          onSaveBet={onSaveBet}
          onSelectedSideChange={onSelectedSideChange}
          onStakeChange={onStakeChange}
        />
      ) : null}
    </article>
  )
}

function StakeRecommendationCard({
  bankrollError,
  bankrollStatus,
  bettingSettingsError,
  bettingSettingsStatus,
  marketSides,
  onOpenBetTracker,
  onOpenBettingSettings,
  onSelectedSideChange,
  onUseRecommendedStake,
  saveStatus,
  selectedMarketSide,
  selectedSide,
  stakeRecommendation = {},
}) {
  const hasEligibleAmount =
    stakeRecommendation.eligible &&
    Number(stakeRecommendation.recommendedStakeAmount) > 0
  const hasStakePercent = Boolean(stakeRecommendation.hasStakePercent)
  const reasonMessage = getKellyRecommendationReasonMessage(
    stakeRecommendation,
  )
  const basisLabel =
    stakeRecommendation.bankrollBasisLabel ?? 'Available bankroll'
  const basisText = basisLabel.toLowerCase()
  const recommendedStakePercent = hasStakePercent
    ? formatKellyPercent(stakeRecommendation.cappedStakePercent)
    : '--'
  const primaryValue = hasEligibleAmount
    ? formatKellyCurrency(
        stakeRecommendation.recommendedStakeAmount,
        stakeRecommendation.currency,
      )
    : bankrollStatus === 'loading'
      ? 'Loading bankroll'
      : stakeRecommendation.reason === 'BANKROLL_NOT_INITIALIZED'
        ? 'Bankroll required'
        : 'No stake'
  const primaryDetail = hasStakePercent
    ? `${recommendedStakePercent} of ${basisText}`
    : 'Kelly stake unavailable'
  const selectedTeamLabel = selectedMarketSide?.team?.name ?? 'Selected side'
  const statusNotes = [
    bettingSettingsStatus === 'loading' ? 'Loading betting settings.' : '',
    bankrollStatus === 'loading' ? 'Loading bankroll data.' : '',
    bettingSettingsStatus === 'error'
      ? `Betting settings unavailable: ${bettingSettingsError}`
      : '',
    bankrollStatus === 'error'
      ? `Bankroll unavailable: ${bankrollError}`
      : '',
  ].filter(Boolean)
  const showBankrollSetup =
    stakeRecommendation.reason === 'BANKROLL_NOT_INITIALIZED'
  const details = [
    {
      label: 'Model Probability',
      value: formatKellyProbability(stakeRecommendation.modelProbability),
    },
    {
      label: 'Market Implied Probability',
      value: formatKellyProbability(stakeRecommendation.impliedProbability),
    },
    {
      label: 'Edge',
      tone:
        Number(stakeRecommendation.edgeDecimal) > 0 ? 'positive' : 'negative',
      value: formatKellyEdge(stakeRecommendation.edgeDecimal),
    },
    {
      label: 'Full Kelly',
      value: formatKellyPercent(stakeRecommendation.fullKellyPercent),
    },
    {
      label: 'Kelly Mode',
      value: stakeRecommendation.kellyModeLabel ?? 'Quarter Kelly',
    },
    {
      label: 'Fractional Kelly',
      value: formatKellyPercent(stakeRecommendation.fractionalKellyPercent),
    },
    {
      label: 'Maximum Stake',
      value: formatKellyPercent(stakeRecommendation.maximumStakePercent),
    },
    {
      label: 'Cap Applied',
      tone: stakeRecommendation.capApplied ? 'warning' : '',
      value: stakeRecommendation.capApplied ? 'Yes' : 'No',
    },
    {
      label: 'Bankroll Basis',
      value: basisLabel,
    },
    {
      label: basisLabel,
      value: stakeRecommendation.bankrollInitialized
        ? formatKellyCurrency(
            stakeRecommendation.bankrollAmount,
            stakeRecommendation.currency,
          )
        : 'Not initialized',
    },
    {
      label: 'Recommended Stake %',
      value: recommendedStakePercent,
    },
    {
      label: 'Recommended Amount',
      value: hasEligibleAmount
        ? formatKellyCurrency(
            stakeRecommendation.recommendedStakeAmount,
            stakeRecommendation.currency,
          )
        : '--',
    },
  ]

  return (
    <section
      className={`stake-recommendation-panel ${
        hasEligibleAmount ? 'eligible' : 'ineligible'
      }`}
      aria-label="Stake Recommendation"
    >
      <div className="stake-recommendation-header">
        <div>
          <p className="eyebrow">Stake Recommendation</p>
          <h3>{selectedTeamLabel}</h3>
        </div>
        <span className="recommendation-badge">
          {hasEligibleAmount ? 'Stake available' : 'No recommendation'}
        </span>
      </div>

      {marketSides.length > 1 ? (
        <div
          className="stake-side-toggle"
          role="radiogroup"
          aria-label="Stake recommendation side"
        >
          {marketSides.map(({ side, team }) => (
            <button
              key={side}
              aria-checked={selectedSide === side}
              className={selectedSide === side ? 'active' : ''}
              role="radio"
              type="button"
              onClick={() => onSelectedSideChange?.(side)}
            >
              {team.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="stake-recommendation-primary">
        <span>Recommended Stake</span>
        <strong>{primaryValue}</strong>
        <small>{primaryDetail}</small>
      </div>

      {reasonMessage ? (
        <p className="stake-recommendation-message" role="status">
          {reasonMessage}
        </p>
      ) : stakeRecommendation.capApplied ? (
        <p className="stake-recommendation-message warning" role="status">
          Stake cap applied.
        </p>
      ) : null}

      {statusNotes.length > 0 ? (
        <div className="stake-recommendation-notes" role="status">
          {statusNotes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}

      <div className="stake-recommendation-grid">
        {details.map((detail) => (
          <div key={detail.label} className={detail.tone ?? ''}>
            <span>{detail.label}</span>
            <strong>{detail.value}</strong>
          </div>
        ))}
      </div>

      <div className="stake-recommendation-actions">
        <button
          className="save-analysis-button"
          type="button"
          disabled={!hasEligibleAmount || saveStatus === 'saving'}
          onClick={onUseRecommendedStake}
        >
          Use Recommended Stake
        </button>
        {showBankrollSetup ? (
          <button
            className="secondary-save-button"
            type="button"
            onClick={onOpenBetTracker}
          >
            Set Up Bankroll
          </button>
        ) : null}
        <button
          className="secondary-save-button"
          type="button"
          onClick={onOpenBettingSettings}
        >
          Edit Betting Settings
        </button>
      </div>
    </section>
  )
}

function DecisionItem({ label, tone, value }) {
  return (
    <div className={`decision-item ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MarketComparisonSide({
  label,
  market,
  marketOddsValue,
  onMarketOddsChange,
  side,
  team,
}) {
  const inputId = `projection-${side}-marketOdds`
  const validationId = `${inputId}-validation`
  const parsedMarketOdds = parseMarketOdds(marketOddsValue)
  const hasValidMarketOdds = Boolean(parsedMarketOdds)
  const hasInvalidOdds = isInvalidMarketOdds(marketOddsValue)
  const modelStatus = hasValidMarketOdds
    ? market.modelStatus ?? 'Model unavailable'
    : ADD_MARKET_ODDS_STATUS
  const statusTone = hasValidMarketOdds
    ? modelStatusClass(modelStatus)
    : 'add-market-odds'

  return (
    <section
      className={`market-side ${statusTone}`}
      aria-label={`${team.name} market comparison`}
    >
      <div className="market-side-header">
        <div>
          <span>{label}</span>
          <strong>{team.name}</strong>
        </div>
        <span className={`recommendation-badge ${statusTone}`}>
          {modelStatus}
        </span>
      </div>

      <div className="market-core">
        <MarketMetric
          label="Model probability"
          value={formatPercent(market.modelProbability)}
        />
        <MarketMetric label="Fair odds" value={formatOdds(market.fairOdds)} />
        <label className="market-odds-field" htmlFor={inputId}>
          <span>Market odds</span>
          <input
            id={inputId}
            aria-describedby={hasInvalidOdds ? validationId : undefined}
            aria-invalid={hasInvalidOdds}
            type="number"
            min="1.01"
            step="0.01"
            inputMode="decimal"
            placeholder="Add odds"
            value={marketOddsValue}
            onChange={(event) => onMarketOddsChange(side, event.target.value)}
          />
          {hasInvalidOdds ? (
            <small id={validationId} role="alert">
              Market odds must be greater than 1.
            </small>
          ) : null}
        </label>
      </div>

      {hasValidMarketOdds ? (
        <>
          <div className="market-value-grid">
            <MarketMetric
              emphasis
              label="Expected value"
              tone={
                Number.isFinite(market.expectedValue) &&
                market.expectedValue >= 0
                  ? 'positive'
                  : 'negative'
              }
              value={formatExpectedValue(market.expectedValue)}
            />
            <MarketMetric
              emphasis
              label="Model status"
              tone={statusTone}
              value={modelStatus}
            />
            <MarketMetric
              label="Probability edge"
              title={PROBABILITY_EDGE_HELP_TEXT}
              tone={
                Number.isFinite(market.probabilityEdge) &&
                market.probabilityEdge >= 0
                  ? 'positive'
                  : 'negative'
              }
              value={formatProbabilityEdge(market.probabilityEdge)}
            />
          </div>

          <details className="market-details">
            <summary>Details</summary>
            <div>
              <span>
                Implied probability{' '}
                <strong>{formatPercent(market.impliedProbability)}</strong>
              </span>
              <span>
                Odds difference{' '}
                <strong>{formatSignedNumber(market.oddsDifference)}</strong>
              </span>
            </div>
          </details>
        </>
      ) : (
        <p className="market-empty-state">
          Enter market odds to calculate value.
        </p>
      )}
    </section>
  )
}

function MarketMetric({ emphasis = false, label, title, tone, value }) {
  return (
    <div
      className={`market-metric ${tone ?? ''} ${emphasis ? 'emphasis' : ''}`}
      title={title}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ModelDetails({ awayTeam, homeTeam, result }) {
  let differenceLabel = 'Even'

  if (result.ratingDifference > 0) {
    differenceLabel = `+${result.ratingDifference.toFixed(1)} ${homeTeam.name}`
  } else if (result.ratingDifference < 0) {
    differenceLabel = `+${Math.abs(result.ratingDifference).toFixed(1)} ${
      awayTeam.name
    }`
  }

  return (
    <details className="model-details">
      <summary>Model rating breakdown</summary>
      <div className="rating-breakdown-row">
        <span>
          {awayTeam.abbreviation}{' '}
          <strong>{formatRating(result.awayFinalRating)}</strong>
        </span>
        <span>
          {homeTeam.abbreviation}{' '}
          <strong>{formatRating(result.homeFinalRating)}</strong>
        </span>
        <span>
          Difference <strong>{differenceLabel}</strong>
        </span>
      </div>
    </details>
  )
}

function BetReviewPanel({
  onClose,
  onSaveBet,
  onSelectedSideChange,
  onStakeChange,
  saveDisabled,
  saveDisabledReason,
  saveMessage,
  saveStatus,
  selectedMarketSide,
  selectedSide,
  stake,
  validSaveSides,
}) {
  const selectedMarketOdds = parseMarketOdds(selectedMarketSide.marketOddsValue)
  const selectedModelStatus =
    selectedMarketSide.market.modelStatus ??
    selectedMarketSide.market.recommendation ??
    'Model unavailable'
  const statusTone = modelStatusClass(selectedModelStatus)
  const warning = getStatusWarning(selectedModelStatus)
  const showSidePicker = validSaveSides.length > 1

  return (
    <section className="save-bet-panel" aria-label="Review and save bet">
      <div className="save-bet-header">
        <div>
          <p className="eyebrow">Review & Save</p>
          <h3>{selectedMarketSide.team.name}</h3>
        </div>
        <span className={`recommendation-badge ${statusTone}`}>
          {selectedModelStatus}
        </span>
      </div>

      {showSidePicker ? (
        <div
          className="save-side-toggle"
          role="radiogroup"
          aria-label="Bet side"
        >
          {validSaveSides.map(({ market, side, team }) => (
            <SideOption
              key={side}
              checked={selectedSide === side}
              label={team.name}
              side={side}
              status={market.modelStatus}
              onChange={onSelectedSideChange}
            />
          ))}
        </div>
      ) : null}

      <div className="save-review-grid">
        <ReviewMetric label="Selected team" value={selectedMarketSide.team.name} />
        <ReviewMetric label="Model status" value={selectedModelStatus} />
        <ReviewMetric
          label="Market odds"
          value={formatOdds(selectedMarketOdds)}
        />
        <ReviewMetric
          label="Fair odds"
          value={formatOdds(selectedMarketSide.market.fairOdds)}
        />
        <ReviewMetric
          label="Model probability"
          value={formatPercent(selectedMarketSide.market.modelProbability)}
        />
        <ReviewMetric
          label="Probability edge"
          title={PROBABILITY_EDGE_HELP_TEXT}
          value={formatProbabilityEdge(selectedMarketSide.market.probabilityEdge)}
        />
        <ReviewMetric
          label="Expected value"
          value={formatExpectedValue(selectedMarketSide.market.expectedValue)}
        />
      </div>

      {warning ? (
        <p className={`save-bet-warning ${statusTone}`} role="alert">
          {warning}
        </p>
      ) : null}

      <label className="field stake-field" htmlFor="save-bet-stake">
        <span>Stake</span>
        <input
          id="save-bet-stake"
          type="number"
          min="0.01"
          step="0.25"
          value={stake}
          inputMode="decimal"
          onChange={(event) => onStakeChange(event.target.value)}
        />
      </label>

      <AdjustmentReview values={selectedMarketSide.values} />

      <div className="result-actions">
        <button
          className="save-analysis-button"
          type="button"
          disabled={saveDisabled}
          onClick={onSaveBet}
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Save Bet'}
        </button>
        <button
          className="secondary-save-button"
          type="button"
          disabled={saveStatus === 'saving'}
          onClick={onClose}
        >
          Cancel
        </button>
        {saveMessage ? (
          <span className={`save-analysis-status ${saveStatus}`} role="status">
            {saveMessage}
          </span>
        ) : saveDisabledReason ? (
          <span className="save-analysis-status" role="status">
            {saveDisabledReason}
          </span>
        ) : null}
      </div>
    </section>
  )
}

function SideOption({ checked, label, onChange, side, status }) {
  return (
    <label>
      <input
        type="radio"
        name="save-bet-side"
        checked={checked}
        value={side}
        onChange={() => onChange(side)}
      />
      <span>
        <strong>{label}</strong>
        <small className={modelStatusClass(status)}>
          {status ?? 'Model unavailable'}
        </small>
      </span>
    </label>
  )
}

function ReviewMetric({ label, title, value }) {
  return (
    <div title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AdjustmentReview({ values }) {
  const storedInjuryImpact = Number(values.storedInjuryImpact ?? 0)
  const injuryAdjustment = Number(values.injuries ?? 0)
  const totalInjuryAdjustment = storedInjuryImpact + injuryAdjustment

  return (
    <div className="adjustment-review">
      <span>Adjustments</span>
      <div>
        <small>
          Goalie <strong>{Number(values.goalieAdjustment ?? 0).toFixed(1)}</strong>
        </small>
        <small>
          Injuries <strong>{totalInjuryAdjustment.toFixed(1)}</strong>
        </small>
        <small>
          Rest/Fatigue{' '}
          <strong>{Number(values.restFatigue ?? 0).toFixed(1)}</strong>
        </small>
        <small>
          Motivation <strong>{Number(values.motivation ?? 0).toFixed(1)}</strong>
        </small>
        <small>
          X-factor{' '}
          <strong>{Number(values.manualAdjustment ?? 0).toFixed(1)}</strong>
        </small>
      </div>
    </div>
  )
}

export default ResultCard
