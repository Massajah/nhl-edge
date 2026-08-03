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
  fetchBookmakerPreferences,
  fetchMarketOddsStatus,
  updateBookmakerPreferences,
} from '../services/marketOddsApi.js'
import { getMarketOddsStatusLabel } from '../utils/marketOdds.js'
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
  getQuickRematchSettings,
  resetQuickRematchSettings,
  updateQuickRematchSettings,
} from '../services/quickRematchSettingsApi.js'
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
  DEFAULT_QUICK_REMATCH_SETTINGS,
  SCHEDULE_ADJUSTMENT_SETTING_KEYS,
  createQuickRematchSettingsDraft,
  normalizeQuickRematchSettings,
  parseQuickRematchSettingsDraft,
} from '../utils/quickRematchSettings.js'
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

const RATING_ENGINE_MODEL_FIELD_KEYS = Object.freeze([
  'homeAdvantage',
  'kFactor',
  'regulationMultiplier',
  'overtimeMultiplier',
  'shootoutMultiplier',
])

const RATING_ENGINE_UPDATE_FIELDS = Object.freeze(
  RATING_ENGINE_SETTING_FIELDS.filter((field) => field.key !== 'homeAdvantage'),
)

const HOME_ADVANTAGE_FIELD = RATING_ENGINE_SETTING_FIELDS.find(
  (field) => field.key === 'homeAdvantage',
)

const REST_FATIGUE_RULES = Object.freeze([
  {
    adjustmentKey: 'wellRestedAdjustment',
    enabledKey: 'wellRestedEnabled',
    helper: 'Two or more rest days before the current game.',
    label: 'Well Rested',
  },
  {
    adjustmentKey: 'threeInFourAdjustment',
    enabledKey: 'threeInFourEnabled',
    helper: 'Third game inside the active four-day schedule window.',
    label: '3 Games in 4 Days',
  },
  {
    adjustmentKey: 'backToBackAdjustment',
    enabledKey: 'backToBackEnabled',
    helper:
      'Consecutive-day games where both games are home games, or both games are away against the same home team.',
    label: 'Back-to-Back',
  },
  {
    adjustmentKey: 'backToBackTravelAdjustment',
    enabledKey: 'backToBackTravelEnabled',
    helper:
      'All other known consecutive-day transitions, including home to away, away to home, and away to away against different home teams.',
    label: 'Back-to-Back + Travel',
  },
])

// Current complete set of global automatic model point adjustments exposed here.
const GLOBAL_AUTOMATIC_MODEL_ADJUSTMENTS = Object.freeze([
  'Base Home Advantage',
  'Well Rested',
  '3 Games in 4 Days',
  'Back-to-Back',
  'Back-to-Back + Travel',
  'Quick Rematch',
])

const formatSignedValue = (value) => {
  const numberValue = Number(
    typeof value === 'string' ? value.trim().replace(',', '.') : value,
  )

  if (!Number.isFinite(numberValue)) {
    return ''
  }

  return `${numberValue >= 0 ? '+' : ''}${numberValue.toFixed(2)}`
}

function Settings({
  initialBookmakerPreferences = null,
  initialMarketOddsStatus = null,
  onRatingEngineSettingsChanged,
}) {
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
  const [quickRematchStatus, setQuickRematchStatus] = useState('loading')
  const [quickRematchSaveStatus, setQuickRematchSaveStatus] =
    useState('idle')
  const [quickRematchResetStatus, setQuickRematchResetStatus] =
    useState('idle')
  const [quickRematchError, setQuickRematchError] = useState('')
  const [quickRematchMessage, setQuickRematchMessage] = useState('')
  const [quickRematchFieldErrors, setQuickRematchFieldErrors] = useState({})
  const [quickRematchUsingDefaults, setQuickRematchUsingDefaults] =
    useState(true)
  const [savedQuickRematchSettings, setSavedQuickRematchSettings] = useState(
    () => normalizeQuickRematchSettings(DEFAULT_QUICK_REMATCH_SETTINGS),
  )
  const [draftQuickRematchSettings, setDraftQuickRematchSettings] = useState(
    () => createQuickRematchSettingsDraft(DEFAULT_QUICK_REMATCH_SETTINGS),
  )
  const [bankrollSummary, setBankrollSummary] = useState(null)
  const [bankrollStatus, setBankrollStatus] = useState('loading')
  const [bankrollError, setBankrollError] = useState('')
  const [marketDataStatus, setMarketDataStatus] = useState(
    initialMarketOddsStatus ? 'success' : 'loading',
  )
  const [marketData, setMarketData] = useState(
    initialMarketOddsStatus ?? {
      configuration: {
        cacheTtlMs: 10 * 60 * 1000,
        configured: null,
        market: 'Moneyline',
        provider: 'The Odds API',
        region: 'EU',
        sport: 'NHL',
      },
      lastSuccessfulFetch: null,
      quota: null,
      status: 'unavailable',
    },
  )
  const [bookmakerPreferencesStatus, setBookmakerPreferencesStatus] = useState(
    initialBookmakerPreferences ? 'success' : 'loading',
  )
  const [bookmakerPreferences, setBookmakerPreferences] = useState(
    initialBookmakerPreferences ?? {
      availableBookmakers: [],
      disabledBookmakerKeys: [],
      enabledBookmakerKeys: [],
      fallbackApplied: false,
      warning: null,
    },
  )
  const [draftEnabledBookmakerKeys, setDraftEnabledBookmakerKeys] = useState(
    initialBookmakerPreferences?.enabledBookmakerKeys ?? [],
  )
  const [bookmakerPreferencesMessage, setBookmakerPreferencesMessage] =
    useState(initialBookmakerPreferences?.warning ?? '')

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

    fetchBookmakerPreferences()
      .then(({ preferences }) => {
        if (isCurrent) {
          setBookmakerPreferences(preferences)
          setDraftEnabledBookmakerKeys(preferences.enabledBookmakerKeys)
          setBookmakerPreferencesStatus('success')
          setBookmakerPreferencesMessage(preferences.warning ?? '')
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setBookmakerPreferencesStatus('error')
          setBookmakerPreferencesMessage(error.message)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    fetchMarketOddsStatus()
      .then((result) => {
        if (isCurrent) {
          setMarketData(result)
          setMarketDataStatus('success')
        }
      })
      .catch(() => {
        if (isCurrent) {
          setMarketDataStatus('error')
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadQuickRematchSettings = async () => {
      setQuickRematchStatus('loading')
      setQuickRematchError('')

      try {
        const result = await getQuickRematchSettings()

        if (!isCurrent) {
          return
        }

        const nextSettings = normalizeQuickRematchSettings(result.settings)

        setSavedQuickRematchSettings(nextSettings)
        setDraftQuickRematchSettings(
          createQuickRematchSettingsDraft(nextSettings),
        )
        setQuickRematchUsingDefaults(Boolean(result.usingDefaults))
        setQuickRematchStatus('success')
      } catch (error) {
        if (!isCurrent) {
          return
        }

        setQuickRematchStatus('error')
        setQuickRematchError(error.message)
      }
    }

    loadQuickRematchSettings()

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

  const handleBookmakerPreferenceChange = (bookmakerKey, enabled) => {
    setDraftEnabledBookmakerKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)

      if (enabled) {
        nextKeys.add(bookmakerKey)
      } else {
        nextKeys.delete(bookmakerKey)
      }

      return [...nextKeys]
    })
    setBookmakerPreferencesMessage('')
  }

  const handleSaveBookmakerPreferences = async (event) => {
    event.preventDefault()
    setBookmakerPreferencesStatus('saving')
    setBookmakerPreferencesMessage('')

    try {
      const { preferences } = await updateBookmakerPreferences(
        draftEnabledBookmakerKeys,
      )

      setBookmakerPreferences(preferences)
      setDraftEnabledBookmakerKeys(preferences.enabledBookmakerKeys)
      setBookmakerPreferencesStatus('success')
      setBookmakerPreferencesMessage(
        preferences.warning || 'Preferred bookmakers saved.',
      )
    } catch (error) {
      setBookmakerPreferencesStatus('error')
      setBookmakerPreferencesMessage(error.message)
    }
  }
  const parsedBettingDraft = useMemo(
    () => parseBettingSettingsDraft(draftBettingSettings),
    [draftBettingSettings],
  )
  const parsedQuickRematchDraft = useMemo(
    () => parseQuickRematchSettingsDraft(draftQuickRematchSettings),
    [draftQuickRematchSettings],
  )
  const hasUnsavedChanges = useMemo(() => {
    if (!parsedDraft.isValid) {
      return true
    }

    return RATING_ENGINE_MODEL_FIELD_KEYS.some(
      (field) => parsedDraft.settings[field] !== savedSettings[field],
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
  const hasUnsavedQuickRematchChanges = useMemo(
    () => {
      if (!parsedQuickRematchDraft.isValid) {
        return true
      }

      return SCHEDULE_ADJUSTMENT_SETTING_KEYS.some(
        (field) =>
          parsedQuickRematchDraft[field] !== savedQuickRematchSettings[field],
      )
    },
    [parsedQuickRematchDraft, savedQuickRematchSettings],
  )
  const isPending =
    settingsStatus === 'loading' ||
    saveStatus === 'saving' ||
    resetStatus === 'saving'
  const isBettingPending =
    bettingStatus === 'loading' ||
    bettingSaveStatus === 'saving' ||
    bettingResetStatus === 'saving'
  const isQuickRematchPending =
    quickRematchStatus === 'loading' ||
    quickRematchSaveStatus === 'saving' ||
    quickRematchResetStatus === 'saving'
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

  const handleQuickRematchSettingsChange = (field, value) => {
    setDraftQuickRematchSettings((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }))
    setQuickRematchFieldErrors((currentErrors) => ({
      ...currentErrors,
      [field]: '',
    }))
    setQuickRematchSaveStatus('idle')
    setQuickRematchMessage('')
    setQuickRematchError('')
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

  const handleSaveQuickRematchSettings = async (event) => {
    event.preventDefault()

    if (isQuickRematchPending) {
      return
    }

    if (!parsedQuickRematchDraft.isValid) {
      setQuickRematchFieldErrors(parsedQuickRematchDraft.fieldErrors)
      setQuickRematchSaveStatus('error')
      setQuickRematchMessage('Fix invalid model adjustments before saving.')
      return
    }

    if (!hasUnsavedQuickRematchChanges) {
      return
    }

    setQuickRematchSaveStatus('saving')
    setQuickRematchMessage('')
    setQuickRematchError('')
    setQuickRematchFieldErrors({})

    try {
      const result = await updateQuickRematchSettings(
        parsedQuickRematchDraft.settings,
      )
      const nextSettings = normalizeQuickRematchSettings(result.settings)

      setSavedQuickRematchSettings(nextSettings)
      setDraftQuickRematchSettings(
        createQuickRematchSettingsDraft(nextSettings),
      )
      setQuickRematchUsingDefaults(false)
      setQuickRematchSaveStatus('success')
      setQuickRematchMessage('Model adjustments saved.')
    } catch (error) {
      setQuickRematchFieldErrors(formatApiFieldErrors(error.details))
      setQuickRematchSaveStatus('error')
      setQuickRematchMessage(error.message)
    }
  }

  const handleResetQuickRematchSettings = async () => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm('Reset Model Adjustments to defaults?')

    if (!confirmed || isQuickRematchPending) {
      return
    }

    setQuickRematchResetStatus('saving')
    setQuickRematchSaveStatus('idle')
    setQuickRematchMessage('')
    setQuickRematchError('')
    setQuickRematchFieldErrors({})

    try {
      const result = await resetQuickRematchSettings()
      const nextSettings = normalizeQuickRematchSettings(result.settings)

      setSavedQuickRematchSettings(nextSettings)
      setDraftQuickRematchSettings(
        createQuickRematchSettingsDraft(nextSettings),
      )
      setQuickRematchUsingDefaults(Boolean(result.usingDefaults))
      setQuickRematchResetStatus('success')
      setQuickRematchSaveStatus('success')
      setQuickRematchMessage('Model adjustments reset to defaults.')
    } catch (error) {
      setQuickRematchResetStatus('idle')
      setQuickRematchSaveStatus('error')
      setQuickRematchMessage(error.message)
    }
  }

  const ratingEngineFormId = 'settings-rating-engine-form'
  const engineDisplayErrors = {
    ...parsedDraft.fieldErrors,
    ...fieldErrors,
  }
  const modelAdjustmentDisplayErrors = {
    ...parsedQuickRematchDraft.fieldErrors,
    ...quickRematchFieldErrors,
  }
  const showRatingEngineForm = settingsStatus !== 'error'
  const showModelAdjustmentForm = quickRematchStatus !== 'error'

  const renderRatingEngineField = (
    field,
    {
      className = 'field settings-engine-field',
      describedBy,
      formId = ratingEngineFormId,
      helper,
    } = {},
  ) => {
    const errorMessage = engineDisplayErrors[field.key]
    const helperId = helper ? `engine-setting-${field.key}-helper` : undefined
    const errorId = errorMessage ? `engine-setting-${field.key}-error` : undefined

    return (
      <label
        className={className}
        htmlFor={`engine-setting-${field.key}`}
        key={field.key}
      >
        <span>{field.label}</span>
        <input
          id={`engine-setting-${field.key}`}
          form={formId}
          type="text"
          min={field.min}
          max={field.max}
          step={field.step}
          value={draftSettings[field.key] ?? ''}
          inputMode="decimal"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={[describedBy, helperId, errorId]
            .filter(Boolean)
            .join(' ') || undefined}
          disabled={isPending}
          onChange={(event) =>
            handleSettingsChange(field.key, event.target.value)
          }
        />
        {helper ? <small id={helperId}>{helper}</small> : null}
        <small
          className={errorMessage ? 'field-error' : 'field-error-placeholder'}
          id={errorId}
        >
          {errorMessage || ' '}
        </small>
      </label>
    )
  }

  const renderScheduleAdjustmentInput = ({
    adjustmentKey,
    disabled,
    inputId,
    label,
    max,
    min,
    visibleLabel = false,
  }) => {
    const errorMessage = modelAdjustmentDisplayErrors[adjustmentKey]

    return (
      <label className="settings-adjustment-input" htmlFor={inputId}>
        <span className={visibleLabel ? 'settings-adjustment-label' : 'sr-only'}>
          {label}
        </span>
        <input
          id={inputId}
          type="text"
          min={min}
          max={max}
          step="0.05"
          value={draftQuickRematchSettings[adjustmentKey]}
          inputMode="decimal"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={`${inputId}-status`}
          disabled={disabled}
          onChange={(event) =>
            handleQuickRematchSettingsChange(adjustmentKey, event.target.value)
          }
        />
        <small
          className={errorMessage ? 'field-error' : 'field-error-placeholder'}
          id={`${inputId}-status`}
        >
          {errorMessage || formatSignedValue(draftQuickRematchSettings[adjustmentKey])}
        </small>
      </label>
    )
  }

  return (
    <section className="settings-page" aria-label="Settings">
      <header className="settings-page-header">
        <p className="eyebrow">Settings</p>
        <h1>Settings</h1>
        <p>
          Manage account details, staking rules, automatic model adjustments,
          and rating-engine behavior.
        </p>
      </header>

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

      <div className="settings-panel settings-market-data-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">External data</p>
            <h2>Market Odds</h2>
          </div>
          <span>Market data</span>
        </div>

        <dl className="market-data-status-grid">
          <div><dt>Provider</dt><dd>{marketData.configuration.provider}</dd></div>
          <div>
            <dt>Configuration</dt>
            <dd>
              {marketData.configuration.configured === null
                ? 'Checking'
                : marketData.configuration.configured
                  ? 'Connected'
                  : 'Not configured'}
            </dd>
          </div>
          <div><dt>Sport</dt><dd>{marketData.configuration.sport}</dd></div>
          <div><dt>Region</dt><dd>{marketData.configuration.region}</dd></div>
          <div><dt>Market</dt><dd>{marketData.configuration.market}</dd></div>
          <div>
            <dt>Cache TTL</dt>
            <dd>{Math.round(marketData.configuration.cacheTtlMs / 60000)} min</dd>
          </div>
          <div><dt>Credits Remaining</dt><dd>{marketData.quota?.remaining ?? '--'}</dd></div>
          <div><dt>Credits Used</dt><dd>{marketData.quota?.used ?? '--'}</dd></div>
          <div><dt>Last Request Cost</dt><dd>{marketData.quota?.lastCost ?? '--'}</dd></div>
          <div>
            <dt>Last Successful Fetch</dt>
            <dd>
              {marketData.lastSuccessfulFetch
                ? new Date(marketData.lastSuccessfulFetch).toLocaleString()
                : 'Not yet'}
            </dd>
          </div>
          <div>
            <dt>Current Status</dt>
            <dd>{getMarketOddsStatusLabel(marketData.status, marketDataStatus)}</dd>
          </div>
        </dl>

        <form
          className="preferred-bookmakers-section"
          onSubmit={handleSaveBookmakerPreferences}
        >
          <div>
            <p className="eyebrow">External Data</p>
            <h3>Preferred Bookmakers</h3>
            <p>
              Only enabled bookmakers can supply best available odds to the
              Dashboard, Analyzer, EV, Kelly, and saved bets.
            </p>
          </div>

          {bookmakerPreferencesStatus === 'loading' ? (
            <p role="status">Loading...</p>
          ) : null}

          {bookmakerPreferences.availableBookmakers.length === 0 &&
          bookmakerPreferencesStatus !== 'loading' ? (
            <p className="empty-state">
              Bookmakers will appear after market odds have been loaded.
            </p>
          ) : (
            <div className="preferred-bookmaker-list">
              {bookmakerPreferences.availableBookmakers.map((bookmaker) => (
                <label key={bookmaker.bookmakerKey}>
                  <input
                    checked={draftEnabledBookmakerKeys.includes(
                      bookmaker.bookmakerKey,
                    )}
                    disabled={bookmakerPreferencesStatus === 'saving'}
                    type="checkbox"
                    onChange={(event) =>
                      handleBookmakerPreferenceChange(
                        bookmaker.bookmakerKey,
                        event.target.checked,
                      )
                    }
                  />
                  <span>{bookmaker.bookmakerTitle}</span>
                </label>
              ))}
            </div>
          )}

          {bookmakerPreferencesMessage ? (
            <p
              className={`form-status ${
                bookmakerPreferences.fallbackApplied ||
                bookmakerPreferencesStatus === 'error'
                  ? 'error'
                  : 'success'
              }`}
              role={
                bookmakerPreferences.fallbackApplied ||
                bookmakerPreferencesStatus === 'error'
                  ? 'alert'
                  : 'status'
              }
            >
              {bookmakerPreferencesMessage}
            </p>
          ) : null}

          {bookmakerPreferences.availableBookmakers.length > 0 ? (
            <button
              className="save-ratings-button"
              disabled={bookmakerPreferencesStatus === 'saving'}
              type="submit"
            >
              <Save aria-hidden="true" size={17} strokeWidth={2.2} />
              <span>
                {bookmakerPreferencesStatus === 'saving'
                  ? 'Saving...'
                  : 'Save Preferred Bookmakers'}
              </span>
            </button>
          ) : null}
        </form>
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
            <div className="settings-subsection-heading">
              <h3>Kelly &amp; Stake Rules</h3>
              <p>Global stake recommendation limits and Kelly sizing.</p>
            </div>

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

            <div className="settings-subsection-heading">
              <h3>Bankroll Reference</h3>
              <p>Choose which bankroll balance future stake sizing references.</p>
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
              <span className="settings-dirty-state">
                {hasUnsavedBettingChanges
                  ? 'Unsaved betting changes'
                  : 'No betting changes'}
              </span>
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
                    : 'Save Betting Settings'}
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

      <div
        className="settings-panel settings-model-adjustments-panel"
        aria-labelledby="settings-model-adjustments-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Model Configuration</p>
            <h2 id="settings-model-adjustments-heading">Model Adjustments</h2>
          </div>
          <span>
            {quickRematchUsingDefaults ? 'Defaults active' : 'Custom settings'}
          </span>
        </div>

        <div className="settings-info-note">
          <Gauge aria-hidden="true" size={20} strokeWidth={2} />
          <p>
            Configure global automatic rating adjustments used by Dashboard and
            Game Analyzer. Team-specific and game-specific values are maintained
            elsewhere.
          </p>
        </div>

        <div className="settings-adjustment-catalog" aria-label="Global automatic model point adjustments">
          {GLOBAL_AUTOMATIC_MODEL_ADJUSTMENTS.map((adjustment) => (
            <span key={adjustment}>{adjustment}</span>
          ))}
        </div>

        {settingsStatus === 'loading' ? (
          <div className="settings-loading-state" role="status">
            <LoaderCircle
              className="button-spinner"
              aria-hidden="true"
              size={18}
              strokeWidth={2.2}
            />
            <span>Loading home advantage settings...</span>
          </div>
        ) : null}

        {quickRematchStatus === 'loading' ? (
          <div className="settings-loading-state" role="status">
            <LoaderCircle
              className="button-spinner"
              aria-hidden="true"
              size={18}
              strokeWidth={2.2}
            />
            <span>Loading model adjustment settings...</span>
          </div>
        ) : null}

        {settingsStatus === 'error' ? (
          <p className="form-status error" role="alert">
            {settingsError}
          </p>
        ) : null}

        {quickRematchStatus === 'error' ? (
          <p className="form-status error" role="alert">
            {quickRematchError}
          </p>
        ) : null}

        <div className="settings-model-grid">
          <article className="settings-rule-card settings-home-advantage-card">
            <div className="settings-rule-card-heading">
              <div>
                <h3>Home Advantage</h3>
                <p>Global base points before team-specific adjustment.</p>
              </div>
              <span>Rating Engine setting</span>
            </div>

            {HOME_ADVANTAGE_FIELD && showRatingEngineForm ? (
              renderRatingEngineField(HOME_ADVANTAGE_FIELD, {
                className: 'field settings-compact-number-field',
                helper:
                  'Added to the home team before team-specific Home Adjustment is applied.',
              })
            ) : null}

            <div className="settings-formula-note">
              <strong>Effective home advantage =</strong>
              <span>Base Home Advantage + Team Home Adjustment</span>
            </div>
            <p className="settings-card-note">
              Base Home Advantage is global. Team Home Adjustment remains on the
              Power Ratings page and is intentionally absent from Settings.
            </p>
            <p className="settings-card-save-note">
              Save ownership: use Save Rating Engine in the Power Rating Engine
              section.
            </p>
          </article>

          {showModelAdjustmentForm ? (
          <form
            className="settings-model-adjustments-form"
            noValidate
            onSubmit={handleSaveQuickRematchSettings}
          >
            <article className="settings-rule-card settings-rest-fatigue-card">
              <div className="settings-rule-card-heading">
                <div>
                  <h3>Rest &amp; Fatigue</h3>
                  <p>Zero or one rest/fatigue rule is applied.</p>
                </div>
                <span>Exclusive</span>
              </div>

              <label className="toggle-field settings-master-toggle">
                <input
                  type="checkbox"
                  checked={draftQuickRematchSettings.restFatigueEnabled}
                  disabled={isQuickRematchPending}
                  onChange={(event) =>
                    handleQuickRematchSettingsChange(
                      'restFatigueEnabled',
                      event.target.checked,
                    )
                  }
                />
                <span>Enable Rest &amp; Fatigue Adjustments</span>
              </label>

              <div className="settings-rule-table" role="table" aria-label="Rest and fatigue rules">
                <div className="settings-rule-table-header" role="row">
                  <span role="columnheader">Rule</span>
                  <span role="columnheader">Enabled</span>
                  <span role="columnheader">Rating adjustment</span>
                </div>

                {REST_FATIGUE_RULES.map((rule) => {
                  const ruleEnabled = Boolean(
                    draftQuickRematchSettings[rule.enabledKey],
                  )
                  const disabled =
                    isQuickRematchPending ||
                    !draftQuickRematchSettings.restFatigueEnabled ||
                    !ruleEnabled
                  const inputId = `model-adjustment-${rule.adjustmentKey}`

                  return (
                    <div className="settings-rule-row" role="row" key={rule.adjustmentKey}>
                      <div className="settings-rule-label" role="cell">
                        <strong>{rule.label}</strong>
                        <small>{rule.helper}</small>
                      </div>
                      <label className="toggle-field settings-rule-toggle" role="cell">
                        <input
                          type="checkbox"
                          checked={ruleEnabled}
                          disabled={
                            isQuickRematchPending ||
                            !draftQuickRematchSettings.restFatigueEnabled
                          }
                          onChange={(event) =>
                            handleQuickRematchSettingsChange(
                              rule.enabledKey,
                              event.target.checked,
                            )
                          }
                        />
                        <span>Enabled</span>
                      </label>
                      <div role="cell">
                        {renderScheduleAdjustmentInput({
                          adjustmentKey: rule.adjustmentKey,
                          disabled,
                          inputId,
                          label: `${rule.label} Rating Adjustment`,
                          max:
                            rule.adjustmentKey === 'wellRestedAdjustment'
                              ? 1
                              : 0,
                          min:
                            rule.adjustmentKey === 'wellRestedAdjustment'
                              ? 0
                              : -3,
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="settings-priority-note">
                <strong>Priority</strong>
                <span>
                  Back-to-Back + Travel &gt; Back-to-Back &gt; 3 Games in 4 Days &gt; Well Rested
                </span>
              </div>

              <details className="settings-compact-details">
                <summary>Back-to-Back meanings</summary>
                <p>
                  Back-to-Back: Consecutive-day games where both games are home
                  games, or both games are away against the same home team.
                </p>
                <p>
                  Back-to-Back + Travel: All other known consecutive-day
                  transitions, including home to away, away to home, and away
                  to away against different home teams.
                </p>
              </details>
            </article>

            <article className="settings-rule-card settings-quick-rematch-card">
              <div className="settings-rule-card-heading">
                <div>
                  <h3>Quick Rematch</h3>
                  <p>Independent and additive to the selected rest/fatigue rule.</p>
                </div>
                <span>Additive</span>
              </div>

              <div className="settings-quick-fields">
                <label className="toggle-field settings-master-toggle">
                  <input
                    type="checkbox"
                    checked={draftQuickRematchSettings.quickRematchEnabled}
                    disabled={isQuickRematchPending}
                    onChange={(event) =>
                      handleQuickRematchSettingsChange(
                        'quickRematchEnabled',
                        event.target.checked,
                      )
                    }
                  />
                  <span>Enable Quick Rematch</span>
                </label>

                <label
                  className="field settings-compact-number-field"
                  htmlFor="quick-rematch-maximum-days"
                >
                  <span>Maximum Days</span>
                  <input
                    id="quick-rematch-maximum-days"
                    type="text"
                    min="1"
                    max="14"
                    step="1"
                    value={draftQuickRematchSettings.quickRematchMaximumDays}
                    inputMode="numeric"
                    aria-invalid={Boolean(
                      modelAdjustmentDisplayErrors.quickRematchMaximumDays,
                    )}
                    aria-describedby="quick-rematch-maximum-days-status"
                    disabled={
                      isQuickRematchPending ||
                      !draftQuickRematchSettings.quickRematchEnabled
                    }
                    onChange={(event) =>
                      handleQuickRematchSettingsChange(
                        'quickRematchMaximumDays',
                        event.target.value,
                      )
                    }
                  />
                  <small
                    className={
                      modelAdjustmentDisplayErrors.quickRematchMaximumDays
                        ? 'field-error'
                        : 'field-error-placeholder'
                    }
                    id="quick-rematch-maximum-days-status"
                  >
                    {modelAdjustmentDisplayErrors.quickRematchMaximumDays ||
                      '1 to 14 days'}
                  </small>
                </label>

                {renderScheduleAdjustmentInput({
                  adjustmentKey: 'quickRematchLoserAdjustment',
                  disabled:
                    isQuickRematchPending ||
                    !draftQuickRematchSettings.quickRematchEnabled,
                  inputId: 'quick-rematch-loser-adjustment',
                  label: 'Previous Loser Adjustment',
                  max: 1,
                  min: 0,
                  visibleLabel: true,
                })}
              </div>

              <p className="settings-card-note">
                Applies a rating bonus to the loser of the previous
                head-to-head meeting when the teams meet again within the
                configured time window.
              </p>
              <p className="settings-card-note">
                Regulation, overtime, and shootout losses are treated equally.
              </p>

              <div className="settings-context-example" aria-label="Context adjustment example">
                <span>Back-to-Back + Travel</span>
                <strong>-1.25</strong>
                <span>Quick Rematch</span>
                <strong>+0.25</strong>
                <span>Total context adjustment</span>
                <strong>-1.00</strong>
              </div>
            </article>

            {quickRematchMessage ? (
              <p
                className={`form-status ${quickRematchSaveStatus}`}
                role="status"
              >
                {quickRematchMessage}
              </p>
            ) : null}

            <div className="settings-form-actions">
              <span className="settings-dirty-state">
                {hasUnsavedQuickRematchChanges
                  ? 'Unsaved model-adjustment changes'
                  : 'No model-adjustment changes'}
              </span>
              <button
                className="save-ratings-button"
                type="submit"
                disabled={
                  isQuickRematchPending || !hasUnsavedQuickRematchChanges
                }
              >
                {quickRematchSaveStatus === 'saving' ? (
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
                  {quickRematchSaveStatus === 'saving'
                    ? 'Saving...'
                    : 'Save Model Adjustments'}
                </span>
              </button>

              <button
                className="reset-button"
                type="button"
                disabled={isQuickRematchPending}
                onClick={handleResetQuickRematchSettings}
              >
                {quickRematchResetStatus === 'saving' ? (
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
                  {quickRematchResetStatus === 'saving'
                    ? 'Resetting...'
                    : 'Reset to Defaults'}
                </span>
              </button>
            </div>
          </form>
          ) : null}
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
            your Power Ratings. Changes affect future rating updates only.
            Previously processed games are not recalculated. Rating Lab remains
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

        {showRatingEngineForm ? (
          <form
            className="settings-engine-form"
            id={ratingEngineFormId}
            noValidate
            onSubmit={handleSaveSettings}
          >
            <div className="settings-engine-sections">
              <section className="settings-engine-subsection" aria-labelledby="rating-update-sensitivity-heading">
                <div className="settings-rule-card-heading">
                  <div>
                    <h3 id="rating-update-sensitivity-heading">Rating Update Sensitivity</h3>
                    <p>K Factor controls how strongly each completed game changes Power Ratings.</p>
                  </div>
                </div>
                <div className="settings-engine-grid">
                  {RATING_ENGINE_UPDATE_FIELDS.filter(
                    (field) => field.key === 'kFactor',
                  ).map((field) =>
                    renderRatingEngineField(field, {
                      helper:
                        'Higher values make ratings react faster to each game.',
                    }),
                  )}
                </div>
              </section>

              <section className="settings-engine-subsection" aria-labelledby="result-weighting-heading">
                <div className="settings-rule-card-heading">
                  <div>
                    <h3 id="result-weighting-heading">Result Multipliers</h3>
                    <p>
                      Result multipliers reduce or preserve rating movement
                      based on how the game was decided.
                    </p>
                  </div>
                </div>
                <div className="settings-engine-grid">
                  {RATING_ENGINE_UPDATE_FIELDS.filter(
                    (field) => field.key !== 'kFactor',
                  ).map((field) => renderRatingEngineField(field))}
                </div>
              </section>
            </div>

            {settingsMessage ? (
              <p className={`form-status ${saveStatus}`} role="status">
                {settingsMessage}
              </p>
            ) : null}

            <div className="settings-form-actions">
              <span className="settings-dirty-state">
                {hasUnsavedChanges
                  ? 'Unsaved rating-engine changes'
                  : 'No rating-engine changes'}
              </span>
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
                    : 'Save Rating Engine'}
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
