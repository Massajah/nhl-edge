const STORAGE_UNITS = Object.freeze(['B', 'KB', 'MB', 'GB', 'TB'])

export const formatStorageBytes = (bytes) => {
  const value = Number(bytes)

  if (!Number.isFinite(value) || value < 0) {
    return 'Unavailable'
  }

  if (value < 1024) {
    return `${Math.round(value)} B`
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    STORAGE_UNITS.length - 1,
  )
  const scaledValue = value / 1024 ** unitIndex
  const maximumDecimals = unitIndex >= 3 && scaledValue < 10 ? 2 : 1

  return `${Number(scaledValue.toFixed(maximumDecimals))} ${STORAGE_UNITS[unitIndex]}`
}

export const formatStoragePercent = (percentUsed) => {
  const value = Number(percentUsed)

  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Unavailable'
}

export const getStorageUsageState = (percentUsed) => {
  const value = Number(percentUsed)

  if (!Number.isFinite(value) || value < 70) {
    return { label: 'Capacity healthy', tone: 'normal' }
  }

  if (value < 85) {
    return { label: 'Storage usage warning', tone: 'warning' }
  }

  if (value < 95) {
    return { label: 'Storage usage high', tone: 'high' }
  }

  return { label: 'Storage usage critical', tone: 'critical' }
}
