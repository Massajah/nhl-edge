import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import { resolveSentryRelease } from './sentryBuildConfig.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const release = resolveSentryRelease(environment)
  const sourceMapUploadEnabled = [
    environment.SENTRY_AUTH_TOKEN,
    environment.SENTRY_ORG,
    environment.SENTRY_PROJECT,
    release,
  ].every((value) => String(value ?? '').trim())
  const plugins = [react()]

  if (sourceMapUploadEnabled) {
    plugins.push(
      sentryVitePlugin({
        authToken: environment.SENTRY_AUTH_TOKEN,
        org: environment.SENTRY_ORG,
        project: environment.SENTRY_PROJECT,
        release: { name: release },
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        telemetry: false,
        url: environment.SENTRY_URL || 'https://de.sentry.io/',
      }),
    )
  }

  return {
    build: {
      sourcemap: sourceMapUploadEnabled ? 'hidden' : false,
    },
    define: {
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(release),
    },
    plugins,
    server: {
      proxy: {
        '/api': 'http://localhost:5000',
      },
    },
  }
})
