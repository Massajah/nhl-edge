import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('Power Ratings renders the polished primary labels and signed adjustments', async () => {
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
  assert.match(
    markup,
    />Power Rating<\/span><div class="power-rating-current-display"><strong>46\.50<\/strong><small>#1<\/small><\/div>/,
  )
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.75<\/output>/)
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.50<\/output>/)
  assert.match(markup, />32 teams<\/span>/)
  assert.match(markup, /class="update-ratings-button manual-rating-update-button"/)
  assert.match(markup, /Manual Rating Update/)
  assert.doesNotMatch(markup, /Ratings update automatically/)
  assert.doesNotMatch(markup, /ratings-update-control/)
  assert.match(markup, /step="0\.1"[^>]*data-testid="rating-ANA-homeAdjustment"|data-testid="rating-ANA-homeAdjustment"[^>]*step="0\.1"/)
  assert.match(markup, /data-testid="rating-ANA-manualAdjustment"[^>]*step="0\.5"/)
  assert.doesNotMatch(markup, /MongoDB/)
  assert.doesNotMatch(markup, />Model Rating<\/span>/)
  assert.doesNotMatch(markup, />Current<\/span>/)

  const css = await readFile(new URL('../App.css', import.meta.url), 'utf8')

  assert.match(
    css,
    /\.manual-rating-update-button\s*\{[^}]*background:/s,
  )
  assert.match(
    css,
    /\.manual-rating-update-button\s*\{[^}]*border(?:-color)?:/s,
  )
  assert.match(
    css,
    /\.save-ratings-button[^}]*\{[^}]*background:\s*var\(--accent\)/s,
  )
})
