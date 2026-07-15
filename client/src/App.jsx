import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  ClipboardList,
  LayoutDashboard,
  Target,
  TrendingUp,
} from 'lucide-react'
import BetTracker from './components/BetTracker.jsx'
import Dashboard from './components/Dashboard.jsx'
import GameAnalyzer from './components/GameAnalyzer.jsx'
import InjuryManager from './components/InjuryManager.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import PowerRatings from './components/PowerRatings.jsx'
import { NHL_TEAMS } from './data/teams.js'
import { fetchTeamInjurySummary } from './services/injuriesApi.js'
import {
  fetchPowerRatings,
  seedPowerRatings,
  updatePowerRating,
} from './services/powerRatingsApi.js'
import {
  arePowerRatingsDefault,
  createDefaultPowerRatings,
  getCustomizedPowerRatingTeamIds,
  hasCustomizedPowerRatings,
  loadLocalPowerRatings,
  normalizePowerRatings,
} from './utils/powerRatings.js'
import { normalizeInjurySummary } from './utils/injuries.js'
import './App.css'

const pages = [
  {
    id: 'dashboard',
    Icon: LayoutDashboard,
    label: 'Dashboard',
    title: 'Dashboard',
  },
  {
    id: 'analyzer',
    Icon: Target,
    label: 'Game Analyzer',
    title: 'Game Analyzer',
  },
  {
    id: 'ratings',
    Icon: TrendingUp,
    label: 'Power Ratings',
    title: 'Power Ratings',
  },
  {
    id: 'injuries',
    Icon: Activity,
    label: 'Injury Manager',
    title: 'Injury Manager',
  },
  {
    id: 'tracker',
    Icon: ClipboardList,
    label: 'Bet Tracker',
    title: 'Bet Tracker',
  },
]

const utilityPages = []

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [analyzerPrefill, setAnalyzerPrefill] = useState(null)
  const [powerRatings, setPowerRatings] = useState(() =>
    createDefaultPowerRatings(),
  )
  const [powerRatingsStatus, setPowerRatingsStatus] = useState('loading')
  const [powerRatingsError, setPowerRatingsError] = useState('')
  const [powerRatingsCount, setPowerRatingsCount] = useState(0)
  const [powerRatingsVersion, setPowerRatingsVersion] = useState(0)
  const [migrationAvailable, setMigrationAvailable] = useState(false)
  const [migrationStatus, setMigrationStatus] = useState('idle')
  const [migrationMessage, setMigrationMessage] = useState('')
  const [injurySummaries, setInjurySummaries] = useState(() =>
    normalizeInjurySummary([]),
  )
  const [injurySummaryStatus, setInjurySummaryStatus] = useState('loading')
  const [injurySummaryError, setInjurySummaryError] = useState('')
  const [injurySummaryVersion, setInjurySummaryVersion] = useState(0)

  const currentPage = pages.find((page) => page.id === activePage) ?? pages[0]

  const updateMigrationAvailability = useCallback((ratings) => {
    const localRatings = loadLocalPowerRatings()

    setMigrationAvailable(
      hasCustomizedPowerRatings(localRatings) &&
        arePowerRatingsDefault(ratings),
    )
  }, [])

  const applyPowerRatingDocuments = useCallback(
    (ratingDocuments) => {
      const normalizedRatings = normalizePowerRatings(ratingDocuments)

      setPowerRatings(normalizedRatings)
      setPowerRatingsCount(ratingDocuments.length)
      setPowerRatingsVersion((currentVersion) => currentVersion + 1)
      updateMigrationAvailability(normalizedRatings)

      return normalizedRatings
    },
    [updateMigrationAvailability],
  )

  const loadMongoPowerRatings = useCallback(
    async ({ seedIfMissing = false } = {}) => {
      setPowerRatingsStatus('loading')
      setPowerRatingsError('')

      try {
        let ratingDocuments = await fetchPowerRatings()

        if (seedIfMissing && ratingDocuments.length < NHL_TEAMS.length) {
          const seedResult = await seedPowerRatings()
          ratingDocuments = seedResult.ratings ?? (await fetchPowerRatings())
        }

        applyPowerRatingDocuments(ratingDocuments)
        setPowerRatingsStatus(
          ratingDocuments.length > 0 ? 'success' : 'empty',
        )
      } catch (error) {
        setPowerRatingsStatus('error')
        setPowerRatingsError(error.message)
        setMigrationAvailable(false)
      }
    },
    [applyPowerRatingDocuments],
  )

  const retryPowerRatings = useCallback(() => {
    loadMongoPowerRatings({ seedIfMissing: true })
  }, [loadMongoPowerRatings])

  useEffect(() => {
    let isCurrent = true

    const loadInitialPowerRatings = async () => {
      try {
        let ratingDocuments = await fetchPowerRatings()

        if (ratingDocuments.length < NHL_TEAMS.length) {
          const seedResult = await seedPowerRatings()
          ratingDocuments = seedResult.ratings ?? (await fetchPowerRatings())
        }

        if (!isCurrent) {
          return
        }

        applyPowerRatingDocuments(ratingDocuments)
        setPowerRatingsStatus(
          ratingDocuments.length > 0 ? 'success' : 'empty',
        )
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setPowerRatingsStatus('error')
        setPowerRatingsError(error.message)
        setMigrationAvailable(false)
      }
    }

    loadInitialPowerRatings()

    return () => {
      isCurrent = false
    }
  }, [applyPowerRatingDocuments])

  const loadInjurySummaries = useCallback(async () => {
    setInjurySummaryStatus('loading')
    setInjurySummaryError('')

    try {
      const summary = await fetchTeamInjurySummary()
      const normalizedSummary = normalizeInjurySummary(summary)

      setInjurySummaries(normalizedSummary)
      setInjurySummaryStatus('success')
      setInjurySummaryVersion((currentVersion) => currentVersion + 1)

      return normalizedSummary
    } catch (error) {
      setInjurySummaryStatus('error')
      setInjurySummaryError(error.message)
      throw error
    }
  }, [])

  const retryInjurySummaries = useCallback(() => {
    loadInjurySummaries().catch(() => {
      // Error state is already captured for the UI.
    })
  }, [loadInjurySummaries])

  useEffect(() => {
    let isCurrent = true

    const loadInitialInjurySummaries = async () => {
      try {
        const summary = await fetchTeamInjurySummary()

        if (!isCurrent) {
          return
        }

        setInjurySummaries(normalizeInjurySummary(summary))
        setInjurySummaryStatus('success')
        setInjurySummaryVersion((currentVersion) => currentVersion + 1)
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setInjurySummaryStatus('error')
        setInjurySummaryError(error.message)
      }
    }

    loadInitialInjurySummaries()

    return () => {
      isCurrent = false
    }
  }, [])

  const handleSavePowerRatings = useCallback(
    async (updatesByTeamId) => {
      const updates = Object.entries(updatesByTeamId)

      if (updates.length === 0) {
        return powerRatings
      }

      const updatedRatings = await Promise.all(
        updates.map(([teamId, values]) => updatePowerRating(teamId, values)),
      )
      const indexedUpdates = updatedRatings.reduce((ratings, rating) => {
        ratings[rating.teamId] = rating
        return ratings
      }, {})
      const nextRatings = normalizePowerRatings({
        ...powerRatings,
        ...indexedUpdates,
      })

      setPowerRatings(nextRatings)
      setPowerRatingsStatus('success')
      setPowerRatingsCount((currentCount) =>
        Math.max(currentCount, updatedRatings.length),
      )
      setPowerRatingsVersion((currentVersion) => currentVersion + 1)
      updateMigrationAvailability(nextRatings)

      return nextRatings
    },
    [powerRatings, updateMigrationAvailability],
  )

  const handleResetPowerRatings = useCallback(async () => {
    await seedPowerRatings()

    const defaultRatings = createDefaultPowerRatings()
    const updates = NHL_TEAMS.reduce((teamUpdates, team) => {
      teamUpdates[team.id] = {
        baseRating: defaultRatings[team.id].baseRating,
        homeAdvantage: defaultRatings[team.id].homeAdvantage,
        lastRatingChange: defaultRatings[team.id].lastRatingChange,
        manualAdjustment: defaultRatings[team.id].manualAdjustment,
      }

      return teamUpdates
    }, {})

    const updatedRatings = await Promise.all(
      Object.entries(updates).map(([teamId, values]) =>
        updatePowerRating(teamId, values),
      ),
    )
    const nextRatings = normalizePowerRatings(updatedRatings)

    setPowerRatings(nextRatings)
    setPowerRatingsStatus('success')
    setPowerRatingsCount(NHL_TEAMS.length)
    setPowerRatingsVersion((currentVersion) => currentVersion + 1)
    updateMigrationAvailability(nextRatings)

    return nextRatings
  }, [updateMigrationAvailability])

  const handleImportLocalRatings = useCallback(async () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Import customized local ratings into MongoDB? This only runs while MongoDB still contains default ratings.',
      )

    if (!confirmed) {
      return
    }

    setMigrationStatus('saving')
    setMigrationMessage('')

    try {
      let latestRatings = await fetchPowerRatings()

      if (latestRatings.length < NHL_TEAMS.length) {
        const seedResult = await seedPowerRatings()
        latestRatings = seedResult.ratings ?? (await fetchPowerRatings())
      }

      const normalizedLatestRatings = normalizePowerRatings(latestRatings)

      if (!arePowerRatingsDefault(normalizedLatestRatings)) {
        throw new Error(
          'MongoDB ratings are no longer all defaults. Import stopped so existing database values are not overwritten.',
        )
      }

      const localRatings = loadLocalPowerRatings()
      const customizedTeamIds = getCustomizedPowerRatingTeamIds(localRatings)

      if (customizedTeamIds.length === 0) {
        setMigrationAvailable(false)
        setMigrationStatus('success')
        setMigrationMessage('No customized local ratings were found.')
        return
      }

      await Promise.all(
        customizedTeamIds.map((teamId) =>
          updatePowerRating(teamId, {
            baseRating: localRatings[teamId].baseRating,
            homeAdvantage: localRatings[teamId].homeAdvantage,
            manualAdjustment: localRatings[teamId].manualAdjustment,
          }),
        ),
      )

      const importedRatings = await fetchPowerRatings()
      const nextRatings = applyPowerRatingDocuments(importedRatings)

      setPowerRatingsStatus('success')
      setMigrationAvailable(false)
      setMigrationStatus('success')
      setMigrationMessage(
        `Imported ${customizedTeamIds.length} customized local ${
          customizedTeamIds.length === 1 ? 'rating' : 'ratings'
        } into MongoDB.`,
      )
      return nextRatings
    } catch (error) {
      setMigrationStatus('error')
      setMigrationMessage(error.message)
    }
  }, [applyPowerRatingDocuments])

  const handleAnalyzeGame = (game, marketOdds = {}) => {
    setAnalyzerPrefill({
      away: game.awayTeam.abbreviation,
      gameId: String(game.gameId ?? ''),
      home: game.homeTeam.abbreviation,
      id: `${game.gameId}-${Date.now()}`,
      marketOdds,
      scheduledStart: game.startTimeUTC ?? null,
    })
    setActivePage('analyzer')
  }

  return (
    <AppLayout
      activePage={activePage}
      currentPage={currentPage}
      onNavigate={setActivePage}
      primaryItems={pages}
      utilityItems={utilityPages}
    >
      {activePage === 'dashboard' ? (
        <Dashboard
          injurySummaries={injurySummaries}
          injurySummaryError={injurySummaryError}
          injurySummaryStatus={injurySummaryStatus}
          onAnalyzeGame={handleAnalyzeGame}
          onRetryInjuries={retryInjurySummaries}
          onRetryPowerRatings={retryPowerRatings}
          powerRatings={powerRatings}
          powerRatingsError={powerRatingsError}
          powerRatingsStatus={powerRatingsStatus}
        />
      ) : activePage === 'analyzer' ? (
        <GameAnalyzer
          key={`${analyzerPrefill?.id ?? 'manual-analyzer'}-${powerRatingsStatus}-${powerRatingsVersion}-${injurySummaryStatus}-${injurySummaryVersion}`}
          injurySummaries={injurySummaries}
          injurySummaryError={injurySummaryError}
          injurySummaryStatus={injurySummaryStatus}
          onRetryInjuries={retryInjurySummaries}
          onRetryPowerRatings={retryPowerRatings}
          powerRatings={powerRatings}
          powerRatingsError={powerRatingsError}
          powerRatingsStatus={powerRatingsStatus}
          prefillMatchup={analyzerPrefill}
        />
      ) : activePage === 'ratings' ? (
        <PowerRatings
          key={`ratings-${powerRatingsStatus}-${powerRatingsVersion}`}
          errorMessage={powerRatingsError}
          migrationAvailable={migrationAvailable}
          migrationMessage={migrationMessage}
          migrationStatus={migrationStatus}
          onImportLocalRatings={handleImportLocalRatings}
          ratings={powerRatings}
          ratingsCount={powerRatingsCount}
          status={powerRatingsStatus}
          onRetry={retryPowerRatings}
          onReset={handleResetPowerRatings}
          onSave={handleSavePowerRatings}
        />
      ) : activePage === 'injuries' ? (
        <InjuryManager
          injurySummaries={injurySummaries}
          summaryError={injurySummaryError}
          summaryStatus={injurySummaryStatus}
          onInjuriesChanged={loadInjurySummaries}
        />
      ) : (
        <BetTracker />
      )}
    </AppLayout>
  )
}

export default App
