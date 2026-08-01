import { useCallback, useEffect, useMemo, useState } from 'react'
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
} from '../services/gameContextApi.js'
import { parseBankrollMoneyInput } from '../utils/bankroll.js'
import {
  fetchTeamGoalieSummaries,
  fetchTeamRoster,
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
  applyGameContextToInputs,
  formatRestFatigueConditionLabel,
  formatSignedGameContextAdjustment,
  getGameContextForSide,
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

const findTeamById = (teamId) => NHL_TEAMS.find((team) => team.id === teamId)

const findTeam = (teamId) => findTeamById(teamId) ?? NHL_TEAMS[0]

const defaultTeams = {
  home: 'TOR',
  away: 'BOS',
}

const adjustmentLimits = {
  goalieAdjustment: { max: 20, min: -20 },
  homeAdvantage: { max: 10, min: -10 },
  injuries: { max: 20, min: -20 },
  manualAdjustment: { max: 2, min: -2 },
  motivation: { max: 2, min: -2 },
  quickRematchAdjustment: { max: 3, min: -3 },
  restFatigue: { max: 3, min: -3 },
}

const clamp = (value, { max, min }) => Math.min(Math.max(value, min), max)

const getTeamLogo = (team = {}) =>
  team.logo || getTeamMetadata(team.abbreviation).logo || ''

const getGoalieName = (goalie = {}) =>
  goalie.fullName || goalie.name || goalie.playerName || ''

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

const formatContextDate = (dateTime) => {
  const date = new Date(dateTime)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

const isWellRestedCondition = (condition) =>
  ['wellRested', 'well_rested'].includes(condition)

const isFourInSixCondition = (condition) =>
  ['fourInSix', 'four_in_six', '4_games_in_6_days'].includes(condition)

const hasAppliedCondition = (condition, appliedConditionIds) => {
  if (appliedConditionIds.has(condition)) {
    return true
  }

  if (isWellRestedCondition(condition)) {
    return [...appliedConditionIds].some(isWellRestedCondition)
  }

  return false
}

const getDetectedScheduleNote = (condition, appliedConditionIds) => {
  if (isFourInSixCondition(condition)) {
    return 'info only'
  }

  if (
    isWellRestedCondition(condition) &&
    !hasAppliedCondition(condition, appliedConditionIds)
  ) {
    return 'adjustment disabled'
  }

  return ''
}

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
  const [rostersByTeam, setRostersByTeam] = useState({})
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

  const result = useMemo(
    () => calculateGame(inputs.home, inputs.away),
    [inputs],
  )

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
    Boolean(selectedMarketOdds) && hasValidModelProbability && isStakeValid
  const saveDisabledReason = !selectedMarketOdds
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
        const [roster, goalieSummaries] = await Promise.all([
          fetchTeamRoster(teamKey),
          fetchTeamGoalieSummaries(teamKey),
        ])
        const summaries = goalieSummaries?.goalies ?? []

        setRostersByTeam((currentRosters) => ({
          ...currentRosters,
          [teamKey]: roster,
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

      return rostersByTeam[team.abbreviation]?.goalies ?? []
    },
    [awayTeam, homeTeam, rostersByTeam],
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
        nextInputs[changedSide] = {
          ...nextInputs[changedSide],
          selectedGoalieId: '',
          selectedGoalieName: '',
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
      } else if (field === 'selectedGoalieId') {
        const selectedGoalie = getGoaliesForSide(side).find(
          (goalie) => String(goalie.id) === String(value),
        )

        nextSideInputs.selectedGoalieId = value
        nextSideInputs.selectedGoalieName = selectedGoalie
          ? getGoalieName(selectedGoalie)
          : ''
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
    handleInputChange(side, 'marketOdds', value)

  const handleGameContextDraftChange = (side, field, value) => {
    const sideKey = side === 'away' ? 'awayContext' : 'homeContext'

    setGameContextDraft((currentDraft) => ({
      ...currentDraft,
      [sideKey]: {
        ...currentDraft[sideKey],
        [field]: value,
      },
    }))
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
    if (!contextRequestGame?.gameId) {
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
      setGameContextMessage('Game context overrides saved.')
    } catch (error) {
      setGameContextSaveStatus('error')
      setGameContextMessage(error.message)
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
            String(inputs[selectedSaveSide].selectedGoalieId)
          ]?.currentSeason ?? null,
        kellyRecommendation: createKellyRecommendationSnapshot(
          selectedStakeRecommendation,
        ),
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
            goalies={{
              away: awayGoalies,
              home: homeGoalies,
            }}
            homeTeam={homeTeam}
            inputs={inputs}
            onChange={handleInputChange}
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
            onChange={handleGameContextDraftChange}
            onRefresh={handleRefreshGameContext}
            onSave={handleSaveGameContextOverrides}
          />
        </div>

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
          <strong>{formatRating(effectiveRating)}</strong>
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
  onChange,
  onRefresh,
  onSave,
}) {
  if (!contextRequestGame && status !== 'error') {
    return null
  }

  const isLoading = status === 'loading'
  const isSaving = saveStatus === 'saving'

  return (
    <section className="game-context-panel" aria-label="Game Context">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Game Context</p>
          <h2>Schedule Adjustments</h2>
        </div>
        <span>{isLoading ? 'Loading' : 'User scoped'}</span>
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
          {saveMessage ? (
            <span className={`save-analysis-status ${saveStatus}`}>
              {saveMessage}
            </span>
          ) : null}
          <button type="button" disabled={isSaving} onClick={onRefresh}>
            Refresh
          </button>
          <button
            className="save-ratings-button"
            type="button"
            disabled={isLoading || isSaving}
            onClick={onSave}
          >
            {isSaving ? 'Saving...' : 'Save Context Overrides'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function GameContextTeamCard({ context, draft, label, side, team, onChange }) {
  const quickRematchNote = context.quickRematch.eligible
    ? `Previous loss ${formatContextDate(
        context.quickRematch.previousGameDate,
      )}`
    : context.quickRematch.reason
  const restFatigueBreakdown = context.adjustmentBreakdown.filter(
    (item) => (item.category ?? 'restFatigue') === 'restFatigue',
  )
  const appliedConditionIds = new Set(
    restFatigueBreakdown.map((item) => item.condition),
  )
  const detectedConditions =
    context.conditions.length > 0
      ? context.conditions
      : [context.restFatigueCondition]

  return (
    <article className="game-context-team-card">
      <div className="game-context-card-header">
        <span>{label}</span>
        <strong>{team.name}</strong>
        <em>
          {formatSignedGameContextAdjustment(
            context.totalGameContextAdjustment,
          )}
        </em>
      </div>

      <dl className="game-context-metrics">
        <div>
          <dt>Rest Days</dt>
          <dd>{formatRestDays(context.restDays)}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd className="game-context-detected">
            {detectedConditions.map((condition) => {
              const note = getDetectedScheduleNote(condition, appliedConditionIds)

              return (
                <span key={condition}>
                  <em>{formatRestFatigueConditionLabel(condition)}</em>
                  {note ? <small>{note}</small> : null}
                </span>
              )
            })}
          </dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd className="game-context-breakdown">
            {restFatigueBreakdown.length > 0 ? (
              restFatigueBreakdown.map((item) => (
                <span key={item.condition}>
                  <em>{formatRestFatigueConditionLabel(item.condition)}</em>
                  <strong>
                    {formatSignedGameContextAdjustment(item.adjustment)}
                  </strong>
                </span>
              ))
            ) : (
              <span>
                <em>No applied modifiers</em>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Rest/Fatigue</dt>
          <dd>
            {formatSignedGameContextAdjustment(
              context.effectiveRestFatigueAdjustment,
            )}
          </dd>
        </div>
        <div>
          <dt>Quick Rematch</dt>
          <dd>
            {formatSignedGameContextAdjustment(
              context.effectiveQuickRematchAdjustment,
            )}
          </dd>
        </div>
      </dl>

      {quickRematchNote ? (
        <small className="game-context-note">{quickRematchNote}</small>
      ) : null}

      <div className="game-context-controls">
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={draft.restFatigueOverrideEnabled}
            onChange={(event) =>
              onChange(
                side,
                'restFatigueOverrideEnabled',
                event.target.checked,
              )
            }
          />
          <span>Override Rest/Fatigue</span>
        </label>
        <input
          aria-label={`${team.name} rest and fatigue override`}
          type="number"
          min="-3"
          max="3"
          step="0.05"
          value={draft.manualRestFatigueAdjustment}
          disabled={!draft.restFatigueOverrideEnabled}
          onChange={(event) =>
            onChange(side, 'manualRestFatigueAdjustment', event.target.value)
          }
        />

        <label className="toggle-field">
          <input
            type="checkbox"
            checked={draft.quickRematchOverrideEnabled}
            onChange={(event) =>
              onChange(
                side,
                'quickRematchOverrideEnabled',
                event.target.checked,
              )
            }
          />
          <span>Override Quick Rematch</span>
        </label>
        <input
          aria-label={`${team.name} quick rematch override`}
          type="number"
          min="-3"
          max="3"
          step="0.05"
          value={draft.manualQuickRematchAdjustment}
          disabled={!draft.quickRematchOverrideEnabled}
          onChange={(event) =>
            onChange(side, 'manualQuickRematchAdjustment', event.target.value)
          }
        />
      </div>
    </article>
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
