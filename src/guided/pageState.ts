import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import type { AnswerMeta } from '../store'
import type { QuestionDefinition } from './schema'
import { accountOwnershipComplete, propertyOwnershipComplete, qcCoverageComplete } from './householdFacts'
import { earnedIncomeComplete, hasRecordedRegisteredType, rrifDetailsComplete } from './accountFacts'
import { fhsaRoomComplete, pensionSplitRecorded, rrspRoomComplete, spousalHistoryComplete, tfsaRoomComplete } from './taxDetails'
import { worksheetTotal } from './spending'

/** The store slice page completeness actually reads. */
export interface PageState {
  inputs: Inputs
  answerMeta: Record<string, AnswerMeta>
  questionAnswers: Record<string, string | boolean | string[]>
  /** The retirement-spending categories, when the store has them. */
  worksheet?: Record<string, number>
  canonical: ({ budget: { kind: 'incomeBudget' | 'savingsBudget' }; migration: { sourcePersistVersion: number; budgetReconciliation?: { answered: boolean } } } &
    Partial<Pick<InputsV2, 'people' | 'accounts' | 'properties' | 'taxProfile'>>) | null
}

/** The recorded plan the household-fact pages are answered against. */
function householdPlan(state: PageState): InputsV2 {
  return state.canonical?.people && state.canonical.accounts && state.canonical.properties
    ? state.canonical as InputsV2 : refreshCanonicalFromLegacy(null, state.inputs)
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
  // FE-43 A: the household tax facts are answered when the recorded plan holds
  // them, or when the user explicitly says they are not sure yet.
  if (definition.id === 'family.spouseSupport') {
    return householdPlan(state).taxProfile?.spouseSupported.status === 'known' || state.questionAnswers['family.spouseSupport'] === 'unknown'
  }
  if (definition.id === 'family.qcDrug') return qcCoverageComplete(householdPlan(state)) || state.questionAnswers['family.qcDrug'] === 'unknown'
  if (definition.id === 'assets.ownership') return accountOwnershipComplete(householdPlan(state))
  if (definition.id === 'housing.ownership') return propertyOwnershipComplete(householdPlan(state))
  // FE-43 B: optional facts, answered once recorded (or explicitly confirmed).
  if (definition.id === 'saving.earned') return earnedIncomeComplete(householdPlan(state))
  if (definition.id === 'account.rrsp.type') return state.questionAnswers['account.rrsp.type'] !== undefined || hasRecordedRegisteredType(householdPlan(state))
  if (definition.id === 'account.rrif.details') return rrifDetailsComplete(householdPlan(state))
  // FE-39: on the category path the total is answered once the categories'
  // sum is the recorded retirement spending.
  if (definition.id === 'spending.total' && state.questionAnswers['spending.method'] === 'estimate') {
    const total = worksheetTotal(state.worksheet)
    return answerIsUsable(state.answerMeta.retirementSpending) && total > 0 && Math.abs(total - state.inputs.retirementSpending) < 0.5
  }
  if (definition.id === 'housing.other') {
    return state.questionAnswers['housing.other.rentals'] !== undefined && state.questionAnswers['housing.other.debts'] !== undefined
  }
  // FE-43 C: the optional tax-details category. Unknown tax facts stay a valid
  // saved state; these pages only report whether the facts are recorded.
  if (definition.id === 'tax.intro') return state.questionAnswers['tax.intro'] !== undefined
  if (definition.id === 'tax.tfsaRoom') return tfsaRoomComplete(householdPlan(state))
  if (definition.id === 'tax.rrspRoom') return rrspRoomComplete(householdPlan(state))
  if (definition.id === 'tax.fhsaRoom') return fhsaRoomComplete(householdPlan(state))
  if (definition.id === 'tax.pensionSplit') return state.questionAnswers['tax.pensionSplit'] !== undefined || pensionSplitRecorded(householdPlan(state))
  if (definition.id === 'tax.spousalHistory') return spousalHistoryComplete(householdPlan(state))
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
  const choicePages = ['family.people', 'family.children', 'work.after', 'assets.identify', 'home.situation', 'home.mortgage', 'rental.0.mortgage', 'debt.0.type', 'spending.method', 'pension.self', 'pension.partner', 'intent.legacy', 'intent.spending', 'invest.mix', 'invest.strategy']
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
