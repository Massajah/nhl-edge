import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  clearTeamLines,
  fetchTeamModelValues,
  saveTeamLines,
} from '../services/teamsApi.js'
import {
  DEFENSE_SLOT_FIELDS,
  FORWARD_SLOT_FIELDS,
  LINEUP_NOTE_MAX_LENGTH,
  formatModelValuesUpdatedDate,
  formatPlayerOption,
  getConfiguredDefensePairs,
  getConfiguredForwardLines,
  getDuplicatePlayerIds,
  getPlayerDisplayName,
  getRosterPlayer,
  getTeamModelValuesPayload,
  normalizeTeamModelValues,
} from '../utils/teamModelValues.js'

const forwardPositionFields = [
  { field: 'leftWingPlayerId', label: 'LW' },
  { field: 'centerPlayerId', label: 'C' },
  { field: 'rightWingPlayerId', label: 'RW' },
]
const defensePositionFields = [
  { field: 'leftDefensePlayerId', label: 'LD' },
  { field: 'rightDefensePlayerId', label: 'RD' },
]

const formatAdjustment = (value) => {
  const numericValue = Number(value ?? 0)
  const adjustment = Number.isFinite(numericValue) ? numericValue : 0

  return `${adjustment > 0 ? '+' : ''}${adjustment.toFixed(2)}`
}

const hasAnyLineupValue = (modelValues) =>
  getConfiguredForwardLines(modelValues).length > 0 ||
  getConfiguredDefensePairs(modelValues).length > 0 ||
  Boolean(modelValues?.lineupNote?.trim())

const getDuplicateNames = (rows, slotFields, players) =>
  getDuplicatePlayerIds(rows, slotFields).map((playerId) =>
    getPlayerDisplayName(players, playerId),
  )

function SummaryLine({ label, playerIds, players }) {
  const hasConfiguredPlayer = playerIds.some(Boolean)
  const playerNames = playerIds.map((playerId) =>
    playerId ? getPlayerDisplayName(players, playerId) : '—',
  )

  return (
    <li>
      <strong>{label}</strong>
      <span>
        {hasConfiguredPlayer
          ? playerNames.join(' – ')
          : 'Not configured'}
      </span>
    </li>
  )
}

function SummaryLoadState({ loadStatus }) {
  if (loadStatus === 'loading') {
    return <p className="model-values-section-state">Loading</p>
  }

  if (loadStatus === 'error') {
    return <p className="model-values-section-state">Unavailable</p>
  }

  return null
}

export function ModelValuesCard({
  errorMessage,
  editorReady = true,
  feedbackMessage,
  goalieAdjustments = [],
  goalieAdjustmentStatus = 'idle',
  loadStatus = 'success',
  modelValues,
  onManageModelValues,
  onRetry,
  roster,
}) {
  const normalized = normalizeTeamModelValues(modelValues)
  const updatedDate = formatModelValuesUpdatedDate(normalized.updatedAt)
  const editorDisabled = loadStatus !== 'success' || !editorReady

  return (
    <section className="model-values-card" aria-labelledby="model-values-title">
      <div className="model-values-heading">
        <div>
          <p className="eyebrow">User-maintained Model Values</p>
          <h3 id="model-values-title">Model Values</h3>
          <p>
            Optional personal lineup notes. Does not affect model calculations.
          </p>
        </div>
        <button
          className="model-values-manage-button"
          disabled={editorDisabled}
          type="button"
          onClick={onManageModelValues}
        >
          Manage Model Values
        </button>
      </div>

      {loadStatus === 'error' ? (
        <div className="model-values-error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}

      {feedbackMessage ? (
        <p className="model-values-feedback" role="status">
          {feedbackMessage}
        </p>
      ) : null}

      <div className="model-values-summary">
        <section className="model-values-summary-row">
          <div className="model-values-summary-copy">
            <strong>Goalie Adjustments</strong>
            <span>
              {goalieAdjustmentStatus === 'loading'
                ? 'Loading'
                : goalieAdjustmentStatus === 'error'
                  ? 'Unavailable'
                  : `${goalieAdjustments.length} configured`}
            </span>
            {goalieAdjustments.length > 0 ? (
              <ul className="model-values-preview-list goalie-preview-list">
                {goalieAdjustments.map((adjustment) => (
                  <li key={adjustment.nhlPlayerId}>
                    <span>
                      {adjustment.cachedDisplayName ||
                        `Goalie ID ${adjustment.nhlPlayerId}`}
                    </span>
                    <strong>{formatAdjustment(adjustment.ratingAdjustment)}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <div className="model-values-lineup-grid" aria-label="Saved lineup summary">
          <section className="model-values-summary-row model-values-forward-column">
            <div className="model-values-summary-copy">
              <div className="model-values-section-heading">
                <strong>Forward Lines</strong>
                {loadStatus === 'success' && updatedDate ? (
                  <span>Updated {updatedDate}</span>
                ) : null}
              </div>
              <SummaryLoadState loadStatus={loadStatus} />
              {loadStatus === 'success' ? (
                <ul className="model-values-preview-list">
                  {normalized.forwardLines.map((line) => (
                    <SummaryLine
                      key={line.lineNumber}
                      label={`L${line.lineNumber}`}
                      playerIds={FORWARD_SLOT_FIELDS.map((field) => line[field])}
                      players={roster?.forwards ?? []}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <section className="model-values-summary-row model-values-defense-column">
            <div className="model-values-summary-copy">
              <div className="model-values-section-heading">
                <strong>Defense Pairs</strong>
                {loadStatus === 'success' && updatedDate ? (
                  <span>Updated {updatedDate}</span>
                ) : null}
              </div>
              <SummaryLoadState loadStatus={loadStatus} />
              {loadStatus === 'success' ? (
                <ul className="model-values-preview-list">
                  {normalized.defensePairs.map((pair) => (
                    <SummaryLine
                      key={pair.pairNumber}
                      label={`D${pair.pairNumber}`}
                      playerIds={DEFENSE_SLOT_FIELDS.map((field) => pair[field])}
                      players={roster?.defensemen ?? []}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </div>

        <section className="model-values-summary-row">
          <div className="model-values-summary-copy">
            <strong>Team Notes</strong>
            <SummaryLoadState loadStatus={loadStatus} />
            {loadStatus === 'success' ? (
              <p className="model-values-note-preview">
                {normalized.lineupNote.trim() || 'No notes'}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  )
}

function PlayerSelector({
  duplicatePlayerIds,
  field,
  id,
  label,
  onChange,
  players,
  rowNumber,
  selectRef,
  selectedPlayerId,
}) {
  const missingPlayer = selectedPlayerId &&
    !getRosterPlayer(players, selectedPlayerId)
  const hasDuplicate = duplicatePlayerIds.includes(Number(selectedPlayerId))

  return (
    <label className="lineup-player-field" htmlFor={id}>
      <span>{label}</span>
      <select
        aria-invalid={hasDuplicate || undefined}
        id={id}
        ref={selectRef}
        value={selectedPlayerId ?? ''}
        onChange={(event) => onChange(
          rowNumber,
          field,
          event.target.value ? Number(event.target.value) : null,
        )}
      >
        <option value="">Empty</option>
        {missingPlayer ? (
          <option value={selectedPlayerId}>
            {`Unavailable player · ID ${selectedPlayerId}`}
          </option>
        ) : null}
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {formatPlayerOption(player)}
          </option>
        ))}
      </select>
    </label>
  )
}

function DuplicateWarning({ names, type }) {
  if (names.length === 0) {
    return null
  }

  return (
    <p className="lineup-duplicate-warning" role="status">
      Duplicate {type} selection: {names.join(', ')}. Saving is allowed, but
      review the repeated player.
    </p>
  )
}

export function LineupEditorModal({
  actionError,
  actionStatus,
  focusSection = 'lines',
  goalieAdjustments = [],
  goalieAdjustmentStatus = 'idle',
  initialValues,
  onCancel,
  onClear,
  onManageGoalies,
  onSave,
  roster,
  teamName,
}) {
  const [draft, setDraft] = useState(() =>
    normalizeTeamModelValues(initialValues),
  )
  const [localError, setLocalError] = useState('')
  const dialogRef = useRef(null)
  const firstSelectorRef = useRef(null)
  const noteRef = useRef(null)
  const initialPayload = useMemo(
    () => JSON.stringify(getTeamModelValuesPayload(initialValues)),
    [initialValues],
  )
  const draftPayload = getTeamModelValuesPayload(draft)
  const isDirty = JSON.stringify(draftPayload) !== initialPayload
  const isSaving = actionStatus === 'saving' || actionStatus === 'clearing'
  const forwardDuplicateIds = getDuplicatePlayerIds(
    draft.forwardLines,
    FORWARD_SLOT_FIELDS,
  )
  const defenseDuplicateIds = getDuplicatePlayerIds(
    draft.defensePairs,
    DEFENSE_SLOT_FIELDS,
  )
  const forwardDuplicateNames = getDuplicateNames(
    draft.forwardLines,
    FORWARD_SLOT_FIELDS,
    roster?.forwards ?? [],
  )
  const defenseDuplicateNames = getDuplicateNames(
    draft.defensePairs,
    DEFENSE_SLOT_FIELDS,
    roster?.defensemen ?? [],
  )

  useEffect(() => {
    const focusTarget = focusSection === 'note'
      ? noteRef.current
      : firstSelectorRef.current

    focusTarget?.focus()
  }, [focusSection])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!isDirty && !isSaving) {
          event.preventDefault()
          onCancel()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
      )

      if (!focusable?.length) {
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDirty, isSaving, onCancel])

  const updateRow = (collection, numberField, rowNumber, field, value) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [collection]: currentDraft[collection].map((row) =>
        row[numberField] === rowNumber ? { ...row, [field]: value } : row,
      ),
    }))
    setLocalError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (isSaving) {
      return
    }

    setLocalError('')

    try {
      await onSave(draftPayload)
    } catch (error) {
      setLocalError(error.message)
    }
  }

  const handleClear = async () => {
    const confirmed = window.confirm(
      'Clear all forward lines, defense pairs, and the lineup note?',
    )

    if (!confirmed || isSaving) {
      return
    }

    setLocalError('')

    try {
      await onClear()
    } catch (error) {
      setLocalError(error.message)
    }
  }

  return (
    <div className="lineup-modal-backdrop" role="presentation">
      <section
        aria-labelledby="lineup-editor-title"
        aria-modal="true"
        className="lineup-modal"
        ref={dialogRef}
        role="dialog"
      >
        <form onSubmit={handleSubmit}>
          <header className="lineup-modal-header">
            <div>
              <p className="eyebrow">User-maintained values</p>
              <h3 id="lineup-editor-title">
                Manage Model Values - {teamName}
              </h3>
              <p>Optional personal lineup notes. Does not affect model calculations.</p>
            </div>
            <button disabled={isSaving} type="button" onClick={onCancel}>
              Close
            </button>
          </header>

          <div className="lineup-modal-content">
            <section className="lineup-editor-section" aria-labelledby="forward-lines-title">
              <div className="lineup-editor-section-heading">
                <div>
                  <h4 id="forward-lines-title">Forward Lines</h4>
                  <p>Any current provider forward may fill LW, C, or RW.</p>
                </div>
              </div>

              <div className="lineup-rows">
                {draft.forwardLines.map((line, lineIndex) => (
                  <fieldset className="lineup-row" key={line.lineNumber}>
                    <legend>Line {line.lineNumber}</legend>
                    <div className="forward-line-grid">
                      {forwardPositionFields.map(({ field, label }, fieldIndex) => (
                        <PlayerSelector
                          key={field}
                          duplicatePlayerIds={forwardDuplicateIds}
                          field={field}
                          id={`forward-line-${line.lineNumber}-${field}`}
                          label={label}
                          onChange={(rowNumber, nextField, value) =>
                            updateRow(
                              'forwardLines',
                              'lineNumber',
                              rowNumber,
                              nextField,
                              value,
                            )
                          }
                          players={roster?.forwards ?? []}
                          rowNumber={line.lineNumber}
                          selectRef={lineIndex === 0 && fieldIndex === 0
                            ? firstSelectorRef
                            : undefined}
                          selectedPlayerId={line[field]}
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <DuplicateWarning names={forwardDuplicateNames} type="forward" />
            </section>

            <section className="lineup-editor-section" aria-labelledby="defense-pairs-title">
              <div className="lineup-editor-section-heading">
                <div>
                  <h4 id="defense-pairs-title">Defense Pairs</h4>
                  <p>Any current provider defenseman may fill LD or RD.</p>
                </div>
              </div>

              <div className="lineup-rows defense-lineup-rows">
                {draft.defensePairs.map((pair) => (
                  <fieldset className="lineup-row" key={pair.pairNumber}>
                    <legend>Pair {pair.pairNumber}</legend>
                    <div className="defense-pair-grid">
                      {defensePositionFields.map(({ field, label }) => (
                        <PlayerSelector
                          key={field}
                          duplicatePlayerIds={defenseDuplicateIds}
                          field={field}
                          id={`defense-pair-${pair.pairNumber}-${field}`}
                          label={label}
                          onChange={(rowNumber, nextField, value) =>
                            updateRow(
                              'defensePairs',
                              'pairNumber',
                              rowNumber,
                              nextField,
                              value,
                            )
                          }
                          players={roster?.defensemen ?? []}
                          rowNumber={pair.pairNumber}
                          selectedPlayerId={pair[field]}
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <DuplicateWarning names={defenseDuplicateNames} type="defense" />
            </section>

            <section className="lineup-editor-section lineup-note-section" aria-labelledby="lineup-note-title">
              <div className="lineup-editor-section-heading">
                <div>
                  <h4 id="lineup-note-title">Team Notes</h4>
                  <p>Personal team notes only. Plain text, optional.</p>
                </div>
              </div>
              <label className="field" htmlFor="team-lineup-note">
                <span>Personal lineup note</span>
                <textarea
                  id="team-lineup-note"
                  maxLength={LINEUP_NOTE_MAX_LENGTH}
                  ref={noteRef}
                  rows="5"
                  value={draft.lineupNote}
                  onChange={(event) => {
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      lineupNote: event.target.value,
                    }))
                    setLocalError('')
                  }}
                />
                <small>
                  {draft.lineupNote.length}/{LINEUP_NOTE_MAX_LENGTH} characters
                </small>
              </label>
            </section>

            <section
              aria-labelledby="lineup-goalie-adjustments-title"
              className="lineup-editor-section lineup-goalie-section"
            >
              <div className="lineup-editor-section-heading">
                <div>
                  <h4 id="lineup-goalie-adjustments-title">
                    Goalie Adjustments
                  </h4>
                  <p>
                    Managed separately in the existing provider goalie roster.
                  </p>
                </div>
              </div>

              <div className="lineup-goalie-summary">
                <strong>Configured goalies</strong>
                {goalieAdjustmentStatus === 'loading' ? (
                  <span>Loading</span>
                ) : goalieAdjustmentStatus === 'error' ? (
                  <span>Unavailable</span>
                ) : goalieAdjustments.length > 0 ? (
                  <ul>
                    {goalieAdjustments.map((adjustment) => (
                      <li key={adjustment.nhlPlayerId}>
                        <span>
                          {adjustment.cachedDisplayName ||
                            `Goalie ID ${adjustment.nhlPlayerId}`}
                        </span>
                        <strong>
                          {formatAdjustment(adjustment.ratingAdjustment)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>No goalie adjustments configured.</span>
                )}
              </div>

              <button
                className="lineup-manage-goalies-button"
                disabled={isSaving}
                type="button"
                onClick={onManageGoalies}
              >
                Manage Goalie Adjustments
              </button>
            </section>

            {localError || actionError ? (
              <p className="form-status error" role="alert">
                {localError || actionError}
              </p>
            ) : null}
          </div>

          <footer className="lineup-modal-actions">
            <button
              className="lineup-clear-button"
              disabled={isSaving || !hasAnyLineupValue(draft)}
              type="button"
              onClick={handleClear}
            >
              {actionStatus === 'clearing' ? 'Clearing...' : 'Clear Lineup'}
            </button>
            <button disabled={isSaving} type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="save-ratings-button"
              disabled={isSaving}
              type="submit"
            >
              {actionStatus === 'saving' ? 'Saving...' : 'Save Lines'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function TeamModelValues({
  goalieAdjustments,
  goalieAdjustmentStatus,
  onManageGoalies,
  roster,
  team,
}) {
  const [modelValues, setModelValues] = useState(() =>
    normalizeTeamModelValues({}, team.abbreviation),
  )
  const [loadStatus, setLoadStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [focusSection, setFocusSection] = useState('lines')
  const [actionStatus, setActionStatus] = useState('idle')
  const [actionError, setActionError] = useState('')
  const latestRequestRef = useRef(0)
  const returnFocusRef = useRef(null)

  const loadModelValues = useCallback(async () => {
    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    setLoadStatus('loading')
    setErrorMessage('')

    try {
      const result = await fetchTeamModelValues(team.abbreviation)

      if (latestRequestRef.current !== requestId) {
        return
      }

      setModelValues(
        normalizeTeamModelValues(result.modelValues, team.abbreviation),
      )
      setLoadStatus('success')
    } catch (error) {
      if (latestRequestRef.current !== requestId) {
        return
      }

      setErrorMessage(error.message)
      setLoadStatus('error')
    }
  }, [team.abbreviation])

  useEffect(() => {
    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId

    fetchTeamModelValues(team.abbreviation)
      .then((result) => {
        if (latestRequestRef.current !== requestId) {
          return
        }

        setModelValues(
          normalizeTeamModelValues(result.modelValues, team.abbreviation),
        )
        setLoadStatus('success')
      })
      .catch((error) => {
        if (latestRequestRef.current !== requestId) {
          return
        }

        setErrorMessage(error.message)
        setLoadStatus('error')
      })

    return () => {
      latestRequestRef.current += 1
    }
  }, [team.abbreviation])

  const closeEditor = useCallback(() => {
    setIsEditorOpen(false)
    setActionStatus('idle')
    setActionError('')
    window.setTimeout(() => returnFocusRef.current?.focus(), 0)
  }, [])

  const openEditor = (event) => {
    returnFocusRef.current = event.currentTarget
    setFocusSection('lines')
    setFeedbackMessage('')
    setActionError('')
    setActionStatus('idle')
    setIsEditorOpen(true)
  }

  const handleManageGoaliesFromEditor = () => {
    setIsEditorOpen(false)
    setActionStatus('idle')
    setActionError('')
    window.setTimeout(onManageGoalies, 0)
  }

  const handleSave = async (payload) => {
    if (actionStatus === 'saving' || actionStatus === 'clearing') {
      return
    }

    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    setActionStatus('saving')
    setActionError('')

    try {
      const result = await saveTeamLines(team.abbreviation, payload)

      if (latestRequestRef.current !== requestId) {
        return
      }

      setModelValues(
        normalizeTeamModelValues(result.modelValues, team.abbreviation),
      )
      setLoadStatus('success')
      setFeedbackMessage('Lines and personal note saved.')
      closeEditor()
    } catch (error) {
      if (latestRequestRef.current === requestId) {
        setActionStatus('error')
        setActionError(error.message)
      }
      throw error
    }
  }

  const handleClear = async () => {
    if (actionStatus === 'saving' || actionStatus === 'clearing') {
      return
    }

    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    setActionStatus('clearing')
    setActionError('')

    try {
      const result = await clearTeamLines(team.abbreviation)

      if (latestRequestRef.current !== requestId) {
        return
      }

      setModelValues(
        normalizeTeamModelValues(result.modelValues, team.abbreviation),
      )
      setLoadStatus('success')
      setFeedbackMessage('Lineup and personal note cleared.')
      closeEditor()
    } catch (error) {
      if (latestRequestRef.current === requestId) {
        setActionStatus('error')
        setActionError(error.message)
      }
      throw error
    }
  }

  return (
    <>
      <ModelValuesCard
        errorMessage={errorMessage}
        editorReady={Boolean(roster)}
        feedbackMessage={feedbackMessage}
        goalieAdjustments={goalieAdjustments}
        goalieAdjustmentStatus={goalieAdjustmentStatus}
        loadStatus={loadStatus}
        modelValues={modelValues}
        onManageModelValues={openEditor}
        onRetry={loadModelValues}
        roster={roster}
      />

      {isEditorOpen ? (
        <LineupEditorModal
          actionError={actionError}
          actionStatus={actionStatus}
          focusSection={focusSection}
          goalieAdjustments={goalieAdjustments}
          goalieAdjustmentStatus={goalieAdjustmentStatus}
          initialValues={modelValues}
          onCancel={closeEditor}
          onClear={handleClear}
          onManageGoalies={handleManageGoaliesFromEditor}
          onSave={handleSave}
          roster={roster}
          teamName={team.name}
        />
      ) : null}
    </>
  )
}

export default TeamModelValues
