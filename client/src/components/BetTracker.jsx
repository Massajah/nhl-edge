import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import {
  addBankrollDeposit,
  addBankrollWithdrawal,
  getBankrollSeasons,
  getBankrollSummary,
  getBankrollTransactions,
  initializeBankroll,
} from '../services/bankrollApi.js'
import {
  createBet,
  deleteBet,
  fetchBets,
  updateBet,
} from '../services/betsApi.js'
import {
  BANKROLL_DEFAULT_CURRENCY,
  BANKROLL_DEFAULT_LIMIT,
  BANKROLL_DEFAULT_PAGE,
  BANKROLL_LIMIT_OPTIONS,
  BANKROLL_SEASON_ALL,
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
  getCurrentBankrollSeasonId,
  validateBankrollCashTransaction,
  validateBankrollFilters,
  validateBankrollInitialization,
} from '../utils/bankroll.js'
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
import { formatSignedGameContextAdjustment } from '../utils/gameContext.js'
import { formatLocalDateInputValue } from '../utils/powerRatingUpdates.js'

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
  const todayInputValue = useMemo(() => formatLocalDateInputValue(new Date()), [])
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
  const [bankrollCashMode, setBankrollCashMode] = useState('')
  const [bankrollCashDraft, setBankrollCashDraft] = useState(() => ({
    amount: '',
    description: '',
    occurredAt: formatLocalDateInputValue(new Date()),
  }))

  const applyBets = useCallback((nextBets) => {
    const normalizedBets = normalizeBets(nextBets)

    setBets(normalizedBets)
    setStatus('success')

    return normalizedBets
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
  const bankrollCashValidation = useMemo(
    () =>
      validateBankrollCashTransaction(bankrollCashDraft, {
        currentBankroll: bankrollSummary?.currentBankroll,
        today: todayInputValue,
        type: bankrollCashMode || 'DEPOSIT',
      }),
    [
      bankrollCashDraft,
      bankrollCashMode,
      bankrollSummary?.currentBankroll,
      todayInputValue,
    ],
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
    await refreshBankrollQuietly()

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
    await refreshBankrollQuietly()
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

  const handleOpenBankrollCashForm = (mode) => {
    setBankrollCashMode(mode)
    setBankrollCashDraft({
      amount: '',
      description: '',
      occurredAt: todayInputValue,
    })
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleBankrollCashDraftChange = (field, value) => {
    setBankrollCashDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setBankrollActionStatus('idle')
    setBankrollActionMessage('')
  }

  const handleSubmitBankrollCashTransaction = async (event) => {
    event.preventDefault()

    if (!bankrollCashValidation.isValid) {
      setBankrollActionStatus('error')
      setBankrollActionMessage(bankrollCashValidation.message)
      return
    }

    setBankrollActionStatus('saving')
    setBankrollActionMessage('')

    try {
      const result =
        bankrollCashMode === 'WITHDRAWAL'
          ? await addBankrollWithdrawal(bankrollCashDraft, {
              currentBankroll: bankrollSummary?.currentBankroll,
              type: 'WITHDRAWAL',
            })
          : await addBankrollDeposit(bankrollCashDraft)

      setBankrollSummary(result.summary)
      setBankrollCashMode('')
      setBankrollCashDraft({
        amount: '',
        description: '',
        occurredAt: todayInputValue,
      })
      setBankrollPage(BANKROLL_DEFAULT_PAGE)
      setBankrollActionStatus('success')
      setBankrollActionMessage(
        bankrollCashMode === 'WITHDRAWAL'
          ? 'Withdrawal recorded.'
          : 'Deposit recorded.',
      )
      await loadBankroll({
        page: BANKROLL_DEFAULT_PAGE,
        quiet: true,
      })
    } catch (error) {
      setBankrollActionStatus('error')
      setBankrollActionMessage(error.message)
    }
  }

  const handleBankrollPageChange = (nextPage) => {
    setBankrollPage(nextPage)
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

        <BankrollPanel
          actionMessage={bankrollActionMessage}
          actionStatus={bankrollActionStatus}
          cashDraft={bankrollCashDraft}
          cashMode={bankrollCashMode}
          cashValidation={bankrollCashValidation}
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
          onCashDraftChange={handleBankrollCashDraftChange}
          onClearFilters={handleClearBankrollFilters}
          onFilterChange={handleBankrollDraftFilterChange}
          onInitialize={handleInitializeBankroll}
          onLimitChange={(nextLimit) => {
            setBankrollLimit(nextLimit)
            setBankrollPage(BANKROLL_DEFAULT_PAGE)
          }}
          onOpenCashForm={handleOpenBankrollCashForm}
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
          onSubmitCashTransaction={handleSubmitBankrollCashTransaction}
        />

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

function BankrollPanel({
  actionMessage,
  actionStatus,
  cashDraft,
  cashMode,
  cashValidation,
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
  onCashDraftChange,
  onClearFilters,
  onFilterChange,
  onInitialize,
  onLimitChange,
  onOpenCashForm,
  onPageChange,
  onRefresh,
  onRetrySeasons,
  onSetupChange,
  onSubmitCashTransaction,
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
          <BankrollCashActions
            cashDraft={cashDraft}
            cashMode={cashMode}
            currency={summary.currency}
            isSaving={isSaving}
            todayInputValue={todayInputValue}
            validation={cashValidation}
            onCashDraftChange={onCashDraftChange}
            onOpenCashForm={onOpenCashForm}
            onSubmitCashTransaction={onSubmitCashTransaction}
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
        detail="Current minus pending"
        tone={profitClass(summary.availableBankroll)}
      />
      <SummaryMetric
        label="Betting Profit"
        value={formatSignedBankrollCurrency(
          summary.bettingProfit,
          summary.currency,
        )}
        detail={`${summary.settledBets} settled`}
        tone={profitClass(summary.bettingProfit)}
      />
      <SummaryMetric
        label="Pending Exposure"
        value={formatBankrollCurrency(summary.pendingStake, summary.currency)}
        detail="Open stakes"
        tone={summary.pendingStake > 0 ? 'negative' : ''}
      />
      <SummaryMetric
        label="Deposits"
        value={formatBankrollCurrency(summary.deposits, summary.currency)}
        detail="Selected period"
      />
      <SummaryMetric
        label="Withdrawals"
        value={formatBankrollCurrency(summary.withdrawals, summary.currency)}
        detail="Selected period"
        tone={summary.withdrawals > 0 ? 'negative' : ''}
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
  const hasSeasonOptions = seasonMetadata?.seasons?.length > 0
  const currentSeasonId = getCurrentBankrollSeasonId(seasonMetadata)
  const hasActiveFilters =
    periodValue !== BANKROLL_SEASON_ALL || Boolean(draftFilters.type)

  return (
    <form className="bankroll-toolbar" onSubmit={onApplyFilters}>
      <label className="field tracker-field" htmlFor="bankroll-period">
        <span>Period</span>
        <select
          disabled={seasonStatus === 'loading'}
          id="bankroll-period"
          value={periodValue}
          onChange={(event) => onFilterChange('period', event.target.value)}
        >
          <option value={BANKROLL_SEASON_ALL}>All time</option>
          {seasonStatus === 'loading' ? (
            <option value={periodValue}>Loading seasons...</option>
          ) : null}
          {seasonStatus !== 'loading' && hasSeasonOptions
            ? seasonMetadata.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.id === currentSeasonId
                    ? `Current season - ${season.label}`
                    : season.label}
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

      <label className="field tracker-field" htmlFor="bankroll-from">
        <span>Date From</span>
        <input
          aria-invalid={Boolean(filterValidation.fieldErrors.from)}
          aria-readonly={dateFields.disabled}
          disabled={dateFields.disabled}
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
          aria-readonly={dateFields.disabled}
          disabled={dateFields.disabled}
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

function BankrollCashActions({
  cashDraft,
  cashMode,
  currency,
  isSaving,
  todayInputValue,
  validation,
  onCashDraftChange,
  onOpenCashForm,
  onSubmitCashTransaction,
}) {
  return (
    <div className="bankroll-cash-section">
      <div className="bankroll-cash-actions">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onOpenCashForm('DEPOSIT')}
        >
          <Plus aria-hidden="true" size={15} />
          <span>Add Deposit</span>
        </button>
        <button
          className="secondary-inline-button"
          type="button"
          disabled={isSaving}
          onClick={() => onOpenCashForm('WITHDRAWAL')}
        >
          <Minus aria-hidden="true" size={15} />
          <span>Add Withdrawal</span>
        </button>
      </div>

      {cashMode ? (
        <BankrollCashForm
          cashDraft={cashDraft}
          cashMode={cashMode}
          currency={currency}
          isSaving={isSaving}
          todayInputValue={todayInputValue}
          validation={validation}
          onCashDraftChange={onCashDraftChange}
          onSubmitCashTransaction={onSubmitCashTransaction}
        />
      ) : null}
    </div>
  )
}

function BankrollCashForm({
  cashDraft,
  cashMode,
  currency,
  isSaving,
  todayInputValue,
  validation,
  onCashDraftChange,
  onSubmitCashTransaction,
}) {
  const modeLabel = cashMode === 'WITHDRAWAL' ? 'Withdrawal' : 'Deposit'

  return (
    <form className="bankroll-cash-form" onSubmit={onSubmitCashTransaction}>
      <label className="field tracker-field" htmlFor="bankroll-cash-amount">
        <span>{modeLabel} Amount</span>
        <input
          aria-invalid={Boolean(validation.fieldErrors.amount)}
          id="bankroll-cash-amount"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          type="number"
          value={cashDraft.amount}
          onChange={(event) =>
            onCashDraftChange('amount', event.target.value)
          }
        />
        <small className="field-error-slot">
          {validation.fieldErrors.amount || currency}
        </small>
      </label>

      <label className="field tracker-field" htmlFor="bankroll-cash-date">
        <span>Date</span>
        <input
          aria-invalid={Boolean(validation.fieldErrors.occurredAt)}
          id="bankroll-cash-date"
          max={todayInputValue}
          type="date"
          value={cashDraft.occurredAt}
          onChange={(event) =>
            onCashDraftChange('occurredAt', event.target.value)
          }
        />
        <small className="field-error-slot">
          {validation.fieldErrors.occurredAt || ' '}
        </small>
      </label>

      <label className="field tracker-field" htmlFor="bankroll-cash-description">
        <span>Description</span>
        <input
          id="bankroll-cash-description"
          type="text"
          value={cashDraft.description}
          onChange={(event) =>
            onCashDraftChange('description', event.target.value)
          }
        />
        <small className="field-error-slot"> </small>
      </label>

      <div className="bankroll-form-actions">
        <button type="submit" disabled={isSaving}>
          {cashMode === 'WITHDRAWAL' ? (
            <Minus aria-hidden="true" size={15} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )}
          <span>{isSaving ? 'Saving...' : `Save ${modeLabel}`}</span>
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
          <span>Previous</span>
        </button>
        <span>
          Page {pagination.page}
          {pagination.totalPages ? ` of ${pagination.totalPages}` : ''}
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

function BetStat({ label, title, value, tone = '' }) {
  return (
    <div className={`bet-stat ${tone}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default BetTracker
