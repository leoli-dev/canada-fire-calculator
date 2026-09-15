import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan } from '../migration'
import type { BudgetMode, InputsV2 } from '../model'
import { annualStep, initializeState, type AnnualProviders } from '../annualState'
import { reconciledBudget } from '../budgetSemantics'
import { runProjection } from '../projection'

/**
 * BE-13 A. The kernel used to answer one generic "budget treatment not yet
 * reconciled" for three different situations. These tests pin a distinct status
 * and a distinct reason to each, and prove the supported shape is unchanged.
 */

const input = (): Inputs => ({
  currentAge: 40, fireAge: 60, lifeExpectancy: 90, province: 'ON', annualSavings: 40,
  savingsSplit: { tfsa: .5, rrsp: .5, nonReg: 0 }, retirementSpending: 50,
  returns: { tfsa: .1, rrsp: .1, nonReg: .1 }, balances: { tfsa: 100, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  debts: [{ id: 'loan', kind: 'carLoan', balance: 10, annualPayment: 10, yearsRemaining: 1 }],
})

const plan = (budget: BudgetMode, baseYear = new Date().getFullYear()): InputsV2 => {
  const result = migratePersistedPlan({ inputs: input() }, 10, baseYear)
  result.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  result.budget = budget
  for (const account of result.accounts) account.contributionRoom = { status: 'known', value: 1_000 }
  for (const person of result.people) { person.tfsaAvailableRoom = { status: 'known', value: 1_000 }; person.rrspAvailableRoom = { status: 'known', value: 1_000 } }
  return result
}

/** Income 120, tax 20, spending 50 and the 10 listed debt payment leave 40. */
const providers = (): AnnualProviders => ({
  evaluate: ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, { income: 120, earnedIncome: 120, benefits: 0, tax: 20, spending: 50, taxableIncome: 120, benefitIncomeForNextYear: { status: 'known' as const, value: 120 } }])) }),
  returns: () => .1,
})

const savings = (overrides: Partial<Extract<BudgetMode, { kind: 'savingsBudget' }>> = {}): BudgetMode => ({
  kind: 'savingsBudget', annualNetSavings: 40, retirementSpending: 50,
  debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true }, ...overrides,
})

/* The refusal must come from the budget check: a broken opening snapshot would
   masquerade as the budget reason. */
const failure = (canonical: InputsV2): { status: string; detail: string } => {
  const opening = initializeState(canonical)
  if (opening.status !== 'ok') throw new Error(`opening state was not valid: ${opening.issues[0]?.detail}`)
  const result = annualStep(canonical, opening.value, providers())
  if (result.status === 'ok') throw new Error('expected a refusal')
  return { status: result.status, detail: result.issues[0].detail }
}

describe('BE-13 A differentiated budget refusal', () => {
  it('refuses an unanswered flag as "the user must answer this", not as a modelling gap', () => {
    const result = failure(plan(savings({ debtIncluded: { status: 'unknown', reason: 'legacy savings/debt treatment needs confirmation' } })))
    expect(result.status).toBe('unsupported')
    expect(result.detail).toContain('the user must answer budget.debtIncluded')
    expect(result.detail).toContain('before a savings budget can be priced')
  })

  it('refuses an answered-false flag with that component named, and with a different reason per flag', () => {
    const debt = failure(plan(savings({ debtIncluded: { status: 'known', value: false } })))
    const tax = failure(plan(savings({ taxBenefitIncluded: { status: 'known', value: false } })))
    expect(debt.status).toBe('unsupported')
    expect(tax.status).toBe('unsupported')
    expect(debt.detail).toContain('cannot yet add them back to a cash budget')
    expect(tax.detail).toContain('cannot yet add it as refund cash')
    expect(debt.detail).not.toBe(tax.detail)
    // Neither answered-false reason is the unanswered one.
    expect(debt.detail).not.toContain('the user must answer')
    expect(tax.detail).not.toContain('the user must answer')
  })

  it('declares incomeBudget with its own reason instead of a savings-budget message', () => {
    const result = failure(plan({ kind: 'incomeBudget', workingSpending: 60, retirementSpending: 50 }))
    expect(result.detail).toContain('out of scope for BE-13 A')
    expect(result.detail).not.toContain('savings budget')
  })

  it('still prices the supported shape: both flags known true, unchanged', () => {
    const canonical = plan(savings())
    const opening = initializeState(canonical)
    expect(opening.status).toBe('ok')
    if (opening.status !== 'ok') throw new Error('unreachable')
    const result = annualStep(canonical, opening.value, providers())
    if (result.status !== 'ok') throw new Error(`supported shape was refused: ${result.issues[0].detail}`)
    expect(result.value.row.cashLedger).toMatchObject({ income: 120, tax: 20, spending: 50, debtPayments: 10, voluntaryContributions: 40, unallocated: 0 })
  })

  it('keeps the flag-specific refusal and the priced result when the presentation gate fires', () => {
    // Review fix B2: `precisionGate` is presentation-only. The kernel still
    // opens and refuses these shapes with the budget's own reason, and the
    // projection still prices the same number and the same tax capability.
    const excluded = plan(savings({ debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: false } }))
    const opening = initializeState(excluded)
    expect(opening.status).toBe('ok')
    const refused = failure(excluded)
    expect(refused.status).toBe('unsupported')
    expect(refused.detail).toContain('cannot yet add them back to a cash budget')
    expect(refused.detail).not.toContain('budgetBasisExcluded')

    const priced = (canonical: InputsV2) => runProjection(input(), undefined, canonical)
    const legacyKept = priced(plan(reconciledBudget({ annualSavings: 40, retirementSpending: 50 }, { keepLegacy: true })))
    const adopted = priced(plan(reconciledBudget({ annualSavings: 40, retirementSpending: 50 }, { keepLegacy: false })))
    expect(legacyKept.finalNetWorth).toBe(adopted.finalNetWorth)
    expect(legacyKept.taxCapability?.status).toBe(adopted.taxCapability?.status)
  })
})
