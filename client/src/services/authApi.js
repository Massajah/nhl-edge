import { apiRequest } from './apiClient.js'

export const registerUser = async ({ email, name, password }) =>
  apiRequest(
    '/api/auth/register',
    {
      body: JSON.stringify({ email, name, password }),
      method: 'POST',
    },
    {
      fallbackMessage: 'Unable to create your account.',
      skipAuth: true,
    },
  )

export const loginUser = async ({ email, password }) =>
  apiRequest(
    '/api/auth/login',
    {
      body: JSON.stringify({ email, password }),
      method: 'POST',
    },
    {
      fallbackMessage: 'Unable to sign in.',
      skipAuth: true,
    },
  )

export const loginWithGoogle = async (credential) =>
  apiRequest(
    '/api/auth/google',
    {
      body: JSON.stringify({ credential }),
      method: 'POST',
    },
    {
      fallbackMessage: 'Unable to sign in with Google.',
      skipAuth: true,
    },
  )

export const fetchCurrentUser = async () => {
  const data = await apiRequest('/api/auth/me', undefined, {
    fallbackMessage: 'Unable to restore your session.',
  })

  return data.user
}

