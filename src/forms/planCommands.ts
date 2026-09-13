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
