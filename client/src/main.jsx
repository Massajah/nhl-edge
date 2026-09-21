import { clientSentryEnabled } from './instrument.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import AppErrorFallback from './components/AppErrorFallback.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

const reactRootOptions = clientSentryEnabled
  ? {
      onRecoverableError: Sentry.reactErrorHandler(),
      onUncaughtError: Sentry.reactErrorHandler(),
    }
  : undefined

createRoot(document.getElementById('root'), reactRootOptions).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<AppErrorFallback />}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
