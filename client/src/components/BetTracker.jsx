import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import {
  getBankrollSeasons,
  getBankrollSummary,
  getBankrollTransactions,
  initializeBankroll,
} from '../services/bankrollApi.js'
import {
  createBet,
  deleteBet,
  fetchBets,
  fetchBetsPage,
  settleCompletedBets,
  updateBet,
} from '../services/betsApi.js'
import {
  BANKROLL_DEFAULT_CURRENCY,
  BANKROLL_DEFAULT_LIMIT,
  BANKROLL_DEFAULT_PAGE,
  BANKROLL_LIMIT_OPTIONS,
  BANKROLL_SEASON_ALL,
  BANKROLL_SEASON_CURRENT,
  BANKROLL_SEASON_CUSTOM,
  BANKROLL_TRANSACTION_TYPES,
  applyBankrollPeriodSelection,
  createDefaultBankrollFilters,
  formatBankrollCurrency,
  formatBankrollDate,
  formatSignedBankrollCurrency,
  getBankrollDateFields,
  getBankrollPeriodSelectValue,
  getBankrollTransactionLabel,
  getBankrollTransactionTone,
  validateBankrollFilters,
  validateBankrollInitialization,
} from '../utils/bankroll.js'
import {
  BET_HISTORY_DEFAULT_LIMIT,
  BET_HISTORY_DEFAULT_PAGE,
  BET_HISTORY_LIMIT_OPTIONS,
  BET_HISTORY_MODEL_STATUSES,
  BET_HISTORY_SEASON_ALL,
  BET_HISTORY_SEASON_CURRENT,
  createEmptyBetHistoryResponse,
  normalizeBetHistoryModelStatus,
} from '../utils/betHistory.js'
import {
  BET_RESULT_OPTIONS,
  calculateProfit,
  createBetPayloadFromSavedAnalysis,
  formatSettlementSummary,
  getBetSettlementDisplay,
  getBetSignature,
  hasSavedAnalysesInLocalStorage,
  loadSavedAnalyses,
  normalizeBets,
  removeSavedAnalyses,
} from '../utils/savedAnalyses.js'
import { PROBABILITY_EDGE_HELP_TEXT } from '../utils/calculateGame.js'
import { formatSignedGameContextAdjustment } from '../utils/gameContext.js'
import { formatGoalieSelectionSnapshot } from '../utils/goalies.js'
import { formatLocalDateInputValue } from '../utils/powerRatingUpdates.js'
import BankrollCashActions from './bankroll/BankrollCashActions.jsx'

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
    value: BET_HISTORY_MODEL_STATUSES.BET_CANDIDATE,
    label: BET_HISTORY_MODEL_STATUSES.BET_CANDIDATE,
  },
  {
    value: BET_HISTORY_MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD,
    label: BET_HISTORY_MODEL_STATUSES.POSITIVE_VALUE_BELOW_THRESHOLD,
  },
  {
    value: BET_HISTORY_MODEL_STATUSES.NO_VALUE,
    label: BET_HISTORY_MODEL_STATUSES.NO_VALUE,
  },
  {
    value: BET_HISTORY_MODEL_STATUSES.LEGACY,
    label: BET_HISTORY_MODEL_STATUSES.LEGACY,
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
const formatResultProfit = (value) =>
  toNumber(value) === 0 ? formatUnits(0) : formatSignedUnits(value)
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

function BetTracker() {
  const todayInputValue = useMemo(() => formatLocalDateInputValue(new Date()), [])
  const [bets, setBets] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [filter, setFilter] = useState('pending')
  const [betSeasonFilter, setBetSeasonFilter] = useState(
    BET_HISTORY_SEASON_ALL,
  )
  const [modelStatusFilter, setModelStatusFilter] = useState('all')
  const [betPage, setBetPage] = useState(BET_HISTORY_DEFAULT_PAGE)
  const [betLimit, setBetLimit] = useState(BET_HISTORY_DEFAULT_LIMIT)
  const [betHistory, setBetHistory] = useState(() =>
    createEmptyBetHistoryResponse(),
  )
  const [actionMessage, setActionMessage] = useState('')
  const [actionStatus, setActionStatus] = useState('idle')
  const [settlementStatus, setSettlementStatus] = useState('idle')
  const [migrationAvailable, setMigrationAvailable] = useState(() =>
    hasSavedAnalysesInLocalStorage(),
  )
  const [migrationStatus, setMigrationStatus] = useState('idle')
  const [migrationMessage, setMigrationMessage] = useState('')
  const [bankrollSummary, setBankrollSummary] = useState(null)
  const [bankrollTransactions, setBankrollTransactions] = useState(null)
  const [bankrollStatus, setBankrollStatus] = useState('loading')
  const [bankrollErrorMessage, setBankrollErrorMessage] = useState('')
  const [bankrollSeasonMetadata, setBankrollSeasonMetadata] = useState(null)
  const [bankrollSeasonStatus, setBankrollSeasonStatus] = useState('loading')
  const [bankrollSeasonError, setBankrollSeasonError] = useState('')
  const [bankrollFilters, setBankrollFilters] = useState(() =>
    createDefaultBankrollFilters(),
  )
  const [bankrollDraftFilters, setBankrollDraftFilters] = useState(() =>
    createDefaultBankrollFilters(),
  )
  const [bankrollPage, setBankrollPage] = useState(BANKROLL_DEFAULT_PAGE)
  const [bankrollLimit, setBankrollLimit] = useState(BANKROLL_DEFAULT_LIMIT)
  const [bankrollActionStatus, setBankrollActionStatus] = useState('idle')
  const [bankrollActionMessage, setBankrollActionMessage] = useState('')
  const [bankrollSetupDraft, setBankrollSetupDraft] = useState(() => ({
    currency: BANKROLL_DEFAULT_CURRENCY,
    startDate: formatLocalDateInputValue(new Date()),
    startingBalance: '',
  }))
  const applyBetHistory = useCallback((nextHistory) => {
    setBetHistory(nextHistory)
    setBets(nextHistory.items)
    setStatus('success')

    return nextHistory
  }, [])

  const loadBankroll = useCallback(
    async ({
      filters: nextFilters = bankrollFilters,
      limit: nextLimit = bankrollLimit,
      page: nextPage = bankrollPage,
      quiet = false,
      shouldApply = () => true,
    } = {}) => {
      if (!quiet) {
        setBankrollStatus('loading')
      }
      setBankrollErrorMessage('')

      try {
        const [summaryResult, transactionResult] = await Promise.all([
          getBankrollSummary({
            filters: nextFilters,
            seasonMetadata: bankrollSeasonMetadata,
          }),
          getBankrollTransactions({
            filters: nextFilters,
            limit: nextLimit,
            page: nextPage,
            seasonMetadata: bankrollSeasonMetadata,
          }),
        ])

        if (!shouldApply()) {
          return
        }

        setBankrollSummary(summaryResult)
        setBankrollTransactions(transactionResult)
        setBankrollStatus('success')
      } catch (error) {
        if (!shouldApply()) {
          return
        }

        setBankrollStatus('error')
        setBankrollErrorMessage(error.message)
      }
    },
    [bankrollFilters, bankrollLimit, bankrollPage, bankrollSeasonMetadata],
  )

  const refreshBankrollQuietly = useCallback(async () => {
    if (!bankrollSummary?.initialized) {
      return
    }

    await loadBankroll({ quiet: true })
  }, [bankrollSummary?.initialized, loadBankroll])

  const loadBets = useCallback(
    async ({
      limit: nextLimit = betLimit,
      modelStatus: nextModelStatus = modelStatusFilter,
      page: nextPage = betPage,
      quiet = false,
      result: nextResult = filter,
      season: nextSeason = betSeasonFilter,
      shouldApply = () => true,
    } = {}) => {
      if (!quiet) {
        setStatus('loading')
      }
      setErrorMessage('')

      try {
        const nextHistory = await fetchBetsPage({
          limit: nextLimit,
          modelStatus: nextModelStatus,
          page: nextPage,
          result: nextResult,
          season: nextSeason,
        })

        if (!shouldApply()) {
          return
        }

        applyBetHistory(nextHistory)
        setMigrationAvailable(hasSavedAnalysesInLocalStorage())
      } catch (error) {
        if (!shouldApply()) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    },
    [
      applyBetHistory,
      betLimit,
      betPage,
      betSeasonFilter,
      filter,
      modelStatusFilter,
    ],
  )

  useEffect(() => {
    let isCurrent = true

    const loadInitialBets = async () => {
      await loadBets({
        shouldApply: () => isCurrent,
      })
    }

    loadInitialBets()

    return () => {
      isCurrent = false
    }
  }, [loadBets])

  useEffect(() => {
    let isCurrent = true

    getBankrollSeasons()
      .then((result) => {
        if (!isCurrent) {
          return
        }

        setBankrollSeasonMetadata(result)
        setBankrollSeasonStatus('success')
        setBankrollSeasonError('')
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setBankrollSeasonMetadata(null)
        setBankrollSeasonStatus('error')
        setBankrollSeasonError(error.message)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadCurrentBankroll = async () => {
      await loadBankroll({
        shouldApply: () => isCurrent,
      })
    }

    if (isCurrent) {
      loadCurrentBankroll()
    }

    return () => {
      isCurrent = false
    }
  }, [loadBankroll])

  const summary = betHistory.summary
  const roi = summary.settledStake
    ? summary.totalProfit / summary.settledStake
    : 0
  const bankrollFilterValidation = useMemo(
    () =>
      validateBankrollFilters(bankrollDraftFilters, {
        seasonMetadata: bankrollSeasonMetadata,
        today: todayInputValue,
      }),
    [bankrollDraftFilters, bankrollSeasonMetadata, todayInputValue],
  )
  const bankrollSetupValidation = useMemo(
    () =>
      validateBankrollInitialization(bankrollSetupDraft, {
        today: todayInputValue,
      }),
    [bankrollSetupDraft, todayInputValue],
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
    await Promise.all([
      loadBets({ quiet: true }),
      refreshBankrollQuietly(),
    ])

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
    const nextPage = bets.length === 1 && betPage > 1 ? betPage - 1 : betPage

    if (nextPage !== betPage) {
      setBetPage(nextPage)
    } else {
      await loadBets({ page: nextPage, quiet: true })
    }
    await refreshBankrollQuietly()
  }

  const handleSettleCompletedBets = async () => {
    setSettlementStatus('saving')
    setActionStatus('idle')
    setActionMessage('')

    try {
      const settlementSummary = await settleCompletedBets()

      await loadBets({ quiet: true })
      await refreshBankrollQuietly()
      setSettlementStatus('success')
      setActionStatus('success')
      setActionMessage(formatSettlementSummary(settlementSummary))
    } catch (error) {
      setSettlementStatus('error')
      setActionStatus('error')
      setActionMessage(error.message)
    }
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
        } into your Bet Tracker account? Existing matching bets will be skipped.`,
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

      setBetPage(BET_HISTORY_DEFAULT_PAGE)
      await loadBets({
        page: BET_HISTORY_DEFAULT_PAGE,
        quiet: true,
      })
      await refreshBankrollQuietly()
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

  const handleBankrollSetupChange = (field, value) => {
    setBankrollSetupDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleInitializeBankroll = async (event) => {
    event.preventDefault()

    if (!bankrollSetupValidation.isValid) {
      setBankrollActionStatus('error')
      setBankrollActionMessage(bankrollSetupValidation.message)
      return
    }

    setBankrollActionStatus('saving')
    setBankrollActionMessage('')

    try {
      const result = await initializeBankroll(bankrollSetupDraft)
      const defaultFilters = createDefaultBankrollFilters()

      setBankrollSummary(result.summary)
      setBankrollFilters(defaultFilters)
      setBankrollDraftFilters(defaultFilters)
      setBankrollPage(BANKROLL_DEFAULT_PAGE)
      setBankrollActionStatus('success')
      setBankrollActionMessage('Bankroll initialized.')
      await loadBankroll({
        filters: defaultFilters,
        page: BANKROLL_DEFAULT_PAGE,
        quiet: true,
      })
    } catch (error) {
      setBankrollActionStatus('error')
      setBankrollActionMessage(error.message)
    }
  }

  const handleBankrollDraftFilterChange = (field, value) => {
    setBankrollDraftFilters((currentFilters) => {
      if (field === 'period') {
        return applyBankrollPeriodSelection(
          currentFilters,
          value,
          bankrollSeasonMetadata,
        )
      }

      return {
        ...currentFilters,
        [field]: value,
      }
    })
    setBankrollPage(BANKROLL_DEFAULT_PAGE)
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleApplyBankrollFilters = (event) => {
    event.preventDefault()

    if (!bankrollFilterValidation.isValid) {
      setBankrollActionStatus('error')
      setBankrollActionMessage(bankrollFilterValidation.message)
      return
    }

    setBankrollFilters(bankrollDraftFilters)
    setBankrollPage(BANKROLL_DEFAULT_PAGE)
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleClearBankrollFilters = () => {
    const defaultFilters = createDefaultBankrollFilters()

    setBankrollDraftFilters(defaultFilters)
    setBankrollFilters(defaultFilters)
    setBankrollPage(BANKROLL_DEFAULT_PAGE)
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleBankrollCashTransactionRecorded = async (result) => {
    setBankrollSummary(result.summary)
    setBankrollPage(BANKROLL_DEFAULT_PAGE)
    await loadBankroll({
      page: BANKROLL_DEFAULT_PAGE,
      quiet: true,
    })
  }

  const handleBankrollPageChange = (nextPage) => {
    setBankrollPage(nextPage)
  }

  const handleBetFilterChange = (nextFilter) => {
    setFilter(nextFilter)
    setBetPage(BET_HISTORY_DEFAULT_PAGE)
  }

  const handleBetSeasonFilterChange = (nextFilter) => {
    setBetSeasonFilter(nextFilter)
    setBetPage(BET_HISTORY_DEFAULT_PAGE)
  }

  const handleModelStatusFilterChange = (nextFilter) => {
    setModelStatusFilter(nextFilter)
    setBetPage(BET_HISTORY_DEFAULT_PAGE)
  }

  return (
    <section className="bet-tracker-page" aria-label="Bet Tracker">
      <div className="tracker-panel">
        <div className="section-heading bet-tracker-heading">
          <div>
            <p className="eyebrow">Bet Tracker</p>
            <h2>Bankroll &amp; Bet History</h2>
          </div>
          <span>
            {summary.totalBets} {summary.totalBets === 1 ? 'bet' : 'bets'} ·{' '}
            {summary.pending} pending
          </span>
        </div>

        <BankrollPanel
          actionMessage={bankrollActionMessage}
          actionStatus={bankrollActionStatus}
          draftFilters={bankrollDraftFilters}
          errorMessage={bankrollErrorMessage}
          filterValidation={bankrollFilterValidation}
          limit={bankrollLimit}
          seasonError={bankrollSeasonError}
          seasonMetadata={bankrollSeasonMetadata}
          seasonStatus={bankrollSeasonStatus}
          setupDraft={bankrollSetupDraft}
          setupValidation={bankrollSetupValidation}
          status={bankrollStatus}
          summary={bankrollSummary}
          todayInputValue={todayInputValue}
          transactions={bankrollTransactions}
          onApplyFilters={handleApplyBankrollFilters}
          onCashTransactionRecorded={handleBankrollCashTransactionRecorded}
          onClearFilters={handleClearBankrollFilters}
          onFilterChange={handleBankrollDraftFilterChange}
          onInitialize={handleInitializeBankroll}
          onLimitChange={(nextLimit) => {
            setBankrollLimit(nextLimit)
            setBankrollPage(BANKROLL_DEFAULT_PAGE)
          }}
          onPageChange={handleBankrollPageChange}
          onRefresh={() => loadBankroll()}
          onRetrySeasons={() => {
            setBankrollSeasonStatus('loading')
            setBankrollSeasonError('')
            getBankrollSeasons()
              .then((result) => {
                setBankrollSeasonMetadata(result)
                setBankrollSeasonStatus('success')
              })
              .catch((error) => {
                setBankrollSeasonMetadata(null)
                setBankrollSeasonStatus('error')
                setBankrollSeasonError(error.message)
              })
          }}
          onSetupChange={handleBankrollSetupChange}
        />

        <section className="bet-history-panel" aria-label="Bet History">
          <div className="bet-history-heading">
            <div>
              <p className="eyebrow">Bet History</p>
              <h3>Saved bets / analyses</h3>
            </div>
            <span>{betHistory.pagination.totalItems} matching</span>
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
                {migrationStatus === 'saving'
                  ? 'Importing...'
                  : 'Import old local bets'}
              </button>
            </div>
          ) : null}

          {migrationMessage ? (
            <div className={`form-status-row ${migrationStatus}`}>
              <p className={`form-status ${migrationStatus}`}>
                {migrationMessage}
              </p>
              {migrationStatus === 'success' &&
              hasSavedAnalysesInLocalStorage() ? (
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

          <div className="bet-summary" aria-label="Bet history summary">
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
              detail="Selected scope · units"
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
            <label className="field tracker-field" htmlFor="bet-season-filter">
              <span>Season</span>
              <select
                id="bet-season-filter"
                value={betSeasonFilter}
                onChange={(event) =>
                  handleBetSeasonFilterChange(event.target.value)
                }
              >
                <option value={BET_HISTORY_SEASON_ALL}>All time</option>
                <option value={BET_HISTORY_SEASON_CURRENT}>Current season</option>
                {bankrollSeasonMetadata?.seasons?.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field tracker-field" htmlFor="bet-filter">
              <span>Result</span>
              <select
                id="bet-filter"
                value={filter}
                onChange={(event) => handleBetFilterChange(event.target.value)}
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
                onChange={(event) =>
                  handleModelStatusFilterChange(event.target.value)
                }
              >
                {modelStatusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field tracker-field bet-history-rows" htmlFor="bet-limit">
              <span>Rows</span>
              <select
                id="bet-limit"
                value={betLimit}
                onChange={(event) => {
                  setBetLimit(Number(event.target.value))
                  setBetPage(BET_HISTORY_DEFAULT_PAGE)
                }}
              >
                {BET_HISTORY_LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="bet-history-actions">
              <button
                className="secondary-inline-button"
                type="button"
                disabled={status === 'loading'}
                onClick={() => loadBets()}
              >
                <RefreshCw aria-hidden="true" size={15} />
                <span>Refresh</span>
              </button>
              <button
                className="secondary-inline-button"
                type="button"
                disabled={settlementStatus === 'saving'}
                title="Manually check pending linked moneyline bets against final NHL results."
                onClick={handleSettleCompletedBets}
              >
                <RefreshCw aria-hidden="true" size={15} />
                <span>
                  {settlementStatus === 'saving'
                    ? 'Checking results...'
                    : 'Settle completed bets'}
                </span>
              </button>
            </div>
          </div>

          <p className="settlement-action-help">
            Settlement is a manual fallback check for pending linked moneyline
            bets.
          </p>

          {actionMessage ? (
            <p className={`form-status ${actionStatus}`}>{actionMessage}</p>
          ) : null}

          {status === 'loading' ? <TrackerLoadingState /> : null}

          {status === 'error' ? (
            <div className="ratings-state error" role="alert">
              <strong>Bet History unavailable</strong>
              <p>{errorMessage}</p>
              <button type="button" onClick={() => loadBets()}>
                Try again
              </button>
            </div>
          ) : null}

          {status === 'success' && bets.length ? (
            <>
              <BetListHeader />
              <div className="bet-list">
                {bets.map((bet) => (
                  <BetCard
                    bet={bet}
                    key={bet.id}
                    onDelete={() => handleDeleteBet(bet.id)}
                    onUpdate={(updates) => handleUpdateBet(bet.id, updates)}
                  />
                ))}
              </div>
              <BetHistoryPagination
                pagination={betHistory.pagination}
                status={status}
                onPageChange={setBetPage}
              />
            </>
          ) : null}

          {status === 'success' && !bets.length ? (
            <p className="empty-state">
              {summary.totalBets
                ? 'No bets match that filter.'
                : 'No saved analyses yet.'}
            </p>
          ) : null}
        </section>
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

function BankrollPanel({
  actionMessage,
  actionStatus,
  draftFilters,
  errorMessage,
  filterValidation,
  limit,
  seasonError,
  seasonMetadata,
  seasonStatus,
  setupDraft,
  setupValidation,
  status,
  summary,
  todayInputValue,
  transactions,
  onApplyFilters,
  onCashTransactionRecorded,
  onClearFilters,
  onFilterChange,
  onInitialize,
  onLimitChange,
  onPageChange,
  onRefresh,
  onRetrySeasons,
  onSetupChange,
}) {
  const isLoading = status === 'loading' && !summary
  const isInitialized = Boolean(summary?.initialized)
  const isSaving = actionStatus === 'saving'

  return (
    <section className="bankroll-panel" aria-label="Bankroll">
      <div className="bankroll-heading">
        <div>
          <p className="eyebrow">Bankroll</p>
          <h3>
            <WalletCards aria-hidden="true" size={18} />
            <span>Transaction Ledger</span>
          </h3>
        </div>
        {summary ? (
          <span>{summary.initialized ? summary.currency : 'Not initialized'}</span>
        ) : null}
      </div>

      {seasonMetadata?.warning ? (
        <p className="form-status warning">{seasonMetadata.warning}</p>
      ) : null}

      {seasonStatus === 'error' ? (
        <div className="bankroll-feedback-row">
          <p className="form-status warning" role="status">
            Season options could not be loaded: {seasonError}
          </p>
          <button type="button" onClick={onRetrySeasons}>
            <RefreshCw aria-hidden="true" size={15} />
            <span>Retry Seasons</span>
          </button>
        </div>
      ) : null}

      {actionMessage ? (
        <p className={`form-status ${actionStatus}`} role="status">
          {actionMessage}
        </p>
      ) : null}

      {isLoading ? <BankrollLoadingState /> : null}

      {status === 'error' && !summary ? (
        <div className="ratings-state error" role="alert">
          <strong>Bankroll unavailable</strong>
          <p>{errorMessage}</p>
          <button type="button" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : null}

      {!isLoading && !isInitialized ? (
        <BankrollSetupForm
          draft={setupDraft}
          isSaving={isSaving}
          todayInputValue={todayInputValue}
          validation={setupValidation}
          onChange={onSetupChange}
          onSubmit={onInitialize}
        />
      ) : null}

      {isInitialized ? (
        <>
          <BankrollSummaryCards summary={summary} />
          <BankrollCashActions
            availableBankroll={summary.availableBankroll}
            currency={summary.currency}
            currentBankroll={summary.currentBankroll}
            todayInputValue={todayInputValue}
            onTransactionRecorded={onCashTransactionRecorded}
          />
          <BankrollControls
            draftFilters={draftFilters}
            filterValidation={filterValidation}
            isLoading={status === 'loading'}
            limit={limit}
            seasonMetadata={seasonMetadata}
            seasonStatus={seasonStatus}
            todayInputValue={todayInputValue}
            onApplyFilters={onApplyFilters}
            onClearFilters={onClearFilters}
            onFilterChange={onFilterChange}
            onLimitChange={onLimitChange}
            onRefresh={onRefresh}
          />
          <BankrollLedger
            currency={summary.currency}
            status={status}
            transactions={transactions}
            onPageChange={onPageChange}
          />
        </>
      ) : null}
    </section>
  )
}

function BankrollLoadingState() {
  return (
    <div className="bankroll-summary-grid" aria-label="Loading bankroll">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div className="summary-metric bankroll-loading-card" key={item}>
          <span />
          <strong />
          <small />
        </div>
      ))}
    </div>
  )
}

function BankrollSetupForm({
  draft,
  isSaving,
  todayInputValue,
  validation,
  onChange,
  onSubmit,
}) {
  return (
    <form className="bankroll-setup-form" onSubmit={onSubmit}>
      <p>
        Your starting balance becomes the first ledger transaction. Settled bets
        before the start date stay out of bankroll calculations.
      </p>
      <div className="bankroll-form-grid">
        <label className="field tracker-field" htmlFor="bankroll-starting-balance">
          <span>Starting Balance</span>
          <input
            aria-invalid={Boolean(validation.fieldErrors.startingBalance)}
            id="bankroll-starting-balance"
            inputMode="decimal"
            min="0"
            step="0.01"
            type="number"
            value={draft.startingBalance}
            onChange={(event) =>
              onChange('startingBalance', event.target.value)
            }
          />
          <small className="field-error-slot">
            {validation.fieldErrors.startingBalance || ' '}
          </small>
        </label>

        <label className="field tracker-field" htmlFor="bankroll-start-date">
          <span>Start Date</span>
          <input
            aria-invalid={Boolean(validation.fieldErrors.startDate)}
            id="bankroll-start-date"
            max={todayInputValue}
            type="date"
            value={draft.startDate}
            onChange={(event) => onChange('startDate', event.target.value)}
          />
          <small className="field-error-slot">
            {validation.fieldErrors.startDate || ' '}
          </small>
        </label>

        <label className="field tracker-field" htmlFor="bankroll-currency">
          <span>Currency</span>
          <select
            aria-invalid={Boolean(validation.fieldErrors.currency)}
            id="bankroll-currency"
            value={draft.currency}
            onChange={(event) => onChange('currency', event.target.value)}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
          </select>
          <small className="field-error-slot">
            {validation.fieldErrors.currency || ' '}
          </small>
        </label>
      </div>

      <div className="bankroll-form-actions">
        <button type="submit" disabled={isSaving}>
          <WalletCards aria-hidden="true" size={15} />
          <span>{isSaving ? 'Saving...' : 'Initialize Bankroll'}</span>
        </button>
      </div>
    </form>
  )
}

function BankrollSummaryCards({ summary }) {
  return (
    <div className="bankroll-summary-grid" aria-label="Bankroll summary">
      <SummaryMetric
        label="Current Bankroll"
        value={formatBankrollCurrency(
          summary.currentBankroll,
          summary.currency,
        )}
        detail={`Started ${formatBankrollDate(summary.initializedDate)}`}
      />
      <SummaryMetric
        label="Available Bankroll"
        value={formatBankrollCurrency(
          summary.availableBankroll,
          summary.currency,
        )}
        detail="Ready to wager"
        tone={profitClass(summary.availableBankroll)}
      />
      <SummaryMetric
        label="Betting Profit"
        value={formatSignedBankrollCurrency(
          summary.bettingProfit,
          summary.currency,
        )}
        detail="Selected period"
        tone={profitClass(summary.bettingProfit)}
      />
      <SummaryMetric
        label="Pending Exposure"
        value={formatBankrollCurrency(summary.pendingStake, summary.currency)}
        detail="Open stakes"
        tone={summary.pendingStake > 0 ? 'negative' : ''}
      />
    </div>
  )
}

function BankrollControls({
  draftFilters,
  filterValidation,
  isLoading,
  limit,
  seasonMetadata,
  seasonStatus,
  todayInputValue,
  onApplyFilters,
  onClearFilters,
  onFilterChange,
  onLimitChange,
  onRefresh,
}) {
  const periodValue = getBankrollPeriodSelectValue(draftFilters)
  const dateFields = getBankrollDateFields(draftFilters, seasonMetadata)
  const isCustomPeriod = periodValue === BANKROLL_SEASON_CUSTOM
  const hasSeasonOptions = seasonMetadata?.seasons?.length > 0
  const hasActiveFilters =
    periodValue !== BANKROLL_SEASON_ALL || Boolean(draftFilters.type)

  return (
    <form
      className={`bankroll-toolbar${
        isCustomPeriod ? ' bankroll-toolbar-custom' : ''
      }`}
      onSubmit={onApplyFilters}
    >
      <label className="field tracker-field" htmlFor="bankroll-period">
        <span>Period</span>
        <select
          disabled={seasonStatus === 'loading'}
          id="bankroll-period"
          value={periodValue}
          onChange={(event) => onFilterChange('period', event.target.value)}
        >
          <option value={BANKROLL_SEASON_ALL}>All time</option>
          <option value={BANKROLL_SEASON_CURRENT}>Current season</option>
          {seasonStatus === 'loading' ? (
            <option value={periodValue}>Loading seasons...</option>
          ) : null}
          {seasonStatus !== 'loading' && hasSeasonOptions
            ? seasonMetadata.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.label}
                </option>
              ))
            : null}
          <option value={BANKROLL_SEASON_CUSTOM}>Custom dates</option>
        </select>
        <small className="field-error-slot">
          {seasonMetadata?.metadataSource === 'fallback'
            ? 'Fallback season dates'
            : ' '}
        </small>
      </label>

      {isCustomPeriod ? (
        <>
          <label className="field tracker-field" htmlFor="bankroll-from">
            <span>Date From</span>
            <input
              aria-invalid={Boolean(filterValidation.fieldErrors.from)}
              id="bankroll-from"
              max={todayInputValue}
              type="date"
              value={dateFields.from}
              onChange={(event) => onFilterChange('from', event.target.value)}
            />
            <small className="field-error-slot">
              {filterValidation.fieldErrors.from || ' '}
            </small>
          </label>

          <label className="field tracker-field" htmlFor="bankroll-to">
            <span>Date To</span>
            <input
              aria-invalid={Boolean(filterValidation.fieldErrors.to)}
              id="bankroll-to"
              max={todayInputValue}
              type="date"
              value={dateFields.to}
              onChange={(event) => onFilterChange('to', event.target.value)}
            />
            <small className="field-error-slot">
              {filterValidation.fieldErrors.to || ' '}
            </small>
          </label>
        </>
      ) : null}

      <label className="field tracker-field" htmlFor="bankroll-type">
        <span>Ledger Type</span>
        <select
          id="bankroll-type"
          value={draftFilters.type}
          onChange={(event) => onFilterChange('type', event.target.value)}
        >
          <option value="">All types</option>
          {BANKROLL_TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {getBankrollTransactionLabel(type)}
            </option>
          ))}
        </select>
        <small className="field-error-slot"> </small>
      </label>

      <label className="field tracker-field" htmlFor="bankroll-limit">
        <span>Rows</span>
        <select
          id="bankroll-limit"
          value={limit}
          onChange={(event) => onLimitChange(Number(event.target.value))}
        >
          {BANKROLL_LIMIT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <small className="field-error-slot"> </small>
      </label>

      <div className="bankroll-filter-actions">
        <button type="submit" disabled={isLoading}>
          <RefreshCw aria-hidden="true" size={15} />
          <span>Apply</span>
        </button>
        <button
          className="secondary-inline-button"
          type="button"
          disabled={isLoading || !hasActiveFilters}
          onClick={onClearFilters}
        >
          Clear
        </button>
        <button
          className="secondary-inline-button"
          type="button"
          disabled={isLoading}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" size={15} />
          <span>Refresh</span>
        </button>
      </div>
    </form>
  )
}

function BankrollLedger({ currency, status, transactions, onPageChange }) {
  const items = transactions?.items ?? []
  const pagination = transactions?.pagination ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    page: BANKROLL_DEFAULT_PAGE,
    totalPages: 0,
  }
  const isLoading = status === 'loading'

  return (
    <div className="bankroll-ledger" aria-label="Bankroll transactions">
      <div className="bankroll-ledger-heading">
        <strong>Transaction History</strong>
        <span>{pagination.totalItems ?? 0} records</span>
      </div>

      {items.length ? (
        <div className="bankroll-ledger-table">
          <div className="bankroll-ledger-row bankroll-ledger-header">
            <span>Date</span>
            <span>Type</span>
            <span>Description</span>
            <span>Amount</span>
            <span>Balance</span>
            <span>Bet</span>
          </div>
          {items.map((transaction) => (
            <div className="bankroll-ledger-row" key={transaction.id}>
              <span>{formatBankrollDate(transaction.occurredDate)}</span>
              <span>{getBankrollTransactionLabel(transaction.type)}</span>
              <span>{transaction.description || 'No description'}</span>
              <strong className={getBankrollTransactionTone(transaction)}>
                {formatSignedBankrollCurrency(transaction.amount, currency)}
              </strong>
              <span>
                {transaction.runningBalance === null
                  ? '--'
                  : formatBankrollCurrency(transaction.runningBalance, currency)}
              </span>
              <span>
                {transaction.betId ? `Bet ${transaction.betId.slice(-6)}` : '--'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">
          {isLoading ? 'Loading transactions...' : 'No bankroll transactions yet.'}
        </p>
      )}

      <div className="bankroll-pagination">
        <button
          className="secondary-inline-button"
          type="button"
          disabled={isLoading || !pagination.hasPreviousPage}
          onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
        >
          <ChevronLeft aria-hidden="true" size={15} />
          <span>Prev</span>
        </button>
        <span>
          Page {pagination.page} / {pagination.totalPages || 1}
        </span>
        <button
          className="secondary-inline-button"
          type="button"
          disabled={isLoading || !pagination.hasNextPage}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          <span>Next</span>
          <ChevronRight aria-hidden="true" size={15} />
        </button>
      </div>
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

function BetListHeader() {
  return (
    <div className="bet-list-header" aria-hidden="true">
      <span>Date</span>
      <span>Game</span>
      <span>Pick</span>
      <span>Market odds</span>
      <span>Stake (u)</span>
      <span>Model status</span>
      <span>Result / Profit (u)</span>
      <span>Details</span>
    </div>
  )
}

function BetHistoryPagination({ pagination, status, onPageChange }) {
  const isLoading = status === 'loading'

  return (
    <div className="bet-history-pagination" aria-label="Bet history pages">
      <button
        className="secondary-inline-button"
        type="button"
        disabled={isLoading || !pagination.hasPreviousPage}
        onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
      >
        <ChevronLeft aria-hidden="true" size={15} />
        <span>Prev</span>
      </button>
      <span>
        Page {pagination.page} / {pagination.totalPages || 1}
      </span>
      <button
        className="secondary-inline-button"
        type="button"
        disabled={isLoading || !pagination.hasNextPage}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        <span>Next</span>
        <ChevronRight aria-hidden="true" size={15} />
      </button>
    </div>
  )
}

const getCompactResultLabel = (result) => {
  if (result === 'win') {
    return 'Won'
  }

  if (result === 'loss') {
    return 'Lost'
  }

  if (result === 'void') {
    return 'Void'
  }

  if (result === 'push') {
    return 'Push'
  }

  return 'Pending'
}

function BetCard({ bet, initialExpanded = false, onDelete, onUpdate }) {
  const [draft, setDraft] = useState(() => ({
    closingOdds: bet.closingOdds === '' ? '' : String(bet.closingOdds),
    notes: bet.notes,
    sportsbook: bet.sportsbook,
    stake: String(bet.stake),
  }))
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const detailsId = useId()

  const profit = Number.isFinite(bet.profit) ? bet.profit : calculateProfit(bet)
  const settlementDisplay = getBetSettlementDisplay(bet)
  const isSettled = bet.result !== 'pending'
  const compactResultLabel = getCompactResultLabel(bet.result)
  const displayModelStatus = normalizeBetHistoryModelStatus(
    bet.recommendationState || bet.modelStatus,
  )

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
    <article className={`bet-card ${modelStatusClass(displayModelStatus)}`}>
      <div className="bet-compact-row">
        <div className="bet-compact-date">
          <span className="bet-compact-label">Date</span>
          <strong>{formatDate(bet.analyzedAt)}</strong>
        </div>

        <div className="bet-compact-game">
          <span className="bet-compact-label">Game</span>
          <strong>
            {bet.awayTeam.abbreviation} vs {bet.homeTeam.abbreviation}
          </strong>
          <small>
            {bet.awayTeam.name} @ {bet.homeTeam.name}
          </small>
        </div>

        <div className="bet-compact-pick">
          <span className="bet-compact-label">Pick</span>
          <strong>{bet.selectedSide.name}</strong>
        </div>

        <div className="bet-compact-odds">
          <span className="bet-compact-label">Market odds</span>
          <strong>@{formatOdds(bet.marketOdds)}</strong>
        </div>

        <div className="bet-compact-stake">
          <span className="bet-compact-label">Stake</span>
          <strong>{formatUnits(bet.stake)}</strong>
        </div>

        <div className="bet-compact-status">
          <span className="bet-compact-label">Model status</span>
          <strong
            className={`model-status-badge ${modelStatusClass(
              displayModelStatus,
            )}`}
          >
            {displayModelStatus}
          </strong>
        </div>

        <div className={`bet-compact-result ${settlementDisplay.tone}`}>
          <span className="bet-compact-label">Result / Profit</span>
          <strong>
            {compactResultLabel}
            {isSettled ? ` ${formatResultProfit(profit)}` : ''}
          </strong>
        </div>

        <div className="bet-expand-cell">
          {bet.notes ? (
            <span className="bet-note-indicator" title="This bet has a note">
              <FileText aria-hidden="true" size={14} />
              <span className="visually-hidden">Has note</span>
            </span>
          ) : null}
          <button
            aria-controls={detailsId}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Hide bet details' : 'View bet details'}
            className="bet-expand-button"
            type="button"
            onClick={() => setIsExpanded((currentValue) => !currentValue)}
          >
            {isExpanded ? (
              <ChevronUp aria-hidden="true" size={18} />
            ) : (
              <ChevronDown aria-hidden="true" size={18} />
            )}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="bet-expanded-details" id={detailsId}>
          <div className="bet-expanded-summary" aria-label="Bet detail summary">
            <CompactBetMetric
              label="Fair odds"
              value={formatOdds(bet.fairOdds)}
            />
            <CompactBetMetric
              label="Edge"
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
            <CompactBetMetric
              label="EV"
              value={formatExpectedValue(bet.expectedValue)}
              tone={
                toNullableNumber(bet.expectedValue) === null
                  ? ''
                  : bet.expectedValue >= 0
                    ? 'positive'
                    : 'negative'
              }
            />
            <CompactBetMetric
              className="bet-expanded-settlement"
              label="Settlement"
              metadata={
                bet.settlementCorrections?.length
                  ? `${bet.settlementCorrections.length} ${
                      bet.settlementCorrections.length === 1
                        ? 'correction'
                        : 'corrections'
                    }`
                  : ''
              }
              value={`${compactResultLabel} · ${settlementDisplay.message}`}
              tone={settlementDisplay.tone}
            />
            <CompactBetMetric
              label="Final score"
              value={settlementDisplay.finalScore || '--'}
            />
            <CompactBetMetric
              label="Profit"
              value={formatSignedUnits(profit)}
              tone={profitClass(profit)}
            />
          </div>

          <div className="bet-edit-grid">
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
              <span>Stake (units)</span>
              <input
                disabled={isSettled}
                type="number"
                min="0.01"
                step="0.25"
                value={draft.stake}
                inputMode="decimal"
                onBlur={() => handleDraftBlur('stake')}
                onChange={(event) =>
                  handleDraftChange('stake', event.target.value)
                }
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

          </div>

          <BetAnalysisDetails bet={bet} />

          <div className="bet-notes-row">
            <label className="field tracker-field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={draft.notes}
                onBlur={() => handleDraftBlur('notes')}
                onChange={(event) =>
                  handleDraftChange('notes', event.target.value)
                }
              />
            </label>

            <div className="bet-card-actions">
              {message ? (
                <span className={`save-analysis-status ${status}`}>
                  {message}
                </span>
              ) : null}
              <button
                className="delete-bet-button"
                type="button"
                disabled={status === 'saving' || isSettled}
                title={
                  isSettled
                    ? 'Settled bets are retained to preserve bankroll history.'
                    : 'Delete this pending bet and return its locked stake.'
                }
                onClick={onDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

const hasDisplayValue = (value) => value !== null && value !== '' && value !== '--'

const createDetailRow = (label, value, title) =>
  hasDisplayValue(value) ? { label, title, value } : null

const getGoalieDetail = (bet) => {
  const snapshot = bet.goalieSelectionSnapshot
  const hasSnapshot = Boolean(snapshot?.selectionType)

  if (!hasSnapshot && !bet.selectedGoalieName) {
    return null
  }

  const goalieName = bet.selectedGoalieName || 'Other / Unlisted goalie'

  const goalieStats = [
    createDetailRow('SV%', formatSavePercentage(bet.selectedGoalieSavePercentage)),
    createDetailRow('GP', formatInteger(bet.selectedGoalieGamesPlayed)),
    createDetailRow('GS', formatInteger(bet.selectedGoalieGamesStarted)),
  ]
    .filter(Boolean)
    .map(({ label, value }) => `${label} ${value}`)

  const snapshotDetail = hasSnapshot
    ? formatGoalieSelectionSnapshot(snapshot, goalieName)
    : goalieName

  return goalieStats.length
    ? `${snapshotDetail} (${goalieStats.join(', ')})`
    : snapshotDetail
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

const getGameContextDetail = (bet) => {
  const snapshot = bet.gameContextSnapshot
  const selectedSide = bet.selectedSide?.homeAway === 'away' ? 'away' : 'home'
  const context = snapshot?.[`${selectedSide}Context`]

  if (!context) {
    return null
  }

  return `${formatSignedGameContextAdjustment(
    context.totalGameContextAdjustment,
  )} total (rest ${formatSignedGameContextAdjustment(
    context.effectiveRestFatigueAdjustment,
  )}, quick ${formatSignedGameContextAdjustment(
    context.effectiveQuickRematchAdjustment,
  )})`
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
    createDetailRow(
      'Quick rematch',
      formatSignedNumber(bet.quickRematchAdjustment),
    ),
    createDetailRow('Game context', getGameContextDetail(bet)),
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

function CompactBetMetric({
  className = '',
  label,
  metadata = '',
  title,
  tone = '',
  value,
}) {
  return (
    <div
      className={`bet-compact-metric ${tone} ${className}`.trim()}
      title={title}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {metadata ? <small>{metadata}</small> : null}
    </div>
  )
}

export {
  BankrollControls,
  BankrollLedger,
  BetCard,
  BetHistoryPagination,
  BetListHeader,
}
export default BetTracker
