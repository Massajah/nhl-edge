import { apiRequest } from './apiClient.js'

const requestPowerRatingSimulation = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to run rating replay.',
  })
}

export const previewPowerRatingSimulation = async (payload) =>
  requestPowerRatingSimulation('/api/power-rating-simulations/preview', {
    body: JSON.stringify(payload),
    method: 'POST',
  })
