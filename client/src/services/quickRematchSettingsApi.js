import { apiRequest } from './apiClient.js'
import { normalizeQuickRematchSettings } from '../utils/quickRematchSettings.js'

const requestQuickRematchSettings = async (path, options = {}) =>
  apiRequest(path, options, {
    fallbackMessage: 'Unable to load quick rematch settings.',
  })

export const getQuickRematchSettings = async () => {
  const result = await requestQuickRematchSettings('/api/settings/quick-rematch')

  return {
    ...result,
    settings: normalizeQuickRematchSettings(result.settings),
  }
}

export const updateQuickRematchSettings = async (settings) => {
  const result = await requestQuickRematchSettings('/api/settings/quick-rematch', {
    body: JSON.stringify(settings),
    method: 'PUT',
  })

  return {
    ...result,
    settings: normalizeQuickRematchSettings(result.settings),
  }
}

export const resetQuickRematchSettings = async () => {
  const result = await requestQuickRematchSettings(
    '/api/settings/quick-rematch/reset',
    {
      method: 'POST',
    },
  )

  return {
    ...result,
    settings: normalizeQuickRematchSettings(result.settings),
  }
}
