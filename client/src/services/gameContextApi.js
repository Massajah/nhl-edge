import { apiRequest } from './apiClient.js'
import { normalizeGameContext } from '../utils/gameContext.js'

const requestGameContext = async (path, options = {}) =>
  apiRequest(path, options, {
    fallbackMessage: 'Unable to load game context.',
  })

export const fetchGameContexts = async (games = []) => {
  const result = await requestGameContext('/api/game-context/bulk', {
    body: JSON.stringify({ games }),
    method: 'POST',
  })

  return {
    ...result,
    contexts: (Array.isArray(result.contexts) ? result.contexts : [])
      .map(normalizeGameContext)
      .filter(Boolean),
  }
}

export const updateGameContextOverrides = async (gameId, overrides) =>
  requestGameContext(`/api/game-context/${encodeURIComponent(gameId)}`, {
    body: JSON.stringify(overrides),
    method: 'PATCH',
  })

export const updateGameGoalieSelections = async (gameId, selections) =>
  requestGameContext(
    `/api/game-context/${encodeURIComponent(gameId)}/goalies`,
    {
      body: JSON.stringify(selections),
      method: 'PATCH',
    },
  )
