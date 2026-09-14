import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import type { AnswerMeta } from '../store'
import type { PlanningIntent } from '../store'
import { refreshPensionProvenance } from '../engine'
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

/**
 * BE-39 A. The benefit answers whose stored *value* the dependency pass
 * rewrote, so the metadata stops claiming the user confirmed a number the
 * engine has since replaced. A manual or statement amount never lands here:
 * its value is not touched. Shared by both write paths — `store.set` and the
 * field registry's `editField` — so an engine-replaced amount is labelled the
 * same way whichever control moved the retirement age.
 */
export type RewrittenBenefitField = 'cppAnnualAt65' | 'oasAnnualAt65' | 'partner.cppAnnualAt65' | 'partner.oasAnnualAt65'

export function rewrittenBenefitAnswers(
  before: Inputs,
  after: Inputs,
): { field: RewrittenBenefitField; assumptionValue?: number }[] {
  const fields: { field: RewrittenBenefitField; assumptionValue?: number }[] = []
  const push = (field: RewrittenBenefitField, previous: number, next: number) => {
    if (next !== previous) fields.push({ field, assumptionValue: next })
  }
  push('cppAnnualAt65', before.cppAnnualAt65, after.cppAnnualAt65)
  push('oasAnnualAt65', before.oasAnnualAt65, after.oasAnnualAt65)
  if (before.partner && after.partner) {
    push('partner.cppAnnualAt65', before.partner.cppAnnualAt65, after.partner.cppAnnualAt65)
    push('partner.oasAnnualAt65', before.partner.oasAnnualAt65, after.partner.oasAnnualAt65)
  }
  return fields
}

/**
 * Overlay the rewritten-amount marking onto a metadata map: a value the engine
 * replaced is an `estimated` answer, not a user-confirmed one. The amount the
 * engine produced is recorded as the assumption so the review pages can show
 * it. Returns the map unchanged when the dependency pass moved nothing.
 */
export function applyRewrittenBenefitAnswers(
  meta: Record<string, AnswerMeta>,
  rewritten: { field: RewrittenBenefitField; assumptionValue?: number }[],
): Record<string, AnswerMeta> {
  if (rewritten.length === 0) return meta
  const updatedAt = new Date().toISOString()
  const next = { ...meta }
  for (const { field, assumptionValue } of rewritten)
    next[field] = { status: 'estimated', origin: 'default', updatedAt, assumptionValue }
  return next
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
  // BE-39 A: a registered-field edit that moves the retirement age (the FIRE
  // age is the one that does) must invalidate the estimate-derived amounts.
  // Without this the registry path bypasses the rule `store.set` applies.
  const written = fieldRegistry[id].write(state.inputs, parsed.value)
  const inputs = refreshPensionProvenance(written)
  const canonical = refreshCanonicalFromLegacy(state.canonical, inputs)
  if (id === 'nonRegBook') {
    const account = canonical.accounts.find(item => item.kind === 'nonReg')
    if (account) account.acb = { status: 'known', value: parsed.value }
  }
  // The same bookkeeping `store.set` runs: when the dependency pass replaced the
  // amount, the field is no longer a user-confirmed answer. Both paths share
  // `rewrittenBenefitAnswers` so the metadata cannot drift between them.
  const answerMeta = applyRewrittenBenefitAnswers(
    { ...state.answerMeta, [id]: { status: 'confirmed', origin, updatedAt } },
    rewrittenBenefitAnswers(state.inputs, inputs),
  )
  return {
    inputs: canonical.legacyProjection, canonical, draftByField,
    answerMeta,
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
