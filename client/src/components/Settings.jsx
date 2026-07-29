import { useEffect, useMemo, useState } from 'react'
import {
  Gauge,
  KeyRound,
  LoaderCircle,
  Mail,
  Percent,
  RotateCcw,
  Save,
  UserCircle,
  WalletCards,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { getBankrollSummary } from '../services/bankrollApi.js'
import {
  getBettingSettings,
  resetBettingSettings,
  updateBettingSettings,
} from '../services/bettingSettingsApi.js'
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
import {
  BANKROLL_BASIS_OPTIONS,
  BETTING_SETTING_KEYS,
  DEFAULT_BETTING_SETTINGS,
  KELLY_MODE_OPTIONS,
  applyKellyModeSelection,
  createBettingSettingsDraft,
  formatApiFieldErrors as formatBettingApiFieldErrors,
  formatStakeRoundingLabel,
  getKellyModeFraction,
  getStakeRoundingOptions,
  normalizeBettingSettings,
  parseBettingSettingsDraft,
  shouldShowCustomKellyFraction,
} from '../utils/bettingSettings.js'
import {
  BANKROLL_DEFAULT_CURRENCY,
  formatBankrollCurrency,
} from '../utils/bankroll.js'

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
  const [bettingStatus, setBettingStatus] = useState('loading')
  const [bettingSaveStatus, setBettingSaveStatus] = useState('idle')
  const [bettingResetStatus, setBettingResetStatus] = useState('idle')
  const [bettingError, setBettingError] = useState('')
  const [bettingMessage, setBettingMessage] = useState('')
  const [bettingFieldErrors, setBettingFieldErrors] = useState({})
  const [bettingUsingDefaults, setBettingUsingDefaults] = useState(true)
  const [savedBettingSettings, setSavedBettingSettings] = useState(() =>
    normalizeBettingSettings(DEFAULT_BETTING_SETTINGS),
  )
  const [draftBettingSettings, setDraftBettingSettings] = useState(() =>
    createBettingSettingsDraft(DEFAULT_BETTING_SETTINGS),
  )
  const [bankrollSummary, setBankrollSummary] = useState(null)
  const [bankrollStatus, setBankrollStatus] = useState('loading')
  const [bankrollError, setBankrollError] = useState('')

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

  useEffect(() => {
    let isCurrent = true

    const loadBettingSettings = async () => {
      setBettingStatus('loading')
      setBettingError('')

      try {
        const result = await getBettingSettings()

        if (!isCurrent) {
          return
        }

        const nextSettings = normalizeBettingSettings(result.settings)

        setSavedBettingSettings(nextSettings)
        setDraftBettingSettings(createBettingSettingsDraft(nextSettings))
        setBettingUsingDefaults(Boolean(result.usingDefaults))
        setBettingStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setBettingStatus('error')
        setBettingError(error.message)
      }
    }

    loadBettingSettings()

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadBankrollStatus = async () => {
      setBankrollStatus('loading')
      setBankrollError('')

      try {
        const summary = await getBankrollSummary()

        if (!isCurrent) {
          return
        }

        setBankrollSummary(summary)
        setBankrollStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setBankrollSummary(null)
        setBankrollStatus('error')
        setBankrollError(error.message)
      }
    }

    loadBankrollStatus()

    return () => {
      isCurrent = false
    }
  }, [])

  const parsedDraft = useMemo(
    () => parseRatingEngineSettingsDraft(draftSettings),
    [draftSettings],
  )
  const parsedBettingDraft = useMemo(
    () => parseBettingSettingsDraft(draftBettingSettings),
    [draftBettingSettings],
  )
  const hasUnsavedChanges = useMemo(() => {
    if (!parsedDraft.isValid) {
      return true
    }

    return RATING_ENGINE_SETTING_FIELDS.some(
      (field) => parsedDraft.settings[field.key] !== savedSettings[field.key],
    )
  }, [parsedDraft, savedSettings])
  const hasUnsavedBettingChanges = useMemo(() => {
    if (!parsedBettingDraft.isValid) {
      return true
    }

    return BETTING_SETTING_KEYS.some(
      (field) =>
        parsedBettingDraft.settings[field] !== savedBettingSettings[field],
    )
  }, [parsedBettingDraft, savedBettingSettings])
  const isPending =
    settingsStatus === 'loading' ||
    saveStatus === 'saving' ||
    resetStatus === 'saving'
  const isBettingPending =
    bettingStatus === 'loading' ||
    bettingSaveStatus === 'saving' ||
    bettingResetStatus === 'saving'
  const bankrollCurrency =
    bankrollSummary?.currency || BANKROLL_DEFAULT_CURRENCY
  const isBankrollInitialized = Boolean(bankrollSummary?.initialized)
  const effectiveKellyFraction = parsedBettingDraft.isValid
    ? getKellyModeFraction(parsedBettingDraft.settings)
    : getKellyModeFraction(savedBettingSettings)
  const stakeRoundingOptions = useMemo(
    () => getStakeRoundingOptions(bankrollCurrency),
    [bankrollCurrency],
  )
  const showCustomKellyFraction = shouldShowCustomKellyFraction(
    draftBettingSettings.kellyMode,
  )

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

  const handleBettingSettingsChange = (field, value) => {
    setDraftBettingSettings((currentSettings) => {
      if (field === 'kellyMode') {
        return applyKellyModeSelection(currentSettings, value)
      }

      return {
        ...currentSettings,
        [field]: value,
      }
    })
    setBettingFieldErrors((currentErrors) => ({
      ...currentErrors,
      [field]: '',
    }))
    setBettingSaveStatus('idle')
    setBettingMessage('')
    setBettingError('')
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

  const handleSaveBettingSettings = async (event) => {
    event.preventDefault()

    if (isBettingPending) {
      return
    }

    if (!parsedBettingDraft.isValid) {
      setBettingFieldErrors(parsedBettingDraft.fieldErrors)
      setBettingSaveStatus('error')
      setBettingMessage('Fix invalid betting settings before saving.')
      return
    }

    if (!hasUnsavedBettingChanges) {
      return
    }

    setBettingSaveStatus('saving')
    setBettingMessage('')
    setBettingError('')
    setBettingFieldErrors({})

    try {
      const result = await updateBettingSettings(parsedBettingDraft.settings)
      const nextSettings = normalizeBettingSettings(result.settings)

      setSavedBettingSettings(nextSettings)
      setDraftBettingSettings(createBettingSettingsDraft(nextSettings))
      setBettingUsingDefaults(false)
      setBettingSaveStatus('success')
      setBettingMessage('Betting settings saved.')
    } catch (error) {
      setBettingFieldErrors(formatBettingApiFieldErrors(error.details))
      setBettingSaveStatus('error')
      setBettingMessage(error.message)
    }
  }

  const handleResetBettingSettings = async () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Reset Betting & Staking settings to defaults? Future stake recommendations will use Quarter Kelly defaults.',
      )

    if (!confirmed || isBettingPending) {
      return
    }

    setBettingResetStatus('saving')
    setBettingSaveStatus('idle')
    setBettingMessage('')
    setBettingError('')
    setBettingFieldErrors({})

    try {
      const result = await resetBettingSettings()
      const nextSettings = normalizeBettingSettings(result.settings)

      setSavedBettingSettings(nextSettings)
      setDraftBettingSettings(createBettingSettingsDraft(nextSettings))
      setBettingUsingDefaults(Boolean(result.usingDefaults))
      setBettingResetStatus('success')
      setBettingSaveStatus('success')
      setBettingMessage('Betting settings reset to defaults.')
    } catch (error) {
      setBettingResetStatus('idle')
      setBettingSaveStatus('error')
      setBettingMessage(error.message)
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

      <div
        id="betting-staking-settings"
        className="settings-panel settings-betting-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Stake configuration</p>
            <h2>Betting &amp; Staking</h2>
          </div>
          <span>
            {bettingUsingDefaults ? 'Defaults active' : 'Custom settings'}
          </span>
        </div>

        <div className="settings-info-note">
          <Percent aria-hidden="true" size={20} strokeWidth={2} />
          <p>
            Configure how NHL Edge will calculate future Kelly stake
            recommendations in Game Analyzer. NHL Edge will not place bets
            automatically, and existing bets are not modified.
          </p>
        </div>

        <div className="settings-betting-guidance">
          <p>Quarter Kelly is the default.</p>
          <p>Maximum Stake is a hard cap, and Minimum Edge can suppress low-edge recommendations.</p>
          <p>Settings affect future recommendations only.</p>
        </div>

        {bettingStatus === 'loading' ? (
          <div className="settings-loading-state" role="status">
            <LoaderCircle
              className="button-spinner"
              aria-hidden="true"
              size={18}
              strokeWidth={2.2}
            />
            <span>Loading betting settings...</span>
          </div>
        ) : null}

        {bettingStatus === 'error' ? (
          <p className="form-status error" role="alert">
            {bettingError}
          </p>
        ) : null}

        {bettingStatus === 'success' ? (
          <form
            className="settings-betting-form"
            noValidate
            onSubmit={handleSaveBettingSettings}
          >
            <div className="settings-betting-grid">
              <label
                className="field settings-betting-field"
                htmlFor="betting-setting-kelly-mode"
              >
                <span>Kelly Mode</span>
                <select
                  id="betting-setting-kelly-mode"
                  value={draftBettingSettings.kellyMode}
                  disabled={isBettingPending}
                  aria-invalid={Boolean(bettingFieldErrors.kellyMode)}
                  onChange={(event) =>
                    handleBettingSettingsChange(
                      'kellyMode',
                      event.target.value,
                    )
                  }
                >
                  {KELLY_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {bettingFieldErrors.kellyMode ? (
                  <small className="field-error">
                    {bettingFieldErrors.kellyMode}
                  </small>
                ) : (
                  <small>
                    Fractional Kelly reduces stake size and volatility when
                    model probabilities are uncertain. Effective fraction:{' '}
                    {effectiveKellyFraction.toFixed(2)}
                  </small>
                )}
              </label>

              <div className="settings-betting-custom-slot">
                {showCustomKellyFraction ? (
                  <label
                    className="field settings-betting-field"
                    htmlFor="betting-setting-custom-kelly"
                  >
                    <span>Custom Kelly Fraction</span>
                    <input
                      id="betting-setting-custom-kelly"
                      type="number"
                      min="0.01"
                      max="1"
                      step="0.01"
                      value={draftBettingSettings.customKellyFraction}
                      inputMode="decimal"
                      aria-invalid={Boolean(
                        bettingFieldErrors.customKellyFraction,
                      )}
                      disabled={isBettingPending}
                      onChange={(event) =>
                        handleBettingSettingsChange(
                          'customKellyFraction',
                          event.target.value,
                        )
                      }
                    />
                    {bettingFieldErrors.customKellyFraction ? (
                      <small className="field-error">
                        {bettingFieldErrors.customKellyFraction}
                      </small>
                    ) : (
                      <small>0.25 = Quarter Kelly, 0.50 = Half Kelly.</small>
                    )}
                  </label>
                ) : null}
              </div>

              <label
                className="field settings-betting-field"
                htmlFor="betting-setting-max-stake"
              >
                <span>Maximum Stake</span>
                <input
                  id="betting-setting-max-stake"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={draftBettingSettings.maximumStakePercent}
                  inputMode="decimal"
                  aria-invalid={Boolean(bettingFieldErrors.maximumStakePercent)}
                  disabled={isBettingPending}
                  onChange={(event) =>
                    handleBettingSettingsChange(
                      'maximumStakePercent',
                      event.target.value,
                    )
                  }
                />
                {bettingFieldErrors.maximumStakePercent ? (
                  <small className="field-error">
                    {bettingFieldErrors.maximumStakePercent}
                  </small>
                ) : (
                  <small>
                    Percent of bankroll. Caps the recommended stake even if the
                    Kelly calculation is higher.
                  </small>
                )}
              </label>

              <label
                className="field settings-betting-field"
                htmlFor="betting-setting-min-edge"
              >
                <span>Minimum Edge</span>
                <input
                  id="betting-setting-min-edge"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draftBettingSettings.minimumEdgePercent}
                  inputMode="decimal"
                  aria-invalid={Boolean(bettingFieldErrors.minimumEdgePercent)}
                  disabled={isBettingPending}
                  onChange={(event) =>
                    handleBettingSettingsChange(
                      'minimumEdgePercent',
                      event.target.value,
                    )
                  }
                />
                {bettingFieldErrors.minimumEdgePercent ? (
                  <small className="field-error">
                    {bettingFieldErrors.minimumEdgePercent}
                  </small>
                ) : (
                  <small>
                    Percentage-point edge. No stake will be recommended below
                    this model edge.
                  </small>
                )}
              </label>

              <label
                className="field settings-betting-field"
                htmlFor="betting-setting-rounding"
              >
                <span>Stake Rounding</span>
                <select
                  id="betting-setting-rounding"
                  value={draftBettingSettings.stakeRoundingIncrement}
                  disabled={isBettingPending}
                  aria-invalid={Boolean(
                    bettingFieldErrors.stakeRoundingIncrement,
                  )}
                  onChange={(event) =>
                    handleBettingSettingsChange(
                      'stakeRoundingIncrement',
                      event.target.value,
                    )
                  }
                >
                  {stakeRoundingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {bettingFieldErrors.stakeRoundingIncrement ? (
                  <small className="field-error">
                    {bettingFieldErrors.stakeRoundingIncrement}
                  </small>
                ) : (
                  <small>
                    Future stake amounts use the bankroll currency:{' '}
                    {bankrollCurrency}.
                  </small>
                )}
              </label>

              <label
                className="field settings-betting-field"
                htmlFor="betting-setting-bankroll-basis"
              >
                <span>Bankroll Basis</span>
                <select
                  id="betting-setting-bankroll-basis"
                  value={draftBettingSettings.bankrollBasis}
                  disabled={isBettingPending}
                  aria-invalid={Boolean(bettingFieldErrors.bankrollBasis)}
                  onChange={(event) =>
                    handleBettingSettingsChange(
                      'bankrollBasis',
                      event.target.value,
                    )
                  }
                >
                  {BANKROLL_BASIS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {bettingFieldErrors.bankrollBasis ? (
                  <small className="field-error">
                    {bettingFieldErrors.bankrollBasis}
                  </small>
                ) : (
                  <small>
                    Available bankroll excludes pending stakes. Current bankroll
                    includes them.
                  </small>
                )}
              </label>
            </div>

            <div className="settings-bankroll-status">
              <div>
                <WalletCards aria-hidden="true" size={18} strokeWidth={2} />
                <span>Bankroll currency</span>
                <strong>{bankrollCurrency}</strong>
              </div>
              <div>
                <WalletCards aria-hidden="true" size={18} strokeWidth={2} />
                <span>Bankroll status</span>
                <strong>
                  {bankrollStatus === 'loading'
                    ? 'Loading'
                    : isBankrollInitialized
                      ? 'Initialized'
                      : 'Not initialized'}
                </strong>
              </div>
              {isBankrollInitialized ? (
                <>
                  <div>
                    <WalletCards aria-hidden="true" size={18} strokeWidth={2} />
                    <span>Current bankroll</span>
                    <strong>
                      {formatBankrollCurrency(
                        bankrollSummary.currentBankroll,
                        bankrollCurrency,
                      )}
                    </strong>
                  </div>
                  <div>
                    <WalletCards aria-hidden="true" size={18} strokeWidth={2} />
                    <span>Available bankroll</span>
                    <strong>
                      {formatBankrollCurrency(
                        bankrollSummary.availableBankroll,
                        bankrollCurrency,
                      )}
                    </strong>
                  </div>
                </>
              ) : null}
            </div>

            {bankrollStatus === 'error' ? (
              <p className="form-status warning" role="status">
                Bankroll status could not be loaded: {bankrollError}. Stake
                rounding labels use {BANKROLL_DEFAULT_CURRENCY}.
              </p>
            ) : null}

            <p className="settings-betting-preview">
              Current rounding display:{' '}
              {formatStakeRoundingLabel(
                Number(draftBettingSettings.stakeRoundingIncrement),
                bankrollCurrency,
              )}
            </p>

            {bettingMessage ? (
              <p className={`form-status ${bettingSaveStatus}`} role="status">
                {bettingMessage}
              </p>
            ) : null}

            <div className="settings-form-actions">
              <button
                className="save-ratings-button"
                type="submit"
                disabled={isBettingPending || !hasUnsavedBettingChanges}
              >
                {bettingSaveStatus === 'saving' ? (
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
                  {bettingSaveStatus === 'saving'
                    ? 'Saving...'
                    : hasUnsavedBettingChanges
                      ? 'Save Betting Settings'
                      : 'Saved'}
                </span>
              </button>

              <button
                className="reset-button"
                type="button"
                disabled={isBettingPending}
                onClick={handleResetBettingSettings}
              >
                {bettingResetStatus === 'saving' ? (
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
                  {bettingResetStatus === 'saving'
                    ? 'Resetting...'
                    : 'Reset to Defaults'}
                </span>
              </button>
            </div>
          </form>
        ) : null}
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
