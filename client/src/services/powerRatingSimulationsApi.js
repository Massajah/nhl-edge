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

export const getBaseModelCalibrationOptions = async () =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/calibration/options',
    { method: 'GET' },
  )

export const runBaseModelCalibration = async (payload) =>
  requestPowerRatingSimulation('/api/power-rating-simulations/calibration/run', {
    body: JSON.stringify(payload),
    method: 'POST',
  })

export const prepareHistoricalCalibrationSeason = async (
  seasonId,
  { refresh = false } = {},
) =>
  requestPowerRatingSimulation(
    `/api/power-rating-simulations/calibration/historical-seasons/${encodeURIComponent(
      seasonId,
    )}/prepare`,
    {
      body: JSON.stringify({ refresh }),
      method: 'POST',
    },
  )

export const getHomeAdvantageCalibrationOptions = async () =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/home-advantage/options',
    { method: 'GET' },
  )

export const runHomeAdvantageCalibration = async (payload = {}) =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/home-advantage/run',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  )

export const prepareHomeAdvantageHistoricalSeason = async (
  seasonId,
  { refresh = false } = {},
) =>
  requestPowerRatingSimulation(
    `/api/power-rating-simulations/home-advantage/historical-seasons/${encodeURIComponent(
      seasonId,
    )}/prepare`,
    {
      body: JSON.stringify({ refresh }),
      method: 'POST',
    },
  )

export const getScheduleCalibrationOptions = async () =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/schedule-context/options',
    { method: 'GET' },
  )

export const runScheduleCalibration = async (payload = {}) =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/schedule-context/run',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  )

export const prepareScheduleCalibrationSeason = async (
  seasonId,
  { refresh = false } = {},
) =>
  requestPowerRatingSimulation(
    `/api/power-rating-simulations/schedule-context/historical-seasons/${encodeURIComponent(
      seasonId,
    )}/prepare`,
    {
      body: JSON.stringify({ refresh }),
      method: 'POST',
    },
  )

export const getSpecialTeamsCalibrationOptions = async () =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/special-teams/options',
    { method: 'GET' },
  )

export const runSpecialTeamsCalibration = async (payload = {}) =>
  requestPowerRatingSimulation(
    '/api/power-rating-simulations/special-teams/run',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  )

export const prepareSpecialTeamsCalibrationGameSeason = async (
  seasonId,
  { refresh = false } = {},
) =>
  requestPowerRatingSimulation(
    `/api/power-rating-simulations/special-teams/historical-seasons/${encodeURIComponent(
      seasonId,
    )}/prepare`,
    {
      body: JSON.stringify({ refresh }),
      method: 'POST',
    },
  )

export const prepareSpecialTeamsReferenceSeason = async (
  seasonId,
  { refresh = false } = {},
) =>
  requestPowerRatingSimulation(
    `/api/power-rating-simulations/special-teams/reference-seasons/${encodeURIComponent(
      seasonId,
    )}/prepare`,
    {
      body: JSON.stringify({ refresh }),
      method: 'POST',
    },
  )
