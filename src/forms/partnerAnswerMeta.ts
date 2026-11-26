import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import type { AnswerMeta } from '../store'

/** Used only at observable discard/creation transactions, never to guess saved identity. */
export function omitUnboundPartnerAnswers(metadata: Record<string, AnswerMeta>): Record<string, AnswerMeta> {
  return Object.fromEntries(Object.entries(metadata).filter(([field, answer]) =>
    !(field.startsWith('partner.') && (answer.status === 'confirmed' || answer.status === 'estimated'))))
}

export function answersForPartnerCreation(
  before: { inputs: Inputs; canonical: InputsV2 | null },
  after: InputsV2,
  metadata: Record<string, AnswerMeta>,
): Record<string, AnswerMeta> {
  // The migration restores a retained orphan when available. Only a genuinely
  // empty counterpart slot becoming occupied proves that old answers are unbound.
  const hadPartner = !!before.inputs.partner || before.canonical?.people.some(person => person.role === 'partner') ||
    before.canonical?.orphanedPeople?.some(person => person.role === 'partner')
  return !hadPartner && after.people.some(person => person.role === 'partner')
    ? omitUnboundPartnerAnswers(metadata) : metadata
}
