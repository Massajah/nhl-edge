const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''
const AUTH_TOKEN_STORAGE_KEY = 'nhl-edge-auth-token'

let authToken = getStoredAuthToken()
const unauthorizedListeners = new Set()

export class ApiError extends Error {
  constructor(message, { details, status = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.details = details
    this.status = status
  }
}

export function getStoredAuthToken() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? ''
}

export function getAuthToken() {
  return authToken
}

export function setAuthToken(token) {
  authToken = typeof token === 'string' ? token : ''

  if (typeof window === 'undefined') {
    return
  }

  if (authToken) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  }
}

export function clearAuthToken() {
  setAuthToken('')
}

export function subscribeToUnauthorized(listener) {
  unauthorizedListeners.add(listener)

  return () => {
    unauthorizedListeners.delete(listener)
  }
}

const notifyUnauthorized = () => {
  unauthorizedListeners.forEach((listener) => listener())
}

const parseErrorBody = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

const getFriendlyMessage = ({ fallbackMessage, message, skipAuth, status }) => {
  if (message === 'Invalid email or password.') {
    return 'Incorrect email or password.'
  }

  if (message === 'Google authentication failed.') {
    return 'Google sign-in failed. Try again.'
  }

  if (message === 'Google authentication is not configured.') {
    return 'Google sign-in is not configured.'
  }

  if (
    message === 'A user with that email already exists.' ||
    message?.toLowerCase().includes('already exists')
  ) {
    return 'Email already registered.'
  }

  if (status === 401 && !skipAuth) {
    return 'Session expired. Please sign in again.'
  }

  return message || fallbackMessage
}

export async function apiRequest(
  path,
  options = {},
  { fallbackMessage = 'Unable to complete the request.', skipAuth = false } = {},
) {
  const headers = new Headers(options.headers)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (!skipAuth && authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }

  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', {
      status: 0,
    })
  }

  if (!response.ok) {
    const data = await parseErrorBody(response)
    const message = getFriendlyMessage({
      fallbackMessage,
      message: data.error ?? data.message,
      skipAuth,
      status: response.status,
    })

    if (response.status === 401 && !skipAuth) {
      clearAuthToken()
      notifyUnauthorized()
    }

    throw new ApiError(message, {
      details: data.details,
      status: response.status,
    })
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}
