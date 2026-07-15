import { useCallback, useEffect, useMemo, useState } from 'react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import {
  createInjury,
  deleteInjury,
  fetchInjuries,
  updateInjury,
} from '../services/injuriesApi.js'
import {
  INJURY_DURATION_OPTIONS,
  INJURY_STATUS_OPTIONS,
  formatInjuryImpact,
  getTeamInjurySummary,
  normalizeInjuries,
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

const emptyDraft = {
  playerName: '',
  status: 'out',
  impact: '0',
  durationType: 'unknown',
  injuryType: '',
  expectedReturn: '',
  notes: '',
}

const isCountingInjury = (injury) => injury.active && injury.status !== 'healthy'

const formatOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label ?? value

const getDraftFromInjury = (injury) =>
  injury
    ? {
        playerName: injury.playerName,
        status: injury.status,
        impact: String(injury.impact),
        durationType: injury.durationType,
        injuryType: injury.injuryType,
        expectedReturn: injury.expectedReturn,
        notes: injury.notes,
      }
    : emptyDraft

function InjuryManager({
  injurySummaries,
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

          <button type="button" onClick={loadInjuries}>
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
          actionStatus={actionStatus}
          injury={editorState.injury}
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

function TeamInjuryCard({ onAdd, onEdit, onMarkHealthy, team }) {
  const [expanded, setExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const activeInjuries = team.injuries.filter(isCountingInjury)
  const historicalInjuries = team.injuries.filter((injury) => !isCountingInjury(injury))
  const displayedInjuries = showHistory ? team.injuries : activeInjuries
  const hasHistory = historicalInjuries.length > 0

  return (
    <article className={`injury-team-card ${expanded ? 'expanded' : ''}`}>
      <button
        className="injury-team-header"
        type="button"
        aria-expanded={expanded}
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
        <span className="injury-expand-control">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {expanded ? (
        <div className="injury-team-body">
          <div className="injury-team-actions">
            <button type="button" onClick={onAdd}>
              Add injured player
            </button>
            <label className="injury-history-toggle">
              <input
                type="checkbox"
                checked={showHistory}
                disabled={!hasHistory}
                onChange={(event) => setShowHistory(event.target.checked)}
              />
              <span>Show history</span>
            </label>
          </div>

          {displayedInjuries.length > 0 ? (
            <div className="injury-player-table" role="table">
              <div className="injury-player-table-head" role="row">
                <span>Player</span>
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
      <span role="cell">
        {formatOptionLabel(INJURY_STATUS_OPTIONS, injury.status)}
      </span>
      <span role="cell">
        {formatOptionLabel(INJURY_DURATION_OPTIONS, injury.durationType)}
      </span>
      <span role="cell">{injury.injuryType || 'None'}</span>
      <span role="cell">{injury.expectedReturn || 'TBD'}</span>
      <strong className="injury-impact-value" role="cell">
        {formatInjuryImpact(injury.impact)}
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

function InjuryEditorModal({
  actionStatus,
  injury,
  mode,
  onClose,
  onDelete,
  onSave,
  team,
}) {
  const [draft, setDraft] = useState(() => getDraftFromInjury(injury))
  const [showNotes, setShowNotes] = useState(() => Boolean(injury?.notes?.trim()))
  const [errorMessage, setErrorMessage] = useState('')
  const isEditing = mode === 'edit'
  const isSaving = actionStatus === 'saving'

  const handleDraftChange = (field, value) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setErrorMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!draft.playerName.trim()) {
      setErrorMessage('Player name is required.')
      return
    }

    const impact = Number(draft.impact)

    if (!Number.isFinite(impact)) {
      setErrorMessage('Impact must be a number.')
      return
    }

    if (impact > 0) {
      setErrorMessage('Impact cannot be positive.')
      return
    }

    try {
      await onSave({
        ...draft,
        active: draft.status !== 'healthy',
        impact,
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
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>

          <div className="injury-modal-grid">
            <label className="field">
              <span>Player name</span>
              <input
                type="text"
                value={draft.playerName}
                onChange={(event) =>
                  handleDraftChange('playerName', event.target.value)
                }
              />
            </label>

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
              <span>Impact</span>
              <input
                type="number"
                max="0"
                step="0.1"
                value={draft.impact}
                inputMode="decimal"
                onChange={(event) =>
                  handleDraftChange('impact', event.target.value)
                }
              />
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
            Save updates the injury record. Mark healthy removes active impact
            but keeps history. Delete permanently removes the record.
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
