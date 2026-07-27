import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Settings as SettingsIcon,
  Shield,
  Target,
  TrendingUp,
} from "lucide-react";
import AuthPage from "./components/auth/AuthPage.jsx";
import BetTracker from "./components/BetTracker.jsx";
import Dashboard from "./components/Dashboard.jsx";
import GameAnalyzer from "./components/GameAnalyzer.jsx";
import InjuryManager from "./components/InjuryManager.jsx";
import AppLayout from "./components/layout/AppLayout.jsx";
import PowerRatings from "./components/PowerRatings.jsx";
import RatingLab from "./components/RatingLab.jsx";
import SettingsPage from "./components/Settings.jsx";
import Teams from "./components/Teams.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { NHL_TEAMS } from "./data/teams.js";
import { fetchTeamInjurySummary } from "./services/injuriesApi.js";
import {
  fetchPowerRatings,
  seedPowerRatings,
  updatePowerRating,
} from "./services/powerRatingsApi.js";
import { getRatingEngineSettings } from "./services/ratingEngineSettingsApi.js";
import {
  DEFAULT_RATING_ENGINE_SETTINGS,
  normalizeRatingEngineSettings,
} from "./utils/ratingEngineSettings.js";
import {
  arePowerRatingsDefault,
  createDefaultPowerRatings,
  getCustomizedPowerRatingTeamIds,
  hasCustomizedPowerRatings,
  loadLocalPowerRatings,
  normalizePowerRatings,
} from "./utils/powerRatings.js";
import { normalizeInjurySummary } from "./utils/injuries.js";
import "./App.css";

const pages = [
  {
    id: "dashboard",
    Icon: LayoutDashboard,
    label: "Dashboard",
    path: "/",
    title: "Dashboard",
  },
  {
    id: "analyzer",
    Icon: Target,
    label: "Game Analyzer",
    path: "/analyzer",
    title: "Game Analyzer",
  },
  {
    id: "teams",
    Icon: Shield,
    label: "Teams",
    path: "/teams",
    title: "Teams",
  },
  {
    id: "ratings",
    Icon: TrendingUp,
    label: "Power Ratings",
    path: "/power-ratings",
    title: "Power Ratings",
  },
  {
    id: "rating-lab",
    Icon: FlaskConical,
    label: "Rating Lab",
    path: "/rating-lab",
    title: "Rating Lab",
  },
  {
    id: "injuries",
    Icon: Activity,
    label: "Injury Manager",
    path: "/injuries",
    title: "Injury Manager",
  },
  {
    id: "tracker",
    Icon: ClipboardList,
    label: "Bet Tracker",
    path: "/bet-tracker",
    title: "Bet Tracker",
  },
];

const utilityPages = [
  {
    id: "settings",
    Icon: SettingsIcon,
    label: "Settings",
    path: "/settings",
    title: "Settings",
  },
];

const navigationPages = [...pages, ...utilityPages];

const normalizePathname = (pathname = "/") => {
  const normalizedPathname = pathname.replace(/\/+$/, "");

  return normalizedPathname || "/";
};

const pagePathById = new Map(
  navigationPages.map((page) => [page.id, normalizePathname(page.path)]),
);
const pageIdByPath = new Map(
  navigationPages.map((page) => [normalizePathname(page.path), page.id]),
);

const getPageIdFromPathname = (pathname) =>
  pageIdByPath.get(normalizePathname(pathname)) ?? "dashboard";

const getPagePath = (pageId) => pagePathById.get(pageId) ?? "/";

const getInitialActivePage = () => {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  return getPageIdFromPathname(window.location.pathname);
};

function AuthenticatedApp({ authUser, onLogout }) {
  const [activePage, setActivePage] = useState(getInitialActivePage);
  const [analyzerPrefill, setAnalyzerPrefill] = useState(null);
  const [powerRatings, setPowerRatings] = useState(() =>
    createDefaultPowerRatings(),
  );
  const [powerRatingsStatus, setPowerRatingsStatus] = useState("loading");
  const [powerRatingsError, setPowerRatingsError] = useState("");
  const [powerRatingsCount, setPowerRatingsCount] = useState(0);
  const [powerRatingsVersion, setPowerRatingsVersion] = useState(0);
  const [migrationAvailable, setMigrationAvailable] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState("idle");
  const [migrationMessage, setMigrationMessage] = useState("");
  const [injurySummaries, setInjurySummaries] = useState(() =>
    normalizeInjurySummary([]),
  );
  const [injurySummaryStatus, setInjurySummaryStatus] = useState("loading");
  const [injurySummaryError, setInjurySummaryError] = useState("");
  const [injurySummaryVersion, setInjurySummaryVersion] = useState(0);
  const [ratingEngineSettings, setRatingEngineSettings] = useState(() =>
    normalizeRatingEngineSettings(DEFAULT_RATING_ENGINE_SETTINGS),
  );
  const [ratingEngineSettingsStatus, setRatingEngineSettingsStatus] =
    useState("loading");
  const [ratingEngineSettingsError, setRatingEngineSettingsError] =
    useState("");
  const [ratingEngineSettingsVersion, setRatingEngineSettingsVersion] =
    useState(0);

  const allPages = [...pages, ...utilityPages];
  const currentPage =
    allPages.find((page) => page.id === activePage) ?? pages[0];

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handlePopState = () => {
      setActivePage(getPageIdFromPathname(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const applyRatingEngineSettings = useCallback((settings) => {
    const nextSettings = normalizeRatingEngineSettings(settings);

    setRatingEngineSettings(nextSettings);
    setRatingEngineSettingsStatus("success");
    setRatingEngineSettingsError("");
    setRatingEngineSettingsVersion((currentVersion) => currentVersion + 1);

    return nextSettings;
  }, []);

  const loadRatingEngineSettings = useCallback(async () => {
    setRatingEngineSettingsStatus("loading");
    setRatingEngineSettingsError("");

    try {
      const result = await getRatingEngineSettings();

      return applyRatingEngineSettings(result.settings);
    } catch (error) {
      setRatingEngineSettingsStatus("error");
      setRatingEngineSettingsError(error.message);
      throw error;
    }
  }, [applyRatingEngineSettings]);

  const retryRatingEngineSettings = useCallback(() => {
    loadRatingEngineSettings().catch(() => {
      // Error state is already captured for the UI.
    });
  }, [loadRatingEngineSettings]);

  useEffect(() => {
    let isCurrent = true;

    const loadInitialRatingEngineSettings = async () => {
      try {
        const result = await getRatingEngineSettings();

        if (!isCurrent) {
          return;
        }

        applyRatingEngineSettings(result.settings);
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setRatingEngineSettingsStatus("error");
        setRatingEngineSettingsError(error.message);
      }
    };

    loadInitialRatingEngineSettings();

    return () => {
      isCurrent = false;
    };
  }, [applyRatingEngineSettings]);

  const navigateToPage = useCallback((pageId) => {
    setActivePage(pageId);

    if (typeof window === "undefined") {
      return;
    }

    const nextPath = getPagePath(pageId);
    const currentPath = normalizePathname(window.location.pathname);

    if (currentPath !== nextPath) {
      window.history.pushState({ pageId }, "", nextPath);
    }
  }, []);

  const updateMigrationAvailability = useCallback((ratings) => {
    const localRatings = loadLocalPowerRatings();

    setMigrationAvailable(
      hasCustomizedPowerRatings(localRatings) &&
        arePowerRatingsDefault(ratings),
    );
  }, []);

  const applyPowerRatingDocuments = useCallback(
    (ratingDocuments) => {
      const normalizedRatings = normalizePowerRatings(ratingDocuments);

      setPowerRatings(normalizedRatings);
      setPowerRatingsCount(ratingDocuments.length);
      setPowerRatingsVersion((currentVersion) => currentVersion + 1);
      updateMigrationAvailability(normalizedRatings);

      return normalizedRatings;
    },
    [updateMigrationAvailability],
  );

  const loadMongoPowerRatings = useCallback(
    async ({ seedIfMissing = false } = {}) => {
      setPowerRatingsStatus("loading");
      setPowerRatingsError("");

      try {
        let ratingDocuments = await fetchPowerRatings();

        if (seedIfMissing && ratingDocuments.length < NHL_TEAMS.length) {
          const seedResult = await seedPowerRatings();
          ratingDocuments = seedResult.ratings ?? (await fetchPowerRatings());
        }

        applyPowerRatingDocuments(ratingDocuments);
        setPowerRatingsStatus(ratingDocuments.length > 0 ? "success" : "empty");
      } catch (error) {
        setPowerRatingsStatus("error");
        setPowerRatingsError(error.message);
        setMigrationAvailable(false);
      }
    },
    [applyPowerRatingDocuments],
  );

  const retryPowerRatings = useCallback(() => {
    loadMongoPowerRatings({ seedIfMissing: true });
  }, [loadMongoPowerRatings]);

  useEffect(() => {
    let isCurrent = true;

    const loadInitialPowerRatings = async () => {
      try {
        let ratingDocuments = await fetchPowerRatings();

        if (ratingDocuments.length < NHL_TEAMS.length) {
          const seedResult = await seedPowerRatings();
          ratingDocuments = seedResult.ratings ?? (await fetchPowerRatings());
        }

        if (!isCurrent) {
          return;
        }

        applyPowerRatingDocuments(ratingDocuments);
        setPowerRatingsStatus(ratingDocuments.length > 0 ? "success" : "empty");
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setPowerRatingsStatus("error");
        setPowerRatingsError(error.message);
        setMigrationAvailable(false);
      }
    };

    loadInitialPowerRatings();

    return () => {
      isCurrent = false;
    };
  }, [applyPowerRatingDocuments]);

  const loadInjurySummaries = useCallback(async () => {
    setInjurySummaryStatus("loading");
    setInjurySummaryError("");

    try {
      const summary = await fetchTeamInjurySummary();
      const normalizedSummary = normalizeInjurySummary(summary);

      setInjurySummaries(normalizedSummary);
      setInjurySummaryStatus("success");
      setInjurySummaryVersion((currentVersion) => currentVersion + 1);

      return normalizedSummary;
    } catch (error) {
      setInjurySummaryStatus("error");
      setInjurySummaryError(error.message);
      throw error;
    }
  }, []);

  const retryInjurySummaries = useCallback(() => {
    loadInjurySummaries().catch(() => {
      // Error state is already captured for the UI.
    });
  }, [loadInjurySummaries]);

  useEffect(() => {
    let isCurrent = true;

    const loadInitialInjurySummaries = async () => {
      try {
        const summary = await fetchTeamInjurySummary();

        if (!isCurrent) {
          return;
        }

        setInjurySummaries(normalizeInjurySummary(summary));
        setInjurySummaryStatus("success");
        setInjurySummaryVersion((currentVersion) => currentVersion + 1);
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setInjurySummaryStatus("error");
        setInjurySummaryError(error.message);
      }
    };

    loadInitialInjurySummaries();

    return () => {
      isCurrent = false;
    };
  }, []);

  const handleSavePowerRatings = useCallback(
    async (updatesByTeamId) => {
      const updates = Object.entries(updatesByTeamId);

      if (updates.length === 0) {
        return powerRatings;
      }

      const updatedRatings = await Promise.all(
        updates.map(([teamId, values]) => updatePowerRating(teamId, values)),
      );
      const indexedUpdates = updatedRatings.reduce((ratings, rating) => {
        ratings[rating.teamId] = rating;
        return ratings;
      }, {});
      const nextRatings = normalizePowerRatings({
        ...powerRatings,
        ...indexedUpdates,
      });

      setPowerRatings(nextRatings);
      setPowerRatingsStatus("success");
      setPowerRatingsCount((currentCount) =>
        Math.max(currentCount, updatedRatings.length),
      );
      setPowerRatingsVersion((currentVersion) => currentVersion + 1);
      updateMigrationAvailability(nextRatings);

      return nextRatings;
    },
    [powerRatings, updateMigrationAvailability],
  );

  const handleResetPowerRatings = useCallback(async () => {
    await seedPowerRatings();

    const defaultRatings = createDefaultPowerRatings();
    const updates = NHL_TEAMS.reduce((teamUpdates, team) => {
      teamUpdates[team.id] = {
        baseRating: defaultRatings[team.id].baseRating,
        homeAdjustment: defaultRatings[team.id].homeAdjustment,
        lastRatingChange: defaultRatings[team.id].lastRatingChange,
        manualAdjustment: defaultRatings[team.id].manualAdjustment,
      };

      return teamUpdates;
    }, {});

    const updatedRatings = await Promise.all(
      Object.entries(updates).map(([teamId, values]) =>
        updatePowerRating(teamId, values),
      ),
    );
    const nextRatings = normalizePowerRatings(updatedRatings);

    setPowerRatings(nextRatings);
    setPowerRatingsStatus("success");
    setPowerRatingsCount(NHL_TEAMS.length);
    setPowerRatingsVersion((currentVersion) => currentVersion + 1);
    updateMigrationAvailability(nextRatings);

    return nextRatings;
  }, [updateMigrationAvailability]);

  const handleImportLocalRatings = useCallback(async () => {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        "Import customized local ratings into MongoDB? This only runs while MongoDB still contains default ratings.",
      );

    if (!confirmed) {
      return;
    }

    setMigrationStatus("saving");
    setMigrationMessage("");

    try {
      let latestRatings = await fetchPowerRatings();

      if (latestRatings.length < NHL_TEAMS.length) {
        const seedResult = await seedPowerRatings();
        latestRatings = seedResult.ratings ?? (await fetchPowerRatings());
      }

      const normalizedLatestRatings = normalizePowerRatings(latestRatings);

      if (!arePowerRatingsDefault(normalizedLatestRatings)) {
        throw new Error(
          "MongoDB ratings are no longer all defaults. Import stopped so existing database values are not overwritten.",
        );
      }

      const localRatings = loadLocalPowerRatings();
      const customizedTeamIds = getCustomizedPowerRatingTeamIds(localRatings);

      if (customizedTeamIds.length === 0) {
        setMigrationAvailable(false);
        setMigrationStatus("success");
        setMigrationMessage("No customized local ratings were found.");
        return;
      }

      await Promise.all(
        customizedTeamIds.map((teamId) =>
          updatePowerRating(teamId, {
            baseRating: localRatings[teamId].baseRating,
            homeAdjustment: localRatings[teamId].homeAdjustment,
            manualAdjustment: localRatings[teamId].manualAdjustment,
          }),
        ),
      );

      const importedRatings = await fetchPowerRatings();
      const nextRatings = applyPowerRatingDocuments(importedRatings);

      setPowerRatingsStatus("success");
      setMigrationAvailable(false);
      setMigrationStatus("success");
      setMigrationMessage(
        `Imported ${customizedTeamIds.length} customized local ${
          customizedTeamIds.length === 1 ? "rating" : "ratings"
        } into MongoDB.`,
      );
      return nextRatings;
    } catch (error) {
      setMigrationStatus("error");
      setMigrationMessage(error.message);
    }
  }, [applyPowerRatingDocuments]);

  const handleAnalyzeGame = (game, marketOdds = {}) => {
    setAnalyzerPrefill({
      away: game.awayTeam.abbreviation,
      gameId: String(game.gameId ?? ""),
      home: game.homeTeam.abbreviation,
      id: `${game.gameId}-${Date.now()}`,
      marketOdds,
      scheduledStart: game.startTimeUTC ?? null,
    });
    navigateToPage("analyzer");
  };

  return (
    <AppLayout
      activePage={activePage}
      currentPage={currentPage}
      authUser={authUser}
      onNavigate={navigateToPage}
      onLogout={onLogout}
      primaryItems={pages}
      utilityItems={utilityPages}
    >
      {activePage === "dashboard" ? (
        <Dashboard
          baseHomeAdvantage={ratingEngineSettings.homeAdvantage}
          injurySummaries={injurySummaries}
          injurySummaryError={injurySummaryError}
          injurySummaryStatus={injurySummaryStatus}
          onAnalyzeGame={handleAnalyzeGame}
          onRetryInjuries={retryInjurySummaries}
          onRetryPowerRatings={retryPowerRatings}
          onRetryRatingEngineSettings={retryRatingEngineSettings}
          powerRatings={powerRatings}
          powerRatingsError={powerRatingsError}
          powerRatingsStatus={powerRatingsStatus}
          ratingEngineSettingsError={ratingEngineSettingsError}
          ratingEngineSettingsStatus={ratingEngineSettingsStatus}
        />
      ) : activePage === "analyzer" ? (
        <GameAnalyzer
          key={`${analyzerPrefill?.id ?? "manual-analyzer"}-${powerRatingsStatus}-${powerRatingsVersion}-${injurySummaryStatus}-${injurySummaryVersion}-${ratingEngineSettingsStatus}-${ratingEngineSettingsVersion}`}
          baseHomeAdvantage={ratingEngineSettings.homeAdvantage}
          injurySummaries={injurySummaries}
          injurySummaryError={injurySummaryError}
          injurySummaryStatus={injurySummaryStatus}
          onRetryInjuries={retryInjurySummaries}
          onRetryPowerRatings={retryPowerRatings}
          onRetryRatingEngineSettings={retryRatingEngineSettings}
          powerRatings={powerRatings}
          powerRatingsError={powerRatingsError}
          powerRatingsStatus={powerRatingsStatus}
          prefillMatchup={analyzerPrefill}
          ratingEngineSettingsError={ratingEngineSettingsError}
          ratingEngineSettingsStatus={ratingEngineSettingsStatus}
        />
      ) : activePage === "teams" ? (
        <Teams
          injurySummaries={injurySummaries}
          injurySummaryStatus={injurySummaryStatus}
          powerRatings={powerRatings}
          powerRatingsStatus={powerRatingsStatus}
        />
      ) : activePage === "ratings" ? (
        <PowerRatings
          key={`ratings-${powerRatingsStatus}-${powerRatingsVersion}`}
          baseHomeAdvantage={ratingEngineSettings.homeAdvantage}
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
      ) : activePage === "rating-lab" ? (
        <RatingLab />
      ) : activePage === "injuries" ? (
        <InjuryManager
          injurySummaries={injurySummaries}
          summaryError={injurySummaryError}
          summaryStatus={injurySummaryStatus}
          onInjuriesChanged={loadInjurySummaries}
        />
      ) : activePage === "settings" ? (
        <SettingsPage onRatingEngineSettingsChanged={applyRatingEngineSettings} />
      ) : (
        <BetTracker />
      )}
    </AppLayout>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="auth-loading-screen" aria-label="Loading NHL Edge">
      <span className="sidebar-brand-mark">NE</span>
      <div>
        <p className="eyebrow">NHL Edge</p>
        <strong>Restoring your session</strong>
      </div>
    </main>
  );
}

function App() {
  const { isAuthenticated, loading, logout, user } = useAuth();
  const [authMode, setAuthMode] = useState("login");

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <AuthPage
        key={authMode}
        mode={authMode}
        onModeChange={setAuthMode}
        onSuccess={() => setAuthMode("login")}
      />
    );
  }

  return <AuthenticatedApp authUser={user} onLogout={logout} />;
}

export default App;
