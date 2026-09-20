import {
  browserApi,
  enterDemo,
  installDeterministicProviderStubs,
  openLoginPage,
} from '../support/app.js'
import {
  expect,
  expectNoPageErrors,
  monitorPageErrors,
  test,
} from '../support/fixtures.js'

test('login page exposes the real demo entry point', async ({ page }) => {
  await openLoginPage(page)

  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'NHL Edge' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explore Demo' })).toBeEnabled()
  await expect(page.getByText('Temporary sandbox')).toBeVisible()
})

test('Explore Demo creates an authenticated seeded sandbox', async ({ page }) => {
  await enterDemo(page)

  const [session, bankroll] = await Promise.all([
    browserApi(page, '/api/auth/me'),
    browserApi(page, '/api/bankroll/summary'),
  ])

  expect(session.status).toBe(200)
  expect(session.data.user).toMatchObject({
    accountType: 'DEMO_SANDBOX',
    authProvider: 'demo',
    name: 'Demo Sandbox',
  })
  expect(bankroll.status).toBe(200)
  expect(bankroll.data.summary).toMatchObject({
    availableBankroll: 972,
    currentBankroll: 994,
    startingBalance: 1000,
  })
})

test('two demo browser contexts remain owner-isolated', async ({ browser, page }) => {
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  const secondPageErrors = monitorPageErrors(secondPage)

  try {
    await Promise.all([
      enterDemo(page),
      (async () => {
        await installDeterministicProviderStubs(secondPage)
        await secondPage.goto('/')
        await expect(secondPage.getByRole('main', { name: 'Login' })).toBeVisible()
        await secondPage.getByRole('button', { name: 'Explore Demo' }).click()
        await expect(
          secondPage.getByRole('heading', { level: 1, name: 'Dashboard' }),
        ).toBeVisible()
      })(),
    ])

    const [firstSession, secondSession] = await Promise.all([
      browserApi(page, '/api/auth/me'),
      browserApi(secondPage, '/api/auth/me'),
    ])
    expect(firstSession.data.user.id).not.toBe(secondSession.data.user.id)

    const update = await browserApi(page, '/api/power-ratings/BOS', {
      body: JSON.stringify({ manualAdjustment: 1.5 }),
      method: 'PUT',
    })
    expect(update.status).toBe(200)

    const [firstRatings, secondRatings] = await Promise.all([
      browserApi(page, '/api/power-ratings'),
      browserApi(secondPage, '/api/power-ratings'),
    ])
    const firstBoston = firstRatings.data.ratings.find(({ teamId }) => teamId === 'BOS')
    const secondBoston = secondRatings.data.ratings.find(({ teamId }) => teamId === 'BOS')

    expect(firstBoston.manualAdjustment).toBe(1.5)
    expect(secondBoston.manualAdjustment).toBe(0)
    expectNoPageErrors(secondPageErrors)
  } finally {
    await secondContext.close()
  }
})

test('demo Model Performance uses the deterministic sample workflow', async ({ page }) => {
  await enterDemo(page)
  await page.getByRole('button', { name: 'Model Performance' }).click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'Model Performance' }),
  ).toBeVisible()
  await expect(page.getByText('Demo Dataset', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Forward Model' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('tab', { name: 'Bets & CLV' }).click()
  await expect(page.getByRole('heading', { name: 'Bets & closing value' })).toBeVisible()
  await page.getByRole('tab', { name: 'Games' }).click()
  await expect(page.getByRole('heading', { name: 'Official game observations' })).toBeVisible()

  const firstGame = page
    .getByRole('button', { expanded: false })
    .filter({ hasText: '@' })
    .first()
  await expect(firstGame).toBeVisible()
  const matchupName = (await firstGame.innerText()).trim()
  await firstGame.click()
  await expect(
    page.getByRole('button', { expanded: true, name: matchupName }).first(),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Official Model' }).first()).toBeVisible()
})

test('Analyzer applies a deterministic starting-goalie selection once', async ({ page }) => {
  await enterDemo(page)
  await page.getByRole('button', { name: 'Analyze Game' }).first().click()

  await expect(page.getByRole('heading', { level: 1, name: 'Game Analyzer' })).toBeVisible()
  await expect(page.getByLabel('Starting goalies')).toBeVisible()

  const awayGoalie = page.getByTestId('analyzer-away-goalie-selection')
  const homeGoalie = page.getByTestId('analyzer-home-goalie-selection')
  await expect(awayGoalie).toBeEnabled()
  await expect(homeGoalie).toBeEnabled()

  const effectiveRating = page.getByTestId('analyzer-away-effective-rating')
  const initialEffectiveRating = await effectiveRating.textContent()
  const firstGoalieOption = awayGoalie.locator('option').filter({
    hasText: 'Test Goalie 1',
  })
  const firstGoalieValue = await firstGoalieOption.getAttribute('value')

  expect(firstGoalieValue).toBeTruthy()
  await awayGoalie.selectOption(firstGoalieValue)
  await expect(awayGoalie.locator('option:checked')).toContainText('Test Goalie 1')
  await expect(effectiveRating).not.toHaveText(initialEffectiveRating)
})
