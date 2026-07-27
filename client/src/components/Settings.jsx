import { useEffect, useMemo, useState } from 'react'
import {
  Gauge,
  KeyRound,
  LoaderCircle,
  Mail,
  RotateCcw,
  Save,
  UserCircle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  getRatingEngineSettings,
  resetRatingEngineSettings,
  updateRatingEngineSettings,
} from '../services/ratingEngineSettingsApi.js'
import {
  DEFAULT_RATING_ENGINE_SETTINGS,
  RATING_ENGINE_SETTING_FIELDS,
  createRatingEngineSettingsDraft,
  normalizeRatingEngineSettings,
  parseRatingEngineSettingsDraft,
} from '../utils/ratingEngineSettings.js'

const providerLabels = {
  both: 'Email and Google',
  google: 'Google',
  local: 'Email/password',
}

const getProviderLabel = (provider) =>
  providerLabels[provider] ?? 'Email/password'

function Settings({ onRatingEngineSettingsChanged }) {
  const { user } = useAuth()
  const [settingsStatus, setSettingsStatus] = useState('loading')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [resetStatus, setResetStatus] = useState('idle')
  const [settingsError, setSettingsError] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [usingDefaults, setUsingDefaults] = useState(true)
  const [savedSettings, setSavedSettings] = useState(() =>
    normalizeRatingEngineSettings(DEFAULT_RATING_ENGINE_SETTINGS),
  )
  const [draftSettings, setDraftSettings] = useState(() =>
    createRatingEngineSettingsDraft(DEFAULT_RATING_ENGINE_SETTINGS),
  )

  useEffect(() => {
    let isCurrent = true

    const loadSettings = async () => {
      setSettingsStatus('loading')
      setSettingsError('')

      try {
        const result = await getRatingEngineSettings()

        if (!isCurrent) {
          return
        }

        const nextSettings = normalizeRatingEngineSettings(result.settings)

        setSavedSettings(nextSettings)
        setDraftSettings(createRatingEngineSettingsDraft(nextSettings))
        setUsingDefaults(Boolean(result.usingDefaults))
        setSettingsStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setSettingsStatus('error')
        setSettingsError(error.message)
      }
    }

    loadSettings()

    return () => {
      isCurrent = false
    }
  }, [])

  const parsedDraft = useMemo(
    () => parseRatingEngineSettingsDraft(draftSettings),
    [draftSettings],
  )
  const hasUnsavedChanges = useMemo(() => {
    if (!parsedDraft.isValid) {
      return true
    }

    return RATING_ENGINE_SETTING_FIELDS.some(
      (field) => parsedDraft.settings[field.key] !== savedSettings[field.key],
    )
  }, [parsedDraft, savedSettings])
  const isPending =
    settingsStatus === 'loading' ||
    saveStatus === 'saving' ||
    resetStatus === 'saving'

  const formatApiFieldErrors = (details = {}) => {
    if (details.fieldErrors) {
      return details.fieldErrors
    }

    return {}
  }

  const handleSettingsChange = (field, value) => {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }))
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      [field]: '',
    }))
    setSaveStatus('idle')
    setSettingsMessage('')
    setSettingsError('')
  }

  const handleSaveSettings = async (event) => {
    event.preventDefault()

    if (isPending) {
      return
    }

    if (!parsedDraft.isValid) {
      setFieldErrors(parsedDraft.fieldErrors)
      setSaveStatus('error')
      setSettingsMessage('Fix invalid engine settings before saving.')
      return
    }

    if (!hasUnsavedChanges) {
      return
    }

    setSaveStatus('saving')
    setSettingsMessage('')
    setSettingsError('')
    setFieldErrors({})

    try {
      const result = await updateRatingEngineSettings(parsedDraft.settings)
      const nextSettings = normalizeRatingEngineSettings(result.settings)

      setSavedSettings(nextSettings)
      setDraftSettings(createRatingEngineSettingsDraft(nextSettings))
      setUsingDefaults(false)
      onRatingEngineSettingsChanged?.(nextSettings)
      setSaveStatus('success')
      setSettingsMessage('Power Rating Engine settings saved.')
    } catch (error) {
      setFieldErrors(formatApiFieldErrors(error.details))
      setSaveStatus('error')
      setSettingsMessage(error.message)
    }
  }

  const handleResetSettings = async () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Reset Power Rating Engine settings to defaults? Future live updates will use the default model settings.',
      )

    if (!confirmed || isPending) {
      return
    }

    setResetStatus('saving')
    setSaveStatus('idle')
    setSettingsMessage('')
    setSettingsError('')
    setFieldErrors({})

    try {
      const result = await resetRatingEngineSettings()
      const nextSettings = normalizeRatingEngineSettings(result.settings)

      setSavedSettings(nextSettings)
      setDraftSettings(createRatingEngineSettingsDraft(nextSettings))
      setUsingDefaults(Boolean(result.usingDefaults))
      onRatingEngineSettingsChanged?.(nextSettings)
      setResetStatus('success')
      setSaveStatus('success')
      setSettingsMessage('Power Rating Engine settings reset to defaults.')
    } catch (error) {
      setResetStatus('idle')
      setSaveStatus('error')
      setSettingsMessage(error.message)
    }
  }

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Account</h2>
          </div>
        </div>

        <div className="profile-summary">
          {user?.profileImage ? (
            <img
              className="profile-avatar"
              src={user.profileImage}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <UserCircle
              className="profile-avatar-icon"
              aria-hidden="true"
              strokeWidth={1.8}
            />
          )}
          <div>
            <strong>{user?.name || user?.email || 'NHL Edge user'}</strong>
            <span>{user?.email || 'Email unavailable'}</span>
          </div>
        </div>

        <div className="profile-grid">
          <div className="profile-field">
            <UserCircle aria-hidden="true" size={19} strokeWidth={2} />
            <span>Name</span>
            <strong>{user?.name || 'Not provided'}</strong>
          </div>
          <div className="profile-field">
            <Mail aria-hidden="true" size={19} strokeWidth={2} />
            <span>Email</span>
            <strong>{user?.email || 'Not provided'}</strong>
          </div>
          <div className="profile-field">
            <KeyRound aria-hidden="true" size={19} strokeWidth={2} />
            <span>Authentication provider</span>
            <strong>{getProviderLabel(user?.authProvider)}</strong>
          </div>
        </div>
      </div>

      <div className="settings-panel settings-engine-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live model</p>
            <h2>Power Rating Engine</h2>
          </div>
          <span>{usingDefaults ? 'Defaults active' : 'Custom settings'}</span>
        </div>

        <div className="settings-info-note">
          <Gauge aria-hidden="true" size={20} strokeWidth={2} />
          <p>
            Configure the global parameters used when completed NHL games update
            your Power Ratings. Changes affect future live updates only;
            already processed games are not recalculated, and Rating Lab remains
            a separate simulation environment.
          </p>
        </div>

        {settingsStatus === 'loading' ? (
          <div className="settings-loading-state" role="status">
            <LoaderCircle
              className="button-spinner"
              aria-hidden="true"
              size={18}
              strokeWidth={2.2}
            />
            <span>Loading engine settings...</span>
          </div>
        ) : null}

        {settingsStatus === 'error' ? (
          <p className="form-status error" role="alert">
            {settingsError}
          </p>
        ) : null}

        {settingsStatus === 'success' ? (
          <form
            className="settings-engine-form"
            noValidate
            onSubmit={handleSaveSettings}
          >
            <div className="settings-engine-grid">
              {RATING_ENGINE_SETTING_FIELDS.map((field) => {
                const errorMessage =
                  fieldErrors[field.key] || parsedDraft.fieldErrors[field.key]
                const showError = Boolean(fieldErrors[field.key])

                return (
                  <label
                    className="field settings-engine-field"
                    htmlFor={`engine-setting-${field.key}`}
                    key={field.key}
                  >
                    <span>{field.label}</span>
                    <input
                      id={`engine-setting-${field.key}`}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={draftSettings[field.key] ?? ''}
                      inputMode="decimal"
                      aria-invalid={showError}
                      aria-describedby={
                        errorMessage
                          ? `engine-setting-${field.key}-error`
                          : undefined
                      }
                      disabled={isPending}
                      onChange={(event) =>
                        handleSettingsChange(field.key, event.target.value)
                      }
                    />
                    {showError ? (
                      <small
                        className="field-error"
                        id={`engine-setting-${field.key}-error`}
                      >
                        {errorMessage}
                      </small>
                    ) : null}
                  </label>
                )
              })}
            </div>

            {settingsMessage ? (
              <p className={`form-status ${saveStatus}`} role="status">
                {settingsMessage}
              </p>
            ) : null}

            <div className="settings-form-actions">
              <button
                className="save-ratings-button"
                type="submit"
                disabled={isPending || !hasUnsavedChanges}
              >
                {saveStatus === 'saving' ? (
                  <LoaderCircle
                    className="button-spinner"
                    aria-hidden="true"
                    size={17}
                    strokeWidth={2.2}
                  />
                ) : (
                  <Save aria-hidden="true" size={17} strokeWidth={2.2} />
                )}
                <span>
                  {saveStatus === 'saving'
                    ? 'Saving...'
                    : hasUnsavedChanges
                      ? 'Save Settings'
                      : 'Saved'}
                </span>
              </button>

              <button
                className="reset-button"
                type="button"
                disabled={isPending}
                onClick={handleResetSettings}
              >
                {resetStatus === 'saving' ? (
                  <LoaderCircle
                    className="button-spinner"
                    aria-hidden="true"
                    size={17}
                    strokeWidth={2.2}
                  />
                ) : (
                  <RotateCcw aria-hidden="true" size={17} strokeWidth={2.2} />
                )}
                <span>
                  {resetStatus === 'saving'
                    ? 'Resetting...'
                    : 'Reset to Defaults'}
                </span>
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  )
}

export default Settings
