import { NHL_TEAMS } from "../data/teams.js";

export const RATING_LAB_CONFIGURATION_FIELDS = Object.freeze([
  {
    key: "kFactor",
    label: "K Factor",
    max: 10,
    min: 0,
    step: 0.01,
  },
  {
    key: "regulationMultiplier",
    label: "Regulation multiplier",
    max: 2,
    min: 0,
    step: 0.1,
  },
  {
    key: "overtimeMultiplier",
    label: "Overtime multiplier",
    max: 2,
    min: 0,
    step: 0.1,
  },
  {
    key: "shootoutMultiplier",
    label: "Shootout multiplier",
    max: 2,
    min: 0,
    step: 0.1,
  },
]);

export const MAX_REPLAY_DATE_RANGE_DAYS = 370;

export const RATING_LAB_DEFAULT_FORM = Object.freeze({
  configuration: Object.freeze({
    kFactor: "1.2",
    overtimeMultiplier: "0.7",
    regulationMultiplier: "1",
    shootoutMultiplier: "0.5",
  }),
  dateFrom: "",
  dateTo: "",
  gameTypes: Object.freeze({
    playoffs: false,
    preseason: false,
    regularSeason: true,
  }),
  startingMode: "equal",
});

const teamsByIdentifier = new Map(
  NHL_TEAMS.flatMap((team) => [
    [team.id, team],
    [team.abbreviation, team],
  ]),
);

export const createRatingLabDefaultForm = () => ({
  configuration: { ...RATING_LAB_DEFAULT_FORM.configuration },
  dateFrom: RATING_LAB_DEFAULT_FORM.dateFrom,
  dateTo: RATING_LAB_DEFAULT_FORM.dateTo,
  gameTypes: { ...RATING_LAB_DEFAULT_FORM.gameTypes },
  startingMode: RATING_LAB_DEFAULT_FORM.startingMode,
});

export const createSimulationPreviewPayload = (form) => ({
  configuration: {
    kFactor: Number(form.configuration.kFactor),
    overtimeMultiplier: Number(form.configuration.overtimeMultiplier),
    regulationMultiplier: Number(form.configuration.regulationMultiplier),
    shootoutMultiplier: Number(form.configuration.shootoutMultiplier),
  },
  dateFrom: form.dateFrom,
  dateTo: form.dateTo,
  gameTypes: {
    playoffs: Boolean(form.gameTypes.playoffs),
    preseason: Boolean(form.gameTypes.preseason),
    regularSeason: Boolean(form.gameTypes.regularSeason),
  },
  includeGameResults: false,
  includeSkippedGames: false,
  startingMode: form.startingMode,
});

const getConfigurationField = (fieldKey) =>
  RATING_LAB_CONFIGURATION_FIELDS.find((field) => field.key === fieldKey);

const getReplayDateRangeDays = ({ dateFrom, dateTo }) => {
  const [fromYear, fromMonth, fromDay] = dateFrom.split("-").map(Number);
  const [toYear, toMonth, toDay] = dateTo.split("-").map(Number);
  const fromTimestamp = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toTimestamp = Date.UTC(toYear, toMonth - 1, toDay);

  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
    return null;
  }

  return Math.floor((toTimestamp - fromTimestamp) / 86400000) + 1;
};

export const validateRatingLabForm = (form) => {
  if (!form.dateFrom || !form.dateTo) {
    return "Choose a start date and end date before running the replay.";
  }

  if (form.dateFrom > form.dateTo) {
    return "Date From must be on or before Date To.";
  }

  const replayDateRangeDays = getReplayDateRangeDays(form);

  if (
    replayDateRangeDays !== null &&
    replayDateRangeDays > MAX_REPLAY_DATE_RANGE_DAYS
  ) {
    return `Replay date range cannot exceed ${MAX_REPLAY_DATE_RANGE_DAYS} days.`;
  }

  if (!Object.values(form.gameTypes).some(Boolean)) {
    return "Enable at least one game type.";
  }

  if (!["equal", "current"].includes(form.startingMode)) {
    return "Choose a supported starting rating mode.";
  }

  for (const [fieldKey, rawValue] of Object.entries(form.configuration)) {
    const field = getConfigurationField(fieldKey);
    const value = Number(rawValue);

    if (!field || !Number.isFinite(value)) {
      return "Replay configuration values must be finite numbers.";
    }

    if (field.key === "kFactor" && value <= 0) {
      return "K Factor must be greater than 0 and no more than 10.";
    }

    if (value < field.min || value > field.max) {
      return `${field.label} must be between ${field.min} and ${field.max}.`;
    }
  }

  return "";
};

const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const resolveTeam = (teamResult = {}) =>
  teamsByIdentifier.get(teamResult.teamId) ??
  teamsByIdentifier.get(teamResult.abbreviation) ??
  null;

const compareTeams = (teamA, teamB) => {
  const nameComparison = teamA.teamName.localeCompare(teamB.teamName);

  if (nameComparison !== 0) {
    return nameComparison;
  }

  return teamA.teamId.localeCompare(teamB.teamId);
};

const compareFinalRank = (teamA, teamB) => {
  const ratingDifference = teamB.finalRating - teamA.finalRating;

  if (ratingDifference !== 0) {
    return ratingDifference;
  }

  return compareTeams(teamA, teamB);
};

export const normalizeTeamResults = (teamResults = []) =>
  (Array.isArray(teamResults) ? teamResults : []).map((teamResult) => {
    const team = resolveTeam(teamResult);
    const abbreviation =
      teamResult.abbreviation ?? team?.abbreviation ?? teamResult.teamId ?? "";
    const teamId = teamResult.teamId ?? team?.id ?? abbreviation;
    const teamName =
      (teamResult.teamName ?? team?.name ?? abbreviation) || "Unknown team";
    const startingRating = toFiniteNumber(teamResult.startingRating);
    const finalRating = toFiniteNumber(teamResult.finalRating);
    const netChange = Number.isFinite(Number(teamResult.netChange))
      ? Number(teamResult.netChange)
      : finalRating - startingRating;

    return {
      abbreviation,
      finalRating,
      gamesProcessed: toFiniteNumber(teamResult.gamesProcessed),
      netChange,
      startingRating,
      teamId,
      teamName,
    };
  });

export const rankTeamResults = (teamResults = []) =>
  normalizeTeamResults(teamResults)
    .sort(compareFinalRank)
    .map((team, index) => ({
      ...team,
      rank: index + 1,
    }));

const sortValue = (team, sortKey) => {
  if (sortKey === "team") {
    return team.teamName;
  }

  if (sortKey === "startingRating") {
    return team.startingRating;
  }

  if (sortKey === "netChange") {
    return team.netChange;
  }

  return team.finalRating;
};

export const sortRankedTeams = (
  rankedTeams = [],
  { direction = "desc", key = "finalRating" } = {},
) =>
  [...rankedTeams].sort((teamA, teamB) => {
    const valueA = sortValue(teamA, key);
    const valueB = sortValue(teamB, key);
    const directionMultiplier = direction === "asc" ? 1 : -1;

    if (typeof valueA === "string" || typeof valueB === "string") {
      const comparison = String(valueA).localeCompare(String(valueB));

      if (comparison !== 0) {
        return comparison * directionMultiplier;
      }

      return compareFinalRank(teamA, teamB);
    }

    const difference = valueA - valueB;

    if (difference !== 0) {
      return difference * directionMultiplier;
    }

    return compareFinalRank(teamA, teamB);
  });

export const getTopTeams = (rankedTeams = [], count = 10) =>
  rankedTeams.slice(0, count);

export const getBottomTeams = (rankedTeams = [], count = 10) =>
  rankedTeams.slice(-count).reverse();

export const getBiggestRisers = (rankedTeams = [], count = 5) =>
  [...rankedTeams]
    .sort((teamA, teamB) => {
      const changeDifference = teamB.netChange - teamA.netChange;

      if (changeDifference !== 0) {
        return changeDifference;
      }

      return compareFinalRank(teamA, teamB);
    })
    .slice(0, count);

export const getBiggestFallers = (rankedTeams = [], count = 5) =>
  [...rankedTeams]
    .sort((teamA, teamB) => {
      const changeDifference = teamA.netChange - teamB.netChange;

      if (changeDifference !== 0) {
        return changeDifference;
      }

      return compareFinalRank(teamA, teamB);
    })
    .slice(0, count);

export const deriveRatingLabResults = (
  simulation,
  sortState = { direction: "desc", key: "finalRating" },
) => {
  const rankedTeams = rankTeamResults(simulation?.teamResults ?? []);

  return {
    bottomTeams: getBottomTeams(rankedTeams),
    fallers: getBiggestFallers(rankedTeams),
    rankedTeams,
    risers: getBiggestRisers(rankedTeams),
    tableTeams: sortRankedTeams(rankedTeams, sortState),
    topTeams: getTopTeams(rankedTeams),
  };
};

export const formatRatingLabNumber = (value) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "--";
};

export const formatRatingLabInteger = (value) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? Math.round(numberValue).toLocaleString()
    : "--";
};

export const formatRatingLabChange = (value) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "--";
  }

  if (numberValue > 0) {
    return `+${numberValue.toFixed(2)}`;
  }

  if (numberValue < 0) {
    return numberValue.toFixed(2);
  }

  return "0.00";
};

export const getChangeTone = (value) => {
  const numberValue = Number(value);

  if (numberValue > 0) {
    return "positive";
  }

  if (numberValue < 0) {
    return "negative";
  }

  return "neutral";
};

export const getChangeLabel = (value) => {
  const numberValue = Number(value);

  if (numberValue > 0) {
    return "Riser";
  }

  if (numberValue < 0) {
    return "Faller";
  }

  return "Even";
};

export const formatSkipReasonLabel = (reason) =>
  String(reason)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

export const findTeamResultBySummaryTeam = (teamResults = [], summaryTeam) => {
  if (!summaryTeam) {
    return null;
  }

  return (
    teamResults.find(
      (team) =>
        team.teamId === summaryTeam.teamId ||
        team.abbreviation === summaryTeam.abbreviation,
    ) ?? null
  );
};
