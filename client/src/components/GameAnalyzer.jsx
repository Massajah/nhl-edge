import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import AdjustmentComparison from './AdjustmentComparison.jsx'
import ResultCard from './ResultCard.jsx'
import TeamSelector from './TeamSelector.jsx'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import { getBankrollSummary } from '../services/bankrollApi.js'
import { createBet, fetchBets } from '../services/betsApi.js'
import { getBettingSettings } from '../services/bettingSettingsApi.js'
import {
  fetchGameContexts,
  updateGameContextOverrides,
  updateGameGoalieSelections,
} from '../services/gameContextApi.js'
import { parseBankrollMoneyInput } from '../utils/bankroll.js'
import {
  fetchGoalieAdjustments,
  fetchTeamGoalieSummaries,
} from '../services/teamsApi.js'
import { calculateGame, parseMarketOdds } from '../utils/calculateGame.js'
import {
  DEFAULT_BETTING_SETTINGS,
  normalizeBettingSettings,
} from '../utils/bettingSettings.js'
import {
  createKellyRecommendationSnapshot,
  createKellyStakeRecommendation,
  formatStakeInputValue,
} from '../utils/kellyStaking.js'
import {
  applyGameContextDraftToInputs,
  applyGameContextToInputs,
  formatSignedGameContextAdjustment,
  getGameContextForSide,
  getTeamGameContextPresentation,
  normalizeGameContext,
} from '../utils/gameContext.js'
import {
  applyTeamRatingsToInputs,
  createInputsForTeams,
} from '../utils/modelAnalysis.js'
import {
  createBetPayloadFromGameAnalysis,
  getBetSignature,
  normalizeBets,
} from '../utils/savedAnalyses.js'
import { markOddsAsManual } from '../utils/marketOdds.js'
import {
  createGoalieSelectionPayload,
  createUnknownGoalieSelection,
  goalieSelectionToInputFields,
  normalizeProviderGoalies,
  updateGoalieInputs,
  validateGoalieSelectionInputs,
} from '../utils/goalies.js'
import MarketOddsDetails from './MarketOddsDetails.jsx'

const findTeamById = (teamId) => NHL_TEAMS.find((team) => team.id === teamId)

const findTeam = (teamId) => findTeamById(teamId) ?? NHL_TEAMS[0]

const defaultTeams = {
  home: 'TOR',
  away: 'BOS',
}

const adjustmentLimits = {
  goalieAdjustment: { max: 5, min: -5 },
  homeAdvantage: { max: 10, min: -10 },
  injuries: { max: 20, min: -20 },
  manualAdjustment: { max: 2, min: -2 },
  motivation: { max: 2, min: -2 },
  quickRematchAdjustment: { max: 3, min: -3 },
  restFatigue: { max: 3, min: -3 },
}

const clamp = (value, { max, min }) => Math.min(Math.max(value, min), max)

const formatAnalyzerMarketOdds = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 1
    ? numberValue.toFixed(2)
    : '--'
}

const formatAnalyzerUtcTime = (value) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')} UTC`
}

const getTeamLogo = (team = {}) =>
  team.logo || getTeamMetadata(team.abbreviation).logo || ''

const formatRating = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '--'

const normalizeSelectedTeams = (teams = defaultTeams) => {
  const homeTeam = findTeamById(teams.home) ?? findTeam(defaultTeams.home)
  const awayTeam = findTeamById(teams.away) ?? findTeam(defaultTeams.away)

  if (homeTeam.id !== awayTeam.id) {
    return {
      home: homeTeam.id,
      away: awayTeam.id,
    }
  }

  const fallbackAwayTeam =
    NHL_TEAMS.find((team) => team.id !== homeTeam.id) ?? NHL_TEAMS[0]

  return {
    home: homeTeam.id,
    away: fallbackAwayTeam.id,
  }
}

const formatSavedTime = (dateTime) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateTime))

const createGameContextDraft = (gameContext) => {
  const normalizedContext = normalizeGameContext(gameContext)
  const awayContext = getGameContextForSide(normalizedContext, 'away')
  const homeContext = getGameContextForSide(normalizedContext, 'home')

  return {
    awayContext: {
      manualQuickRematchAdjustment: String(
        awayContext.manualQuickRematchAdjustment,
      ),
      manualRestFatigueAdjustment: String(
        awayContext.manualRestFatigueAdjustment,
      ),
      quickRematchOverrideEnabled: awayContext.quickRematchOverrideEnabled,
      restFatigueOverrideEnabled: awayContext.restFatigueOverrideEnabled,
    },
    homeContext: {
      manualQuickRematchAdjustment: String(
        homeContext.manualQuickRematchAdjustment,
      ),
      manualRestFatigueAdjustment: String(
        homeContext.manualRestFatigueAdjustment,
      ),
      quickRematchOverrideEnabled: homeContext.quickRematchOverrideEnabled,
      restFatigueOverrideEnabled: homeContext.restFatigueOverrideEnabled,
    },
  }
}

const parseContextDraftAdjustment = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue)
    ? clamp(numberValue, { max: 3, min: -3 })
    : 0
}

const createGameContextOverridePayload = (draft) => ({
  awayContext: {
    manualQuickRematchAdjustment: parseContextDraftAdjustment(
      draft.awayContext.manualQuickRematchAdjustment,
    ),
    manualRestFatigueAdjustment: parseContextDraftAdjustment(
      draft.awayContext.manualRestFatigueAdjustment,
    ),
    quickRematchOverrideEnabled:
      draft.awayContext.quickRematchOverrideEnabled,
    restFatigueOverrideEnabled: draft.awayContext.restFatigueOverrideEnabled,
  },
  homeContext: {
    manualQuickRematchAdjustment: parseContextDraftAdjustment(
      draft.homeContext.manualQuickRematchAdjustment,
    ),
    manualRestFatigueAdjustment: parseContextDraftAdjustment(
      draft.homeContext.manualRestFatigueAdjustment,
    ),
    quickRematchOverrideEnabled:
      draft.homeContext.quickRematchOverrideEnabled,
    restFatigueOverrideEnabled: draft.homeContext.restFatigueOverrideEnabled,
  },
})

const formatRestDays = (value) =>
  Number.isFinite(Number(value)) ? String(Number(value)) : '--'

const getGameContextStatusLabel = (gameContext, contextRequestGame) => {
  const gameState = String(
    gameContext?.gameState ?? contextRequestGame?.gameState ?? '',
  ).toUpperCase()
  const status = String(
    gameContext?.status ?? contextRequestGame?.status ?? '',
  ).toLowerCase()

  if (['FINAL', 'OFF'].includes(gameState) || status.includes('final')) {
    return 'Final'
  }

  if (
    (gameState && !['FUT', 'PRE'].includes(gameState)) ||
    status.includes('live') ||
    status.includes('progress')
  ) {
    return 'Live'
  }

  return 'Scheduled'
}

const areGameContextDraftsEqual = (leftDraft, rightDraft) =>
  JSON.stringify(createGameContextOverridePayload(leftDraft)) ===
  JSON.stringify(createGameContextOverridePayload(rightDraft))

function GameAnalyzer({
  baseHomeAdvantage = 0,
  injurySummaries,
  injurySummaryError,
  injurySummaryStatus,
  onRetryInjuries,
  onRetryPowerRatings,
  onRetryRatingEngineSettings,
  onNavigate,
  powerRatings,
  powerRatingsError,
  powerRatingsStatus,
  prefillMatchup,
  ratingEngineSettingsError,
  ratingEngineSettingsStatus,
}) {
  const initialGameContext = normalizeGameContext(prefillMatchup?.gameContext)
  const [matchup, setMatchup] = useState(() => {
    const initialTeams = normalizeSelectedTeams(prefillMatchup ?? defaultTeams)

    return {
      teams: initialTeams,
      inputs: createInputsForTeams(
        powerRatings,
        initialTeams,
        prefillMatchup?.marketOdds,
        injurySummaries,
        baseHomeAdvantage,
        initialGameContext,
      ),
    }
  })
  const [gameContext, setGameContext] = useState(initialGameContext)
  const [marketOddsMetadata, setMarketOddsMetadata] = useState(() => ({
    away: prefillMatchup?.marketOdds?.metadata?.away ?? null,
    home: prefillMatchup?.marketOdds?.metadata?.home ?? null,
  }))
  const [gameContextDraft, setGameContextDraft] = useState(() =>
    createGameContextDraft(initialGameContext),
  )
  const [gameContextStatus, setGameContextStatus] = useState(
    initialGameContext ? 'success' : 'idle',
  )
  const [gameContextSaveStatus, setGameContextSaveStatus] = useState('idle')
  const [gameContextMessage, setGameContextMessage] = useState('')
  const [goalieStatsByPlayerId, setGoalieStatsByPlayerId] = useState({})
  const [goalieStatusByTeam, setGoalieStatusByTeam] = useState({})
  const [goalieErrorByTeam, setGoalieErrorByTeam] = useState({})
  const [teamGoaliesByTeam, setTeamGoaliesByTeam] = useState({})
  const [goalieSaveStatus, setGoalieSaveStatus] = useState('idle')
  const [goalieSaveMessage, setGoalieSaveMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [selectedSaveSide, setSelectedSaveSide] = useState('home')
  const [isBetReviewOpen, setIsBetReviewOpen] = useState(false)
  const [stake, setStake] = useState('')
  const [betNotes, setBetNotes] = useState('')
  const [bettingSettings, setBettingSettings] = useState(() =>
    normalizeBettingSettings(DEFAULT_BETTING_SETTINGS),
  )
  const [bettingSettingsStatus, setBettingSettingsStatus] =
    useState('loading')
  const [bettingSettingsError, setBettingSettingsError] = useState('')
  const [bankrollSummary, setBankrollSummary] = useState(null)
  const [bankrollStatus, setBankrollStatus] = useState('loading')
  const [bankrollError, setBankrollError] = useState('')
  const { teams, inputs } = matchup

  const homeTeam = findTeam(teams.home)
  const awayTeam = findTeam(teams.away)
  const isUsingPrefilledGameTeams =
    Boolean(prefillMatchup?.gameId) &&
    teams.away === prefillMatchup.away &&
    teams.home === prefillMatchup.home
  const contextRequestGame = useMemo(() => {
    if (!isUsingPrefilledGameTeams) {
      return null
    }

    if (prefillMatchup?.game) {
      return prefillMatchup.game
    }

    if (!prefillMatchup?.gameId || !prefillMatchup?.scheduledStart) {
      return null
    }

    return {
      awayTeam: {
        abbreviation: awayTeam.abbreviation,
        name: awayTeam.name,
      },
      gameId: prefillMatchup.gameId,
      gameState: 'FUT',
      homeTeam: {
        abbreviation: homeTeam.abbreviation,
        name: homeTeam.name,
      },
      startTimeUTC: prefillMatchup.scheduledStart,
      status: 'Scheduled',
    }
  }, [
    awayTeam.abbreviation,
    awayTeam.name,
    homeTeam.abbreviation,
    homeTeam.name,
    isUsingPrefilledGameTeams,
    prefillMatchup,
  ])
  const hasUnsavedGameContextChanges = useMemo(
    () =>
      Boolean(gameContext) &&
      !areGameContextDraftsEqual(
        gameContextDraft,
        createGameContextDraft(gameContext),
      ),
    [gameContext, gameContextDraft],
  )
  const goalieSelectionPayload = useMemo(
    () => ({
      away: createGoalieSelectionPayload(inputs.away, awayTeam.id),
      home: createGoalieSelectionPayload(inputs.home, homeTeam.id),
    }),
    [awayTeam.id, homeTeam.id, inputs.away, inputs.home],
  )
  const goalieValidationErrors = useMemo(
    () => ({
      away: validateGoalieSelectionInputs(inputs.away),
      home: validateGoalieSelectionInputs(inputs.home),
    }),
    [inputs.away, inputs.home],
  )
  const hasGoalieValidationErrors = Boolean(
    goalieValidationErrors.away || goalieValidationErrors.home,
  )
  const hasUnsavedGoalieChanges = useMemo(() => {
    if (!contextRequestGame?.gameId) {
      return false
    }

    const persistedSelections = {
      away: gameContext?.goalieSelections?.away ??
        createUnknownGoalieSelection(awayTeam.id),
      home: gameContext?.goalieSelections?.home ??
        createUnknownGoalieSelection(homeTeam.id),
    }

    return JSON.stringify(goalieSelectionPayload) !==
      JSON.stringify(persistedSelections)
  }, [
    awayTeam.id,
    contextRequestGame?.gameId,
    gameContext?.goalieSelections,
    goalieSelectionPayload,
    homeTeam.id,
  ])

  const result = useMemo(
    () => calculateGame(inputs.home, inputs.away),
    [inputs],
  )

  useEffect(() => {
    if (
      powerRatingsStatus !== 'success' ||
      injurySummaryStatus !== 'success' ||
      ratingEngineSettingsStatus !== 'success'
    ) {
      return undefined
    }

    const timerId = setTimeout(() => {
      setMatchup((currentMatchup) => ({
        ...currentMatchup,
        inputs: applyTeamRatingsToInputs(
          powerRatings,
          currentMatchup.teams,
          currentMatchup.inputs,
          injurySummaries,
          baseHomeAdvantage,
          gameContext,
        ),
      }))
    }, 0)

    return () => clearTimeout(timerId)
  }, [
    baseHomeAdvantage,
    gameContext,
    injurySummaries,
    injurySummaryStatus,
    powerRatings,
    powerRatingsStatus,
    ratingEngineSettingsStatus,
  ])

  const homeMarket = useMemo(
    () => ({
      expectedValue: result.homeExpectedValue,
      fairOdds: result.homeFairOdds,
      impliedProbability: result.homeImpliedProbability,
      marketOdds: parseMarketOdds(inputs.home.marketOdds),
      modelProbability: result.homeWinProbability,
      modelStatus: result.homeModelStatus,
      probabilityEdge: result.homeEdge,
      recommendation: result.homeRecommendation,
    }),
    [
      inputs.home.marketOdds,
      result.homeEdge,
      result.homeExpectedValue,
      result.homeFairOdds,
      result.homeImpliedProbability,
      result.homeModelStatus,
      result.homeRecommendation,
      result.homeWinProbability,
    ],
  )
  const awayMarket = useMemo(
    () => ({
      expectedValue: result.awayExpectedValue,
      fairOdds: result.awayFairOdds,
      impliedProbability: result.awayImpliedProbability,
      marketOdds: parseMarketOdds(inputs.away.marketOdds),
      modelProbability: result.awayWinProbability,
      modelStatus: result.awayModelStatus,
      probabilityEdge: result.awayEdge,
      recommendation: result.awayRecommendation,
    }),
    [
      inputs.away.marketOdds,
      result.awayEdge,
      result.awayExpectedValue,
      result.awayFairOdds,
      result.awayImpliedProbability,
      result.awayModelStatus,
      result.awayRecommendation,
      result.awayWinProbability,
    ],
  )
  const saveSideOptions = useMemo(
    () =>
      [
        { market: homeMarket, side: 'home', team: homeTeam },
        { market: awayMarket, side: 'away', team: awayTeam },
      ],
    [awayMarket, awayTeam, homeMarket, homeTeam],
  )
  const validSaveSides = useMemo(
    () => saveSideOptions.filter(({ market }) => Boolean(market.marketOdds)),
    [saveSideOptions],
  )
  const hasReviewableSide = validSaveSides.length > 0

  useEffect(() => {
    setSelectedSaveSide((currentSide) => {
      const isCurrentSideValid = validSaveSides.some(
        ({ side }) => side === currentSide,
      )

      if (isCurrentSideValid || validSaveSides.length === 0) {
        return currentSide
      }

      return validSaveSides[0].side
    })
  }, [validSaveSides])

  useEffect(() => {
    if (!hasReviewableSide) {
      setIsBetReviewOpen(false)
    }
  }, [hasReviewableSide])

  const reviewDisabledReason = hasReviewableSide
    ? ''
    : 'Add valid market odds greater than 1 for at least one side.'

  useEffect(() => {
    let isCurrent = true

    const loadGameContext = async () => {
      if (!contextRequestGame) {
        setGameContext(null)
        setGameContextDraft(createGameContextDraft(null))
        setGameContextStatus('idle')
        setGameContextMessage('')
        return
      }

      setGameContextStatus('loading')
      setGameContextMessage('')

      try {
        const result = await fetchGameContexts([contextRequestGame])
        const nextContext = result.contexts[0] ?? null

        if (!isCurrent) {
          return
        }

        setGameContext(nextContext)
        setGameContextDraft(createGameContextDraft(nextContext))
        setGameContextStatus(nextContext ? 'success' : 'idle')

        if (nextContext) {
          setMatchup((currentMatchup) => ({
            ...currentMatchup,
            inputs: applyGameContextToInputs(currentMatchup.inputs, nextContext),
          }))
        }
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setGameContext(null)
        setGameContextDraft(createGameContextDraft(null))
        setGameContextStatus('error')
        setGameContextMessage(error.message)
      }
    }

    loadGameContext()

    return () => {
      isCurrent = false
    }
  }, [contextRequestGame])

  const openBetReview = () => {
    if (!hasReviewableSide) {
      return
    }

    setSaveStatus('idle')
    setSaveMessage('')
    setSelectedSaveSide((currentSide) =>
      validSaveSides.some(({ side }) => side === currentSide)
        ? currentSide
        : validSaveSides[0].side,
    )
    setIsBetReviewOpen(true)
  }

  const closeBetReview = () => {
    setSaveStatus('idle')
    setSaveMessage('')
    setIsBetReviewOpen(false)
  }

  const selectedMarket = selectedSaveSide === 'home' ? homeMarket : awayMarket
  const selectedMarketOdds = selectedMarket.marketOdds
  const parsedStake = parseBankrollMoneyInput(stake)
  const stakeValue = parsedStake ?? 0
  const isStakeValid = parsedStake !== null
  const hasValidModelProbability =
    Number.isFinite(selectedMarket.modelProbability) &&
    selectedMarket.modelProbability > 0 &&
    selectedMarket.modelProbability <= 1
  const canSaveBet =
    Boolean(selectedMarketOdds) &&
    hasValidModelProbability &&
    isStakeValid &&
    !hasGoalieValidationErrors
  const saveDisabledReason = hasGoalieValidationErrors
    ? 'Complete the required game-specific goalie adjustment.'
    : !selectedMarketOdds
    ? 'Add valid market odds for the selected side.'
    : !hasValidModelProbability
      ? 'Model probability is unavailable for the selected side.'
      : !isStakeValid
        ? 'Enter a stake greater than 0 with up to two decimals.'
        : ''

  const loadBankrollSummary = useCallback(async ({ shouldApply } = {}) => {
    const canApply = () =>
      typeof shouldApply === 'function' ? shouldApply() : true

    if (canApply()) {
      setBankrollStatus('loading')
      setBankrollError('')
    }

    try {
      const summary = await getBankrollSummary()

      if (canApply()) {
        setBankrollSummary(summary)
        setBankrollStatus('success')
      }

      return summary
    } catch (error) {
      if (canApply()) {
        setBankrollSummary(null)
        setBankrollStatus('error')
        setBankrollError(error.message)
      }
      throw error
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadAnalyzerBettingSettings = async () => {
      setBettingSettingsStatus('loading')
      setBettingSettingsError('')

      try {
        const result = await getBettingSettings()

        if (!isCurrent) {
          return
        }

        setBettingSettings(normalizeBettingSettings(result.settings))
        setBettingSettingsStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setBettingSettings(normalizeBettingSettings(DEFAULT_BETTING_SETTINGS))
        setBettingSettingsStatus('error')
        setBettingSettingsError(error.message)
      }
    }

    loadAnalyzerBettingSettings()

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    loadBankrollSummary({ shouldApply: () => isCurrent }).catch(() => {
      if (!isCurrent) {
        return
      }
      // Error state is already captured for the recommendation card.
    })

    return () => {
      isCurrent = false
    }
  }, [loadBankrollSummary])

  const selectedStakeRecommendation = useMemo(
    () =>
      createKellyStakeRecommendation({
        bankrollSummary,
        decimalOdds: selectedMarket.marketOdds,
        modelProbability: selectedMarket.modelProbability,
        settings: bettingSettings,
      }),
    [
      bankrollSummary,
      bettingSettings,
      selectedMarket.marketOdds,
      selectedMarket.modelProbability,
    ],
  )

  const loadTeamGoalies = useCallback(
    async (team, { force = false } = {}) => {
      if (!team?.abbreviation) {
        return
      }

      const teamKey = team.abbreviation
      const currentStatus = goalieStatusByTeam[teamKey]

      if (
        !force &&
        (currentStatus === 'loading' || currentStatus === 'success')
      ) {
        return
      }

      setGoalieStatusByTeam((currentStatuses) => ({
        ...currentStatuses,
        [teamKey]: 'loading',
      }))
      setGoalieErrorByTeam((currentErrors) => ({
        ...currentErrors,
        [teamKey]: '',
      }))

      try {
        const [teamGoaliesResult, goalieSummariesResult] =
          await Promise.allSettled([
          fetchGoalieAdjustments(team.abbreviation),
          fetchTeamGoalieSummaries(teamKey),
          ])

        if (teamGoaliesResult.status === 'rejected') {
          throw teamGoaliesResult.reason
        }

        const summaries =
          goalieSummariesResult.status === 'fulfilled'
            ? goalieSummariesResult.value?.goalies ?? []
            : []

        setTeamGoaliesByTeam((currentGoalies) => ({
          ...currentGoalies,
          [teamKey]: normalizeProviderGoalies(
            teamGoaliesResult.value.goalies,
          ),
        }))
        setGoalieStatsByPlayerId((currentStats) => {
          const nextStats = { ...currentStats }

          summaries.forEach((goalieSummary) => {
            if (!goalieSummary.playerId) {
              return
            }

            const playerKey = String(goalieSummary.playerId)

            nextStats[playerKey] = {
              ...nextStats[playerKey],
              currentSeason: goalieSummary.currentSeason,
              playerId: goalieSummary.playerId,
              playerName: goalieSummary.playerName,
            }
          })

          return nextStats
        })
        setGoalieStatusByTeam((currentStatuses) => ({
          ...currentStatuses,
          [teamKey]: 'success',
        }))
      } catch (error) {
        setGoalieStatusByTeam((currentStatuses) => ({
          ...currentStatuses,
          [teamKey]: 'error',
        }))
        setGoalieErrorByTeam((currentErrors) => ({
          ...currentErrors,
          [teamKey]: error.message,
        }))
      }
    },
    [goalieStatusByTeam],
  )

  useEffect(() => {
    loadTeamGoalies(awayTeam)
    loadTeamGoalies(homeTeam)
  }, [awayTeam, homeTeam, loadTeamGoalies])

  const getGoaliesForSide = useCallback(
    (side) => {
      const team = side === 'home' ? homeTeam : awayTeam

      return teamGoaliesByTeam[team.abbreviation] ?? []
    },
    [awayTeam, homeTeam, teamGoaliesByTeam],
  )

  const handleTeamChange = (side, teamId) => {
    setSaveStatus('idle')
    setSaveMessage('')
    setIsBetReviewOpen(false)
    setGameContext(null)
    setGameContextDraft(createGameContextDraft(null))
    setGameContextStatus('idle')
    setGameContextSaveStatus('idle')
    setGameContextMessage('')

    setMatchup((currentMatchup) => {
      const currentTeams = currentMatchup.teams
      const otherSide = side === 'home' ? 'away' : 'home'
      let nextTeams

      if (teamId !== currentTeams[otherSide]) {
        nextTeams = { ...currentTeams, [side]: teamId }
      } else {
        const fallbackTeam =
          NHL_TEAMS.find(
            (team) => team.id !== teamId && team.id !== currentTeams[side],
          ) ?? NHL_TEAMS[0]

        nextTeams = {
          ...currentTeams,
          [side]: teamId,
          [otherSide]: fallbackTeam.id,
        }
      }

      const nextInputs = applyTeamRatingsToInputs(
        powerRatings,
        nextTeams,
        currentMatchup.inputs,
        injurySummaries,
        baseHomeAdvantage,
      )
      const changedSides = ['home', 'away'].filter(
        (teamSide) => currentTeams[teamSide] !== nextTeams[teamSide],
      )

      changedSides.forEach((changedSide) => {
        const changedTeam = findTeam(nextTeams[changedSide])

        nextInputs[changedSide] = {
          ...nextInputs[changedSide],
          ...goalieSelectionToInputFields(
            createUnknownGoalieSelection(changedTeam.id),
          ),
        }
      })

      return {
        teams: nextTeams,
        inputs: nextInputs,
      }
    })
  }

  const handleInputChange = (side, field, value) => {
    setSaveStatus('idle')
    setSaveMessage('')

    setMatchup((currentMatchup) => {
      const nextSideInputs = {
        ...currentMatchup.inputs[side],
      }

      if (field === 'marketOdds') {
        nextSideInputs.marketOdds = value
      } else {
        const nextValue = Number(value)
        const safeValue = Number.isFinite(nextValue) ? nextValue : 0
        const limit = adjustmentLimits[field]

        nextSideInputs[field] = limit ? clamp(safeValue, limit) : safeValue
      }

      return {
        ...currentMatchup,
        inputs: {
          ...currentMatchup.inputs,
          [side]: nextSideInputs,
        },
      }
    })
  }

  const handleMarketOddsChange = (side, value) =>
    {
      setMarketOddsMetadata((currentMetadata) => ({
        ...currentMetadata,
        [side]: markOddsAsManual(currentMetadata[side], value),
      }))
      handleInputChange(side, 'marketOdds', value)
    }

  const latestProviderOdds = prefillMatchup?.marketOdds?.latestProvider ?? {}
  const canUseLatestMarketOdds = ['away', 'home'].some(
    (side) => latestProviderOdds[side]?.source === 'provider',
  )
  const currentMarketSources = [
    marketOddsMetadata.away?.source === 'provider'
      ? marketOddsMetadata.away.bookmakerTitle
      : inputs.away.marketOdds
        ? 'Manual'
        : '',
    marketOddsMetadata.home?.source === 'provider'
      ? marketOddsMetadata.home.bookmakerTitle
      : inputs.home.marketOdds
        ? 'Manual'
        : '',
  ].filter(Boolean)
  const currentMarketSourceLabel = [...new Set(currentMarketSources)].join(' / ')
  const latestBookmakerUpdate = [
    marketOddsMetadata.away?.bookmakerLastUpdate,
    marketOddsMetadata.home?.bookmakerLastUpdate,
  ]
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]

  const handleUseLatestMarketOdds = () => {
    setMatchup((currentMatchup) => {
      const nextInputs = {
        ...currentMatchup.inputs,
      }

      ;['away', 'home'].forEach((side) => {
        if (latestProviderOdds[side]?.source === 'provider') {
          nextInputs[side] = {
            ...nextInputs[side],
            marketOdds: latestProviderOdds[side].offeredOdds,
          }
        }
      })

      return { ...currentMatchup, inputs: nextInputs }
    })
    setMarketOddsMetadata((currentMetadata) => ({
      away: latestProviderOdds.away ?? currentMetadata.away,
      home: latestProviderOdds.home ?? currentMetadata.home,
    }))
    setSaveStatus('idle')
    setSaveMessage('Latest provider odds applied.')
  }

  const handleGoalieSelectionChange = (side, field, value) => {
    setSaveStatus('idle')
    setSaveMessage('')
    setGoalieSaveStatus('idle')
    setGoalieSaveMessage('')

    setMatchup((currentMatchup) => ({
      ...currentMatchup,
      inputs: {
        ...currentMatchup.inputs,
        [side]: updateGoalieInputs(
          currentMatchup.inputs[side],
          field,
          value,
          getGoaliesForSide(side),
        ),
      },
    }))
  }

  const handleGameContextDraftChange = (side, field, value) => {
    const sideKey = side === 'away' ? 'awayContext' : 'homeContext'
    const nextDraft = {
      ...gameContextDraft,
      [sideKey]: {
        ...gameContextDraft[sideKey],
        [field]: value,
      },
    }

    setGameContextDraft(nextDraft)

    if (gameContext) {
      setMatchup((currentMatchup) => ({
        ...currentMatchup,
        inputs: applyGameContextDraftToInputs(
          currentMatchup.inputs,
          gameContext,
          nextDraft,
        ),
      }))
    }

    setGameContextSaveStatus('idle')
    setGameContextMessage('')
    setSaveStatus('idle')
    setSaveMessage('')
  }

  const refreshGameContext = async () => {
    if (!contextRequestGame) {
      return null
    }

    const result = await fetchGameContexts([contextRequestGame])
    const nextContext = result.contexts[0] ?? null

    setGameContext(nextContext)
    setGameContextDraft(createGameContextDraft(nextContext))
    setGameContextStatus(nextContext ? 'success' : 'idle')

    if (nextContext) {
      setMatchup((currentMatchup) => ({
        ...currentMatchup,
        inputs: applyGameContextToInputs(currentMatchup.inputs, nextContext),
      }))
    }

    return nextContext
  }

  const handleRefreshGameContext = async () => {
    setGameContextStatus('loading')
    setGameContextSaveStatus('idle')
    setGameContextMessage('')

    try {
      await refreshGameContext()
    } catch (error) {
      setGameContext(null)
      setGameContextDraft(createGameContextDraft(null))
      setGameContextStatus('error')
      setGameContextMessage(error.message)
    }
  }

  const handleSaveGameContextOverrides = async () => {
    if (!contextRequestGame?.gameId || !hasUnsavedGameContextChanges) {
      return
    }

    setGameContextSaveStatus('saving')
    setGameContextMessage('')

    try {
      await updateGameContextOverrides(
        contextRequestGame.gameId,
        createGameContextOverridePayload(gameContextDraft),
      )
      await refreshGameContext()
      setGameContextSaveStatus('success')
      setGameContextMessage('Overrides saved')
    } catch (error) {
      setGameContextSaveStatus('error')
      setGameContextMessage(error.message)
    }
  }

  const handleSaveGoalieSelections = async () => {
    if (!contextRequestGame?.gameId || !hasUnsavedGoalieChanges) {
      return
    }

    if (hasGoalieValidationErrors) {
      setGoalieSaveStatus('error')
      setGoalieSaveMessage(
        'Complete the required game-specific goalie adjustments.',
      )
      return
    }

    setGoalieSaveStatus('saving')
    setGoalieSaveMessage('')

    try {
      const response = await updateGameGoalieSelections(
        contextRequestGame.gameId,
        goalieSelectionPayload,
      )
      const nextContext = normalizeGameContext(response.context)

      setGameContext(nextContext)
      setGoalieSaveStatus('success')
      setGoalieSaveMessage('Goalie selections saved for this game.')
    } catch (error) {
      setGoalieSaveStatus('error')
      setGoalieSaveMessage(error.message)
    }
  }

  const handleUseRecommendedStake = () => {
    if (
      !selectedStakeRecommendation.eligible ||
      selectedStakeRecommendation.recommendedStakeAmount <= 0
    ) {
      return
    }

    setStake(
      formatStakeInputValue(selectedStakeRecommendation.recommendedStakeAmount),
    )
    setSaveStatus('idle')
    setSaveMessage('Recommended stake copied to Your Stake.')
  }

  const handleOpenBetTracker = () => {
    onNavigate?.('tracker')
  }

  const handleOpenBettingSettings = () => {
    onNavigate?.('settings')

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        document
          .getElementById('betting-staking-settings')
          ?.scrollIntoView({ block: 'start' })
      }, 0)
    }
  }

  const handleSaveBet = async () => {
    if (!canSaveBet) {
      setSaveStatus('error')
      setSaveMessage(saveDisabledReason)
      return
    }

    setSaveStatus('saving')
    setSaveMessage('')

    try {
      const betPayload = createBetPayloadFromGameAnalysis({
        gameId: prefillMatchup?.gameId ?? '',
        homeTeam,
        awayTeam,
        gameContextSnapshot: gameContext,
        inputs,
        result,
        scheduledStart: prefillMatchup?.scheduledStart ?? null,
        selectedSide: selectedSaveSide,
        selectedGoalieStats:
          goalieStatsByPlayerId[
            String(inputs[selectedSaveSide].goalieNhlPlayerId)
          ]?.currentSeason ?? null,
        kellyRecommendation: createKellyRecommendationSnapshot(
          selectedStakeRecommendation,
        ),
        marketOddsMetadata,
        notes: betNotes,
        stake: stakeValue,
      })
      const existingBets = normalizeBets(await fetchBets())
      const duplicateBet = existingBets.find(
        (bet) => getBetSignature(bet) === getBetSignature(betPayload),
      )

      if (duplicateBet) {
        const confirmed =
          typeof window === 'undefined' ||
          window.confirm(
            'A matching saved bet already exists for this game, side and analysis. Save another copy?',
          )

        if (!confirmed) {
          setSaveStatus('idle')
          setSaveMessage('Duplicate save canceled.')
          return
        }
      }

      const savedBet = await createBet(betPayload)

      setSaveStatus('success')
      setSaveMessage(`Saved ${formatSavedTime(savedBet.analyzedAt)}`)
      loadBankrollSummary().catch(() => {
        // The saved bet still succeeds; the recommendation card shows reload errors.
      })
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error.message)
    }
  }

  if (
    powerRatingsStatus !== 'success' ||
    injurySummaryStatus !== 'success' ||
    ratingEngineSettingsStatus !== 'success'
  ) {
    return (
      <section className="game-analyzer" aria-label="Game Analyzer">
        <div className="matchup-panel">
          <ModelDataRequiredState
            injurySummaryError={injurySummaryError}
            injurySummaryStatus={injurySummaryStatus}
            onRetryInjuries={onRetryInjuries}
            onRetryPowerRatings={onRetryPowerRatings}
            onRetryRatingEngineSettings={onRetryRatingEngineSettings}
            powerRatingsError={powerRatingsError}
            powerRatingsStatus={powerRatingsStatus}
            ratingEngineSettingsError={ratingEngineSettingsError}
            ratingEngineSettingsStatus={ratingEngineSettingsStatus}
          />
        </div>
      </section>
    )
  }

  const awayGoalies = getGoaliesForSide('away')
  const homeGoalies = getGoaliesForSide('home')

  return (
    <section className="game-analyzer" aria-label="Game Analyzer">
      <div className="analyzer-body">
        <div className="analysis-controls">
          <div className="matchup-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Matchup</p>
                <h2>
                  {awayTeam.name} at {homeTeam.name}
                </h2>
              </div>
              <span>{NHL_TEAMS.length} teams</span>
            </div>

            <div className="selector-grid">
              <TeamSelector
                id="away-team"
                label="Away Team"
                teams={NHL_TEAMS}
                value={teams.away}
                disabledTeamId={teams.home}
                onChange={(teamId) => handleTeamChange('away', teamId)}
              />
              <TeamSelector
                id="home-team"
                label="Home Team"
                teams={NHL_TEAMS}
                value={teams.home}
                disabledTeamId={teams.away}
                onChange={(teamId) => handleTeamChange('home', teamId)}
              />
            </div>

            <div className="matchup-team-grid">
              <MatchupTeamCard
                label="Away"
                team={awayTeam}
                baseRating={inputs.away.baseRating}
                effectiveRating={result.awayFinalRating}
              />
              <MatchupTeamCard
                label="Home"
                team={homeTeam}
                baseRating={inputs.home.baseRating}
                effectiveRating={result.homeFinalRating}
              />
            </div>
          </div>

          <AdjustmentComparison
            awayTeam={awayTeam}
            finalRatings={{
              away: result.awayFinalRating,
              home: result.homeFinalRating,
            }}
            goalieErrors={{
              away: goalieErrorByTeam[awayTeam.abbreviation] ?? '',
              home: goalieErrorByTeam[homeTeam.abbreviation] ?? '',
            }}
            goalieStatuses={{
              away: goalieStatusByTeam[awayTeam.abbreviation] ?? 'idle',
              home: goalieStatusByTeam[homeTeam.abbreviation] ?? 'idle',
            }}
            goalieStatsByPlayerId={goalieStatsByPlayerId}
            goalieSaveMessage={goalieSaveMessage}
            goalieSaveStatus={goalieSaveStatus}
            goalieValidationErrors={goalieValidationErrors}
            goalies={{
              away: awayGoalies,
              home: homeGoalies,
            }}
            homeTeam={homeTeam}
            inputs={inputs}
            isGameContextManaged={Boolean(gameContext)}
            onChange={handleInputChange}
            onGoalieChange={handleGoalieSelectionChange}
            onSaveGoalies={handleSaveGoalieSelections}
            canPersistGoalies={Boolean(contextRequestGame?.gameId)}
            hasUnsavedGoalieChanges={hasUnsavedGoalieChanges}
            onRetryGoalies={{
              away: () => loadTeamGoalies(awayTeam, { force: true }),
              home: () => loadTeamGoalies(homeTeam, { force: true }),
            }}
          />

          <GameContextPanel
            awayTeam={awayTeam}
            contextRequestGame={contextRequestGame}
            draft={gameContextDraft}
            gameContext={gameContext}
            homeTeam={homeTeam}
            saveMessage={gameContextMessage}
            saveStatus={gameContextSaveStatus}
            status={gameContextStatus}
            hasUnsavedChanges={hasUnsavedGameContextChanges}
            onChange={handleGameContextDraftChange}
            onRefresh={handleRefreshGameContext}
            onSave={handleSaveGameContextOverrides}
          />
        </div>

        {currentMarketSourceLabel ? (
          <section
            className="analyzer-current-market-source"
            aria-labelledby="current-market-source-heading"
          >
            <h3 id="current-market-source-heading">Current Market Source</h3>
            <dl>
              <div>
                <dt>Best available</dt>
                <dd>{currentMarketSourceLabel}</dd>
              </div>
              <div>
                <dt>Away</dt>
                <dd>{formatAnalyzerMarketOdds(inputs.away.marketOdds)}</dd>
              </div>
              <div>
                <dt>Home</dt>
                <dd>{formatAnalyzerMarketOdds(inputs.home.marketOdds)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatAnalyzerUtcTime(latestBookmakerUpdate)}</dd>
              </div>
            </dl>
            <MarketOddsDetails
              bookmakers={prefillMatchup?.marketOdds?.allBookmakers ?? []}
              buttonLabel="View All Bookmakers"
            />
          </section>
        ) : null}

        {canUseLatestMarketOdds ? (
          <div className="analyzer-market-odds-source" role="status">
            <span>
              Dashboard market odds from The Odds API are available. Manual
              edits remain unchanged unless you apply them explicitly.
            </span>
            <button type="button" onClick={handleUseLatestMarketOdds}>
              Use Latest Market Odds
            </button>
          </div>
        ) : null}

        <ResultCard
          awayTeam={awayTeam}
          homeTeam={homeTeam}
          inputs={inputs}
          isBetReviewOpen={isBetReviewOpen}
          result={result}
          reviewDisabled={!hasReviewableSide}
          reviewDisabledReason={reviewDisabledReason}
          selectedSide={selectedSaveSide}
          stake={stake}
          saveDisabled={saveStatus === 'saving' || !canSaveBet}
          saveDisabledReason={saveDisabledReason}
          saveStatus={saveStatus}
          saveMessage={saveMessage}
          validSaveSides={validSaveSides}
          onCloseReview={closeBetReview}
          onOpenBetTracker={handleOpenBetTracker}
          onOpenBettingSettings={handleOpenBettingSettings}
          onMarketOddsChange={handleMarketOddsChange}
          notes={betNotes}
          onOpenReview={openBetReview}
          onSaveBet={handleSaveBet}
          onNotesChange={(value) => {
            setSaveStatus('idle')
            setSaveMessage('')
            setBetNotes(value)
          }}
          onSelectedSideChange={(side) => {
            setSaveStatus('idle')
            setSaveMessage('')
            setSelectedSaveSide(side)
          }}
          onStakeChange={(value) => {
            setSaveStatus('idle')
            setSaveMessage('')
            setStake(value)
          }}
          onUseRecommendedStake={handleUseRecommendedStake}
          bankrollError={bankrollError}
          bankrollStatus={bankrollStatus}
          bettingSettingsError={bettingSettingsError}
          bettingSettingsStatus={bettingSettingsStatus}
          stakeRecommendation={selectedStakeRecommendation}
        />
      </div>
    </section>
  )
}

function MatchupTeamCard({ baseRating, effectiveRating, label, team }) {
  const logo = getTeamLogo(team)

  return (
    <article className="matchup-team-card">
      <div className="matchup-team-logo">
        {logo ? (
          <img src={logo} alt={`${team.name} logo`} loading="lazy" />
        ) : (
          <span>{team.abbreviation}</span>
        )}
      </div>
      <div className="matchup-team-copy">
        <span>{label}</span>
        <strong>{team.name}</strong>
      </div>
      <div className="matchup-team-ratings">
        <div>
          <span>Base</span>
          <strong>{formatRating(baseRating)}</strong>
        </div>
        <div>
          <span>Effective</span>
          <strong
            data-testid={`analyzer-${label.toLowerCase()}-effective-rating`}
          >
            {formatRating(effectiveRating)}
          </strong>
        </div>
      </div>
    </article>
  )
}

function GameContextPanel({
  awayTeam,
  contextRequestGame,
  draft,
  gameContext,
  homeTeam,
  saveMessage,
  saveStatus,
  status,
  hasUnsavedChanges,
  onChange,
  onRefresh,
  onSave,
}) {
  if (!contextRequestGame && status !== 'error') {
    return null
  }

  const isLoading = status === 'loading'
  const isSaving = saveStatus === 'saving'
  const gameStatus = getGameContextStatusLabel(
    gameContext,
    contextRequestGame,
  )
  const actionStatus = isSaving
    ? { label: 'Saving...', tone: 'saving' }
    : saveStatus === 'error'
      ? { detail: saveMessage, label: 'Save failed', tone: 'error' }
      : hasUnsavedChanges
        ? { label: 'Unsaved changes', tone: 'dirty' }
        : saveStatus === 'success'
          ? { label: 'Overrides saved', tone: 'success' }
          : null

  return (
    <section className="game-context-panel" aria-label="Game Context">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Game Context</p>
          <h2>Schedule Adjustments</h2>
        </div>
        <div className="game-context-section-meta">
          <span
            className={`game-context-status-badge ${gameStatus.toLowerCase()}`}
          >
            {gameStatus}
          </span>
          <small>{isLoading ? 'Loading context' : 'User scoped'}</small>
        </div>
      </div>

      {status === 'error' ? (
        <p className="form-status error" role="alert">
          {saveMessage || 'Game context unavailable.'}
        </p>
      ) : null}

      {gameContext ? (
        <div className="game-context-grid">
          <GameContextTeamCard
            context={getGameContextForSide(gameContext, 'away')}
            draft={draft.awayContext}
            label="Away"
            side="away"
            team={awayTeam}
            onChange={onChange}
          />
          <GameContextTeamCard
            context={getGameContextForSide(gameContext, 'home')}
            draft={draft.homeContext}
            label="Home"
            side="home"
            team={homeTeam}
            onChange={onChange}
          />
        </div>
      ) : isLoading ? (
        <div className="game-context-loading" role="status">
          Loading game context...
        </div>
      ) : null}

      {contextRequestGame ? (
        <div className="game-context-actions">
          {actionStatus ? (
            <span
              className={`game-context-action-status ${actionStatus.tone}`}
              role={actionStatus.tone === 'error' ? 'alert' : 'status'}
            >
              <strong>{actionStatus.label}</strong>
              {actionStatus.detail ? <small>{actionStatus.detail}</small> : null}
            </span>
          ) : null}
          <button
            className="game-context-refresh-button"
            type="button"
            disabled={isLoading || isSaving}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" size={15} />
            Refresh Context
          </button>
          <button
            className={hasUnsavedChanges ? 'save-ratings-button' : ''}
            type="button"
            disabled={isLoading || isSaving || !hasUnsavedChanges}
            onClick={onSave}
          >
            <Save aria-hidden="true" size={15} />
            {isSaving ? 'Saving...' : 'Save Overrides'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function GameContextTeamCard({ context, draft, label, side, team, onChange }) {
  const presentation = getTeamGameContextPresentation(context, draft)
  const { preview } = presentation
  const restEnabledId = `game-context-${side}-rest-enabled`
  const restValueId = `game-context-${side}-rest-value`
  const rematchEnabledId = `game-context-${side}-rematch-enabled`
  const rematchValueId = `game-context-${side}-rematch-value`

  return (
    <article className="game-context-team-card">
      <div className="game-context-card-header">
        <div>
          <span>{label}</span>
          <strong>{team.name}</strong>
        </div>
        {presentation.hasActiveOverride ? (
          <span className="game-context-override-badge">
            Manual override active
          </span>
        ) : null}
      </div>

      <dl className="game-context-rest-days">
        <div>
          <dt>Rest days</dt>
          <dd>{formatRestDays(context.restDays)}</dd>
        </div>
      </dl>

      <div className="game-context-card-sections">
        <section
          className="game-context-facts"
          aria-label={`${team.name} detected schedule facts`}
        >
          <h3>Detected schedule facts</h3>
          {presentation.detectedFacts.length > 0 ? (
            <ul>
              {presentation.detectedFacts.map((fact) => (
                <li key={fact.key}>
                  <span>{fact.label}</span>
                  {fact.note ? <small>{fact.note}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>None</p>
          )}
        </section>

        <section
          className="game-context-applied"
          aria-label={`${team.name} applied adjustments`}
        >
          <h3>Applied adjustments</h3>
          {presentation.appliedAdjustments.length > 0 ? (
            <ul>
              {presentation.appliedAdjustments.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <strong>
                    {formatSignedGameContextAdjustment(item.adjustment)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>None</p>
          )}
        </section>
      </div>

      <div className="game-context-total">
        <span>Total schedule adjustment</span>
        <strong data-testid={`game-context-${side}-total`}>
          {formatSignedGameContextAdjustment(
            preview.totalGameContextAdjustment,
          )}
        </strong>
      </div>

      <details className="game-context-overrides">
        <summary>Manual overrides</summary>
        <div className="game-context-override-groups">
          <GameContextOverrideControl
            automaticValue={preview.automaticRestFatigueAdjustment}
            checkboxId={restEnabledId}
            checked={draft.restFatigueOverrideEnabled}
            effectiveValue={preview.effectiveRestFatigueAdjustment}
            inputId={restValueId}
            inputLabel={`${team.name} rest and fatigue override`}
            label="Override Rest/Fatigue"
            value={draft.manualRestFatigueAdjustment}
            onCheckedChange={(checked) =>
              onChange(side, 'restFatigueOverrideEnabled', checked)
            }
            onValueChange={(value) =>
              onChange(side, 'manualRestFatigueAdjustment', value)
            }
          />
          <GameContextOverrideControl
            automaticValue={preview.automaticQuickRematchAdjustment}
            checkboxId={rematchEnabledId}
            checked={draft.quickRematchOverrideEnabled}
            effectiveValue={preview.effectiveQuickRematchAdjustment}
            inputId={rematchValueId}
            inputLabel={`${team.name} quick rematch override`}
            label="Override Quick Rematch"
            value={draft.manualQuickRematchAdjustment}
            onCheckedChange={(checked) =>
              onChange(side, 'quickRematchOverrideEnabled', checked)
            }
            onValueChange={(value) =>
              onChange(side, 'manualQuickRematchAdjustment', value)
            }
          />
        </div>
      </details>
    </article>
  )
}

function GameContextOverrideControl({
  automaticValue,
  checkboxId,
  checked,
  effectiveValue,
  inputId,
  inputLabel,
  label,
  onCheckedChange,
  onValueChange,
  value,
}) {
  return (
    <section aria-labelledby={`${checkboxId}-label`}>
      <label className="toggle-field" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span id={`${checkboxId}-label`}>{label}</span>
      </label>
      <dl>
        <div>
          <dt>Automatic</dt>
          <dd>{formatSignedGameContextAdjustment(automaticValue)}</dd>
        </div>
        <div>
          <dt>
            <label htmlFor={inputId}>Override</label>
          </dt>
          <dd>
            <input
              aria-label={inputLabel}
              disabled={!checked}
              id={inputId}
              max="3"
              min="-3"
              step="0.05"
              type="number"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{formatSignedGameContextAdjustment(effectiveValue)}</dd>
        </div>
      </dl>
    </section>
  )
}

function ModelDataRequiredState({
  injurySummaryError,
  injurySummaryStatus,
  onRetryInjuries,
  onRetryPowerRatings,
  onRetryRatingEngineSettings,
  powerRatingsError,
  powerRatingsStatus,
  ratingEngineSettingsError,
  ratingEngineSettingsStatus,
}) {
  const isPowerRatingsError = powerRatingsStatus === 'error'
  const isPowerRatingsEmpty = powerRatingsStatus === 'empty'
  const isInjuryError = injurySummaryStatus === 'error'
  const isEngineSettingsError = ratingEngineSettingsStatus === 'error'
  let title = 'Loading model data'
  let message =
    'Game Analyzer will be ready once MongoDB ratings, engine settings and injury summaries load.'

  if (isPowerRatingsError) {
    title = 'Power ratings unavailable'
    message = powerRatingsError
  } else if (isPowerRatingsEmpty) {
    title = 'No power ratings found'
    message = 'Seed MongoDB ratings before analyzing games.'
  } else if (isInjuryError) {
    title = 'Injury summary unavailable'
    message = injurySummaryError
  } else if (isEngineSettingsError) {
    title = 'Engine settings unavailable'
    message = ratingEngineSettingsError
  } else if (powerRatingsStatus !== 'success') {
    title = 'Loading power ratings'
  } else if (ratingEngineSettingsStatus !== 'success') {
    title = 'Loading engine settings'
    message = 'Base Home Advantage is loading for this account.'
  } else if (injurySummaryStatus !== 'success') {
    title = 'Loading injury summary'
    message = 'Stored injury impacts will be applied once MongoDB summaries load.'
  }

  return (
    <div
      className={`ratings-blocking-state ${
        isPowerRatingsError || isInjuryError || isEngineSettingsError
          ? 'error'
          : ''
      }`}
    >
      <strong>{title}</strong>
      <p>{message}</p>
      {isPowerRatingsError || isPowerRatingsEmpty ? (
        <button type="button" onClick={onRetryPowerRatings}>
          {isPowerRatingsEmpty ? 'Seed teams' : 'Try again'}
        </button>
      ) : null}
      {isInjuryError ? (
        <button type="button" onClick={onRetryInjuries}>
          Retry injuries
        </button>
      ) : null}
      {isEngineSettingsError ? (
        <button type="button" onClick={onRetryRatingEngineSettings}>
          Retry settings
        </button>
      ) : null}
    </div>
  )
}

export default GameAnalyzer
