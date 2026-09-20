import { expect, test as base } from '@playwright/test'
import { startTestStack, stopTestStack } from './test-stack.mjs'

const ALLOWED_CONSOLE_ERRORS = [
  /^Failed to load resource: the server responded with a status of 401 \(Unauthorized\)$/,
]

export const monitorPageErrors = (page) => {
  const errors = []

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return

    const text = message.text()
    if (!ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) {
      errors.push(`console.error: ${text}`)
    }
  })

  return errors
}

export const expectNoPageErrors = (errors) => {
  expect(errors, 'Unexpected browser page or console errors').toEqual([])
}

export const test = base.extend({
  e2eStack: [
    async ({ browserName }, use) => {
      if (browserName !== 'chromium') {
        throw new Error('The Phase 1 E2E stack supports Chromium only.')
      }
      await startTestStack()
      await use()
      await stopTestStack()
    },
    { auto: true, scope: 'worker', timeout: 120_000 },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors = monitorPageErrors(page)
      await use(errors)
      expectNoPageErrors(errors)
    },
    { auto: true },
  ],
})

export { expect }
