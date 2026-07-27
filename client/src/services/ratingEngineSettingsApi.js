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

export const resetRatingEngineSettings = async () =>
  requestRatingEngineSettings('/api/settings/rating-engine/reset', {
    method: 'POST',
  })
