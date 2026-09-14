import type { Contribution, InputsV2 } from './model'
import type { Fhsa } from './types'

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
const nonnegative = (value: number) => Math.max(0, value)

/**
 * The planned annual FHSA contribution for one account. Both the panel and the
 * kernel read this, so a plan can never be counted twice or read from two
 * different rows.
 *
 * When the canonical row is absent — a plan written by an earlier build, or
 * imported canonical data — the account has no recorded total. Summing every
 * row it does have would resurrect the doubling this module exists to prevent,
 * so the largest single row stands in for the plan: deterministic, and never
 * additive with a stale duplicate.
 */
export function plannedFhsaContribution(
  plan: Pick<InputsV2, 'recurringContributions'>, accountId: string,
): number {
  const rows = plan.recurringContributions.filter(item => item.accountId === accountId)
  const recorded = rows.find(item => item.id === fhsaPlanRowId(accountId))
  return roundCents(recorded ? nonnegative(recorded.annualAmount)
    : rows.reduce((largest, item) => Math.max(largest, nonnegative(item.annualAmount)), 0))
}

/**
 * The one-off rows the plan schedules for one account in one calendar year.
 * They are year-specific canonical facts, not recurring plan rows.
 */
export function fhsaScheduledContributions(
  plan: Pick<InputsV2, 'contributions'>, accountId: string, year: number,
): Contribution[] {
  return plan.contributions.filter(contribution =>
    contribution.accountId === accountId && contribution.calendarYear === year && contribution.amount > 0)
}

/**
 * One account's whole annual plan: the recorded recurring row when it is
 * larger, otherwise the scheduled rows for the year. A scheduled row is a
 * component of the recorded plan, never a second copy of it, so taking the
 * larger of the two is the only combination that cannot double-count — and the
 * amount the cash budget must reserve is exactly this total.
 */
export function plannedFhsaYearTotal(
  plan: Pick<InputsV2, 'contributions' | 'recurringContributions'>, accountId: string, year: number,
): number {
  const scheduled = fhsaScheduledContributions(plan, accountId, year)
    .reduce((total, contribution) => total + nonnegative(contribution.amount), 0)
  return roundCents(Math.max(plannedFhsaContribution(plan, accountId), scheduled))
}

/**
 * The one FHSA account the legacy form mirrors: migration emits this id for
 * `input.fhsa`, and the shared tax panel writes the household's recorded
 * accounts back onto it, so the legacy form's next rebuild produces the same
 * account instead of dropping it.
 */
export const legacyFhsaAccountId = 'legacy:account:fhsa'

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The legacy form's single FHSA bucket, mirrored from the canonical accounts.
 *
 * The legacy interface has no unknown state, so this is the one place an
 * unrecorded FHSA fact could be flattened into a concrete zero. It never does:
 * `openedYearsAgo` is derived from the canonical calendar opening year only
 * when that year is known; otherwise the recorded legacy years-ago answer is
 * carried through untouched (the canonical account's own
 * `openedYearsAgoAtBaseYear` is the second recorded source). A years-ago count
 * is not a calendar year, and `0` would assert "opened this year" — a fact the
 * plan does not hold. Only a plan that records neither source falls back to
 * zero, which is what the legacy form itself starts from.
 */
export function legacyFhsaMirror(
  plan: Pick<InputsV2, 'accounts' | 'baseYear' | 'contributions' | 'recurringContributions'>,
  recordedOpenedYearsAgo: number | null | undefined,
): Fhsa | null {
  const accounts = plan.accounts.filter(account => account.kind === 'fhsa')
  if (accounts.length === 0) return null
  const mirrored = accounts.find(account => account.id === legacyFhsaAccountId) ?? accounts[0]
  const recorded = finiteOrNull(recordedOpenedYearsAgo) ?? finiteOrNull(mirrored.openedYearsAgoAtBaseYear)
  return {
    // The balance is the household total across every FHSA account, so a
    // recorded per-person split reconciles back onto both accounts instead of
    // folding the partner's balance into the base one.
    balance: roundCents(accounts.reduce((total, account) => total + account.balance, 0)),
    annualContribution: plannedFhsaYearTotal(plan, mirrored.id, plan.baseYear),
    openedYearsAgo: mirrored.openedYear.status === 'known'
      ? Math.max(0, plan.baseYear - mirrored.openedYear.value)
      : recorded ?? 0,
  }
}
