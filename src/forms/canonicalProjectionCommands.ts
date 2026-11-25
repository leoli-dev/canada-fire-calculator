import type { InputsV2 } from '../engine/model'
import { transitionBudgetMode } from '../engine/budgetSemantics'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import { assertCanonicalPlan } from '../engine/modelValidation'
import type { PlanFieldSnapshot } from './planCommands'

type Transaction = Pick<PlanFieldSnapshot, 'inputs' | 'answerMeta' | 'draftByField'> & {
  canonical: InputsV2
  questionAnswers: NonNullable<PlanFieldSnapshot['questionAnswers']>
}

/** Explicitly entered living budgets update this plan, without rebuilding its
 * recorded accounts, authorizations or tax facts. Only return mode is archived;
 * later amount edits are never overwritten by an opt-out restoration snapshot.
 */
export function recordCanonicalBudgets(state: PlanFieldSnapshot, amounts: {
  working: number; retired: number; mixed?: number; mortgageExcluded: boolean
}, sourceYear = new Date().getFullYear()): Transaction {
  for (const value of [amounts.working, amounts.retired, ...(state.inputs.partner ? [amounts.mixed] : [])]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) throw new Error('Invalid explicit living budget')
  }
  const plan = structuredClone(state.canonical ?? refreshCanonicalFromLegacy(null, state.inputs))
  const estimateBudgetMode = plan.deterministicProjection?.estimateBudgetMode ?? plan.budget.kind
  const inputs = { ...state.inputs, budgetWorkingSpending: amounts.working, retirementSpending: amounts.retired }
  Object.assign(plan, transitionBudgetMode(plan, inputs, 'incomeBudget'))
  plan.budget = { kind: 'incomeBudget', workingSpending: amounts.working, retirementSpending: amounts.retired }
  plan.legacyProjection = { ...inputs }
  plan.deterministicProjection = { mode: 'canonical', estimateBudgetMode, provenance: { origin: 'user', sourceYear }, spending: {
    workingSpending: { status: 'known', value: amounts.working }, retirementSpending: { status: 'known', value: amounts.retired },
    ...(state.inputs.partner ? { transitionSpending: { status: 'known' as const, value: amounts.mixed! } } : {}),
    ...(amounts.mortgageExcluded ? { scheduledMortgagePaymentsExcluded: { status: 'known' as const, value: true as const } } : {}),
  } }
  assertCanonicalPlan(plan)
  const draftByField = { ...state.draftByField }
  delete draftByField.retirementSpending
  const updatedAt = new Date().toISOString()
  return { inputs, canonical: plan, draftByField,
    answerMeta: { ...state.answerMeta, retirementSpending: { status: 'confirmed', origin: 'user', updatedAt },
      'budget.method': { status: 'confirmed', origin: 'user', updatedAt } },
    questionAnswers: { ...(state.questionAnswers ?? {}), 'budget.method': 'incomeBudget' },
  }
}

export function disableCanonicalProjection(state: PlanFieldSnapshot): Transaction | null {
  if (!state.canonical?.deterministicProjection) return null
  const plan = structuredClone(state.canonical)
  const mode = plan.deterministicProjection!.estimateBudgetMode ?? plan.budget.kind
  Object.assign(plan, transitionBudgetMode(plan, state.inputs, mode))
  delete plan.deterministicProjection
  plan.legacyProjection = { ...state.inputs }
  assertCanonicalPlan(plan)
  return { inputs: state.inputs, canonical: plan, answerMeta: { ...state.answerMeta,
    'budget.method': { status: 'confirmed', origin: 'user', updatedAt: new Date().toISOString() } },
    draftByField: state.draftByField, questionAnswers: { ...(state.questionAnswers ?? {}), 'budget.method': mode } }
}

/** The opt-out preference is independent of the current canonical budget.
 * Reaffirming an already recorded choice is a no-op, not another plan edit.
 */
export function setCanonicalEstimateBudgetMode(state: PlanFieldSnapshot, mode: InputsV2['budget']['kind']): Transaction | null {
  if (!state.canonical?.deterministicProjection || state.canonical.deterministicProjection.estimateBudgetMode === mode) return null
  const canonical = structuredClone(state.canonical)
  canonical.deterministicProjection!.estimateBudgetMode = mode
  assertCanonicalPlan(canonical)
  return { inputs: state.inputs, canonical, answerMeta: state.answerMeta, draftByField: state.draftByField,
    questionAnswers: { ...(state.questionAnswers ?? {}) } }
}
