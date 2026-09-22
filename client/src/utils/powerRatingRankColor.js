const RANK_COLOR_STOPS = [
  { position: 0, rgb: [79, 201, 129] },
  { position: 0.25, rgb: [159, 206, 85] },
  { position: 0.5, rgb: [228, 196, 79] },
  { position: 0.75, rgb: [234, 153, 72] },
  { position: 1, rgb: [231, 101, 109] },
]

const formatHexChannel = (value) =>
  Math.round(value).toString(16).padStart(2, '0')

const formatRgbHex = (rgb) => `#${rgb.map(formatHexChannel).join('')}`

export const POWER_RATING_RANK_COLOR_STOPS = Object.freeze(
  RANK_COLOR_STOPS.map(({ position, rgb }) =>
    Object.freeze({ color: formatRgbHex(rgb), position }),
  ),
)

export const normalizePowerRatingRank = (rank, teamCount) => {
  if (
    !Number.isInteger(rank) ||
    !Number.isInteger(teamCount) ||
    teamCount < 1 ||
    rank < 1 ||
    rank > teamCount
  ) {
    return null
  }

  if (teamCount === 1) {
    return 0
  }

  return (rank - 1) / (teamCount - 1)
}

export const getPowerRatingRankColor = (rank, teamCount) => {
  const normalizedRank = normalizePowerRatingRank(rank, teamCount)

  if (normalizedRank === null) {
    return null
  }

  const upperStopIndex = RANK_COLOR_STOPS.findIndex(
    ({ position }) => position >= normalizedRank,
  )

  if (upperStopIndex <= 0) {
    return POWER_RATING_RANK_COLOR_STOPS[0].color
  }

  const lowerStop = RANK_COLOR_STOPS[upperStopIndex - 1]
  const upperStop = RANK_COLOR_STOPS[upperStopIndex]
  const segmentProgress =
    (normalizedRank - lowerStop.position) /
    (upperStop.position - lowerStop.position)
  const interpolatedRgb = lowerStop.rgb.map(
    (channel, index) =>
      channel + (upperStop.rgb[index] - channel) * segmentProgress,
  )

  return formatRgbHex(interpolatedRgb)
}
