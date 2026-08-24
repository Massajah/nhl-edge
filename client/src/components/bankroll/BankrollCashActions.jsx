import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  addBankrollDeposit,
  addBankrollWithdrawal,
} from '../../services/bankrollApi.js'
import { validateBankrollCashTransaction } from '../../utils/bankroll.js'

const createCashDraft = (todayInputValue) => ({
  amount: '',
  description: '',
  occurredAt: todayInputValue,
})

function BankrollCashActions({
  availableBankroll,
  currency,
  currentBankroll,
  todayInputValue,
  onTransactionRecorded,
}) {
  const [cashMode, setCashMode] = useState('')
  const [cashDraft, setCashDraft] = useState(() =>
    createCashDraft(todayInputValue),
  )
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const validation = useMemo(
    () =>
      validateBankrollCashTransaction(cashDraft, {
        currentBankroll: availableBankroll,
        today: todayInputValue,
        type: cashMode || 'DEPOSIT',
      }),
    [availableBankroll, cashDraft, cashMode, todayInputValue],
  )
  const isSaving = status === 'saving'

  const openCashForm = (mode) => {
    setCashMode(mode)
    setCashDraft(createCashDraft(todayInputValue))
    setStatus('idle')
    setMessage('')
  }

  const changeDraft = (field, value) => {
    setCashDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
    setStatus('idle')
    setMessage('')
  }

  const submitCashTransaction = async (event) => {
    event.preventDefault()

    if (!validation.isValid) {
      setStatus('error')
      setMessage(validation.message)
      return
    }

    setStatus('saving')
    setMessage('')

    try {
      const result =
        cashMode === 'WITHDRAWAL'
          ? await addBankrollWithdrawal(cashDraft, {
              currentBankroll,
              type: 'WITHDRAWAL',
            })
          : await addBankrollDeposit(cashDraft)
      const completedMode = cashMode

      setCashMode('')
      setCashDraft(createCashDraft(todayInputValue))
      setStatus('success')
      setMessage(
        completedMode === 'WITHDRAWAL'
          ? 'Withdrawal recorded.'
          : 'Deposit recorded.',
      )
      await onTransactionRecorded(result, completedMode)
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    }
  }

  return (
    <div className="bankroll-cash-section">
      <div className="bankroll-cash-actions">
        <button
          aria-expanded={cashMode === 'DEPOSIT'}
          className="bankroll-deposit-button"
          type="button"
          disabled={isSaving}
          onClick={() => openCashForm('DEPOSIT')}
        >
          <Plus aria-hidden="true" size={15} />
          <span>Add Deposit</span>
        </button>
        <button
          aria-expanded={cashMode === 'WITHDRAWAL'}
          className="bankroll-withdrawal-button"
          type="button"
          disabled={isSaving}
          onClick={() => openCashForm('WITHDRAWAL')}
        >
          <Minus aria-hidden="true" size={15} />
          <span>Add Withdrawal</span>
        </button>
      </div>

      {cashMode ? (
        <BankrollCashForm
          cashDraft={cashDraft}
          cashMode={cashMode}
          currency={currency}
          isSaving={isSaving}
          todayInputValue={todayInputValue}
          validation={validation}
          onCashDraftChange={changeDraft}
          onSubmitCashTransaction={submitCashTransaction}
        />
      ) : null}

      {message ? (
        <p className={`form-status ${status}`} role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}

function BankrollCashForm({
  cashDraft,
  cashMode,
  currency,
  isSaving,
  todayInputValue,
  validation,
  onCashDraftChange,
  onSubmitCashTransaction,
}) {
  const modeLabel = cashMode === 'WITHDRAWAL' ? 'Withdrawal' : 'Deposit'

  return (
    <form className="bankroll-cash-form" onSubmit={onSubmitCashTransaction}>
      <label className="field tracker-field" htmlFor="bankroll-cash-amount">
        <span>{modeLabel} Amount</span>
        <input
          aria-invalid={Boolean(validation.fieldErrors.amount)}
          id="bankroll-cash-amount"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          type="number"
          value={cashDraft.amount}
          onChange={(event) =>
            onCashDraftChange('amount', event.target.value)
          }
        />
        <small className="field-error-slot">
          {validation.fieldErrors.amount || currency}
        </small>
      </label>

      <label className="field tracker-field" htmlFor="bankroll-cash-date">
        <span>Date</span>
        <input
          aria-invalid={Boolean(validation.fieldErrors.occurredAt)}
          id="bankroll-cash-date"
          max={todayInputValue}
          type="date"
          value={cashDraft.occurredAt}
          onChange={(event) =>
            onCashDraftChange('occurredAt', event.target.value)
          }
        />
        <small className="field-error-slot">
          {validation.fieldErrors.occurredAt || ' '}
        </small>
      </label>

      <label
        className="field tracker-field"
        htmlFor="bankroll-cash-description"
      >
        <span>Description</span>
        <input
          id="bankroll-cash-description"
          type="text"
          value={cashDraft.description}
          onChange={(event) =>
            onCashDraftChange('description', event.target.value)
          }
        />
        <small className="field-error-slot"> </small>
      </label>

      <div className="bankroll-form-actions">
        <button type="submit" disabled={isSaving}>
          {cashMode === 'WITHDRAWAL' ? (
            <Minus aria-hidden="true" size={15} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )}
          <span>{isSaving ? 'Saving...' : `Save ${modeLabel}`}</span>
        </button>
      </div>
    </form>
  )
}

export { BankrollCashForm }
export default BankrollCashActions
