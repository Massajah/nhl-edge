import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let AdjustmentComparison
let calculateGame
let defaultGameInputs
let vite

const awayTeam = {
  abbreviation: 'BOS',
  id: 'BOS',
  name: 'Boston Bruins',
}
const homeTeam = {
  abbreviation: 'TOR',
  id: 'TOR',
  name: 'Toronto Maple Leafs',
}

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  })
  AdjustmentComparison = (
    await vite.ssrLoadModule('/src/components/AdjustmentComparison.jsx')
  ).default
  calculateGame = (
    await vite.ssrLoadModule('/src/utils/calculateGame.js')
  ).calculateGame
  defaultGameInputs = (
    await vite.ssrLoadModule('/src/utils/modelAnalysis.js')
  ).defaultGameInputs
})

after(async () => {
  await vite?.close()
})

const createScenario = () => {
  const inputs = {
    away: {
      ...defaultGameInputs.away,
      baseRating: 50,
      goalieAdjustment: -0.5,
      goalieNhlPlayerId: 1,
      goalieSelectionType: 'provider_goalie',
      goalieTeamDefaultAdjustment: -0.5,
      goalieTeamId: 'BOS',
      injuries: -0.5,
      manualAdjustment: -0.25,
      motivation: 0.5,
      quickRematchAdjustment: 0.25,
      restFatigue: -1.25,
      selectedGoalieName: 'Boston Starter',
      storedInjuryImpact: -1,
    },
    home: {
      ...defaultGameInputs.home,
      baseRating: 55,
      goalieAdjustment: -0.25,
      goalieNhlPlayerId: 2,
      goalieSelectionType: 'provider_goalie',
      goalieTeamDefaultAdjustment: -0.25,
      goalieTeamId: 'TOR',
      homeAdvantage: 3.5,
      injuries: -0.5,
      manualAdjustment: 0.25,
      motivation: -0.25,
      quickRematchAdjustment: 0.5,
      restFatigue: 0.75,
      selectedGoalieName: 'Toronto Starter',
      storedInjuryImpact: -1.5,
    },
  }
  const finalRatings = calculateGame(inputs.home, inputs.away)
  const gameContext = {
    awayContext: {
      adjustmentBreakdown: [
        {
          adjustment: -1.25,
          category: 'restFatigue',
          condition: 'back_to_back_travel',
        },
        {
          adjustment: 0.25,
          category: 'quickRematch',
          condition: 'quick_rematch',
        },
      ],
      quickRematch: { eligible: true },
    },
    awayTeam,
    gameId: 'representative-game',
    homeContext: {
      adjustmentBreakdown: [
        {
          adjustment: 0.75,
          category: 'restFatigue',
          condition: 'well_rested',
        },
        {
          adjustment: 0.5,
          category: 'quickRematch',
          condition: 'quick_rematch',
        },
      ],
      quickRematch: { eligible: true },
    },
    homeTeam,
  }

  return { finalRatings, gameContext, inputs }
}

const renderScenario = () => {
  const scenario = createScenario()

  return {
    ...scenario,
    markup: renderToStaticMarkup(
      React.createElement(AdjustmentComparison, {
        awayTeam,
        canPersistGoalies: true,
        finalRatings: {
          away: scenario.finalRatings.awayFinalRating,
          home: scenario.finalRatings.homeFinalRating,
        },
        gameContext: scenario.gameContext,
        gameContextStatus: 'success',
        goalieErrors: { away: '', home: '' },
        goalieSaveMessage: '',
        goalieSaveStatus: 'idle',
        goalieStatuses: { away: 'success', home: 'success' },
        goalieStatsByPlayerId: {},
        goalieValidationErrors: { away: '', home: '' },
        goalies: {
          away: [{ displayName: 'Boston Starter', nhlPlayerId: 1, ratingAdjustment: -0.5 }],
          home: [{ displayName: 'Toronto Starter', nhlPlayerId: 2, ratingAdjustment: -0.25 }],
        },
        hasUnsavedGoalieChanges: false,
        homeTeam,
        injurySummaries: {
          BOS: {
            injuries: [
              { id: 'bos-1', impact: -1, playerName: 'Boston Skater', position: 'C' },
              { id: 'bos-2', impact: 0, playerName: 'Boston Context', position: 'D' },
            ],
            totalImpact: -1,
          },
          TOR: {
            injuries: [
              { id: 'tor-1', impact: -1.5, playerName: 'Toronto Skater', position: 'LW' },
            ],
            totalImpact: -1.5,
          },
        },
        inputs: scenario.inputs,
        maximumGoaliePenalty: -4,
        onChange() {},
        onGoalieChange() {},
        onRetryGoalies: { away() {}, home() {} },
        onSaveGoalies() {},
      }),
    ),
  }
}

test('Team Adjustments separates game inputs, automatic values and manual fields', () => {
  const { markup } = renderScenario()
  const gameInputsIndex = markup.indexOf('Game Inputs')
  const automaticIndex = markup.indexOf('Automatic Adjustments')
  const manualIndex = markup.indexOf('Manual Adjustments')
  const effectiveIndex = markup.indexOf('Effective Rating Summary')

  assert.ok(gameInputsIndex < automaticIndex)
  assert.ok(automaticIndex < manualIndex)
  assert.ok(manualIndex < effectiveIndex)
  assert.match(markup, /Read-only values supplied to the model/)
  assert.match(markup, /Editable, deliberate inputs for this analysis/)
  assert.doesNotMatch(
    markup,
    /<input[^>]*id="analyzer-(away|home)-restFatigue"/,
  )
  assert.doesNotMatch(
    markup,
    /<input[^>]*id="analyzer-(away|home)-quickRematchAdjustment"/,
  )
  assert.doesNotMatch(markup, /<input[^>]*id="analyzer-home-homeAdvantage"/)
  ;['injuries', 'motivation', 'manualAdjustment'].forEach((field) => {
    assert.match(markup, new RegExp(`id="analyzer-away-${field}"`))
    assert.match(markup, new RegExp(`id="analyzer-home-${field}"`))
  })
})

test('automatic and manual sources reconcile exactly to displayed Effective Rating', () => {
  const { finalRatings, markup } = renderScenario()

  assert.equal(finalRatings.awayFinalRating, 47.25)
  assert.equal(finalRatings.homeFinalRating, 57.5)
  assert.match(markup, /Back-to-Back \+ Travel/)
  assert.match(markup, /Well Rested/)
  assert.match(markup, /data-testid="analyzer-away-restFatigue"[\s\S]*?-1\.25/)
  assert.match(markup, /data-testid="analyzer-home-restFatigue"[\s\S]*?\+0\.75/)
  assert.match(markup, /data-testid="analyzer-away-quickRematchAdjustment"[\s\S]*?\+0\.25/)
  assert.match(markup, /data-testid="analyzer-home-quickRematchAdjustment"[\s\S]*?\+0\.50/)
  assert.match(markup, /BOS 47\.3 · TOR 57\.5/)
  assert.match(markup, /Power rating/)
  assert.match(markup, /Home advantage/)
  assert.match(markup, /Stored injury/)
  assert.match(markup, /Game injury/)
  assert.match(markup, /Manual \/ X-factor/)
})

test('provider goalies and injuries remain compact before progressive expansion', () => {
  const { markup } = renderScenario()

  assert.match(markup, /Boston Starter \(-0\.50\)/)
  assert.match(markup, /Toronto Starter \(-0\.25\)/)
  assert.match(markup, /data-testid="analyzer-away-goalie-adjustment-value">-0\.50/)
  assert.match(markup, /data-testid="analyzer-home-goalie-adjustment-value">-0\.25/)
  assert.match(markup, /<dd>Provider goalie<\/dd>/)
  assert.match(markup, /aria-expanded="false"[^>]*>View goalie details/)
  assert.doesNotMatch(markup, /id="analyzer-away-goalie-adjustment"/)
  assert.match(markup, /2 active/)
  assert.match(markup, /Stored impact -1\.0/)
  assert.match(markup, /View injuries/)
  assert.doesNotMatch(markup, /Boston Skater|Toronto Skater/)
})
