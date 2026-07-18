import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createBet,
  deleteBet,
  fetchBets,
  updateBet,
} from '../services/betsApi.js'
import {
  BET_RESULT_OPTIONS,
  calculateProfit,
  createBetPayloadFromSavedAnalysis,
  getBetSignature,
  hasSavedAnalysesInLocalStorage,
  loadSavedAnalyses,
  normalizeBets,
  removeSavedAnalyses,
} from '../utils/savedAnalyses.js'
import {
  MODEL_STATUSES,
  PROBABILITY_EDGE_HELP_TEXT,
} from '../utils/calculateGame.js'

const filterOptions = [
  {
    value: 'pending',
    label: 'Pending',
  },
  {
    value: 'settled',
    label: 'Settled',
  },
  {
    value: 'all',
    label: 'All',
  },
  {
    value: 'win',
    label: 'Win',
  },
  {
    value: 'loss',
    label: 'Loss',
  },
]

const modelStatusFilterOptions = [
  {
    value: 'all',
    label: 'All statuses',
  },
  {
    value: MODEL_STATUSES.POSITIVE_VALUE,
    label: MODEL_STATUSES.POSITIVE_VALUE,
  },
  {
    value: MODEL_STATUSES.BELOW_THRESHOLD,
    label: MODEL_STATUSES.BELOW_THRESHOLD,
  },
  {
    value: MODEL_STATUSES.NO_VALUE,
    label: MODEL_STATUSES.NO_VALUE,
  },
  {
    value: MODEL_STATUSES.LEGACY,
    label: MODEL_STATUSES.LEGACY,
  },
]

const formatDate = (dateTime) => {
  const date = new Date(dateTime)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const toNumber = (value) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

const toNullableNumber = (value) => {
  if (value === null || value === '' || value === undefined) {
    return null
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

const formatOdds = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : number.toFixed(2)
}
const formatPercent = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : `${(number * 100).toFixed(1)}%`
}
const formatProbabilityEdge = (value) =>
  toNullableNumber(value) === null
    ? '--'
    : `${toNumber(value) >= 0 ? '+' : ''}${(toNumber(value) * 100).toFixed(
        1,
      )} pp`
const formatExpectedValue = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : `${number >= 0 ? '+' : ''}${number.toFixed(1)}%`
}
const formatUnits = (value) => `${toNumber(value).toFixed(2)}u`
const formatSignedUnits = (value) =>
  `${toNumber(value) >= 0 ? '+' : ''}${formatUnits(value)}`
const formatSignedNumber = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : `${number >= 0 ? '+' : ''}${number.toFixed(1)}`
}
const formatNumber = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : number.toFixed(1)
}
const formatInteger = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : String(Math.round(number))
}
const formatSavePercentage = (value) => {
  const number = toNullableNumber(value)
  return number === null ? '--' : number.toFixed(3).replace(/^0/, '')
}
const modelStatusClass = (modelStatus = '') =>
  String(modelStatus ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const profitClass = (profit) =>
  profit > 0 ? 'positive' : profit < 0 ? 'negative' : ''

const isSettledResult = (result) => result !== 'pending'

const filterBetsByResult = (bets, filter) => {
  if (filter === 'all') {
    return bets
  }

  if (filter === 'settled') {
    return bets.filter((bet) => isSettledResult(bet.result))
  }

  return bets.filter((bet) => bet.result === filter)
}

const filterBets = (bets, resultFilter, modelStatusFilter) => {
  const resultFilteredBets = filterBetsByResult(bets, resultFilter)

  if (modelStatusFilter === 'all') {
    return resultFilteredBets
  }

  return resultFilteredBets.filter(
    (bet) => bet.modelStatus === modelStatusFilter,
  )
}

function BetTracker() {
  const [bets, setBets] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [filter, setFilter] = useState('pending')
  const [modelStatusFilter, setModelStatusFilter] = useState('all')
  const [actionMessage, setActionMessage] = useState('')
  const [actionStatus, setActionStatus] = useState('idle')
  const [migrationAvailable, setMigrationAvailable] = useState(() =>
    hasSavedAnalysesInLocalStorage(),
  )
  const [migrationStatus, setMigrationStatus] = useState('idle')
  const [migrationMessage, setMigrationMessage] = useState('')

  const applyBets = useCallback((nextBets) => {
    const normalizedBets = normalizeBets(nextBets)

    setBets(normalizedBets)
    setStatus('success')

    return normalizedBets
  }, [])

  const loadBets = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      applyBets(await fetchBets())
      setMigrationAvailable(hasSavedAnalysesInLocalStorage())
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [applyBets])

  useEffect(() => {
    let isCurrent = true

    const loadInitialBets = async () => {
      try {
        const nextBets = await fetchBets()

        if (!isCurrent) {
          return
        }

        applyBets(nextBets)
        setMigrationAvailable(hasSavedAnalysesInLocalStorage())
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    }

    loadInitialBets()

    return () => {
      isCurrent = false
    }
  }, [applyBets])

  const summary = useMemo(
    () =>
      bets.reduce(
        (totals, bet) => {
          const profit = Number.isFinite(bet.profit)
            ? bet.profit
            : calculateProfit(bet)
          const isSettled = isSettledResult(bet.result)

          totals.totalBets += 1
          totals.totalProfit += profit
          totals.totalStake += bet.stake

          if (bet.result === 'win') {
            totals.wins += 1
          } else if (bet.result === 'loss') {
            totals.losses += 1
          } else if (bet.result === 'push') {
            totals.pushes += 1
          } else if (bet.result === 'pending') {
            totals.pending += 1
          }

          totals.statusCounts[bet.modelStatus] =
            (totals.statusCounts[bet.modelStatus] ?? 0) + 1

          if (isSettled) {
            totals.settledStake += bet.stake
          }

          return totals
        },
        {
          totalBets: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          pending: 0,
          totalProfit: 0,
          totalStake: 0,
          settledStake: 0,
          statusCounts: {
            [MODEL_STATUSES.POSITIVE_VALUE]: 0,
            [MODEL_STATUSES.BELOW_THRESHOLD]: 0,
            [MODEL_STATUSES.NO_VALUE]: 0,
            [MODEL_STATUSES.LEGACY]: 0,
          },
        },
      ),
    [bets],
  )
  const roi = summary.settledStake
    ? summary.totalProfit / summary.settledStake
    : 0
  const visibleBets = useMemo(
    () => filterBets(bets, filter, modelStatusFilter),
    [bets, filter, modelStatusFilter],
  )

  const replaceBet = (updatedBet) => {
    setBets((currentBets) =>
      normalizeBets(
        currentBets.map((bet) => (bet.id === updatedBet.id ? updatedBet : bet)),
      ),
    )
  }

  const handleUpdateBet = async (betId, updates) => {
    const updatedBet = await updateBet(betId, updates)

    replaceBet(updatedBet)
    setActionStatus('success')
    setActionMessage('Bet updated.')

    return updatedBet
  }

  const handleDeleteBet = async (betId) => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm('Delete this saved bet? This cannot be undone.')

    if (!confirmed) {
      return
    }

    await deleteBet(betId)
    setBets((currentBets) => currentBets.filter((bet) => bet.id !== betId))
    setActionStatus('success')
    setActionMessage('Bet deleted.')
  }

  const handleImportLocalBets = async () => {
    const localAnalyses = loadSavedAnalyses()

    if (localAnalyses.length === 0) {
      setMigrationAvailable(false)
      setMigrationStatus('success')
      setMigrationMessage('No old local bets were found.')
      return
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        `Import ${localAnalyses.length} old local saved ${
          localAnalyses.length === 1 ? 'bet' : 'bets'
        } into MongoDB? Existing matching bets will be skipped.`,
      )

    if (!confirmed) {
      return
    }

    setMigrationStatus('saving')
    setMigrationMessage('')

    try {
      const existingBets = normalizeBets(await fetchBets())
      const existingSignatures = new Set(existingBets.map(getBetSignature))
      const localBetPayloads = localAnalyses.map(createBetPayloadFromSavedAnalysis)
      const newBetPayloads = localBetPayloads.filter((payload) => {
        const signature = getBetSignature(payload)

        if (existingSignatures.has(signature)) {
          return false
        }

        existingSignatures.add(signature)
        return true
      })
      const importedBets = []

      for (const payload of newBetPayloads) {
        importedBets.push(await createBet(payload))
      }

      applyBets([...importedBets, ...existingBets])
      setMigrationStatus('success')
      setMigrationMessage(
        `Imported ${importedBets.length} old local ${
          importedBets.length === 1 ? 'bet' : 'bets'
        }. Skipped ${localBetPayloads.length - newBetPayloads.length} duplicate ${
          localBetPayloads.length - newBetPayloads.length === 1
            ? 'bet'
            : 'bets'
        }.`,
      )
    } catch (error) {
      setMigrationStatus('error')
      setMigrationMessage(error.message)
    }
  }

  const handleRemoveLocalBets = () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm('Remove old local saved analyses from this browser?')

    if (!confirmed) {
      return
    }

    removeSavedAnalyses()
    setMigrationAvailable(false)
    setMigrationStatus('success')
    setMigrationMessage('Old local saved analyses were removed.')
  }

  return (
    <section className="bet-tracker-page" aria-label="Bet Tracker">
      <div className="tracker-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Bet Tracker</p>
            <h2>Saved Analyses</h2>
          </div>
          <span>{bets.length} MongoDB saved</span>
        </div>

        {migrationAvailable ? (
          <div className="migration-panel">
            <div>
              <strong>Old local saved analyses found</strong>
              <p>
                Importing is optional. Local data will stay in place until a
                successful import and explicit removal.
              </p>
            </div>
            <button
              type="button"
              disabled={migrationStatus === 'saving'}
              onClick={handleImportLocalBets}
            >
              {migrationStatus === 'saving' ? 'Importing...' : 'Import old local bets'}
            </button>
          </div>
        ) : null}

        {migrationMessage ? (
          <div className={`form-status-row ${migrationStatus}`}>
            <p className={`form-status ${migrationStatus}`}>
              {migrationMessage}
            </p>
            {migrationStatus === 'success' && hasSavedAnalysesInLocalStorage() ? (
              <button
                className="secondary-inline-button"
                type="button"
                onClick={handleRemoveLocalBets}
              >
                Remove old local data
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="bet-summary" aria-label="Bet tracker summary">
          <SummaryMetric
            label="Total bets"
            value={String(summary.totalBets)}
            detail={`${summary.pending} pending`}
          />
          <SummaryMetric
            label="Record"
            value={`${summary.wins}-${summary.losses}-${summary.pushes}`}
            detail="W-L-P"
          />
          <SummaryMetric
            label="Total stake"
            value={formatUnits(summary.totalStake)}
            detail="All bets"
          />
          <SummaryMetric
            label="Profit"
            value={formatSignedUnits(summary.totalProfit)}
            detail="Units"
            tone={profitClass(summary.totalProfit)}
          />
          <SummaryMetric
            label="ROI"
            value={formatPercent(roi)}
            detail={`${formatUnits(summary.settledStake)} settled`}
            tone={profitClass(roi)}
          />
        </div>

        <div className="status-count-summary" aria-label="Model status counts">
          {modelStatusFilterOptions
            .filter((option) => option.value !== 'all')
            .map((option) => (
              <span
                className={`status-count-pill ${modelStatusClass(option.value)}`}
                key={option.value}
              >
                {option.label}: {summary.statusCounts[option.value] ?? 0}
              </span>
            ))}
        </div>

        <div className="tracker-toolbar">
          <label className="field tracker-field" htmlFor="bet-filter">
            <span>Result</span>
            <select
              id="bet-filter"
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

          <label className="field tracker-field" htmlFor="model-status-filter">
            <span>Model status</span>
            <select
              id="model-status-filter"
              value={modelStatusFilter}
              onChange={(event) => setModelStatusFilter(event.target.value)}
            >
              {modelStatusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={loadBets}>
            Refresh
          </button>
        </div>

        {actionMessage ? (
          <p className={`form-status ${actionStatus}`}>{actionMessage}</p>
        ) : null}

        {status === 'loading' ? <TrackerLoadingState /> : null}

        {status === 'error' ? (
          <div className="ratings-state error" role="alert">
            <strong>Bet Tracker unavailable</strong>
            <p>{errorMessage}</p>
            <button type="button" onClick={loadBets}>
              Try again
            </button>
          </div>
        ) : null}

        {status === 'success' && visibleBets.length ? (
          <div className="bet-list">
            {visibleBets.map((bet) => (
              <BetCard
                bet={bet}
                key={`${bet.id}-${bet.updatedAt ?? ''}`}
                onDelete={() => handleDeleteBet(bet.id)}
                onUpdate={(updates) => handleUpdateBet(bet.id, updates)}
              />
            ))}
          </div>
        ) : null}

        {status === 'success' && !visibleBets.length ? (
          <p className="empty-state">
            {bets.length
              ? 'No bets match that filter.'
              : 'No saved analyses yet.'}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function TrackerLoadingState() {
  return (
    <div className="bet-list" aria-label="Loading bets">
      {[0, 1, 2].map((item) => (
        <div className="bet-card bet-card-loading" key={item}>
          <span />
          <strong />
          <div />
        </div>
      ))}
    </div>
  )
}

function SummaryMetric({ label, value, detail, tone = '' }) {
  return (
    <div className={`summary-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function BetCard({ bet, onDelete, onUpdate }) {
  const [draft, setDraft] = useState(() => ({
    closingOdds: bet.closingOdds === '' ? '' : String(bet.closingOdds),
    notes: bet.notes,
    sportsbook: bet.sportsbook,
    stake: String(bet.stake),
  }))
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')

  const profit = Number.isFinite(bet.profit) ? bet.profit : calculateProfit(bet)

  const updateField = async (updates) => {
    setStatus('saving')
    setMessage('')

    try {
      await onUpdate(updates)
      setStatus('success')
      setMessage('Saved')
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    }
  }

  const handleDraftChange = (field, value) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setStatus('idle')
    setMessage('')
  }

  const handleDraftBlur = (field) => {
    if (field === 'stake') {
      const nextStake = Math.max(toNumber(draft.stake), 0.01)

      if (nextStake !== bet.stake) {
        updateField({ stake: nextStake })
      }

      setDraft((currentDraft) => ({
        ...currentDraft,
        stake: String(nextStake),
      }))
      return
    }

    if (field === 'closingOdds') {
      const nextClosingOdds =
        String(draft.closingOdds).trim() === ''
          ? null
          : Number(draft.closingOdds)

      if (
        nextClosingOdds !== null &&
        (!Number.isFinite(nextClosingOdds) || nextClosingOdds <= 1)
      ) {
        setStatus('error')
        setMessage('Closing odds must be greater than 1.')
        return
      }

      if ((nextClosingOdds ?? '') !== bet.closingOdds) {
        updateField({ closingOdds: nextClosingOdds })
      }
      return
    }

    const nextValue = draft[field].trim()

    if (nextValue !== bet[field]) {
      updateField({ [field]: nextValue })
    }
  }

  return (
    <article className={`bet-card ${modelStatusClass(bet.modelStatus)}`}>
      <div className="bet-card-main">
        <div className="bet-date">
          <span>Date</span>
          <strong>{formatDate(bet.analyzedAt)}</strong>
        </div>

        <div className="bet-game">
          <span>Game</span>
          <strong>
            {bet.homeTeam.name} vs {bet.awayTeam.name}
          </strong>
          <small>
            {bet.homeTeam.abbreviation} vs {bet.awayTeam.abbreviation}
          </small>
        </div>

        <div className="bet-side">
          <span>Selected side</span>
          <strong>{bet.selectedSide.name}</strong>
          <small>{bet.selectedSide.homeAway === 'home' ? 'Home' : 'Away'}</small>
        </div>
      </div>

      <div className="bet-odds-grid">
        <BetStat
          label="Model status"
          value={bet.modelStatus}
          tone={modelStatusClass(bet.modelStatus)}
        />
        <BetStat label="Fair odds" value={formatOdds(bet.fairOdds)} />
        <BetStat label="Market odds" value={formatOdds(bet.marketOdds)} />
        <BetStat
          label="Probability edge"
          title={PROBABILITY_EDGE_HELP_TEXT}
          value={formatProbabilityEdge(bet.probabilityEdge)}
          tone={
            toNullableNumber(bet.probabilityEdge) === null
              ? ''
              : bet.probabilityEdge >= 0
                ? 'positive'
                : 'negative'
          }
        />
        <BetStat
          label="Expected value"
          value={formatExpectedValue(bet.expectedValue)}
          tone={
            toNullableNumber(bet.expectedValue) === null
              ? ''
              : bet.expectedValue >= 0
                ? 'positive'
                : 'negative'
          }
        />
      </div>

      <div className="bet-controls">
        <label className="field tracker-field">
          <span>Result</span>
          <select
            value={bet.result}
            onChange={(event) => updateField({ result: event.target.value })}
          >
            {BET_RESULT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field tracker-field">
          <span>Stake</span>
          <input
            type="number"
            min="0.01"
            step="0.25"
            value={draft.stake}
            inputMode="decimal"
            onBlur={() => handleDraftBlur('stake')}
            onChange={(event) => handleDraftChange('stake', event.target.value)}
          />
        </label>

        <label className="field tracker-field">
          <span>Sportsbook</span>
          <input
            type="text"
            value={draft.sportsbook}
            onBlur={() => handleDraftBlur('sportsbook')}
            onChange={(event) =>
              handleDraftChange('sportsbook', event.target.value)
            }
          />
        </label>

        <label className="field tracker-field">
          <span>Closing odds</span>
          <input
            type="number"
            min="1.01"
            step="0.01"
            value={draft.closingOdds}
            inputMode="decimal"
            onBlur={() => handleDraftBlur('closingOdds')}
            onChange={(event) =>
              handleDraftChange('closingOdds', event.target.value)
            }
          />
        </label>

        <div className={`tracker-profit ${profitClass(profit)}`}>
          <span>Profit</span>
          <strong>{formatSignedUnits(profit)}</strong>
        </div>
      </div>

      <BetAnalysisDetails bet={bet} />

      <div className="bet-notes-row">
        <label className="field tracker-field">
          <span>Notes</span>
          <textarea
            value={draft.notes}
            onBlur={() => handleDraftBlur('notes')}
            onChange={(event) => handleDraftChange('notes', event.target.value)}
          />
        </label>

        <div className="bet-card-actions">
          {message ? (
            <span className={`save-analysis-status ${status}`}>{message}</span>
          ) : null}
          <button
            className="delete-bet-button"
            type="button"
            disabled={status === 'saving'}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}

const hasDisplayValue = (value) => value !== null && value !== '' && value !== '--'

const createDetailRow = (label, value, title) =>
  hasDisplayValue(value) ? { label, title, value } : null

const getGoalieDetail = (bet) => {
  if (!bet.selectedGoalieName) {
    return null
  }

  const goalieStats = [
    createDetailRow('SV%', formatSavePercentage(bet.selectedGoalieSavePercentage)),
    createDetailRow('GP', formatInteger(bet.selectedGoalieGamesPlayed)),
    createDetailRow('GS', formatInteger(bet.selectedGoalieGamesStarted)),
  ]
    .filter(Boolean)
    .map(({ label, value }) => `${label} ${value}`)

  return goalieStats.length
    ? `${bet.selectedGoalieName} (${goalieStats.join(', ')})`
    : bet.selectedGoalieName
}

const getEffectiveRatingsDetail = (bet) => {
  const awayRating = formatNumber(bet.awayEffectiveRating)
  const homeRating = formatNumber(bet.homeEffectiveRating)

  if (!hasDisplayValue(awayRating) && !hasDisplayValue(homeRating)) {
    return null
  }

  return `${bet.awayTeam.abbreviation} ${awayRating} / ${bet.homeTeam.abbreviation} ${homeRating}`
}

const getInjuryDetail = (bet) => {
  const total = formatSignedNumber(bet.totalInjuryAdjustment)

  if (!hasDisplayValue(total)) {
    return null
  }

  const stored = formatSignedNumber(bet.storedInjuryImpact)
  const game = formatSignedNumber(bet.gameInjuryAdjustment)

  if (hasDisplayValue(stored) || hasDisplayValue(game)) {
    return `${total} total (stored ${stored}, game ${game})`
  }

  return total
}

function BetAnalysisDetails({ bet }) {
  const rows = [
    createDetailRow('Model probability', formatPercent(bet.modelProbability)),
    createDetailRow(
      'Implied market probability',
      formatPercent(bet.impliedMarketProbability),
    ),
    createDetailRow(
      'Probability edge',
      formatProbabilityEdge(bet.probabilityEdge),
      PROBABILITY_EDGE_HELP_TEXT,
    ),
    createDetailRow('Effective ratings', getEffectiveRatingsDetail(bet)),
    createDetailRow('Rating difference', formatSignedNumber(bet.ratingDifference)),
    createDetailRow('Selected goalie', getGoalieDetail(bet)),
    createDetailRow('Goalie adjustment', formatSignedNumber(bet.goalieAdjustment)),
    createDetailRow('Injury adjustment', getInjuryDetail(bet)),
    createDetailRow(
      'Rest and fatigue',
      formatSignedNumber(bet.restFatigueAdjustment),
    ),
    createDetailRow('Motivation', formatSignedNumber(bet.motivationAdjustment)),
    createDetailRow('Manual / X-factor', formatSignedNumber(bet.manualAdjustment)),
  ].filter(Boolean)

  if (rows.length === 0) {
    return null
  }

  return (
    <details className="bet-analysis-details">
      <summary>Analysis details</summary>
      <div className="bet-analysis-detail-grid">
        {rows.map((row) => (
          <div key={row.label} title={row.title}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </details>
  )
}

function BetStat({ label, title, value, tone = '' }) {
  return (
    <div className={`bet-stat ${tone}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default BetTracker
