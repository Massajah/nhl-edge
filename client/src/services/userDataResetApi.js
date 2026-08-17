import { apiRequest } from './apiClient.js'

const requestReset = (path, body) =>
  apiRequest(
    path,
    {
      ...(body ? { body: JSON.stringify(body) } : {}),
      method: 'POST',
    },
    { fallbackMessage: 'Unable to reset NHL Edge data.' },
  )

export const resetSettingsToDefaults = () =>
  requestReset('/api/settings/reset/settings')

export const resetForNewSeason = () =>
  requestReset('/api/settings/reset/new-season')

export const factoryResetUserData = (confirmation) =>
  requestReset('/api/settings/reset/factory', { confirmation })
