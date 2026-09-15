import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS, useStore } from '../store'
import { completeCanonicalFacts, migratePersistedPlan } from '../engine/migration'
import { assertCanonicalPlan } from '../engine/modelValidation'
import type { BudgetMode } from '../engine/model'

/**
 * BE-13 A end to end at the store boundary: both entry modes record the same
 * canonical budget facts, the facts persist through edits, a mode switch and a
 * reload, and no default value ever overwrites an answer the user gave.
 */

const original = useStore.getState()
afterEach(() => {
  useStore.setState(original, true)
  vi.unstubAllGlobals()
})

const reset = () => {
  vi.stubGlobal('window', {})
  useStore.setState({ ...original, inputs: structuredClone(DEFAULT_INPUTS), canonical: null, answerMeta: {}, questionAnswers: {} })
}

/** Open an unrecorded plan the way the app does on a first keystroke. */
const openFreshPlan = (): void => {
  reset()
  useStore.getState().set({ annualSavings: DEFAULT_INPUTS.annualSavings })
}

/** Install a persisted v10 plan the way hydration does: both views together. */
const openMigratedPlan = (): void => {
  reset()
  const inputs = {
    ...structuredClone(DEFAULT_INPUTS),
    annualSavings: 24_000,
    debts: [{ kind: 'carLoan' as const, balance: 12_000, annualPayment: 6_000, yearsRemaining: 2 }],
  }
  const canonical = migratePersistedPlan({ inputs }, 10, new Date().getFullYear())
  assertCanonicalPlan(canonical)
  useStore.setState({ inputs: canonical.legacyProjection, canonical, answerMeta: {} })
}

const savings = (): Extract<BudgetMode, { kind: 'savingsBudget' }> => {
  const budget = useStore.getState().canonical!.budget
  if (budget.kind !== 'savingsBudget') throw new Error('expected a savings budget')
  return budget
}

/** A same-version persist hydration is `merge(persisted, current)`; the
 *  canonical plan and its budget facts must survive it unchanged. */
const reload = (): void => {
  const persisted = {
    inputs: structuredClone(useStore.getState().inputs),
    canonical: structuredClone(useStore.getState().canonical),
    answerMeta: { ...useStore.getState().answerMeta },
    questionAnswers: { ...useStore.getState().questionAnswers },
  }
  useStore.setState({ ...original, inputs: structuredClone(DEFAULT_INPUTS), canonical: null, answerMeta: {}, questionAnswers: {} })
  useStore.setState(persisted as never)
  if (persisted.canonical) useStore.setState({ canonical: completeCanonicalFacts(persisted.canonical, persisted.inputs) })
}

describe('BE-13 A store budget facts', () => {
  it('records the mode and both answers, and keeps them through edits, a mode switch and a reload', () => {
    openFreshPlan()
    const choice = useStore.getState().setBudgetChoice
    const before = (): { inputs: unknown; budget: unknown } => ({ inputs: structuredClone(useStore.getState().inputs), budget: structuredClone(useStore.getState().canonical?.budget) })

    // A fresh plan starts unanswered, and answering one flag never answers the
    // other or asserts anything the user has not given.
    expect(savings().debtIncluded.status).toBe('unknown')
    choice({ kind: 'debtIncluded', value: true })
    expect(savings().taxBenefitIncluded.status).toBe('unknown')
    choice({ kind: 'taxBenefitIncluded', value: true })
    choice({ kind: 'mode', mode: 'savingsBudget' })
    expect(savings().debtIncluded).toEqual({ status: 'known', value: true })
    expect(savings().taxBenefitIncluded).toEqual({ status: 'known', value: true })
    expect(useStore.getState().answerMeta['budget.debtIncluded']?.status).toBe('confirmed')
    // Answering one flag does not settle the migration question; only an answer
    // other than "both are included" does.
    expect(useStore.getState().canonical?.migration.budgetReconciliation).toMatchObject({ answered: true })

    // An amount edit changes only the amount.
    useStore.getState().set({ annualSavings: 30_000 })
    expect(useStore.getState().canonical?.budget).toMatchObject({ annualNetSavings: 30_000, debtIncluded: { status: 'known', value: true } })

    // The entryMode preference changes no financial input and does not add the
    // recorded tax benefit a second time.
    const settled = before()
    useStore.getState().setEntryMode('professional')
    useStore.getState().setEntryMode('guided')
    expect(before()).toEqual(settled)
    expect(savings().annualNetSavings).toBe(30_000)

    reload()
    expect(useStore.getState().canonical?.budget).toEqual(settled.budget)
    expect(useStore.getState().inputs.annualSavings).toBe(30_000)
    assertCanonicalPlan(useStore.getState().canonical)
  })

  it('keeps a recorded answer through a mode round-trip and a migrated figure through reload', () => {
    openFreshPlan()
    const choice = useStore.getState().setBudgetChoice
    choice({ kind: 'migratedBasis', basis: 'newDefinition' })
    choice({ kind: 'mode', mode: 'incomeBudget' })
    expect(useStore.getState().canonical?.budget).toEqual({ kind: 'incomeBudget', workingSpending: 0, retirementSpending: DEFAULT_INPUTS.retirementSpending })
    // Recorded working spending round-trips through the legacy form, and an
    // answered "no" survives every later edit.
    useStore.getState().set({ budgetWorkingSpending: 61_000, annualSavings: 12_000 })
    reload()
    expect(useStore.getState().canonical?.budget).toEqual({ kind: 'incomeBudget', workingSpending: 61_000, retirementSpending: DEFAULT_INPUTS.retirementSpending })
    assertCanonicalPlan(useStore.getState().canonical)

    // Returning restores the recorded answers, not a fresh default.
    choice({ kind: 'mode', mode: 'savingsBudget' })
    choice({ kind: 'taxBenefitIncluded', value: false })
    reload()
    expect(savings().debtIncluded).toEqual({ status: 'known', value: true })
    expect(savings().taxBenefitIncluded).toEqual({ status: 'known', value: false })
    expect(useStore.getState().canonical?.migration.budgetReconciliation).toMatchObject({ answered: true })

    // A persisted v10 figure is presented for review, and its answer is a
    // reviewable statement that survives a reload without changing the number.
    openMigratedPlan()
    expect(useStore.getState().canonical?.migration.budgetReconciliation).toMatchObject({ answered: false, legacyAnnualDebtPayments: 6_000 })
    expect(savings().debtIncluded.status).toBe('unknown')
    useStore.getState().setBudgetChoice({ kind: 'migratedBasis', basis: 'legacy' })
    expect(useStore.getState().canonical?.budget).toMatchObject({
      kind: 'savingsBudget', annualNetSavings: 24_000,
      debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: false },
    })
    // Scenario A keeps the same recorded facts and restores them unchanged.
    useStore.getState().saveScenarioA()
    expect(useStore.getState().scenarioACanonical?.budget).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'known', value: false } })
    useStore.getState().setBudgetChoice({ kind: 'taxBenefitIncluded', value: true })
    useStore.getState().restoreScenarioA()
    expect(useStore.getState().canonical?.budget).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: false } })
    reload()
    expect(useStore.getState().canonical?.budget).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'known', value: false } })
    expect(useStore.getState().canonical?.migration.budgetReconciliation).toMatchObject({ answered: true, legacyAnnualDebtPayments: 6_000 })
  })
})
