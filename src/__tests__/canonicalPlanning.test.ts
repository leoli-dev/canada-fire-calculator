import { describe, expect, it } from 'vitest'
import { evaluateCanonicalCandidates, type CanonicalPlanningCandidate } from '../canonicalPlanning'
import { selectDeterministicResult } from '../deterministicResult'
import { projectCanonicalCoverage } from '../engine/annualState'
import type { InputsV2 } from '../engine/model'
import { integratedHeldHomeEstateFixture, heldHomeEstateIds as ids } from '../engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { known, recorded, retirementPlan } from '../engine/__tests__/fixtures/retirementSettlement'
import { runProjection } from '../engine'

const evidence = { nonRegAbsent: false }
const baseline = { retirementAge: 58, retirementSpending: 300 }

function heldHome() {
  const { plan, spending } = integratedHeldHomeEstateFixture()
  plan.deterministicProjection = { mode: 'canonical', spending, provenance: recorded }
  return plan
}

function solo() {
  const plan = retirementPlan({ age: 58, tfsa: 190_000, rrsp: 0, spending: 1_000, strategy: 'tfsaFirst' })
  plan.lifeExpectancy = 85
  plan.people[0].retirementAge = 59
  plan.people[0].earnedIncome = known(12_000)
  plan.budget = { kind: 'incomeBudget', workingSpending: 11_298.65, retirementSpending: 1_000 }
  Object.assign(plan.legacyProjection, { fireAge: 59, lifeExpectancy: 85 })
  plan.deterministicProjection = { mode: 'canonical', provenance: recorded,
    spending: { workingSpending: known(11_298.65), retirementSpending: known(1_000) } }
  return plan
}

function direct(plan: InputsV2) {
  const self = plan.people.find(person => person.role === 'self')!
  const result = projectCanonicalCoverage(plan, plan.deterministicProjection!.spending, plan.lifeExpectancy - self.ageInBaseYear + 1)
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

// Update the independent replay fixture explicitly and call the annual engine
// directly. The reference never uses the candidate evaluator or selector.
function withLivingBudget(source: InputsV2, amount: number) {
  const plan = structuredClone(source)
  plan.budget.retirementSpending = amount
  plan.legacyProjection.retirementSpending = amount
  plan.deterministicProjection!.spending.retirementSpending = known(amount)
  return plan
}

function evaluate(plan: InputsV2, ...candidates: CanonicalPlanningCandidate[]) {
  return evaluateCanonicalCandidates(plan.legacyProjection, plan, evidence, candidates)
}

describe('canonical planning replays', () => {
  it('distinguishes completed zero, event-only and living gaps and matches independent owner ledgers', () => {
    const plan = heldHome()
    const before = structuredClone(plan)
    const candidates = [baseline, { ...baseline, retirementSpending: 0 }, { ...baseline, retirementSpending: 500 }]
    const [eventOnly, zero, both] = evaluate(plan, ...candidates)
    expect(eventOnly).toMatchObject({ status: 'complete-with-gaps', livingGapYears: [], eventGapYears: [2028] })
    expect(zero).toMatchObject({ status: 'complete-zero-gaps', livingGapYears: [], eventGapYears: [] })
    expect(both).toMatchObject({ status: 'complete-with-gaps', livingGapYears: [2028], eventGapYears: [2028] })
    expect(eventOnly.result).toStrictEqual(selectDeterministicResult(plan.legacyProjection, plan, evidence))
    for (const outcome of [eventOnly, zero, both]) {
      expect(outcome.result?.coverage).toStrictEqual(direct(withLivingBudget(before, outcome.candidate.retirementSpending)))
      expect(outcome.result?.coverage?.rows.at(-1)?.householdExpense?.eventId).toBe(ids.expense)
    }
    expect(eventOnly.result?.coverage?.rows.at(-1)?.householdExpense).toMatchObject({ due: 100, paid: 69, unmet: 31 })
    expect(plan).toStrictEqual(before)
    expect(eventOnly.candidate).not.toBe(candidates[0])

    const noEvent = structuredClone(before)
    delete noEvent.annualHouseholdExpenseEvidence
    const [livingOnly] = evaluate(noEvent, candidates[2])
    expect(livingOnly).toMatchObject({ status: 'complete-with-gaps', livingGapYears: [2028], eventGapYears: [] })
    expect(livingOnly.result?.coverage).toStrictEqual(direct(withLivingBudget(noEvent, 500)))
  })

  it('replays self retirement while preserving the other owner, title and the dated evidence', () => {
    const plan = heldHome()
    const before = structuredClone(plan)
    const manual = withLivingBudget(plan, 250)
    manual.people[0].retirementAge = 59
    manual.legacyProjection.fireAge = 59
    const [candidate] = evaluate(plan, { retirementAge: 59, retirementSpending: 250 })
    expect(candidate).toMatchObject({ status: 'partial', livingGapYears: [], eventGapYears: [], result: {
      coverage: { blocked: { year: 2027 }, uncomputedYears: [2028], overallConclusionAvailable: false },
    } })
    expect(candidate.result?.coverage).toStrictEqual(direct(manual))
    expect(plan).toStrictEqual(before)

    const soloPlan = solo()
    const delayed = structuredClone(soloPlan)
    delayed.people[0].retirementAge = 60
    delayed.legacyProjection.fireAge = 60
    const [later] = evaluate(soloPlan, { retirementAge: 60, retirementSpending: 1_000 })
    expect(later.status).toBe('complete-zero-gaps')
    expect(later.result?.coverage).toStrictEqual(direct(delayed))
    expect(later.result?.coverage?.rows.slice(0, 3).map(row => row.cashLedger.income)).toEqual([12_000, 12_000, 0])
  })

  it('retains the committed prefix and uncomputed suffix when the dated event refuses partial settlement', () => {
    const plan = heldHome()
    plan.lifeExpectancy = plan.legacyProjection.lifeExpectancy = 61
    Object.assign(plan.annualHouseholdExpenseEvidence!, { allowPartialPayment: false })
    const [candidate] = evaluate(plan, baseline)
    expect(candidate).toMatchObject({ status: 'partial', livingGapYears: [], eventGapYears: [], result: {
      coverage: { blocked: { year: 2028 }, uncomputedYears: [2029, 2030], overallConclusionAvailable: false },
    } })
    expect(candidate.result?.coverage).toStrictEqual(direct(plan))
    expect(candidate.result?.coverage?.rows.map(row => row.year)).toEqual([2026, 2027])
  })

  it.each(['cppAmountSource', 'oasAmountSource'] as const)('preserves a recorded zero benefit and its %s retirement premise', field => {
    const plan = solo()
    plan.people[0][field] = { source: 'statement', sourceYear: 2026, basis: 'annual', ageBasis: 65,
      dollarBasis: 'today', premises: { retirementAge: 59 } }
    const before = structuredClone(plan)
    const [same, changed] = evaluate(plan, { retirementAge: 59, retirementSpending: 1_000 }, { retirementAge: 60, retirementSpending: 1_000 })
    expect(same.status).toBe('complete-zero-gaps')
    expect(same.result?.coverage).toStrictEqual(direct(plan))
    expect(changed).toMatchObject({ status: 'unsupported', reason: 'benefit-premise-review', result: null })
    expect(plan).toStrictEqual(before)
  })

  it.each([
    { field: 'fireAge', invalid: 56, unrelated: { ...baseline, retirementSpending: 0 } },
    { field: 'retirementSpending', invalid: -1, unrelated: { ...baseline, retirementAge: 59 } },
  ] as const)('retains invalid $field for an identical or unrelated candidate', ({ field, invalid, unrelated }) => {
    const plan = heldHome()
    const inputs = { ...plan.legacyProjection, [field]: invalid }
    const original = selectDeterministicResult(inputs, plan, evidence)
    const [same, changed] = evaluateCanonicalCandidates(inputs, plan, evidence, [baseline, unrelated])
    expect(original).toMatchObject({ route: 'canonical', status: 'invalid', validationIssues: [{ field }] })
    expect(same.status).toBe('invalid')
    expect(same.result).toStrictEqual(original)
    expect(changed.status).toBe('invalid')
    expect(changed.result).toStrictEqual(original)
    expect(inputs[field]).toBe(invalid)
  })

  it('keeps invalidated and missing budget evidence, rejects invalid values, and marks unchecked candidates', () => {
    const plan = heldHome()
    plan.deterministicProjection!.spending.retirementSpending = { status: 'unknown', reason: 'retirement amount unverified' }
    const selection = selectDeterministicResult(plan.legacyProjection, plan, evidence)
    const [unknown] = evaluate(plan, baseline)
    expect(unknown.status).toBe('unsupported')
    expect(unknown.result).toStrictEqual(selection)
    plan.deterministicProjection!.invalidated = true
    expect(evaluate(plan, { ...baseline, retirementSpending: 0 })[0]).toMatchObject({ status: 'invalid', result: {
      coverage: null, issues: [{ detail: 'deterministic-spending-reconfirmation-required' }],
    } })

    const valid = heldHome()
    const candidates = [{ ...baseline, retirementAge: 58.5 }, { ...baseline, retirementSpending: NaN }, ...Array(8).fill(baseline)]
    const outcomes = evaluate(valid, ...candidates)
    expect(outcomes.map(outcome => outcome.status)).toEqual([
      'invalid', 'invalid', ...Array(6).fill('complete-with-gaps'), 'search-limit', 'search-limit',
    ])
    for (const outcome of [...outcomes.slice(0, 2), ...outcomes.slice(8)]) {
      expect(outcome).toMatchObject({ result: null, livingGapYears: [], eventGapYears: [] })
    }
  })

  it('leaves the legacy API output intact when no canonical plan is elected', () => {
    const plan = heldHome()
    delete plan.deterministicProjection
    const original = runProjection(plan.legacyProjection, undefined, plan, { captureAnnualDetails: true })
    expect(evaluate(plan, baseline)).toMatchObject([{ status: 'unsupported', reason: 'canonical-required', result: null }])
    expect(selectDeterministicResult(plan.legacyProjection, plan, evidence)).toStrictEqual({ route: 'legacy', result: original })
  })
})
