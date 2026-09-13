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
  return {
    inputs: canonical.legacyProjection, canonical, draftByField,
    answerMeta: { ...state.answerMeta, [id]: { status: 'confirmed', origin, updatedAt } },
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
export function reconcileDirectFields(state: PlanFieldSnapshot, patch: Partial<Inputs>, nextInputs: Inputs): Pick<PlanFieldSnapshot, 'draftByField' | 'answerMeta'> {
  const draftByField = { ...state.draftByField }
  const answerMeta = { ...state.answerMeta }
  const updatedAt = new Date().toISOString()
  for (const id of Object.keys(fieldRegistry) as SharedFieldId[]) {
    const oldValue = fieldRegistry[id].read(state.inputs)
    const newValue = fieldRegistry[id].read(nextInputs)
    const scalar = id === 'currentAge' || id === 'fireAge' || id === 'lifeExpectancy' || id === 'annualSavings' || id === 'retirementSpending'
    const explicitScalar = scalar && Object.prototype.hasOwnProperty.call(patch, id)
    const changedBalance = id.startsWith('balances.') && patch.balances !== undefined && oldValue !== newValue
    const homePatched = id === 'principalResidence.annualMortgagePayment' && patch.principalResidence !== undefined
    const homeBecameInapplicable = homePatched && state.inputs.principalResidence?.mode === 'planned' && nextInputs.principalResidence?.mode !== 'planned'
    const homeBecameApplicable = homePatched && state.inputs.principalResidence?.mode !== 'planned' && nextInputs.principalResidence?.mode === 'planned'
    if (!explicitScalar && !changedBalance && !(homePatched && oldValue !== newValue) && !homeBecameInapplicable) continue
    delete draftByField[id]
    answerMeta[id] = {
      status: homeBecameInapplicable ? 'notApplicable' : homeBecameApplicable ? 'estimated' : 'confirmed',
      origin: homeBecameApplicable ? 'default' : 'user', updatedAt,
    }
  }
  return { draftByField, answerMeta }
}

export function changeAccountPresence(
  state: PlanFieldSnapshot & { questionAnswers: Record<string, string | boolean | string[]> },
  account: 'tfsa' | 'rrsp' | 'nonReg', present: boolean,
): Partial<PlanFieldSnapshot> & { questionAnswers: Record<string, string | boolean | string[]> } {
  const id = `balances.${account}` as SharedFieldId
  const amount = present ? state.inputs.balances[account] : 0
  const edit = editField(state, id, String(amount))
  const selected = (state.questionAnswers['assets.identify'] as string[] | undefined) ?? []
  const nextSelected = present ? [...new Set([...selected, account])] : selected.filter((item) => item !== account)
  const previous = state.answerMeta[id]
  const status = present ? (previous?.status === 'confirmed' ? 'confirmed' : 'estimated') : 'notApplicable'
  const updatedAt = new Date().toISOString()
  return {
    ...edit,
    questionAnswers: { ...state.questionAnswers, 'assets.identify': nextSelected },
    answerMeta: { ...edit.answerMeta, [id]: { status, origin: status === 'estimated' ? 'default' : 'user', updatedAt },
      [account]: { status: present ? 'estimated' : 'notApplicable', origin: 'user', updatedAt } },
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
