import { apiRequest } from './apiClient.js'

export const getDatabaseStorage = ({ refresh = false } = {}) =>
  apiRequest(
    `/api/settings/storage${refresh ? '?refresh=true' : ''}`,
    undefined,
    { fallbackMessage: 'Unable to check database storage.' },
  )
