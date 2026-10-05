import type { Account, InputsV2 } from '../engine/model'

export const REGISTERED_TYPE_KINDS = ['rrsp', 'spousalRrsp', 'rrif', 'lif'] as const
export type RegisteredTypeKind = typeof REGISTERED_TYPE_KINDS[number]

/** Registered accounts whose type can be recorded: one row per account, the
 * recorded partner half always moves with its base row. */
export function registeredTypeAccounts(plan: InputsV2): Account[] {
  return plan.accounts.filter(account =>
    (REGISTERED_TYPE_KINDS as readonly string[]).includes(account.kind) && !account.id.endsWith(':partner'))
}

/** Whether a type other than a plain RRSP has been recorded anywhere. */
export function hasRecordedRegisteredType(plan: InputsV2 | null | undefined): boolean {
  return !!plan?.accounts.some(account => account.kind === 'spousalRrsp' || account.kind === 'rrif' || account.kind === 'lif')
}

/** Whether every person's current employment income is recorded. */
export function earnedIncomeComplete(plan: InputsV2): boolean {
  return plan.people.every(person => person.earnedIncome.status === 'known')
}

/** Whether every RRIF has the two facts its minimum withdrawal needs. */
export function rrifDetailsComplete(plan: InputsV2): boolean {
  return registeredTypeAccounts(plan).filter(account => account.kind === 'rrif').every(account =>
    account.openedYear.status === 'known' && account.rrifFactorCategory?.status === 'known')
}
