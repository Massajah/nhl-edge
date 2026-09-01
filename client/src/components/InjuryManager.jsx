import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import { DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY } from '../config/baseModel.js'
import {
  clearTeamInjuryHistory,
  createInjury,
  deleteInjury,
  fetchInjuries,
  updateInjury,
} from '../services/injuriesApi.js'
import { teamsDataCoordinator } from '../services/teamsDataCoordinator.js'
import {
  INJURY_DURATION_OPTIONS,
  INJURY_POSITION_OPTIONS,
  INJURY_STATUS_OPTIONS,
  buildClearHistoryConfirmation,
  filterInjuryRosterPlayers,
  formatInjuryImpact,
  getInjuryImpactOptions,
  getTeamInjurySummary,
  isStandardInjuryImpact,
  normalizeInjuries,
  normalizeInjuryRosterPlayers,
} from '../utils/injuries.js'

const sortOptions = [
  { value: 'impact', label: 'Largest impact' },
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'count', label: 'Active injury count' },
]

const filterOptions = [
  { value: 'all', label: 'All teams' },
  { value: 'active', label: 'Teams with active injuries' },
  { value: 'long-term', label: 'Long-term injuries' },
  { value: 'short-term', label: 'Short-term injuries' },
]

const INJURY_IMPACT_GUIDANCE = Object.freeze([
  { impact: 0, label: 'No meaningful downgrade / adequately replaceable' },
  { impact: -0.5, label: 'Small downgrade' },
  { impact: -1, label: 'Clear downgrade' },
  { impact: -1.5, label: 'Major absence / difficult to replace' },
  { impact: -2, label: 'Star-level absence' },
  {
    impact: -2.5,
    label: 'Maximum default individual penalty / exceptional elite absence',
  },
])

const emptyDraft = {
  playerSelection: '',
  playerName: '',
  providerPlayerId: null,
  position: '',
  status: 'out',
  impact: '0',
  durationType: 'unknown',
  injuryType: '',
  expectedReturn: '',
  notes: '',
  isGoalie: false,
}

const isCountingInjury = (injury) => injury.active && injury.status !== 'healthy'

const formatOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label ?? value

const getDraftFromInjury = (injury) =>
  injury
    ? {
        playerSelection: injury.providerPlayerId
          ? `provider:${injury.providerPlayerId}`
          : 'manual',
        playerName: injury.playerName,
        providerPlayerId: injury.providerPlayerId,
        position: injury.position,
        status: injury.status,
        impact: String(injury.impact),
        durationType: injury.durationType,
        injuryType: injury.injuryType,
        expectedReturn: injury.expectedReturn,
        notes: injury.notes,
        isGoalie: injury.isGoalie === true,
      }
    : emptyDraft

function InjuryManager({
  injurySummaries,
  maximumPlayerInjuryPenalty = DEFAULT_MAXIMUM_PLAYER_INJURY_PENALTY,
  onInjuriesChanged,
  summaryError,
  summaryStatus,
}) {
  const [injuries, setInjuries] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('impact')
  const [filter, setFilter] = useState('all')
  const [actionMessage, setActionMessage] = useState('')
  const [actionStatus, setActionStatus] = useState('idle')
  const [editorState, setEditorState] = useState(null)

  const applyInjuries = useCallback((nextInjuries) => {
    const normalizedInjuries = normalizeInjuries(nextInjuries)

    setInjuries(normalizedInjuries)
    setStatus('success')

    return normalizedInjuries
  }, [])

  const loadInjuries = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      applyInjuries(await fetchInjuries())
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [applyInjuries])

  useEffect(() => {
    let isCurrent = true

    const loadInitialInjuries = async () => {
      try {
        const nextInjuries = await fetchInjuries()

        if (!isCurrent) {
          return
        }

        applyInjuries(nextInjuries)
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    }

    loadInitialInjuries()

    return () => {
      isCurrent = false
    }
  }, [applyInjuries])

  const injuriesByTeamId = useMemo(
    () =>
      injuries.reduce((groupedInjuries, injury) => {
        groupedInjuries[injury.teamId] = groupedInjuries[injury.teamId] ?? []
        groupedInjuries[injury.teamId].push(injury)
        return groupedInjuries
      }, {}),
    [injuries],
  )

  const visibleTeams = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return NHL_TEAMS.map((team) => {
      const teamInjuries = injuriesByTeamId[team.id] ?? []
      const summary = getTeamInjurySummary(injurySummaries, team.id)

      return {
        ...team,
        injuries: teamInjuries,
        activeInjuries: summary.activeInjuries,
        totalImpact: summary.totalImpact,
      }
    })
      .filter((team) => {
        if (normalizedSearch) {
          const searchValues = [
            team.name,
            team.abbreviation,
            team.division,
            ...team.injuries.map((injury) => injury.playerName),
          ]

          if (
            !searchValues.some((value) =>
              value.toLowerCase().includes(normalizedSearch),
            )
          ) {
            return false
          }
        }

        if (filter === 'active') {
          return team.activeInjuries > 0
        }

        if (filter === 'long-term' || filter === 'short-term') {
          return team.injuries.some(
            (injury) =>
              isCountingInjury(injury) && injury.durationType === filter,
          )
        }

        return true
      })
      .sort((teamA, teamB) => {
        if (sortBy === 'alphabetical') {
          return teamA.name.localeCompare(teamB.name)
        }

        if (sortBy === 'count') {
          return (
            teamB.activeInjuries - teamA.activeInjuries ||
            teamA.name.localeCompare(teamB.name)
          )
        }

        return (
          teamA.totalImpact - teamB.totalImpact ||
          teamB.activeInjuries - teamA.activeInjuries ||
          teamA.name.localeCompare(teamB.name)
        )
      })
  }, [filter, injuriesByTeamId, injurySummaries, searchTerm, sortBy])

  const refreshAfterMutation = async () => {
    const nextInjuries = await fetchInjuries()

    applyInjuries(nextInjuries)
    await onInjuriesChanged()
  }

  const handleCreateInjury = async (team, payload) => {
    setActionStatus('saving')
    setActionMessage('')

    const activeDuplicate = injuries.find((injury) => {
      if (
        injury.teamId !== team.id ||
        !isCountingInjury(injury)
      ) {
        return false
      }

      return payload.providerPlayerId
        ? injury.providerPlayerId === payload.providerPlayerId
        : !injury.providerPlayerId &&
            injury.playerName.trim().toLowerCase() ===
              payload.playerName.trim().toLowerCase()
    })

    if (activeDuplicate) {
      setEditorState({ injury: activeDuplicate, mode: 'edit', team })
      setActionStatus('idle')
      setActionMessage(
        `${activeDuplicate.playerName} already has an active record. Opened it for editing.`,
      )
      return
    }

    try {
      await createInjury({
        ...payload,
        impact: Number(payload.impact),
        teamId: team.id,
      })
      await refreshAfterMutation()
      setEditorState(null)
      setActionStatus('success')
      setActionMessage(`Added ${payload.playerName}.`)
    } catch (error) {
      setActionStatus('error')
      setActionMessage(error.message)
      throw error
    }
  }

  const handleUpdateInjury = async (injuryId, updates) => {
    setActionStatus('saving')
    setActionMessage('')

    try {
      await updateInjury(injuryId, updates)
      await refreshAfterMutation()
      setEditorState(null)
      setActionStatus('success')
      setActionMessage('Injury updated.')
    } catch (error) {
      setActionStatus('error')
      setActionMessage(error.message)
      throw error
    }
  }

  const handleDeleteInjury = async (injury) => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        `Delete ${injury.playerName}'s injury record permanently?`,
      )

    if (!confirmed) {
      return
    }

    setActionStatus('saving')
    setActionMessage('')

    try {
      await deleteInjury(injury.id)
      await refreshAfterMutation()
      setEditorState(null)
      setActionStatus('success')
      setActionMessage('Injury deleted.')
    } catch (error) {
      setActionStatus('error')
      setActionMessage(error.message)
      throw error
    }
  }

  const handleClearHistory = async (team, recordCount) => {
    if (recordCount <= 0 || actionStatus === 'saving') {
      return
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        buildClearHistoryConfirmation(team.name, recordCount),
      )

    if (!confirmed) {
      return
    }

    setActionStatus('saving')
    setActionMessage('')

    try {
      const result = await clearTeamInjuryHistory(team.id)

      await refreshAfterMutation()
      setActionStatus('success')
      setActionMessage(
        `Cleared ${result.deletedCount} historical injury ${result.deletedCount === 1 ? 'record' : 'records'}.`,
      )
    } catch (error) {
      setActionStatus('error')
      setActionMessage(error.message)
    }
  }

  const handleMarkHealthy = async (injury) => {
    setActionStatus('saving')
    setActionMessage('')

    try {
      await updateInjury(injury.id, {
        active: false,
        status: 'healthy',
      })
      await refreshAfterMutation()
      setActionStatus('success')
      setActionMessage(
        `${injury.playerName} marked healthy and moved to history.`,
      )
    } catch (error) {
      setActionStatus('error')
      setActionMessage(error.message)
    }
  }

  return (
    <section className="injury-manager-page" aria-label="Injury Manager">
      <div className="injury-manager-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Injury Manager</p>
            <h2>Team Injury Impact</h2>
          </div>
          <span>
            {summaryStatus === 'success'
              ? `${injuries.length} player records`
              : 'Injury summary'}
          </span>
        </div>

        {summaryStatus === 'error' ? (
          <div className="ratings-state error" role="alert">
            <strong>Injury summary unavailable</strong>
            <p>{summaryError}</p>
            <button type="button" onClick={onInjuriesChanged}>
              Try again
            </button>
          </div>
        ) : null}

        <div className="injury-toolbar">
          <label className="field" htmlFor="injury-search">
            <span>Search teams or players</span>
            <input
              id="injury-search"
              type="search"
              value={searchTerm}
              placeholder="Team, abbreviation, division, player"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>

          <label className="field" htmlFor="injury-sort">
            <span>Sort by</span>
            <select
              id="injury-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field" htmlFor="injury-filter">
            <span>Filter</span>
            <select
              id="injury-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="injury-refresh-button"
            type="button"
            disabled={status === 'loading'}
            onClick={loadInjuries}
          >
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </button>
        </div>

        {actionMessage ? (
          <p className={`form-status ${actionStatus}`}>{actionMessage}</p>
        ) : null}

        {status === 'loading' ? <InjuryLoadingState /> : null}

        {status === 'error' ? (
          <div className="ratings-state error" role="alert">
            <strong>Injuries unavailable</strong>
            <p>{errorMessage}</p>
            <button type="button" onClick={loadInjuries}>
              Try again
            </button>
          </div>
        ) : null}

        {status === 'success' ? (
          <div className="injury-team-list">
            {visibleTeams.map((team) => (
              <TeamInjuryCard
                key={team.id}
                isSaving={actionStatus === 'saving'}
                onAdd={() =>
                  setEditorState({
                    mode: 'add',
                    team,
                  })
                }
                onEdit={(injury) =>
                  setEditorState({
                    injury,
                    mode: 'edit',
                    team,
                  })
                }
                onClearHistory={(recordCount) =>
                  handleClearHistory(team, recordCount)
                }
                onMarkHealthy={handleMarkHealthy}
                team={team}
              />
            ))}
          </div>
        ) : null}

        {status === 'success' && visibleTeams.length === 0 ? (
          <p className="empty-state">No teams match those filters.</p>
        ) : null}
      </div>

      {editorState ? (
        <InjuryEditorModal
          key={`${editorState.mode}-${editorState.injury?.id ?? editorState.team.id}`}
          actionStatus={actionStatus}
          injury={editorState.injury}
          maximumPlayerInjuryPenalty={maximumPlayerInjuryPenalty}
          mode={editorState.mode}
          onClose={() => setEditorState(null)}
          onDelete={handleDeleteInjury}
          onSave={(payload) =>
            editorState.mode === 'edit'
              ? handleUpdateInjury(editorState.injury.id, payload)
              : handleCreateInjury(editorState.team, payload)
          }
          team={editorState.team}
        />
      ) : null}
    </section>
  )
}

function InjuryLoadingState() {
  return (
    <div className="injury-team-list" aria-label="Loading injuries">
      {[0, 1, 2, 3].map((item) => (
        <div className="injury-team-card injury-team-card-loading" key={item}>
          <span />
          <strong />
          <div />
        </div>
      ))}
    </div>
  )
}

export function TeamInjuryCard({
  initialExpanded = false,
  initialShowHistory = false,
  isSaving = false,
  onAdd,
  onClearHistory,
  onEdit,
  onMarkHealthy,
  team,
}) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [showHistory, setShowHistory] = useState(initialShowHistory)
  const detailsId = useId()
  const activeInjuries = team.injuries.filter(isCountingInjury)
  const historicalInjuries = team.injuries.filter((injury) => !isCountingInjury(injury))
  const hasHistory = historicalInjuries.length > 0
  const showingHistory = showHistory && hasHistory
  const displayedInjuries = showingHistory ? team.injuries : activeInjuries
  const isHealthyTeam = team.totalImpact === 0 && team.activeInjuries === 0

  return (
    <article
      className={`injury-team-card ${
        isHealthyTeam ? 'healthy' : 'has-active-injuries'
      }${expanded ? ' expanded' : ''}`}
    >
      <button
        aria-controls={detailsId}
        className="injury-team-header"
        type="button"
        aria-expanded={expanded}
        title={`${expanded ? 'Collapse' : 'Expand'} ${team.name} injury details`}
        onClick={() => setExpanded((currentExpanded) => !currentExpanded)}
      >
        <TeamLogo team={team} />
        <div className="injury-team-copy">
          <strong>{team.name}</strong>
          <span>
            {team.abbreviation} / {team.division}
          </span>
        </div>
        <div className="injury-team-metrics" aria-label="Team injury summary">
          <div>
            <span>Impact</span>
            <strong>{formatInjuryImpact(team.totalImpact)}</strong>
          </div>
          <div>
            <span>Active</span>
            <strong>{team.activeInjuries}</strong>
          </div>
        </div>
        <span className="injury-expand-control" aria-hidden="true">
          {expanded ? (
            <ChevronUp className="injury-expand-chevron" size={18} />
          ) : (
            <ChevronDown className="injury-expand-chevron" size={18} />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="injury-team-body" id={detailsId}>
          <div className="injury-team-actions">
            <button type="button" disabled={isSaving} onClick={onAdd}>
              Add injured player
            </button>
            <div className="injury-history-controls">
              <label className="injury-history-toggle">
                <input
                  type="checkbox"
                  checked={showingHistory}
                  disabled={!hasHistory}
                  onChange={(event) => setShowHistory(event.target.checked)}
                />
                <span>Show history</span>
              </label>
              {showingHistory ? (
                <button
                  className="injury-clear-history-button"
                  type="button"
                  disabled={isSaving}
                  title={`Permanently delete ${historicalInjuries.length} historical injury ${historicalInjuries.length === 1 ? 'record' : 'records'}. Active injuries will not be affected.`}
                  onClick={() => onClearHistory(historicalInjuries.length)}
                >
                  Clear history
                </button>
              ) : null}
            </div>
          </div>

          {displayedInjuries.length > 0 ? (
            <div className="injury-player-table" role="table">
              <div className="injury-player-table-head" role="row">
                <span>Player</span>
                <span>Pos</span>
                <span>Status</span>
                <span>Duration</span>
                <span>Type</span>
                <span>Return</span>
                <span>Impact</span>
                <span>Actions</span>
              </div>
              <div className="injury-player-list">
                {displayedInjuries.map((injury) => (
                  <InjuryPlayerRow
                    injury={injury}
                    key={injury.id}
                    onEdit={() => onEdit(injury)}
                    onMarkHealthy={() => onMarkHealthy(injury)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">
              {showHistory
                ? 'No injury records for this team.'
                : 'No active injuries for this team.'}
            </p>
          )}
        </div>
      ) : null}
    </article>
  )
}

function InjuryPlayerRow({ injury, onEdit, onMarkHealthy }) {
  const isActive = isCountingInjury(injury)
  const hasNotes = Boolean(injury.notes?.trim())

  return (
    <div
      className={`injury-player-row ${isActive ? 'active' : 'inactive'}`}
      role="row"
    >
      <div className="injury-player-main" role="cell">
        <strong>{injury.playerName}</strong>
        {hasNotes ? (
          <span
            className="injury-note-icon"
            aria-label="Notes attached"
            title="This record has a note"
          >
            Note
          </span>
        ) : null}
      </div>
      <span className="injury-position-value" role="cell">
        {injury.position || 'Unknown'}
      </span>
      <span role="cell">
        {formatOptionLabel(INJURY_STATUS_OPTIONS, injury.status)}
      </span>
      <span role="cell">
        {formatOptionLabel(INJURY_DURATION_OPTIONS, injury.durationType)}
      </span>
      <span role="cell">{injury.injuryType || 'None'}</span>
      <span role="cell">{injury.expectedReturn || 'TBD'}</span>
      <strong className="injury-impact-value" role="cell">
        {formatInjuryImpact(injury.isGoalie ? 0 : injury.impact)}
        {injury.isGoalie ? <small>Excluded from model</small> : null}
      </strong>
      <div className="injury-row-actions" role="cell">
        <button
          type="button"
          title="Edit this injury record."
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={!isActive}
          title="Mark healthy removes this impact from active totals and keeps the record in history."
          onClick={onMarkHealthy}
        >
          Mark healthy
        </button>
      </div>
    </div>
  )
}

export function InjuryEditorModal({
  actionStatus,
  initialComboboxOpen = false,
  initialGuidanceExpanded = false,
  initialRoster = null,
  injury,
  maximumPlayerInjuryPenalty,
  mode,
  onClose,
  onDelete,
  onSave,
  team,
}) {
  const [draft, setDraft] = useState(() => getDraftFromInjury(injury))
  const [guidanceExpanded, setGuidanceExpanded] = useState(
    initialGuidanceExpanded,
  )
  const [showNotes, setShowNotes] = useState(() => Boolean(injury?.notes?.trim()))
  const [errorMessage, setErrorMessage] = useState('')
  const [rosterSearch, setRosterSearch] = useState(() =>
    injury
      ? injury.providerPlayerId
        ? injury.playerName
        : 'Other / Unlisted player'
      : '',
  )
  const [comboboxOpen, setComboboxOpen] = useState(initialComboboxOpen)
  const [activeOptionIndex, setActiveOptionIndex] = useState(0)
  const [comboboxSearchDirty, setComboboxSearchDirty] = useState(false)
  const comboboxRef = useRef(null)
  const comboboxInputRef = useRef(null)
  const [rosterState, setRosterState] = useState(() => ({
    error: '',
    players: initialRoster ? normalizeInjuryRosterPlayers(initialRoster) : [],
    status: initialRoster ? 'success' : 'loading',
  }))
  const isEditing = mode === 'edit'
  const isSaving = actionStatus === 'saving'
  const isManualPlayer = draft.playerSelection === 'manual'
  const isGoalie = draft.position === 'G' || draft.isGoalie === true
  const impactOptions = useMemo(
    () => getInjuryImpactOptions(maximumPlayerInjuryPenalty),
    [maximumPlayerInjuryPenalty],
  )
  const visibleRosterPlayers = useMemo(
    () => filterInjuryRosterPlayers(rosterState.players, rosterSearch),
    [rosterSearch, rosterState.players],
  )
  const selectedRosterPlayer = rosterState.players.find(
    (player) => player.id === draft.providerPlayerId,
  )
  const hasMissingSavedPlayer = Boolean(
    draft.providerPlayerId && !selectedRosterPlayer,
  )
  const savedSnapshotPlayer = hasMissingSavedPlayer
    ? {
        fullName: draft.playerName,
        id: draft.providerPlayerId,
        position: draft.position,
        sweaterNumber: '',
      }
    : null
  const visibleSavedSnapshot = savedSnapshotPlayer &&
    filterInjuryRosterPlayers([savedSnapshotPlayer], rosterSearch).length > 0
      ? savedSnapshotPlayer
      : null
  const comboboxOptions = [
    ...visibleRosterPlayers.map((player) => ({
      player,
      selection: `provider:${player.id}`,
      type: 'roster',
    })),
    ...(visibleSavedSnapshot
      ? [
          {
            player: visibleSavedSnapshot,
            selection: `provider:${visibleSavedSnapshot.id}`,
            type: 'snapshot',
          },
        ]
      : []),
    { selection: 'manual', type: 'manual' },
  ]
  const currentImpact = Number(draft.impact)
  const hasLegacyImpact = Boolean(
    isEditing &&
      !isGoalie &&
      Number.isFinite(currentImpact) &&
      !isStandardInjuryImpact(
        currentImpact,
        maximumPlayerInjuryPenalty,
      ),
  )

  useEffect(() => {
    let isCurrent = true

    teamsDataCoordinator
      .loadRoster(team.abbreviation)
      .then((result) => {
        if (!isCurrent) {
          return
        }

        setRosterState({
          error: '',
          players: normalizeInjuryRosterPlayers(result?.data),
          status: 'success',
        })
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setRosterState({
          error: error.message,
          players: [],
          status: 'error',
        })
      })

    return () => {
      isCurrent = false
    }
  }, [team.abbreviation])

  const handleDraftChange = (field, value) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setErrorMessage('')
  }

  const handlePlayerSelectionChange = (selection, selectedPlayer = null) => {
    if (selection === 'manual') {
      setDraft((currentDraft) => ({
        ...currentDraft,
        isGoalie: currentDraft.position === 'G',
        playerSelection: 'manual',
        providerPlayerId: null,
      }))
      setErrorMessage('')
      return
    }

    const providerPlayerId = Number(selection.replace('provider:', ''))
    const player =
      selectedPlayer ??
      rosterState.players.find(
        (rosterPlayer) => rosterPlayer.id === providerPlayerId,
      )

    if (!player) {
      return
    }

    const goalie = player.position === 'G'
    setDraft((currentDraft) => ({
      ...currentDraft,
      impact: goalie ? '0' : currentDraft.impact,
      isGoalie: goalie,
      playerName: player.fullName,
      playerSelection: selection,
      position: player.position,
      providerPlayerId: player.id,
    }))
    setErrorMessage('')
  }

  const getSelectedComboboxLabel = () => {
    if (draft.playerSelection === 'manual') {
      return 'Other / Unlisted player'
    }

    return draft.playerSelection ? draft.playerName : ''
  }

  const selectComboboxOption = (option) => {
    if (!option) {
      return
    }

    if (option.type === 'manual') {
      handlePlayerSelectionChange('manual')
      setRosterSearch('Other / Unlisted player')
    } else {
      handlePlayerSelectionChange(option.selection, option.player)
      setRosterSearch(option.player.fullName)
    }

    setComboboxOpen(false)
    setActiveOptionIndex(0)
    setComboboxSearchDirty(false)
  }

  const handleComboboxFocus = () => {
    setComboboxOpen(true)
    setActiveOptionIndex(0)

    if (draft.playerSelection && !comboboxSearchDirty) {
      setRosterSearch('')
    }
  }

  const handleComboboxBlur = (event) => {
    if (comboboxRef.current?.contains(event.relatedTarget)) {
      return
    }

    setComboboxOpen(false)
    if (!comboboxSearchDirty) {
      setRosterSearch(getSelectedComboboxLabel())
    }
  }

  const handleComboboxInputChange = (value) => {
    setRosterSearch(value)
    setComboboxOpen(true)
    setActiveOptionIndex(0)
    setComboboxSearchDirty(true)
    setErrorMessage('')
  }

  const handleComboboxKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setComboboxOpen(false)
      setRosterSearch(getSelectedComboboxLabel())
      setComboboxSearchDirty(false)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()

      if (!comboboxOpen) {
        setComboboxOpen(true)
        setRosterSearch('')
        setActiveOptionIndex(
          event.key === 'ArrowDown' ? 0 : comboboxOptions.length - 1,
        )
        return
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveOptionIndex((currentIndex) => {
        const optionCount = comboboxOptions.length

        if (optionCount === 0) {
          return 0
        }

        return (currentIndex + direction + optionCount) % optionCount
      })
      return
    }

    if (event.key === 'Enter' && comboboxOpen) {
      event.preventDefault()
      selectComboboxOption(
        comboboxOptions[Math.min(activeOptionIndex, comboboxOptions.length - 1)],
      )
    }
  }

  const handleManualPositionChange = (position) => {
    const goalie = position === 'G'

    setDraft((currentDraft) => ({
      ...currentDraft,
      impact: goalie ? '0' : currentDraft.impact,
      isGoalie: goalie,
      position,
    }))
    setErrorMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!draft.playerSelection) {
      setErrorMessage('Select a roster player or Other / Unlisted player.')
      return
    }

    if (comboboxSearchDirty) {
      setErrorMessage('Choose a player from the filtered results before saving.')
      return
    }

    if (isManualPlayer && !draft.playerName.trim()) {
      setErrorMessage('Player name is required.')
      return
    }

    const impact = isGoalie ? 0 : Number(draft.impact)

    if (!Number.isFinite(impact)) {
      setErrorMessage('Impact must be a number.')
      return
    }

    const unchangedLegacyImpact =
      isEditing && impact === Number(injury?.impact) && hasLegacyImpact

    if (
      !isGoalie &&
      !unchangedLegacyImpact &&
      !isStandardInjuryImpact(impact, maximumPlayerInjuryPenalty)
    ) {
      setErrorMessage(
        `Injury adjustment must use 0.50-point increments from ${Number(maximumPlayerInjuryPenalty).toFixed(2)} through 0.00.`,
      )
      return
    }

    try {
      const payloadDraft = { ...draft }
      delete payloadDraft.playerSelection

      await onSave({
        ...payloadDraft,
        active: draft.status !== 'healthy',
        impact,
        isGoalie,
        notes: showNotes ? draft.notes : '',
      })
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete(injury)
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  return (
    <div className="injury-modal-backdrop" role="presentation">
      <div
        className="injury-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="injury-editor-title"
      >
        <form onSubmit={handleSubmit}>
          <div className="injury-modal-header">
            <div>
              <p className="eyebrow">{isEditing ? 'Edit Injury' : 'Add Injury'}</p>
              <h3 id="injury-editor-title">{team.name}</h3>
            </div>
            <button
              aria-label="Close injury editor"
              className="injury-modal-close"
              type="button"
              title="Close injury editor"
              onClick={onClose}
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>

          <div className="injury-modal-grid">
            <div className="field injury-player-combobox-field">
              <label htmlFor="injury-player-combobox">Player</label>
              <div className="injury-player-combobox" ref={comboboxRef}>
                <input
                  aria-activedescendant={
                    comboboxOpen
                      ? `injury-player-option-${activeOptionIndex}`
                      : undefined
                  }
                  aria-autocomplete="list"
                  aria-controls="injury-player-options"
                  aria-expanded={comboboxOpen}
                  aria-haspopup="listbox"
                  autoComplete="off"
                  id="injury-player-combobox"
                  placeholder="Search or select player..."
                  ref={comboboxInputRef}
                  role="combobox"
                  type="text"
                  value={rosterSearch}
                  onBlur={handleComboboxBlur}
                  onClick={handleComboboxFocus}
                  onChange={(event) =>
                    handleComboboxInputChange(event.target.value)
                  }
                  onFocus={handleComboboxFocus}
                  onKeyDown={handleComboboxKeyDown}
                />

                {comboboxOpen ? (
                  <div
                    className="injury-player-combobox-menu"
                    id="injury-player-options"
                    role="listbox"
                  >
                    {rosterState.status === 'loading' ? (
                      <div className="injury-player-combobox-state" role="status">
                        Loading current roster...
                      </div>
                    ) : null}

                    {rosterState.status === 'success' &&
                    visibleRosterPlayers.length === 0 &&
                    !visibleSavedSnapshot ? (
                      <div className="injury-player-combobox-state">
                        No roster players found
                      </div>
                    ) : null}

                    {rosterState.status === 'error' ? (
                      <div className="injury-player-combobox-state error">
                        Roster unavailable
                      </div>
                    ) : null}

                    {comboboxOptions.map((option, optionIndex) => {
                      const isManual = option.type === 'manual'
                      const isActiveOption = optionIndex === activeOptionIndex
                      const isSelected =
                        option.selection === draft.playerSelection

                      return (
                        <button
                          aria-selected={isSelected}
                          className={`injury-player-combobox-option${
                            isActiveOption ? ' active' : ''
                          }${isManual ? ' manual' : ''}`}
                          id={`injury-player-option-${optionIndex}`}
                          key={option.selection}
                          role="option"
                          type="button"
                          onClick={() => selectComboboxOption(option)}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveOptionIndex(optionIndex)}
                        >
                          {isManual ? (
                            <strong>Other / Unlisted player</strong>
                          ) : (
                            <>
                              <strong>{option.player.fullName}</strong>
                              <span>
                                {option.player.position || 'Unknown position'}
                                {option.player.sweaterNumber
                                  ? ` · #${option.player.sweaterNumber}`
                                  : ''}
                                {option.type === 'snapshot'
                                  ? ' · saved snapshot'
                                  : ''}
                              </span>
                            </>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
              <small>
                Search by player name, position, or jersey number.{' '}
                {rosterState.status === 'error'
                  ? 'Other / Unlisted player remains available.'
                  : `${rosterState.players.length} current roster players.`}
              </small>
            </div>

            {isManualPlayer ? (
              <label className="field">
                <span>Manual player name</span>
                <input
                  required
                  type="text"
                  value={draft.playerName}
                  onChange={(event) =>
                    handleDraftChange('playerName', event.target.value)
                  }
                />
              </label>
            ) : null}

            {isManualPlayer ? (
              <label className="field">
                <span>Position (optional)</span>
                <select
                  value={draft.position}
                  onChange={(event) =>
                    handleManualPositionChange(event.target.value)
                  }
                >
                  {INJURY_POSITION_OPTIONS.map((option) => (
                    <option key={option.value || 'unknown'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : draft.playerSelection ? (
              <div className="injury-selected-player" aria-label="Selected player identity">
                <span>Selected player</span>
                <strong>{draft.playerName}</strong>
                <small>
                  {draft.position || 'Unknown position'} · Provider ID {draft.providerPlayerId}
                </small>
              </div>
            ) : null}

            <label className="field">
              <span>Status</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  handleDraftChange('status', event.target.value)
                }
              >
                {INJURY_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Injury adjustment</span>
              <select
                disabled={isGoalie}
                value={draft.impact}
                onChange={(event) =>
                  handleDraftChange('impact', event.target.value)
                }
              >
                {hasLegacyImpact ? (
                  <option value={draft.impact}>
                    {Number(draft.impact).toFixed(2)} · current saved legacy value
                  </option>
                ) : null}
                {impactOptions.map((impact) => (
                  <option key={impact} value={String(impact)}>
                    {impact.toFixed(2)}
                  </option>
                ))}
              </select>
              <small>
                Single-skater range: {Number(maximumPlayerInjuryPenalty).toFixed(2)} to 0.00
              </small>
            </label>

            <label className="field">
              <span>Duration</span>
              <select
                value={draft.durationType}
                onChange={(event) =>
                  handleDraftChange('durationType', event.target.value)
                }
              >
                {INJURY_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Injury type</span>
              <input
                type="text"
                value={draft.injuryType}
                onChange={(event) =>
                  handleDraftChange('injuryType', event.target.value)
                }
              />
            </label>

            <label className="field">
              <span>Expected return</span>
              <input
                type="text"
                value={draft.expectedReturn}
                onChange={(event) =>
                  handleDraftChange('expectedReturn', event.target.value)
                }
              />
            </label>
          </div>

          {isGoalie ? (
            <div className="injury-goalie-notice" role="note">
              <strong>Goalie availability / reference-only</strong>
              <span>
                Goalie availability is tracked for reference only. Goalie
                performance impact is handled through Starting Goalies in Game
                Analyzer.
              </span>
            </div>
          ) : null}

          <details
            className="injury-impact-guidance"
            aria-label="Injury adjustment guidance"
            open={guidanceExpanded}
            onToggle={(event) =>
              setGuidanceExpanded(event.currentTarget.open)
            }
          >
            <summary>
              <ChevronDown
                aria-hidden="true"
                className="injury-guidance-chevron"
                size={17}
              />
              <span>
                <strong>Injury adjustment guidance</strong>
                <small>Guidance only · judgment anchors</small>
              </span>
            </summary>
            <div className="injury-impact-guidance-content">
              <p>These are judgment anchors, not mandatory player tiers.</p>
              <dl>
                {INJURY_IMPACT_GUIDANCE.map((item) => (
                  <div key={item.impact}>
                    <dt>{item.impact.toFixed(2)}</dt>
                    <dd>{item.label}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Consider the replacement player and current team depth. The same
                roster role can have different impact on different teams.
              </p>
              <p>
                Use Game injury adjustment in Analyzer for cumulative lineup
                effects not fully captured by individual player records.
              </p>
            </div>
          </details>

          <div className="injury-note-control">
            <button
              type="button"
              onClick={() => setShowNotes((currentShowNotes) => !currentShowNotes)}
            >
              {draft.notes.trim() ? 'Edit note' : 'Add note'}
            </button>
            <span>Notes are optional and stay hidden when unused.</span>
          </div>

          {showNotes ? (
            <label className="field injury-modal-notes">
              <span>Notes</span>
              <textarea
                value={draft.notes}
                onChange={(event) =>
                  handleDraftChange('notes', event.target.value)
                }
              />
            </label>
          ) : null}

          <p className="injury-action-help">
            {isEditing
              ? 'Save updates this record. Mark healthy removes active impact but keeps history; Delete permanently removes the record.'
              : 'Save creates this injury record for the selected team.'}
          </p>

          {errorMessage ? (
            <p className="form-status error">{errorMessage}</p>
          ) : null}

          <div className="injury-modal-actions">
            {isEditing ? (
              <button
                className="delete-bet-button"
                type="button"
                title="Delete permanently removes this record."
                onClick={handleDelete}
                disabled={isSaving}
              >
                Delete
              </button>
            ) : null}
            <button type="button" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              className="save-ratings-button"
              type="submit"
              title="Save updates the injury record."
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TeamLogo({ team }) {
  const [hasLogoError, setHasLogoError] = useState(false)
  const logo = getTeamMetadata(team.abbreviation).logo
  const showLogo = logo && !hasLogoError

  return (
    <div className="team-rating-logo" aria-hidden="true">
      {showLogo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          onError={() => setHasLogoError(true)}
        />
      ) : (
        <span>{team.abbreviation}</span>
      )}
    </div>
  )
}

export default InjuryManager
