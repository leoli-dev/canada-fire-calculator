import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import type { AnswerMeta } from '../store'
import type { PlanningIntent } from '../store'
import { fieldRegistry, parseField, type SharedFieldId } from './fieldRegistry'

export interface PlanFieldSnapshot {
  inputs: Inputs
  canonical: InputsV2 | null
  draftByField: Record<string, string>
  answerMeta: Record<string, AnswerMeta>
  inputRevision: number
  resultRevision: number | null
  questionAnswers?: Record<string, string | boolean | string[]>
}

function revealAccount(answers: Record<string, string | boolean | string[]>, account: 'tfsa' | 'rrsp' | 'nonReg') {
  const selected = (answers['assets.identify'] as string[] | undefined) ?? []
  return { ...answers, 'assets.identify': [...new Set([...selected, account])] }
}

export function editField(state: PlanFieldSnapshot, id: SharedFieldId, raw: string, displayUnit: 'canonical' | 'monthly' = 'canonical', origin: AnswerMeta['origin'] = 'user'):
  Partial<PlanFieldSnapshot> {
  const parsed = parseField(id, raw, displayUnit)
  const updatedAt = new Date().toISOString()
  if (parsed.status === 'draft') return {
    draftByField: { ...state.draftByField, [id]: raw },
    answerMeta: { ...state.answerMeta, [id]: { status: 'unknown', origin, updatedAt } },
    inputRevision: state.inputRevision + 1,
    resultRevision: null,
  }
  const draftByField = { ...state.draftByField }
  delete draftByField[id]
  const inputs = fieldRegistry[id].write(state.inputs, parsed.value)
  const canonical = refreshCanonicalFromLegacy(state.canonical, inputs)
  if (id === 'nonRegBook') {
    const account = canonical.accounts.find(item => item.kind === 'nonReg')
    if (account) account.acb = { status: 'known', value: parsed.value }
  }
  return {
    inputs: canonical.legacyProjection, canonical, draftByField,
    answerMeta: { ...state.answerMeta, [id]: { status: 'confirmed', origin, updatedAt } },
    ...(id.startsWith('balances.') && parsed.value > 0 && state.questionAnswers
      ? { questionAnswers: revealAccount(state.questionAnswers, id.slice('balances.'.length) as 'tfsa' | 'rrsp' | 'nonReg') }
      : {}),
    inputRevision: state.inputRevision + 1, resultRevision: null,
  }
}

export function setUnknown(state: PlanFieldSnapshot, id: SharedFieldId): Partial<PlanFieldSnapshot> {
  return { ...editField(state, id, ''), draftByField: { ...state.draftByField, [id]: '' } }
}

export function applyEstimate(state: PlanFieldSnapshot, id: SharedFieldId, value: number): Partial<PlanFieldSnapshot> {
  const edit = editField(state, id, String(value), 'canonical', 'default')
  if (!edit.inputs || !edit.answerMeta) throw new Error(`Invalid estimate for ${id}`)
  return { ...edit, answerMeta: { ...edit.answerMeta, [id]: { ...edit.answerMeta[id], status: 'estimated', assumptionValue: value } } }
}

/** Reconcile legacy callers that explicitly write a registered value through
 * store.set. A whole balances object is commonly spread by callers, so only
 * changed account values count; account presence has its own command below. */
export function reconcileDirectFields(state: PlanFieldSnapshot, patch: Partial<Inputs>, nextInputs: Inputs): Pick<PlanFieldSnapshot, 'draftByField' | 'answerMeta'> & Partial<Pick<PlanFieldSnapshot, 'questionAnswers'>> {
  const draftByField = { ...state.draftByField }
  const answerMeta = { ...state.answerMeta }
  let questionAnswers = state.questionAnswers
  const updatedAt = new Date().toISOString()
  for (const id of Object.keys(fieldRegistry) as SharedFieldId[]) {
    const oldValue = fieldRegistry[id].read(state.inputs)
    const newValue = fieldRegistry[id].read(nextInputs)
    const scalar = id === 'currentAge' || id === 'fireAge' || id === 'lifeExpectancy' || id === 'annualSavings' || id === 'retirementSpending' || id === 'nonRegBook'
    const explicitScalar = scalar && Object.prototype.hasOwnProperty.call(patch, id)
    const changedBalance = id.startsWith('balances.') && patch.balances !== undefined && oldValue !== newValue
    const homePatched = id === 'principalResidence.annualMortgagePayment' && patch.principalResidence !== undefined
    const homeBecameInapplicable = homePatched && state.inputs.principalResidence?.mode === 'planned' && nextInputs.principalResidence?.mode !== 'planned'
    const homeBecameApplicable = homePatched && state.inputs.principalResidence?.mode !== 'planned' && nextInputs.principalResidence?.mode === 'planned'
    if (!explicitScalar && !changedBalance && !(homePatched && oldValue !== newValue) && !homeBecameInapplicable && !homeBecameApplicable) continue
    delete draftByField[id]
    if (changedBalance && newValue > 0 && questionAnswers) questionAnswers = revealAccount(questionAnswers, id.slice('balances.'.length) as 'tfsa' | 'rrsp' | 'nonReg')
    answerMeta[id] = {
      status: homeBecameInapplicable ? 'notApplicable' : homeBecameApplicable ? 'estimated' : 'confirmed',
      origin: homeBecameApplicable ? 'default' : 'user', updatedAt,
    }
  }
  return { draftByField, answerMeta, questionAnswers }
}

export function changeAccountPresence(
  state: PlanFieldSnapshot & { questionAnswers: Record<string, string | boolean | string[]> },
  account: 'tfsa' | 'rrsp' | 'nonReg', present: boolean,
): Partial<PlanFieldSnapshot> & { questionAnswers: Record<string, string | boolean | string[]> } {
  const id = `balances.${account}` as SharedFieldId
  const selected = (state.questionAnswers['assets.identify'] as string[] | undefined) ?? []
  const nextSelected = present ? [...new Set([...selected, account])] : selected.filter((item) => item !== account)
  const updatedAt = new Date().toISOString()
  if (present) {
    const previous = state.answerMeta[id]
    const unresolved = Object.prototype.hasOwnProperty.call(state.draftByField, id) || previous?.status === 'unknown'
    const fieldMeta = unresolved
      ? previous?.status === 'unknown' ? previous : { status: 'unknown' as const, origin: 'user' as const, updatedAt }
      : previous?.status === 'confirmed' || previous?.status === 'estimated'
        ? previous : { status: 'estimated' as const, origin: 'default' as const, updatedAt }
    return {
      questionAnswers: { ...state.questionAnswers, 'assets.identify': nextSelected },
      answerMeta: { ...state.answerMeta, [id]: fieldMeta, [account]: { status: 'estimated', origin: 'user', updatedAt } },
      inputRevision: state.inputRevision + 1, resultRevision: null,
    }
  }
  const edit = editField(state, id, '0')
  return {
    ...edit,
    questionAnswers: { ...state.questionAnswers, 'assets.identify': nextSelected },
    answerMeta: { ...edit.answerMeta, [id]: { status: 'notApplicable', origin: 'user', updatedAt },
      [account]: { status: 'notApplicable', origin: 'user', updatedAt } },
  }
}

export function changeIntent(state: PlanFieldSnapshot & { planningIntent: PlanningIntent; questionAnswers: Record<string, string | boolean | string[]> }, patch: Partial<PlanningIntent>): Partial<PlanFieldSnapshot> & { planningIntent: PlanningIntent; questionAnswers: Record<string, string | boolean | string[]> } {
  const planningIntent = {
    ...state.planningIntent, ...patch,
    understandingAcknowledged: patch.understandingAcknowledged ?? false,
    confirmedIntentRevision: patch.confirmedIntentRevision ?? null,
  }
  const goal = planningIntent.spendingPreference === 'exploreCeiling' ? 'dieWithZero' : 'legacy'
  const inputs = { ...state.inputs, goal } as Inputs
  const canonical = refreshCanonicalFromLegacy(state.canonical, inputs)
  return {
    inputs: canonical.legacyProjection, canonical, planningIntent,
    questionAnswers: { ...state.questionAnswers, 'intent.spending': planningIntent.spendingPreference, 'intent.legacy': planningIntent.legacyPreference },
    answerMeta: { ...state.answerMeta, goal: { status: 'confirmed', origin: 'user', updatedAt: new Date().toISOString() } },
    inputRevision: state.inputRevision + 1, resultRevision: null,
  }
}
