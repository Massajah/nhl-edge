import * as Sentry from '@sentry/react'
import { initializeClientSentry } from './monitoring/sentry.js'

export const clientSentryEnabled = initializeClientSentry(
  Sentry,
  import.meta.env,
)
