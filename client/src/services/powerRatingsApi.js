import { apiRequest } from './apiClient.js'
import {
  buildAutomaticPowerRatingUpdateRequestBody,
  buildPowerRatingUpdateRequestBody,
  normalizeAutomaticPowerRatingUpdateResult,
  normalizePowerRatingUpdateResult,
} from '../utils/powerRatingUpdates.js'
import {
  buildPowerRatingHistoryQueryString,
  normalizePowerRatingHistoryResponse,
  normalizePowerRatingHistorySeasonsResponse,
} from '../utils/powerRatingHistory.js'

const requestPowerRatings = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load power ratings.',
  })
}

let automaticPowerRatingUpdateRequest = null

export const fetchPowerRatings = async () => {
  const data = await requestPowerRatings('/api/power-ratings')

  return data.ratings ?? []
}

export const seedPowerRatings = async () =>
  requestPowerRatings('/api/power-ratings/seed', {
    method: 'POST',
  })

export const resetPowerRatings = async () =>
  requestPowerRatings('/api/power-ratings/reset', {
    method: 'POST',
  })

export const getStartingRatingScale = async () =>
  requestPowerRatings('/api/power-ratings/starting-scale')

export const updateStartingRatingScale = async (scale) =>
  requestPowerRatings('/api/power-ratings/starting-scale', {
    body: JSON.stringify(scale),
    method: 'PUT',
  })

export const updatePowerRating = async (teamId, values) => {
  const data = await requestPowerRatings(
    `/api/power-ratings/${encodeURIComponent(teamId)}`,
    {
      body: JSON.stringify(values),
      method: 'PUT',
    },
  )

  return data.rating
}

export const updateStartingPowerRating = async (teamId, values) => {
  const data = await requestPowerRatings(
    `/api/power-ratings/starting/${encodeURIComponent(teamId)}`,
    {
      body: JSON.stringify(values),
      method: 'PUT',
    },
  )

  return data.rating
}

export const updatePowerRatings = async (range) => {
  const data = await requestPowerRatings('/api/power-ratings/update', {
    body: JSON.stringify(buildPowerRatingUpdateRequestBody(range)),
    method: 'POST',
  })

  return normalizePowerRatingUpdateResult(data)
}

export const autoUpdatePowerRatings = async (options = {}) => {
  if (automaticPowerRatingUpdateRequest) {
    return automaticPowerRatingUpdateRequest
  }

  automaticPowerRatingUpdateRequest = requestPowerRatings(
    '/api/power-ratings/auto-update',
    {
      body: JSON.stringify(
        buildAutomaticPowerRatingUpdateRequestBody(options),
      ),
      method: 'POST',
    },
  )
    .then(normalizeAutomaticPowerRatingUpdateResult)
    .finally(() => {
      automaticPowerRatingUpdateRequest = null
    })

  return automaticPowerRatingUpdateRequest
}

export const getPowerRatingHistory = async (params = {}) => {
  const data = await requestPowerRatings(
    `/api/power-ratings/history${buildPowerRatingHistoryQueryString(params)}`,
  )

  return normalizePowerRatingHistoryResponse(data)
}

export const getPowerRatingHistorySeasons = async () => {
  const data = await requestPowerRatings('/api/power-ratings/history/seasons')

  return normalizePowerRatingHistorySeasonsResponse(data)
}
