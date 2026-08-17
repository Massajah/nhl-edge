import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import {
  fetchPlayoffs,
  fetchStandings,
} from '../services/standingsApi.js'
import { normalizePlayoffResponse } from '../utils/playoffs.js'
import {
  STANDINGS_VIEWS,
  STANDINGS_VIEW_OPTIONS,
  formatGoalDifferential,
  formatPointPercentage,
  formatStandingsNumber,
  getClinchIndicatorBadges,
  getStandingsSections,
  normalizeStandingsResponse,
} from '../utils/standings.js'
import PlayoffBracket from './PlayoffBracket.jsx'

const normalizeInitialResult = (result) =>
  result ? normalizeStandingsResponse(result) : null

const normalizeInitialPlayoffResult = (result) =>
  result ? normalizePlayoffResponse(result) : null

function Standings({
  initialPlayoffResult = null,
  initialPlayoffStatus = '',
  initialResult = null,
  initialStatus = '',
  initialView = STANDINGS_VIEWS.CONFERENCE,
}) {
  const initialNormalizedResult = useMemo(
    () => normalizeInitialResult(initialResult),
    [initialResult],
  )
  const initialNormalizedPlayoffResult = useMemo(
    () => normalizeInitialPlayoffResult(initialPlayoffResult),
    [initialPlayoffResult],
  )
  const [result, setResult] = useState(initialNormalizedResult)
  const [selectedSeasonId, setSelectedSeasonId] = useState(
    initialNormalizedResult?.selectedSeasonId ?? '',
  )
  const [status, setStatus] = useState(
    initialStatus || (initialNormalizedResult ? 'success' : 'loading'),
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [view, setView] = useState(initialView)
  const [playoffResult, setPlayoffResult] = useState(
    initialNormalizedPlayoffResult,
  )
  const [playoffStatus, setPlayoffStatus] = useState(
    initialPlayoffStatus ||
      (initialNormalizedPlayoffResult ? 'success' : 'idle'),
  )
  const [playoffErrorMessage, setPlayoffErrorMessage] = useState('')
  const seasonCacheRef = useRef(
    new Map(
      initialNormalizedResult
        ? [[initialNormalizedResult.selectedSeasonId, initialNormalizedResult]]
        : [],
    ),
  )
  const playoffCacheRef = useRef(
    new Map(
      initialNormalizedPlayoffResult
        ? [[
            initialNormalizedPlayoffResult.selectedSeasonId,
            initialNormalizedPlayoffResult,
          ]]
        : [],
    ),
  )

  const loadSeason = useCallback(async (seasonId = '', { force = false } = {}) => {
    if (seasonId && !force && seasonCacheRef.current.has(seasonId)) {
      setResult(seasonCacheRef.current.get(seasonId))
      setSelectedSeasonId(seasonId)
      setStatus('success')
      setErrorMessage('')
      return
    }

    setStatus('loading')
    setErrorMessage('')

    try {
      const nextResult = normalizeStandingsResponse(
        await fetchStandings(seasonId),
      )

      seasonCacheRef.current.set(nextResult.selectedSeasonId, nextResult)
      setResult(nextResult)
      setSelectedSeasonId(nextResult.selectedSeasonId)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [])

  const loadPlayoffs = useCallback(
    async (seasonId, { force = false } = {}) => {
      if (!seasonId) {
        return
      }

      if (!force && playoffCacheRef.current.has(seasonId)) {
        setPlayoffResult(playoffCacheRef.current.get(seasonId))
        setPlayoffStatus('success')
        setPlayoffErrorMessage('')
        return
      }

      setPlayoffStatus('loading')
      setPlayoffErrorMessage('')

      try {
        const nextResult = normalizePlayoffResponse(
          await fetchPlayoffs(seasonId),
        )

        playoffCacheRef.current.set(nextResult.selectedSeasonId, nextResult)
        setPlayoffResult(nextResult)
        setPlayoffStatus('success')
      } catch (error) {
        setPlayoffStatus('error')
        setPlayoffErrorMessage(error.message)
      }
    },
    [],
  )

  useEffect(() => {
    if (initialNormalizedResult) {
      return
    }

    loadSeason()
  }, [initialNormalizedResult, loadSeason])

  useEffect(() => {
    if (view !== STANDINGS_VIEWS.PLAYOFFS || !selectedSeasonId) {
      return
    }

    loadPlayoffs(selectedSeasonId)
  }, [loadPlayoffs, selectedSeasonId, view])

  const sections = useMemo(
    () => getStandingsSections(result?.standings ?? [], view),
    [result?.standings, view],
  )
  const selectedSeason = result?.seasons.find(
    (season) => season.id === selectedSeasonId,
  )
  const isPlayoffsView = view === STANDINGS_VIEWS.PLAYOFFS
  const standingsViewOptions = STANDINGS_VIEW_OPTIONS.filter(
    (option) => option.id !== STANDINGS_VIEWS.PLAYOFFS,
  )
  const playoffsViewOption = STANDINGS_VIEW_OPTIONS.find(
    (option) => option.id === STANDINGS_VIEWS.PLAYOFFS,
  )

  const handleSeasonChange = (event) => {
    const nextSeasonId = event.target.value

    setSelectedSeasonId(nextSeasonId)
    loadSeason(nextSeasonId)
  }

  return (
    <section className="standings-page" aria-label="NHL Standings">
      <div className="standings-panel">
        <div className="standings-heading">
          <div>
            <p className="eyebrow">League table</p>
            <h2>NHL Standings</h2>
            <p>Current and historical regular-season standings.</p>
          </div>

          <label className="field standings-season-field" htmlFor="standings-season">
            <span>Season</span>
            <select
              id="standings-season"
              value={selectedSeasonId}
              disabled={!result?.seasons.length}
              onChange={handleSeasonChange}
            >
              {!result?.seasons.length ? (
                <option value="">Current season</option>
              ) : null}
              {result?.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.label}{season.isCurrent ? ' · Current' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="standings-toolbar">
          <div
            className="standings-view-selector"
            role="tablist"
            aria-label="Standings view"
          >
            <div className="standings-layout-view-group">
              {standingsViewOptions.map((option) => (
                <button
                  aria-selected={view === option.id}
                  className={view === option.id ? 'active' : ''}
                  key={option.id}
                  role="tab"
                  type="button"
                  onClick={() => setView(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {playoffsViewOption ? (
              <button
                aria-selected={isPlayoffsView}
                className={`standings-playoffs-view-button${isPlayoffsView ? ' active' : ''}`}
                role="tab"
                type="button"
                onClick={() => setView(playoffsViewOption.id)}
              >
                {playoffsViewOption.label}
              </button>
            ) : null}
          </div>

          {selectedSeason ? (
            <span className="standings-season-context">
              {isPlayoffsView
                ? playoffResult?.mode === 'projected'
                  ? 'Current standings snapshot'
                  : 'Official playoff bracket'
                : selectedSeason.isCurrent
                  ? 'Latest available standings'
                  : 'Final regular-season standings'}
            </span>
          ) : null}
        </div>

        {!isPlayoffsView && result?.clinchIndicators?.length ? (
          <ClinchIndicatorLegend indicators={result.clinchIndicators} />
        ) : null}

        {isPlayoffsView ? (
          <PlayoffBracket
            errorMessage={playoffErrorMessage}
            result={playoffResult}
            status={playoffStatus}
            onRetry={() =>
              loadPlayoffs(selectedSeasonId, { force: true })
            }
          />
        ) : null}

        {!isPlayoffsView && status === 'loading' ? (
          <StandingsLoadingState />
        ) : null}

        {!isPlayoffsView && status === 'error' ? (
          <StandingsMessage
            actionLabel="Try again"
            message={errorMessage || 'Unable to load NHL standings.'}
            onAction={() => loadSeason(selectedSeasonId, { force: true })}
            title="Standings unavailable"
            tone="error"
          />
        ) : null}

        {!isPlayoffsView &&
        status === 'success' &&
        result?.status === 'provider_error' ? (
          <StandingsMessage
            actionLabel="Try again"
            message={
              result.error?.message ||
              'NHL standings are temporarily unavailable.'
            }
            onAction={() => loadSeason(selectedSeasonId, { force: true })}
            title="Standings provider unavailable"
            tone="error"
          />
        ) : null}

        {!isPlayoffsView &&
        status === 'success' &&
        result?.status === 'no_standings' ? (
          <StandingsMessage
            message="Regular-season standings are not available yet."
            title="Ready for the regular season"
          />
        ) : null}

        {!isPlayoffsView &&
        status === 'success' &&
        result?.status === 'unavailable' ? (
          <StandingsMessage
            message="Standings are unavailable for the selected season."
            title="Historical standings unavailable"
          />
        ) : null}

        {!isPlayoffsView &&
        status === 'success' &&
        result?.status === 'ready' ? (
          <div className={`standings-sections view-${view}`}>
            {sections.map((section) => (
              <StandingsSection
                indicatorDefinitions={result.clinchIndicators}
                key={section.id}
                section={section}
              />
            ))}
          </div>
        ) : null}

        <footer className="standings-footer-note">
          <span>
            Source:{' '}
            {(isPlayoffsView ? playoffResult?.provider?.name : result?.provider?.name) ||
              'NHL Web API'}
          </span>
          <span>
            Informational only — standings and playoffs do not alter ratings,
            probabilities, or bet recommendations.
          </span>
        </footer>
      </div>
    </section>
  )
}

function ClinchIndicatorLegend({ indicators }) {
  return (
    <aside className="standings-clinch-legend" aria-label="Clinch indicator legend">
      <span className="standings-clinch-legend-title">Status</span>
      {indicators.map((indicator) => (
        <span className="standings-clinch-legend-item" key={indicator.code}>
          <span
            aria-hidden="true"
            className="standings-clinch-indicator"
          >
            {indicator.code}
          </span>
          <span>{indicator.label}</span>
        </span>
      ))}
    </aside>
  )
}

function StandingsLoadingState() {
  return (
    <div className="standings-loading-state" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <div>
        <strong>Loading standings</strong>
        <p>Fetching the selected regular season.</p>
      </div>
    </div>
  )
}

function StandingsMessage({
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

function StandingsSection({ indicatorDefinitions, section }) {
  return (
    <article className="standings-section">
      <div className="standings-section-heading">
        <h3>{section.title}</h3>
        <span>{section.rows.length} teams</span>
      </div>
      <StandingsTable
        indicatorDefinitions={indicatorDefinitions}
        rankField={section.rankField}
        rows={section.rows}
      />
    </article>
  )
}

function StandingsTable({ indicatorDefinitions, rankField, rows }) {
  return (
    <div className="standings-table-scroll">
      <table className="standings-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Team</th>
            <th scope="col">GP</th>
            <th scope="col">W</th>
            <th scope="col">L</th>
            <th scope="col">OT</th>
            <th scope="col">PTS</th>
            <th scope="col">P%</th>
            <th scope="col">GF</th>
            <th scope="col">GA</th>
            <th scope="col">DIFF</th>
            <th scope="col">L10</th>
            <th scope="col">STRK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((team) => (
            <StandingsRow
              indicatorDefinitions={indicatorDefinitions}
              key={`${team.teamAbbreviation}-${team.officialRank}`}
              rank={team[rankField]}
              team={team}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StandingsRow({ indicatorDefinitions, rank, team }) {
  const logo = team.teamLogo || getTeamMetadata(team.teamAbbreviation).logo || ''
  const indicatorBadges = getClinchIndicatorBadges(
    team.clinchIndicator,
    indicatorDefinitions,
  )

  return (
    <tr>
      <td className="standings-rank">{formatStandingsNumber(rank)}</td>
      <th className="standings-team-cell" scope="row">
        <span className="standings-team-logo" aria-hidden="true">
          {logo ? <img alt="" src={logo} /> : team.teamAbbreviation.slice(0, 2)}
        </span>
        <span className="standings-team-copy">
          <strong>{team.teamAbbreviation}</strong>
          <span>{team.teamName}</span>
        </span>
        {indicatorBadges.map((indicator) => (
          <span
            aria-label={indicator.label}
            className={`standings-clinch-indicator${indicator.supported ? '' : ' is-unsupported'}`}
            key={indicator.code}
            title={indicator.label}
          >
            {indicator.code}
          </span>
        ))}
      </th>
      <td>{formatStandingsNumber(team.gamesPlayed)}</td>
      <td>{formatStandingsNumber(team.wins)}</td>
      <td>{formatStandingsNumber(team.losses)}</td>
      <td>{formatStandingsNumber(team.overtimeLosses)}</td>
      <td className="standings-points">{formatStandingsNumber(team.points)}</td>
      <td>{formatPointPercentage(team.pointPercentage)}</td>
      <td>{formatStandingsNumber(team.goalsFor)}</td>
      <td>{formatStandingsNumber(team.goalsAgainst)}</td>
      <td className={team.goalDifferential > 0 ? 'positive' : team.goalDifferential < 0 ? 'negative' : ''}>
        {formatGoalDifferential(team.goalDifferential)}
      </td>
      <td>{team.last10Record || '—'}</td>
      <td>{team.streak || '—'}</td>
    </tr>
  )
}

export {
  ClinchIndicatorLegend,
  StandingsLoadingState,
  StandingsMessage,
  StandingsRow,
  StandingsSection,
  StandingsTable,
}

export default Standings
