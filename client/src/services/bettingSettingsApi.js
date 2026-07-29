import { apiRequest } from './apiClient.js'
import { normalizeBettingSettings } from '../utils/bettingSettings.js'

const requestBettingSettings = async (path, options = {}) =>
  apiRequest(path, options, {
    fallbackMessage: 'Unable to load betting settings.',
  })

export const getBettingSettings = async () => {
  const result = await requestBettingSettings('/api/settings/betting')

  return {
    ...result,
    settings: normalizeBettingSettings(result.settings),
  }
}

export const updateBettingSettings = async (settings) => {
  const result = await requestBettingSettings('/api/settings/betting', {
    body: JSON.stringify(settings),
    method: 'PUT',
  })

  return {
    ...result,
    settings: normalizeBettingSettings(result.settings),
  }
}

export const resetBettingSettings = async () => {
  const result = await requestBettingSettings('/api/settings/betting/reset', {
    method: 'POST',
  })

  return {
    ...result,
    settings: normalizeBettingSettings(result.settings),
  }
}
