import type { Inputs, PensionAmountProvenance } from '../engine'
import type { InputsV2 } from '../engine/model'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import type { AnswerMeta } from '../store'
import type { PlanningIntent } from '../store'
import type { PensionBenefitField, PensionBenefitRewrite } from '../engine'
import { refreshPensionProvenanceReport } from '../engine'
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

/** BE-39 A. The four recorded benefit amounts whose provenance the UI shows. */
export type RewrittenBenefitField = PensionBenefitField

/**
 * The benefit amounts one edit wrote *directly*, as the user's own answers.
 *
 * A self amount arrives in a narrow patch (`{ cppAnnualAt65 }`), so naming the
 * field is enough. A partner patch is a whole-record replacement — the UI
 * spreads the current partner — so only a changed number or a *different*
 * provenance object records a deliberate write there; a plain spread of an
 * unrelated partner field must not confirm these amounts.
 */
export function writtenBenefitFields(previous: Inputs, patch: Partial<Inputs>): RewrittenBenefitField[] {
  const fields: RewrittenBenefitField[] = []
  const directive = (patched: Inputs['cppAmountSource'], recorded: Inputs['cppAmountSource']) =>
    patched !== undefined && patched !== recorded
  if (patch.cppAnnualAt65 !== undefined || directive(patch.cppAmountSource, previous.cppAmountSource))
    fields.push('cppAnnualAt65')
  if (patch.oasAnnualAt65 !== undefined || directive(patch.oasAmountSource, previous.oasAmountSource))
    fields.push('oasAnnualAt65')
  if (patch.partner && previous.partner) {
    if (patch.partner.cppAnnualAt65 !== previous.partner.cppAnnualAt65 ||
        directive(patch.partner.cppAmountSource, previous.partner.cppAmountSource))
      fields.push('partner.cppAnnualAt65')
    if (patch.partner.oasAnnualAt65 !== previous.partner.oasAnnualAt65 ||
        directive(patch.partner.oasAmountSource, previous.partner.oasAmountSource))
      fields.push('partner.oasAnnualAt65')
  }
  return fields
}

/**
 * Overlay the benefit-amount marking onto a metadata map.
 *
 * `rewritten` is the dependency pass's own report of the amounts it re-derived
 * because a retirement-age premise moved — never a before/after value diff,
 * which also fires on a direct edit and used to persist a hand-typed figure as
 * `estimated`/`default`. `written` are the amounts this edit wrote directly and
 * `inputs` is the plan *after* the edit, because the label is a function of
 * where the number came from, not of which control wrote it last: an applied
 * estimator is this app's arithmetic (`estimated`/`default`, like every other
 * applied preset), while a typed figure and a re-confirmed statement are facts
 * the user asserts (`confirmed`/`user`). Deriving the label from the action
 * instead recorded an estimator Apply as a user-confirmed fact.
 */
export function applyBenefitAnswerMeta(
  meta: Record<string, AnswerMeta>,
  rewritten: PensionBenefitRewrite[],
  written: RewrittenBenefitField[],
  inputs: Inputs,
): Record<string, AnswerMeta> {
  if (rewritten.length === 0 && written.length === 0) return meta
  const updatedAt = new Date().toISOString()
  const next = { ...meta }
  for (const field of written) {
    next[field] = benefitProvenance(inputs, field)?.source === 'estimator'
      ? { status: 'estimated', origin: 'default', updatedAt }
      : { status: 'confirmed', origin: 'user', updatedAt }
  }
  for (const { field, assumptionValue } of rewritten) {
    if (written.includes(field)) continue
    next[field] = { status: 'estimated', origin: 'default', updatedAt, assumptionValue }
  }
  return next
}

/** Read one recorded benefit amount's provenance out of a plan. */
export function benefitProvenance(
  inputs: Inputs,
  field: RewrittenBenefitField,
): PensionAmountProvenance | undefined {
  if (field === 'cppAnnualAt65') return inputs.cppAmountSource
  if (field === 'oasAnnualAt65') return inputs.oasAmountSource
  if (field === 'partner.cppAnnualAt65') return inputs.partner?.cppAmountSource
  return inputs.partner?.oasAmountSource
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
  const refreshed = refreshPensionProvenanceReport(written)
  const inputs = refreshed.inputs
  const canonical = refreshCanonicalFromLegacy(state.canonical, inputs)
  if (id === 'nonRegBook') {
    const account = canonical.accounts.find(item => item.kind === 'nonReg')
    if (account) account.acb = { status: 'known', value: parsed.value }
  }
  // The same bookkeeping `store.set` runs: when the dependency pass replaced the
  // amount, the field is no longer a user-confirmed answer. Both paths use the
  // pass's own rewrite report so the metadata cannot drift between them. A
  // registered field is never one of the four amounts, so nothing was written
  // directly here.
  const answerMeta = applyBenefitAnswerMeta(
    { ...state.answerMeta, [id]: { status: 'confirmed', origin, updatedAt } },
    refreshed.rewritten,
    [],
    inputs,
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
