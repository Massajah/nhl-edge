import { useCallback, useEffect, useMemo, useState } from 'react'
import AdjustmentComparison from './AdjustmentComparison.jsx'
import ResultCard from './ResultCard.jsx'
import TeamSelector from './TeamSelector.jsx'
import { getTeamMetadata } from '../data/teamMetadata.js'
import { NHL_TEAMS } from '../data/teams.js'
import { createBet, fetchBets } from '../services/betsApi.js'
import {
  fetchTeamGoalieSummaries,
  fetchTeamRoster,
} from '../services/teamsApi.js'
import { calculateGame, parseMarketOdds } from '../utils/calculateGame.js'
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

function GameAnalyzer({
  injurySummaries,
  injurySummaryError,
  injurySummaryStatus,
  onRetryInjuries,
  onRetryPowerRatings,
  powerRatings,
  powerRatingsError,
  powerRatingsStatus,
  prefillMatchup,
}) {
  const [matchup, setMatchup] = useState(() => {
    const initialTeams = normalizeSelectedTeams(prefillMatchup ?? defaultTeams)

    return {
      teams: initialTeams,
      inputs: createInputsForTeams(
        powerRatings,
        initialTeams,
        prefillMatchup?.marketOdds,
        injurySummaries,
      ),
    }
  })
  const [goalieStatsByPlayerId, setGoalieStatsByPlayerId] = useState({})
  const [goalieStatusByTeam, setGoalieStatusByTeam] = useState({})
  const [goalieErrorByTeam, setGoalieErrorByTeam] = useState({})
  const [rostersByTeam, setRostersByTeam] = useState({})
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [selectedSaveSide, setSelectedSaveSide] = useState('home')
  const [isBetReviewOpen, setIsBetReviewOpen] = useState(false)
  const [stake, setStake] = useState('1')
  const { teams, inputs } = matchup

  const homeTeam = findTeam(teams.home)
  const awayTeam = findTeam(teams.away)

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
  const stakeValue = Number(stake)
  const isStakeValid = Number.isFinite(stakeValue) && stakeValue > 0
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
        ? 'Enter a stake greater than 0.'
        : ''

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
        inputs,
        result,
        scheduledStart: prefillMatchup?.scheduledStart ?? null,
        selectedSide: selectedSaveSide,
        selectedGoalieStats:
          goalieStatsByPlayerId[
            String(inputs[selectedSaveSide].selectedGoalieId)
          ]?.currentSeason ?? null,
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
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error.message)
    }
  }

  if (powerRatingsStatus !== 'success' || injurySummaryStatus !== 'success') {
    return (
      <section className="game-analyzer" aria-label="Game Analyzer">
        <div className="matchup-panel">
          <ModelDataRequiredState
            injurySummaryError={injurySummaryError}
            injurySummaryStatus={injurySummaryStatus}
            onRetryInjuries={onRetryInjuries}
            onRetryPowerRatings={onRetryPowerRatings}
            powerRatingsError={powerRatingsError}
            powerRatingsStatus={powerRatingsStatus}
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
          onMarketOddsChange={handleMarketOddsChange}
          onOpenReview={openBetReview}
          onSaveBet={handleSaveBet}
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

function ModelDataRequiredState({
  injurySummaryError,
  injurySummaryStatus,
  onRetryInjuries,
  onRetryPowerRatings,
  powerRatingsError,
  powerRatingsStatus,
}) {
  const isPowerRatingsError = powerRatingsStatus === 'error'
  const isPowerRatingsEmpty = powerRatingsStatus === 'empty'
  const isInjuryError = injurySummaryStatus === 'error'
  let title = 'Loading model data'
  let message =
    'Game Analyzer will be ready once MongoDB ratings and injury summaries load.'

  if (isPowerRatingsError) {
    title = 'Power ratings unavailable'
    message = powerRatingsError
  } else if (isPowerRatingsEmpty) {
    title = 'No power ratings found'
    message = 'Seed MongoDB ratings before analyzing games.'
  } else if (isInjuryError) {
    title = 'Injury summary unavailable'
    message = injurySummaryError
  } else if (powerRatingsStatus !== 'success') {
    title = 'Loading power ratings'
  } else if (injurySummaryStatus !== 'success') {
    title = 'Loading injury summary'
    message = 'Stored injury impacts will be applied once MongoDB summaries load.'
  }

  return (
    <div
      className={`ratings-blocking-state ${
        isPowerRatingsError || isInjuryError ? 'error' : ''
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
    </div>
  )
}

export default GameAnalyzer
