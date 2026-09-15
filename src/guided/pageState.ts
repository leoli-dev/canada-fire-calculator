import type { Inputs } from '../engine'
import type { AnswerMeta } from '../store'
import type { QuestionDefinition } from './schema'

/** The store slice page completeness actually reads. */
export interface PageState {
  inputs: Inputs
  answerMeta: Record<string, AnswerMeta>
  questionAnswers: Record<string, string | boolean | string[]>
  canonical: { budget: { kind: 'incomeBudget' | 'savingsBudget' } } | null
}

function requiredFields(definition: QuestionDefinition, partner: boolean): string[] {
  return definition.fieldBindings.filter((field) => partner ||
    (!field.startsWith('partner.') && field !== 'lockedRetirement.owner'))
}

function answerIsUsable(meta: AnswerMeta | undefined): boolean {
  return !!meta && meta.status !== 'unknown' && meta.origin !== 'example'
}

/**
 * BE-13 A. Whether one question page is answered well enough to reach review.
 *
 * The budget page becomes complete exactly when the recorded basis is
 * answerable: the mode is chosen, and a `savingsBudget` has both inclusion
 * facts answered. A migrated plan also has to record what its earlier figure
 * meant. An unanswered fact keeps the page pending, so the user is asked rather
 * than defaulted.
 */
export function pageIsComplete(definition: QuestionDefinition, state: PageState): boolean {
  if (definition.id === 'time.work' && state.questionAnswers['time.work.target'] === 'yes') {
    return answerIsUsable(state.answerMeta.fireAge) &&
      answerIsUsable(state.answerMeta.fireTargetAssets) &&
      (state.inputs.fireTargetAssets ?? 0) > 0
  }
  if (definition.id === 'housing.other') {
    return state.questionAnswers['housing.other.rentals'] !== undefined && state.questionAnswers['housing.other.debts'] !== undefined
  }
  // Unknown tax facts are a valid saved state: guided users may still see a
  // labelled legacy preview, while the person-tax capability remains gated.
  if (definition.id === 'income.taxFacts') return true
  if (definition.id === 'budget.method') {
    if (!answerIsUsable(state.answerMeta['budget.method'])) return false
    const budget = state.canonical?.budget
    if (!budget || budget.kind === 'incomeBudget') return true
    return answerIsUsable(state.answerMeta['budget.debtIncluded']) &&
      answerIsUsable(state.answerMeta['budget.taxBenefitIncluded'])
  }
  const choicePages = ['family.people', 'family.children', 'saving.method', 'work.after', 'assets.identify', 'home.situation', 'home.mortgage', 'rental.0.mortgage', 'debt.0.type', 'spending.method', 'pension.self', 'pension.partner', 'intent.legacy', 'intent.spending', 'invest.mix', 'invest.strategy']
  if (choicePages.includes(definition.id)) return state.questionAnswers[definition.id] !== undefined
  const fields = requiredFields(definition, !!state.inputs.partner)
  if (!fields.length) return true
  const fieldsAreUsable = fields.every((field) => answerIsUsable(state.answerMeta[field]) || Object.entries(state.answerMeta).some(([candidate, meta]) => candidate.startsWith(`${field}.`) && answerIsUsable(meta)))
  if (definition.id === 'locked.access' && state.inputs.partner &&
      (state.answerMeta['lockedRetirement.owner']?.status !== 'confirmed' ||
        !answerIsUsable(state.answerMeta['lockedRetirement.owner']))) return false
  if (definition.id === 'allocation.tfsa') {
    const split = state.inputs.savingsSplit
    return fieldsAreUsable && Math.abs(split.tfsa + split.rrsp + split.nonReg - 1) <= 0.005
  }
  return fieldsAreUsable
}
