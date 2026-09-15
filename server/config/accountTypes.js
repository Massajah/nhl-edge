const ACCOUNT_TYPES = Object.freeze({
  DEMO_SANDBOX: 'DEMO_SANDBOX',
  NORMAL: 'NORMAL',
})

const ACCOUNT_TYPE_VALUES = Object.freeze(Object.values(ACCOUNT_TYPES))

const getAccountType = (account) => {
  const value = account?.accountType

  if (value === undefined || value === null || value === '') {
    return ACCOUNT_TYPES.NORMAL
  }

  return ACCOUNT_TYPE_VALUES.includes(value) ? value : null
}

const isDemoSandboxAccount = (account) =>
  getAccountType(account) === ACCOUNT_TYPES.DEMO_SANDBOX

const isProductionAccount = (account) =>
  getAccountType(account) === ACCOUNT_TYPES.NORMAL

const getProductionAccountFilter = () => ({
  $or: [
    { accountType: ACCOUNT_TYPES.NORMAL },
    { accountType: { $exists: false } },
    { accountType: null },
    { accountType: '' },
  ],
})

module.exports = {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_VALUES,
  getAccountType,
  getProductionAccountFilter,
  isDemoSandboxAccount,
  isProductionAccount,
}
