import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import {
  fetchGoalieStats,
  fetchTeamGoalieSummaries,
  fetchTeamRoster,
  fetchTeamStats,
  fetchTeams,
} from '../services/teamsApi.js'
import { getTeamInjurySummary } from '../utils/injuries.js'
import { getEffectiveBaseRating } from '../utils/powerRatings.js'

const rosterGroups = [
  { key: 'forwards', label: 'Forwards' },
  { key: 'defensemen', label: 'Defensemen' },
  { key: 'goalies', label: 'Goalies' },
]

const specialTeamsRows = [
  {
    key: 'currentSeason',
    label: 'Current season',
    powerPlayPercentageKey: 'powerPlayPercentage',
    powerPlayRankKey: 'powerPlayLeagueRank',
    penaltyKillPercentageKey: 'penaltyKillPercentage',
    penaltyKillRankKey: 'penaltyKillLeagueRank',
  },
  {
    key: 'previousSeason',
    label: 'Previous season',
    powerPlayPercentageKey: 'powerPlayPercentage',
    powerPlayRankKey: 'powerPlayLeagueRank',
    penaltyKillPercentageKey: 'penaltyKillPercentage',
    penaltyKillRankKey: 'penaltyKillLeagueRank',
  },
  {
    key: 'previousThreeSeasonsAverage',
    label: 'Previous 3 seasons',
    powerPlayPercentageKey: 'averagePowerPlayPercentage',
    powerPlayRankKey: 'averagePowerPlayLeagueRank',
    penaltyKillPercentageKey: 'averagePenaltyKillPercentage',
    penaltyKillRankKey: 'averagePenaltyKillLeagueRank',
  },
]

const normalizeFilterValue = (value) => value || 'all'

const getTeamLogo = (team = {}) =>
  team.logo || getTeamMetadata(team.abbreviation).logo || ''

const formatRating = (rating) =>
  Number.isFinite(rating) ? rating.toFixed(1) : '--'

const formatSpecialTeamsValue = (percentage, rank) => {
  if (!Number.isFinite(percentage) || !Number.isFinite(rank)) {
    return 'Not available'
  }

  return `${percentage.toFixed(1)}% (#${rank})`
}

const formatSavePercentage = (savePercentage) =>
  Number.isFinite(savePercentage)
    ? savePercentage.toFixed(3).replace(/^0/, '')
    : 'Not available'

const formatDecimal = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : 'Not available'

const formatInteger = (value) =>
  Number.isFinite(value) ? String(value) : 'Not available'

const formatRecord = (stats = {}) => {
  const { wins, losses, overtimeLosses } = stats

  if (
    !Number.isFinite(wins) ||
    !Number.isFinite(losses) ||
    !Number.isFinite(overtimeLosses)
  ) {
    return 'Not available'
  }

  return `${wins}-${losses}-${overtimeLosses}`
}

const formatSeasonLabel = (season) => {
  if (!Number.isFinite(season)) {
    return 'Previous season'
  }

  const startYear = Math.trunc(season / 10000)
  const endYear = String(startYear + 1).slice(-2)

  return `${startYear}-${endYear} season`
}

const getGoalieQuickStat = (stats, status) => {
  const currentSeason = stats?.currentSeason

  if (currentSeason?.dataStatus === 'available') {
    return formatSavePercentage(currentSeason.savePercentage)
  }

  if (currentSeason?.dataStatus === 'no_nhl_games') {
    return 'No NHL games'
  }

  if (currentSeason || status === 'error') {
    return 'SV% unavailable'
  }

  return status === 'success' ? 'SV% unavailable' : 'loading'
}

const getGoalieGamesStartedForSort = (goalieStats) => {
  const currentSeason = goalieStats?.currentSeason

  if (Number.isFinite(currentSeason?.gamesStarted)) {
    return currentSeason.gamesStarted
  }

  if (currentSeason?.dataStatus === 'no_nhl_games') {
    return 0
  }

  return null
}

const getUniqueValues = (items, key) =>
  [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )

function Teams({
  injurySummaries,
  injurySummaryStatus,
  powerRatings,
  powerRatingsStatus,
}) {
  const [teams, setTeams] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [conferenceFilter, setConferenceFilter] = useState('all')
  const [divisionFilter, setDivisionFilter] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [rostersByTeam, setRostersByTeam] = useState({})
  const [rosterStatus, setRosterStatus] = useState('idle')
  const [rosterError, setRosterError] = useState('')
  const [statsByTeam, setStatsByTeam] = useState({})
  const [statsStatus, setStatsStatus] = useState('idle')
  const [statsError, setStatsError] = useState('')
  const [goalieStatsByPlayerId, setGoalieStatsByPlayerId] = useState({})
  const [goalieStatsStatusByPlayerId, setGoalieStatsStatusByPlayerId] =
    useState({})
  const [goalieStatsErrorByPlayerId, setGoalieStatsErrorByPlayerId] = useState(
    {},
  )
  const [goalieSummaryStatusByTeam, setGoalieSummaryStatusByTeam] = useState({})
  const [goalieSummaryErrorByTeam, setGoalieSummaryErrorByTeam] = useState({})

  const loadTeams = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      setTeams(await fetchTeams())
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadInitialTeams = async () => {
      try {
        const nextTeams = await fetchTeams()

        if (!isCurrent) {
          return
        }

        setTeams(nextTeams)
        setStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    }

    loadInitialTeams()

    return () => {
      isCurrent = false
    }
  }, [])

  const conferences = useMemo(() => getUniqueValues(teams, 'conference'), [teams])
  const divisions = useMemo(() => {
    const conferenceTeams =
      conferenceFilter === 'all'
        ? teams
        : teams.filter((team) => team.conference === conferenceFilter)

    return getUniqueValues(conferenceTeams, 'division')
  }, [conferenceFilter, teams])

  const visibleTeams = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return teams.filter((team) => {
      if (
        conferenceFilter !== 'all' &&
        team.conference !== conferenceFilter
      ) {
        return false
      }

      if (divisionFilter !== 'all' && team.division !== divisionFilter) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      return [team.name, team.abbreviation, team.conference, team.division].some(
        (value = '') => value.toLowerCase().includes(normalizedSearch),
      )
    })
  }, [conferenceFilter, divisionFilter, searchTerm, teams])

  const loadRoster = useCallback(
    async (team) => {
      if (!team?.abbreviation) {
        return
      }

      if (rostersByTeam[team.abbreviation]) {
        setRosterStatus('success')
        setRosterError('')
        return
      }

      setRosterStatus('loading')
      setRosterError('')

      try {
        const roster = await fetchTeamRoster(team.abbreviation)

        setRostersByTeam((currentRosters) => ({
          ...currentRosters,
          [team.abbreviation]: roster,
        }))
        setRosterStatus('success')
      } catch (error) {
        setRosterStatus('error')
        setRosterError(error.message)
      }
    },
    [rostersByTeam],
  )

  const loadTeamStats = useCallback(
    async (team) => {
      if (!team?.abbreviation) {
        return
      }

      if (statsByTeam[team.abbreviation]) {
        setStatsStatus('success')
        setStatsError('')
        return
      }

      setStatsStatus('loading')
      setStatsError('')

      try {
        const stats = await fetchTeamStats(team.abbreviation)

        setStatsByTeam((currentStats) => ({
          ...currentStats,
          [team.abbreviation]: stats,
        }))
        setStatsStatus('success')
      } catch (error) {
        setStatsStatus('error')
        setStatsError(error.message)
      }
    },
    [statsByTeam],
  )

  const loadGoalieSummaries = useCallback(
    async (team, { force = false } = {}) => {
      if (!team?.abbreviation) {
        return
      }

      const teamKey = team.abbreviation
      const currentStatus = goalieSummaryStatusByTeam[teamKey]

      if (
        !force &&
        (currentStatus === 'loading' || currentStatus === 'success')
      ) {
        return
      }

      setGoalieSummaryStatusByTeam((currentStatuses) => ({
        ...currentStatuses,
        [teamKey]: 'loading',
      }))
      setGoalieSummaryErrorByTeam((currentErrors) => ({
        ...currentErrors,
        [teamKey]: '',
      }))

      try {
        const goalieSummaries = await fetchTeamGoalieSummaries(teamKey)
        const summaries = goalieSummaries.goalies ?? []

        setGoalieStatsByPlayerId((currentStats) => {
          const nextStats = { ...currentStats }

          summaries.forEach((goalieSummary) => {
            if (!goalieSummary.playerId) {
              return
            }

            const playerKey = String(goalieSummary.playerId)
            const existingStats = nextStats[playerKey] ?? {}

            nextStats[playerKey] = {
              ...existingStats,
              playerId: goalieSummary.playerId,
              playerName: goalieSummary.playerName,
              currentSeason: goalieSummary.currentSeason,
            }
          })

          return nextStats
        })
        setGoalieStatsStatusByPlayerId((currentStatuses) => {
          const nextStatuses = { ...currentStatuses }

          summaries.forEach((goalieSummary) => {
            if (!goalieSummary.playerId) {
              return
            }

            const playerKey = String(goalieSummary.playerId)

            if (nextStatuses[playerKey] !== 'loading') {
              nextStatuses[playerKey] = 'success'
            }
          })

          return nextStatuses
        })
        setGoalieSummaryStatusByTeam((currentStatuses) => ({
          ...currentStatuses,
          [teamKey]: 'success',
        }))
      } catch (error) {
        setGoalieSummaryStatusByTeam((currentStatuses) => ({
          ...currentStatuses,
          [teamKey]: 'error',
        }))
        setGoalieSummaryErrorByTeam((currentErrors) => ({
          ...currentErrors,
          [teamKey]: error.message,
        }))
      }
    },
    [goalieSummaryStatusByTeam],
  )

  const loadGoalieStats = useCallback(
    async (playerId, { force = false } = {}) => {
      if (!playerId) {
        return
      }

      const playerKey = String(playerId)

      if (
        !force &&
        (goalieStatsByPlayerId[playerKey]?.previousSeason ||
          goalieStatsStatusByPlayerId[playerKey] === 'loading')
      ) {
        return
      }

      setGoalieStatsStatusByPlayerId((currentStatuses) => ({
        ...currentStatuses,
        [playerKey]: 'loading',
      }))
      setGoalieStatsErrorByPlayerId((currentErrors) => ({
        ...currentErrors,
        [playerKey]: '',
      }))

      try {
        const goalieStats = await fetchGoalieStats(playerKey)

        setGoalieStatsByPlayerId((currentStats) => ({
          ...currentStats,
          [playerKey]: goalieStats,
        }))
        setGoalieStatsStatusByPlayerId((currentStatuses) => ({
          ...currentStatuses,
          [playerKey]: 'success',
        }))
      } catch (error) {
        setGoalieStatsStatusByPlayerId((currentStatuses) => ({
          ...currentStatuses,
          [playerKey]: 'error',
        }))
        setGoalieStatsErrorByPlayerId((currentErrors) => ({
          ...currentErrors,
          [playerKey]: error.message,
        }))
      }
    },
    [goalieStatsByPlayerId, goalieStatsStatusByPlayerId],
  )

  const handleSelectTeam = (team) => {
    setSelectedTeam(team)
    loadRoster(team)
    loadTeamStats(team)
    loadGoalieSummaries(team)
  }

  const handleBackToTeams = () => {
    setSelectedTeam(null)
    setRosterStatus('idle')
    setRosterError('')
    setStatsStatus('idle')
    setStatsError('')
  }

  const selectedRoster = selectedTeam
    ? rostersByTeam[selectedTeam.abbreviation]
    : null
  const selectedStats = selectedTeam
    ? statsByTeam[selectedTeam.abbreviation]
    : null

  return (
    <section className="teams-page" aria-label="Teams">
      {selectedTeam ? (
        <TeamDetails
          key={selectedTeam.abbreviation}
          injurySummaries={injurySummaries}
          injurySummaryStatus={injurySummaryStatus}
          onBack={handleBackToTeams}
          onRetryRoster={() => loadRoster(selectedTeam)}
          onRetryStats={() => loadTeamStats(selectedTeam)}
          onLoadGoalieStats={loadGoalieStats}
          goalieStatsByPlayerId={goalieStatsByPlayerId}
          goalieStatsErrorByPlayerId={goalieStatsErrorByPlayerId}
          goalieStatsStatusByPlayerId={goalieStatsStatusByPlayerId}
          goalieSummaryError={
            goalieSummaryErrorByTeam[selectedTeam.abbreviation] ?? ''
          }
          goalieSummaryStatus={
            goalieSummaryStatusByTeam[selectedTeam.abbreviation] ?? 'idle'
          }
          powerRatings={powerRatings}
          powerRatingsStatus={powerRatingsStatus}
          roster={selectedRoster}
          rosterError={rosterError}
          rosterStatus={rosterStatus}
          stats={selectedStats}
          statsError={statsError}
          statsStatus={statsStatus}
          team={selectedTeam}
        />
      ) : (
        <div className="teams-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Teams</p>
              <h2>League Directory</h2>
            </div>
            <span>
              {status === 'success'
                ? `${visibleTeams.length} of ${teams.length} teams`
                : 'NHL teams'}
            </span>
          </div>

          <div className="teams-toolbar">
            <label className="field" htmlFor="team-directory-search">
              <span>Search teams</span>
              <input
                id="team-directory-search"
                type="search"
                value={searchTerm}
                placeholder="Team, abbreviation, conference, division"
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <label className="field" htmlFor="team-conference-filter">
              <span>Conference</span>
              <select
                id="team-conference-filter"
                value={conferenceFilter}
                onChange={(event) => {
                  setConferenceFilter(normalizeFilterValue(event.target.value))
                  setDivisionFilter('all')
                }}
              >
                <option value="all">All conferences</option>
                {conferences.map((conference) => (
                  <option key={conference} value={conference}>
                    {conference}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" htmlFor="team-division-filter">
              <span>Division</span>
              <select
                id="team-division-filter"
                value={divisionFilter}
                onChange={(event) =>
                  setDivisionFilter(normalizeFilterValue(event.target.value))
                }
              >
                <option value="all">All divisions</option>
                {divisions.map((division) => (
                  <option key={division} value={division}>
                    {division}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" onClick={loadTeams}>
              Refresh
            </button>
          </div>

          {status === 'loading' ? <TeamsLoadingState /> : null}

          {status === 'error' ? (
            <div className="ratings-state error" role="alert">
              <strong>Teams unavailable</strong>
              <p>{errorMessage}</p>
              <button type="button" onClick={loadTeams}>
                Try again
              </button>
            </div>
          ) : null}

          {status === 'success' && visibleTeams.length > 0 ? (
            <div className="teams-grid">
              {visibleTeams.map((team) => (
                <TeamCard key={team.abbreviation} team={team} onSelect={handleSelectTeam} />
              ))}
            </div>
          ) : null}

          {status === 'success' && visibleTeams.length === 0 ? (
            <p className="empty-state">No teams match those filters.</p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function TeamDetails({
  goalieStatsByPlayerId,
  goalieStatsErrorByPlayerId,
  goalieStatsStatusByPlayerId,
  goalieSummaryError,
  goalieSummaryStatus,
  injurySummaries,
  injurySummaryStatus,
  onBack,
  onLoadGoalieStats,
  onRetryRoster,
  onRetryStats,
  powerRatings,
  powerRatingsStatus,
  roster,
  rosterError,
  rosterStatus,
  stats,
  statsError,
  statsStatus,
  team,
}) {
  const rating = powerRatings[team.abbreviation]
  const injurySummary = getTeamInjurySummary(injurySummaries, team.abbreviation)
  const logo = getTeamLogo(team)
  const [expandedGoalieId, setExpandedGoalieId] = useState(null)
  const effectiveRating =
    powerRatingsStatus === 'success' && rating
      ? getEffectiveBaseRating(rating)
      : null
  const sortedGoalies = useMemo(() => {
    const goalies = roster?.goalies ?? []
    const goaliesWithIndex = goalies.map((goalie, index) => ({
      goalie,
      index,
      gamesStarted: getGoalieGamesStartedForSort(
        goalieStatsByPlayerId[String(goalie.id)],
      ),
    }))
    const canSortGoalies =
      goaliesWithIndex.length > 0 &&
      goaliesWithIndex.every(({ gamesStarted }) =>
        Number.isFinite(gamesStarted),
      )

    if (!canSortGoalies) {
      return goalies
    }

    return [...goaliesWithIndex]
      .sort((goalieA, goalieB) => {
        if (goalieA.gamesStarted !== goalieB.gamesStarted) {
          return goalieB.gamesStarted - goalieA.gamesStarted
        }

        return goalieA.index - goalieB.index
      })
      .map(({ goalie }) => goalie)
  }, [goalieStatsByPlayerId, roster])

  const handleToggleGoalie = useCallback(
    (goalie) => {
      const playerKey = String(goalie.id)
      const nextGoalieId =
        expandedGoalieId === playerKey ? null : playerKey

      setExpandedGoalieId(nextGoalieId)

      if (nextGoalieId) {
        onLoadGoalieStats(playerKey)
      }
    },
    [expandedGoalieId, onLoadGoalieStats],
  )

  return (
    <div className="team-details-panel">
      <button className="secondary-inline-button" type="button" onClick={onBack}>
        Back to teams
      </button>

      <header className="team-details-header">
        <TeamLogo logo={logo} name={team.name} abbreviation={team.abbreviation} />
        <div className="team-details-copy">
          <p className="eyebrow">Team Details</p>
          <h2>{team.name}</h2>
          <div className="team-meta-row">
            <span>{team.abbreviation}</span>
            <span>{team.conference || 'Conference TBD'}</span>
            <span>{team.division || 'Division TBD'}</span>
          </div>
        </div>

        <div className="team-detail-metrics" aria-label="Team model summary">
          <SummaryMetric
            label="Power rating"
            value={formatRating(effectiveRating)}
            detail={
              powerRatingsStatus === 'success'
                ? 'MongoDB current'
                : 'Loading MongoDB'
            }
          />
          <SummaryMetric
            label="Active injury impact"
            value={
              injurySummaryStatus === 'success'
                ? injurySummary.totalImpact.toFixed(1)
                : '--'
            }
            detail={
              injurySummaryStatus === 'success'
                ? `${injurySummary.activeInjuries} active`
                : 'Loading MongoDB'
            }
          />
        </div>
      </header>

      <SpecialTeamsSection
        onRetry={onRetryStats}
        stats={stats}
        status={statsStatus}
        errorMessage={statsError}
      />

      {rosterStatus === 'loading' ? <RosterLoadingState /> : null}

      {rosterStatus === 'error' ? (
        <div className="ratings-state error" role="alert">
          <strong>Roster unavailable</strong>
          <p>{rosterError}</p>
          <button type="button" onClick={onRetryRoster}>
            Try again
          </button>
        </div>
      ) : null}

      {rosterStatus === 'success' && roster ? (
        <div className="roster-sections">
          {rosterGroups.map((group) => (
            <RosterSection
              key={group.key}
              groupKey={group.key}
              label={group.label}
              players={
                group.key === 'goalies'
                  ? sortedGoalies
                  : (roster[group.key] ?? [])
              }
              expandedGoalieId={expandedGoalieId}
              goalieStatsByPlayerId={goalieStatsByPlayerId}
              goalieStatsErrorByPlayerId={goalieStatsErrorByPlayerId}
              goalieStatsStatusByPlayerId={goalieStatsStatusByPlayerId}
              goalieSummaryError={goalieSummaryError}
              goalieSummaryStatus={goalieSummaryStatus}
              onLoadGoalieStats={onLoadGoalieStats}
              onToggleGoalie={handleToggleGoalie}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SpecialTeamsSection({ errorMessage, onRetry, stats, status }) {
  return (
    <section className="special-teams-section" aria-label="Special Teams">
      <div className="special-teams-heading">
        <h3>Special Teams</h3>
      </div>

      {status === 'error' ? (
        <div className="special-teams-error" role="alert">
          <strong>Special teams unavailable</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <table className="special-teams-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Season" />
              <th scope="col">Power Play</th>
              <th scope="col">Penalty Kill</th>
            </tr>
          </thead>
          <tbody>
            {specialTeamsRows.map((row) => {
              const rowStats = stats?.[row.key]
              const powerPlayValue =
                status === 'loading'
                  ? 'Loading'
                  : formatSpecialTeamsValue(
                      rowStats?.[row.powerPlayPercentageKey],
                      rowStats?.[row.powerPlayRankKey],
                    )
              const penaltyKillValue =
                status === 'loading'
                  ? 'Loading'
                  : formatSpecialTeamsValue(
                      rowStats?.[row.penaltyKillPercentageKey],
                      rowStats?.[row.penaltyKillRankKey],
                    )

              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{powerPlayValue}</td>
                  <td>{penaltyKillValue}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TeamCard({ onSelect, team }) {
  const logo = getTeamLogo(team)

  return (
    <button className="team-card" type="button" onClick={() => onSelect(team)}>
      <TeamLogo logo={logo} name={team.name} abbreviation={team.abbreviation} />
      <div className="team-card-copy">
        <strong>{team.name}</strong>
        <span>{team.abbreviation}</span>
        <small>{team.division || 'Division TBD'}</small>
      </div>
    </button>
  )
}

function RosterSection({
  expandedGoalieId,
  goalieStatsByPlayerId,
  goalieStatsErrorByPlayerId,
  goalieStatsStatusByPlayerId,
  goalieSummaryError,
  goalieSummaryStatus,
  groupKey,
  label,
  onLoadGoalieStats,
  onToggleGoalie,
  players,
}) {
  const isGoalieSection = groupKey === 'goalies'

  return (
    <section className="roster-section" aria-label={label}>
      <div className="roster-section-header">
        <h3>{label}</h3>
        <span>{players.length}</span>
      </div>

      {players.length > 0 ? (
        <div className="player-list">
          {players.map((player) =>
            isGoalieSection ? (
              <GoalieRow
                key={player.id ?? player.fullName}
                errorMessage={
                  goalieStatsErrorByPlayerId?.[String(player.id)] ?? ''
                }
                isExpanded={expandedGoalieId === String(player.id)}
                onLoadGoalieStats={onLoadGoalieStats}
                onToggle={onToggleGoalie}
                player={player}
                stats={goalieStatsByPlayerId?.[String(player.id)]}
                summaryErrorMessage={goalieSummaryError}
                summaryStatus={goalieSummaryStatus}
                status={
                  goalieStatsStatusByPlayerId?.[String(player.id)] ?? 'idle'
                }
              />
            ) : (
              <PlayerRow key={player.id ?? player.fullName} player={player} />
            ),
          )}
        </div>
      ) : (
        <p className="empty-state">No {label.toLowerCase()} listed.</p>
      )}
    </section>
  )
}

function GoalieRow({
  errorMessage,
  isExpanded,
  onLoadGoalieStats,
  onToggle,
  player,
  stats,
  summaryErrorMessage,
  summaryStatus,
  status,
}) {
  const playerKey = String(player.id)
  const expandedContentId = `goalie-stats-${playerKey}`
  const effectiveStatus =
    status === 'idle' && summaryStatus !== 'idle' ? summaryStatus : status
  const quickStat = getGoalieQuickStat(stats, effectiveStatus)
  const effectiveErrorMessage = errorMessage || summaryErrorMessage
  const handleToggle = () => onToggle(player)
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle()
    }
  }

  return (
    <article
      className={`player-row goalie-player-row${isExpanded ? ' expanded' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-controls={expandedContentId}
      aria-label={`${player.fullName} goalie statistics`}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
    >
      <div className="player-headshot">
        {player.headshot ? (
          <img src={player.headshot} alt="" loading="lazy" />
        ) : (
          <span>G</span>
        )}
      </div>
      <div className="player-main">
        <strong>{player.fullName}</strong>
        <span>
          {player.sweaterNumber ? `#${player.sweaterNumber}` : 'No number'} /{' '}
          {player.position || 'G'}
        </span>
        <small>{player.nationality || 'Nationality TBD'}</small>
      </div>
      <div
        className={`goalie-quick-stat${
          quickStat.startsWith('.') ? ' primary' : ''
        }`}
      >
        <span>SV%</span>
        {quickStat === 'loading' ? (
          <strong aria-label="Loading save percentage">
            <span className="goalie-stat-skeleton" />
          </strong>
        ) : (
          <strong>{quickStat}</strong>
        )}
      </div>
      <ChevronDown className="goalie-chevron" aria-hidden="true" />

      {isExpanded ? (
        <GoalieExpandedStats
          errorMessage={effectiveErrorMessage}
          id={expandedContentId}
          onRetry={(event) => {
            event.stopPropagation()
            onLoadGoalieStats(playerKey, { force: true })
          }}
          stats={stats}
          status={status}
        />
      ) : null}
    </article>
  )
}

function GoalieExpandedStats({ errorMessage, id, onRetry, stats, status }) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="goalie-expanded" id={id}>
        <div className="goalie-expanded-state">Loading goalie statistics</div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="goalie-expanded" id={id}>
        <div className="goalie-expanded-error" role="alert">
          <div>
            <strong>Goalie stats unavailable</strong>
            <span>{errorMessage}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const currentSeason = stats?.currentSeason
  const previousSeason = stats?.previousSeason
  const hasCurrentSeasonStats = currentSeason?.dataStatus === 'available'
  const hasPreviousSeasonStats = previousSeason?.dataStatus === 'available'

  return (
    <div className="goalie-expanded" id={id}>
      <div className="goalie-expanded-block">
        <h4>Current season</h4>
        {hasCurrentSeasonStats ? (
          <div className="goalie-current-grid">
            <GoalieStat label="SV%" value={formatSavePercentage(currentSeason.savePercentage)} />
            <GoalieStat label="GP" value={formatInteger(currentSeason.gamesPlayed)} />
            <GoalieStat label="GS" value={formatInteger(currentSeason.gamesStarted)} />
            <GoalieStat label="Record" value={formatRecord(currentSeason)} />
            <GoalieStat label="GAA" value={formatDecimal(currentSeason.goalsAgainstAverage)} />
            <GoalieStat label="SO" value={formatInteger(currentSeason.shutouts)} />
            <GoalieStat label="Saves" value={formatInteger(currentSeason.saves)} />
            <GoalieStat label="Shots" value={formatInteger(currentSeason.shotsAgainst)} />
          </div>
        ) : (
          <div className="goalie-expanded-state">
            {currentSeason?.dataStatus === 'no_nhl_games'
              ? 'No NHL games this season'
              : 'Current-season statistics unavailable'}
          </div>
        )}
      </div>

      {hasPreviousSeasonStats ? (
        <div className="goalie-previous-block">
          <h4>{formatSeasonLabel(previousSeason.season)}</h4>
          <div className="goalie-previous-grid">
            <GoalieStat label="SV%" value={formatSavePercentage(previousSeason.savePercentage)} />
            <GoalieStat label="GP" value={formatInteger(previousSeason.gamesPlayed)} />
            <GoalieStat label="GS" value={formatInteger(previousSeason.gamesStarted)} />
            <GoalieStat label="Record" value={formatRecord(previousSeason)} />
            <GoalieStat label="GAA" value={formatDecimal(previousSeason.goalsAgainstAverage)} />
            <GoalieStat label="SO" value={formatInteger(previousSeason.shutouts)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GoalieStat({ label, value }) {
  return (
    <div className="goalie-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PlayerRow({ player }) {
  return (
    <article className="player-row">
      <div className="player-headshot">
        {player.headshot ? (
          <img src={player.headshot} alt="" loading="lazy" />
        ) : (
          <span>{player.position || 'NHL'}</span>
        )}
      </div>
      <div className="player-main">
        <strong>{player.fullName}</strong>
        <span>
          {player.sweaterNumber ? `#${player.sweaterNumber}` : 'No number'} /{' '}
          {player.position || 'Position TBD'}
        </span>
      </div>
      <div className="player-details">
        <span>{player.shootsCatches ? `Shoots ${player.shootsCatches}` : 'Hand TBD'}</span>
        <span>{player.nationality || 'Nationality TBD'}</span>
      </div>
    </article>
  )
}

function TeamLogo({ abbreviation, logo, name }) {
  const [hasLogoError, setHasLogoError] = useState(false)
  const showLogo = logo && !hasLogoError

  return (
    <div className="team-directory-logo" aria-hidden="true">
      {showLogo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          onError={() => setHasLogoError(true)}
        />
      ) : (
        <span>{abbreviation || name.slice(0, 3).toUpperCase()}</span>
      )}
    </div>
  )
}

function SummaryMetric({ detail, label, value }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function TeamsLoadingState() {
  return (
    <div className="teams-grid" aria-label="Loading teams">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div className="team-card team-card-loading" key={item}>
          <span />
          <strong />
          <small />
        </div>
      ))}
    </div>
  )
}

function RosterLoadingState() {
  return (
    <div className="roster-sections" aria-label="Loading roster">
      {rosterGroups.map((group) => (
        <section className="roster-section" key={group.key}>
          <div className="roster-section-header">
            <h3>{group.label}</h3>
            <span>--</span>
          </div>
          <div className="player-list">
            {[0, 1, 2].map((item) => (
              <div className="player-row player-row-loading" key={item}>
                <span />
                <strong />
                <div />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default Teams
