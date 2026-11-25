import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS, useStore } from '../store'
import { completeCanonicalFacts, migratePersistedPlan, refreshCanonicalFromLegacy } from '../engine/migration'
import { assertCanonicalPlan } from '../engine/modelValidation'
import { precisionGate } from '../engine/model'
import { recordCanonicalBudgets, disableCanonicalProjection, setCanonicalEstimateBudgetMode } from '../forms/canonicalProjectionCommands'
import { integratedHeldHomeEstateFixture } from '../engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'

const original = useStore.getState()
afterEach(() => { useStore.setState(original, true); vi.unstubAllGlobals() })
function reset(migrated = false) {
  vi.stubGlobal('window', {})
  const inputs = structuredClone(DEFAULT_INPUTS)
  const canonical = migrated ? migratePersistedPlan({ inputs }, 10, 2026) : refreshCanonicalFromLegacy(null, inputs)
  useStore.setState({ ...original, inputs, canonical, answerMeta: {}, questionAnswers: {}, draftByField: {} })
}
function record(working = 43_000, retired = useStore.getState().inputs.retirementSpending) {
  const state = useStore.getState()
  state.commitPlan(recordCanonicalBudgets(state, { working, retired, mortgageExcluded: false }, 2026))
}
function disable() {
  const state = useStore.getState()
  state.commitPlan(disableCanonicalProjection(state)!)
}
function reload() {
  const serialized = JSON.parse(JSON.stringify(useStore.getState()))
  serialized.canonical = completeCanonicalFacts(serialized.canonical, serialized.inputs)
  assertCanonicalPlan(serialized.canonical)
  useStore.setState(serialized)
}

describe('canonical opt-in and the estimate budget share lossless mode transitions', () => {
  it.each(['legacy', 'newDefinition'] as const)('restores the explicit v10 %s basis through repeat entry, reload and scenario restore', basis => {
    reset(true)
    useStore.getState().setBudgetChoice({ kind: 'migratedBasis', basis })
    const before = structuredClone(useStore.getState().canonical!)
    const revision = useStore.getState().inputRevision
    record()
    expect(useStore.getState().inputRevision).toBe(revision + 1)
    expect(useStore.getState().canonical?.deterministicProjection?.estimateBudgetMode).toBe('savingsBudget')
    record(44_000)
    useStore.getState().saveScenarioA()
    disable()
    expect(useStore.getState().canonical?.budget).toEqual(before.budget)
    useStore.getState().restoreScenarioA()
    reload()
    disable()
    expect(useStore.getState().canonical?.budget).toEqual(before.budget)
    expect(useStore.getState().canonical?.migration.budgetReconciliation).toMatchObject(before.migration.budgetReconciliation!)
    expect(useStore.getState().canonical?.migration.savingsBasisNeedsConfirmation).toBe(before.migration.savingsBasisNeedsConfirmation)
    expect(useStore.getState().questionAnswers['budget.method']).toBe('savingsBudget')
    expect(useStore.getState().resultRevision).toBeNull()
  })

  it('restores fresh debt-included and tax-benefit-excluded facts and their precision gate', () => {
    reset()
    useStore.getState().setBudgetChoice({ kind: 'debtIncluded', value: true })
    useStore.getState().setBudgetChoice({ kind: 'taxBenefitIncluded', value: false })
    const before = structuredClone(useStore.getState().canonical!)
    record(); reload(); disable()
    expect(useStore.getState().canonical?.budget).toEqual(before.budget)
    expect(precisionGate(useStore.getState().canonical!)).toEqual(precisionGate(before))
    expect(precisionGate(useStore.getState().canonical!).reasons).toContain('budgetBasisExcluded')
  })

  it.each([false, true])('preserves exact unknown facts, including partially answered=%s, without settling review', partial => {
    reset(true)
    if (partial) useStore.getState().setBudgetChoice({ kind: 'debtIncluded', value: false })
    const before = structuredClone(useStore.getState().canonical!)
    record(); reload(); disable()
    expect(useStore.getState().canonical?.budget).toEqual(before.budget)
    expect(useStore.getState().canonical?.migration.budgetReconciliation?.answered).toBe(before.migration.budgetReconciliation?.answered)
  })

  it('retains an income-origin mode and legitimate later working and retirement edits', () => {
    reset()
    useStore.getState().setBudgetChoice({ kind: 'mode', mode: 'incomeBudget' })
    record()
    useStore.getState().set({ budgetWorkingSpending: 51_000, retirementSpending: 47_000 })
    expect(useStore.getState().canonical?.deterministicProjection).toMatchObject({ estimateBudgetMode: 'incomeBudget', invalidated: true })
    reload(); disable()
    expect(useStore.getState().canonical?.budget).toEqual({ kind: 'incomeBudget', workingSpending: 51_000, retirementSpending: 47_000 })
  })

  it('honors later explicit mode and basis choices across rerecording and does not restore stale amounts', () => {
    reset()
    record()
    useStore.getState().setBudgetChoice({ kind: 'mode', mode: 'savingsBudget' })
    useStore.getState().setBudgetChoice({ kind: 'debtIncluded', value: false })
    useStore.getState().setBudgetChoice({ kind: 'taxBenefitIncluded', value: true })
    useStore.getState().set({ annualSavings: 31_000 })
    record(63_000, 46_000)
    useStore.getState().set({ retirementSpending: 47_000 })
    reload(); disable()
    expect(useStore.getState().canonical?.budget).toEqual({ kind: 'savingsBudget', annualNetSavings: 31_000, retirementSpending: 47_000,
      debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true } })
  })

  it('honors an explicit income choice even when canonical entry already uses income mode', () => {
    reset(); record()
    useStore.getState().setBudgetChoice({ kind: 'mode', mode: 'incomeBudget' })
    record(); disable()
    expect(useStore.getState().canonical?.budget.kind).toBe('incomeBudget')
  })

  it('does not rebuild or lose advanced evidence when only recording living budgets', () => {
    reset()
    const { plan } = integratedHeldHomeEstateFixture()
    useStore.setState({ canonical: plan, inputs: plan.legacyProjection })
    const before = structuredClone(plan)
    const state = useStore.getState()
    state.commitPlan(recordCanonicalBudgets(state, { working: 1520.10, retired: 300, mixed: 350, mortgageExcluded: true }, 2026))
    for (const key of ['people', 'accounts', 'debts', 'properties', 'annualHouseholdWorkingTfsaEvidence', 'annualTerminalEstateEvidence'] as const) expect(useStore.getState().canonical?.[key]).toEqual(before[key])
    disable()
    expect(useStore.getState().canonical?.budget.kind).toBe('incomeBudget')
  })

  it('rejects damaged return-mode metadata on hydration', () => {
    reset(); record()
    const damaged = JSON.parse(JSON.stringify(useStore.getState().canonical))
    damaged.deterministicProjection.estimateBudgetMode = 'invented'
    expect(() => assertCanonicalPlan(damaged)).toThrow(/estimateBudgetMode/)
  })

  it('records an independent return choice once without changing the current budget, facts or question answers', () => {
    reset(); record()
    useStore.getState().set({ budgetWorkingSpending: 51_000 })
    const before = structuredClone(useStore.getState().canonical!)
    const questions = structuredClone(useStore.getState().questionAnswers)
    const revision = useStore.getState().inputRevision
    const current = useStore.getState()
    current.commitPlan(setCanonicalEstimateBudgetMode(current, 'incomeBudget')!)
    expect(useStore.getState().inputRevision).toBe(revision + 1)
    expect(useStore.getState().resultRevision).toBeNull()
    const expected = structuredClone(before)
    expected.deterministicProjection!.estimateBudgetMode = 'incomeBudget'
    expect(useStore.getState().canonical).toEqual(expected)
    expect(useStore.getState().questionAnswers).toEqual(questions)
    expect(setCanonicalEstimateBudgetMode(useStore.getState(), 'incomeBudget')).toBeNull()
    reload(); disable()
    expect(useStore.getState().canonical?.budget).toEqual(before.budget)
  })

  it('can choose return to savings without changing the active income budget or archived savings facts', () => {
    reset(); record()
    const current = useStore.getState()
    current.commitPlan(setCanonicalEstimateBudgetMode(current, 'incomeBudget')!)
    const next = useStore.getState()
    const budget = structuredClone(next.canonical!.budget)
    next.commitPlan(setCanonicalEstimateBudgetMode(next, 'savingsBudget')!)
    expect(useStore.getState().canonical?.budget).toEqual(budget)
    record(); disable()
    expect(useStore.getState().canonical?.budget.kind).toBe('savingsBudget')
    expect(setCanonicalEstimateBudgetMode(useStore.getState(), 'incomeBudget')).toBeNull()
  })
})
