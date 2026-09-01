import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Database,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { getDatabaseStorage } from '../services/databaseStorageApi.js'
import {
  formatStorageBytes,
  formatStoragePercent,
  getStorageUsageState,
} from '../utils/databaseStorage.js'

const formatCheckedAt = (value) => {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : date.toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
}

function DatabaseStoragePanel({
  active,
  initialError = '',
  initialStorage = null,
  loadStorage = getDatabaseStorage,
}) {
  const [storage, setStorage] = useState(initialStorage)
  const [status, setStatus] = useState(
    initialError ? 'error' : initialStorage ? 'success' : 'idle',
  )
  const [error, setError] = useState(initialError)
  const hasRequested = useRef(Boolean(initialStorage || initialError))

  const load = useCallback(
    async (refresh = false) => {
      setError('')
      setStatus(storage ? 'refreshing' : 'loading')

      try {
        const result = await loadStorage({ refresh })
        setStorage(result)
        setStatus('success')
      } catch (requestError) {
        setError(requestError.message || 'Unable to check database storage.')
        setStatus('error')
      }
    },
    [loadStorage, storage],
  )

  useEffect(() => {
    if (!active || hasRequested.current) {
      return
    }

    hasRequested.current = true
    load(false)
  }, [active, load])

  const isLoading = status === 'loading' || (active && status === 'idle')
  const isRefreshing = status === 'refreshing'
  const usageState = storage?.available
    ? getStorageUsageState(storage.percentUsed)
    : null
  const progressValue = storage?.available
    ? Math.min(100, Math.max(0, Number(storage.percentUsed) || 0))
    : 0

  return (
    <section
      className={`database-storage-card${
        usageState ? ` database-storage-card-${usageState.tone}` : ''
      }`}
      aria-labelledby="database-storage-heading"
    >
      <div className="database-storage-heading">
        <div className="database-storage-title">
          <Database aria-hidden="true" size={22} strokeWidth={2} />
          <div>
            <span>Read-only monitor</span>
            <h3 id="database-storage-heading">Database Storage</h3>
          </div>
        </div>
        <button
          className="database-storage-refresh"
          disabled={isLoading || isRefreshing}
          onClick={() => load(true)}
          type="button"
        >
          {isLoading || isRefreshing ? (
            <LoaderCircle
              aria-hidden="true"
              className="button-spinner"
              size={16}
              strokeWidth={2.2}
            />
          ) : (
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2.2} />
          )}
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="database-storage-loading" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="button-spinner"
            size={18}
            strokeWidth={2.2}
          />
          <span>Checking Atlas storage usage...</span>
        </div>
      ) : null}

      {!isLoading && storage?.available ? (
        <div className="database-storage-content" aria-live="polite">
          <div className="database-storage-summary">
            <p>
              <strong>{formatStorageBytes(storage.usedBytes)}</strong>
              <span> / {formatStorageBytes(storage.limitBytes)}</span>
            </p>
            <span className={`database-storage-state ${usageState.tone}`}>
              {usageState.label}
            </span>
          </div>
          <p className="database-storage-percent">
            {formatStoragePercent(storage.percentUsed)} used
          </p>
          <div
            aria-label="Database storage used"
            aria-valuemax="100"
            aria-valuemin="0"
            aria-valuenow={progressValue}
            aria-valuetext={`${formatStoragePercent(
              storage.percentUsed,
            )} used`}
            className="database-storage-progress"
            role="progressbar"
          >
            <span style={{ width: `${progressValue}%` }} />
          </div>
          <dl className="database-storage-details">
            <div>
              <dt>Available</dt>
              <dd>{formatStorageBytes(storage.remainingBytes)}</dd>
            </div>
            {storage.dataBytes !== null ? (
              <div>
                <dt>Data</dt>
                <dd>{formatStorageBytes(storage.dataBytes)}</dd>
              </div>
            ) : null}
            {storage.indexBytes !== null ? (
              <div>
                <dt>Indexes</dt>
                <dd>{formatStorageBytes(storage.indexBytes)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Last checked</dt>
              <dd>{formatCheckedAt(storage.checkedAt)}</dd>
            </div>
          </dl>
          <p className="database-storage-note">
            Atlas measures uncompressed data plus indexes. Capacity is configured
            for this deployment; monitoring does not delete or change data.
          </p>
        </div>
      ) : null}

      {!isLoading && storage && !storage.available ? (
        <div className="database-storage-unavailable" role="status">
          <AlertTriangle aria-hidden="true" size={20} strokeWidth={2} />
          <div>
            <strong>Database storage usage unavailable</strong>
            <p>{storage.message}</p>
            <small>
              Configured capacity: {formatStorageBytes(storage.limitBytes)} ·
              Checked {formatCheckedAt(storage.checkedAt)}
            </small>
          </div>
        </div>
      ) : null}

      {!isLoading && status === 'error' && error ? (
        <div className="database-storage-unavailable" role="alert">
          <AlertTriangle aria-hidden="true" size={20} strokeWidth={2} />
          <div>
            <strong>Unable to check database storage</strong>
            <p>{error}</p>
            {storage?.available ? (
              <small>The last successful measurement remains visible above.</small>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default DatabaseStoragePanel
