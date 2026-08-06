import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchGamesForDate,
  fetchTodaysGames,
  isUsingMockGames,
} from '../services/scheduleApi.js'
import { getBankrollSummary } from '../services/bankrollApi.js'
import { fetchBets } from '../services/betsApi.js'
import { getBettingSettings } from '../services/bettingSettingsApi.js'
import { fetchGameContexts } from '../services/gameContextApi.js'
import { fetchNhlMarketOdds } from '../services/marketOddsApi.js'
import {
  formatBankrollCurrency,
  formatSignedBankrollCurrency,
} from '../utils/bankroll.js'
import {
  DEFAULT_BETTING_SETTINGS,
  normalizeBettingSettings,
} from '../utils/bettingSettings.js'
import {
  formatInjuryImpact,
  getTeamInjurySummary,
} from '../utils/injuries.js'
import { calculatePreliminaryAnalysis } from '../utils/modelAnalysis.js'
import {
  getMarketOddsStatusLabel,
  indexProviderMarketOdds,
  loadDashboardMarketOdds,
  resolveGameMarketOdds,
  saveDashboardMarketOdds,
} from '../utils/marketOdds.js'
import {
  PROBABILITY_EDGE_HELP_TEXT,
  parseMarketOdds,
} from '../utils/calculateGame.js'
import {
  DASHBOARD_GAME_STATUSES,
  buildLastNightBettingSummary,
  buildOpenBetSummary,
  buildTodayActivitySummary,
  getDashboardDateContextLabels,
  getBetProfit,
  getBetsForGames,
  getDashboardCurrency,
  getDashboardGameStatus,
  getPreviousLocalDateValue,
  getWinner,
  groupBetsByGameId,
  isGameFinal,
  isGameStarted,
  shiftLocalDateValue,
  toLocalDateValue,
  parseLocalDateValue,
} from '../utils/dashboard.js'
import { normalizeBets } from '../utils/savedAnalyses.js'
import {
  formatSignedGameContextAdjustment,
  getCompactGameContextAdjustmentLabel,
  getGameContextForSide,
  hasNonZeroGameContextAdjustment,
  normalizeGameContext,
} from '../utils/gameContext.js'
import { getGoalieSelectionForSide } from '../utils/goalies.js'
import { createLatestRequestTracker } from '../utils/requestTracker.js'
import { AUTOMATIC_POWER_RATING_UPDATE_STATUSES } from '../utils/powerRatingUpdates.js'
import MarketOddsDetails from './MarketOddsDetails.jsx'

const formatScheduleDate = (date) => {
  if (!date) {
    return 'Select a date'
  }

  const scheduleDate = parseLocalDateValue(date)

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  }).format(scheduleDate)
}

const formatStartTime = (startTimeUTC, scheduleDate) => {
  const startTime = new Date(startTimeUTC)

  if (Number.isNaN(startTime.getTime())) {
    return 'Time TBD'
  }

  const localDate = toLocalDateValue(startTime)
  const includeLocalDate = localDate !== scheduleDate

  return new Intl.DateTimeFormat(undefined, {
    day: includeLocalDate ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    month: includeLocalDate ? 'short' : undefined,
    weekday: includeLocalDate ? 'short' : undefined,
  }).format(startTime)
}

const getStatusTone = (status = '') => {
  const normalizedStatus = status.toLowerCase()

  if (normalizedStatus.includes('live') || normalizedStatus.includes('critical')) {
    return 'live'
  }

  if (normalizedStatus.includes('final')) {
    return 'final'
  }

  if (normalizedStatus.includes('postponed')) {
    return 'postponed'
  }

  return 'scheduled'
}

const hasScore = (team = {}) => Number.isFinite(team.score)

const hasGameScore = (game) => hasScore(game.homeTeam) && hasScore(game.awayTeam)

const formatOdds = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : '--'

const formatRating = (value) =>
  Number.isFinite(value) ? value.toFixed(1) : '--'

const formatPercent = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--'

const formatProbabilityEdge = (value) =>
  Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`
    : '--'

const formatExpectedValue = (value) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : '--'

const getGameId = (gameOrBet = {}) =>
  String(gameOrBet.gameId ?? gameOrBet.id ?? '').trim()

const formatDashboardCurrency = (value, currency) =>
  formatBankrollCurrency(value, currency)

const formatSignedDashboardCurrency = (value, currency) =>
  formatSignedBankrollCurrency(value, currency)

const formatSavedBetOdds = (value) =>
  Number.isFinite(value) && value > 1 ? `@ ${value.toFixed(2)}` : 'Odds --'

const getBetTeamName = (bet = {}) =>
  bet.selectedTeam?.name ||
  bet.selectedSide?.name ||
  bet.team ||
  'Selected team'

const getBetResultPresentation = (result) => {
  if (result === 'win') {
    return {
      label: 'Bet won',
      tone: 'positive',
    }
  }

  if (result === 'loss') {
    return {
      label: 'Bet lost',
      tone: 'negative',
    }
  }

  if (result === 'push') {
    return {
      label: 'Bet pushed',
      tone: 'neutral',
    }
  }

  if (result === 'void') {
    return {
      label: 'Bet void',
      tone: 'neutral',
    }
  }

  return {
    label: 'Settlement pending',
    tone: 'pending',
  }
}

const indexGameContexts = (contexts = []) =>
  (Array.isArray(contexts) ? contexts : []).reduce(
    (contextsByGameId, context) => {
      const normalizedContext = normalizeGameContext(context)

      if (normalizedContext?.gameId) {
        contextsByGameId[normalizedContext.gameId] = normalizedContext
      }

      return contextsByGameId
    },
    {},
  )

const getProfitTone = (value) => {
  if (value > 0) {
    return 'positive'
  }

  if (value < 0) {
    return 'negative'
  }

  return 'neutral'
}

function Dashboard({
  baseHomeAdvantage = 0,
  injurySummaries,
  injurySummaryError,
  injurySummaryStatus,
  initialBankrollSummary = null,
  initialBankrollError = '',
  initialBankrollStatus = null,
  initialAutomaticRatingUpdateError = '',
  initialAutomaticRatingUpdateResult = null,
  initialAutomaticRatingUpdateStatus = null,
  initialBets = null,
  initialBetsError = '',
  initialBetsStatus = null,
  initialBettingSettings = null,
  initialBettingSettingsError = '',
  initialBettingSettingsStatus = null,
  initialGameContexts = null,
  initialGameContextsError = '',
  initialGameContextsStatus = null,
  initialMarketOdds = null,
  initialMarketOddsResponse = null,
  initialPreviousSchedule = null,
  initialPreviousError = '',
  initialPreviousStatus = null,
  initialSchedule = null,
  onAutoUpdatePowerRatings,
  onAnalyzeGame,
  onNavigate,
  onOpenManualPowerRatingUpdate,
  onRetryInjuries,
  onRetryPowerRatings,
  onRetryRatingEngineSettings,
  powerRatings,
  powerRatingsError,
  powerRatingsStatus,
  ratingEngineSettingsError,
  ratingEngineSettingsStatus,
  todayDateValue = toLocalDateValue(new Date()),
}) {
  const [selectedDate, setSelectedDate] = useState(initialSchedule?.date ?? '')
  const [schedule, setSchedule] = useState({
    date: initialSchedule?.date ?? '',
    games: initialSchedule?.games ?? [],
  })
  const [previousSchedule, setPreviousSchedule] = useState({
    date: initialPreviousSchedule?.date ?? '',
    games: initialPreviousSchedule?.games ?? [],
  })
  const [status, setStatus] = useState(initialSchedule ? 'success' : 'loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [previousStatus, setPreviousStatus] = useState(
    initialPreviousStatus ??
      (initialPreviousSchedule ? 'success' : 'loading'),
  )
  const [previousErrorMessage, setPreviousErrorMessage] =
    useState(initialPreviousError)
  const [bankrollSummary, setBankrollSummary] = useState(initialBankrollSummary)
  const [bankrollStatus, setBankrollStatus] = useState(
    initialBankrollStatus ??
      (initialBankrollSummary ? 'success' : 'loading'),
  )
  const [bankrollError, setBankrollError] = useState(initialBankrollError)
  const [bets, setBets] = useState(() => normalizeBets(initialBets ?? []))
  const [betsStatus, setBetsStatus] = useState(
    initialBetsStatus ?? (initialBets ? 'success' : 'loading'),
  )
  const [betsError, setBetsError] = useState(initialBetsError)
  const [bettingSettings, setBettingSettings] = useState(() =>
    normalizeBettingSettings(initialBettingSettings ?? DEFAULT_BETTING_SETTINGS),
  )
  const [bettingSettingsStatus, setBettingSettingsStatus] =
    useState(
      initialBettingSettingsStatus ??
        (initialBettingSettings ? 'success' : 'loading'),
    )
  const [bettingSettingsError, setBettingSettingsError] = useState(
    initialBettingSettingsError,
  )
  const [gameContextsByGameId, setGameContextsByGameId] = useState(() =>
    indexGameContexts(initialGameContexts ?? []),
  )
  const [gameContextStatus, setGameContextStatus] = useState(
    initialGameContextsStatus ??
      (initialGameContexts ? 'success' : 'idle'),
  )
  const [gameContextError, setGameContextError] = useState(
    initialGameContextsError,
  )
  const [marketOddsByGame, setMarketOddsByGame] = useState(() =>
    initialMarketOdds ?? loadDashboardMarketOdds(),
  )
  const [providerOddsByGame, setProviderOddsByGame] = useState(() =>
    indexProviderMarketOdds(initialMarketOddsResponse?.games),
  )
  const [marketOddsResult, setMarketOddsResult] = useState(
    initialMarketOddsResponse,
  )
  const [marketOddsStatus, setMarketOddsStatus] = useState(
    initialMarketOddsResponse ? 'success' : 'idle',
  )
  const [automaticRatingUpdateStatus, setAutomaticRatingUpdateStatus] =
    useState(
      initialAutomaticRatingUpdateStatus ??
        (initialAutomaticRatingUpdateResult ? 'success' : 'idle'),
    )
  const [automaticRatingUpdateResult, setAutomaticRatingUpdateResult] =
    useState(initialAutomaticRatingUpdateResult)
  const [
    automaticRatingUpdateError,
    setAutomaticRatingUpdateError,
  ] = useState(initialAutomaticRatingUpdateError)
  const dateChangeDebounceRef = useRef(null)
  const scheduleRequestTrackerRef = useRef(createLatestRequestTracker())
  const marketOddsRequestTrackerRef = useRef(createLatestRequestTracker())
  const marketOddsRefreshDateRef = useRef('')
  const automaticRatingUpdateRequestTrackerRef = useRef(
    createLatestRequestTracker(),
  )

  const applySchedule = useCallback((nextSchedule, fallbackDate = '') => {
    const nextDate = nextSchedule.date ?? fallbackDate

    setSelectedDate(nextDate)
    setSchedule({
      date: nextDate,
      games: nextSchedule.games ?? [],
    })
    setStatus('success')
  }, [])

  const loadPreviousSchedule = useCallback(async (date, options = {}) => {
    const previousDate = getPreviousLocalDateValue(date)
    const shouldApply = options.shouldApply ?? (() => true)

    if (!shouldApply()) {
      return
    }

    setPreviousStatus('loading')
    setPreviousErrorMessage('')

    try {
      const nextSchedule = await fetchGamesForDate(previousDate)
      const nextDate = nextSchedule.date ?? previousDate

      if (!shouldApply()) {
        return
      }

      setPreviousSchedule({
        date: nextDate,
        games: nextSchedule.games ?? [],
      })
      setPreviousStatus('success')
    } catch (error) {
      if (!shouldApply()) {
        return
      }

      setPreviousSchedule({
        date: previousDate,
        games: [],
      })
      setPreviousStatus('error')
      setPreviousErrorMessage(error.message)
    }
  }, [])

  const loadAccountData = useCallback(async () => {
    setBankrollStatus('loading')
    setBankrollError('')
    setBetsStatus('loading')
    setBetsError('')
    setBettingSettingsStatus('loading')
    setBettingSettingsError('')

    const [bankrollResult, betsResult, settingsResult] =
      await Promise.allSettled([
        getBankrollSummary(),
        fetchBets(),
        getBettingSettings(),
      ])

    if (bankrollResult.status === 'fulfilled') {
      setBankrollSummary(bankrollResult.value)
      setBankrollStatus('success')
    } else {
      setBankrollSummary(null)
      setBankrollStatus('error')
      setBankrollError(bankrollResult.reason.message)
    }

    if (betsResult.status === 'fulfilled') {
      setBets(normalizeBets(betsResult.value))
      setBetsStatus('success')
    } else {
      setBets([])
      setBetsStatus('error')
      setBetsError(betsResult.reason.message)
    }

    if (settingsResult.status === 'fulfilled') {
      setBettingSettings(normalizeBettingSettings(settingsResult.value.settings))
      setBettingSettingsStatus('success')
    } else {
      setBettingSettings(normalizeBettingSettings(DEFAULT_BETTING_SETTINGS))
      setBettingSettingsStatus('error')
      setBettingSettingsError(settingsResult.reason.message)
    }
  }, [])

  const loadMarketOdds = useCallback(async (date, { refresh = false } = {}) => {
    if (!date) {
      return
    }

    const request = marketOddsRequestTrackerRef.current.start()

    setMarketOddsStatus('loading')

    try {
      const result = await fetchNhlMarketOdds(date, { refresh })

      if (!request.isLatest()) {
        return
      }

      setProviderOddsByGame(indexProviderMarketOdds(result.games))
      setMarketOddsResult(result)
      setMarketOddsStatus('success')
    } catch (error) {
      if (!request.isLatest()) {
        return
      }

      setProviderOddsByGame({})
      setMarketOddsResult({
        date,
        message: error.message,
        quota: null,
        status: 'unavailable',
      })
      setMarketOddsStatus('error')
    }
  }, [])

  const loadScheduleForDate = useCallback(
    async (date) => {
      const request = scheduleRequestTrackerRef.current.start()

      marketOddsRequestTrackerRef.current.invalidate()
      setProviderOddsByGame({})
      setMarketOddsResult(null)
      setMarketOddsStatus('loading')
      setSelectedDate(date)
      setStatus('loading')
      setErrorMessage('')

      try {
        const nextSchedule = await fetchGamesForDate(date)

        if (!request.isLatest()) {
          return
        }

        applySchedule(nextSchedule, date)
        await loadPreviousSchedule(nextSchedule.date ?? date, {
          shouldApply: request.isLatest,
        })
      } catch (error) {
        if (!request.isLatest()) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    },
    [applySchedule, loadPreviousSchedule],
  )

  const loadTodaySchedule = useCallback(async () => {
    const request = scheduleRequestTrackerRef.current.start()

    marketOddsRequestTrackerRef.current.invalidate()
    setProviderOddsByGame({})
    setMarketOddsResult(null)
    setMarketOddsStatus('loading')
    setStatus('loading')
    setErrorMessage('')

    try {
      const nextSchedule = await fetchTodaysGames()

      if (!request.isLatest()) {
        return
      }

      applySchedule(nextSchedule, toLocalDateValue(new Date()))
      await loadPreviousSchedule(nextSchedule.date ?? toLocalDateValue(new Date()), {
        shouldApply: request.isLatest,
      })
    } catch (error) {
      if (!request.isLatest()) {
        return
      }

      setStatus('error')
      setErrorMessage(error.message)
    }
  }, [applySchedule, loadPreviousSchedule])

  const triggerAutomaticPowerRatingUpdate = useCallback(async () => {
    if (typeof onAutoUpdatePowerRatings !== 'function') {
      return null
    }

    const request = automaticRatingUpdateRequestTrackerRef.current.start()

    setAutomaticRatingUpdateStatus('checking')
    setAutomaticRatingUpdateError('')

    try {
      const result = await onAutoUpdatePowerRatings()

      if (!request.isLatest()) {
        return result
      }

      setAutomaticRatingUpdateResult(result)
      setAutomaticRatingUpdateStatus('success')
      return result
    } catch (error) {
      if (!request.isLatest()) {
        return null
      }

      setAutomaticRatingUpdateResult(null)
      setAutomaticRatingUpdateStatus('error')
      setAutomaticRatingUpdateError(error.message)
      return null
    }
  }, [onAutoUpdatePowerRatings])

  useEffect(() => {
    let isCurrent = true

    const loadInitialSchedule = async () => {
      const request = scheduleRequestTrackerRef.current.start()

      try {
        const todaySchedule = await fetchTodaysGames()

        if (!isCurrent || !request.isLatest()) {
          return
        }

        applySchedule(todaySchedule, toLocalDateValue(new Date()))
        loadPreviousSchedule(todaySchedule.date ?? toLocalDateValue(new Date()), {
          shouldApply: () => isCurrent && request.isLatest(),
        })
      } catch (error) {
        if (!isCurrent || !request.isLatest()) {
          return
        }

        setStatus('error')
        setErrorMessage(error.message)
      }
    }

    loadInitialSchedule()

    return () => {
      isCurrent = false
    }
  }, [applySchedule, loadPreviousSchedule])

  useEffect(() => {
    const timerId = setTimeout(() => {
      triggerAutomaticPowerRatingUpdate()
    }, 0)

    return () => {
      clearTimeout(timerId)
    }
  }, [triggerAutomaticPowerRatingUpdate])

  useEffect(
    () => () => {
      if (dateChangeDebounceRef.current) {
        clearTimeout(dateChangeDebounceRef.current)
      }

      scheduleRequestTrackerRef.current.invalidate()
      marketOddsRequestTrackerRef.current.invalidate()
      automaticRatingUpdateRequestTrackerRef.current.invalidate()
    },
    [],
  )

  useEffect(() => {
    const timerId = setTimeout(() => {
      loadAccountData()
    }, 0)

    return () => {
      clearTimeout(timerId)
    }
  }, [loadAccountData])

  useEffect(() => {
    let isCurrent = true

    const loadGameContexts = async () => {
      if (status !== 'success' || schedule.games.length === 0) {
        setGameContextsByGameId({})
        setGameContextStatus('idle')
        setGameContextError('')
        return
      }

      setGameContextStatus('loading')
      setGameContextError('')

      try {
        const result = await fetchGameContexts(schedule.games)

        if (!isCurrent) {
          return
        }

        setGameContextsByGameId(indexGameContexts(result.contexts))
        setGameContextStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setGameContextsByGameId({})
        setGameContextStatus('error')
        setGameContextError(error.message)
      }
    }

    loadGameContexts()

    return () => {
      isCurrent = false
    }
  }, [schedule.games, status])

  useEffect(() => {
    if (status !== 'success' || !schedule.date) {
      return undefined
    }

    if (marketOddsRefreshDateRef.current === schedule.date) {
      marketOddsRefreshDateRef.current = ''
      return undefined
    }

    const timerId = setTimeout(() => {
      loadMarketOdds(schedule.date)
    }, 0)

    return () => clearTimeout(timerId)
  }, [loadMarketOdds, schedule.date, status])

  const displayDate = selectedDate || schedule.date
  const dateContextLabels = useMemo(
    () =>
      getDashboardDateContextLabels({
        selectedDateValue: displayDate,
        todayDateValue,
      }),
    [displayDate, todayDateValue],
  )
  const gamesSectionTitle = `${dateContextLabels.gamesTitlePrefix}${formatScheduleDate(
    displayDate,
  )}`

  const scheduleSummary = useMemo(() => {
    if (status === 'loading') {
      return 'Loading schedule'
    }

    if (status === 'error') {
      return 'Schedule unavailable'
    }

    return `${schedule.games.length} ${
      schedule.games.length === 1 ? 'game' : 'games'
    }`
  }, [schedule.games.length, status])
  const headerStatusSummary =
    status === 'loading' || status === 'error' ? scheduleSummary : ''
  const previousDate = previousSchedule.date || getPreviousLocalDateValue(displayDate)
  const canUsePowerRatings = powerRatingsStatus === 'success'
  const canUseInjurySummaries = injurySummaryStatus === 'success'
  const canUseRatingEngineSettings = ratingEngineSettingsStatus === 'success'
  const canUseModel =
    canUsePowerRatings && canUseInjurySummaries && canUseRatingEngineSettings
  const betsByGameId = useMemo(() => groupBetsByGameId(bets), [bets])
  const currency = getDashboardCurrency(bankrollSummary)
  const openBetSummary = useMemo(() => buildOpenBetSummary(bets), [bets])
  const dashboardGames = useMemo(
    () =>
      schedule.games.map((game) => {
        const normalizedMarketOdds = resolveGameMarketOdds({
          gameId: String(game.gameId),
          manualOddsByGame: marketOddsByGame,
          providerOddsByGame,
        })
        const preliminaryAnalysis =
          !isGameStarted(game) && canUseModel
            ? calculatePreliminaryAnalysis({
                awayTeamId: game.awayTeam.abbreviation,
                baseHomeAdvantage,
                gameContext: gameContextsByGameId[String(game.gameId)] ?? null,
                homeTeamId: game.homeTeam.abbreviation,
                injurySummaries,
                marketOdds: normalizedMarketOdds,
                powerRatings,
              })
            : null
        const savedBets = betsByGameId[String(game.gameId)] ?? []
        const dashboardStatus = getDashboardGameStatus({
          analysis: preliminaryAnalysis,
          awayTeam: game.awayTeam,
          bankrollSummary,
          bettingSettings,
          game,
          homeTeam: game.homeTeam,
          savedBets,
        })
        const canAnalyzeGame =
          canUseModel &&
          (isGameStarted(game) || preliminaryAnalysis?.available !== false)

        return {
          canAnalyze: canAnalyzeGame,
          dashboardStatus,
          game,
          gameContext: gameContextsByGameId[String(game.gameId)] ?? null,
          marketOdds: normalizedMarketOdds,
          preliminaryAnalysis,
          savedBets,
        }
      }),
    [
      bankrollSummary,
      baseHomeAdvantage,
      bettingSettings,
      betsByGameId,
      canUseModel,
      gameContextsByGameId,
      injurySummaries,
      marketOddsByGame,
      powerRatings,
      providerOddsByGame,
      schedule.games,
    ],
  )
  const todayActivitySummary = useMemo(
    () =>
      buildTodayActivitySummary({
        bets,
        gameStatuses: dashboardGames.map(
          (dashboardGame) => dashboardGame.dashboardStatus,
        ),
        games: schedule.games,
        preliminaryAnalyses: dashboardGames.map(
          (dashboardGame) => dashboardGame.preliminaryAnalysis,
        ),
      }),
    [bets, dashboardGames, schedule.games],
  )
  const todaySavedBets = useMemo(
    () => getBetsForGames(bets, schedule.games),
    [bets, schedule.games],
  )
  const selectedDaySavedBetSummary =
    betsStatus === 'loading'
      ? 'Loading saved bets'
      : todaySavedBets.length === 0
        ? `No bets saved for ${dateContextLabels.gameBetsLabel}.`
        : `${todaySavedBets.length} ${
            todaySavedBets.length === 1 ? 'bet saved' : 'bets saved'
          }`
  const previousCompletedGames = useMemo(
    () => previousSchedule.games.filter(isGameFinal),
    [previousSchedule.games],
  )
  const previousBets = useMemo(
    () => getBetsForGames(bets, previousSchedule.games),
    [bets, previousSchedule.games],
  )
  const lastNightBettingSummary = useMemo(
    () => buildLastNightBettingSummary(previousBets),
    [previousBets],
  )

  const handleDateChange = (event) => {
    const nextDate = event.target.value

    if (nextDate) {
      scheduleRequestTrackerRef.current.invalidate()
      marketOddsRequestTrackerRef.current.invalidate()
      setProviderOddsByGame({})
      setMarketOddsResult(null)
      setMarketOddsStatus('loading')
      setSelectedDate(nextDate)
      setStatus('loading')
      setErrorMessage('')

      if (dateChangeDebounceRef.current) {
        clearTimeout(dateChangeDebounceRef.current)
      }

      dateChangeDebounceRef.current = setTimeout(() => {
        dateChangeDebounceRef.current = null
        loadScheduleForDate(nextDate)
      }, 200)
    }
  }

  const handleShiftDate = (dayCount) => {
    loadScheduleForDate(
      shiftLocalDateValue(displayDate || toLocalDateValue(new Date()), dayCount),
    )
  }

  const handleRetry = () => {
    if (displayDate) {
      loadScheduleForDate(displayDate)
      return
    }

    loadTodaySchedule()
  }

  const handleRefreshDashboard = () => {
    marketOddsRefreshDateRef.current = displayDate
    handleRetry()
    loadAccountData()
    triggerAutomaticPowerRatingUpdate()
    loadMarketOdds(displayDate, { refresh: true })
  }

  const handleViewBets = () => {
    onNavigate?.('tracker')
  }

  const handleMarketOddsChange = (gameId, side, value) => {
    setMarketOddsByGame((currentOdds) => {
      const nextOdds = {
        ...currentOdds,
        [gameId]: {
          away: currentOdds[gameId]?.away ?? '',
          home: currentOdds[gameId]?.home ?? '',
          [side]: value,
        },
      }

      saveDashboardMarketOdds(nextOdds)
      return nextOdds
    })
  }

  return (
    <section className="dashboard-page" aria-label="Dashboard">
      <div className="dashboard-panel">
        <div className="section-heading dashboard-heading">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">Dashboard</p>
              {isUsingMockGames ? (
                <span className="development-data-badge">
                  Development test data
                </span>
              ) : null}
            </div>
            <h2>{formatScheduleDate(displayDate)}</h2>
          </div>
          {headerStatusSummary ? <span>{headerStatusSummary}</span> : null}
        </div>

        <DashboardSummary
          bankrollError={bankrollError}
          bankrollStatus={bankrollStatus}
          bankrollSummary={bankrollSummary}
          betsError={betsError}
          betsStatus={betsStatus}
          currency={currency}
          openBetSummary={openBetSummary}
        />

        <div className="schedule-toolbar" aria-label="Schedule date controls">
          <button type="button" onClick={() => handleShiftDate(-1)}>
            Previous day
          </button>

          <label className="field schedule-date-field" htmlFor="schedule-date">
            <span>Schedule date</span>
            <input
              id="schedule-date"
              type="date"
              value={displayDate}
              onChange={handleDateChange}
            />
          </label>

          <button type="button" onClick={() => handleShiftDate(1)}>
            Next day
          </button>

          <button type="button" onClick={loadTodaySchedule}>
            Today
          </button>

          <button type="button" onClick={handleRefreshDashboard}>
            Refresh
          </button>
        </div>

        <MarketOddsStatus
          requestStatus={marketOddsStatus}
          result={marketOddsResult}
        />

        <AutomaticPowerRatingUpdateStatus
          errorMessage={automaticRatingUpdateError}
          onOpenManualUpdate={onOpenManualPowerRatingUpdate}
          requestStatus={automaticRatingUpdateStatus}
          result={automaticRatingUpdateResult}
        />

        <PowerRatingsNotice
          errorMessage={powerRatingsError}
          onRetry={onRetryPowerRatings}
          status={powerRatingsStatus}
        />
        <RatingEngineSettingsNotice
          errorMessage={ratingEngineSettingsError}
          onRetry={onRetryRatingEngineSettings}
          status={ratingEngineSettingsStatus}
        />
        <InjurySummaryNotice
          errorMessage={injurySummaryError}
          onRetry={onRetryInjuries}
          status={injurySummaryStatus}
        />

        <div className="dashboard-daily-layout">
          <main
            className="dashboard-today-column"
            aria-labelledby="dashboard-games-heading"
          >
            <div className="dashboard-section-heading dashboard-today-heading">
              <div>
                <p className="eyebrow">{dateContextLabels.gamesEyebrow}</p>
                <h3 id="dashboard-games-heading">{gamesSectionTitle}</h3>
              </div>
              <span>{selectedDaySavedBetSummary}</span>
            </div>

            <TodayActivitySummary
              ariaLabel={dateContextLabels.activityAriaLabel}
              betsStatus={betsStatus}
              summary={todayActivitySummary}
            />

            {bettingSettingsStatus === 'error' ? (
              <p className="dashboard-data-warning" role="status">
                Betting settings unavailable. Candidate counts are using default
                thresholds. {bettingSettingsError}
              </p>
            ) : null}

            {status === 'loading' ? (
              <ScheduleLoadingState className="dashboard-today-games-grid" />
            ) : null}

            {status === 'error' ? (
              <div className="schedule-state error-state" role="alert">
                <strong>Schedule unavailable</strong>
                <p>{errorMessage}</p>
                <button type="button" onClick={handleRetry}>
                  Try again
                </button>
              </div>
            ) : null}

            {status === 'success' && schedule.games.length === 0 ? (
              <p className="empty-state">
                No NHL games scheduled for {formatScheduleDate(displayDate)}.
              </p>
            ) : null}

            {status === 'success' && schedule.games.length > 0 ? (
              <div className="dashboard-today-games-grid">
                {dashboardGames.map((dashboardGame) => (
                  <GameCard
                    dashboardGame={dashboardGame}
                    key={dashboardGame.game.gameId}
                    currency={currency}
                    gameContextError={gameContextError}
                    gameContextStatus={gameContextStatus}
                    onMarketOddsChange={handleMarketOddsChange}
                    onAnalyzeGame={onAnalyzeGame}
                    onViewBets={handleViewBets}
                    injurySummaries={injurySummaries}
                    injurySummaryStatus={injurySummaryStatus}
                    scheduleDate={displayDate}
                  />
                ))}
              </div>
            ) : null}
          </main>

          <aside className="dashboard-last-night-column">
            <LastNightSection
              betsByGameId={betsByGameId}
              currency={currency}
              date={previousDate}
              eyebrow={dateContextLabels.previousEyebrow}
              games={previousCompletedGames}
              onRetry={() => loadPreviousSchedule(displayDate)}
              onViewBets={handleViewBets}
              status={previousStatus}
              errorMessage={previousErrorMessage}
              bettingSummary={lastNightBettingSummary}
            />
          </aside>
        </div>
      </div>
    </section>
  )
}

const pluralizeGames = (count) => `${count} ${count === 1 ? 'game' : 'games'}`

const formatAutomaticRatingLatestGame = (game) => {
  if (!game?.gameDate && !game?.awayTeam && !game?.homeTeam) {
    return ''
  }

  const matchup =
    game.awayTeam && game.homeTeam ? `${game.awayTeam} at ${game.homeTeam}` : ''

  return ['latest game:', game.gameDate, matchup].filter(Boolean).join(' ')
}

const getAutomaticRatingUpdatePresentation = ({
  errorMessage,
  requestStatus,
  result,
}) => {
  if (requestStatus === 'checking') {
    return {
      detail: '',
      status: 'checking',
      title: 'Checking ratings...',
      tone: 'checking',
    }
  }

  if (requestStatus === 'error') {
    return {
      detail: errorMessage,
      status: AUTOMATIC_POWER_RATING_UPDATE_STATUSES.UNAVAILABLE,
      title: 'Power Rating update unavailable',
      tone: 'error',
    }
  }

  if (!result) {
    return null
  }

  const latestGame = formatAutomaticRatingLatestGame(
    result.latestProcessedGame,
  )

  if (
    result.status === AUTOMATIC_POWER_RATING_UPDATE_STATUSES.UPDATED
  ) {
    return {
      detail: [
        `${pluralizeGames(result.gamesProcessed)} processed`,
        latestGame,
        result.refreshError
          ? `Ratings refresh failed: ${result.refreshError}`
          : '',
      ]
        .filter(Boolean)
        .join(' | '),
      status: result.status,
      title: `Power Ratings updated: ${pluralizeGames(
        result.gamesProcessed,
      )}`,
      tone: result.refreshError ? 'warning' : 'success',
    }
  }

  if (result.status === AUTOMATIC_POWER_RATING_UPDATE_STATUSES.UP_TO_DATE) {
    return {
      detail: latestGame,
      status: result.status,
      title: 'Power Ratings up to date',
      tone: 'neutral',
    }
  }

  if (result.status === AUTOMATIC_POWER_RATING_UPDATE_STATUSES.PARTIAL) {
    return {
      detail: [
        `${pluralizeGames(result.gamesProcessed)} processed`,
        result.errors.length > 0
          ? `${result.errors.length} update issue${
              result.errors.length === 1 ? '' : 's'
            }`
          : '',
        result.errors[0]?.reason ?? '',
        result.refreshError
          ? `Ratings refresh failed: ${result.refreshError}`
          : '',
      ]
        .filter(Boolean)
        .join(' | '),
      status: result.status,
      title: 'Power Rating update partially completed',
      tone: 'warning',
    }
  }

  if (
    result.status ===
    AUTOMATIC_POWER_RATING_UPDATE_STATUSES.REQUIRES_INITIALIZATION
  ) {
    return {
      detail:
        result.message ||
        'Power Rating automatic updates need an initial processing point.',
      status: result.status,
      title: 'Power Rating initialization required',
      tone: 'warning',
    }
  }

  if (result.status === AUTOMATIC_POWER_RATING_UPDATE_STATUSES.UNAVAILABLE) {
    return {
      detail: result.errors[0]?.reason ?? '',
      status: result.status,
      title: 'Power Rating update unavailable',
      tone: 'error',
    }
  }

  return null
}

function AutomaticPowerRatingUpdateStatus({
  errorMessage = '',
  onOpenManualUpdate,
  requestStatus,
  result,
}) {
  const presentation = getAutomaticRatingUpdatePresentation({
    errorMessage,
    requestStatus,
    result,
  })

  if (!presentation) {
    return null
  }

  const requiresInitialization =
    presentation.status ===
    AUTOMATIC_POWER_RATING_UPDATE_STATUSES.REQUIRES_INITIALIZATION

  return (
    <div
      className={`automatic-rating-update-status ${presentation.tone}`}
      role={presentation.tone === 'error' ? 'alert' : 'status'}
    >
      <div>
        <strong>{presentation.title}</strong>
        {presentation.detail ? <span>{presentation.detail}</span> : null}
      </div>
      {requiresInitialization && typeof onOpenManualUpdate === 'function' ? (
        <button type="button" onClick={onOpenManualUpdate}>
          Open manual update
        </button>
      ) : null}
    </div>
  )
}

function DashboardSummary({
  bankrollError,
  bankrollStatus,
  bankrollSummary,
  betsError,
  betsStatus,
  currency,
  openBetSummary,
}) {
  const isBankrollLoading = bankrollStatus === 'loading'
  const isBankrollError = bankrollStatus === 'error'
  const isInitialized = Boolean(bankrollSummary?.initialized)
  const bankrollUnavailableText = isBankrollLoading
    ? 'Loading'
    : isBankrollError
      ? 'Unavailable'
      : 'Bankroll not set up'
  const openBetsValue =
    betsStatus === 'loading'
      ? 'Loading'
      : betsStatus === 'error'
        ? 'Unavailable'
        : String(openBetSummary.openBetCount)

  return (
    <section
      className="dashboard-bankroll-section"
      aria-labelledby="dashboard-bankroll-heading"
    >
      <div className="dashboard-section-heading dashboard-bankroll-heading">
        <div>
          <p className="eyebrow">Bankroll</p>
          <h3 id="dashboard-bankroll-heading">Bankroll Overview</h3>
        </div>
      </div>

      <div className="dashboard-bankroll-grid">
        <DashboardMetricCard
          label="Current Bankroll"
          value={
            isInitialized
              ? formatBankrollCurrency(bankrollSummary.currentBankroll, currency)
              : bankrollUnavailableText
          }
          detail={
            isBankrollError
              ? bankrollError
              : isInitialized
                ? 'Settled bankroll balance'
                : 'Set up bankroll in Bet Tracker'
          }
        />
        <DashboardMetricCard
          label="Available Bankroll"
          value={
            isInitialized
              ? formatBankrollCurrency(bankrollSummary.availableBankroll, currency)
              : bankrollUnavailableText
          }
          detail={isInitialized ? 'Current minus pending exposure' : ''}
        />
        <DashboardMetricCard
          label="Pending Exposure"
          tone={isInitialized && bankrollSummary.pendingStake > 0 ? 'warning' : ''}
          value={
            isInitialized
              ? formatBankrollCurrency(bankrollSummary.pendingStake, currency)
              : bankrollUnavailableText
          }
          detail={isInitialized ? 'Open stakes from Bet Tracker' : ''}
        />
        <DashboardMetricCard
          label="Open Bets"
          value={openBetsValue}
          detail={
            betsStatus === 'error'
              ? betsError
              : betsStatus === 'success'
                ? `${formatBankrollCurrency(
                    openBetSummary.pendingExposure,
                    currency,
                  )} pending exposure`
                : ''
          }
        />
      </div>
    </section>
  )
}

function TodayActivitySummary({ ariaLabel, betsStatus, summary }) {
  const items = [
    {
      label: 'Games',
      value: String(summary.gameCount),
    },
    {
      label: 'Analyzed',
      value: String(summary.analyzedCount),
    },
    {
      label: 'Bet Candidates',
      tone: summary.candidateCount > 0 ? 'positive' : '',
      value: String(summary.candidateCount),
    },
    {
      label: 'Bets saved',
      value: betsStatus === 'loading' ? 'Loading' : String(summary.savedBetCount),
    },
  ]

  return (
    <section className="today-activity-strip" aria-label={ariaLabel}>
      {items.map((item) => (
        <div className={`today-activity-stat ${item.tone ?? ''}`} key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </section>
  )
}

function DashboardMetricCard({ detail = '', label, tone = '', value }) {
  return (
    <div className={`dashboard-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function ScheduleLoadingState({ className = 'schedule-grid' }) {
  return (
    <div className={className} aria-label="Loading schedule">
      {[0, 1, 2].map((item) => (
        <div className="schedule-card schedule-card-loading" key={item}>
          <span />
          <strong />
          <div />
          <div />
        </div>
      ))}
    </div>
  )
}

const formatMarketOddsTime = (value) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function MarketOddsStatus({ requestStatus, result }) {
  if (requestStatus === 'idle') {
    return null
  }

  if (requestStatus === 'loading') {
    return (
      <div className="market-odds-status" role="status">
        Loading...
      </div>
    )
  }

  const status = result?.status ?? 'unavailable'
  const updatedAt = formatMarketOddsTime(result?.fetchedAt)
  const statusLabel = getMarketOddsStatusLabel(status, requestStatus)
  const primaryMessage = `${statusLabel}${
    updatedAt && ['cached', 'ready'].includes(status)
      ? ` · updated ${updatedAt}`
      : ''
  }`
  const remaining = result?.quota?.remaining
  const showLowQuota = result?.lowQuota && Number.isFinite(remaining)

  return (
    <div
      className={`market-odds-status ${
        ['invalid_response', 'quota_exhausted', 'rate_limited', 'unavailable'].includes(
          status,
        )
          ? 'warning'
          : ''
      }`}
      role="status"
    >
      <span>{primaryMessage}</span>
      {status === 'no_events' ? (
        <span>Market odds have not opened yet.</span>
      ) : null}
      {showLowQuota ? <span>Low API credits: {remaining} remaining</span> : null}
    </div>
  )
}

function GameMarketOdds({ marketOdds }) {
  const sides = [
    ['Away', 'away'],
    ['Home', 'home'],
  ].filter(([, side]) => parseMarketOdds(marketOdds[side]))

  if (sides.length === 0) {
    return null
  }

  return (
    <div className="game-market-odds" aria-label="Market odds">
      <strong>Market odds</strong>
      {sides.map(([label, side]) => {
        const metadata = marketOdds.metadata?.[side]
        const sourceLabel =
          metadata?.source === 'provider'
            ? metadata.bookmakerTitle || 'The Odds API'
            : 'Manual'

        return (
          <span key={side}>
            {label} {Number(marketOdds[side]).toFixed(2)}
            <small> · {sourceLabel}</small>
          </span>
        )
      })}
      <MarketOddsDetails bookmakers={marketOdds.allBookmakers} />
    </div>
  )
}

function GameCard({
  currency,
  dashboardGame,
  injurySummaries,
  injurySummaryStatus,
  gameContextError,
  gameContextStatus,
  onAnalyzeGame,
  onMarketOddsChange,
  onViewBets,
  scheduleDate,
}) {
  const {
    canAnalyze,
    dashboardStatus,
    game,
    gameContext,
    marketOdds,
    preliminaryAnalysis,
    savedBets,
  } = dashboardGame
  const statusPresentation = dashboardStatus?.statusPresentation ?? {
    label: '',
    tone: 'neutral',
  }
  const statusTone = getStatusTone(game.status)
  const showScore = hasGameScore(game)
  const canUseInjurySummaries = injurySummaryStatus === 'success'
  const isCompletedGame =
    dashboardStatus?.status === DASHBOARD_GAME_STATUSES.FINAL ||
    isGameFinal(game)
  const showDashboardStatus =
    Boolean(statusPresentation.label) &&
    dashboardStatus?.status !== DASHBOARD_GAME_STATUSES.FINAL
  const actionLabel =
    isCompletedGame && savedBets.length > 0 ? 'View Analysis' : 'Analyze Game'
  const awayInjurySummary = getTeamInjurySummary(
    injurySummaries,
    game.awayTeam.abbreviation,
  )
  const homeInjurySummary = getTeamInjurySummary(
    injurySummaries,
    game.homeTeam.abbreviation,
  )
  const cardClassName = [
    'schedule-card',
    statusPresentation.tone,
    savedBets.length > 0 ? 'has-saved-bet' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClassName}>
      <div className="game-card-top">
        <div className="game-card-status-stack">
          <span className={`status-pill game-status ${statusTone}`}>
            {game.status}
          </span>
          {showDashboardStatus ? (
            <span className={`dashboard-card-status ${statusPresentation.tone}`}>
              {statusPresentation.label}
            </span>
          ) : null}
        </div>
        <time dateTime={game.startTimeUTC}>
          {formatStartTime(game.startTimeUTC, scheduleDate)}
        </time>
      </div>

      <div className={`schedule-matchup ${showScore ? 'has-score' : ''}`}>
        <TeamLine showScore={showScore} team={game.awayTeam} />
        <div className="matchup-divider">at</div>
        <TeamLine showScore={showScore} team={game.homeTeam} />
      </div>

      {canUseInjurySummaries ? (
        <div className="game-injury-summary" aria-label="Stored injury impact">
          <span>
            Away injury impact{' '}
            <strong>{formatInjuryImpact(awayInjurySummary.totalImpact)}</strong>
          </span>
          <span>
            Home injury impact{' '}
            <strong>{formatInjuryImpact(homeInjurySummary.totalImpact)}</strong>
          </span>
        </div>
      ) : null}

      <DashboardGoalieSummary game={game} gameContext={gameContext} />

      {savedBets.length > 0 ? (
        <SavedBetSummary
          currency={currency}
          savedBetSummary={dashboardStatus.savedBetSummary}
        />
      ) : null}

      <DashboardIntelligenceSummary
        currency={currency}
        dashboardStatus={dashboardStatus}
      />

      <GameContextSummary
        gameContext={gameContext}
        gameContextError={gameContextError}
        gameContextStatus={gameContextStatus}
      />

      {!isCompletedGame ? <GameMarketOdds marketOdds={marketOdds} /> : null}

      {preliminaryAnalysis?.available ? (
        <PreliminaryAnalysis
          analysis={preliminaryAnalysis}
          awayTeam={game.awayTeam}
          homeTeam={game.homeTeam}
          marketOdds={marketOdds}
          onMarketOddsChange={(side, value) =>
            onMarketOddsChange(game.gameId, side, value)
          }
        />
      ) : null}

      <div
        className={`game-card-actions ${
          savedBets.length > 0 ? 'with-secondary' : ''
        }`}
      >
        <button
          className={`analyze-game-button ${isCompletedGame ? 'historical' : ''}`}
          type="button"
          disabled={!canAnalyze}
          onClick={() => onAnalyzeGame(game, marketOdds, gameContext)}
        >
          {actionLabel}
        </button>
        {savedBets.length > 0 ? (
          <button
            className="view-bet-button"
            type="button"
            onClick={onViewBets}
          >
            View Bet
          </button>
        ) : null}
      </div>
    </article>
  )
}

function DashboardGoalieSummary({ game, gameContext }) {
  const selections = [
    {
      label: 'Away',
      selection: getGoalieSelectionForSide(
        gameContext,
        'away',
        game.awayTeam.id ?? game.awayTeam.abbreviation,
      ),
    },
    {
      label: 'Home',
      selection: getGoalieSelectionForSide(
        gameContext,
        'home',
        game.homeTeam.id ?? game.homeTeam.abbreviation,
      ),
    },
  ]

  return (
    <div className="dashboard-goalie-summary" aria-label="Goalie selections">
      {selections.map(({ label, selection }) => {
        const isUnknown = selection.selectionType === 'unknown'
        let status = 'Unconfirmed'

        if (!isUnknown && selection.confirmationStatus === 'confirmed') {
          status = 'Confirmed'
        } else if (!isUnknown && selection.confirmationStatus === 'expected') {
          status = 'Expected'
        } else if (!isUnknown) {
          status = 'Selected'
        }
        const adjustment = Number(selection.effectiveAdjustment)
        const formattedAdjustment = `${adjustment >= 0 ? '+' : ''}${adjustment.toFixed(2)}`

        return (
          <span key={label}>
            <strong>{label} goalie:</strong>{' '}
            {isUnknown ? 'Unknown starter' : selection.goalieName || 'Unlisted'}
            <small>
              {' '}
              · {formattedAdjustment} · {status}
            </small>
          </span>
        )
      })}
    </div>
  )
}

function GameContextSummary({
  gameContext,
  gameContextError = '',
  gameContextStatus = 'idle',
}) {
  if (!gameContext) {
    if (gameContextStatus === 'error') {
      return (
        <div className="game-context-summary neutral" role="status">
          <span>Context unavailable</span>
          <small>{gameContextError}</small>
        </div>
      )
    }

    return null
  }

  const awayContext = getGameContextForSide(gameContext, 'away')
  const homeContext = getGameContextForSide(gameContext, 'home')
  const items = [
    ['Away', awayContext],
    ['Home', homeContext],
  ].filter(([, context]) => hasNonZeroGameContextAdjustment(context))

  if (items.length === 0) {
    return null
  }

  return (
    <div className="game-context-summary" aria-label="Schedule adjustments">
      <strong className="game-context-summary-title">
        Schedule adjustments
      </strong>
      <div className="game-context-summary-rows">
        {items.map(([label, context]) => (
          <div className="game-context-summary-row" key={label}>
            <span>{label}</span>
            <em>{getCompactGameContextAdjustmentLabel(context)}</em>
            <strong>
              {formatSignedGameContextAdjustment(
                context.totalGameContextAdjustment,
              )}
            </strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function SavedBetSummary({ currency, savedBetSummary }) {
  if (!savedBetSummary?.hasBets) {
    return null
  }

  const { betCount, firstBet, pendingCount, totalStake } = savedBetSummary

  if (betCount > 1) {
    return (
      <div className="saved-bet-summary">
        <span>{betCount} bets saved</span>
        <strong>Total stake {formatDashboardCurrency(totalStake, currency)}</strong>
        {pendingCount > 0 ? <small>{pendingCount} unsettled</small> : null}
      </div>
    )
  }

  const resultPresentation = getBetResultPresentation(firstBet.result)
  const showResult = firstBet.result !== 'pending'

  return (
    <div className="saved-bet-summary">
      <span>Bet Saved</span>
      <strong>{getBetTeamName(firstBet)}</strong>
      <small>
        {formatDashboardCurrency(firstBet.stake, currency)}{' '}
        {formatSavedBetOdds(firstBet.marketOdds)}
      </small>
      {showResult ? (
        <small className={`saved-bet-result ${resultPresentation.tone}`}>
          {resultPresentation.label}
        </small>
      ) : null}
    </div>
  )
}

function DashboardIntelligenceSummary({ currency, dashboardStatus }) {
  const status = dashboardStatus?.status
  const statusReason = dashboardStatus?.statusReason ?? ''
  const valueSide = dashboardStatus?.valueSide
  const evaluatedSideCount = dashboardStatus?.evaluatedSideCount ?? 0
  const oneSideNote =
    evaluatedSideCount === 1 ? 'Only one side evaluated.' : ''

  if (
    status === DASHBOARD_GAME_STATUSES.BET_SAVED ||
    status === DASHBOARD_GAME_STATUSES.FINAL ||
    status === DASHBOARD_GAME_STATUSES.GAME_STARTED
  ) {
    return null
  }

  if (
    status === DASHBOARD_GAME_STATUSES.BET_CANDIDATE ||
    status === DASHBOARD_GAME_STATUSES.WORTH_REVIEWING
  ) {
    const kellyAmount = valueSide?.recommendation?.recommendedStakeAmount
    const showKelly =
      status === DASHBOARD_GAME_STATUSES.BET_CANDIDATE &&
      valueSide?.recommendation?.eligible &&
      Number.isFinite(kellyAmount) &&
      kellyAmount > 0

    if (!valueSide?.team || !Number.isFinite(valueSide.edge)) {
      return null
    }

    return (
      <div className="dashboard-intelligence" aria-label="Dashboard intelligence">
        <div className="value-side-row">
          <span>Value Side</span>
          <strong>{valueSide.team.name}</strong>
        </div>
        <div className="dashboard-intelligence-metrics">
          <span title={PROBABILITY_EDGE_HELP_TEXT}>
            Edge <strong>{formatProbabilityEdge(valueSide.edge)}</strong>
          </span>
          {showKelly ? (
            <span>
              Kelly{' '}
              <strong>{formatDashboardCurrency(kellyAmount, currency)}</strong>
            </span>
          ) : null}
        </div>
        {statusReason || oneSideNote ? (
          <small>{[statusReason, oneSideNote].filter(Boolean).join(' ')}</small>
        ) : null}
      </div>
    )
  }

  if (status === DASHBOARD_GAME_STATUSES.ADD_ODDS) {
    return (
      <div className="dashboard-intelligence neutral" aria-label="Dashboard intelligence">
        <strong>Preliminary probabilities are ready.</strong>
        <small>Enter market odds to evaluate betting value.</small>
      </div>
    )
  }

  if (status === DASHBOARD_GAME_STATUSES.NO_CURRENT_VALUE) {
    return (
      <div className="dashboard-intelligence neutral" aria-label="Dashboard intelligence">
        <strong>No positive edge at the entered odds.</strong>
        {oneSideNote ? <small>{oneSideNote}</small> : null}
      </div>
    )
  }

  if (status === DASHBOARD_GAME_STATUSES.PRELIMINARY_ANALYSIS_UNAVAILABLE) {
    return (
      <div className="dashboard-intelligence neutral" aria-label="Dashboard intelligence">
        <strong>Preliminary analysis unavailable.</strong>
        {statusReason ? <small>{statusReason}</small> : null}
      </div>
    )
  }

  return null
}

function LastNightSection({
  bettingSummary,
  betsByGameId,
  currency,
  date,
  errorMessage,
  eyebrow,
  games,
  onRetry,
  onViewBets,
  status,
}) {
  const isLoading = status === 'loading'
  const isError = status === 'error'
  const isSuccess = status === 'success'
  const netProfitTone = getProfitTone(bettingSummary.netProfit)
  const summaryValue = (value) => (isLoading ? 'Loading' : String(value))

  return (
    <section
      className="last-night-section"
      aria-labelledby="dashboard-previous-heading"
    >
      <div className="dashboard-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3 id="dashboard-previous-heading">{formatScheduleDate(date)}</h3>
        </div>
      </div>

      <LastNightBettingSummary
        bettingSummary={bettingSummary}
        currency={currency}
        emptyMessage="No bets were recorded for this day."
        isLoading={isLoading}
        netProfitTone={netProfitTone}
        summaryValue={summaryValue}
      />

      {isLoading ? (
        <div
          className="last-night-result-list"
          aria-label="Loading previous day results"
        >
          {[0, 1].map((item) => (
            <div
              className="last-night-result-card schedule-card-loading"
              key={item}
            >
              <span />
              <strong />
              <div />
            </div>
          ))}
        </div>
      ) : null}

      {isError ? (
        <div className="schedule-state error-state" role="alert">
          <strong>Last night unavailable</strong>
          <p>{errorMessage}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {isSuccess && games.length === 0 ? (
        <p className="empty-state">
          No NHL games were completed last night.
        </p>
      ) : null}

      {isSuccess && games.length > 0 ? (
        <div className="last-night-result-list">
          {games.map((game) => (
            <LastNightGameCard
              bets={betsByGameId[getGameId(game)] ?? []}
              currency={currency}
              game={game}
              key={game.gameId}
              onViewBets={onViewBets}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function LastNightBettingSummary({
  bettingSummary,
  currency,
  emptyMessage,
  isLoading,
  netProfitTone,
  summaryValue,
}) {
  if (!isLoading && bettingSummary.betCount === 0) {
    return <p className="last-night-no-bets">{emptyMessage}</p>
  }

  return (
    <dl className="last-night-compact-summary" aria-label="Previous day bets">
      <div>
        <dt>Bets</dt>
        <dd>{summaryValue(bettingSummary.betCount)}</dd>
      </div>
      <div>
        <dt>Record</dt>
        <dd>
          {isLoading
            ? 'Loading'
            : `${bettingSummary.wonCount}-${bettingSummary.lostCount}`}
        </dd>
      </div>
      <div>
        <dt>Pending</dt>
        <dd>{summaryValue(bettingSummary.pendingCount)}</dd>
      </div>
      <div className={`net ${netProfitTone}`}>
        <dt>Net</dt>
        <dd>
          {isLoading
            ? 'Loading'
            : formatSignedDashboardCurrency(bettingSummary.netProfit, currency)}
        </dd>
      </div>
    </dl>
  )
}

function LastNightGameCard({ bets, currency, game, onViewBets }) {
  const showScore = hasGameScore(game)
  const statusTone = getStatusTone(game.status)
  const winner = getWinner(game)
  const visibleBets = bets.slice(0, 3)
  const remainingBetCount = Math.max(0, bets.length - visibleBets.length)

  return (
    <article
      className={`last-night-result-card ${bets.length > 0 ? 'has-bet' : ''}`}
    >
      <div className="last-night-result-meta">
        <span className={`status-pill game-status ${statusTone}`}>
          {game.status}
        </span>
        <span className="last-night-winner">
          Winner <strong>{winner?.name ?? 'Unavailable'}</strong>
        </span>
      </div>

      <div className="last-night-scoreline">
        <LastNightTeamLine
          isWinner={winner?.abbreviation === game.awayTeam.abbreviation}
          showScore={showScore}
          team={game.awayTeam}
        />
        <LastNightTeamLine
          isWinner={winner?.abbreviation === game.homeTeam.abbreviation}
          showScore={showScore}
          team={game.homeTeam}
        />
      </div>

      {bets.length > 0 ? (
        <div className="last-night-bet-list">
          {visibleBets.map((bet) => (
            <LastNightBetDetail bet={bet} currency={currency} key={bet.id} />
          ))}
          {remainingBetCount > 0 ? (
            <small className="dashboard-muted-note compact">
              +{remainingBetCount} more in Bet Tracker
            </small>
          ) : null}
          <button className="view-bet-button compact" type="button" onClick={onViewBets}>
            View Bet
          </button>
        </div>
      ) : (
        <p className="dashboard-muted-note compact">No bet recorded.</p>
      )}
    </article>
  )
}

function LastNightTeamLine({ isWinner, showScore, team = {} }) {
  return (
    <div className={`last-night-team-line ${isWinner ? 'winner' : ''}`}>
      <div className="last-night-logo-shell">
        {team.logo ? (
          <img src={team.logo} alt={`${team.name} logo`} loading="lazy" />
        ) : (
          <span>{team.abbreviation}</span>
        )}
      </div>
      <span>{team.name}</span>
      <strong>{showScore ? team.score : '--'}</strong>
    </div>
  )
}

function LastNightBetDetail({ bet, currency }) {
  const resultPresentation = getBetResultPresentation(bet.result)
  const profit = getBetProfit(bet)
  const showProfit = bet.result !== 'pending'

  return (
    <div className="last-night-bet-detail">
      <div className="last-night-bet-main">
        <span className={`saved-bet-result ${resultPresentation.tone}`}>
          {resultPresentation.label}
        </span>
        <strong>{getBetTeamName(bet)}</strong>
      </div>
      <small>
        {formatDashboardCurrency(bet.stake, currency)}{' '}
        {formatSavedBetOdds(bet.marketOdds)}
      </small>
      {showProfit ? (
        <small className={`profit-value ${getProfitTone(profit)}`}>
          Profit {formatSignedDashboardCurrency(profit, currency)}
        </small>
      ) : (
        <small>Settlement pending</small>
      )}
    </div>
  )
}

function InjurySummaryNotice({ errorMessage, onRetry, status }) {
  if (status === 'success') {
    return null
  }

  const isError = status === 'error'
  const title = isError
    ? 'Injury summary unavailable'
    : 'Loading injury summary'
  const message = isError
    ? errorMessage
    : 'Stored injury impacts will be applied once MongoDB summaries load.'

  return (
    <div
      className={`ratings-dependency-notice ${isError ? 'error' : ''}`}
      role={isError ? 'alert' : undefined}
    >
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

function PowerRatingsNotice({ errorMessage, onRetry, status }) {
  if (status === 'success') {
    return null
  }

  const isError = status === 'error'
  const isEmpty = status === 'empty'
  const title = isError
    ? 'Power ratings unavailable'
    : isEmpty
      ? 'No power ratings found'
      : 'Loading power ratings'
  const message = isError
    ? errorMessage
    : isEmpty
      ? 'Seed MongoDB ratings before running preliminary calculations.'
      : 'Preliminary calculations will appear once MongoDB ratings load.'

  return (
    <div
      className={`ratings-dependency-notice ${isError ? 'error' : ''}`}
      role={isError ? 'alert' : undefined}
    >
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError || isEmpty ? (
        <button type="button" onClick={onRetry}>
          {isEmpty ? 'Seed teams' : 'Try again'}
        </button>
      ) : null}
    </div>
  )
}

function RatingEngineSettingsNotice({ errorMessage, onRetry, status }) {
  if (status === 'success') {
    return null
  }

  const isError = status === 'error'
  const title = isError
    ? 'Engine settings unavailable'
    : 'Loading engine settings'
  const message = isError
    ? errorMessage
    : 'Preliminary calculations will appear once Base Home Advantage loads.'

  return (
    <div
      className={`ratings-dependency-notice ${isError ? 'error' : ''}`}
      role={isError ? 'alert' : undefined}
    >
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

function PreliminaryAnalysis({
  analysis,
  awayTeam,
  homeTeam,
  marketOdds,
  onMarketOddsChange,
}) {
  return (
    <div className="preliminary-panel" aria-label="Preliminary model analysis">
      <div className="preliminary-status-row">
        <span className="preliminary-badge">Preliminary</span>
        {analysis.usesUnknownInputs ? (
          <span className="review-badge">Defaults used</span>
        ) : null}
      </div>

      <div className="preliminary-market-grid">
        <PreliminaryMarketSide
          label="Away"
          market={analysis.awayMarket}
          marketOddsValue={marketOdds.away}
          onMarketOddsChange={(value) => onMarketOddsChange('away', value)}
          team={awayTeam}
        />
        <PreliminaryMarketSide
          label="Home"
          market={analysis.homeMarket}
          marketOddsValue={marketOdds.home}
          onMarketOddsChange={(value) => onMarketOddsChange('home', value)}
          team={homeTeam}
        />
      </div>

      <details className="preliminary-details">
        <summary>Preliminary details</summary>
        <div className="preliminary-detail-grid">
          <PreliminaryDetailSide
            finalRating={analysis.awayFinalRating}
            label="Away"
            market={analysis.awayMarket}
            team={awayTeam}
          />
          <PreliminaryDetailSide
            finalRating={analysis.homeFinalRating}
            label="Home"
            market={analysis.homeMarket}
            team={homeTeam}
          />
        </div>
      </details>
    </div>
  )
}

function PreliminaryMarketSide({
  label,
  market,
  marketOddsValue,
  onMarketOddsChange,
  team,
}) {
  const hasInvalidOdds =
    marketOddsValue !== '' &&
    marketOddsValue !== null &&
    marketOddsValue !== undefined &&
    !parseMarketOdds(marketOddsValue)
  const validationId = `dashboard-${team.abbreviation || label}-market-odds-validation`

  return (
    <div className="preliminary-market-side">
      <div>
        <span>{label} fair</span>
        <strong>{formatOdds(market.fairOdds)}</strong>
      </div>
      <label>
        <span>Market</span>
        <input
          aria-label={`${team.name} market odds`}
          aria-describedby={hasInvalidOdds ? validationId : undefined}
          aria-invalid={hasInvalidOdds}
          inputMode="decimal"
          min="1.01"
          placeholder="Odds"
          step="0.01"
          type="number"
          value={marketOddsValue}
          onChange={(event) => onMarketOddsChange(event.target.value)}
        />
        {hasInvalidOdds ? (
          <small id={validationId} role="alert">
            Market odds must be greater than 1.
          </small>
        ) : null}
      </label>
    </div>
  )
}

function PreliminaryDetailSide({ finalRating, label, market, team }) {
  return (
    <div className="preliminary-detail-side">
      <strong>{team.abbreviation || label}</strong>
      <span>Rating {formatRating(finalRating)}</span>
      <span>Model {formatPercent(market.modelProbability)}</span>
      <span>Implied {formatPercent(market.impliedProbability)}</span>
      <span title={PROBABILITY_EDGE_HELP_TEXT}>
        Probability edge {formatProbabilityEdge(market.edge)}
      </span>
      <span>Expected value {formatExpectedValue(market.expectedValue)}</span>
    </div>
  )
}

function TeamLine({ showScore, team = {} }) {
  return (
    <div className="schedule-team">
      <div className="team-logo-shell">
        {team.logo ? (
          <img src={team.logo} alt={`${team.name} logo`} loading="lazy" />
        ) : (
          <span>{team.abbreviation}</span>
        )}
      </div>
      <div className="schedule-team-copy">
        <strong>{team.name}</strong>
      </div>
      <strong className={`team-score ${showScore ? '' : 'empty'}`}>
        {showScore ? team.score : ''}
      </strong>
    </div>
  )
}

export default Dashboard
