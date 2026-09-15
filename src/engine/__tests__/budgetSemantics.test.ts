import { describe, expect, it } from 'vitest'
import { budgetFacts, canonicalBudgetForChoice, cashBudget, listedAnnualDebtPayments, reconciledBudget } from '../budgetSemantics'
import type { BudgetMode, InputsV2 } from '../model'
import type { Inputs } from '../types'

/**
 * BE-13 A. Independent expected values for "what does the recorded saving
 * figure mean". The three refusal situations used to share one generic message;
 * these tests pin a distinct outcome and a distinct reason to each.
 */

const savings = (overrides: Partial<Extract<BudgetMode, { kind: 'savingsBudget' }>> = {}): BudgetMode => ({
  kind: 'savingsBudget', annualNetSavings: 40_000, retirementSpending: 50_000,
  debtIncluded: { status: 'unknown', reason: 'legacy savings/debt treatment needs confirmation' },
  taxBenefitIncluded: { status: 'unknown', reason: 'legacy tax benefit treatment needs confirmation' },
  ...overrides,
})

const legacy = (overrides: Partial<Inputs> = {}): Pick<Inputs, 'annualSavings' | 'retirementSpending' | 'budgetWorkingSpending'> => ({
  annualSavings: 24_000, retirementSpending: 50_000, budgetWorkingSpending: null, ...overrides,
})

describe('BE-13 A budget facts', () => {
  it('reports an unanswered flag as a fact the user must supply, naming each one', () => {
    const both = budgetFacts(savings())
    expect(both).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.debtIncluded', 'budget.taxBenefitIncluded'] })

    const debtOnly = budgetFacts(savings({ debtIncluded: { status: 'known', value: true } }))
    expect(debtOnly).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.taxBenefitIncluded'] })

    const taxOnly = budgetFacts(savings({ taxBenefitIncluded: { status: 'known', value: true } }))
    expect(taxOnly).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.debtIncluded'] })
  })

  it('never turns an unknown flag into a confirmed one, and never turns a confirmed one back into unknown', () => {
    const unanswered = budgetFacts(savings())
    expect(unanswered.status).toBe('needs-facts')
    // An unknown flag is not a false one: the two answered-false shapes below
    // are a different outcome, with their own reason.
    const debtFalse = budgetFacts(savings({ debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true } }))
    const taxFalse = budgetFacts(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false } }))
    expect(debtFalse).toMatchObject({ status: 'unsupported' })
    expect(taxFalse).toMatchObject({ status: 'unsupported' })
    expect(debtFalse.status === 'unsupported' && debtFalse.detail).toContain('separately listed debt payments')
    expect(taxFalse.status === 'unsupported' && taxFalse.detail).toContain('registered-contribution tax benefit')
    expect(debtFalse.status === 'unsupported' && debtFalse.detail).not.toBe(taxFalse.status === 'unsupported' && taxFalse.detail)
  })

  it('names incomeBudget as its own out-of-scope reason rather than a savings-budget failure', () => {
    const facts = budgetFacts({ kind: 'incomeBudget', workingSpending: 60_000, retirementSpending: 50_000 })
    expect(facts.status).toBe('income-budget')
    expect(facts.status === 'income-budget' && facts.detail).toContain('out of scope for BE-13 A')
    expect(facts.status === 'income-budget' && facts.detail).not.toContain('savings budget')
  })

  it('prices only the fully answered savings shape, keeping a real zero as zero', () => {
    const ready = budgetFacts(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    expect(ready).toEqual({ status: 'ready', annualNetSavings: 40_000 })
    const zero = budgetFacts(savings({ annualNetSavings: 0, debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    expect(zero).toEqual({ status: 'ready', annualNetSavings: 0 })
    // An unanswered plan is never priced at zero.
    expect(cashBudget(savings(), 2027, 2026, 0.021)).toBeNull()
    expect(cashBudget({ kind: 'incomeBudget', workingSpending: 1, retirementSpending: 1 }, 2027, 2026, 0.021)).toBeNull()
    const priced = cashBudget(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }), 2027, 2026, 0.021)
    expect(priced).toBeCloseTo(40_000 * 1.021, 10)
  })

  it('reports an unpriceable amount as invalid instead of substituting a number', () => {
    const facts = budgetFacts(savings({ annualNetSavings: Number.NaN, debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    expect(facts).toMatchObject({ status: 'invalid' })
  })
})

describe('BE-13 A canonical budget construction', () => {
  it('writes only the answers the user gave and keeps the recorded amount verbatim', () => {
    expect(canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: true, taxBenefitIncluded: false })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false },
    })
  })

  it('keeps an unrecorded working spending at zero instead of borrowing the retirement figure', () => {
    const income = canonicalBudgetForChoice(legacy({ budgetWorkingSpending: null }), { mode: 'incomeBudget' })
    expect(income).toEqual({ kind: 'incomeBudget', workingSpending: 0, retirementSpending: 50_000 })
    const recorded = canonicalBudgetForChoice(legacy({ budgetWorkingSpending: 62_000 }), { mode: 'incomeBudget' })
    expect(recorded).toEqual({ kind: 'incomeBudget', workingSpending: 62_000, retirementSpending: 50_000 })
  })

  it('keeps the legacy approximation explicit while an unanswered plan asserts nothing', () => {
    expect(reconciledBudget(legacy(), { keepLegacy: false })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true },
    })
    // Keeping the legacy approximation means the number stays net of the debt
    // and without the tax benefit: the v10 meaning, stated explicitly.
    expect(reconciledBudget(legacy(), { keepLegacy: true })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: false },
    })
    // Nothing here writes a fact for the plan that has not answered.
    expect(budgetFacts(savings()).status).toBe('needs-facts')
  })

  it('sums only the listed debt rows as the reconciliation baseline', () => {
    expect(listedAnnualDebtPayments({ debts: [{ annualPayment: 6_000 }, { annualPayment: 1_500.5 }] } as Pick<InputsV2, 'debts'>)).toBeCloseTo(7_500.5, 10)
  })
})
