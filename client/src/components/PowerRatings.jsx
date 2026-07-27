import { useMemo, useState } from 'react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import { getEffectiveBaseRating } from '../utils/powerRatings.js'

const sortOptions = [
  {
    value: 'highest',
    label: 'Highest rating first',
  },
  {
    value: 'lowest',
    label: 'Lowest rating first',
  },
  {
    value: 'alphabetical',
    label: 'Alphabetical',
  },
]

const ratingFields = [
  {
    key: 'baseRating',
    label: 'Rating',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'homeAdjustment',
    label: 'Home Adjustment',
    min: -5,
    max: 5,
    step: 0.1,
  },
  {
    key: 'manualAdjustment',
    label: 'Manual Adj.',
    min: -25,
    max: 25,
    step: 0.5,
  },
]

const formatRating = (value) => value.toFixed(1)
const formatBaseHomeAdvantage = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '--'

const createDraftRatings = (ratings) =>
  NHL_TEAMS.reduce((draftRatings, team) => {
    const rating = ratings[team.id] ?? {}

    draftRatings[team.id] = ratingFields.reduce((draftTeam, field) => {
      draftTeam[field.key] = String(rating[field.key] ?? '')
      return draftTeam
    }, {})

    return draftRatings
  }, {})

const parseDraftValue = (value) => {
  if (String(value).trim() === '') {
    return null
  }

  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

const pluralizeTeams = (count) => `${count} ${count === 1 ? 'team' : 'teams'}`

function PowerRatings({
  baseHomeAdvantage = 0,
  errorMessage,
  migrationAvailable,
  migrationMessage,
  migrationStatus,
  onImportLocalRatings,
  onReset,
  onRetry,
  onSave,
  ratings,
  ratingsCount,
  status,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('highest')
  const [draftRatings, setDraftRatings] = useState(() =>
    createDraftRatings(ratings),
  )
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [resetStatus, setResetStatus] = useState('idle')

  const ratedTeams = useMemo(
    () =>
      NHL_TEAMS.map((team) => {
        const rating = ratings[team.id]

        return {
          ...team,
          baseRating: rating.baseRating,
          effectiveRating: getEffectiveBaseRating(rating),
          homeAdjustment: rating.homeAdjustment,
          manualAdjustment: rating.manualAdjustment,
        }
      }),
    [ratings],
  )

  const draftSummary = useMemo(() => {
    const updates = {}
    const dirtyTeamIds = []
    const dirtyFields = new Set()
    const invalidTeamIds = []
    const invalidFields = new Set()

    NHL_TEAMS.forEach((team) => {
      const rating = ratings[team.id]
      const draftTeam = draftRatings[team.id] ?? {}
      const teamUpdate = {}
      let isDirty = false
      let isInvalid = false

      ratingFields.forEach((field) => {
        const parsedValue = parseDraftValue(draftTeam[field.key])

        if (parsedValue === null) {
          isInvalid = true
          invalidFields.add(`${team.id}-${field.key}`)
          return
        }

        if (parsedValue < field.min || parsedValue > field.max) {
          isInvalid = true
          invalidFields.add(`${team.id}-${field.key}`)
          return
        }

        teamUpdate[field.key] = parsedValue

        if (parsedValue !== rating[field.key]) {
          isDirty = true
          dirtyFields.add(`${team.id}-${field.key}`)
        }
      })

      if (isInvalid) {
        invalidTeamIds.push(team.id)
      }

      if (isDirty && !isInvalid) {
        dirtyTeamIds.push(team.id)
        updates[team.id] = teamUpdate
      }
    })

    return {
      dirtyFields,
      dirtyTeamIds,
      invalidFields,
      invalidTeamIds,
      updates,
    }
  }, [draftRatings, ratings])

  const summary = useMemo(() => {
    const highestTeam = ratedTeams.reduce((bestTeam, team) =>
      team.effectiveRating > bestTeam.effectiveRating ? team : bestTeam,
    )
    const lowestTeam = ratedTeams.reduce((worstTeam, team) =>
      team.effectiveRating < worstTeam.effectiveRating ? team : worstTeam,
    )
    const averageRating =
      ratedTeams.reduce((total, team) => total + team.effectiveRating, 0) /
      ratedTeams.length

    return {
      highestTeam,
      lowestTeam,
      averageRating,
    }
  }, [ratedTeams])

  const visibleTeams = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    const filteredTeams = normalizedSearch
      ? ratedTeams.filter((team) =>
          [team.name, team.abbreviation, team.division].some((value) =>
            value.toLowerCase().includes(normalizedSearch),
          ),
        )
      : ratedTeams

    return [...filteredTeams].sort((teamA, teamB) => {
      if (sortBy === 'alphabetical') {
        return teamA.name.localeCompare(teamB.name)
      }

      if (sortBy === 'lowest') {
        return teamA.effectiveRating - teamB.effectiveRating
      }

      return teamB.effectiveRating - teamA.effectiveRating
    })
  }, [ratedTeams, searchTerm, sortBy])

  const handleDraftChange = (teamId, field, value) => {
    setDraftRatings((currentDraftRatings) => ({
      ...currentDraftRatings,
      [teamId]: {
        ...currentDraftRatings[teamId],
        [field]: value,
      },
    }))
    setSaveStatus('idle')
    setSaveMessage('')
  }

  const handleSave = async () => {
    if (draftSummary.invalidTeamIds.length > 0) {
      setSaveStatus('error')
      setSaveMessage('Fix invalid rating values before saving.')
      return
    }

    if (draftSummary.dirtyTeamIds.length === 0) {
      return
    }

    setSaveStatus('saving')
    setSaveMessage('')

    try {
      const nextRatings = await onSave(draftSummary.updates)
      setDraftRatings(createDraftRatings(nextRatings))
      setSaveStatus('success')
      setSaveMessage(
        `Saved ${pluralizeTeams(draftSummary.dirtyTeamIds.length)}.`,
      )
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error.message)
    }
  }

  const handleReset = async () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Reset all power ratings in MongoDB to defaults? This will replace every team rating.',
      )

    if (!confirmed) {
      return
    }

    setResetStatus('saving')
    setSaveStatus('idle')
    setSaveMessage('')

    try {
      const nextRatings = await onReset()
      setDraftRatings(createDraftRatings(nextRatings))
      setResetStatus('success')
      setSaveStatus('success')
      setSaveMessage('Reset all teams to default MongoDB values.')
    } catch (error) {
      setResetStatus('idle')
      setSaveStatus('error')
      setSaveMessage(error.message)
    }
  }

  const handleImportLocalRatings = async () => {
    const nextRatings = await onImportLocalRatings()

    if (nextRatings) {
      setDraftRatings(createDraftRatings(nextRatings))
    }
  }

  const isSaving = saveStatus === 'saving'
  const isResetting = resetStatus === 'saving'
  const hasDirtyRatings = draftSummary.dirtyTeamIds.length > 0
  const hasInvalidRatings = draftSummary.invalidTeamIds.length > 0

  return (
    <section className="power-ratings-page" aria-label="Power Ratings">
      <div className="ratings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Power Ratings</p>
            <h2>Team Defaults</h2>
          </div>
          <span>
            {status === 'success'
              ? `${ratingsCount} MongoDB ${ratingsCount === 1 ? 'team' : 'teams'}`
              : 'MongoDB ratings'}
          </span>
        </div>

        {status === 'loading' ? <RatingsLoadingState /> : null}

        {status === 'error' ? (
          <RatingsState
            actionLabel="Try again"
            message={errorMessage}
            onAction={onRetry}
            title="Power ratings unavailable"
            tone="error"
          />
        ) : null}

        {status === 'empty' ? (
          <RatingsState
            actionLabel="Seed teams"
            message="MongoDB does not have power ratings yet. Seed the 32 NHL teams before editing or calculating games."
            onAction={onRetry}
            title="No power ratings found"
          />
        ) : null}

        {status === 'success' ? (
          <>
            {migrationAvailable ? (
              <div className="migration-panel">
                <div>
                  <strong>Local custom ratings found</strong>
                  <p>
                    MongoDB still has default values. Importing is optional and
                    will only happen after confirmation.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={migrationStatus === 'saving'}
                  onClick={handleImportLocalRatings}
                >
                  {migrationStatus === 'saving' ? 'Importing...' : 'Import'}
                </button>
              </div>
            ) : null}

            {migrationMessage ? (
              <p className={`form-status ${migrationStatus}`}>
                {migrationMessage}
              </p>
            ) : null}

            <div className="ratings-summary" aria-label="Power ratings summary">
              <SummaryMetric
                label="Base Home Advantage"
                value={formatBaseHomeAdvantage(baseHomeAdvantage)}
                detail="Configured in Settings"
              />
              <SummaryMetric
                label="Highest rated"
                value={summary.highestTeam.name}
                detail={formatRating(summary.highestTeam.effectiveRating)}
              />
              <SummaryMetric
                label="Lowest rated"
                value={summary.lowestTeam.name}
                detail={formatRating(summary.lowestTeam.effectiveRating)}
              />
              <SummaryMetric
                label="Average rating"
                value={formatRating(summary.averageRating)}
                detail={`${NHL_TEAMS.length} teams`}
              />
            </div>

            <p className="ratings-adjustment-note">
              Team-specific Home Adjustment is added to the Base Home Advantage
              configured in Settings.
            </p>

            <div className="ratings-toolbar">
              <label className="field" htmlFor="team-search">
                <span>Search teams</span>
                <input
                  id="team-search"
                  type="search"
                  value={searchTerm}
                  placeholder="Team, abbreviation, or division"
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </label>

              <label className="field" htmlFor="team-sort">
                <span>Sort by</span>
                <select
                  id="team-sort"
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

              <button
                className="save-ratings-button"
                type="button"
                disabled={
                  !hasDirtyRatings ||
                  hasInvalidRatings ||
                  isSaving ||
                  isResetting
                }
                onClick={handleSave}
              >
                {isSaving
                  ? 'Saving...'
                  : hasDirtyRatings
                    ? `Save ${pluralizeTeams(draftSummary.dirtyTeamIds.length)}`
                    : 'Saved'}
              </button>

              <button
                className="reset-button"
                type="button"
                disabled={isSaving || isResetting}
                onClick={handleReset}
              >
                {isResetting ? 'Resetting...' : 'Reset to defaults'}
              </button>
            </div>

            {saveMessage ? (
              <p className={`form-status ${saveStatus}`}>{saveMessage}</p>
            ) : null}

            <div className="ratings-grid">
              {visibleTeams.map((team) => {
                const isDirty = draftSummary.dirtyTeamIds.includes(team.id)

                return (
                  <article
                    className={`team-rating-row ${isDirty ? 'dirty' : ''}`}
                    key={team.id}
                  >
                    <div className="team-rating-identity">
                      <TeamLogo team={team} />
                      <div className="team-rating-copy">
                        <strong>{team.name}</strong>
                        <span>{team.abbreviation}</span>
                        <small>{team.division}</small>
                      </div>
                    </div>

                    {ratingFields.map((field) => {
                      const fieldId = `${team.id}-${field.key}`
                      const isInvalid = draftSummary.invalidFields.has(fieldId)
                      const isDirtyField = draftSummary.dirtyFields.has(fieldId)

                      return (
                        <label
                          className={`field rating-value-field ${
                            isDirtyField ? 'dirty' : ''
                          }`}
                          key={field.key}
                        >
                          <span>{field.label}</span>
                          <input
                            aria-invalid={isInvalid}
                            data-testid={`rating-${team.id}-${field.key}`}
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={draftRatings[team.id]?.[field.key] ?? ''}
                            inputMode="decimal"
                            onChange={(event) =>
                              handleDraftChange(
                                team.id,
                                field.key,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      )
                    })}

                    {isDirty ? (
                      <span className="team-rating-status">Unsaved</span>
                    ) : null}
                  </article>
                )
              })}
            </div>

            {visibleTeams.length === 0 ? (
              <p className="empty-state">No teams match that search.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}

function RatingsLoadingState() {
  return (
    <div className="ratings-grid" aria-label="Loading power ratings">
      {[0, 1, 2, 3].map((item) => (
        <div className="team-rating-row rating-row-loading" key={item}>
          <span />
          <strong />
          <div />
        </div>
      ))}
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

function RatingsState({ actionLabel, message, onAction, title, tone = '' }) {
  return (
    <div
      className={`ratings-state ${tone}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <strong>{title}</strong>
      <p>{message}</p>
      {onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function SummaryMetric({ label, value, detail }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export default PowerRatings
