import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { completeCanonicalFacts, migratePersistedPlan, refreshCanonicalFromLegacy } from '../migration'
import { assertCanonicalPlan } from '../modelValidation'
import type { Inputs } from '../types'
import type { InputsV2 } from '../model'

/**
 * BE-13 A. A v10 `annualSavings` figure was net of separately listed debt
 * payments; the new `savingsBudget` definition is not. Migration must present
 * the legacy value and let the user state what it means — never silently
 * reinterpret the number, never turn an unanswered fact into a confirmed one.
 */

const legacyInputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  ...structuredClone(DEFAULT_INPUTS),
  annualSavings: 24_000,
  retirementSpending: 50_000,
  debts: [{ kind: 'carLoan', balance: 12_000, annualPayment: 6_000, yearsRemaining: 2 }],
  ...overrides,
})

/** A persisted v10 plan: the migration input the store hands to hydration. */
const v10Plan = (inputs = legacyInputs()): InputsV2 => migratePersistedPlan({ inputs }, 10, 2026)

const reconciliations = (plan: InputsV2) => plan.migration.budgetReconciliation

describe('BE-13 A migration reconciliation', () => {
  it('keeps the v10 figure verbatim and records an explicit, unanswered basis', () => {
    const plan = v10Plan()
    expect(plan.budget).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'unknown', reason: 'legacy savings/debt treatment needs confirmation' },
      taxBenefitIncluded: { status: 'unknown', reason: 'legacy tax benefit treatment needs confirmation' },
    })
    // The reconciliation baseline is the listed debt the v10 plan amortised.
    expect(plan.migration.budgetReconciliation?.legacyAnnualDebtPayments).toBe(6_000)
    expect(reconciliations(plan)).toMatchObject({ answered: false })
    expect(plan.migration.budgetReconciliation?.savingsBasis).toBeUndefined()
    assertCanonicalPlan(plan)
  })

  it('does not default an unanswered plan to included', () => {
    const plan = v10Plan()
    if (plan.budget.kind !== 'savingsBudget') throw new Error('expected a savings budget')
    expect(plan.budget.debtIncluded.status).toBe('unknown')
    expect(plan.budget.taxBenefitIncluded.status).toBe('unknown')
    // Re-hydrating the same plan through completion leaves the facts unknown.
    assertCanonicalPlan(completeCanonicalFacts(plan, legacyInputs()))
    const completed = completeCanonicalFacts(plan, legacyInputs())
    expect(completed.budget).toEqual(plan.budget)
    // A plan first entered in this UI has no legacy wording to reinterpret, and
    // still starts unanswered.
    const fresh = refreshCanonicalFromLegacy(null, structuredClone(DEFAULT_INPUTS))
    expect(fresh.budget).toEqual({
      kind: 'savingsBudget', annualNetSavings: DEFAULT_INPUTS.annualSavings, retirementSpending: DEFAULT_INPUTS.retirementSpending,
      debtIncluded: { status: 'unknown', reason: 'legacy savings/debt treatment needs confirmation' },
      taxBenefitIncluded: { status: 'unknown', reason: 'legacy tax benefit treatment needs confirmation' },
    })
  })

  it('keeps a settled meaning when the legacy number is edited, and never flips an answer', () => {
    const settled: InputsV2 = {
      ...v10Plan(),
      migration: { ...v10Plan().migration, sourcePersistVersion: 11, budgetReconciliation: { answered: true, legacyAnnualDebtPayments: 6_000 } },
      budget: { kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000, debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true } },
    }
    expect(reconciliations(settled)).toMatchObject({ answered: true })
    const edited = refreshCanonicalFromLegacy(settled, { ...settled.legacyProjection, annualSavings: 30_000 })
    // The number follows the form; the recorded answers are untouched.
    expect(edited.budget).toEqual({
      kind: 'savingsBudget', annualNetSavings: 30_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true },
    })
    const spending = refreshCanonicalFromLegacy(edited, { ...edited.legacyProjection, retirementSpending: 55_000 })
    expect(spending.budget).toEqual({
      kind: 'savingsBudget', annualNetSavings: 30_000, retirementSpending: 55_000,
      debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true },
    })
    assertCanonicalPlan(spending)
  })

  it('round-trips the income budget and its working spending through the legacy form', () => {
    const income: InputsV2 = {
      ...v10Plan(),
      budget: { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 50_000 },
    }
    // Recorded working spending is the legacy form's, and a mode switch does
    // not reset it.
    const refreshed = refreshCanonicalFromLegacy(income, { ...income.legacyProjection, budgetWorkingSpending: 62_000 })
    expect(refreshed.budget).toEqual({ kind: 'incomeBudget', workingSpending: 62_000, retirementSpending: 50_000 })
    assertCanonicalPlan(refreshed)
  })
})
