import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
let googleScriptPromise = null

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

const getInitialValues = () => ({
  email: '',
  name: '',
  password: '',
})

const loadGoogleScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google sign-in is unavailable.'))
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve()
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        `script[src="${GOOGLE_SCRIPT_SRC}"]`,
      )

      if (existingScript) {
        existingScript.addEventListener('load', resolve, { once: true })
        existingScript.addEventListener('error', reject, { once: true })
        return
      }

      const script = document.createElement('script')
      script.async = true
      script.defer = true
      script.src = GOOGLE_SCRIPT_SRC
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  return googleScriptPromise
}

function AuthPage({ mode, onModeChange, onSuccess }) {
  const isRegister = mode === 'register'
  const { googleLogin, login, register, sessionMessage } = useAuth()
  const [values, setValues] = useState(getInitialValues)
  const [errorMessage, setErrorMessage] = useState('')
  const [status, setStatus] = useState('idle')
  const [googleStatus, setGoogleStatus] = useState('idle')
  const isSubmitting = status === 'saving'
  const isGoogleSubmitting = googleStatus === 'saving'

  const validate = () => {
    if (isRegister && !values.name.trim()) {
      return 'Enter your name.'
    }

    if (!isValidEmail(values.email)) {
      return 'Enter a valid email address.'
    }

    if (!values.password) {
      return 'Enter your password.'
    }

    if (isRegister && values.password.length < 8) {
      return 'Password must be at least 8 characters.'
    }

    return ''
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const validationMessage = validate()

    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    setStatus('saving')
    setErrorMessage('')

    try {
      if (isRegister) {
        await register(values)
      } else {
        await login(values)
      }

      setStatus('success')
      onSuccess()
    } catch (error) {
      setStatus('error')
      setErrorMessage(error.message)
    }
  }

  const handleGoogleCredential = useCallback(
    async (credential) => {
      setGoogleStatus('saving')
      setErrorMessage('')

      try {
        await googleLogin(credential)
        setGoogleStatus('success')
        onSuccess()
      } catch (error) {
        setGoogleStatus('error')
        setErrorMessage(error.message)
      }
    },
    [googleLogin, onSuccess],
  )

  const handleValueChange = (field, value) => {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }))
    setErrorMessage('')
  }

  return (
    <main className="auth-page" aria-label={isRegister ? 'Register' : 'Login'}>
      <section className="auth-card">
        <div className="auth-brand">
          <span className="sidebar-brand-mark">NE</span>
          <div>
            <p className="eyebrow">NHL Edge</p>
            <h1>{isRegister ? 'Create account' : 'Sign in'}</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister ? (
            <label className="field auth-field" htmlFor="auth-name">
              <span>Name</span>
              <input
                id="auth-name"
                autoComplete="name"
                value={values.name}
                onChange={(event) => handleValueChange('name', event.target.value)}
              />
            </label>
          ) : null}

          <label className="field auth-field" htmlFor="auth-email">
            <span>Email</span>
            <input
              id="auth-email"
              autoComplete="email"
              inputMode="email"
              type="email"
              value={values.email}
              onChange={(event) => handleValueChange('email', event.target.value)}
            />
          </label>

          <label className="field auth-field" htmlFor="auth-password">
            <span>Password</span>
            <input
              id="auth-password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              type="password"
              value={values.password}
              onChange={(event) =>
                handleValueChange('password', event.target.value)
              }
            />
          </label>

          {errorMessage || sessionMessage ? (
            <p className="auth-error" role="alert">
              {errorMessage || sessionMessage}
            </p>
          ) : null}

          <button
            className="auth-primary-button"
            type="submit"
            disabled={isSubmitting || isGoogleSubmitting}
          >
            {isSubmitting ? (
              <LoaderCircle aria-hidden="true" className="button-spinner" />
            ) : (
              <ShieldCheck aria-hidden="true" size={18} strokeWidth={2.2} />
            )}
            {isRegister ? 'Create account' : 'Sign In'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <GoogleSignInButton
          disabled={isSubmitting || isGoogleSubmitting}
          mode={mode}
          status={googleStatus}
          onCredential={handleGoogleCredential}
        />

        <button
          className="auth-secondary-link"
          type="button"
          disabled={isSubmitting || isGoogleSubmitting}
          onClick={() => onModeChange(isRegister ? 'login' : 'register')}
        >
          {isRegister ? 'Already have an account?' : 'Create account'}
        </button>
      </section>
    </main>
  )
}

function GoogleSignInButton({ disabled, mode, onCredential, status }) {
  const containerRef = useRef(null)
  const [scriptStatus, setScriptStatus] = useState(
    GOOGLE_CLIENT_ID ? 'loading' : 'missing',
  )

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      return
    }

    let isCurrent = true

    loadGoogleScript()
      .then(() => {
        if (!isCurrent || !containerRef.current) {
          return
        }

        window.google.accounts.id.initialize({
          callback: (response) => {
            if (response?.credential) {
              onCredential(response.credential)
            }
          },
          client_id: GOOGLE_CLIENT_ID,
        })

        containerRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(containerRef.current, {
          shape: 'rectangular',
          size: 'large',
          text: mode === 'register' ? 'signup_with' : 'continue_with',
          theme: 'outline',
          width: containerRef.current.offsetWidth || 320,
        })

        setScriptStatus('ready')
      })
      .catch(() => {
        if (isCurrent) {
          setScriptStatus('error')
        }
      })

    return () => {
      isCurrent = false
    }
  }, [mode, onCredential])

  if (scriptStatus === 'missing') {
    return (
      <div className="google-auth-unavailable">
        <button className="auth-google-fallback" type="button" disabled>
          Continue with Google
        </button>
        <small>Google sign-in is not configured.</small>
      </div>
    )
  }

  if (scriptStatus === 'error') {
    return (
      <div className="google-auth-unavailable">
        <button className="auth-google-fallback" type="button" disabled>
          Continue with Google
        </button>
        <small>Google sign-in could not load.</small>
      </div>
    )
  }

  return (
    <div
      className={`google-auth-shell ${
        disabled || status === 'saving' ? 'disabled' : ''
      }`}
      aria-busy={status === 'saving'}
    >
      {status === 'saving' ? (
        <div className="google-auth-loading">
          <LoaderCircle aria-hidden="true" className="button-spinner" />
          Signing in with Google
        </div>
      ) : null}
      <div ref={containerRef} />
    </div>
  )
}

export default AuthPage
