import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const EXPECTED_CONNECT_SOURCES = [
  "'self'",
  'ws:',
  'wss:',
  'https://accounts.google.com/gsi/',
  'https://nhl-edge-production.up.railway.app',
  'https://o4512124903751680.ingest.de.sentry.io',
]

const parseCspDirectives = (policy) =>
  new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  )

test('production CSP narrowly allows the configured Sentry DE ingest origin', async () => {
  const indexHtml = await readFile(
    new URL('../../index.html', import.meta.url),
    'utf8',
  )
  const policy = indexHtml.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )?.[1]

  assert.ok(policy, 'Content-Security-Policy meta tag should be present')

  const connectSources = parseCspDirectives(policy).get('connect-src')

  assert.deepEqual(connectSources, EXPECTED_CONNECT_SOURCES)
  assert.equal(connectSources.includes('https:'), false)
  assert.equal(
    connectSources.some((source) => source.includes('*')),
    false,
  )
  assert.deepEqual(
    connectSources.filter((source) => source.includes('sentry.io')),
    ['https://o4512124903751680.ingest.de.sentry.io'],
  )
})
