import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchGamesForDate,
  fetchTodaysGames,
  isUsingMockGames,
} from '../services/scheduleApi.js'
import {
  formatInjuryImpact,
  getTeamInjurySummary,
} from '../utils/injuries.js'
import { calculatePreliminaryAnalysis } from '../utils/modelAnalysis.js'
import {
  loadDashboardMarketOdds,
  saveDashboardMarketOdds,
} from '../utils/marketOdds.js'

const toDateValue = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const parseDateValue = (date) => {
  const [year, month, day] = date.split('-').map(Number)
  const parsedDate = new Date(year, month - 1, day, 12)

  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
}

const shiftDate = (date, dayCount) => {
  const nextDate = parseDateValue(date)
  nextDate.setDate(nextDate.getDate() + dayCount)

  return toDateValue(nextDate)
}

const formatScheduleDate = (date) => {
  if (!date) {
    return 'Select a date'
  }

  const scheduleDate = parseDateValue(date)

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  }).format(scheduleDate)
}

const formatStartTime = (startTimeUTC, scheduleDate) => {
  const startTime = new Date(startTimeUTC)

  if (Number.isNaN(startTime.getTime())) {
    return 'Time TBD'
  }

  const localDate = toDateValue(startTime)
  const includeLocalDate = localDate !== scheduleDate

  return new Intl.DateTimeFormat(undefined, {
    day: includeLocalDate ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    month: includeLocalDate ? 'short' : undefined,
    weekday: includeLocalDate ? 'short' : undefined,
  }).format(startTime)
}

const getStatusTone = (status = '') => {
  const normalizedStatus = status.toLowerCase()

  if (normalizedStatus.includes('live') || normalizedStatus.includes('critical')) {
    return 'live'
  }

  if (normalizedStatus.includes('final')) {
    return 'final'
  }

  if (normalizedStatus.includes('postponed')) {
    return 'postponed'
  }

  return 'scheduled'
}

const hasScore = (team = {}) => Number.isFinite(team.score)

const hasGameScore = (game) => hasScore(game.homeTeam) && hasScore(game.awayTeam)

const notStartedGameStates = new Set(['FUT', 'PRE'])

const isNotStartedGame = (game) => notStartedGameStates.has(game.gameState)

const formatOdds = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : '--'

const formatRating = (value) =>
  Number.isFinite(value) ? value.toFixed(1) : '--'

const formatPercent = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--'

const formatSignedPercent = (value) =>
  Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
    : '--'

const getValueStatusTone = (analysis) => {
  if (!analysis.hasAnyMarketOdds) {
    return 'empty'
  }

  return analysis.hasPositiveValue ? 'value' : 'none'
}

function Dashboard({
  injurySummaries,
  injurySummaryError,
  injurySummaryStatus,
  onAnalyzeGame,
  onRetryInjuries,
  onRetryPowerRatings,
  powerRatings,
  powerRatingsError,
  powerRatingsStatus,
}) {
  const [selectedDate, setSelectedDate] = useState('')
  const [schedule, setSchedule] = useState({
    date: '',
    games: [],
  })
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [marketOddsByGame, setMarketOddsByGame] = useState(() =>
    loadDashboardMarketOdds(),
  )

  const applySchedule = useCallback((nextSchedule, fallbackDate = '') => {
    const nextDate = nextSchedule.date ?? fallbackDate

    setSelectedDate(nextDate)
    setSchedule({
      date: nextDate,
      games: nextSchedule.games ?? [],
    })
    setStatus('success')
  }, [])

  const loadScheduleForDate = useCallback(
    async (date) => {
      setSelectedDate(date)
      setStatus('loading')
      setErrorMessage('')

      try {
        const nextSchedule = await fetchGamesForDate(date)
        applySchedule(nextSchedule, date)
      } catch (error) {
        setStatus('error')
        setErrorMessage(error.message)
      }
    },
    [applySchedule],
  )

  const loadTodaySchedule = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      const nextSchedule = await fetchTodaysGames()
      applySchedule(nextSchedule, toDateValue(new Date()))
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [applySchedule])

  useEffect(() => {
    let isCurrent = true

    const loadInitialSchedule = async () => {
      try {
        const todaySchedule = await fetchTodaysGames()

        if (!isCurrent) {
          return
        }

        applySchedule(todaySchedule, toDateValue(new Date()))
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    }

    loadInitialSchedule()

    return () => {
      isCurrent = false
    }
  }, [applySchedule])

  const displayDate = selectedDate || schedule.date

  const scheduleSummary = useMemo(() => {
    if (status === 'loading') {
      return 'Loading schedule'
    }

    if (status === 'error') {
      return 'Schedule unavailable'
    }

    return `${schedule.games.length} ${
      schedule.games.length === 1 ? 'game' : 'games'
    }`
  }, [schedule.games.length, status])

  const handleDateChange = (event) => {
    const nextDate = event.target.value

    if (nextDate) {
      loadScheduleForDate(nextDate)
    }
  }

  const handleShiftDate = (dayCount) => {
    loadScheduleForDate(shiftDate(displayDate || toDateValue(new Date()), dayCount))
  }

  const handleRetry = () => {
    if (displayDate) {
      loadScheduleForDate(displayDate)
      return
    }

    loadTodaySchedule()
  }

  const handleMarketOddsChange = (gameId, side, value) => {
    setMarketOddsByGame((currentOdds) => {
      const nextOdds = {
        ...currentOdds,
        [gameId]: {
          away: currentOdds[gameId]?.away ?? '',
          home: currentOdds[gameId]?.home ?? '',
          [side]: value,
        },
      }

      saveDashboardMarketOdds(nextOdds)
      return nextOdds
    })
  }

  return (
    <section className="dashboard-page" aria-label="Dashboard">
      <div className="dashboard-panel">
        <div className="section-heading dashboard-heading">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">Dashboard</p>
              {isUsingMockGames ? (
                <span className="development-data-badge">
                  Development test data
                </span>
              ) : null}
            </div>
            <h2>{formatScheduleDate(displayDate)}</h2>
          </div>
          <span>{scheduleSummary}</span>
        </div>

        <div className="schedule-toolbar" aria-label="Schedule date controls">
          <button type="button" onClick={() => handleShiftDate(-1)}>
            Previous day
          </button>

          <label className="field schedule-date-field" htmlFor="schedule-date">
            <span>Schedule date</span>
            <input
              id="schedule-date"
              type="date"
              value={displayDate}
              onChange={handleDateChange}
            />
          </label>

          <button type="button" onClick={() => handleShiftDate(1)}>
            Next day
          </button>

          <button type="button" onClick={loadTodaySchedule}>
            Today
          </button>
        </div>

        <PowerRatingsNotice
          errorMessage={powerRatingsError}
          onRetry={onRetryPowerRatings}
          status={powerRatingsStatus}
        />
        <InjurySummaryNotice
          errorMessage={injurySummaryError}
          onRetry={onRetryInjuries}
          status={injurySummaryStatus}
        />

        {status === 'loading' ? <ScheduleLoadingState /> : null}

        {status === 'error' ? (
          <div className="schedule-state error-state" role="alert">
            <strong>Schedule unavailable</strong>
            <p>{errorMessage}</p>
            <button type="button" onClick={handleRetry}>
              Try again
            </button>
          </div>
        ) : null}

        {status === 'success' && schedule.games.length === 0 ? (
          <p className="empty-state">
            No NHL games scheduled for {formatScheduleDate(displayDate)}.
          </p>
        ) : null}

        {status === 'success' && schedule.games.length > 0 ? (
          <div className="schedule-grid">
            {schedule.games.map((game) => (
              <GameCard
                game={game}
                key={game.gameId}
                marketOdds={marketOddsByGame[game.gameId]}
                onMarketOddsChange={handleMarketOddsChange}
                onAnalyzeGame={onAnalyzeGame}
                injurySummaries={injurySummaries}
                injurySummaryStatus={injurySummaryStatus}
                powerRatings={powerRatings}
                powerRatingsStatus={powerRatingsStatus}
                scheduleDate={displayDate}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ScheduleLoadingState() {
  return (
    <div className="schedule-grid" aria-label="Loading schedule">
      {[0, 1, 2].map((item) => (
        <div className="schedule-card schedule-card-loading" key={item}>
          <span />
          <strong />
          <div />
          <div />
        </div>
      ))}
    </div>
  )
}

function GameCard({
  game,
  injurySummaries,
  injurySummaryStatus,
  marketOdds = {},
  onAnalyzeGame,
  onMarketOddsChange,
  powerRatings,
  powerRatingsStatus,
  scheduleDate,
}) {
  const statusTone = getStatusTone(game.status)
  const showScore = hasGameScore(game)
  const canUsePowerRatings = powerRatingsStatus === 'success'
  const canUseInjurySummaries = injurySummaryStatus === 'success'
  const canUseModel = canUsePowerRatings && canUseInjurySummaries
  const showPreliminaryAnalysis = isNotStartedGame(game) && canUseModel
  const awayInjurySummary = getTeamInjurySummary(
    injurySummaries,
    game.awayTeam.abbreviation,
  )
  const homeInjurySummary = getTeamInjurySummary(
    injurySummaries,
    game.homeTeam.abbreviation,
  )
  const normalizedMarketOdds = useMemo(
    () => ({
      away: marketOdds.away ?? '',
      home: marketOdds.home ?? '',
    }),
    [marketOdds.away, marketOdds.home],
  )
  const preliminaryAnalysis = useMemo(() => {
    if (!showPreliminaryAnalysis) {
      return null
    }

    return calculatePreliminaryAnalysis({
      awayTeamId: game.awayTeam.abbreviation,
      homeTeamId: game.homeTeam.abbreviation,
      injurySummaries,
      marketOdds: normalizedMarketOdds,
      powerRatings,
    })
  }, [
    game.awayTeam.abbreviation,
    game.homeTeam.abbreviation,
    injurySummaries,
    normalizedMarketOdds,
    powerRatings,
    showPreliminaryAnalysis,
  ])

  return (
    <article className="schedule-card">
      <div className="game-card-top">
        <span className={`status-pill game-status ${statusTone}`}>
          {game.status}
        </span>
        <time dateTime={game.startTimeUTC}>
          {formatStartTime(game.startTimeUTC, scheduleDate)}
        </time>
      </div>

      <div className={`schedule-matchup ${showScore ? 'has-score' : ''}`}>
        <TeamLine showScore={showScore} team={game.awayTeam} />
        <div className="matchup-divider">at</div>
        <TeamLine showScore={showScore} team={game.homeTeam} />
      </div>

      {canUseInjurySummaries ? (
        <div className="game-injury-summary" aria-label="Stored injury impact">
          <span>
            Away injury impact{' '}
            <strong>{formatInjuryImpact(awayInjurySummary.totalImpact)}</strong>
          </span>
          <span>
            Home injury impact{' '}
            <strong>{formatInjuryImpact(homeInjurySummary.totalImpact)}</strong>
          </span>
        </div>
      ) : null}

      {preliminaryAnalysis ? (
        <PreliminaryAnalysis
          analysis={preliminaryAnalysis}
          awayTeam={game.awayTeam}
          homeTeam={game.homeTeam}
          marketOdds={normalizedMarketOdds}
          onMarketOddsChange={(side, value) =>
            onMarketOddsChange(game.gameId, side, value)
          }
        />
      ) : null}

      <button
        className="analyze-game-button"
        type="button"
        disabled={!canUseModel}
        onClick={() => onAnalyzeGame(game, normalizedMarketOdds)}
      >
        Analyze Game
      </button>
    </article>
  )
}

function InjurySummaryNotice({ errorMessage, onRetry, status }) {
  if (status === 'success') {
    return null
  }

  const isError = status === 'error'
  const title = isError
    ? 'Injury summary unavailable'
    : 'Loading injury summary'
  const message = isError
    ? errorMessage
    : 'Stored injury impacts will be applied once MongoDB summaries load.'

  return (
    <div
      className={`ratings-dependency-notice ${isError ? 'error' : ''}`}
      role={isError ? 'alert' : undefined}
    >
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

function PowerRatingsNotice({ errorMessage, onRetry, status }) {
  if (status === 'success') {
    return null
  }

  const isError = status === 'error'
  const isEmpty = status === 'empty'
  const title = isError
    ? 'Power ratings unavailable'
    : isEmpty
      ? 'No power ratings found'
      : 'Loading power ratings'
  const message = isError
    ? errorMessage
    : isEmpty
      ? 'Seed MongoDB ratings before running preliminary calculations.'
      : 'Preliminary calculations will appear once MongoDB ratings load.'

  return (
    <div
      className={`ratings-dependency-notice ${isError ? 'error' : ''}`}
      role={isError ? 'alert' : undefined}
    >
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError || isEmpty ? (
        <button type="button" onClick={onRetry}>
          {isEmpty ? 'Seed teams' : 'Try again'}
        </button>
      ) : null}
    </div>
  )
}

function PreliminaryAnalysis({
  analysis,
  awayTeam,
  homeTeam,
  marketOdds,
  onMarketOddsChange,
}) {
  const statusTone = getValueStatusTone(analysis)

  return (
    <div className="preliminary-panel" aria-label="Preliminary model analysis">
      <div className="preliminary-status-row">
        <span className="preliminary-badge">Preliminary</span>
        <span className="review-badge">Needs review</span>
        <strong className={`preliminary-value-status ${statusTone}`}>
          {analysis.status}
        </strong>
      </div>

      <div className="preliminary-market-grid">
        <PreliminaryMarketSide
          label="Away"
          market={analysis.awayMarket}
          marketOddsValue={marketOdds.away}
          onMarketOddsChange={(value) => onMarketOddsChange('away', value)}
          team={awayTeam}
        />
        <PreliminaryMarketSide
          label="Home"
          market={analysis.homeMarket}
          marketOddsValue={marketOdds.home}
          onMarketOddsChange={(value) => onMarketOddsChange('home', value)}
          team={homeTeam}
        />
      </div>

      <details className="preliminary-details">
        <summary>Preliminary details</summary>
        <div className="preliminary-detail-grid">
          <PreliminaryDetailSide
            finalRating={analysis.awayFinalRating}
            label="Away"
            market={analysis.awayMarket}
            team={awayTeam}
          />
          <PreliminaryDetailSide
            finalRating={analysis.homeFinalRating}
            label="Home"
            market={analysis.homeMarket}
            team={homeTeam}
          />
        </div>
      </details>
    </div>
  )
}

function PreliminaryMarketSide({
  label,
  market,
  marketOddsValue,
  onMarketOddsChange,
  team,
}) {
  return (
    <div className="preliminary-market-side">
      <div>
        <span>{label} fair</span>
        <strong>{formatOdds(market.fairOdds)}</strong>
      </div>
      <label>
        <span>Market</span>
        <input
          aria-label={`${team.name} market odds`}
          inputMode="decimal"
          min="1.01"
          placeholder="Odds"
          step="0.01"
          type="number"
          value={marketOddsValue}
          onChange={(event) => onMarketOddsChange(event.target.value)}
        />
      </label>
    </div>
  )
}

function PreliminaryDetailSide({ finalRating, label, market, team }) {
  return (
    <div className="preliminary-detail-side">
      <strong>{team.abbreviation || label}</strong>
      <span>Rating {formatRating(finalRating)}</span>
      <span>Model {formatPercent(market.modelProbability)}</span>
      <span>Implied {formatPercent(market.impliedProbability)}</span>
      <span>Edge {formatSignedPercent(market.edge)}</span>
      <span>Odds value {formatSignedPercent(market.oddsValuePercentage)}</span>
    </div>
  )
}

function TeamLine({ showScore, team = {} }) {
  return (
    <div className="schedule-team">
      <div className="team-logo-shell">
        {team.logo ? (
          <img src={team.logo} alt={`${team.name} logo`} loading="lazy" />
        ) : (
          <span>{team.abbreviation}</span>
        )}
      </div>
      <div className="schedule-team-copy">
        <strong>{team.name}</strong>
      </div>
      <strong className={`team-score ${showScore ? '' : 'empty'}`}>
        {showScore ? team.score : ''}
      </strong>
    </div>
  )
}

export default Dashboard
