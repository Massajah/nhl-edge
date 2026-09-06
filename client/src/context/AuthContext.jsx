import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  fetchCurrentUser,
  loginUser,
  loginWithGoogle,
  logoutUser,
  registerUser,
} from '../services/authApi.js'
import { subscribeToUnauthorized } from '../services/apiClient.js'

const AuthContext = createContext(null)

const getAuthMessage = (error, fallbackMessage) => {
  if (!error) return fallbackMessage
  if (error.status === 0) return 'Network error. Check your connection and try again.'
  return error.message || fallbackMessage
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionMessage, setSessionMessage] = useState('')

  const clearSession = useCallback(({ message = '' } = {}) => {
    setUser(null)
    setSessionMessage(message)
  }, [])

  const applyAuthResult = useCallback(
    async (result) => {
      if (!result?.user) throw new Error('Authentication response was incomplete.')

      try {
        const currentUser = await fetchCurrentUser()
        setUser(currentUser ?? result.user)
        setSessionMessage('')
        return currentUser ?? result.user
      } catch (error) {
        clearSession()
        throw error
      }
    },
    [clearSession],
  )

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await fetchCurrentUser()
      setUser(currentUser)
      setSessionMessage('')
      return currentUser
    } catch (error) {
      clearSession({
        message:
          error.status === 401
            ? ''
            : getAuthMessage(error, 'Unable to restore your session.'),
      })
      return null
    }
  }, [clearSession])

  useEffect(() => {
    let isCurrent = true

    const restoreSession = async () => {
      setLoading(true)
      await refreshUser()
      if (isCurrent) setLoading(false)
    }

    restoreSession()
    return () => {
      isCurrent = false
    }
  }, [refreshUser])

  useEffect(
    () =>
      subscribeToUnauthorized(() => {
        clearSession({ message: 'Session expired. Please sign in again.' })
      }),
    [clearSession],
  )

  const login = useCallback(
    async (credentials) => {
      try {
        return applyAuthResult(await loginUser(credentials))
      } catch (error) {
        throw new Error(getAuthMessage(error, 'Unable to sign in.'), {
          cause: error,
        })
      }
    },
    [applyAuthResult],
  )

  const register = useCallback(
    async (values) => {
      try {
        return applyAuthResult(await registerUser(values))
      } catch (error) {
        throw new Error(getAuthMessage(error, 'Unable to create your account.'), {
          cause: error,
        })
      }
    },
    [applyAuthResult],
  )

  const googleLogin = useCallback(
    async (credential) => {
      try {
        return applyAuthResult(await loginWithGoogle(credential))
      } catch (error) {
        throw new Error(getAuthMessage(error, 'Unable to sign in with Google.'), {
          cause: error,
        })
      }
    },
    [applyAuthResult],
  )

  const logout = useCallback(async () => {
    try {
      await logoutUser()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      googleLogin,
      isAuthenticated: Boolean(user),
      loading,
      login,
      logout,
      refreshUser,
      register,
      sessionMessage,
      user,
    }),
    [
      googleLogin,
      loading,
      login,
      logout,
      refreshUser,
      register,
      sessionMessage,
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
