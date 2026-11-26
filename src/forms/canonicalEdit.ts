import type { Account, InputsV2 } from '../engine/model'
import { derivedAccountId, refreshCanonicalFromLegacy, settleSingleHousehold } from '../engine/migration'
import { legacyFhsaMirror } from '../engine/fhsaPlan'
import { useStore, type AnswerMeta } from '../store'

/**
 * Whether any account or property still lacks a confirmed taxable owner. The
 * shared tax-facts editors (the professional panel and the guided household
 * pages) recompute this after every edit, so the precision gate can never read
 * a stale flag.
 */
export function ownershipNeedsConfirmation(plan: InputsV2): boolean {
  return plan.accounts.some(account => account.kind !== 'nonReg' && !account.ownerId || account.taxableOwnerShares.status === 'unknown') ||
    plan.properties.some(property => property.taxableOwnerShares.status === 'unknown')
}

/**
 * Apply one change to the recorded canonical plan as a single store
 * transaction. Guided pages and the professional panel both write through
 * this, so the two entry modes can never record the same fact differently.
 */
export function commitCanonicalEdit(change: (draft: InputsV2) => void): void {
  commitCanonicalTransaction(change)
}

/** The explicit discard action owns invalidation; ordinary edits retain answers. */
export function commitSingleHouseholdSettlement(): void {
  const state = useStore.getState()
  const current = state.canonical ?? refreshCanonicalFromLegacy(null, state.inputs)
  if (current.people.length !== 1) return
  commitCanonicalTransaction(draft => { Object.assign(draft, settleSingleHousehold(draft)) }, (before, metadata) => {
    // The orphan still exists at this boundary, before settlement deliberately
    // drops it. A future replacement may reuse its ID and cannot own its answers.
    if (!before.orphanedPeople?.some(person => person.role === 'partner')) return metadata
    return Object.fromEntries(Object.entries(metadata).filter(([field, answer]) =>
      !(field.startsWith('partner.') && (answer.status === 'confirmed' || answer.status === 'estimated'))))
  })
}

function commitCanonicalTransaction(
  change: (draft: InputsV2) => void,
  answersForChange?: (before: InputsV2, metadata: Record<string, AnswerMeta>) => Record<string, AnswerMeta>,
): void {
  const state = useStore.getState()
  const current = state.canonical ?? refreshCanonicalFromLegacy(null, state.inputs)
  const draft = structuredClone(current)
  change(draft)
  draft.migration.ownershipNeedsConfirmation = ownershipNeedsConfirmation(draft)
  // The legacy form rebuilds the account list on the next household edit, so a
  // recorded FHSA has to exist there too; the mirror carries the household
  // total and preserves a recorded years-ago opening answer.
  const mirroredFhsa = legacyFhsaMirror(draft, state.inputs.fhsa?.openedYearsAgo)
  const inputs = mirroredFhsa ? { ...state.inputs, fhsa: mirroredFhsa } : state.inputs
  state.commitPlan({ inputs, canonical: draft, answerMeta: answersForChange?.(current, state.answerMeta) ?? state.answerMeta, draftByField: state.draftByField })
}

/** Apply one change to a registered account and its recorded partner half, so
 * a split account always keeps one type and one set of RRIF facts. */
export function commitRegisteredRowEdit(accountId: string, change: (item: Account) => void): void {
  const rowIds = [accountId, derivedAccountId(accountId)]
  commitCanonicalEdit(draft => { for (const item of draft.accounts) if (rowIds.includes(item.id)) change(item) })
}

/** The recorded canonical plan, or the one the current form would migrate to. */
export function useCanonicalPlan(): InputsV2 {
  const plan = useStore(state => state.canonical)
  const inputs = useStore(state => state.inputs)
  return plan ?? refreshCanonicalFromLegacy(null, inputs)
}
