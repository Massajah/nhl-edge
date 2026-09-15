export const ACCOUNT_TYPES = Object.freeze({
  DEMO_SANDBOX: 'DEMO_SANDBOX',
  NORMAL: 'NORMAL',
})

export const isDemoSandboxUser = (user) =>
  user?.accountType === ACCOUNT_TYPES.DEMO_SANDBOX
