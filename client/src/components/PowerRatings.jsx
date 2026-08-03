import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import {
  getPowerRatingHistory,
  getPowerRatingHistorySeasons,
} from '../services/powerRatingsApi.js'
import {
  POWER_RATING_HISTORY_DEFAULT_LIMIT,
  POWER_RATING_HISTORY_LIMIT_OPTIONS,
  POWER_RATING_HISTORY_SEASON_ALL,
  POWER_RATING_HISTORY_SEASON_CUSTOM,
  applyPowerRatingHistorySeasonSelection,
  createDefaultPowerRatingHistoryFilters,
  formatHistoryDate,
  formatHistoryRatingValue,
  formatHistoryScore,
  formatHistorySignedRatingChange,
  formatHistoryTimestamp,
  getCurrentPowerRatingHistorySeasonId,
  getHistoryRatingChangeTone,
  getNextPowerRatingHistoryPage,
  getPowerRatingHistoryDateFields,
  getPowerRatingHistoryAuditRows,
  getPowerRatingHistoryEmptyState,
  getPowerRatingHistorySeasonById,
  resolvePowerRatingHistoryFilters,
  validatePowerRatingHistoryFilters,
} from '../utils/powerRatingHistory.js'
import {
  formatPowerRatingDisplayValue,
  getEffectiveBaseRating,
  parsePowerRatingDraftValue,
} from '../utils/powerRatings.js'
import {
  canRunPowerRatingUpdate,
  createDefaultPowerRatingUpdateRange,
  formatPowerRatingNumber,
  formatResultTypeLabel,
  formatSignedRatingChange,
  getMostRecentProcessedGameDate,
  getPowerRatingUpdateOutcomeMessage,
  getPowerRatingUpdateOutcomeTone,
  getVisibleProcessedGames,
  hasHiddenProcessedGames,
  validatePowerRatingUpdateRange,
} from '../utils/powerRatingUpdates.js'

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

const powerRatingsViews = [
  {
    id: 'ratings',
    label: 'Team Ratings',
  },
  {
    id: 'history',
    label: 'Update History',
  },
]

const formatRating = (value) =>
  formatPowerRatingDisplayValue(value, { fallback: '--' })
const formatBaseHomeAdvantage = (value) =>
  formatPowerRatingDisplayValue(value, { fallback: '--' })

const createDraftRatings = (ratings) =>
  NHL_TEAMS.reduce((draftRatings, team) => {
    const rating = ratings[team.id] ?? {}

    draftRatings[team.id] = ratingFields.reduce((draftTeam, field) => {
      draftTeam[field.key] = String(rating[field.key] ?? '')
      return draftTeam
    }, {})

    return draftRatings
  }, {})

const pluralizeTeams = (count) => `${count} ${count === 1 ? 'team' : 'teams'}`

const formatLocalDateTime = (date) => {
  if (!date) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const formatUpdateGameDate = (gameDate) => gameDate || 'Date unavailable'

const getRatingChangeTone = (value) => {
  const numberValue = Number(value)

  if (numberValue > 0) {
    return 'positive'
  }

  if (numberValue < 0) {
    return 'negative'
  }

  return 'neutral'
}

const formatProcessedGameScore = (game) => {
  if (Number.isFinite(game.awayScore) && Number.isFinite(game.homeScore)) {
    return `${game.awayTeam} ${game.awayScore}-${game.homeScore} ${game.homeTeam}`
  }

  return game.result || `${game.awayTeam} at ${game.homeTeam}`
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const formatErrorDetail = (detail) => {
  if (typeof detail === 'string') {
    return detail
  }

  if (!isPlainObject(detail)) {
    return ''
  }

  if (typeof detail.reason === 'string') {
    return detail.gameId
      ? `Game ${detail.gameId}: ${detail.reason}`
      : detail.reason
  }

  if (typeof detail.field === 'string') {
    return `${detail.field}: ${detail.message ?? 'Invalid value'}`
  }

  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
}

const getErrorDetails = (error) => {
  if (Array.isArray(error?.details)) {
    return error.details.map(formatErrorDetail).filter(Boolean)
  }

  const detail = formatErrorDetail(error?.details)

  return detail ? [detail] : []
}

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
  onUpdatePowerRatings,
  openUpdatePanelRequest = 0,
  ratings,
  ratingsCount,
  status,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('highest')
  const [draftRatingsState, setDraftRatingsState] = useState(() => ({
    ratings,
    values: createDraftRatings(ratings),
  }))
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [resetStatus, setResetStatus] = useState('idle')
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false)
  const [updateRange, setUpdateRange] = useState(() =>
    createDefaultPowerRatingUpdateRange(),
  )
  const [updateStatus, setUpdateStatus] = useState('idle')
  const [updateResult, setUpdateResult] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const [updateErrorDetails, setUpdateErrorDetails] = useState([])
  const [lastUpdateInfo, setLastUpdateInfo] = useState(null)
  const [activeRatingFieldId, setActiveRatingFieldId] = useState('')
  const [activeView, setActiveView] = useState('ratings')
  const [historyFilters, setHistoryFilters] = useState(() =>
    createDefaultPowerRatingHistoryFilters(),
  )
  const [historyDraftFilters, setHistoryDraftFilters] = useState(() =>
    createDefaultPowerRatingHistoryFilters(),
  )
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLimit, setHistoryLimit] = useState(
    POWER_RATING_HISTORY_DEFAULT_LIMIT,
  )
  const [historyStatus, setHistoryStatus] = useState('idle')
  const [historyError, setHistoryError] = useState('')
  const [historyData, setHistoryData] = useState(null)
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0)
  const [historySeasonMetadata, setHistorySeasonMetadata] = useState(null)
  const [historySeasonStatus, setHistorySeasonStatus] = useState('idle')
  const [historySeasonError, setHistorySeasonError] = useState('')
  const historyTopRef = useRef(null)

  useEffect(() => {
    if (openUpdatePanelRequest <= 0) {
      return undefined
    }

    const timerId = setTimeout(() => {
      setUpdatePanelOpen(true)
    }, 0)

    return () => {
      clearTimeout(timerId)
    }
  }, [openUpdatePanelRequest])

  let draftRatings = draftRatingsState.values

  if (draftRatingsState.ratings !== ratings) {
    draftRatings = createDraftRatings(ratings)
    setDraftRatingsState({
      ratings,
      values: draftRatings,
    })
  }

  const setDraftRatings = (updater) => {
    setDraftRatingsState((currentState) => ({
      ratings: currentState.ratings,
      values:
        typeof updater === 'function'
          ? updater(currentState.values)
          : updater,
    }))
  }

  useEffect(() => {
    if (saveStatus !== 'success') {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      setSaveStatus('idle')
      setSaveMessage('')
    }, 2200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [saveStatus])

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
        const parsedValue = parsePowerRatingDraftValue(draftTeam[field.key])

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

  const updateRangeValidation = useMemo(
    () => validatePowerRatingUpdateRange(updateRange),
    [updateRange],
  )
  const selectedHistorySeason = useMemo(
    () =>
      getPowerRatingHistorySeasonById(
        historySeasonMetadata,
        historyFilters.season,
      ),
    [historyFilters.season, historySeasonMetadata],
  )
  const historyFilterValidation = useMemo(
    () =>
      validatePowerRatingHistoryFilters(historyDraftFilters, {
        seasonMetadata: historySeasonMetadata,
      }),
    [historyDraftFilters, historySeasonMetadata],
  )
  const historyResolvedFilters = useMemo(
    () =>
      resolvePowerRatingHistoryFilters(
        historyFilters,
        historySeasonMetadata,
      ),
    [historyFilters, historySeasonMetadata],
  )
  const historySeasonValue =
    historyFilters.season ||
    getCurrentPowerRatingHistorySeasonId(historySeasonMetadata)
  const historyNeedsSeasonMetadata = ![
    POWER_RATING_HISTORY_SEASON_ALL,
    POWER_RATING_HISTORY_SEASON_CUSTOM,
  ].includes(historySeasonValue)
  const isHistoryQueryReady =
    activeView === 'history' &&
    (!historyNeedsSeasonMetadata || Boolean(historySeasonMetadata))

  useEffect(() => {
    if (activeView !== 'history' || historySeasonStatus !== 'loading') {
      return undefined
    }

    let isCurrent = true

    getPowerRatingHistorySeasons()
      .then((result) => {
        if (!isCurrent) {
          return
        }

        const currentSeasonId = getCurrentPowerRatingHistorySeasonId(result)
        const nextFilters = createDefaultPowerRatingHistoryFilters(
          currentSeasonId,
        )

        setHistorySeasonMetadata(result)
        setHistorySeasonStatus('success')
        setHistorySeasonError('')

        if (!historyFilters.season) {
          setHistoryFilters(nextFilters)
          setHistoryDraftFilters(nextFilters)
        }

        setHistoryStatus('loading')
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        const customFilters = {
          ...historyFilters,
          season: POWER_RATING_HISTORY_SEASON_CUSTOM,
        }

        setHistorySeasonMetadata(null)
        setHistorySeasonStatus('error')
        setHistorySeasonError(error.message)
        setHistoryFilters(customFilters)
        setHistoryDraftFilters(customFilters)
        setHistoryStatus('loading')
      })

    return () => {
      isCurrent = false
    }
  }, [
    activeView,
    historyFilters,
    historySeasonStatus,
  ])

  useEffect(() => {
    if (!isHistoryQueryReady) {
      return undefined
    }

    let isCurrent = true

    getPowerRatingHistory({
      filters: historyResolvedFilters,
      limit: historyLimit,
      page: historyPage,
    })
      .then((result) => {
        if (!isCurrent) {
          return
        }

        setHistoryData(result)
        setHistoryStatus('success')
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setHistoryError(error.message)
        setHistoryStatus('error')
      })

    return () => {
      isCurrent = false
    }
  }, [
    historyResolvedFilters,
    historyLimit,
    historyPage,
    historyRefreshVersion,
    isHistoryQueryReady,
  ])

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

  const getDraftInputValue = (teamId, field) => {
    const fieldId = `${teamId}-${field}`
    const rawValue = draftRatings[teamId]?.[field] ?? ''

    if (activeRatingFieldId === fieldId) {
      return rawValue
    }

    return formatPowerRatingDisplayValue(rawValue, {
      fallback: rawValue,
    })
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

  const resetUpdateFeedback = () => {
    setUpdateStatus('idle')
    setUpdateResult(null)
    setUpdateError('')
    setUpdateErrorDetails([])
  }

  const handleOpenUpdatePanel = () => {
    setUpdatePanelOpen(true)
  }

  const handleCloseUpdatePanel = () => {
    if (isUpdateRunning) {
      return
    }

    setUpdatePanelOpen(false)
  }

  const handleUpdateRangeChange = (field, value) => {
    setUpdateRange((currentRange) => ({
      ...currentRange,
      [field]: value,
    }))
    resetUpdateFeedback()
  }

  const handleUseLastSevenDays = () => {
    setUpdateRange(createDefaultPowerRatingUpdateRange())
    resetUpdateFeedback()
  }

  const handleRunPowerRatingsUpdate = async (event) => {
    event.preventDefault()

    if (isUpdateRunning) {
      return
    }

    const validation = validatePowerRatingUpdateRange(updateRange)

    if (!validation.isValid) {
      setUpdateStatus('error')
      setUpdateError(validation.message)
      setUpdateErrorDetails([])
      return
    }

    if (draftSummary.dirtyTeamIds.length > 0) {
      setUpdateStatus('error')
      setUpdateError('Save pending team rating edits before running an update.')
      setUpdateErrorDetails([])
      return
    }

    if (typeof onUpdatePowerRatings !== 'function') {
      setUpdateStatus('error')
      setUpdateError('Power Rating updates are not available in this view.')
      setUpdateErrorDetails([])
      return
    }

    setUpdateStatus('running')
    setUpdateError('')
    setUpdateErrorDetails([])

    try {
      const result = await onUpdatePowerRatings(updateRange)
      const latestProcessedGameDate = getMostRecentProcessedGameDate(
        result.processedGames,
      )

      setUpdateResult(result)
      setUpdateStatus('success')
      setLastUpdateInfo((currentInfo) => ({
        latestProcessedGameDate:
          latestProcessedGameDate ||
          currentInfo?.latestProcessedGameDate ||
          '',
        runAt: new Date(),
      }))
      if (activeView === 'history') {
        setHistoryStatus('loading')
        setHistoryError('')
      }
      setHistoryRefreshVersion((currentVersion) => currentVersion + 1)
    } catch (error) {
      setUpdateStatus('error')
      setUpdateError(error.message)
      setUpdateErrorDetails(getErrorDetails(error))
    }
  }

  const handleHistoryFilterChange = (field, value) => {
    if (field === 'season') {
      setHistoryDraftFilters((currentFilters) =>
        applyPowerRatingHistorySeasonSelection(
          currentFilters,
          value,
          historySeasonMetadata,
        ),
      )
      setHistoryError('')
      return
    }

    setHistoryDraftFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }))
    setHistoryError('')
  }

  const handlePowerRatingsViewChange = (viewId) => {
    if (viewId === 'history' && activeView !== 'history') {
      setHistoryStatus('loading')
      setHistoryError('')

      if (!historySeasonMetadata && historySeasonStatus !== 'loading') {
        setHistorySeasonStatus('loading')
        setHistorySeasonError('')
      }
    }

    setActiveView(viewId)
  }

  const handleApplyHistoryFilters = (event) => {
    event.preventDefault()

    const validation = validatePowerRatingHistoryFilters(historyDraftFilters, {
      seasonMetadata: historySeasonMetadata,
    })

    if (!validation.isValid) {
      setHistoryError(validation.message)
      return
    }

    setHistoryFilters({
      from: historyDraftFilters.from,
      resultType: historyDraftFilters.resultType,
      season: historyDraftFilters.season,
      team: historyDraftFilters.team,
      to: historyDraftFilters.to,
    })
    setHistoryPage(1)
    setHistoryStatus('loading')
    setHistoryError('')
  }

  const handleClearHistoryFilters = () => {
    const defaultSeasonId =
      getCurrentPowerRatingHistorySeasonId(historySeasonMetadata) ||
      POWER_RATING_HISTORY_SEASON_CUSTOM
    const emptyFilters = createDefaultPowerRatingHistoryFilters(defaultSeasonId)

    setHistoryDraftFilters(emptyFilters)
    setHistoryFilters(emptyFilters)
    setHistoryPage(1)
    setHistoryStatus('loading')
    setHistoryError('')
  }

  const handleHistoryPageChange = (direction) => {
    setHistoryStatus('loading')
    setHistoryError('')
    setHistoryPage((currentPage) =>
      getNextPowerRatingHistoryPage(
        {
          ...historyData?.pagination,
          page: currentPage,
        },
        direction,
      ),
    )

    if (typeof window === 'undefined') {
      return
    }

    window.requestAnimationFrame(() => {
      historyTopRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
    })
  }

  const handleHistoryLimitChange = (value) => {
    const nextLimit = Number(value)

    setHistoryLimit(
      POWER_RATING_HISTORY_LIMIT_OPTIONS.includes(nextLimit)
        ? nextLimit
        : POWER_RATING_HISTORY_DEFAULT_LIMIT,
    )
    setHistoryPage(1)
    setHistoryStatus('loading')
    setHistoryError('')
  }

  const handleRetryHistory = () => {
    setHistoryStatus('loading')
    setHistoryError('')
    setHistoryRefreshVersion((currentVersion) => currentVersion + 1)
  }

  const handleRetryHistorySeasons = () => {
    setHistorySeasonStatus('loading')
    setHistorySeasonError('')
  }

  const isSaving = saveStatus === 'saving'
  const isResetting = resetStatus === 'saving'
  const isUpdateRunning = updateStatus === 'running'
  const hasDirtyRatings = draftSummary.dirtyTeamIds.length > 0
  const hasInvalidRatings = draftSummary.invalidTeamIds.length > 0
  const todayInputValue = createDefaultPowerRatingUpdateRange().to
  const canSubmitUpdate = canRunPowerRatingUpdate({
    hasUnsavedRatings: hasDirtyRatings,
    isUpdating: isUpdateRunning,
    validation: updateRangeValidation,
  })
  const saveButtonLabel = isSaving
    ? 'Saving...'
    : saveStatus === 'success' && !hasDirtyRatings
      ? 'Saved'
      : 'Save Changes'

  return (
    <section className="power-ratings-page" aria-label="Power Ratings">
      <div className="ratings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Power Ratings</p>
            <h2>{activeView === 'history' ? 'Update History' : 'Team Ratings'}</h2>
          </div>
          <span>
            {activeView === 'history'
              ? `${historyData?.pagination.totalItems ?? 0} audit ${
                  historyData?.pagination.totalItems === 1
                    ? 'record'
                    : 'records'
                }`
              : status === 'success'
                ? `${ratingsCount} MongoDB ${
                    ratingsCount === 1 ? 'team' : 'teams'
                  }`
                : 'MongoDB ratings'}
          </span>
        </div>

        <div
          className="power-ratings-tabs"
          role="tablist"
          aria-label="Power Ratings views"
        >
          {powerRatingsViews.map((view) => (
            <button
              aria-selected={activeView === view.id}
              className={activeView === view.id ? 'active' : ''}
              key={view.id}
              role="tab"
              type="button"
              onClick={() => handlePowerRatingsViewChange(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>

        {activeView === 'ratings' ? (
          <>
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

              <div className="ratings-update-control">
                <button
                  className="update-ratings-button"
                  type="button"
                  disabled={isSaving || isResetting}
                  onClick={handleOpenUpdatePanel}
                >
                  <RefreshCw aria-hidden="true" size={16} />
                  <span>Update Power Ratings</span>
                </button>
              </div>

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
                {saveButtonLabel}
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

            {lastUpdateInfo ? (
              <p
                className="ratings-update-metadata"
                aria-label="Last manual Power Rating update"
              >
                <span>Last run: {formatLocalDateTime(lastUpdateInfo.runAt)}</span>
                {lastUpdateInfo.latestProcessedGameDate ? (
                  <span>
                    Latest processed game:{' '}
                    {lastUpdateInfo.latestProcessedGameDate}
                  </span>
                ) : null}
              </p>
            ) : null}

            {updatePanelOpen ? (
              <PowerRatingUpdatePanel
                canRunUpdate={canSubmitUpdate}
                hasUnsavedRatings={hasDirtyRatings}
                isRunning={isUpdateRunning}
                onClose={handleCloseUpdatePanel}
                onRangeChange={handleUpdateRangeChange}
                onRun={handleRunPowerRatingsUpdate}
                onUseLastSevenDays={handleUseLastSevenDays}
                range={updateRange}
                result={updateResult}
                status={updateStatus}
                todayInputValue={todayInputValue}
                validation={updateRangeValidation}
                updateError={updateError}
                updateErrorDetails={updateErrorDetails}
              />
            ) : null}

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
                            value={getDraftInputValue(team.id, field.key)}
                            inputMode="decimal"
                            onBlur={() => setActiveRatingFieldId('')}
                            onChange={(event) =>
                              handleDraftChange(
                                team.id,
                                field.key,
                                event.target.value,
                              )
                            }
                            onFocus={() => setActiveRatingFieldId(fieldId)}
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
          </>
        ) : (
          <PowerRatingHistoryView
            data={historyData}
            draftFilters={historyDraftFilters}
            error={historyError}
            filters={historyFilters}
            filterValidation={historyFilterValidation}
            isLoading={historyStatus === 'loading'}
            limit={historyLimit}
            onApplyFilters={handleApplyHistoryFilters}
            onClearFilters={handleClearHistoryFilters}
            onFilterChange={handleHistoryFilterChange}
            onLimitChange={handleHistoryLimitChange}
            onPageChange={handleHistoryPageChange}
            onRetry={handleRetryHistory}
            onRetrySeasons={handleRetryHistorySeasons}
            seasonMetadata={historySeasonMetadata}
            seasonError={historySeasonError}
            seasonStatus={historySeasonStatus}
            selectedSeason={selectedHistorySeason}
            status={historyStatus}
            todayInputValue={todayInputValue}
            topRef={historyTopRef}
          />
        )}
      </div>
    </section>
  )
}

function PowerRatingHistoryView({
  data,
  draftFilters,
  error,
  filters,
  filterValidation,
  isLoading,
  limit,
  onApplyFilters,
  onClearFilters,
  onFilterChange,
  onLimitChange,
  onPageChange,
  onRetry,
  onRetrySeasons,
  seasonError,
  seasonMetadata,
  seasonStatus,
  selectedSeason,
  status,
  todayInputValue,
  topRef,
}) {
  const items = data?.items ?? []
  const pagination = data?.pagination ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    limit,
    page: 1,
    totalItems: 0,
    totalPages: 0,
  }
  const emptyState =
    status === 'success'
      ? getPowerRatingHistoryEmptyState({
          filters,
          selectedSeason,
          totalItems: pagination.totalItems,
        })
      : null
  const currentSeasonId = getCurrentPowerRatingHistorySeasonId(seasonMetadata)
  const currentSeasonValue =
    draftFilters.season || currentSeasonId || POWER_RATING_HISTORY_SEASON_CUSTOM
  const dateFields = getPowerRatingHistoryDateFields(
    {
      ...draftFilters,
      season: currentSeasonValue,
    },
    seasonMetadata,
  )
  const hasActiveFilters =
    Boolean(draftFilters.team || draftFilters.resultType) ||
    currentSeasonValue !== currentSeasonId ||
    (currentSeasonValue === POWER_RATING_HISTORY_SEASON_CUSTOM &&
      Boolean(draftFilters.from || draftFilters.to))
  const hasSeasonOptions = seasonMetadata?.seasons?.length > 0
  const showInitialLoading = isLoading && !data
  const isSeasonLoading = seasonStatus === 'loading'
  const isSeasonError = seasonStatus === 'error'

  return (
    <div className="power-history-view" ref={topRef}>
      <form className="power-history-filters" onSubmit={onApplyFilters}>
        <label className="field" htmlFor="power-history-season">
          <span>Season</span>
          <select
            aria-label="Season"
            disabled={isSeasonLoading}
            id="power-history-season"
            value={currentSeasonValue}
            onChange={(event) => onFilterChange('season', event.target.value)}
          >
            {isSeasonLoading ? (
              <option value={currentSeasonValue}>Loading seasons...</option>
            ) : null}
            {!isSeasonLoading && hasSeasonOptions
              ? seasonMetadata.seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.isCurrent
                      ? `Current season - ${season.label}`
                      : season.label}
                  </option>
                ))
              : null}
            <option value={POWER_RATING_HISTORY_SEASON_ALL}>All seasons</option>
            <option value={POWER_RATING_HISTORY_SEASON_CUSTOM}>
              Custom date range
            </option>
          </select>
          <small className="field-error-slot">
            {seasonMetadata?.metadataSource === 'fallback'
              ? 'Fallback season dates'
              : ' '}
          </small>
        </label>

        <label className="field" htmlFor="power-history-from">
          <span>Date From</span>
          <input
            aria-invalid={Boolean(filterValidation.fieldErrors.from)}
            aria-readonly={dateFields.disabled}
            disabled={dateFields.disabled}
            id="power-history-from"
            max={todayInputValue}
            type="date"
            value={dateFields.from}
            onChange={(event) => onFilterChange('from', event.target.value)}
          />
          <small className="field-error-slot">
            {filterValidation.fieldErrors.from || ' '}
          </small>
        </label>

        <label className="field" htmlFor="power-history-to">
          <span>Date To</span>
          <input
            aria-invalid={Boolean(filterValidation.fieldErrors.to)}
            aria-readonly={dateFields.disabled}
            disabled={dateFields.disabled}
            id="power-history-to"
            max={todayInputValue}
            type="date"
            value={dateFields.to}
            onChange={(event) => onFilterChange('to', event.target.value)}
          />
          <small className="field-error-slot">
            {filterValidation.fieldErrors.to || ' '}
          </small>
        </label>

        <label className="field" htmlFor="power-history-team">
          <span>Team</span>
          <select
            aria-invalid={Boolean(filterValidation.fieldErrors.team)}
            id="power-history-team"
            value={draftFilters.team}
            onChange={(event) => onFilterChange('team', event.target.value)}
          >
            <option value="">All teams</option>
            {NHL_TEAMS.map((team) => (
              <option key={team.id} value={team.abbreviation}>
                {team.abbreviation} - {team.name}
              </option>
            ))}
          </select>
          <small className="field-error-slot">
            {filterValidation.fieldErrors.team || ' '}
          </small>
        </label>

        <label className="field" htmlFor="power-history-result-type">
          <span>Result Type</span>
          <select
            aria-invalid={Boolean(filterValidation.fieldErrors.resultType)}
            id="power-history-result-type"
            value={draftFilters.resultType}
            onChange={(event) =>
              onFilterChange('resultType', event.target.value)
            }
          >
            <option value="">All</option>
            <option value="REGULATION">Regulation</option>
            <option value="OVERTIME">Overtime</option>
            <option value="SHOOTOUT">Shootout</option>
          </select>
          <small className="field-error-slot">
            {filterValidation.fieldErrors.resultType || ' '}
          </small>
        </label>

        <div className="power-history-filter-actions">
          <button
            className="update-ratings-button"
            type="submit"
            disabled={isLoading}
          >
            <Search aria-hidden="true" size={15} />
            <span>Apply Filters</span>
          </button>
          <button
            className="power-history-clear-button"
            type="button"
            disabled={isLoading || !hasActiveFilters}
            onClick={onClearFilters}
          >
            <X aria-hidden="true" size={15} />
            <span>Clear Filters</span>
          </button>
        </div>
      </form>

      {seasonMetadata?.warning ? (
        <p className="form-status warning">{seasonMetadata.warning}</p>
      ) : null}

      {isSeasonError ? (
        <div className="power-history-feedback">
          <p className="form-status warning" role="status">
            Season options could not be loaded: {seasonError}
          </p>
          <button type="button" onClick={onRetrySeasons}>
            <RotateCcw aria-hidden="true" size={15} />
            <span>Retry Seasons</span>
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="power-history-feedback">
          <p className="form-status error" role="alert">
            {error}
          </p>
          {status === 'error' ? (
            <button type="button" onClick={onRetry}>
              <RotateCcw aria-hidden="true" size={15} />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {showInitialLoading ? <PowerRatingHistoryLoadingState /> : null}

      {isLoading && data ? (
        <p className="form-status neutral power-history-loading" role="status">
          <RefreshCw
            aria-hidden="true"
            className="button-spinner"
            size={15}
          />
          Loading update history...
        </p>
      ) : null}

      {data ? (
        <>
          <PowerRatingHistorySummary
            pagination={pagination}
            summary={data.summary}
          />

          {emptyState ? (
            <RatingsState
              message={emptyState.message}
              title={emptyState.title}
            />
          ) : (
            <div className="power-history-list" aria-label="Update history">
              {items.map((item, index) => (
                <PowerRatingHistoryItem
                  item={item}
                  key={item.id ?? `${item.gameId ?? 'game'}-${index}`}
                />
              ))}
            </div>
          )}

          {pagination.totalItems > 0 ? (
            <PowerRatingHistoryPagination
              isLoading={isLoading}
              limit={limit}
              onLimitChange={onLimitChange}
              onPageChange={onPageChange}
              pagination={pagination}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function PowerRatingHistorySummary({ pagination, summary }) {
  const dateRange = formatHistorySummaryDateRange(summary?.dateRange)
  const mostRecentGame = summary?.mostRecentGame
  const movement = formatHistoryRatingValue(summary?.totalRatingMovement)

  return (
    <div
      className="ratings-summary power-history-summary"
      aria-label="Power Rating history summary"
    >
      <SummaryMetric
        label="Games Processed"
        value={String(pagination.totalItems)}
        detail="Current filter set"
      />
      <SummaryMetric
        label="Date Range"
        value={dateRange.value}
        detail={dateRange.detail}
      />
      <SummaryMetric
        label="Total Movement"
        value={movement}
        detail={
          movement === '--'
            ? 'Unavailable for legacy records'
            : 'Team rating deltas'
        }
      />
      <SummaryMetric
        label="Most Recent"
        value={
          mostRecentGame?.gameDate
            ? formatHistoryDate(mostRecentGame.gameDate)
            : '--'
        }
        detail={formatMostRecentHistoryGameDetail(mostRecentGame)}
      />
      <SummaryMetric
        label="Teams Affected"
        value={String(summary?.teamsAffected ?? 0)}
        detail="Current filter set"
      />
    </div>
  )
}

function formatHistorySummaryDateRange(dateRange = {}) {
  if (dateRange.from && dateRange.to) {
    return {
      detail: 'Game dates',
      value:
        dateRange.from === dateRange.to
          ? formatHistoryDate(dateRange.from)
          : `${formatHistoryDate(dateRange.from)} to ${formatHistoryDate(
              dateRange.to,
            )}`,
    }
  }

  if (dateRange.from || dateRange.to) {
    return {
      detail: 'Partial history',
      value: formatHistoryDate(dateRange.from || dateRange.to),
    }
  }

  return {
    detail: 'No dated records',
    value: '--',
  }
}

function formatMostRecentHistoryGameDetail(game) {
  if (!game) {
    return 'No processed records'
  }

  const matchup =
    game.awayTeam && game.homeTeam
      ? `${game.awayTeam} at ${game.homeTeam}`
      : 'Matchup unavailable'

  return game.processedAt
    ? `${matchup} | ${formatHistoryTimestamp(game.processedAt)}`
    : matchup
}

function PowerRatingHistoryItem({ item }) {
  const awayTeam = item.awayTeam?.abbreviation || 'Away'
  const homeTeam = item.homeTeam?.abbreviation || 'Home'

  return (
    <article className="power-history-item">
      <div className="power-history-item-main">
        <div className="power-history-matchup">
          <span>
            {formatHistoryDate(item.gameDate)} |{' '}
            {formatResultTypeLabel(item.resultType)}
          </span>
          <strong>{formatHistoryScore(item)}</strong>
        </div>

        <div className="power-history-teams" aria-label={`${awayTeam} at ${homeTeam}`}>
          <HistoryTeamBadge team={item.awayTeam} />
          <span className="power-history-at">at</span>
          <HistoryTeamBadge team={item.homeTeam} />
        </div>
      </div>

      <div className="power-history-rating-lines">
        <HistoryRatingLine
          change={item.awayRatingChange}
          ratingAfter={item.awayRatingAfter}
          ratingBefore={item.awayRatingBefore}
          team={item.awayTeam}
        />
        <HistoryRatingLine
          change={item.homeRatingChange}
          ratingAfter={item.homeRatingAfter}
          ratingBefore={item.homeRatingBefore}
          team={item.homeTeam}
        />
      </div>

      <PowerRatingHistoryDetails item={item} />
    </article>
  )
}

function HistoryTeamBadge({ team }) {
  const [hasLogoError, setHasLogoError] = useState(false)
  const abbreviation = team?.abbreviation || '--'
  const logo = getTeamMetadata(abbreviation).logo
  const showLogo = logo && !hasLogoError

  return (
    <span className="power-history-team-badge">
      <span className="power-history-team-logo" aria-hidden="true">
        {showLogo ? (
          <img
            src={logo}
            alt=""
            loading="lazy"
            onError={() => setHasLogoError(true)}
          />
        ) : (
          <span>{abbreviation}</span>
        )}
      </span>
      <span>
        <strong>{abbreviation}</strong>
        {team?.name ? <small>{team.name}</small> : null}
      </span>
    </span>
  )
}

function HistoryRatingLine({ change, ratingAfter, ratingBefore, team }) {
  const tone = getHistoryRatingChangeTone(change)

  return (
    <p>
      <span>{team?.abbreviation || '--'}</span>
      <strong>
        {formatHistoryRatingValue(ratingBefore)} -&gt;{' '}
        {formatHistoryRatingValue(ratingAfter)}
      </strong>
      <b className={`rating-change-value ${tone}`}>
        {formatHistorySignedRatingChange(change)}
      </b>
    </p>
  )
}

function PowerRatingHistoryDetails({ item }) {
  const rows = getPowerRatingHistoryAuditRows(item)

  return (
    <details className="power-history-details">
      <summary>View calculation details</summary>
      <dl className="power-history-audit-grid">
        {rows.map((row) => (
          <div
            className={row.isAvailable ? '' : 'unavailable'}
            key={row.key}
          >
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function PowerRatingHistoryPagination({
  isLoading,
  limit,
  onLimitChange,
  onPageChange,
  pagination,
}) {
  return (
    <div className="power-history-pagination" aria-label="History pagination">
      <button
        type="button"
        disabled={isLoading || !pagination.hasPreviousPage}
        onClick={() => onPageChange('previous')}
      >
        <ChevronLeft aria-hidden="true" size={16} />
        <span>Previous</span>
      </button>

      <span>
        Page {pagination.page} of {pagination.totalPages}
      </span>

      <button
        type="button"
        disabled={isLoading || !pagination.hasNextPage}
        onClick={() => onPageChange('next')}
      >
        <span>Next</span>
        <ChevronRight aria-hidden="true" size={16} />
      </button>

      <label className="field" htmlFor="power-history-limit">
        <span>Rows</span>
        <select
          id="power-history-limit"
          value={limit}
          onChange={(event) => onLimitChange(event.target.value)}
        >
          {POWER_RATING_HISTORY_LIMIT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function PowerRatingHistoryLoadingState() {
  return (
    <div className="power-history-list" aria-label="Loading update history">
      {[0, 1, 2].map((item) => (
        <div className="power-history-item power-history-loading-row" key={item}>
          <span />
          <strong />
          <div />
        </div>
      ))}
    </div>
  )
}

function PowerRatingUpdatePanel({
  canRunUpdate,
  hasUnsavedRatings,
  isRunning,
  onClose,
  onRangeChange,
  onRun,
  onUseLastSevenDays,
  range,
  result,
  status,
  todayInputValue,
  updateError,
  updateErrorDetails,
  validation,
}) {
  const outcomeMessage = result
    ? getPowerRatingUpdateOutcomeMessage(result)
    : ''
  const outcomeTone = result ? getPowerRatingUpdateOutcomeTone(result) : ''
  const hasValidationError = !validation.isValid
  const statusMessage = updateError || validation.message

  return (
    <div className="power-update-modal-backdrop" role="presentation">
      <section
        aria-labelledby="power-rating-update-title"
        aria-modal="true"
        className="power-update-modal"
        role="dialog"
      >
        <form className="power-update-form" onSubmit={onRun}>
          <div className="power-update-modal-header">
            <div>
              <p className="eyebrow">Manual Update</p>
              <h3 id="power-rating-update-title">Update Power Ratings</h3>
            </div>
            <button type="button" disabled={isRunning} onClick={onClose}>
              Close
            </button>
          </div>

          <div className="power-update-date-grid">
            <label className="field" htmlFor="power-update-from">
              <span>Date From</span>
              <input
                aria-invalid={Boolean(validation.fieldErrors.from)}
                disabled={isRunning}
                id="power-update-from"
                max={todayInputValue}
                type="date"
                value={range.from}
                onChange={(event) =>
                  onRangeChange('from', event.target.value)
                }
              />
              {validation.fieldErrors.from ? (
                <small className="field-error">
                  {validation.fieldErrors.from}
                </small>
              ) : null}
            </label>

            <label className="field" htmlFor="power-update-to">
              <span>Date To</span>
              <input
                aria-invalid={Boolean(validation.fieldErrors.to)}
                disabled={isRunning}
                id="power-update-to"
                max={todayInputValue}
                type="date"
                value={range.to}
                onChange={(event) => onRangeChange('to', event.target.value)}
              />
              {validation.fieldErrors.to ? (
                <small className="field-error">
                  {validation.fieldErrors.to}
                </small>
              ) : null}
            </label>

            <button
              className="power-update-quick-button"
              type="button"
              disabled={isRunning}
              onClick={onUseLastSevenDays}
            >
              Last 7 days
            </button>
          </div>

          <ul className="power-update-notes">
            <li>Only completed NHL regular-season games are eligible.</li>
            <li>Already processed games will not be applied again.</li>
            <li>Games are processed chronologically.</li>
            <li>Current Power Rating Engine settings will be used.</li>
            <li>
              Changes affect future rating updates only. Previously processed
              games are not recalculated.
            </li>
            <li>Changes cannot be undone automatically from this dialog.</li>
          </ul>

          {hasUnsavedRatings ? (
            <p className="form-status error" role="alert">
              Save pending team rating edits before running an update.
            </p>
          ) : null}

          {status === 'running' ? (
            <p className="form-status power-update-running" role="status">
              <RefreshCw
                aria-hidden="true"
                className="button-spinner"
                size={15}
              />
              Updating Power Ratings...
            </p>
          ) : null}

          {status === 'error' && statusMessage ? (
            <div className="power-update-error-panel" role="alert">
              <p className="form-status error">{statusMessage}</p>
              {updateErrorDetails.length > 0 ? (
                <ul>
                  {updateErrorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {status !== 'error' && hasValidationError ? (
            <p className="form-status error" role="alert">
              {validation.message}
            </p>
          ) : null}

          <div className="power-update-actions">
            <button
              className="save-ratings-button power-update-run-button"
              type="submit"
              disabled={!canRunUpdate}
            >
              <RefreshCw
                aria-hidden="true"
                className={isRunning ? 'button-spinner' : ''}
                size={16}
              />
              <span>
                {isRunning ? 'Updating Power Ratings...' : 'Run Update'}
              </span>
            </button>
          </div>

          {result ? (
            <PowerRatingUpdateResult
              message={outcomeMessage}
              result={result}
              tone={outcomeTone}
            />
          ) : null}
        </form>
      </section>
    </div>
  )
}

function PowerRatingUpdateResult({ message, result, tone }) {
  const [processedListState, setProcessedListState] = useState(() => ({
    result,
    showAll: false,
  }))
  let currentProcessedListState = processedListState

  if (processedListState.result !== result) {
    currentProcessedListState = {
      result,
      showAll: false,
    }
    setProcessedListState(currentProcessedListState)
  }

  const visibleProcessedGames = getVisibleProcessedGames(
    result.processedGames,
    {
      showAll: currentProcessedListState.showAll,
    },
  )
  const canToggleProcessedGames =
    result.processedGames.length >
    getVisibleProcessedGames(result.processedGames).length
  const hiddenProcessedGames = hasHiddenProcessedGames(result.processedGames, {
    showAll: currentProcessedListState.showAll,
  })

  return (
    <div className="power-update-result">
      <p className={`form-status ${tone}`}>{message}</p>

      {result.refreshError ? (
        <p className="form-status warning">
          Power Ratings updated, but the refreshed list could not be loaded:{' '}
          {result.refreshError}
        </p>
      ) : null}

      <div className="power-update-summary-grid" aria-label="Update summary">
        <SummaryMetric
          label="Games found"
          value={String(result.gamesFound)}
          detail={`${result.dateRange.from} to ${result.dateRange.to}`}
        />
        <SummaryMetric
          label="Already processed"
          value={String(result.gamesAlreadyProcessed)}
          detail="Not applied again"
        />
        <SummaryMetric
          label="Games processed"
          value={String(result.gamesProcessed)}
          detail="Ratings updated"
        />
        <SummaryMetric
          label="Games skipped"
          value={String(result.gamesSkipped)}
          detail="Not eligible or incomplete"
        />
        <SummaryMetric
          label="Errors"
          value={String(result.errors.length)}
          detail="Returned by update"
        />
      </div>

      {result.processedGames.length > 0 ? (
        <div className="power-update-game-list" aria-label="Processed games">
          <div className="power-update-list-heading">
            <strong>Processed Games</strong>
            {canToggleProcessedGames ? (
              <button
                type="button"
                className="power-update-list-toggle"
                onClick={() =>
                  setProcessedListState({
                    result,
                    showAll: !currentProcessedListState.showAll,
                  })
                }
              >
                {hiddenProcessedGames
                  ? `Show all ${result.processedGames.length} games`
                  : 'Show fewer'}
              </button>
            ) : null}
          </div>
          {visibleProcessedGames.map((game, index) => (
            <ProcessedGameSummary
              game={game}
              key={`${game.gameId ?? 'game'}-${index}`}
            />
          ))}
        </div>
      ) : null}

      {result.errors.length > 0 ? (
        <div className="power-update-game-errors" aria-label="Update errors">
          <strong>Skipped Games and Errors</strong>
          <ul>
            {result.errors.map((error) => (
              <li key={`${error.gameId ?? 'unknown'}-${error.reason}`}>
                {error.gameId ? `Game ${error.gameId}: ` : ''}
                {error.reason}
                {error.code ? ` (${error.code})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ProcessedGameSummary({ game }) {
  return (
    <article className="power-update-game">
      <div className="power-update-game-heading">
        <span>{formatUpdateGameDate(game.gameDate)}</span>
        <strong>{formatProcessedGameScore(game)}</strong>
        <small>{formatResultTypeLabel(game.resultType)}</small>
      </div>

      <div className="power-update-rating-lines">
        <RatingChangeLine
          change={game.awayRatingChange}
          label={game.awayTeam}
          ratingAfter={game.awayRatingAfter}
          ratingBefore={game.awayRatingBefore}
        />
        <RatingChangeLine
          change={game.homeRatingChange}
          label={game.homeTeam}
          ratingAfter={game.homeRatingAfter}
          ratingBefore={game.homeRatingBefore}
        />
      </div>
    </article>
  )
}

function RatingChangeLine({ change, label, ratingAfter, ratingBefore }) {
  const tone = getRatingChangeTone(change)

  return (
    <p>
      <span>{label}</span>
      <strong>
        {formatPowerRatingNumber(ratingBefore)} -&gt;{' '}
        {formatPowerRatingNumber(ratingAfter)}
      </strong>
      <b className={`rating-change-value ${tone}`}>
        {formatSignedRatingChange(change)}
      </b>
    </p>
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
