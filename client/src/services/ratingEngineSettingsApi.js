import { apiRequest } from './apiClient.js'

const requestRatingEngineSettings = async (path, options = {}) =>
  apiRequest(path, options, {
    fallbackMessage: 'Unable to load rating engine settings.',
  })

export const getRatingEngineSettings = async () =>
  requestRatingEngineSettings('/api/settings/rating-engine')

export const updateRatingEngineSettings = async (settings) =>
  requestRatingEngineSettings('/api/settings/rating-engine', {
    body: JSON.stringify(settings),
    method: 'PUT',
  })

export const updateRatingEngineParameters = async (settings) =>
  requestRatingEngineSettings('/api/settings/rating-engine/engine', {
    body: JSON.stringify(settings),
    method: 'PUT',
  })

export const updateRatingEngineModelAdjustments = async (settings) =>
  requestRatingEngineSettings(
    '/api/settings/rating-engine/model-adjustments',
    {
      body: JSON.stringify(settings),
      method: 'PUT',
    },
  )

export const resetRatingEngineSettings = async (scope = 'all') =>
  requestRatingEngineSettings('/api/settings/rating-engine/reset', {
    body: JSON.stringify({ scope }),
    method: 'POST',
  })
