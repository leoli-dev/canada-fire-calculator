import type { InputsV2 } from './model'

/**
 * BE-36 A: the one planned FHSA contribution per account.
 *
 * The shared tax panel and the annual kernel must price the same plan, so this
 * module is the only place that decides which recurring row records it. The row
 * id is canonical and stable: migration emits it for the legacy form's FHSA
 * field, and the panel writes it, so `refreshCanonicalFromLegacy` rebuilds the
 * same row instead of dropping a panel-recorded plan.
 *
 * Documented behaviour: the canonical row is the whole plan for its account. A
 * second row for the same account is a stale duplicate left by an earlier
 * build, and it is never priced on top of the recorded row.
 */

/** The canonical recurring-row id that records one account's planned contribution. */
export const fhsaPlanRowId = (accountId: string) => `be36:fhsa:${accountId}`

const roundCents = (value: number) => Math.round(value * 100) / 100

/**
 * The planned annual FHSA contribution for one account. Both the panel and the
 * kernel read this, so a plan can never be counted twice or read from two
 * different rows.
 */
export function plannedFhsaContribution(
  plan: Pick<InputsV2, 'recurringContributions'>, accountId: string,
): number {
  const rows = plan.recurringContributions.filter(item => item.accountId === accountId)
  const recorded = rows.find(item => item.id === fhsaPlanRowId(accountId))
  const source = recorded ? [recorded] : rows
  return roundCents(source.reduce((total, item) => total + Math.max(0, item.annualAmount), 0))
}
