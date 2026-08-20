import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { normalizePowerRatings } from '../utils/powerRatings.js'

let PowerRatings
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  PowerRatings = (
    await vite.ssrLoadModule('/src/components/PowerRatings.jsx')
  ).default
})

after(async () => {
  await vite?.close()
})

test('Power Ratings renders the polished primary labels and signed adjustments', () => {
  const ratings = normalizePowerRatings([
    {
      baseRating: 46,
      homeAdjustment: 0.75,
      manualAdjustment: 0.5,
      teamId: 'ANA',
      teamName: 'Anaheim Ducks',
    },
  ])
  const markup = renderToStaticMarkup(
    React.createElement(PowerRatings, {
      migrationAvailable: false,
      onReset() {},
      onRetry() {},
      onSave() {},
      onUpdatePowerRatings() {},
      ratings,
      ratingsCount: 32,
      status: 'success',
    }),
  )

  assert.match(markup, />Starting Rating<\/span>/)
  assert.match(markup, />Home Adjustment<\/span>/)
  assert.match(markup, />Manual Adjustment<\/span>/)
  assert.match(markup, />Power Rating<\/span><strong>46\.50<\/strong><small>#1<\/small>/)
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.75<\/output>/)
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.50<\/output>/)
  assert.doesNotMatch(markup, />Model Rating<\/span>/)
  assert.doesNotMatch(markup, />Current<\/span>/)
})
