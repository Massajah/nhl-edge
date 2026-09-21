import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createClientSentryOptions,
  initializeClientSentry,
  scrubSentryEvent,
} from '../monitoring/sentry.js'
import { resolveSentryRelease } from '../../sentryBuildConfig.js'

test('Sentry release resolution preserves explicit configuration precedence', () => {
  assert.equal(
    resolveSentryRelease({
      SENTRY_RELEASE: 'server-explicit-release',
      VERCEL_GIT_COMMIT_SHA: 'vercel-commit-sha',
      VITE_SENTRY_RELEASE: 'client-explicit-release',
    }),
    'client-explicit-release',
  )
  assert.equal(
    resolveSentryRelease({
      SENTRY_RELEASE: 'server-explicit-release',
      VERCEL_GIT_COMMIT_SHA: 'vercel-commit-sha',
    }),
    'server-explicit-release',
  )
})

test('Sentry release resolution falls back to the Vercel Git commit SHA', () => {
  assert.equal(
    resolveSentryRelease({
      VERCEL_GIT_COMMIT_SHA: 'vercel-commit-sha',
    }),
    'vercel-commit-sha',
  )
})

test('Sentry release resolution ignores blank values and stays optional', () => {
  assert.equal(
    resolveSentryRelease({
      SENTRY_RELEASE: '  ',
      VERCEL_GIT_COMMIT_SHA: ' vercel-commit-sha ',
      VITE_SENTRY_RELEASE: '',
    }),
    'vercel-commit-sha',
  )
  assert.equal(resolveSentryRelease({}), '')
})

test('client Sentry remains disabled when VITE_SENTRY_DSN is absent', () => {
  let initCalls = 0
  const enabled = initializeClientSentry(
    { init: () => { initCalls += 1 } },
    { MODE: 'test' },
  )

  assert.equal(enabled, false)
  assert.equal(initCalls, 0)
  assert.equal(createClientSentryOptions({ MODE: 'test' }), null)
})

test('client Sentry uses error-only defaults and explicit deployment metadata', () => {
  const options = createClientSentryOptions({
    MODE: 'production',
    VITE_SENTRY_DSN: 'configured-for-test',
    VITE_SENTRY_ENVIRONMENT: 'railway-production',
    VITE_SENTRY_RELEASE: 'git-sha-123',
  })
  const remainingIntegrations = options.integrations([
    { name: 'Breadcrumbs' },
    { name: 'BrowserSession' },
    { name: 'GlobalHandlers' },
    { name: 'HttpContext' },
    { name: 'LinkedErrors' },
  ])

  assert.equal(options.sendDefaultPii, false)
  assert.equal(options.enableLogs, false)
  assert.equal(options.environment, 'railway-production')
  assert.equal(options.release, 'git-sha-123')
  assert.deepEqual(
    remainingIntegrations.map(({ name }) => name),
    ['GlobalHandlers', 'LinkedErrors'],
  )
  assert.equal(Object.hasOwn(options, 'tracesSampleRate'), false)
  assert.equal(Object.hasOwn(options, 'replaysSessionSampleRate'), false)
})

test('client Sentry scrubber removes application and user data without dropping errors', () => {
  const exception = { values: [{ type: 'Error', value: 'Unexpected failure' }] }
  const scrubbed = scrubSentryEvent({
    breadcrumbs: [{ message: 'private note' }],
    contexts: { app: { state: 'private' } },
    environment: 'production',
    exception,
    extra: { bankroll: 1234 },
    release: 'git-sha-123',
    request: {
      cookies: { session: 'secret' },
      data: { stake: 100 },
      headers: { authorization: 'Bearer secret' },
    },
    tags: { account: 'owner@example.com' },
    user: { email: 'owner@example.com', id: 'user-id' },
  })

  assert.deepEqual(scrubbed.exception, exception)
  assert.equal(scrubbed.environment, 'production')
  assert.equal(scrubbed.release, 'git-sha-123')
  for (const field of [
    'breadcrumbs',
    'contexts',
    'extra',
    'request',
    'tags',
    'user',
  ]) {
    assert.equal(Object.hasOwn(scrubbed, field), false)
  }
})
