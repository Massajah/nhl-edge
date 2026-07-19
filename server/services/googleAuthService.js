const { OAuth2Client } = require('google-auth-library')
const { normalizeEmail } = require('../utils/email')

class GoogleAuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message)
    this.name = 'GoogleAuthError'
    this.statusCode = statusCode
    this.publicMessage = message
  }
}

let googleClient = null

const getGoogleClient = () => {
  if (!googleClient || googleClient._clientId !== process.env.GOOGLE_CLIENT_ID) {
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
    googleClient._clientId = process.env.GOOGLE_CLIENT_ID
  }

  return googleClient
}

const verifyGoogleIdToken = async (credential) => {
  if (typeof credential !== 'string' || !credential.trim()) {
    throw new GoogleAuthError('Google credential is required.', 400)
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new GoogleAuthError('Google authentication is not configured.', 500)
  }

  let ticket

  try {
    ticket = await getGoogleClient().verifyIdToken({
      audience: process.env.GOOGLE_CLIENT_ID,
      idToken: credential,
    })
  } catch {
    throw new GoogleAuthError('Google authentication failed.', 401)
  }

  const payload = ticket.getPayload()

  if (!payload?.sub) {
    throw new GoogleAuthError('Google authentication failed.', 401)
  }

  if (!payload.email) {
    throw new GoogleAuthError('Google account email is required.', 401)
  }

  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new GoogleAuthError('Google account email must be verified.', 401)
  }

  return {
    email: normalizeEmail(payload.email),
    googleId: payload.sub,
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    profileImage: typeof payload.picture === 'string' ? payload.picture.trim() : '',
  }
}

module.exports = {
  GoogleAuthError,
  verifyGoogleIdToken,
}
