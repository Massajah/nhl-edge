import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NHL_TEAMS } from '../data/teams.js'
import { getTeamMetadata } from '../data/teamMetadata.js'
import TeamModelValues from './TeamModelValues.jsx'
import {
  deleteGoalieAdjustment,
  fetchGoalieStats,
  fetchSavedGoalieAdjustments,
  saveGoalieAdjustment,
} from '../services/teamsApi.js'
import { teamsDataCoordinator } from '../services/teamsDataCoordinator.js'
import { getTeamInjurySummary } from '../utils/injuries.js'
import {
  mergeProviderGoaliesWithAdjustments,
  normalizeMaximumGoaliePenalty,
  validateGoalieAdjustmentValue,
} from '../utils/goalies.js'
import { DEFAULT_MAXIMUM_GOALIE_PENALTY } from '../config/baseModel.js'
import { getEffectiveBaseRating } from '../utils/powerRatings.js'
import { filterTeams } from '../utils/teamDirectory.js'

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

const getConferenceForDivision = (division) =>
  ['Atlantic', 'Metropolitan'].includes(division) ? 'Eastern' : 'Western'

const localTeams = NHL_TEAMS.map((team) => ({
  ...team,
  conference: getConferenceForDivision(team.division),
  logo: getTeamMetadata(team.abbreviation).logo || '',
}))

const createProviderSectionState = () => ({
  data: null,
  error: '',
  provider: null,
  status: 'idle',
})

const isUnavailableProviderResult = (result) =>
  !result?.data || ['rate_limited', 'unavailable'].includes(
    result?.provider?.status,
  )

const useLoadNearViewport = (onVisible, key, enabled = true) => {
  const elementRef = useRef(null)
  const onVisibleRef = useRef(onVisible)
  const loadedKeyRef = useRef('')

  useEffect(() => {
    onVisibleRef.current = onVisible
  }, [onVisible])

  useEffect(() => {
    if (!enabled || loadedKeyRef.current === key) {
      return undefined
    }

    const element = elementRef.current

    if (!element || typeof IntersectionObserver === 'undefined') {
      const timeout = window.setTimeout(() => {
        loadedKeyRef.current = key
        onVisibleRef.current()
      }, 0)

      return () => window.clearTimeout(timeout)
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return
      }

      loadedKeyRef.current = key
      observer.disconnect()
      onVisibleRef.current()

      if (import.meta.env.DEV) {
        console.debug('Teams provider section loaded lazily', { key })
      }
    }, { rootMargin: '500px 0px' })

    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, key])

  return elementRef
}

function Teams({
  injurySummaries,
  injurySummaryStatus,
  maximumGoaliePenalty = DEFAULT_MAXIMUM_GOALIE_PENALTY,
  powerRatings,
  powerRatingsStatus,
}) {
  const [teams, setTeams] = useState(localTeams)
  const [status, setStatus] = useState('success')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [conferenceFilter, setConferenceFilter] = useState('all')
  const [divisionFilter, setDivisionFilter] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [rosterStateByTeam, setRosterStateByTeam] = useState({})
  const [statsStateByTeam, setStatsStateByTeam] = useState({})
  const [goalieStatsByPlayerId, setGoalieStatsByPlayerId] = useState({})
  const [goalieStatsStatusByPlayerId, setGoalieStatsStatusByPlayerId] =
    useState({})
  const [goalieStatsErrorByPlayerId, setGoalieStatsErrorByPlayerId] = useState(
    {},
  )
  const [goalieSummaryStateByTeam, setGoalieSummaryStateByTeam] = useState({})

  const loadTeams = useCallback(async () => {
    setStatus('refreshing')
    setErrorMessage('')

    try {
      const { data: providerTeams } = await teamsDataCoordinator.loadTeams({
        force: true,
      })

      if (providerTeams.length > 0) {
        setTeams(providerTeams)
      }
      setStatus('success')
    } catch (error) {
      setErrorMessage(error.message)
      setStatus('success')
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadInitialTeams = async () => {
      try {
        const { data: nextTeams } = await teamsDataCoordinator.loadTeams()

        if (!isCurrent) {
          return
        }

        if (nextTeams.length > 0) {
          setTeams(nextTeams)
        }
        setStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setErrorMessage(error.message)
        setStatus('success')
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

  const visibleTeams = useMemo(
    () =>
      filterTeams(teams, {
        conferenceFilter,
        divisionFilter,
        searchTerm,
      }),
    [conferenceFilter, divisionFilter, searchTerm, teams],
  )

  const loadRoster = useCallback(async (team, { force = false } = {}) => {
    const teamKey = team?.abbreviation

    if (!teamKey) {
      return null
    }

    setRosterStateByTeam((currentStates) => ({
      ...currentStates,
      [teamKey]: {
        ...(currentStates[teamKey] ?? createProviderSectionState()),
        error: '',
        status: currentStates[teamKey]?.data ? 'refreshing' : 'loading',
      },
    }))

    try {
      const result = await teamsDataCoordinator.loadRoster(teamKey, { force })

      if (isUnavailableProviderResult(result)) {
        setRosterStateByTeam((currentStates) => ({
          ...currentStates,
          [teamKey]: {
            ...(currentStates[teamKey] ?? createProviderSectionState()),
            error: 'Current roster temporarily unavailable.',
            provider: result?.provider ?? null,
            status: currentStates[teamKey]?.data ? 'success' : 'error',
          },
        }))
        return null
      }

      setRosterStateByTeam((currentStates) => ({
        ...currentStates,
        [teamKey]: {
          data: result.data,
          error: '',
          provider: result.provider,
          status: 'success',
        },
      }))
      return result.data
    } catch {
      setRosterStateByTeam((currentStates) => ({
        ...currentStates,
        [teamKey]: {
          ...(currentStates[teamKey] ?? createProviderSectionState()),
          error: 'Current roster temporarily unavailable.',
          status: currentStates[teamKey]?.data ? 'success' : 'error',
        },
      }))
      return null
    }
  }, [])

  const loadTeamStats = useCallback(async (team, { force = false } = {}) => {
    const teamKey = team?.abbreviation

    if (!teamKey) {
      return null
    }

    setStatsStateByTeam((currentStates) => ({
      ...currentStates,
      [teamKey]: {
        ...(currentStates[teamKey] ?? createProviderSectionState()),
        error: '',
        status: currentStates[teamKey]?.data ? 'refreshing' : 'loading',
      },
    }))

    try {
      const result = await teamsDataCoordinator.loadStats(teamKey, { force })

      if (isUnavailableProviderResult(result)) {
        setStatsStateByTeam((currentStates) => ({
          ...currentStates,
          [teamKey]: {
            ...(currentStates[teamKey] ?? createProviderSectionState()),
            error: 'Special Teams data temporarily unavailable.',
            provider: result?.provider ?? null,
            status: currentStates[teamKey]?.data ? 'success' : 'error',
          },
        }))
        return null
      }

      setStatsStateByTeam((currentStates) => ({
        ...currentStates,
        [teamKey]: {
          data: result.data,
          error: '',
          provider: result.provider,
          status: 'success',
        },
      }))
      return result.data
    } catch {
      setStatsStateByTeam((currentStates) => ({
        ...currentStates,
        [teamKey]: {
          ...(currentStates[teamKey] ?? createProviderSectionState()),
          error: 'Special Teams data temporarily unavailable.',
          status: currentStates[teamKey]?.data ? 'success' : 'error',
        },
      }))
      return null
    }
  }, [])

  const loadGoalieSummaries = useCallback(async (
    team,
    { force = false } = {},
  ) => {
    const teamKey = team?.abbreviation

    if (!teamKey) {
      return null
    }

    setGoalieSummaryStateByTeam((currentStates) => ({
      ...currentStates,
      [teamKey]: {
        ...(currentStates[teamKey] ?? createProviderSectionState()),
        error: '',
        status: currentStates[teamKey]?.data ? 'refreshing' : 'loading',
      },
    }))

    try {
      const result = await teamsDataCoordinator.loadGoalieSummaries(
        teamKey,
        { force },
      )

      if (isUnavailableProviderResult(result)) {
        setGoalieSummaryStateByTeam((currentStates) => ({
          ...currentStates,
          [teamKey]: {
            ...(currentStates[teamKey] ?? createProviderSectionState()),
            error: 'Goalie statistics temporarily unavailable.',
            provider: result?.provider ?? null,
            status: currentStates[teamKey]?.data ? 'success' : 'error',
          },
        }))
        return null
      }

      const goalieSummaries = result.data
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
        setGoalieSummaryStateByTeam((currentStates) => ({
          ...currentStates,
          [teamKey]: {
            data: result.data,
            error: '',
            provider: result.provider,
            status: 'success',
          },
        }))
        return result.data
      } catch {
        setGoalieSummaryStateByTeam((currentStates) => ({
          ...currentStates,
          [teamKey]: {
            ...(currentStates[teamKey] ?? createProviderSectionState()),
            error: 'Goalie statistics temporarily unavailable.',
            status: currentStates[teamKey]?.data ? 'success' : 'error',
          },
        }))
        return null
      }
  }, [])

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
  }

  const handleBackToTeams = () => {
    setSelectedTeam(null)
  }

  const selectedTeamKey = selectedTeam?.abbreviation
  const selectedRosterState = selectedTeamKey
    ? rosterStateByTeam[selectedTeamKey] ?? createProviderSectionState()
    : createProviderSectionState()
  const selectedStatsState = selectedTeamKey
    ? statsStateByTeam[selectedTeamKey] ?? createProviderSectionState()
    : createProviderSectionState()
  const selectedGoalieSummaryState = selectedTeamKey
    ? goalieSummaryStateByTeam[selectedTeamKey] ?? createProviderSectionState()
    : createProviderSectionState()

  return (
    <section className="teams-page" aria-label="Teams">
      {selectedTeam ? (
        <TeamDetails
          key={selectedTeam.abbreviation}
          injurySummaries={injurySummaries}
          injurySummaryStatus={injurySummaryStatus}
          maximumGoaliePenalty={maximumGoaliePenalty}
          onBack={handleBackToTeams}
          onLoadGoalieSummaries={loadGoalieSummaries}
          onLoadGoalieStats={loadGoalieStats}
          onLoadRoster={loadRoster}
          onLoadStats={loadTeamStats}
          onRetryRoster={() => loadRoster(selectedTeam, { force: true })}
          onRetryStats={() => loadTeamStats(selectedTeam, { force: true })}
          goalieStatsByPlayerId={goalieStatsByPlayerId}
          goalieStatsErrorByPlayerId={goalieStatsErrorByPlayerId}
          goalieStatsStatusByPlayerId={goalieStatsStatusByPlayerId}
          goalieSummaryError={selectedGoalieSummaryState.error}
          goalieSummaryStatus={selectedGoalieSummaryState.status}
          powerRatings={powerRatings}
          powerRatingsStatus={powerRatingsStatus}
          roster={selectedRosterState.data}
          rosterError={selectedRosterState.error}
          rosterProvider={selectedRosterState.provider}
          rosterStatus={selectedRosterState.status}
          stats={selectedStatsState.data}
          statsError={selectedStatsState.error}
          statsProvider={selectedStatsState.provider}
          statsStatus={selectedStatsState.status}
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
            <label
              className="field teams-search-field"
              htmlFor="team-directory-search"
            >
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
  maximumGoaliePenalty,
  onBack,
  onLoadGoalieSummaries,
  onLoadGoalieStats,
  onLoadRoster,
  onLoadStats,
  onRetryRoster,
  onRetryStats,
  powerRatings,
  powerRatingsStatus,
  roster,
  rosterError,
  rosterProvider,
  rosterStatus,
  stats,
  statsError,
  statsProvider,
  statsStatus,
  team,
}) {
  const rating = powerRatings[team.abbreviation]
  const injurySummary = getTeamInjurySummary(injurySummaries, team.abbreviation)
  const logo = getTeamLogo(team)
  const [expandedGoalieId, setExpandedGoalieId] = useState(null)
  const [expandedRosterSections, setExpandedRosterSections] = useState({
    defensemen: false,
    forwards: false,
    goalies: true,
  })
  const [goalieAdjustments, setGoalieAdjustments] = useState([])
  const [goalieAdjustmentStatus, setGoalieAdjustmentStatus] =
    useState('loading')
  const [goalieAdjustmentError, setGoalieAdjustmentError] = useState('')
  const rosterReady = Boolean(roster) &&
    ['success', 'refreshing'].includes(rosterStatus)
  const rosterBoundaryRef = useLoadNearViewport(
    () => onLoadRoster(team),
    `${team.abbreviation}:roster`,
  )
  const goalieBoundaryRef = useLoadNearViewport(
    () => onLoadGoalieSummaries(team),
    `${team.abbreviation}:goalie-summaries`,
    rosterReady,
  )
  const effectiveRating =
    powerRatingsStatus === 'success' && rating
      ? getEffectiveBaseRating(rating)
      : null
  const sortedGoalies = useMemo(() => {
    const goalies = mergeProviderGoaliesWithAdjustments(
      roster?.goalies ?? [],
      goalieAdjustments,
    )
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
  }, [goalieAdjustments, goalieStatsByPlayerId, roster])

  useEffect(() => {
    let isCurrent = true

    fetchSavedGoalieAdjustments(team.abbreviation)
      .then((result) => {
        if (!isCurrent) {
          return
        }

        setGoalieAdjustments(result.adjustments ?? [])
        setGoalieAdjustmentStatus('success')
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setGoalieAdjustmentError(error.message)
        setGoalieAdjustmentStatus('error')
      })

    return () => {
      isCurrent = false
    }
  }, [team.abbreviation])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onLoadStats(team)
    }, 100)

    return () => window.clearTimeout(timeout)
  }, [onLoadStats, team])

  const handleSaveGoalieAdjustment = async (goalie, draft) => {
    const result = await saveGoalieAdjustment(
      team.abbreviation,
      goalie.nhlPlayerId,
      {
        activeOverride: null,
        note: draft.note,
        ratingAdjustment: Number(draft.ratingAdjustment),
      },
    )

    setGoalieAdjustments((currentAdjustments) => {
      const remaining = currentAdjustments.filter(
        (adjustment) =>
          Number(adjustment.nhlPlayerId) !== goalie.nhlPlayerId,
      )

      return result.adjustment
        ? [...remaining, result.adjustment]
        : remaining
    })
    setGoalieAdjustmentStatus('success')
    setGoalieAdjustmentError('')
  }

  const handleDeleteGoalieAdjustment = async (goalie) => {
    await deleteGoalieAdjustment(team.abbreviation, goalie.nhlPlayerId)
    setGoalieAdjustments((currentAdjustments) =>
      currentAdjustments.filter(
        (adjustment) =>
          Number(adjustment.nhlPlayerId) !== goalie.nhlPlayerId,
      ),
    )
    setGoalieAdjustmentStatus('success')
    setGoalieAdjustmentError('')
  }

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

  const handleManageGoalies = useCallback(async () => {
    await onLoadRoster(team)
    setExpandedRosterSections((currentSections) => ({
      ...currentSections,
      goalies: true,
    }))
    window.setTimeout(() => {
      const goalieSection = document.getElementById('team-goalies-section')

      goalieSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      goalieSection
        ?.querySelector('.goalie-adjustment-edit-button')
        ?.focus()
    }, 0)
  }, [onLoadRoster, setExpandedRosterSections, team])

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
        provider={statsProvider}
      />

      <TeamModelValues
        goalieAdjustments={goalieAdjustments}
        goalieAdjustmentStatus={goalieAdjustmentStatus}
        onManageGoalies={handleManageGoalies}
        onRequestRoster={() => onLoadRoster(team)}
        roster={roster}
        rosterStatus={rosterStatus}
        team={team}
      />

      <div ref={rosterBoundaryRef}>
        {rosterStatus === 'idle' ? (
          <p className="roster-lazy-state">
            Current roster loads as this section approaches.
          </p>
        ) : null}

        {rosterStatus === 'loading' ? <RosterLoadingState /> : null}

        {rosterStatus === 'error' ? (
          <div className="ratings-state error" role="alert">
            <strong>Current roster temporarily unavailable.</strong>
            <p>{rosterError}</p>
            <button type="button" onClick={onRetryRoster}>
              Try again
            </button>
          </div>
        ) : null}

        {rosterReady ? (
          <div className="roster-sections">
            {rosterProvider?.stale ? (
              <p className="provider-stale-notice" role="status">
                Showing cached roster data.
              </p>
            ) : null}
            {rosterGroups.map((group) => (
              <RosterSection
                key={group.key}
                isExpanded={expandedRosterSections[group.key]}
                groupKey={group.key}
                label={group.label}
                players={
                  group.key === 'goalies'
                    ? sortedGoalies
                    : (roster[group.key] ?? [])
                }
                sectionRef={group.key === 'goalies'
                  ? goalieBoundaryRef
                  : undefined}
                expandedGoalieId={expandedGoalieId}
                goalieStatsByPlayerId={goalieStatsByPlayerId}
                goalieStatsErrorByPlayerId={goalieStatsErrorByPlayerId}
                goalieStatsStatusByPlayerId={goalieStatsStatusByPlayerId}
                goalieSummaryError={goalieSummaryError}
                goalieSummaryStatus={goalieSummaryStatus}
                goalieAdjustmentError={goalieAdjustmentError}
                goalieAdjustmentStatus={goalieAdjustmentStatus}
                maximumGoaliePenalty={maximumGoaliePenalty}
                onLoadGoalieStats={onLoadGoalieStats}
                onDeleteGoalieAdjustment={handleDeleteGoalieAdjustment}
                onSaveGoalieAdjustment={handleSaveGoalieAdjustment}
                onToggleSection={() =>
                  setExpandedRosterSections((currentSections) => ({
                    ...currentSections,
                    [group.key]: !currentSections[group.key],
                  }))
                }
                onToggleGoalie={handleToggleGoalie}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SpecialTeamsSection({ errorMessage, onRetry, provider, stats, status }) {
  return (
    <section className="special-teams-section" aria-label="Special Teams">
      <div className="special-teams-heading">
        <h3>Special Teams</h3>
      </div>

      {status === 'error' ? (
        <div className="special-teams-error" role="alert">
          <strong>Special Teams data temporarily unavailable.</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {provider?.stale ? (
            <p className="provider-stale-notice" role="status">
              Showing cached Special Teams data.
            </p>
          ) : null}
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
                const isLoading = status === 'idle' || status === 'loading'
                const powerPlayValue = isLoading
                  ? 'Loading'
                  : formatSpecialTeamsValue(
                      rowStats?.[row.powerPlayPercentageKey],
                      rowStats?.[row.powerPlayRankKey],
                    )
                const penaltyKillValue = isLoading
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
        </>
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

export function RosterSection({
  expandedGoalieId,
  goalieAdjustmentError,
  goalieAdjustmentStatus,
  goalieStatsByPlayerId,
  goalieStatsErrorByPlayerId,
  goalieStatsStatusByPlayerId,
  goalieSummaryError,
  goalieSummaryStatus,
  groupKey,
  isExpanded,
  label,
  maximumGoaliePenalty,
  onDeleteGoalieAdjustment,
  onLoadGoalieStats,
  onSaveGoalieAdjustment,
  onToggleSection,
  onToggleGoalie,
  players,
  sectionRef,
}) {
  const isGoalieSection = groupKey === 'goalies'
  const contentId = `team-${groupKey}-roster`

  return (
    <section
      aria-label={label}
      className="roster-section"
      id={isGoalieSection ? 'team-goalies-section' : undefined}
      ref={sectionRef}
    >
      <header className="roster-section-header">
        <h3>
          <button
            aria-controls={contentId}
            aria-expanded={isExpanded}
            className="roster-section-toggle"
            type="button"
            onClick={onToggleSection}
          >
            <span className="roster-section-label">{label}</span>
            <span className="roster-section-count">{players.length}</span>
            <ChevronDown
              aria-hidden="true"
              className="roster-section-chevron"
            />
          </button>
        </h3>
      </header>

      <div
        className="roster-section-content"
        hidden={!isExpanded}
        id={contentId}
      >
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
                  adjustmentErrorMessage={goalieAdjustmentError}
                  adjustmentStatus={goalieAdjustmentStatus}
                  maximumGoaliePenalty={maximumGoaliePenalty}
                  onDeleteAdjustment={onDeleteGoalieAdjustment}
                  onLoadGoalieStats={onLoadGoalieStats}
                  onSaveAdjustment={onSaveGoalieAdjustment}
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
      </div>
    </section>
  )
}

export function GoalieRow({
  adjustmentErrorMessage,
  adjustmentStatus,
  errorMessage,
  isExpanded,
  maximumGoaliePenalty = DEFAULT_MAXIMUM_GOALIE_PENALTY,
  onDeleteAdjustment,
  onLoadGoalieStats,
  onSaveAdjustment,
  onToggle,
  player,
  stats,
  summaryErrorMessage,
  summaryStatus,
  status,
}) {
  const [isEditingAdjustment, setIsEditingAdjustment] = useState(false)
  const [adjustmentDraft, setAdjustmentDraft] = useState(() => ({
    note: player.note ?? '',
    ratingAdjustment: Number(player.ratingAdjustment ?? 0).toFixed(2),
  }))
  const [adjustmentSaveStatus, setAdjustmentSaveStatus] = useState('idle')
  const [adjustmentMessage, setAdjustmentMessage] = useState('')
  const playerKey = String(player.id)
  const expandedContentId = `goalie-stats-${playerKey}`
  const effectiveStatus =
    status === 'idle' && summaryStatus !== 'idle' ? summaryStatus : status
  const quickStat = getGoalieQuickStat(stats, effectiveStatus)
  const effectiveErrorMessage = errorMessage || summaryErrorMessage
  const handleToggle = () => onToggle(player)
  const handleKeyDown = (event) => {
    if (event.target !== event.currentTarget) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle()
    }
  }
  const openAdjustmentEditor = (event) => {
    event.stopPropagation()
    setAdjustmentDraft({
      note: player.note ?? '',
      ratingAdjustment: Number(player.ratingAdjustment ?? 0).toFixed(2),
    })
    setAdjustmentMessage(
      validateGoalieAdjustmentValue(
        player.ratingAdjustment ?? 0,
        maximumGoaliePenalty,
      ),
    )
    setAdjustmentSaveStatus('idle')
    setIsEditingAdjustment(true)
  }
  const handleAdjustmentSave = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const validationMessage = validateGoalieAdjustmentValue(
      adjustmentDraft.ratingAdjustment,
      maximumGoaliePenalty,
    )

    if (validationMessage) {
      setAdjustmentSaveStatus('error')
      setAdjustmentMessage(validationMessage)
      return
    }

    const adjustment = Number(adjustmentDraft.ratingAdjustment)

    setAdjustmentSaveStatus('saving')
    setAdjustmentMessage('')

    try {
      if (adjustment === 0 && !adjustmentDraft.note.trim()) {
        await onDeleteAdjustment(player)
      } else {
        await onSaveAdjustment(player, {
          note: adjustmentDraft.note.trim(),
          ratingAdjustment: adjustment,
        })
      }

      setAdjustmentSaveStatus('success')
      setIsEditingAdjustment(false)
    } catch (error) {
      setAdjustmentSaveStatus('error')
      setAdjustmentMessage(error.message)
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
      onClick={(event) => {
        if (event.target.closest('button, input')) {
          return
        }

        handleToggle()
      }}
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
      <div className="goalie-rating-adjustment">
        <span>Adjustment</span>
        <strong>
          {Number(player.ratingAdjustment ?? 0) > 0 ? '+' : ''}
          {Number(player.ratingAdjustment ?? 0).toFixed(2)}
        </strong>
      </div>
      <button
        className="goalie-adjustment-edit-button"
        disabled={adjustmentStatus === 'loading'}
        type="button"
        onClick={openAdjustmentEditor}
      >
        Edit
      </button>
      <ChevronDown className="goalie-chevron" aria-hidden="true" />

      {isEditingAdjustment ? (
        <GoalieAdjustmentEditor
          draft={adjustmentDraft}
          errorMessage={adjustmentMessage || adjustmentErrorMessage}
          goalieName={player.fullName}
          isSaving={adjustmentSaveStatus === 'saving'}
          maximumGoaliePenalty={maximumGoaliePenalty}
          onCancel={(event) => {
            event.stopPropagation()
            setIsEditingAdjustment(false)
            setAdjustmentMessage('')
          }}
          onChange={(field, value) => {
            setAdjustmentMessage('')
            setAdjustmentDraft((currentDraft) => ({
              ...currentDraft,
              [field]: value,
            }))
          }}
          onSubmit={handleAdjustmentSave}
        />
      ) : null}

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

export function GoalieAdjustmentEditor({
  draft,
  errorMessage,
  goalieName,
  isSaving,
  maximumGoaliePenalty = DEFAULT_MAXIMUM_GOALIE_PENALTY,
  onCancel,
  onChange,
  onSubmit,
}) {
  const configuredMaximum = normalizeMaximumGoaliePenalty(
    maximumGoaliePenalty,
  )

  return (
    <form
      className="goalie-adjustment-editor"
      aria-label={`Edit ${goalieName} adjustment`}
      onClick={(event) => event.stopPropagation()}
      onSubmit={onSubmit}
    >
      <label className="field">
        <span>Goalie adjustment</span>
        <input
          inputMode="decimal"
          max="0"
          min={configuredMaximum}
          required
          step="0.05"
          type="number"
          value={draft.ratingAdjustment}
          onChange={(event) =>
            onChange('ratingAdjustment', event.target.value)
          }
        />
        <small>
          Relative to the team's normal #1 goalie. 0.00 = baseline.
        </small>
      </label>
      <label className="field">
        <span>Optional note</span>
        <input
          maxLength="300"
          type="text"
          value={draft.note}
          onChange={(event) => onChange('note', event.target.value)}
        />
      </label>
      <div className="goalie-adjustment-editor-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button disabled={isSaving} type="submit">
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="goalie-adjustment-scale" aria-label="Goalie adjustment guidance">
        <small>Guidance only</small>
        <dl>
          <div><dt>0.00</dt><dd>Normal #1 / baseline</dd></div>
          <div><dt>-0.25 to -0.75</dt><dd>Small downgrade</dd></div>
          <div><dt>-1.00 to -2.00</dt><dd>Clear downgrade</dd></div>
          <div><dt>-2.25 to -3.00</dt><dd>Major downgrade</dd></div>
        </dl>
        <p>
          Maximum allowed: <strong>{configuredMaximum.toFixed(2)}</strong>
        </p>
      </div>
      {errorMessage ? (
        <p className="field-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
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
