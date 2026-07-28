import { apiRequest } from './apiClient.js'
import {
  buildBankrollCashTransactionRequest,
  buildBankrollInitializationRequest,
  buildBankrollSummaryQueryString,
  buildBankrollTransactionsQueryString,
  normalizeBankrollSeasonsResponse,
  normalizeBankrollSummary,
  normalizeBankrollTransactionsResponse,
} from '../utils/bankroll.js'

const requestBankroll = async (path, options = {}) => {
  return apiRequest(path, options, {
    fallbackMessage: 'Unable to load bankroll data.',
  })
}

export const getBankrollSeasons = async () => {
  const data = await requestBankroll('/api/bankroll/seasons')

  return normalizeBankrollSeasonsResponse(data)
}

export const getBankrollSummary = async (params = {}) => {
  const data = await requestBankroll(
    `/api/bankroll/summary${buildBankrollSummaryQueryString(params)}`,
  )

  return normalizeBankrollSummary(data.summary)
}

export const getBankrollTransactions = async (params = {}) => {
  const data = await requestBankroll(
    `/api/bankroll/transactions${buildBankrollTransactionsQueryString(params)}`,
  )

  return normalizeBankrollTransactionsResponse(data)
}

export const initializeBankroll = async (draft) => {
  const data = await requestBankroll('/api/bankroll/initialize', {
    body: JSON.stringify(buildBankrollInitializationRequest(draft)),
    method: 'POST',
  })

  return {
    ...data,
    summary: normalizeBankrollSummary(data.summary),
  }
}

export const addBankrollDeposit = async (draft) => {
  const data = await requestBankroll('/api/bankroll/deposits', {
    body: JSON.stringify(buildBankrollCashTransactionRequest(draft)),
    method: 'POST',
  })

  return {
    ...data,
    summary: normalizeBankrollSummary(data.summary),
  }
}

export const addBankrollWithdrawal = async (draft, options = {}) => {
  const data = await requestBankroll('/api/bankroll/withdrawals', {
    body: JSON.stringify(buildBankrollCashTransactionRequest(draft, options)),
    method: 'POST',
  })

  return {
    ...data,
    summary: normalizeBankrollSummary(data.summary),
  }
}
