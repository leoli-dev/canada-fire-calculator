import type { Account, InputsV2 } from '../engine/model'
import { ownFhsaAccount } from '../engine/fhsa'
import type { QuestionAnswers } from './schema'

/** The whole optional category collapses to its first page once skipped. */
export const taxDetailsSkipped = (answers: QuestionAnswers) => answers['tax.intro'] === 'skip'

/** Whether every person's CRA TFSA room is recorded. */
export function tfsaRoomComplete(plan: InputsV2): boolean {
  return plan.people.every(person => person.tfsaAvailableRoom.status === 'known')
}

/** Whether every person's CRA RRSP available room is recorded. */
export function rrspRoomComplete(plan: InputsV2): boolean {
  return plan.people.every(person => person.rrspAvailableRoom.status === 'known')
}

/** The FHSA each person holds, when exactly one is recorded for them. */
export function fhsaHoldings(plan: InputsV2): { personId: string; account: Account }[] {
  return plan.people.flatMap(person => {
    const accountId = ownFhsaAccount(plan, person.id).accountId
    const account = accountId ? plan.accounts.find(item => item.id === accountId) : undefined
    return account ? [{ personId: person.id, account }] : []
  })
}

/** Whether every held FHSA has its participation-room statement line. */
export function fhsaRoomComplete(plan: InputsV2): boolean {
  const holdings = fhsaHoldings(plan)
  return holdings.length > 0 && holdings.every(({ account }) => account.contributionRoom.status === 'known')
}

/** Spousal plans, or plans that already carry a recorded premium history. */
export function spousalPlanAccounts(plan: InputsV2): Account[] {
  return plan.accounts.filter(account => ['rrsp', 'spousalRrsp', 'rrif', 'lif'].includes(account.kind) &&
    (account.kind === 'spousalRrsp' || plan.spousalHistory?.[account.id] !== undefined))
}

/** Whether every spousal plan says whether its premium history is complete. */
export function spousalHistoryComplete(plan: InputsV2): boolean {
  return spousalPlanAccounts(plan).every(account => plan.spousalHistory?.[account.id] !== undefined)
}

/** Whether a federal or Quebec pension-split election is recorded. */
export function pensionSplitRecorded(plan: InputsV2): boolean {
  return !!plan.taxProfile?.pensionSplit || !!plan.taxProfile?.qcPensionSplit
}
