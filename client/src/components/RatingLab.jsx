import { useMemo, useState } from 'react'
import {
  ArrowDownUp,
  LoaderCircle,
  Play,
  RotateCcw,
} from 'lucide-react'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { previewPowerRatingSimulation } from '../services/powerRatingSimulationsApi.js'
import {
  RATING_LAB_CONFIGURATION_FIELDS,
  createRatingLabDefaultForm,
  createSimulationPreviewPayload,
  deriveRatingLabResults,
  findTeamResultBySummaryTeam,
  formatRatingLabChange,
  formatRatingLabInteger,
  formatRatingLabNumber,
  formatSkipReasonLabel,
  getChangeLabel,
  getChangeTone,
  validateRatingLabForm,
} from '../utils/ratingLab.js'

const startingModeOptions = [
  {
    label: 'Equal ratings',
    value: 'equal',
  },
  {
    label: 'Current Power Ratings',
    value: 'current',
  },
]

const gameTypeOptions = [
  {
    key: 'regularSeason',
    label: 'Regular season',
  },
  {
    key: 'playoffs',
    label: 'Playoffs',
  },
  {
    key: 'preseason',
    label: 'Preseason',
  },
]

const sortableColumns = [
  {
    key: 'team',
    label: 'Team',
  },
  {
    key: 'startingRating',
    label: 'Starting Rating',
  },
  {
    key: 'finalRating',
    label: 'Final Rating',
  },
  {
    key: 'netChange',
    label: 'Change',
  },
]

const getDefaultSortDirection = (sortKey) =>
  sortKey === 'team' ? 'asc' : 'desc'

const getSortDirectionLabel = (sortState, sortKey) => {
  if (sortState.key !== sortKey) {
    return ''
  }

  return sortState.direction === 'asc' ? 'Asc' : 'Desc'
}

const getAriaSort = (sortState, sortKey) => {
  if (sortState.key !== sortKey) {
    return 'none'
  }

  return sortState.direction === 'asc' ? 'ascending' : 'descending'
}

const formatSimulationError = (error) => {
  const message =
    error?.message || 'Unable to run the replay. Check the inputs and try again.'

  if (error?.details?.field) {
    return `${message} Field: ${error.details.field}.`
  }

  if (Array.isArray(error?.details?.unsupportedFields)) {
    return `${message} Unsupported fields: ${error.details.unsupportedFields.join(', ')}.`
  }

  return message
}

function RatingLab({
  initialErrorMessage = '',
  initialForm,
  initialResult = null,
  initialStatus = 'idle',
  previewSimulation = previewPowerRatingSimulation,
} = {}) {
  const [form, setForm] = useState(() => initialForm ?? createRatingLabDefaultForm())
  const [result, setResult] = useState(initialResult)
  const [status, setStatus] = useState(initialResult ? 'success' : initialStatus)
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [sortState, setSortState] = useState({
    direction: 'desc',
    key: 'finalRating',
  })
  const isRunning = status === 'loading'
  const derivedResults = useMemo(
    () => (result ? deriveRatingLabResults(result, sortState) : null),
    [result, sortState],
  )

  const updateField = (field, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
    setErrorMessage('')
  }

  const updateGameType = (gameType, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      gameTypes: {
        ...currentForm.gameTypes,
        [gameType]: value,
      },
    }))
    setErrorMessage('')
  }

  const updateConfiguration = (field, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      configuration: {
        ...currentForm.configuration,
        [field]: value,
      },
    }))
    setErrorMessage('')
  }

  const handleReset = () => {
    setForm(createRatingLabDefaultForm())
    setErrorMessage('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (isRunning) {
      return
    }

    const validationMessage = validateRatingLabForm(form)

    if (validationMessage) {
      setErrorMessage(validationMessage)
      setStatus(result ? 'success' : 'error')
      return
    }

    setStatus('loading')
    setErrorMessage('')

    try {
      const simulation = await previewSimulation(createSimulationPreviewPayload(form))

      setResult(simulation)
      setStatus('success')
    } catch (error) {
      setErrorMessage(formatSimulationError(error))
      setStatus('error')
    }
  }

  const handleSort = (sortKey) => {
    setSortState((currentSort) => {
      if (currentSort.key !== sortKey) {
        return {
          direction: getDefaultSortDirection(sortKey),
          key: sortKey,
        }
      }

      return {
        direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
        key: sortKey,
      }
    })
  }

  return (
    <section className="rating-lab-page" aria-label="Rating Lab">
      <div className="rating-lab-layout">
        <aside className="rating-lab-controls-panel" aria-label="Simulation controls">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Replay setup</p>
              <h2>Simulation Controls</h2>
            </div>
          </div>

          <form className="rating-lab-form" onSubmit={handleSubmit}>
            <div className="rating-lab-field-grid">
              <label className="field" htmlFor="rating-lab-date-from">
                <span>Date From</span>
                <input
                  id="rating-lab-date-from"
                  type="date"
                  value={form.dateFrom}
                  onChange={(event) => updateField('dateFrom', event.target.value)}
                />
              </label>

              <label className="field" htmlFor="rating-lab-date-to">
                <span>Date To</span>
                <input
                  id="rating-lab-date-to"
                  type="date"
                  value={form.dateTo}
                  onChange={(event) => updateField('dateTo', event.target.value)}
                />
              </label>
            </div>

            <fieldset className="rating-lab-fieldset">
              <legend id="rating-lab-starting-mode">Starting ratings</legend>
              <div
                className="rating-lab-choice-grid"
                role="radiogroup"
                aria-labelledby="rating-lab-starting-mode"
              >
                {startingModeOptions.map((option) => {
                  const isSelected = form.startingMode === option.value

                  return (
                    <label
                      className={`rating-lab-choice ${isSelected ? 'selected' : ''}`}
                      key={option.value}
                    >
                      <input
                        type="radio"
                        name="startingMode"
                        value={option.value}
                        checked={isSelected}
                        onChange={(event) =>
                          updateField('startingMode', event.target.value)
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="rating-lab-fieldset">
              <legend>Game types</legend>
              <div className="rating-lab-choice-grid three">
                {gameTypeOptions.map((option) => {
                  const isSelected = form.gameTypes[option.key]

                  return (
                    <label
                      className={`rating-lab-choice ${isSelected ? 'selected' : ''}`}
                      key={option.key}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) =>
                          updateGameType(option.key, event.target.checked)
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="rating-lab-fieldset">
              <legend>Replay configuration</legend>
              <div className="rating-lab-field-grid">
                {RATING_LAB_CONFIGURATION_FIELDS.map((field) => (
                  <label
                    className="field rating-lab-number-field"
                    htmlFor={`rating-lab-${field.key}`}
                    key={field.key}
                  >
                    <span>{field.label}</span>
                    <input
                      id={`rating-lab-${field.key}`}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={form.configuration[field.key]}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateConfiguration(field.key, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            {errorMessage ? (
              <p className="form-status error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="rating-lab-actions">
              <button
                className="save-ratings-button rating-lab-run-button"
                type="submit"
                disabled={isRunning}
              >
                {isRunning ? (
                  <LoaderCircle
                    className="button-spinner"
                    aria-hidden="true"
                    size={18}
                    strokeWidth={2.2}
                  />
                ) : (
                  <Play aria-hidden="true" size={17} strokeWidth={2.4} />
                )}
                <span>{isRunning ? 'Running...' : 'Run Replay'}</span>
              </button>

              <button
                className="reset-button rating-lab-reset-button"
                type="button"
                disabled={isRunning}
                onClick={handleReset}
              >
                <RotateCcw aria-hidden="true" size={17} strokeWidth={2.2} />
                <span>Reset Defaults</span>
              </button>
            </div>
          </form>
        </aside>

        <section className="rating-lab-results-panel" aria-label="Simulation results">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Replay output</p>
              <h2>Simulation Results</h2>
            </div>
            {result?.modelVersion ? <span>{result.modelVersion}</span> : null}
          </div>

          {isRunning ? <RatingLabLoadingState /> : null}

          {!result && !isRunning ? <RatingLabEmptyState /> : null}

          {result && derivedResults ? (
            <RatingLabResults
              derivedResults={derivedResults}
              result={result}
              onSort={handleSort}
              sortState={sortState}
            />
          ) : null}
        </section>
      </div>
    </section>
  )
}

function RatingLabLoadingState() {
  return (
    <div className="rating-lab-loading-state" role="status" aria-live="polite">
      <LoaderCircle
        className="button-spinner"
        aria-hidden="true"
        size={20}
        strokeWidth={2.2}
      />
      <div>
        <strong>Running replay</strong>
        <p>A full-season replay may take a moment.</p>
      </div>
    </div>
  )
}

function RatingLabEmptyState() {
  return (
    <div className="rating-lab-empty-state">
      <strong>Ready for replay</strong>
      <p>
        Configure a historical replay and run the simulation to inspect final
        ratings, ranking changes, and distribution statistics.
      </p>
    </div>
  )
}

function RatingLabResults({ derivedResults, onSort, result, sortState }) {
  const { bottomTeams, fallers, rankedTeams, risers, tableTeams, topTeams } =
    derivedResults

  return (
    <div className="rating-lab-results">
      <RatingLabSummary result={result} rankedTeams={rankedTeams} />

      <div className="rating-lab-insight-grid">
        <CompactTeamList title="Top 10 teams" teams={topTeams} />
        <CompactTeamList title="Bottom 10 teams" teams={bottomTeams} />
        <MoverList title="Biggest Risers" teams={risers} />
        <MoverList title="Biggest Fallers" teams={fallers} />
      </div>

      <SkipReasons skipReasons={result.skipReasons} />
      <Warnings warnings={result.warnings} />

      <RankingTable
        sortState={sortState}
        teams={tableTeams}
        onSort={onSort}
      />
    </div>
  )
}

function RatingLabSummary({ rankedTeams, result }) {
  const summary = result.summary ?? {}
  const highestTeam =
    findTeamResultBySummaryTeam(rankedTeams, summary.highestRatedTeam) ??
    rankedTeams[0]
  const lowestTeam =
    findTeamResultBySummaryTeam(rankedTeams, summary.lowestRatedTeam) ??
    rankedTeams.at(-1)
  const summaryCards = [
    {
      detail: 'Schedule games',
      label: 'Games fetched',
      value: formatRatingLabInteger(summary.gamesFetched),
    },
    {
      detail: 'Eligible games',
      label: 'Games eligible',
      value: formatRatingLabInteger(summary.gamesEligible),
    },
    {
      detail: 'Rating updates',
      label: 'Games processed',
      value: formatRatingLabInteger(summary.gamesProcessed),
    },
    {
      detail: 'Excluded games',
      label: 'Games skipped',
      value: formatRatingLabInteger(summary.gamesSkipped),
    },
    {
      detail: 'Final table',
      label: 'Teams ranked',
      value: formatRatingLabInteger(summary.teamsRanked),
    },
    {
      detail: 'Final ratings',
      label: 'Average rating',
      value: formatRatingLabNumber(summary.averageRating),
    },
    {
      detail: 'Final ratings',
      label: 'Median rating',
      value: formatRatingLabNumber(summary.medianRating),
    },
    {
      detail: 'Distribution',
      label: 'Standard deviation',
      value: formatRatingLabNumber(summary.standardDeviation),
    },
    {
      detail: highestTeam
        ? `${highestTeam.teamName} - ${formatRatingLabNumber(
            summary.highestRatedTeam?.rating ?? highestTeam.finalRating,
          )}`
        : '--',
      label: 'Highest rated team',
      value: highestTeam?.abbreviation ?? '--',
    },
    {
      detail: lowestTeam
        ? `${lowestTeam.teamName} - ${formatRatingLabNumber(
            summary.lowestRatedTeam?.rating ?? lowestTeam.finalRating,
          )}`
        : '--',
      label: 'Lowest rated team',
      value: lowestTeam?.abbreviation ?? '--',
    },
    {
      detail: 'Highest minus lowest',
      label: 'Rating range',
      value: formatRatingLabNumber(summary.ratingRange),
    },
  ]

  return (
    <div className="rating-lab-summary-grid" aria-label="Replay summary">
      {summaryCards.map((card) => (
        <SummaryMetric
          detail={card.detail}
          key={card.label}
          label={card.label}
          value={card.value}
        />
      ))}
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

function CompactTeamList({ teams, title }) {
  return (
    <section className="rating-lab-board" aria-label={title}>
      <div className="rating-lab-board-heading">
        <h3>{title}</h3>
      </div>
      <div className="rating-lab-compact-list">
        {teams.map((team) => (
          <div className="rating-lab-compact-row" key={`${title}-${team.teamId}`}>
            <span className="rating-lab-rank">#{team.rank}</span>
            <TeamIdentity team={team} compact />
            <strong>{formatRatingLabNumber(team.finalRating)}</strong>
            <ChangeBadge value={team.netChange} />
          </div>
        ))}
      </div>
    </section>
  )
}

function MoverList({ teams, title }) {
  return (
    <section className="rating-lab-board" aria-label={title}>
      <div className="rating-lab-board-heading">
        <h3>{title}</h3>
      </div>
      <div className="rating-lab-mover-list">
        {teams.map((team) => (
          <div className="rating-lab-mover-row" key={`${title}-${team.teamId}`}>
            <TeamIdentity team={team} compact />
            <span>{formatRatingLabNumber(team.startingRating)}</span>
            <span>{formatRatingLabNumber(team.finalRating)}</span>
            <ChangeBadge value={team.netChange} />
          </div>
        ))}
      </div>
    </section>
  )
}

function SkipReasons({ skipReasons = {} }) {
  const skipEntries = Object.entries(skipReasons)
    .filter(([, count]) => Number(count) > 0)
    .sort(([reasonA], [reasonB]) =>
      formatSkipReasonLabel(reasonA).localeCompare(formatSkipReasonLabel(reasonB)),
    )

  return (
    <section className="rating-lab-skip-panel" aria-label="Skipped-game issues">
      <div className="rating-lab-board-heading">
        <h3>Skipped-game issues</h3>
      </div>
      {skipEntries.length > 0 ? (
        <div className="rating-lab-skip-list">
          {skipEntries.map(([reason, count]) => (
            <div className="rating-lab-skip-row" key={reason}>
              <span>{formatSkipReasonLabel(reason)}</span>
              <strong>{formatRatingLabInteger(count)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>No skipped-game issues</p>
      )}
    </section>
  )
}

function Warnings({ warnings = [] }) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return null
  }

  return (
    <section className="rating-lab-warning-panel" aria-label="Replay warnings">
      <div className="rating-lab-board-heading">
        <h3>Replay warnings</h3>
      </div>
      {warnings.map((warning) => (
        <p key={`${warning.code}-${warning.message}`}>
          {warning.message || warning.code}
        </p>
      ))}
    </section>
  )
}

function RankingTable({ onSort, sortState, teams }) {
  return (
    <section className="rating-lab-table-panel" aria-label="Full ranking table">
      <div className="rating-lab-board-heading">
        <h3>Full ranking</h3>
        <span>{formatRatingLabInteger(teams.length)} teams</span>
      </div>
      <div className="rating-lab-table-scroll">
        <table className="rating-lab-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              {sortableColumns.map((column) => (
                <th
                  aria-sort={getAriaSort(sortState, column.key)}
                  key={column.key}
                  scope="col"
                >
                  <button
                    className="rating-lab-sort-button"
                    type="button"
                    onClick={() => onSort(column.key)}
                  >
                    <span>{column.label}</span>
                    <ArrowDownUp aria-hidden="true" size={14} strokeWidth={2.3} />
                    <small>{getSortDirectionLabel(sortState, column.key)}</small>
                  </button>
                </th>
              ))}
              <th scope="col">Games</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.teamId}>
                <td className="rating-lab-rank-cell">#{team.rank}</td>
                <td>
                  <TeamIdentity team={team} />
                </td>
                <td>{formatRatingLabNumber(team.startingRating)}</td>
                <td>{formatRatingLabNumber(team.finalRating)}</td>
                <td>
                  <ChangeBadge value={team.netChange} />
                </td>
                <td>{formatRatingLabInteger(team.gamesProcessed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ChangeBadge({ value }) {
  const tone = getChangeTone(value)

  return (
    <span className={`rating-lab-change ${tone}`}>
      <strong>{formatRatingLabChange(value)}</strong>
      <small>{getChangeLabel(value)}</small>
    </span>
  )
}

function TeamIdentity({ compact = false, team }) {
  return (
    <div className={`rating-lab-team ${compact ? 'compact' : ''}`}>
      <TeamLogo team={team} />
      <span>
        <strong>{team.abbreviation}</strong>
        <small>{team.teamName}</small>
      </span>
    </div>
  )
}

function TeamLogo({ team }) {
  const [hasLogoError, setHasLogoError] = useState(false)
  const logo = getTeamMetadata(team.abbreviation).logo
  const showLogo = logo && !hasLogoError

  return (
    <span className="rating-lab-team-logo" aria-hidden="true">
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
    </span>
  )
}

export default RatingLab
