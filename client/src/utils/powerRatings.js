import { NHL_TEAMS } from '../data/teams.js'

export const POWER_RATINGS_STORAGE_KEY = 'nhl-edge-power-ratings'

export const DEFAULT_POWER_RATING_VALUES = {
  baseRating: 50,
  homeAdvantage: 2.5,
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
      homeAdvantage: toNumber(
        storedTeam.homeAdvantage,
        defaultTeam.homeAdvantage,
      ),
      manualAdjustment: toNumber(
        storedTeam.manualAdjustment,
        defaultTeam.manualAdjustment,
      ),
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
      rating.homeAdvantage === DEFAULT_POWER_RATING_VALUES.homeAdvantage &&
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
      rating.homeAdvantage !== DEFAULT_POWER_RATING_VALUES.homeAdvantage ||
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

export const getTeamPowerRating = (ratings, teamId) => {
  const normalizedRatings = normalizePowerRatings(ratings)
  const rating =
    normalizedRatings[teamId] ?? normalizedRatings[NHL_TEAMS[0].id]

  return {
    ...rating,
    baseRating: getEffectiveBaseRating(rating),
  }
}
