import type { InputsV2 } from '../engine/model'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import { legacyFhsaMirror } from '../engine/fhsaPlan'
import { useStore } from '../store'

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
  const state = useStore.getState()
  const draft = structuredClone(state.canonical ?? refreshCanonicalFromLegacy(null, state.inputs))
  change(draft)
  draft.migration.ownershipNeedsConfirmation = ownershipNeedsConfirmation(draft)
  // The legacy form rebuilds the account list on the next household edit, so a
  // recorded FHSA has to exist there too; the mirror carries the household
  // total and preserves a recorded years-ago opening answer.
  const mirroredFhsa = legacyFhsaMirror(draft, state.inputs.fhsa?.openedYearsAgo)
  const inputs = mirroredFhsa ? { ...state.inputs, fhsa: mirroredFhsa } : state.inputs
  state.commitPlan({ inputs, canonical: draft, answerMeta: state.answerMeta, draftByField: state.draftByField })
}

/** The recorded canonical plan, or the one the current form would migrate to. */
export function useCanonicalPlan(): InputsV2 {
  const plan = useStore(state => state.canonical)
  const inputs = useStore(state => state.inputs)
  return plan ?? refreshCanonicalFromLegacy(null, inputs)
}
