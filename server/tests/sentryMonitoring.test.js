process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  SENTRY_FLUSH_TIMEOUT_MS,
  captureExceptionAndFlush,
  createServerSentryOptions,
  initializeServerSentry,
  scrubSentryEvent,
  shouldCaptureExpressError,
} = require('../monitoring/sentry')
const {
  handleOddsCaptureCronFailure,
} = require('../scripts/runOddsCaptureCron')
const { handleDemoCleanupFailure } = require('../scripts/runDemoCleanup')

test('server Sentry remains disabled when SENTRY_DSN is absent', () => {
  let initCalls = 0
  const enabled = initializeServerSentry({
    environment: { NODE_ENV: 'test' },
    sdk: { init: () => { initCalls += 1 } },
  })

  assert.equal(enabled, false)
  assert.equal(initCalls, 0)
  assert.equal(createServerSentryOptions({ NODE_ENV: 'test' }), null)
})

test('server Sentry uses error-only defaults and explicit deployment metadata', () => {
  const sdk = {
    expressIntegration: (options) => ({ name: 'Express', options }),
  }
  const options = createServerSentryOptions(
    {
      NODE_ENV: 'production',
      SENTRY_DSN: 'configured-for-test',
      SENTRY_ENVIRONMENT: 'railway-production',
      SENTRY_RELEASE: 'git-sha-123',
    },
    sdk,
  )
  const remainingIntegrations = options.integrations([
    { name: 'Console' },
    { name: 'Http' },
    { name: 'LinkedErrors' },
    { name: 'LocalVariablesAsync' },
    { name: 'RequestData' },
  ])

  assert.equal(options.sendDefaultPii, false)
  assert.equal(options.enableLogs, false)
  assert.equal(options.environment, 'railway-production')
  assert.equal(options.release, 'git-sha-123')
  assert.deepEqual(
    remainingIntegrations.map(({ name }) => name),
    ['LinkedErrors', 'Express'],
  )
  assert.equal(
    remainingIntegrations.at(-1).options.shouldHandleError,
    shouldCaptureExpressError,
  )
  assert.equal(Object.hasOwn(options, 'tracesSampleRate'), false)
})

test('server captures only unexpected 5xx-style Express errors', () => {
  assert.equal(shouldCaptureExpressError(new Error('unexpected')), true)
  assert.equal(shouldCaptureExpressError({ statusCode: 500 }), true)
  assert.equal(shouldCaptureExpressError({ status: '503' }), true)
  assert.equal(shouldCaptureExpressError({ statusCode: 429 }), false)
  assert.equal(shouldCaptureExpressError({ status: 404 }), false)
})

test('server Sentry scrubber removes request and user data without dropping errors', () => {
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

test('one-shot failures capture and use a bounded Sentry flush', async () => {
  const error = new Error('cron failed')
  const calls = []
  const flushed = await captureExceptionAndFlush(error, {
    enabled: true,
    sdk: {
      captureException: (captured) => calls.push(['capture', captured]),
      flush: async (timeout) => {
        calls.push(['flush', timeout])
        return true
      },
    },
  })

  assert.equal(flushed, true)
  assert.deepEqual(calls, [
    ['capture', error],
    ['flush', SENTRY_FLUSH_TIMEOUT_MS],
  ])
})

test('monitoring transport failure cannot replace the application failure', async () => {
  const flushed = await captureExceptionAndFlush(new Error('application failure'), {
    enabled: true,
    sdk: {
      captureException: () => {},
      flush: async () => {
        throw new Error('transport failure')
      },
    },
  })

  assert.equal(flushed, false)
})

test('cron entrypoint handlers await monitoring without exposing error details', async (t) => {
  const originalExitCode = process.exitCode
  const error = Object.assign(new Error('private failure details'), {
    summary: 'private summary',
  })
  const captures = []
  const consoleCalls = []

  t.after(() => {
    process.exitCode = originalExitCode
  })
  t.mock.method(console, 'error', (...args) => consoleCalls.push(args))

  await handleOddsCaptureCronFailure(error, {
    captureAndFlush: async (captured) => captures.push(captured),
  })
  await handleDemoCleanupFailure(error, {
    captureAndFlush: async (captured) => captures.push(captured),
  })

  assert.deepEqual(captures, [error, error])
  assert.equal(process.exitCode, 1)
  assert.equal(JSON.stringify(consoleCalls).includes(error.message), false)
})
