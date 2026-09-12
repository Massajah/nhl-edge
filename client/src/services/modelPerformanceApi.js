import { apiRequest } from './apiClient.js'
import { buildModelPerformanceQueryString } from '../utils/modelPerformance.js'

const requestModelPerformance = (path) =>
  apiRequest(path, {}, {
    fallbackMessage: 'Unable to load Model Performance.',
  })

export const fetchModelPerformance = (filters = {}) =>
  requestModelPerformance(
    `/api/model-performance${buildModelPerformanceQueryString(filters)}`,
  )

export const fetchModelPerformanceGames = (filters = {}) =>
  requestModelPerformance(
    `/api/model-performance/games${buildModelPerformanceQueryString(filters, {
      games: true,
    })}`,
  )
