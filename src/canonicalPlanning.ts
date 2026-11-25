import type { Inputs } from './engine'
import type { InputsV2 } from './engine/model'
import { selectDeterministicResult, type CanonicalDeterministicResult } from './deterministicResult'

/** Explicit experiments, never an inferred search range or a plan edit. */
export interface CanonicalPlanningCandidate {
  retirementAge: number
  /** Annual household retirement living budget in base-year real CAD. */
  retirementSpending: number
}
export const CANONICAL_PLANNING_LIMIT = 8
export type CanonicalPlanningStatus = 'complete-zero-gaps' | 'complete-with-gaps' | 'partial' | 'unsupported' | 'invalid' | 'search-limit'
export interface CanonicalPlanningEvaluation {
  candidate: CanonicalPlanningCandidate
  status: CanonicalPlanningStatus
  result: CanonicalDeterministicResult | null
  livingGapYears: number[]
  eventGapYears: number[]
  reason?: 'canonical-required' | 'candidate-invalid' | 'benefit-premise-review'
}

/** At most 8 independent selector calls (each bounded to 120 annual rows).
 * The unchecked suffix is represented, never silently dropped or ranked.
 * No legacy reconstruction: that would discard ownership and authorizations.
 * Only self's retirement clock moves; recorded claim/event/statement clocks,
 * the partner, transition budget and dated property budgets stay unchanged.
 */
export function evaluateCanonicalCandidates(inputs: Inputs, plan: InputsV2 | null,
  evidence: { nonRegAbsent: boolean }, candidates: readonly CanonicalPlanningCandidate[]): CanonicalPlanningEvaluation[] {
  return candidates.map((candidate, index) => {
    const base = { candidate: structuredClone(candidate), result: null, livingGapYears: [], eventGapYears: [] }
    if (index >= CANONICAL_PLANNING_LIMIT) return { ...base, status: 'search-limit' }
    if (!plan?.deterministicProjection) return { ...base, status: 'unsupported', reason: 'canonical-required' }
    const self = plan.people.find(person => person.role === 'self')
    if (!self || !Number.isInteger(candidate.retirementAge) || candidate.retirementAge < self.ageInBaseYear ||
      candidate.retirementAge > plan.lifeExpectancy || candidate.retirementAge > 105 ||
      !Number.isFinite(candidate.retirementSpending) || candidate.retirementSpending < 0 ||
      candidate.retirementSpending > Number.MAX_SAFE_INTEGER / 100)
      return { ...base, status: 'invalid', reason: 'candidate-invalid' }
    const snapshot = structuredClone(plan)
    const detachedInputs = structuredClone(inputs)
    const owner = snapshot.people.find(person => person.id === self.id)!
    const ageChanged = candidate.retirementAge !== owner.retirementAge
    if (ageChanged) {
      owner.retirementAge = candidate.retirementAge
      detachedInputs.fireAge = candidate.retirementAge
      snapshot.legacyProjection.fireAge = candidate.retirementAge
    }
    // Identical candidates retain unknown evidence and invalidation verbatim.
    if (candidate.retirementSpending !== snapshot.budget.retirementSpending) {
      detachedInputs.retirementSpending = candidate.retirementSpending
      snapshot.legacyProjection.retirementSpending = candidate.retirementSpending
      snapshot.budget.retirementSpending = candidate.retirementSpending
      snapshot.deterministicProjection!.spending.retirementSpending = { status: 'known', value: candidate.retirementSpending }
    }
    // Some annual known-zero routes do not price benefits. A changed clock
    // still cannot endorse an obsolete statement (or clear a review flag).
    // Leave all recorded amounts/premises untouched, including zero amounts.
    if (ageChanged && !snapshot.deterministicProjection!.invalidated && [owner.cppAmountSource, owner.oasAmountSource].some(source =>
      source?.premisesNeedReview || source?.source === 'statement' && source.premises?.retirementAge !== owner.retirementAge))
      return { ...base, status: 'unsupported', reason: 'benefit-premise-review' }
    const selected = selectDeterministicResult(detachedInputs, snapshot, evidence)
    // The explicit election above makes legacy unreachable, but never expose a
    // legacy success if a future selector changes that contract.
    if (selected.route !== 'canonical') return { ...base, status: 'unsupported', reason: 'canonical-required' }
    const livingGapYears = selected.coverage?.rows.filter(row =>
      ((row.householdWithdrawalSettlement ?? row.retirementSettlement)?.spendingUnmet ?? 0) > 0).map(row => row.year) ?? []
    const eventGapYears = selected.coverage?.rows.filter(row => (row.householdExpense?.unmet ?? 0) > 0).map(row => row.year) ?? []
    const status: CanonicalPlanningStatus = selected.status === 'complete'
      ? livingGapYears.length || eventGapYears.length || selected.coverage?.state.unfundedEvents.some(gap => gap.amount > 0)
        ? 'complete-with-gaps' : 'complete-zero-gaps'
      : selected.status === 'blocked' ? 'unsupported' : selected.status
    return { candidate: base.candidate, status, result: selected, livingGapYears, eventGapYears }
  })
}
