import { expect } from '@playwright/test'

const goalieFor = (team, suffix) => ({
  activeOverride: null,
  adjustmentSource: 'implicit_default',
  displayName: `${team} Test Goalie ${suffix}`,
  fullName: `${team} Test Goalie ${suffix}`,
  hasSavedAdjustment: false,
  id: Number(`90${team.charCodeAt(0)}${suffix}`),
  name: `${team} Test Goalie ${suffix}`,
  nhlPlayerId: Number(`90${team.charCodeAt(0)}${suffix}`),
  note: '',
  position: 'G',
  ratingAdjustment: suffix === 1 ? -1.25 : 0,
})

export const installDeterministicProviderStubs = async (page) => {
  await page.route('https://assets.nhle.com/**', (route) =>
    route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" />',
      contentType: 'image/svg+xml',
      status: 200,
    }),
  )
  await page.route('**/api/schedule/**', (route) =>
    route.fulfill({ json: { games: [] } }),
  )
  await page.route('**/api/market-odds/**', (route) =>
    route.fulfill({ json: { games: [], provider: { status: 'unavailable' } } }),
  )
  await page.route('**/api/game-context/bulk', (route) =>
    route.fulfill({ json: { contexts: [] } }),
  )
  await page.route('**/api/teams/special-teams', (route) =>
    route.fulfill({
      json: {
        provider: { status: 'unavailable' },
        specialTeams: null,
      },
    }),
  )
  await page.route('**/api/teams/*/goalie-summaries', (route) => {
    const team = new URL(route.request().url()).pathname.split('/')[3]
    const goalies = [goalieFor(team, 1), goalieFor(team, 2)]

    return route.fulfill({
      json: {
        goalieSummaries: {
          goalies: goalies.map((goalie) => ({
            currentSeason: {
              gamesPlayed: 20,
              gamesStarted: 18,
              goalsAgainstAverage: 2.45,
              savePercentage: 0.915,
            },
            playerId: goalie.nhlPlayerId,
            playerName: goalie.displayName,
          })),
        },
        provider: { status: 'ready' },
      },
    })
  })
  await page.route('**/api/teams/*/goalie-adjustments', (route) => {
    if (route.request().method() !== 'GET') return route.continue()

    const team = new URL(route.request().url()).pathname.split('/')[3]

    return route.fulfill({
      json: {
        adjustments: [],
        goalies: [goalieFor(team, 1), goalieFor(team, 2)],
        provider: { status: 'ready' },
        teamAbbreviation: team,
        teamId: team,
        teamName: `${team} Test Team`,
      },
    })
  })
}

export const openLoginPage = async (page) => {
  await installDeterministicProviderStubs(page)
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'Login' })).toBeVisible()
}

export const enterDemo = async (page) => {
  await openLoginPage(page)
  await page.getByRole('button', { name: 'Explore Demo' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByLabel('Demo sandbox notice')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Game Analyzer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Model Performance' })).toBeVisible()
}

export const browserApi = async (page, path, options = {}) =>
  page.evaluate(
    async ({ requestOptions, requestPath }) => {
      const response = await fetch(requestPath, {
        credentials: 'include',
        headers: requestOptions.body
          ? { 'Content-Type': 'application/json', ...requestOptions.headers }
          : requestOptions.headers,
        ...requestOptions,
      })
      const data = await response.json().catch(() => ({}))

      return {
        data,
        ok: response.ok,
        status: response.status,
      }
    },
    { requestOptions: options, requestPath: path },
  )
