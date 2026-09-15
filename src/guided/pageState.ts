import type { Inputs } from '../engine'
import type { AnswerMeta } from '../store'
import type { QuestionDefinition } from './schema'

/** The store slice page completeness actually reads. */
export interface PageState {
  inputs: Inputs
  answerMeta: Record<string, AnswerMeta>
  questionAnswers: Record<string, string | boolean | string[]>
  canonical: { budget: { kind: 'incomeBudget' | 'savingsBudget' }; migration: { sourcePersistVersion: number; budgetReconciliation?: { answered: boolean } } } | null
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
    const budget = state.canonical?.budget
    // Answering an inclusion fact is itself an answer to the mode question, so
    // the mode label is not separately required. What settles the page is the
    // basis being answerable, plus the migrated-plan question when there is one.
    const modeAnswered = answerIsUsable(state.answerMeta['budget.method']) || (budget?.kind === 'savingsBudget' &&
      answerIsUsable(state.answerMeta['budget.debtIncluded']) && answerIsUsable(state.answerMeta['budget.taxBenefitIncluded']))
    if (!modeAnswered) return false
    // The basis is answerable when the mode is income, or when both inclusion
    // facts have been answered; a chosen mode alone is not an answer.
    const basisAnswerable = !budget || budget.kind === 'incomeBudget' ||
      (answerIsUsable(state.answerMeta['budget.debtIncluded']) && answerIsUsable(state.answerMeta['budget.taxBenefitIncluded']))
    // Both facts, not one: a single answered flag leaves the basis unanswerable.
    const migratedPending = state.canonical !== null && state.canonical.migration.sourcePersistVersion !== 11 &&
      !(state.canonical.migration.budgetReconciliation?.answered ?? false)
    return basisAnswerable && !migratedPending
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
