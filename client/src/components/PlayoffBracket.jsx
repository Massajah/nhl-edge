import { getTeamMetadata } from '../data/teamMetadata.js'
import {
  getSeriesAccessibilityLabel,
  getSeriesSummary,
} from '../utils/playoffs.js'

function PlayoffBracket({
  errorMessage = '',
  onRetry,
  result,
  status = 'loading',
}) {
  if (status === 'loading' || status === 'idle') {
    return <PlayoffLoadingState />
  }

  if (status === 'error') {
    return (
      <PlayoffMessage
        actionLabel="Try again"
        message={errorMessage || 'Unable to load NHL playoff data.'}
        onAction={onRetry}
        title="Playoffs unavailable"
        tone="error"
      />
    )
  }

  if (result?.status === 'provider_error') {
    return (
      <PlayoffMessage
        actionLabel="Try again"
        message={
          result.error?.message ||
          'NHL playoff data is temporarily unavailable.'
        }
        onAction={onRetry}
        title="Playoff provider unavailable"
        tone="error"
      />
    )
  }

  if (result?.status === 'projected_unavailable') {
    return (
      <PlayoffMessage
        message={
          result.error?.message ||
          'Projected matchups are unavailable until current standings are available.'
        }
        title="Projected matchups unavailable"
      />
    )
  }

  if (result?.status === 'unavailable') {
    return (
      <PlayoffMessage
        message="Playoff bracket is not available for this season."
        title="Playoff bracket unavailable"
      />
    )
  }

  if (result?.status !== 'ready' || !result.conferences) {
    return (
      <PlayoffMessage
        message="Playoff bracket is not available for this season."
        title="Playoff bracket unavailable"
      />
    )
  }

  const isProjected = result.mode === 'projected'

  return (
    <div className={`playoffs-view mode-${result.mode}`}>
      <header className="playoffs-mode-header">
        <span className="playoffs-mode-pill">
          {isProjected ? 'Projected' : 'Official bracket'}
        </span>
        <div>
          <h3>
            {isProjected
              ? 'Projected Playoff Matchups'
              : `${result.season?.label || ''} Stanley Cup Playoffs`}
          </h3>
          <p>
            {isProjected
              ? 'If playoffs started today · Projected from current standings.'
              : 'Actual series and results from the official NHL playoff bracket.'}
          </p>
        </div>
      </header>

      {isProjected ? (
        <p className="playoffs-projection-note">
          Projected matchups are based on the current standings snapshot and
          are not model predictions.
        </p>
      ) : null}

      <div className="playoff-bracket-content">
        <aside
          className="playoff-seed-legend"
          aria-label="Playoff seed abbreviations"
        >
          <span className="playoff-seed-legend-title">Seeds</span>
          <span><strong>D1–D3</strong> = Division seed</span>
          <span><strong>WC1–WC2</strong> = Wild Card</span>
        </aside>

        <div className="playoff-bracket-layout">
          <div className="playoff-conferences">
            {['eastern', 'western'].map((conferenceId) => {
              const conference = result.conferences[conferenceId]

              return conference ? (
                <PlayoffConference
                  conference={conference}
                  key={conferenceId}
                />
              ) : null
            })}
          </div>

          <div className="playoff-championship-column">
            {result.champion ? (
              <ChampionSummary champion={result.champion} />
            ) : null}

            <section
              className="stanley-cup-final"
              aria-labelledby="cup-final-title"
            >
              <div className="playoff-round-heading">
                <span>Championship</span>
                <h3 id="cup-final-title">Stanley Cup Final</h3>
              </div>
              <SeriesCard series={result.stanleyCupFinal} />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayoffLoadingState() {
  return (
    <div className="standings-loading-state" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <div>
        <strong>Loading playoff bracket</strong>
        <p>Fetching the selected season’s official playoff data.</p>
      </div>
    </div>
  )
}

function PlayoffMessage({
  actionLabel = '',
  message,
  onAction,
  title,
  tone = 'neutral',
}) {
  return (
    <div
      className={`standings-message ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <strong>{title}</strong>
      <p>{message}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function PlayoffConference({ conference }) {
  return (
    <section
      className="playoff-conference"
      aria-labelledby={`${conference.id}-conference-title`}
    >
      <h3 id={`${conference.id}-conference-title`}>
        {conference.name} Conference
      </h3>
      <div className="playoff-rounds">
        {conference.rounds.map((round) => (
          <section
            className={`playoff-round round-${round.number}`}
            key={round.id}
          >
            <div className="playoff-round-heading">
              <span>Round {round.number}</span>
              <h4>{round.label}</h4>
            </div>
            <div className="playoff-series-list">
              {round.series.map((series) => (
                <SeriesCard key={series.id} series={series} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function SeriesCard({ series }) {
  const safeSeries = series || {}

  return (
    <article
      aria-label={getSeriesAccessibilityLabel(safeSeries)}
      className={`playoff-series-card status-${safeSeries.status || 'pending'}`}
    >
      <SeriesTeam team={safeSeries.higherSeedTeam} />
      <SeriesTeam team={safeSeries.lowerSeedTeam} />
      <p className="playoff-series-summary">
        {getSeriesSummary(safeSeries)}
      </p>
    </article>
  )
}

function SeriesTeam({ team }) {
  if (!team) {
    return (
      <div className="playoff-series-team is-tbd">
        <span className="playoff-team-logo" aria-hidden="true">—</span>
        <strong>TBD</strong>
        <span className="playoff-series-score">—</span>
      </div>
    )
  }

  const logo = team.logo || getTeamMetadata(team.abbreviation).logo || ''

  return (
    <div className={`playoff-series-team${team.isWinner ? ' is-winner' : ''}`}>
      <span className="playoff-team-logo" aria-hidden="true">
        {logo ? <img alt="" src={logo} /> : team.abbreviation.slice(0, 2)}
      </span>
      <span className="playoff-team-name">
        <strong>{team.abbreviation || team.name}</strong>
        <span>{team.name}</span>
      </span>
      {team.seed ? <span className="playoff-team-seed">{team.seed}</span> : null}
      {team.isWinner ? <span className="series-winner-label">Winner</span> : null}
      <strong className="playoff-series-score">{team.wins ?? '—'}</strong>
    </div>
  )
}

function ChampionSummary({ champion }) {
  const logo =
    champion.logo || getTeamMetadata(champion.abbreviation).logo || ''

  return (
    <aside className="playoff-champion-summary" aria-label="Stanley Cup champion">
      <span className="playoff-team-logo" aria-hidden="true">
        {logo ? <img alt="" src={logo} /> : champion.abbreviation.slice(0, 2)}
      </span>
      <div>
        <span>Stanley Cup Champion</span>
        <strong>{champion.name}</strong>
      </div>
    </aside>
  )
}

export {
  ChampionSummary,
  PlayoffConference,
  PlayoffLoadingState,
  PlayoffMessage,
  SeriesCard,
  SeriesTeam,
}

export default PlayoffBracket
