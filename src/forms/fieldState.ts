import type { Inputs } from '../engine'
import type { AnswerMeta } from '../store'
import { fieldRegistry, type SharedFieldId } from './fieldRegistry'

export interface FieldState {
  draft: string | undefined
  lastValid: number
  meta: AnswerMeta | undefined
  usable: boolean
}

export function fieldState(state: { inputs: Inputs; draftByField: Record<string, string>; answerMeta: Record<string, AnswerMeta> }, id: SharedFieldId): FieldState {
  const draft = Object.prototype.hasOwnProperty.call(state.draftByField, id) ? state.draftByField[id] : undefined
  const meta = state.answerMeta[id]
  return { draft, lastValid: fieldRegistry[id].read(state.inputs), meta,
    usable: draft === undefined && meta?.status !== 'unknown' &&
      (meta?.status !== 'notApplicable' || (id.startsWith('balances.') && fieldRegistry[id].read(state.inputs) === 0)) }
}

export function hasUnusableSharedFields(state: { inputs: Inputs; draftByField: Record<string, string>; answerMeta: Record<string, AnswerMeta> }): boolean {
  return (Object.keys(fieldRegistry) as SharedFieldId[]).some((id) => {
    if (id === 'principalResidence.annualMortgagePayment' && state.inputs.principalResidence?.mode !== 'planned') return false
    return !fieldState(state, id).usable
  })
}
