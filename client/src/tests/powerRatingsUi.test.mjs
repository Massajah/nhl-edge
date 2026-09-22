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
    {
      baseRating: 46,
      homeAdjustment: 0,
      manualAdjustment: 0.5,
      teamId: 'BOS',
      teamName: 'Boston Bruins',
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

  assert.match(markup, /aria-label="Starting Rating">Starting<\/span>/)
  assert.match(markup, /aria-label="Home Adjustment">Home<\/span>/)
  assert.match(markup, /aria-label="Manual Adjustment">Manual<\/span>/)
  assert.match(markup, /aria-label="Anaheim Ducks Starting Rating"/)
  assert.match(
    markup,
    /class="team-rating-rank" aria-label="Rank 1">#1<\/span><output class="power-rating-current-value" aria-label="Power Rating: 46\.50"[^>]*><strong>46\.50<\/strong><\/output><div class="team-rating-identity">/,
  )
  assert.doesNotMatch(markup, />Power Rating<\/span>/)
  assert.doesNotMatch(markup, /<small>Pacific<\/small>/)
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.75<\/output>/)
  assert.match(markup, /class="rating-input-formatted" aria-hidden="true">\+0\.50<\/output>/)
  assert.match(markup, /data-testid="rating-ANA-homeAdjustment"[^>]*value="0\.75"/)
  assert.match(markup, /data-testid="rating-ANA-manualAdjustment"[^>]*value="0\.50"/)
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

  const teamRows = markup.match(/<article class="team-rating-row [^"]*">[\s\S]*?<\/article>/g)

  assert.ok(teamRows)
  assert.match(teamRows[0], /aria-label="Rank 1">#1<\/span>/)
  assert.match(teamRows[0], /Anaheim Ducks/)
  assert.match(teamRows[1], /aria-label="Rank 1">#1<\/span>/)
  assert.match(teamRows[1], /Boston Bruins/)

  const [css, componentSource] = await Promise.all([
    readFile(new URL('../App.css', import.meta.url), 'utf8'),
    readFile(
      new URL('../components/PowerRatings.jsx', import.meta.url),
      'utf8',
    ),
  ])

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
  assert.match(
    css,
    /\.ratings-grid\s*{[^}]*grid-auto-flow:\s*row/s,
  )
  assert.doesNotMatch(
    css,
    /\.ratings-grid\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  )
  assert.match(
    css,
    /\.team-rating-row\s*{[^}]*grid-template-columns:\s*34px\s+86px\s+minmax\(190px, 1fr\)[^}]*padding:\s*7px 12px/s,
  )
  assert.match(
    css,
    /\.rating-value-field\s*{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/s,
  )
  assert.match(
    css,
    /@media \(max-width: 1160px\)[\s\S]*?\.team-rating-row\s*{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/s,
  )
  assert.match(
    componentSource,
    /\[team\.name, team\.abbreviation, team\.division\]\.some/,
  )
  assert.doesNotMatch(componentSource, /<small>{team\.division}<\/small>/)
})
