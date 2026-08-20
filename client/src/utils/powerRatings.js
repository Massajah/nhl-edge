import { NHL_TEAMS } from '../data/teams.js'
import { BASE_MODEL_V1 } from '../config/baseModel.js'

export const POWER_RATINGS_STORAGE_KEY = 'nhl-edge-power-ratings'
export const DEFAULT_HOME_ADJUSTMENT = 0
export const HOME_ADJUSTMENT_LIMITS = Object.freeze({
  max: 5,
  min: -5,
})

export const DEFAULT_POWER_RATING_VALUES = {
  baseRating: BASE_MODEL_V1.startingRatings.center,
  homeAdjustment: DEFAULT_HOME_ADJUSTMENT,
  manualAdjustment: 0,
  lastRatingChange: 0,
}

export const POWER_RATING_NUMERIC_FIELDS = Object.keys(
  DEFAULT_POWER_RATING_VALUES,
)

const toNumber = (value, fallback) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

export const parsePowerRatingDraftValue = (value) => {
  if (String(value ?? '').trim() === '') {
    return null
  }

  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

export const formatPowerRatingDisplayValue = (
  value,
  { fallback = '' } = {},
) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback
  }

  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue.toFixed(2) : fallback
}

export const formatSignedPowerRatingDisplayValue = (value) => {
  const formattedValue = formatPowerRatingDisplayValue(value, {
    fallback: '0.00',
  })
  const parsedValue = Number(value)

  return `${parsedValue > 0 ? '+' : ''}${formattedValue}`
}

export const getRatingHomeAdjustment = (rating) =>
  toNumber(
    rating?.homeAdjustment ?? rating?.homeAdvantage,
    DEFAULT_HOME_ADJUSTMENT,
  )

export const getEffectiveHomeAdvantage = ({
  baseHomeAdvantage,
  homeAdjustment,
  homeRating,
}) => {
  const normalizedBaseHomeAdvantage = toNumber(baseHomeAdvantage, 0)
  const normalizedHomeAdjustment =
    homeAdjustment === undefined
      ? getRatingHomeAdjustment(homeRating)
      : toNumber(homeAdjustment, DEFAULT_HOME_ADJUSTMENT)

  return normalizedBaseHomeAdvantage + normalizedHomeAdjustment
}

export const formatSignedHomeAdjustment = (value) => {
  const numberValue = toNumber(value, DEFAULT_HOME_ADJUSTMENT)

  return `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(2)}`
}

const indexRatingsByTeamId = (storedRatings = {}) => {
  if (Array.isArray(storedRatings)) {
    return storedRatings.reduce((ratingsByTeamId, rating) => {
      const teamId = rating.teamId ?? rating.id ?? rating.abbreviation

      if (teamId) {
        ratingsByTeamId[teamId] = rating
      }

      return ratingsByTeamId
    }, {})
  }

  return storedRatings
}

export const createDefaultPowerRatings = () =>
  NHL_TEAMS.reduce((ratings, team) => {
    ratings[team.id] = {
      teamId: team.id,
      teamName: team.name,
      abbreviation: team.abbreviation,
      ...DEFAULT_POWER_RATING_VALUES,
    }

    return ratings
  }, {})

export const normalizePowerRatings = (storedRatings = {}) => {
  const defaults = createDefaultPowerRatings()
  const ratingsByTeamId = indexRatingsByTeamId(storedRatings)

  return NHL_TEAMS.reduce((ratings, team) => {
    const storedTeam = ratingsByTeamId[team.id] ?? {}
    const defaultTeam = defaults[team.id]

    ratings[team.id] = {
      teamId: storedTeam.teamId ?? defaultTeam.teamId,
      teamName: storedTeam.teamName ?? defaultTeam.teamName,
      abbreviation: storedTeam.abbreviation ?? defaultTeam.abbreviation,
      baseRating: toNumber(storedTeam.baseRating, defaultTeam.baseRating),
      homeAdjustment: getRatingHomeAdjustment(storedTeam),
      manualAdjustment: toNumber(
        storedTeam.manualAdjustment,
        defaultTeam.manualAdjustment,
      ),
      seasonStartingRating: toNullableNumber(
        storedTeam.seasonStartingRating,
      ),
      seasonStartingRatingSeasonId: String(
        storedTeam.seasonStartingRatingSeasonId ?? '',
      ).trim(),
      lastRatingChange: toNumber(
        storedTeam.lastRatingChange,
        defaultTeam.lastRatingChange,
      ),
    }

    return ratings
  }, {})
}

export const loadLocalPowerRatings = () => {
  if (typeof window === 'undefined') {
    return createDefaultPowerRatings()
  }

  try {
    const storedRatings = window.localStorage.getItem(POWER_RATINGS_STORAGE_KEY)
    return normalizePowerRatings(storedRatings ? JSON.parse(storedRatings) : {})
  } catch {
    return createDefaultPowerRatings()
  }
}

export const arePowerRatingsDefault = (ratings) => {
  const normalizedRatings = normalizePowerRatings(ratings)

  return NHL_TEAMS.every((team) => {
    const rating = normalizedRatings[team.id]

    return (
      rating.baseRating === DEFAULT_POWER_RATING_VALUES.baseRating &&
      rating.homeAdjustment ===
        DEFAULT_POWER_RATING_VALUES.homeAdjustment &&
      rating.manualAdjustment === DEFAULT_POWER_RATING_VALUES.manualAdjustment
    )
  })
}

export const getCustomizedPowerRatingTeamIds = (ratings) => {
  const normalizedRatings = normalizePowerRatings(ratings)

  return NHL_TEAMS.filter((team) => {
    const rating = normalizedRatings[team.id]

    return (
      rating.baseRating !== DEFAULT_POWER_RATING_VALUES.baseRating ||
      rating.homeAdjustment !==
        DEFAULT_POWER_RATING_VALUES.homeAdjustment ||
      rating.manualAdjustment !== DEFAULT_POWER_RATING_VALUES.manualAdjustment
    )
  }).map((team) => team.id)
}

export const hasCustomizedPowerRatings = (ratings) =>
  getCustomizedPowerRatingTeamIds(ratings).length > 0

export const getEffectiveBaseRating = (rating) =>
  toNumber(rating?.baseRating, DEFAULT_POWER_RATING_VALUES.baseRating) +
  toNumber(
    rating?.manualAdjustment,
    DEFAULT_POWER_RATING_VALUES.manualAdjustment,
  )

export const getPowerRatingBreakdown = (rating = {}, { seasonId = '' } = {}) => {
  const modelRating = toNumber(
    rating?.baseRating,
    DEFAULT_POWER_RATING_VALUES.baseRating,
  )
  const manualAdjustment = toNumber(
    rating?.manualAdjustment,
    DEFAULT_POWER_RATING_VALUES.manualAdjustment,
  )
  const storedStartingRating = toNullableNumber(rating?.seasonStartingRating)
  const storedSeasonId = String(
    rating?.seasonStartingRatingSeasonId ?? '',
  ).trim()
  const normalizedSeasonId = String(seasonId ?? '').trim()
  const startingRating =
    storedStartingRating !== null &&
    (!normalizedSeasonId || !storedSeasonId || storedSeasonId === normalizedSeasonId)
      ? storedStartingRating
      : null

  return {
    currentRating: modelRating + manualAdjustment,
    manualAdjustment,
    modelMovement:
      startingRating === null ? null : modelRating - startingRating,
    modelRating,
    startingRating,
  }
}

export const getPowerRatingLeagueRanks = (ratings = {}) => {
  const indexedRatings = indexRatingsByTeamId(ratings)
  const rankedRatings = Object.entries(indexedRatings)
    .map(([key, rating]) => ({
      currentRating: getEffectiveBaseRating(rating),
      teamId: String(
        rating?.teamId ?? rating?.id ?? rating?.abbreviation ?? key,
      )
        .trim()
        .toUpperCase(),
    }))
    .filter((rating) => rating.teamId)
    .sort(
      (left, right) =>
        right.currentRating - left.currentRating ||
        left.teamId.localeCompare(right.teamId),
    )
  const ranks = {}
  let previousRating = null
  let previousRank = 0

  rankedRatings.forEach((rating, index) => {
    const rank =
      previousRating !== null && rating.currentRating === previousRating
        ? previousRank
        : index + 1

    ranks[rating.teamId] = rank
    previousRating = rating.currentRating
    previousRank = rank
  })

  return ranks
}

export const getPowerRatingLeagueRank = (ratings, teamId) =>
  getPowerRatingLeagueRanks(ratings)[String(teamId ?? '').trim().toUpperCase()] ??
  null

export const getTeamPowerRating = (ratings, teamId) => {
  const normalizedRatings = normalizePowerRatings(ratings)
  const rating =
    normalizedRatings[teamId] ?? normalizedRatings[NHL_TEAMS[0].id]

  return {
    ...rating,
    baseRating: getEffectiveBaseRating(rating),
  }
}
