import { useMemo, useState } from 'react'
import AdjustmentPanel from './AdjustmentPanel.jsx'
import ResultCard from './ResultCard.jsx'
import TeamSelector from './TeamSelector.jsx'
import { NHL_TEAMS } from '../data/teams.js'
import { createBet, fetchBets } from '../services/betsApi.js'
import { calculateGame } from '../utils/calculateGame.js'
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
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const { teams, inputs } = matchup

  const homeTeam = findTeam(teams.home)
  const awayTeam = findTeam(teams.away)

  const result = useMemo(
    () => calculateGame(inputs.home, inputs.away),
    [inputs],
  )

  const favorite =
    result.homeWinProbability >= result.awayWinProbability ? homeTeam : awayTeam
  const projectedWinnerSide = favorite.id === homeTeam.id ? 'home' : 'away'
  const projectedWinnerProbability =
    projectedWinnerSide === 'home'
      ? result.homeWinProbability
      : result.awayWinProbability
  const projectedWinnerFairOdds =
    projectedWinnerSide === 'home' ? result.homeFairOdds : result.awayFairOdds

  const handleTeamChange = (side, teamId) => {
    setSaveStatus('idle')
    setSaveMessage('')

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

      return {
        teams: nextTeams,
        inputs: applyTeamRatingsToInputs(
          powerRatings,
          nextTeams,
          currentMatchup.inputs,
          injurySummaries,
        ),
      }
    })
  }

  const handleInputChange = (side, field, value) => {
    setSaveStatus('idle')
    setSaveMessage('')

    const nextValue = Number(value)
    const safeValue = Number.isFinite(nextValue) ? nextValue : 0

    setMatchup((currentMatchup) => ({
      ...currentMatchup,
      inputs: {
        ...currentMatchup.inputs,
        [side]: {
          ...currentMatchup.inputs[side],
          [field]:
            field === 'marketOdds' ? Math.max(safeValue, 1.01) : safeValue,
        },
      },
    }))
  }

  const handleSaveAnalysis = async () => {
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

  return (
    <section className="game-analyzer" aria-label="Game Analyzer">
      <div className="matchup-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Matchup</p>
            <h2>{homeTeam.name} vs {awayTeam.name}</h2>
          </div>
          <span>{NHL_TEAMS.length} teams</span>
        </div>

        <div className="selector-grid">
          <TeamSelector
            id="home-team"
            label="Home Team"
            teams={NHL_TEAMS}
            value={teams.home}
            disabledTeamId={teams.away}
            onChange={(teamId) => handleTeamChange('home', teamId)}
          />
          <TeamSelector
            id="away-team"
            label="Away Team"
            teams={NHL_TEAMS}
            value={teams.away}
            disabledTeamId={teams.home}
            onChange={(teamId) => handleTeamChange('away', teamId)}
          />
        </div>
      </div>

      <div className="analyzer-body">
        <div className="input-grid">
          <AdjustmentPanel
            title="Home Rating"
            teamName={homeTeam.name}
            side="home"
            values={inputs.home}
            showHomeAdvantage
            onChange={(field, value) => handleInputChange('home', field, value)}
          />
          <AdjustmentPanel
            title="Away Rating"
            teamName={awayTeam.name}
            side="away"
            values={inputs.away}
            onChange={(field, value) => handleInputChange('away', field, value)}
          />
        </div>
        <ResultCard
          projectedWinner={favorite.name}
          projectedWinnerSide={projectedWinnerSide}
          probability={projectedWinnerProbability}
          fairOdds={projectedWinnerFairOdds}
          ratingDifference={result.ratingDifference}
          homeTeam={homeTeam.name}
          awayTeam={awayTeam.name}
          homeFinalRating={result.homeFinalRating}
          awayFinalRating={result.awayFinalRating}
          homeMarket={{
            modelProbability: result.homeWinProbability,
            impliedProbability: result.homeImpliedProbability,
            edge: result.homeEdge,
            recommendation: result.homeRecommendation,
          }}
          awayMarket={{
            modelProbability: result.awayWinProbability,
            impliedProbability: result.awayImpliedProbability,
            edge: result.awayEdge,
            recommendation: result.awayRecommendation,
          }}
          onSaveAnalysis={handleSaveAnalysis}
          saveDisabled={saveStatus === 'saving'}
          saveStatus={saveStatus}
          saveMessage={saveMessage}
        />
      </div>
    </section>
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
