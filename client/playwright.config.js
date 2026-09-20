import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: isCi,
  fullyParallel: false,
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  retries: isCi ? 2 : 0,
  testDir: './e2e/specs',
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
  },
  workers: 1,
})
