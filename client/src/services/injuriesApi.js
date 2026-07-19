import { apiRequest } from './apiClient.js'

const requestInjuries = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load injuries.',
  })
}

export const fetchInjuries = async () => {
  const data = await requestInjuries('/api/injuries')

  return data.injuries ?? []
}

export const fetchTeamInjurySummary = async () => {
  const data = await requestInjuries('/api/injuries/summary')

  return data.summary ?? []
}

export const createInjury = async (injury) => {
  const data = await requestInjuries('/api/injuries', {
    body: JSON.stringify(injury),
    method: 'POST',
  })

  return data.injury
}

export const updateInjury = async (id, updates) => {
  const data = await requestInjuries(`/api/injuries/${encodeURIComponent(id)}`, {
    body: JSON.stringify(updates),
    method: 'PUT',
  })

  return data.injury
}

export const deleteInjury = async (id) => {
  const data = await requestInjuries(`/api/injuries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  return data.injury
}
